// Piloto: servidor iniciado SEM ATENDO_LIBERAR_AUTOENVIO, com estado salvo em que
// a loja já está no novo com novoEnvioAutomatico=true e um ticket do novo com
// enviaEm agendado. Nada do motor novo pode sair sozinho; o clássico não muda.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-piloto-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8797'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
process.env.ATENDO_SIMULAR = '1'
delete process.env.DATABASE_URL
delete process.env.ATENDO_LIBERAR_AUTOENVIO
delete process.env.ATENDO_SMTP_FAKE
for (const [suf, nome] of [['', 'loja1'], ['2', 'loja2']]) {
  process.env[`EMAIL${suf}_USER`] = `${nome}@teste.local`; process.env[`EMAIL${suf}_PASS`] = 'senha-falsa'
  process.env[`EMAIL${suf}_IMAP_HOST`] = 'imap.invalido.test'; process.env[`EMAIL${suf}_SMTP_HOST`] = 'smtp.invalido.test'
}

const { hashSenha } = await import('../server/auth.js')
const { novoEstado: estadoInicial } = await import('../server/db.js')
const estado = estadoInicial()
estado.config.atrasoMinutos = 0.05
estado.config.automacaoAtiva = true
const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
estado.lojas = [
  { id: 'loja1', nome: 'Loja Piloto', ativa: true, moeda: 'EUR', idioma: 'auto', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', novoEnvioAutomatico: true, cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 } },
  { id: 'loja2', nome: 'Loja Clássica', ativa: true, moeda: 'EUR', idioma: 'auto' },
]
estado.pedidos = [1, 2, 3].map(n => ({ id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: n === 3 ? 'loja2' : 'loja1', itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }] }))
const jaAgendado = Date.now() - 1000 // já vencido: sairia na primeira volta do laço
estado.tickets = [
  // ticket do NOVO com rascunho pronto e envio automático agendado no estado salvo
  { id: 'novo1', nome: 'C1', de: 'c1@web.de', assunto: 'Bestellung #1', corpo: 'Schlecht.', data: '2026-09-01T10:00:00.000Z', lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId: 'loja1', historico: [], motor: 'novo',
    rascunho: 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Gutschein: DANKE15 (15%). Lieferzeit 4 a 11 dias. Möchten Sie das annehmen?', geradoPorIA: true, enviaEm: jaAgendado,
    atendimentoNovo: { versao: 1, fluxo: 'qualidade', etapa: null, produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true, motivo: 'qualidade', historicoEtapas: [], transicaoPendente: { para: 'qual_troca', mensagem: 'schlecht', faltando: [] }, aguardando: 'envio', acaoAceita: null, idioma: 'de', rascunhoGerado: 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Gutschein: DANKE15 (15%). Lieferzeit 4 a 11 dias. Möchten Sie das annehmen?', rascunhoIdioma: 'de' } },
  // ticket do CLÁSSICO com envio agendado: não pode ser tocado
  { id: 'classico1', nome: 'C3', de: 'c3@web.de', assunto: 'Bestellung #3', corpo: 'Wo ist mein Paket?', data: '2026-09-01T10:00:00.000Z', lido: true, origem: 'cliente', categoria: 'rastreio', status: 'aprovacao', idioma: 'de', lojaId: 'loja2', historico: [], motor: 'classico',
    rascunho: 'Ihr Paket ist unterwegs.', geradoPorIA: true, enviaEm: Date.now() + 3600_000 },
]
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

/* IA simulada mínima: classifica como pedido de reembolso por qualidade e escreve a oferta da fase */
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('anthropic.com')) return realFetch(url, opts)
  const body = JSON.parse(opts.body)
  const responder = saida => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: JSON.stringify(saida) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const req = body.output_config?.format?.schema?.required ?? []
  if (req.includes('intencao')) return responder({ intencao: 'pede_reembolso', motivo: 'qualidade', produtos: ['Polo Premium'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'msg', idioma: 'de', idiomaConfiavel: true, spam: false })
  if (req.includes('acao_proposta')) {
    const sys = String(body.system || '')
    const acao = sys.match(/"acao_proposta" deve ser exatamente "([^"]+)"/)?.[1] ?? '?'
    const cup = sys.match(/Cupom de (\d+)%: código (\w+)\. Use EXATAMENTE/)
    const prazo = sys.match(/Prazo do envio expresso: ([^.]+)\./)?.[1]
    return responder({ resposta: `Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an.${cup ? ` Gutschein: ${cup[2]} (${cup[1]}%).` : ''}${prazo ? ` Lieferzeit ${prazo}.` : ''} Möchten Sie das annehmen?`, acao_proposta: acao, idioma: 'de' })
  }
  return responder({ situacao: 'rastreio', resolucao: 'rastreio enviado', categoria: 'rastreio', idioma: 'de', resposta: 'Ihr Paket ist unterwegs.', confianca: 0.95, escalar_humano: false, aprova_reembolso: false, confirma_troca: false, encerrar: false, motivo: '', spam: false })
}

let cookie = ''
const base = 'http://localhost:8797'
const api = (rota, corpo, metodo = 'POST') => realFetch(base + rota, { method: metodo, headers: { 'Content-Type': 'application/json', cookie }, body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}) }).then(async r => ({ status: r.status, ...(await r.json()) }))
const esperar = ms => new Promise(r => setTimeout(r, ms))
let servidor

before(async () => {
  servidor = await import('../server/index.js')
  await esperar(2500)
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@teste.local', senha: 'senha-teste-1234' }) })
  assert.equal(login.status, 200)
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
})
after(async () => { await servidor.encerrar(); try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

test('sem ATENDO_LIBERAR_AUTOENVIO: loja neutralizada, agendamento antigo do novo cancelado, clássico intacto, nada sai', async () => {
  const st = (await api('/api/state', null, 'GET')).state
  assert.equal(st.envioAutomaticoLiberado, false)
  assert.equal(st.lojas.find(l => l.id === 'loja1').novoEnvioAutomatico, false, 'valor salvo como true foi neutralizado')
  const novo1 = st.tickets.find(t => t.id === 'novo1')
  assert.equal(novo1.status, 'aprovacao', 'o rascunho continua em Aprovações'); assert.equal(novo1.enviaEm, undefined, 'agendamento automático do novo cancelado')
  assert.equal(novo1.atendimentoNovo.envioBloqueado, 'envio automático bloqueado durante o piloto'); assert.equal(novo1.atendimentoNovo.etapa, null); assert.equal(novo1.atendimentoNovo.transicaoPendente.para, 'qual_troca'); assert.ok(novo1.rascunho)
  const classico1 = st.tickets.find(t => t.id === 'classico1')
  assert.ok(classico1.enviaEm, 'o agendamento do clássico não é tocado'); assert.equal(classico1.status, 'aprovacao')
  // o laço de auto-envio roda e o ticket do novo continua parado (o do clássico ainda não venceu)
  await esperar(6500)
  const depois = (await api('/api/state', null, 'GET')).state
  const n2 = depois.tickets.find(t => t.id === 'novo1')
  assert.equal(n2.status, 'aprovacao'); assert.equal(n2.enviaEm, undefined); assert.equal(n2.atendimentoNovo.etapa, null, 'nada foi enviado')
  assert.ok(depois.tickets.find(t => t.id === 'classico1').enviaEm)
})

test('mensagem nova numa loja do novo (que dizia automático=true) não ganha enviaEm; o bloqueio fica registrado', async () => {
  // religa à força o valor salvo, como se um estado antigo voltasse — o agendamento continua bloqueado
  const r = await api('/api/simular-email', { de: 'c2@web.de', nome: 'C2', assunto: 'Bestellung #2', corpo: 'Die Qualität ist schlecht, ich will mein Geld zurück.', lojaId: 'loja1' })
  assert.ok(r.ok, r.erro)
  const t = r.ticket
  assert.equal(t.motor, 'novo'); assert.equal(t.status, 'aprovacao'); assert.equal(t.enviaEm, undefined, 'nenhum enviaEm criado'); assert.ok(t.rascunho); assert.equal(t.atendimentoNovo.transicaoPendente.para, 'qual_troca')
  // ligar o automático pela rota continua bloqueado no piloto
  const l = await api('/api/lojas', { id: 'loja1', novoEnvioAutomatico: true, confirmar: true })
  assert.equal(l.status, 400); assert.equal(l.bloqueadoPiloto, true)
})
