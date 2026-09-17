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
estado.pedidos = [1, 2, 3, 4, 5].map(n => ({ id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: n === 3 ? 'loja2' : 'loja1', itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }] }))
const jaAgendado = Date.now() - 1000 // já vencido: sairia na primeira volta do laço
estado.tickets = [
  // ticket do NOVO com rascunho pronto e envio automático agendado no estado salvo
  { id: 'novo1', nome: 'C1', de: 'c1@web.de', assunto: 'Bestellung #1', corpo: 'Schlecht.', data: '2026-09-01T10:00:00.000Z', lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId: 'loja1', historico: [], motor: 'novo',
    rascunho: 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Gutschein: DANKE15 (15%). Lieferzeit 4 a 11 dias. Möchten Sie das annehmen?', geradoPorIA: true, enviaEm: jaAgendado,
    atendimentoNovo: { versao: 1, fluxo: 'qualidade', etapa: null, produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true, motivo: 'qualidade', historicoEtapas: [], transicaoPendente: { para: 'qual_troca', mensagem: 'schlecht', faltando: [] }, aguardando: 'envio', acaoAceita: null, idioma: 'de', rascunhoGerado: 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Gutschein: DANKE15 (15%). Lieferzeit 4 a 11 dias. Möchten Sie das annehmen?', rascunhoIdioma: 'de' } },
  // conclusão automática JÁ CONCLUÍDA antes do reinício (confirmação enviada + linha do relatório): reinício, agendador e mensagem repetida não duplicam nada
  { id: 'conc1', nome: 'C4', de: 'c4@web.de', assunto: 'Bestellung #4', corpo: 'Ok, 40%.', data: '2026-09-01T10:00:00.000Z', lido: true, origem: 'cliente', categoria: 'reembolso', status: 'enviado', idioma: 'de', lojaId: 'loja1', historico: [], motor: 'novo', motorAtendimento: 'novo',
    resposta: 'Wir haben die Rückerstattung von 40% (40,00 €) veranlasst.', respondidoEm: '2026-09-01T15:00:00.000Z', relatorioDia: '2026-09-01', relatorioTexto: 'Reembolso de 40% — 40% = 40,00 EUR — motor novo, conclusão automática',
    relatorioAuto: { eventoId: 'ev-conc1', ticketId: 'conc1', pedido: '#4', lojaId: 'loja1', loja: 'Loja Piloto', jornada: 'qualidade', faseAceita: 'reemb_40', solucao: 'Reembolso de 40%', produtos: ['Polo Premium (Schwarz / L)'], percentual: 40, valor: 40, moeda: 'EUR', cupom: null, origem: 'motor novo — conclusão automática', mensagemConfirmacaoId: 'atendo-conc1', aceitaEm: '2026-09-01T10:00:00.000Z', confirmacaoEnviadaEm: '2026-09-01T15:00:00.000Z' },
    atendimentoNovo: { versao: 1, fluxo: 'qualidade', etapa: 'conf_reembolso', produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true, motivo: 'qualidade', historicoEtapas: [{ de: null, para: 'qual_troca', mensagem: 'x', em: '2026-08-31T10:00:00.000Z' }, { de: 'qual_troca', para: 'qual_cupom_35', mensagem: 'x', em: '2026-08-31T16:00:00.000Z' }, { de: 'qual_cupom_35', para: 'reemb_25', mensagem: 'x', em: '2026-08-31T22:00:00.000Z' }, { de: 'reemb_25', para: 'reemb_40', mensagem: 'x', em: '2026-09-01T04:00:00.000Z' }, { de: 'reemb_40', para: 'conf_reembolso', mensagem: 'ok', em: '2026-09-01T15:00:00.000Z' }], transicaoPendente: null, aguardando: null, acaoAceita: 'reemb_40', idioma: 'de',
      conclusaoPendente: { id: 'ev-conc1', ticketId: 'conc1', faseAceita: 'reemb_40', tipo: 'reembolso', jornada: 'qualidade', modo: 'automatico', aceitaEm: '2026-09-01T10:00:00.000Z', percentual: 40, valor: 40, moeda: 'EUR', cupom: null, produtos: ['Polo Premium (Schwarz / L)'], endereco: null, status: 'concluida', confirmadaEm: '2026-09-01T15:00:00.000Z', faseConfirmada: 'conf_reembolso', mensagemConfirmacaoId: 'atendo-conc1' } } },
  // conclusão automática AGENDADA quando o servidor caiu (confirmação pendente com enviaEm vencido): no piloto sem liberação nada sai; nunca duas confirmações
  { id: 'conc2', nome: 'C5', de: 'c5@web.de', assunto: 'Bestellung #5', corpo: 'Ok, 40%.', data: '2026-09-01T10:00:00.000Z', lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId: 'loja1', historico: [], motor: 'novo', motorAtendimento: 'novo',
    rascunho: 'Hallo! Wir haben die Rückerstattung von 40% (40,00 €) veranlasst. Das Geld ist in 3 bis 14 Tagen wieder da.', geradoPorIA: true, enviaEm: jaAgendado,
    atendimentoNovo: { versao: 1, fluxo: 'qualidade', etapa: 'reemb_40', produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true, motivo: 'qualidade', historicoEtapas: [{ de: null, para: 'qual_troca', mensagem: 'x', em: '2026-08-31T10:00:00.000Z' }, { de: 'qual_troca', para: 'qual_cupom_35', mensagem: 'x', em: '2026-08-31T16:00:00.000Z' }, { de: 'qual_cupom_35', para: 'reemb_25', mensagem: 'x', em: '2026-08-31T22:00:00.000Z' }, { de: 'reemb_25', para: 'reemb_40', mensagem: 'x', em: '2026-09-01T04:00:00.000Z' }], transicaoPendente: { para: 'conf_reembolso', mensagem: 'ok', faltando: [] }, aguardando: 'envio', acaoAceita: 'reemb_40', idioma: 'de', rascunhoGerado: 'Hallo! Wir haben die Rückerstattung von 40% (40,00 €) veranlasst. Das Geld ist in 3 bis 14 Tagen wieder da.', rascunhoIdioma: 'de',
      conclusaoPendente: { id: 'ev-conc2', ticketId: 'conc2', faseAceita: 'reemb_40', tipo: 'reembolso', jornada: 'qualidade', modo: 'automatico', aceitaEm: '2026-09-01T10:00:00.000Z', percentual: 40, valor: 40, moeda: 'EUR', cupom: null, produtos: ['Polo Premium (Schwarz / L)'], endereco: null, status: 'aguardando_cadencia' } } },
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
  // idempotência da conclusão automática através do REINÍCIO do servidor
  const c1 = depois.tickets.find(t => t.id === 'conc1'); const c2 = depois.tickets.find(t => t.id === 'conc2')
  assert.equal(c1.status, 'enviado'); assert.equal(c1.atendimentoNovo.etapa, 'conf_reembolso'); assert.equal(c1.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1); assert.equal(c1.relatorioAuto.eventoId, 'ev-conc1'); assert.equal(c1.atendimentoNovo.conclusaoPendente.status, 'concluida')
  assert.equal(depois.tickets.filter(t => t.relatorioAuto?.eventoId === 'ev-conc1').length, 1, 'uma linha só, mesmo depois do reinício e do agendador')
  // no piloto (sem ATENDO_LIBERAR_AUTOENVIO) a loja perde os pré-requisitos: a conclusão automática é interrompida e vai ao dono
  assert.equal(c2.status, 'humano'); assert.match(c2.motivoEscalada, /Conclusão automática interrompida/); assert.equal(c2.enviaEm, undefined, 'agendamento vencido cancelado no piloto'); assert.equal(c2.atendimentoNovo.etapa, 'reemb_40', 'a confirmação não saiu'); assert.equal(c2.relatorioAuto, undefined); assert.equal(c2.atendimentoNovo.conclusaoPendente.status, 'interrompida'); assert.equal(c2.atendimentoNovo.conclusaoPendente.valor, 40, 'solução preservada'); assert.equal(c2.atendimentoNovo.transicaoPendente.para, 'conf_reembolso')
  // mensagem repetida numa conclusão já concluída: vai ao dono, nenhuma confirmação nova, nenhuma linha nova
  const rep = await api('/api/simular-email', { de: 'c4@web.de', nome: 'C4', assunto: 'Bestellung #4', corpo: 'Ok, 40%.', ticketId: 'conc1' })
  assert.ok(rep.ok, rep.erro); assert.equal(rep.ticket.status, 'humano'); assert.equal(rep.ticket.atendimentoNovo.transicaoPendente, null)
  const fim = (await api('/api/state', null, 'GET')).state
  assert.equal(fim.tickets.filter(t => t.relatorioAuto?.eventoId === 'ev-conc1').length, 1); assert.equal(fim.tickets.find(t => t.id === 'conc1').atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1)
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
