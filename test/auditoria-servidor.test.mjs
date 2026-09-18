// Auditoria da IA no pipeline REAL: os eventos são gravados no momento em que
// as coisas acontecem, o checklist é calculado no servidor e a página só lê.
// Servidor de verdade, IA e canal simulados. Nenhuma loja é ativada e nenhuma
// mensagem real é enviada.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-auditoria-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8789'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
process.env.ATENDO_SIMULAR = '1'
process.env.NODE_ENV = 'test'
process.env.ATENDO_SMTP_FAKE = 'ok'
process.env.ATENDO_LIBERAR_AUTOENVIO = '1'
delete process.env.DATABASE_URL
for (const [suf, nome] of [['', 'loja1'], ['2', 'loja2']]) {
  process.env[`EMAIL${suf}_USER`] = `${nome}@teste.local`; process.env[`EMAIL${suf}_PASS`] = 'senha-falsa'
  process.env[`EMAIL${suf}_IMAP_HOST`] = 'imap.invalido.test'; process.env[`EMAIL${suf}_SMTP_HOST`] = 'smtp.invalido.test'
}

const { hashSenha } = await import('../server/auth.js')
const { novoEstado: estadoInicial } = await import('../server/db.js')

const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
const conferencia = lojaId => ({
  permissao: true, erro: null, em: new Date().toISOString(), lojaId,
  itens: Object.entries(CUPONS).map(([pct, codigo]) => ({ pct: Number(pct), codigo, valor: Number(pct), situacao: 'ok', detalhe: 'ok' })),
})
const estado = estadoInicial()
estado.config.automacaoAtiva = true
estado.config.atrasoMinutos = 0.05
const loja = extra => ({
  ativa: true, moeda: 'EUR', idioma: 'auto', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z',
  cupons: { ...CUPONS }, prazoEntrega: { min: 5, max: 12, processamento: 3 }, ...extra,
})
estado.lojas = [
  loja({ id: 'loja1', nome: 'Loja Nova', verificacaoCupons: conferencia('loja1') }),
  { id: 'loja2', nome: 'Loja Clássica', ativa: true, moeda: 'EUR', idioma: 'auto' },
]
estado.pedidos = [1, 2, 3, 4, 5, 6].map(n => ({
  id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100,
  status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: n === 6 ? 'loja2' : 'loja1',
  itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
}))
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

const url = 'http://localhost:8789'
let cookie = ''
let servidor = null
const realFetch = globalThis.fetch
const api = (rota, corpo, metodo = 'POST') => realFetch(url + rota, {
  method: metodo, headers: { 'Content-Type': 'application/json', cookie },
  body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
}).then(async r => ({ status: r.status, ...(await r.json()) }))
const ticket = async id => (await api('/api/state', null, 'GET')).state.tickets.find(t => t.id === id)
const auditoria = async id => (await api(`/api/auditoria/${id}`, null, 'GET')).conversa
const esperar = ms => new Promise(r => setTimeout(r, ms))

/* ---------- IA simulada: classificação roteirizada + escritor que OBEDECE ao prompt ---------- */
const fila = []
globalThis.fetch = async (u, o) => {
  const alvo = String(u)
  if (!/anthropic/.test(alvo)) return realFetch(u, o)
  const corpo = JSON.parse(o.body)
  const sys = corpo.system ?? ''
  const responder = dados => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(dados) }], usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  if (!sys.includes('acao_proposta')) {
    return responder(fila.shift() ?? {
      intencao: 'reclamacao', motivo: 'tamanho', produtos: ['Polo Premium (Schwarz / L)'],
      ajustes: [{ produto: 'Polo Premium (Schwarz / L)', ajuste: 'pequeno' }], situacaoEntrega: 'nenhuma',
      endereco: '', resumo: 'produto ficou pequeno', idioma: 'de', idiomaConfiavel: true, spam: false,
    })
  }
  // escritor: monta o texto com o que o PROMPT exige (prazo, cupom, percentual, ação)
  const titulo = sys.match(/AÇÃO DESTA RESPOSTA — ([^\n]+):/)?.[1] ?? ''
  const aceita = sys.match(/Opção aceita pelo cliente e aprovada pelo lojista: ([^\n]+)/)?.[1] ?? ''
  const acao = (aceita || titulo).toLowerCase()
  const pct = sys.match(/Reembolso de (\d+)% = ([\d,]+ €)/)
  const cup = sys.match(/Cupom de (\d+)%: código (\w+)\. Use EXATAMENTE/)
  const prazo = sys.match(/Prazo do envio expresso: ([^.]+)\./)?.[1]
  const frases = ['Hallo!']
  if (/troca/.test(acao)) frases.push('Wir bieten Ihnen einen kostenlosen Umtausch an.')
  if (/reenvio|enviar/.test(acao)) frases.push('Wir senden das Paket erneut.')
  if (/reembolso/.test(acao) || pct) frases.push(pct ? `Wir bieten eine Rückerstattung von ${pct[1]}% (${pct[2]}) an.` : 'Wir bieten eine Rückerstattung an.')
  if (cup) frases.push(`Gutschein: ${cup[2]} (${cup[1]}%).`)
  if (/cancel/.test(acao)) frases.push('Die Bestellung wird storniert.')
  if (/quais produtos/.test(sys)) frases.push('Welchen Artikel meinen Sie?')
  if (/pequeno ou grande/i.test(sys)) frases.push('Ist es zu klein oder zu groß?')
  if (/rua e número/.test(sys)) frases.push('Bitte Straße und Hausnummer.')
  if (/3 a 14 dias/.test(sys)) frases.push('Das Geld ist in 3 bis 14 Tagen wieder da.')
  if (prazo) frases.push(`Lieferzeit ${prazo}.`)
  frases.push('Möchten Sie das annehmen?')
  return responder({ resposta: frases.join(' '), acao_proposta: sys.match(/"acao_proposta" deve ser exatamente "([^"]+)"/)?.[1] ?? null, idioma: 'de' })
}

before(async () => {
  servidor = await import('../server/index.js')
  await esperar(2000)
  const login = await realFetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@teste.local', senha: 'senha-teste-1234' }) })
  assert.equal(login.status, 200, 'login de teste')
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
})
after(async () => { globalThis.fetch = realFetch; await servidor.encerrar(); try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

const simular = (extra = {}) => api('/api/simular-email', { de: 'c1@web.de', nome: 'C1', assunto: 'Bestellung #1', corpo: 'Das Polo ist zu klein.', lojaId: 'loja1', ...extra })

/* =================================================================== */

test('sequência real: cliente → classificação → decisão → rascunho → validação → agendamento', async () => {
  const r = await simular()
  assert.ok(r.ok, 'simulação criou a conversa')
  const id = r.ticket.id
  const c = await auditoria(id)
  const tipos = c.eventos.map(e => e.tipo)
  for (const esperado of ['cliente_recebido', 'ia_classificou', 'motor_decidiu', 'rascunho_gerado', 'rascunho_validado']) {
    assert.ok(tipos.includes(esperado), 'falta o evento ' + esperado + ' — ' + tipos.join(',') + ' | ' + c.eventos.filter(e => e.situacao === 'bloqueado').map(e => e.resumo).join(' / '))
  }
  assert.ok(tipos.indexOf('ia_classificou') < tipos.indexOf('motor_decidiu'), 'a classificação vem antes da decisão')
  assert.ok(tipos.indexOf('motor_decidiu') < tipos.indexOf('rascunho_gerado'), 'a decisão vem antes do rascunho')
  // o que a IA entendeu está registrado de forma estruturada
  assert.equal(c.classificacao.intencao, 'reclamacao')
  assert.deepEqual(c.classificacao.produtos, ['Polo Premium (Schwarz / L)'])
  assert.equal(c.classificacao.idioma, 'de')
  // a decisão é do servidor e explica a fase
  assert.equal(c.decisao.jornada, 'tamanho')
  assert.ok(c.decisao.faseUnicaPermitida)
  assert.match(String(c.decisao.explicacao), /Próxima fase permitida pelo mapa/)
  assert.match(c.passos, /IA classificou → servidor escolheu a fase → resposta validada/)
  globalThis.__idBase = id
})

test('o rascunho aparece como agendado ou aguardando, NUNCA como enviado', async () => {
  const c = await auditoria(globalThis.__idBase)
  const rascunho = c.mensagens.find(m => m.chave === 'rascunho')
  assert.ok(rascunho, 'o rascunho está na linha do tempo')
  assert.notEqual(rascunho.situacao, 'enviada')
  assert.equal(rascunho.naoEnviado, true)
  assert.ok(['agendada', 'rascunho', 'bloqueada'].includes(rascunho.situacao))
  // e o checklist calculado pelo servidor acompanha
  assert.ok(c.checklist, 'há checklist')
  assert.equal(c.checklist.itens.length, 16)
  assert.equal(c.checklist.enviado, false)
})

test('a cadência de 3 minutos aparece no mínimo de envio da primeira resposta', async () => {
  const c = await auditoria(globalThis.__idBase)
  assert.ok(c.cadencia.minimo, 'o mínimo está registrado')
  const t = await ticket(globalThis.__idBase)
  const diferenca = Date.parse(c.cadencia.minimo) - Date.parse(t.data)
  assert.ok(Math.abs(diferenca - 180_000) < 5_000, `primeira resposta: 3 min (veio ${diferenca} ms)`)
  const agendado = c.eventos.find(e => e.tipo === 'envio_agendado')
  if (agendado) assert.equal(agendado.dados.minimoEnvio, c.cadencia.minimo)
})

test('fase só aparece confirmada depois do envio real, e o envio gera email_enviado', async () => {
  const id = globalThis.__idBase
  const antes = await auditoria(id)
  assert.ok(!antes.eventos.some(e => e.tipo === 'fase_confirmada'), 'nada confirmado antes do envio')
  assert.equal(antes.faseAtual, null)
  const t = await ticket(id)
  const r = await api(`/api/tickets/${id}/aprovar`, { texto: t.rascunho, origem: 'ia' })
  assert.equal(r.status, 200, 'envio pelo canal simulado: ' + (r.erro ?? ''))
  const depois = await auditoria(id)
  const tipos = depois.eventos.map(e => e.tipo)
  assert.ok(tipos.includes('envio_iniciado'))
  assert.ok(tipos.includes('email_enviado'))
  assert.ok(tipos.includes('fase_confirmada'))
  assert.ok(tipos.indexOf('email_enviado') < tipos.indexOf('fase_confirmada'), 'a fase é confirmada DEPOIS do envio')
  assert.ok(depois.faseAtual, 'agora a fase existe')
  const enviado = depois.eventos.find(e => e.tipo === 'email_enviado')
  assert.equal(enviado.dados.enviado, true)
  assert.equal(enviado.dados.checklist.enviado, true)
  assert.equal(enviado.dados.checklist.itens.length, 16)
})

test('falha no canal NÃO cria email_enviado e a fase não avança', async () => {
  const anterior = process.env.ATENDO_SMTP_FAKE
  const r0 = await simular({ de: 'c2@web.de', nome: 'C2', assunto: 'Bestellung #2' })
  const id = r0.ticket.id
  const t = await ticket(id)
  process.env.ATENDO_SMTP_FAKE = 'falha'
  try {
    const r = await api(`/api/tickets/${id}/aprovar`, { texto: t.rascunho, origem: 'ia' })
    assert.notEqual(r.status, 200, 'o envio tinha de falhar')
  } finally { process.env.ATENDO_SMTP_FAKE = anterior }
  const c = await auditoria(id)
  const tipos = c.eventos.map(e => e.tipo)
  assert.ok(tipos.includes('envio_falhou'), 'a falha foi registrada')
  assert.ok(!tipos.includes('email_enviado'), 'nenhum e-mail foi dado como enviado')
  assert.ok(!tipos.includes('fase_confirmada'), 'a fase não avançou')
  const falha = c.mensagens.find(m => m.situacao === 'falha')
  assert.ok(falha, 'a falha aparece na linha do tempo')
  assert.equal(falha.naoEnviado, true)
})

test('cupom inválido: o rascunho fica bloqueado na auditoria e não vira mensagem enviada', async () => {
  // a loja perde a conferência do cupom de 15%
  const st = (await api('/api/state', null, 'GET')).state
  const l = st.lojas.find(x => x.id === 'loja1')
  await api('/api/lojas', { id: 'loja1', cupons: { ...l.cupons, 15: 'TROCADO15' } })
  fila.push({ intencao: 'pede_troca', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'nao gostou', idioma: 'de', idiomaConfiavel: true, spam: false })
  const r0 = await simular({ de: 'c3@web.de', nome: 'C3', assunto: 'Bestellung #3', corpo: 'Die Qualität ist schlecht.' })
  const id = r0.ticket.id
  const c = await auditoria(id)
  const bloqueio = c.eventos.find(e => e.tipo === 'rascunho_bloqueado')
  assert.ok(bloqueio, 'o bloqueio foi registrado: ' + c.eventos.map(e => e.tipo).join(','))
  assert.equal(bloqueio.situacao, 'bloqueado')
  assert.match(bloqueio.resumo, /cupom de 15%/i)
  assert.equal(c.selo, 'bloqueado')
  assert.ok(!c.mensagens.some(m => m.situacao === 'enviada'), 'nada foi enviado')
  // devolve o cupom conferido para os próximos testes
  await api('/api/lojas', { id: 'loja1', cupons: { ...l.cupons, 15: 'DANKE15' } })
  await api('/api/lojas/loja1/testar-cupons', {})
})

test('resposta manual aparece como "Você" e fica registrada', async () => {
  const r0 = await simular({ de: 'c4@web.de', nome: 'C4', assunto: 'Bestellung #4' })
  const id = r0.ticket.id
  const t = await ticket(id)
  const r = await api(`/api/tickets/${id}/aprovar`, { texto: t.rascunho, origem: 'manual', confirmarAlteracao: true })
  assert.equal(r.status, 200, r.erro ?? '')
  const c = await auditoria(id)
  assert.ok(c.eventos.some(e => e.tipo === 'respondido_manualmente'))
  const minha = c.mensagens.find(m => m.rotuloOrigem === 'Você')
  assert.ok(minha, 'a mensagem aparece como sua')
  assert.equal(minha.lado, 'direita')
})

test('HTML malicioso do e-mail volta como TEXTO, nunca como HTML executável', async () => {
  const veneno = '<img src=x onerror="window.__invadido=1"><script>alert(1)</script> Das Polo ist zu klein.'
  const r0 = await simular({ de: 'c5@web.de', nome: '<b>C5</b>', assunto: 'Bestellung #5', corpo: veneno })
  const c = await auditoria(r0.ticket.id)
  const cliente = c.mensagens.find(m => m.origem === 'cliente')
  assert.ok(cliente.corpo.includes('<script>'), 'o texto original é preservado como dado')
  // a auditoria nunca devolve html pronto: só string, e a tela escapa
  for (const m of c.mensagens) assert.ok(!('html' in m))
  const bruto = JSON.stringify(c)
  assert.ok(!bruto.includes('dangerouslySetInnerHTML'))
})

test('atualizar não duplica eventos (chave idempotente)', async () => {
  const id = globalThis.__idBase
  const antes = await auditoria(id)
  for (let i = 0; i < 3; i++) await auditoria(id) // "atualização automática"
  const depois = await auditoria(id)
  assert.equal(depois.eventos.length, antes.eventos.length, 'a leitura não cria evento')
  const chaves = depois.eventos.map(e => e.chave)
  assert.equal(new Set(chaves).size, chaves.length, 'nenhuma chave repetida')
})

test('marcar como revisado muda só os metadados: fase, mensagem e envio continuam iguais', async () => {
  const id = globalThis.__idBase
  const antes = await ticket(id)
  const r = await api(`/api/auditoria/${id}/revisao`, { resultado: 'problema', observacao: 'conferir o prazo' })
  assert.equal(r.status, 200)
  const depois = await ticket(id)
  assert.equal(depois.auditoriaRevisao.resultado, 'problema')
  assert.equal(depois.auditoriaRevisao.observacao, 'conferir o prazo')
  assert.ok(depois.auditoriaRevisao.por)
  // nada do atendimento mudou
  assert.equal(depois.status, antes.status)
  assert.equal(depois.resposta, antes.resposta)
  assert.equal(depois.respondidoEm, antes.respondidoEm)
  assert.equal(depois.enviaEm, antes.enviaEm)
  assert.deepEqual(depois.atendimentoNovo.historicoEtapas, antes.atendimentoNovo.historicoEtapas)
  assert.equal(depois.atendimentoNovo.etapa, antes.atendimentoNovo.etapa)
  assert.equal(depois.relatorioDia, antes.relatorioDia)
  // e o número de eventos não muda
  assert.equal((depois.auditoriaIA ?? []).length, (antes.auditoriaIA ?? []).length)
})

test('atendimento clássico: sem checklist do mapa, com o aviso, e só aparece quando pedido', async () => {
  const r0 = await api('/api/simular-email', { de: 'c6@web.de', nome: 'C6', assunto: 'Order #6', corpo: 'Hello, where is my order?', lojaId: 'loja2' })
  assert.ok(r0.ok)
  const id = r0.ticket.id
  const semClassico = await api('/api/auditoria?dias=7', null, 'GET')
  assert.ok(!semClassico.conversas.some(c => c.ticketId === id), 'clássico fora por padrão')
  const comClassico = await api('/api/auditoria?dias=7&classico=true', null, 'GET')
  assert.ok(comClassico.conversas.some(c => c.ticketId === id), 'clássico aparece quando pedido')
  const c = await auditoria(id)
  assert.equal(c.motor, 'classico')
  assert.equal(c.checklist, null, 'clássico não recebe checklist do mapa')
  assert.equal(c.aviso, 'Atendimento clássico — não usa o motor de etapas')
})

test('conversa anterior à auditoria não ganha dados inventados', async () => {
  // ticket antigo do novo, sem nenhum evento gravado
  const st = (await api('/api/state', null, 'GET')).state
  assert.ok(st.tickets.length)
  const r = await api('/api/auditoria?dias=90', null, 'GET')
  assert.ok(r.ok)
  // a lista marca quem não tem auditoria detalhada
  for (const c of r.conversas) {
    if (c.semAuditoriaDetalhada) assert.equal(c.selo, 'sem_dados')
  }
})

test('isolamento: a API só devolve conversas do workspace, com a loja do ticket', async () => {
  const r = await api('/api/auditoria?dias=90&classico=true', null, 'GET')
  assert.ok(r.conversas.every(c => ['loja1', 'loja2'].includes(c.lojaId)))
  const soLoja2 = await api('/api/auditoria?dias=90&classico=true&loja=loja2', null, 'GET')
  assert.ok(soLoja2.conversas.every(c => c.lojaId === 'loja2'))
  // sem sessão não há auditoria
  const semLogin = await realFetch(url + '/api/auditoria')
  assert.equal(semLogin.status, 401)
  const semLoginConversa = await realFetch(url + `/api/auditoria/${globalThis.__idBase}`)
  assert.equal(semLoginConversa.status, 401)
})

test('a API é paginada e começa nos últimos 7 dias', async () => {
  const r = await api('/api/auditoria?dias=7&porPagina=5', null, 'GET')
  assert.equal(r.filtros.dias, 7)
  assert.equal(r.filtros.porPagina, 5)
  assert.ok(r.conversas.length <= 5)
  assert.ok(typeof r.total === 'number')
  assert.ok(r.atualizadoEm)
  assert.deepEqual(filtrosValidos(r.filtros), true)
})
const filtrosValidos = f => [7, 30, 90].includes(f.dias) && f.pagina >= 1
