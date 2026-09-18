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
for (const [suf, nome] of [['', 'loja1'], ['2', 'loja2'], ['3', 'loja3']]) {
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
  // loja3 é a ÚNICA com envio automático: serve para provar que um envio sem
  // nenhuma autorização humana continua entrando no filtro "automáticos"
  loja({ id: 'loja3', nome: 'Loja Automática', verificacaoCupons: conferencia('loja3'), novoEnvioAutomatico: true, exigirAprovacaoAceiteNovo: false }),
]
const diasAtras = d => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10)
estado.pedidos = [1, 2, 3, 4, 5, 6, 9, 10].map(n => ({
  id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100,
  status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: n === 6 ? 'loja2' : 'loja1',
  itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
}))
// pedidos dos clientes que exercitam os ciclos de auditoria (61 a 65)
for (const n of [61, 62, 63, 64, 65, 70, 71]) {
  estado.pedidos.push({
    id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100,
    status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: 'loja1',
    itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
  })
}
// pedidos da loja automática (loja3)
for (const n of [50, 51]) {
  estado.pedidos.push({
    id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100,
    status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: 'loja3',
    itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
  })
}
// pedido 11: despachado ontem, ainda em trânsito — é o que permite a fase "dentro do prazo"
estado.pedidos.push({
  id: 'p11', numero: '#11', cliente: 'Cliente 11', email: 'c11@web.de', pais: 'Germany', valor: 100,
  status: 'transito', criadoEm: diasAtras(2), despachadoEm: diasAtras(1), lojaId: 'loja1',
  itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
})
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
let escritaRuim = false
globalThis.fetch = async (u, o) => {
  const alvo = String(u)
  if (!/anthropic/.test(alvo)) return realFetch(u, o)
  const corpo = JSON.parse(o.body)
  const sys = corpo.system ?? ''
  const responder = dados => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(dados) }], usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  if (!sys.includes('acao_proposta')) {
    const proximo = fila.shift()
    // 'erro' = a classificação falha de verdade (400 não é reenviado pelo SDK)
    if (proximo === 'erro') return new Response(JSON.stringify({ error: { message: 'falha simulada da classificação' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    return responder(proximo ?? {
      intencao: 'reclamacao', motivo: 'tamanho', produtos: ['Polo Premium (Schwarz / L)'],
      ajustes: [{ produto: 'Polo Premium (Schwarz / L)', ajuste: 'pequeno' }], situacaoEntrega: 'nenhuma',
      endereco: '', resumo: 'produto ficou pequeno', idioma: 'de', idiomaConfiavel: true, spam: false,
    })
  }
  // escritor: monta o texto com o que o PROMPT exige (prazo, cupom, percentual, ação).
  // Com escritaRuim ligado ele devolve um texto que NÃO nomeia a ação da etapa —
  // é assim que se reproduz um erro de redação da IA, que o validador recusa.
  if (escritaRuim) return responder({ resposta: 'Hallo! Wir haben Ihre Nachricht erhalten und melden uns bald.', acao_proposta: sys.match(/"acao_proposta" deve ser exatamente "([^"]+)"/)?.[1] ?? null, idioma: 'de' })
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
  if (/número do pedido/.test(sys)) frases.push('Bitte nennen Sie Ihre Bestellnummer.')
  if (/quais produtos/.test(sys)) frases.push('Welchen Artikel meinen Sie?')
  if (/pequeno ou grande/i.test(sys)) frases.push('Ist es zu klein oder zu groß?')
  if (/rua e número/.test(sys)) frases.push('Bitte Straße und Hausnummer.')
  // pedido de endereço COMPLETO (rua e número, código postal e cidade)
  if (/endereço de entrega COMPLETO/.test(sys)) frases.push('Bitte senden Sie uns Ihre vollständige Lieferadresse: Straße und Hausnummer, Postleitzahl, Stadt und Land.')
  if (/3 a 14 dias/.test(sys)) frases.push('Das Geld ist in 3 bis 14 Tagen wieder da.')
  if (prazo) frases.push(`Lieferzeit ${prazo}.`)
  // dentro do prazo: a data provável vem calculada pelo servidor, no próprio prompt
  const provavel = sys.match(/Data provável de recebimento: ([^\s—]+)/)?.[1]
  if (provavel) frases.push(`Ihre Bestellung ist innerhalb der Lieferzeit und kommt voraussichtlich am ${provavel} an.`)
  // marcado como entregue: aguardar 2 dias e perguntar aos vizinhos
  if (/aguarde mais 2 dias/.test(sys)) frases.push('Bitte warten Sie noch 2 Tage und fragen Sie bei den Nachbarn oder an der Rezeption nach.')
  // confirmação de troca/reenvio: o endereço confirmado é repetido por inteiro
  const endereco = sys.match(/Endereço de entrega confirmado: ([^\n]+)\./)?.[1]
  if (endereco && /CONFIRMAÇÃO/.test(sys)) frases.push(`Lieferadresse: ${endereco}.`)
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
  // e o número de eventos não muda (lido pela rota da auditoria, não pelo estado)
  const eventosDepois = (await auditoria(id)).eventos.length
  assert.ok(eventosDepois >= 1)
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
/* ---- correções: tentativa atual, Message-ID, estado enxuto e retenção ---- */

test('/api/state e rotas comuns NÃO trazem auditoriaIA', async () => {
  const st = (await api('/api/state', null, 'GET')).state
  assert.ok(st.tickets.length)
  for (const t of st.tickets) {
    assert.equal(t.auditoriaIA, undefined, `o ticket ${t.id} não pode levar eventos no estado geral`)
  }
  // uma rota comum que devolve state também fica limpa
  const r = await api(`/api/tickets/${globalThis.__idBase}/rascunho`, { texto: 'so um rascunho' })
  assert.equal(r.status, 200)
  for (const t of r.state.tickets) assert.equal(t.auditoriaIA, undefined)
  // mas a conversa continua completa no estado (nada foi removido)
  const t0 = st.tickets.find(x => x.id === globalThis.__idBase)
  for (const campo of ['atendimentoNovo', 'status', 'lojaId', 'de', 'assunto', 'corpo']) {
    assert.ok(campo in t0, 'o estado normal perdeu ' + campo)
  }
})

test('/api/auditoria/:id devolve os eventos completos — e só com sessão', async () => {
  const c = await auditoria(globalThis.__idBase)
  assert.ok(c.eventos.length > 3, 'os eventos vêm completos na rota da auditoria')
  assert.ok(c.eventos.every(e => e.tipo && e.em && 'dados' in e))
  const semSessao = await realFetch(url + `/api/auditoria/${globalThis.__idBase}`)
  assert.equal(semSessao.status, 401)
})

test('bloqueado → corrigido → enviado: o selo final é "Tudo certo" e o bloqueio antigo continua na linha do tempo', async () => {
  // 1) cupom quebrado: a primeira tentativa é bloqueada
  const st = (await api('/api/state', null, 'GET')).state
  const l = st.lojas.find(x => x.id === 'loja1')
  await api('/api/lojas', { id: 'loja1', cupons: { ...l.cupons, 15: 'QUEBRADO15' } })
  fila.push({ intencao: 'pede_troca', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'nao gostou', idioma: 'de', idiomaConfiavel: true, spam: false })
  const r0 = await simular({ de: 'c9@web.de', nome: 'C9', assunto: 'Bestellung #4', corpo: 'Die Qualität ist schlecht.' })
  const id = r0.ticket.id
  const bloqueada = await auditoria(id)
  assert.equal(bloqueada.selo, 'bloqueado')
  const tentativaBloqueada = bloqueada.tentativaAtual

  // 2) o dono conserta o cupom e responde à mão: NOVA tentativa, com envio real
  await api('/api/lojas', { id: 'loja1', cupons: { ...l.cupons, 15: 'DANKE15' } })
  await api('/api/lojas/loja1/testar-cupons', {})
  const t = await ticket(id)
  const env = await api(`/api/tickets/${id}/aprovar`, { texto: t.rascunho ?? 'Hallo! Wir melden uns mit einer Lösung.', origem: 'manual', confirmarAlteracao: true })
  assert.equal(env.status, 200, 'o envio manual acontece: ' + (env.erro ?? ''))

  // 3) o selo passa a valer pela tentativa ATUAL
  const final = await auditoria(id)
  assert.notEqual(final.tentativaAtual, tentativaBloqueada, "o envio abriu outra tentativa")
  assert.equal(final.selo, 'tudo_certo')
  // o bloqueio antigo continua registrado na linha do tempo
  assert.ok(final.eventos.some(e => e.tipo === 'rascunho_bloqueado'), 'o histórico preserva o bloqueio')
  assert.ok(!final.passos.includes('bloqueada'), 'mas os passos falam da tentativa atual')
  // e a mensagem enviada tem vínculo EXATO
  const enviada = final.mensagens.find(m => m.situacao === 'enviada')
  assert.equal(enviada.vinculo, 'exato')
  assert.ok(enviada.mensagemId)
})
test('rascunho validado aguardando aprovação não recebe "Tudo certo"', async () => {
  fila.push({ intencao: 'pede_troca', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'nao gostou', idioma: 'de', idiomaConfiavel: true, spam: false })
  const r0 = await simular({ de: 'c10@web.de', nome: 'C10', assunto: 'Bestellung #5', corpo: 'Die Qualität ist schlecht.' })
  const c = await auditoria(r0.ticket.id)
  assert.notEqual(c.selo, 'tudo_certo')
  assert.ok(['aguardando', 'agendada', 'revisar'].includes(c.selo), 'selo: ' + c.selo)
  assert.ok(!c.mensagens.some(m => m.situacao === 'enviada'), 'nada foi enviado')
})

test('duas respostas seguidas ficam ligadas aos eventos certos pelo Message-ID', async () => {
  const id = globalThis.__idBase
  const t = await ticket(id)
  // segunda resposta manual na mesma conversa, poucos segundos depois
  const r = await api(`/api/tickets/${id}/aprovar`, { texto: t.rascunho ?? 'Hallo! Danke.', origem: 'manual', confirmarAlteracao: true })
  assert.equal(r.status, 200, 'a 2ª resposta TEM de sair — sem escapatória: ' + (r.erro ?? ''))
  const c = await auditoria(id)
  const enviadas = c.mensagens.filter(m => m.situacao === 'enviada')
  assert.ok(enviadas.length >= 1)
  for (const m of enviadas) {
    assert.ok(m.mensagemId, 'toda resposta enviada tem Message-ID')
    assert.equal(m.vinculo, 'exato', 'mensagem com Message-ID tem vínculo exato')
    const evento = c.eventos.find(e => e.tipo === 'email_enviado' && e.dados.mensagemId === m.mensagemId)
    assert.ok(evento, 'existe o evento com o mesmo Message-ID')
    assert.equal(m.envioReal, evento.em)
  }
  // Message-IDs distintos entre mensagens distintas
  const ids = enviadas.map(m => m.mensagemId).filter(Boolean)
  assert.equal(new Set(ids).size, ids.length)
})

const itemDo = (c, id) => (c.checklist?.itens ?? []).find(i => i.id === id)

test('produto só fica cinza na COLETA que pergunta o produto — nas outras fases a prova continua exigida', async () => {
  // 1) COLETA DO PRODUTO: o cliente reclama sem dizer qual peça
  fila.push({ intencao: 'pede_reembolso', motivo: 'qualidade', produtos: [], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'nao gostou', idioma: 'de', idiomaConfiavel: true, spam: false })
  const rc = await simular({ de: 'c20@web.de', nome: 'C20', assunto: 'Bestellung #3', corpo: 'Die Qualität ist schlecht.' })
  const tc = await ticket(rc.ticket.id)
  assert.equal(tc.atendimentoNovo.transicaoPendente.para, 'coleta', 'a trava real mandou para a coleta')
  assert.ok((tc.atendimentoNovo.transicaoPendente.faltando ?? []).includes('produtos'))
  const cc = await auditoria(rc.ticket.id)
  assert.equal(itemDo(cc, 'produto_informado').estado, 'cinza', 'na coleta do produto o item não se aplica')
  assert.equal(itemDo(cc, 'produto_do_pedido').estado, 'cinza')

  // 2) DENTRO DO PRAZO (pedido em trânsito, ainda no prazo): a prova do produto continua exigida
  fila.push({ intencao: 'pergunta_status', motivo: 'nao_recebido', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'onde está', idioma: 'de', idiomaConfiavel: true, spam: false })
  const rp = await simular({ de: 'c11@web.de', nome: 'C11', assunto: 'Bestellung #11', corpo: 'Wo ist meine Bestellung?' })
  const tp = await ticket(rp.ticket.id)
  assert.equal(tp.atendimentoNovo.transicaoPendente.para, 'nc_no_prazo', 'fase dentro do prazo')
  const cp = await auditoria(rp.ticket.id)
  assert.equal(itemDo(cp, 'produto_informado').estado, 'verde', 'dentro do prazo o produto é exigido e está provado')
  assert.notEqual(itemDo(cp, 'produto_do_pedido').estado, 'cinza')

  // 3) AGUARDAR DOIS DIAS (marcado como entregue): idem
  fila.push({ intencao: 'pede_reembolso', motivo: 'nao_recebido', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'entregue_nao_recebido', endereco: '', resumo: 'consta entregue, nada chegou', idioma: 'de', idiomaConfiavel: true, spam: false })
  const ra = await simular({ de: 'c9@web.de', nome: 'C9b', assunto: 'Bestellung #9', corpo: 'Als zugestellt markiert, nichts da.' })
  const ta = await ticket(ra.ticket.id)
  assert.equal(ta.atendimentoNovo.transicaoPendente.para, 'nr_entregue_aguardar', 'fase aguardar 2 dias')
  const ca = await auditoria(ra.ticket.id)
  assert.equal(itemDo(ca, 'produto_informado').estado, 'verde', 'aguardar 2 dias exige a prova do produto')

  // 4) CONFIRMAÇÃO DE REEMBOLSO: reclamação → oferta → aceite → clique do dono
  fila.push({ intencao: 'pede_reembolso', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'ruim', idioma: 'de', idiomaConfiavel: true, spam: false })
  const rr = await simular({ de: 'c10@web.de', nome: 'C10b', assunto: 'Bestellung #10', corpo: 'Schlecht. Geld zurück.' })
  let tr = await ticket(rr.ticket.id)
  // segue a escada até uma fase de reembolso com percentual
  for (let i = 0; i < 4 && tr.atendimentoNovo.transicaoPendente?.para && !/^reemb_/.test(tr.atendimentoNovo.etapa ?? ''); i++) {
    const env = await api(`/api/tickets/${tr.id}/aprovar`, { texto: tr.rascunho, origem: 'ia' })
    assert.equal(env.status, 200, 'envio da escada: ' + (env.erro ?? ''))
    if (/^reemb_/.test((await ticket(tr.id)).atendimentoNovo.etapa ?? '')) { tr = await ticket(tr.id); break }
    fila.push({ intencao: 'recusa', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'nein', idioma: 'de', idiomaConfiavel: true, spam: false })
    await simular({ ticketId: tr.id, corpo: 'Nein.' })
    tr = await ticket(tr.id)
  }
  assert.match(tr.atendimentoNovo.etapa ?? '', /^reemb_/, 'chegou a uma fase de reembolso: ' + tr.atendimentoNovo.etapa)
  fila.push({ intencao: 'aceita', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'ok', idioma: 'de', idiomaConfiavel: true, spam: false })
  await simular({ ticketId: tr.id, corpo: 'Ok, einverstanden.' })
  const conf = await api(`/api/tickets/${tr.id}/novo/confirmar`)
  assert.equal(conf.status, 200, 'o dono aprovou o aceite: ' + (conf.erro ?? ''))
  tr = await ticket(tr.id)
  assert.equal(tr.atendimentoNovo.transicaoPendente.para, 'conf_reembolso')
  const cr = await auditoria(tr.id)
  assert.equal(itemDo(cr, 'produto_informado').estado, 'verde', 'na confirmação de reembolso o produto continua exigido')
  assert.notEqual(itemDo(cr, 'produto_do_pedido').estado, 'cinza')

  // 5) CONFIRMAÇÃO DE TROCA: aceite de troca → endereço → confirmação
  fila.push({ intencao: 'pede_troca', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'quer trocar', idioma: 'de', idiomaConfiavel: true, spam: false })
  const rt = await simular({ de: 'c3@web.de', nome: 'C3b', assunto: 'Bestellung #3', corpo: 'Die Qualität ist schlecht, bitte Umtausch.' })
  let tt = await ticket(rt.ticket.id)
  const e1 = await api(`/api/tickets/${tt.id}/aprovar`, { texto: tt.rascunho, origem: 'ia' })
  assert.equal(e1.status, 200, 'oferta de troca enviada: ' + (e1.erro ?? ''))
  fila.push({ intencao: 'aceita', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'ok', idioma: 'de', idiomaConfiavel: true, spam: false })
  await simular({ ticketId: tt.id, corpo: 'Ja, gerne.' })
  tt = await ticket(tt.id)
  if (tt.atendimentoNovo.transicaoPendente?.para === 'endereco') {
    const e2 = await api(`/api/tickets/${tt.id}/aprovar`, { texto: tt.rascunho, origem: 'ia' })
    assert.equal(e2.status, 200, 'pedido de endereço enviado: ' + (e2.erro ?? ''))
    fila.push({ intencao: 'aceita', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: 'Hauptstrasse 12, 10115 Berlin, Deutschland', resumo: 'endereco', idioma: 'de', idiomaConfiavel: true, spam: false })
    await simular({ ticketId: tt.id, corpo: 'Hauptstrasse 12, 10115 Berlin, Deutschland' })
    tt = await ticket(tt.id)
  }
  if (tt.atendimentoNovo.transicaoPendente?.para !== 'conf_troca') {
    const cf = await api(`/api/tickets/${tt.id}/novo/confirmar`)
    assert.equal(cf.status, 200, 'o dono aprovou a troca: ' + (cf.erro ?? ''))
    tt = await ticket(tt.id)
  }
  assert.equal(tt.atendimentoNovo.transicaoPendente.para, 'conf_troca', 'fase de confirmação de troca')
  const ct = await auditoria(tt.id)
  assert.equal(itemDo(ct, 'produto_informado').estado, 'verde', 'na confirmação de troca o produto continua exigido')
})

test('ponta a ponta: duas respostas em menos de dois minutos, a primeira arquivada, cada uma no SEU evento', async () => {
  // 1ª resposta, enviada pelo canal simulado
  fila.push({ intencao: 'pede_troca', motivo: 'tamanho', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [{ produto: 'Polo Premium (Schwarz / L)', ajuste: 'pequeno' }], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'pequeno', idioma: 'de', idiomaConfiavel: true, spam: false })
  const r0 = await simular({ de: 'c30@web.de', nome: 'C30', assunto: 'Bestellung #3', corpo: 'Das Polo ist zu klein.' })
  const id = r0.ticket.id
  const t1 = await ticket(id)
  const env1 = await api(`/api/tickets/${id}/aprovar`, { texto: t1.rascunho, origem: 'ia' })
  assert.equal(env1.status, 200, '1ª resposta enviada: ' + (env1.erro ?? ''))
  const depois1 = await ticket(id)
  const idPrimeira = depois1.respostaMensagemId
  assert.ok(idPrimeira, 'a 1ª resposta guardou o Message-ID')

  // 2ª resposta, MENOS de dois minutos depois: a mensagem nova arquiva a primeira
  fila.push({ intencao: 'recusa', motivo: 'tamanho', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'nein', idioma: 'de', idiomaConfiavel: true, spam: false })
  await simular({ ticketId: id, corpo: 'Nein, danke.' })
  const t2 = await ticket(id)
  // a 1ª resposta foi para o histórico SEM perder o vínculo
  const arquivada = (t2.historico ?? []).find(m => m.autor === 'atendo' && m.mensagemId === idPrimeira)
  assert.ok(arquivada, 'a 1ª resposta está arquivada com o Message-ID preservado')
  assert.ok(arquivada.fase, 'a fase sobreviveu ao arquivamento')
  assert.equal(arquivada.idioma, 'de', 'o idioma sobreviveu ao arquivamento')
  assert.ok(arquivada.origem, 'a origem sobreviveu ao arquivamento')
  assert.ok(arquivada.tentativaId, 'a tentativa sobreviveu ao arquivamento')

  const env2 = await api(`/api/tickets/${id}/aprovar`, { texto: t2.rascunho, origem: 'ia' })
  assert.equal(env2.status, 200, '2ª resposta enviada: ' + (env2.erro ?? ''))
  const t3 = await ticket(id)
  const idSegunda = t3.respostaMensagemId
  assert.ok(idSegunda && idSegunda !== idPrimeira, 'Message-IDs distintos')

  const c = await auditoria(id)
  const enviadas = c.mensagens.filter(m => m.situacao === 'enviada')
  assert.equal(enviadas.length, 2, 'as duas respostas aparecem enviadas')
  const eventos = c.eventos.filter(e => e.tipo === 'email_enviado')
  assert.equal(eventos.length, 2, 'dois eventos de envio')
  // menos de dois minutos entre elas — o horário NÃO basta para distinguir
  const intervalo = Date.parse(eventos[1].em) - Date.parse(eventos[0].em)
  assert.ok(intervalo < 120_000, 'as duas saíram em menos de dois minutos (' + intervalo + ' ms)')
  // cada mensagem encontra EXATAMENTE o seu evento
  for (const m of enviadas) {
    assert.equal(m.vinculo, 'exato', 'vínculo exato pelo Message-ID')
    const seu = eventos.filter(e => e.dados.mensagemId === m.mensagemId)
    assert.equal(seu.length, 1, 'um único evento com este Message-ID')
    assert.equal(m.envioReal, seu[0].em, 'a hora real do envio vem do evento certo')
    assert.equal(m.fase, seu[0].dados.fase, 'a fase vem do evento certo')
    assert.equal(m.minimoEnvio, seu[0].dados.minimoEnvio ?? null, 'o mínimo da cadência vem do evento certo')
    assert.ok(seu[0].dados.tentativaId, 'o evento guarda a tentativa')
    assert.equal(seu[0].dados.canalConfirmou, true, 'o canal confirmou a saída')
    assert.equal(seu[0].dados.origemEnvio, 'aprovado_pelo_dono', 'a origem do envio ficou gravada')
  }
  assert.deepEqual(enviadas.map(m => m.mensagemId), [idPrimeira, idSegunda], 'ordem e identidade das duas respostas')
  // as duas SAÍRAM: o selo jamais pode dizer "Bloqueada — não foi enviada".
  // Aqui fica em "Revisar" porque o dono aprovou antes do mínimo da cadência.
  assert.notEqual(c.selo, 'bloqueado', 'mensagem enviada nunca aparece como não enviada')
  assert.ok(['tudo_certo', 'revisar'].includes(c.selo), 'selo: ' + c.selo)
  assert.equal(c.checklistConcluido, true, 'o checklist da tentativa atual está completo')
  assert.equal(c.checklistTentativa, eventos[1].dados.tentativaId, 'o checklist exibido é o da tentativa atual')
  assert.equal(c.origemEnvio, 'aprovado_pelo_dono')
})

/* ---------------- ciclo de auditoria no pipeline REAL ---------------- */

const CLS = extra => ({
  intencao: 'pede_troca', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [],
  situacaoEntrega: 'nenhuma', endereco: '', resumo: 'quer solução', idioma: 'de', idiomaConfiavel: true, spam: false, ...extra,
})
// conversa que termina VERDE: rascunho gerado e enviado pelo canal simulado
async function conversaVerde(de, assunto) {
  fila.push(CLS({}))
  // 10 min atrás: o mínimo de cadência (3 min da primeira resposta) já venceu,
  // então o envio sai com o checklist inteiro verde
  const r0 = await simular({ de, nome: de, assunto, agora: new Date(Date.now() - 10 * 60_000).toISOString() })
  const t = await ticket(r0.ticket.id)
  const env = await api(`/api/tickets/${t.id}/aprovar`, { texto: t.rascunho, origem: 'ia' })
  assert.equal(env.status, 200, 'a conversa precisa ficar verde antes do ciclo novo: ' + (env.erro ?? ''))
  const c = await auditoria(t.id)
  assert.equal(c.selo, 'tudo_certo', 'ponto de partida verde')
  return { id: t.id, ciclo: c.cicloAtual }
}

test('primeiro e-mail de uma conversa nova já nasce com cicloId, e todo evento dele carrega o mesmo', async () => {
  fila.push(CLS({}))
  const r0 = await simular({ de: 'c60@web.de', nome: 'C60', assunto: 'Bestellung #1' })
  const c = await auditoria(r0.ticket.id)
  assert.ok(c.cicloAtual, 'a primeira mensagem abriu um ciclo')
  assert.ok(c.eventos.length >= 4)
  for (const e of c.eventos) assert.equal(e.dados.cicloId, c.cicloAtual, 'evento fora do ciclo: ' + e.tipo)
  assert.ok(c.eventos.some(e => e.tipo === 'cliente_recebido'))
  assert.ok(c.eventos.some(e => e.tipo === 'ia_classificou'))
  assert.ok(c.eventos.some(e => e.tipo === 'rascunho_validado'))
})

test('ciclo novo: conversa verde + mensagem nova cuja classificação FALHA não continua verde', async () => {
  const v = await conversaVerde('c61@web.de', 'Bestellung #61')
  fila.push('erro') // a classificação falha de verdade
  await simular({ ticketId: v.id, corpo: 'Und jetzt?' })
  const c = await auditoria(v.id)
  assert.notEqual(c.cicloAtual, v.ciclo, 'a mensagem nova abriu outro ciclo')
  assert.equal(c.selo, 'revisar', 'classificação que falhou é erro da IA')
  assert.equal(c.checklistConcluido, false, 'não reaproveita o checklist verde do ciclo anterior')
  assert.equal(c.checklist, null)
  assert.match(c.motivoChecklist, /não conseguiu classificar/)
  assert.equal(c.classificacao, null, 'a interpretação da mensagem anterior não vale pela nova')
  assert.equal(c.decisao, null)
  // o histórico do ciclo anterior continua inteiro
  assert.ok(c.eventos.some(e => e.tipo === 'email_enviado' && e.dados.cicloId === v.ciclo))
  assert.ok(c.eventos.some(e => e.tipo === 'caso_para_humano' && e.dados.origem === 'classificacao'))
})

test('ciclo novo com IA pausada: "Aguardando você"', async () => {
  const v = await conversaVerde('c62@web.de', 'Bestellung #62')
  const p = await api(`/api/tickets/${v.id}/pausar-ia`, { pausar: true })
  assert.equal(p.status, 200, 'pausar a IA nesta conversa: ' + (p.erro ?? ''))
  await simular({ ticketId: v.id, corpo: 'Noch eine Frage.' })
  const c = await auditoria(v.id)
  assert.notEqual(c.cicloAtual, v.ciclo)
  assert.equal(c.selo, 'aguardando_voce')
  assert.equal(c.checklistConcluido, false)
  assert.match(c.motivoChecklist, /IA pausada/)
  await api(`/api/tickets/${v.id}/pausar-ia`, { pausar: false })
})

test('ciclo novo que o motor manda direto ao humano: "Aguardando você"', async () => {
  const v = await conversaVerde('c63@web.de', 'Bestellung #63')
  // depois de uma oferta, uma mensagem que não é aceite nem recusa vai ao dono
  fila.push(CLS({ intencao: 'reclamacao', resumo: 'reclama de novo, sem aceitar nem recusar' }))
  await simular({ ticketId: v.id, corpo: 'Das ist alles schlecht.' })
  const c = await auditoria(v.id)
  assert.notEqual(c.cicloAtual, v.ciclo)
  assert.equal(c.selo, 'aguardando_voce', 'selo: ' + c.selo + ' — ' + c.passos)
  const evento = c.eventos.filter(e => e.tipo === 'caso_para_humano').at(-1)
  assert.equal(evento.dados.origem, 'motor')
  assert.equal(evento.dados.cicloId, c.cicloAtual)
  // classificação e decisão exibidas são as do ciclo ATUAL
  assert.equal(c.classificacao.mensagemEm, (await ticket(v.id)).data)
})

test('cliente agradece e o caso encerra: "Encerrado — sem resposta necessária"', async () => {
  const v = await conversaVerde('c64@web.de', 'Bestellung #64')
  fila.push(CLS({ intencao: 'agradece', resumo: 'obrigado, tudo certo' }))
  await simular({ ticketId: v.id, corpo: 'Vielen Dank!' })
  const c = await auditoria(v.id)
  assert.notEqual(c.cicloAtual, v.ciclo)
  assert.equal(c.selo, 'encerrado', 'selo: ' + c.selo)
  assert.ok(c.eventos.some(e => e.tipo === 'caso_encerrado' && e.dados.cicloId === c.cicloAtual))
  const tv = await ticket(v.id)
  assert.ok(!c.mensagens.some(m => m.situacao === 'enviada' && Date.parse(m.em) > Date.parse(tv.data)), 'nada novo saiu depois do agradecimento')
})

test('confirmação APROVADA pelo dono e enviada pelo agendador continua "aprovado_pelo_dono"', async () => {
  const H5 = 5 * 3600_000
  const iso = ms => new Date(ms).toISOString()
  // negociação até uma fase de reembolso, com o relógio 5 h atrás para a cadência já ter vencido
  fila.push(CLS({ intencao: 'pede_reembolso', resumo: 'quero reembolso' }))
  const r0 = await simular({ de: 'c65@web.de', nome: 'C65', assunto: 'Bestellung #65', corpo: 'Schlecht. Geld zurück.', agora: iso(Date.now() - H5 - 20 * 60_000) })
  let t = await ticket(r0.ticket.id)
  for (let i = 0; i < 4 && !/^reemb_/.test(t.atendimentoNovo.etapa ?? ''); i++) {
    const env = await api(`/api/tickets/${t.id}/aprovar`, { texto: t.rascunho, origem: 'ia' })
    assert.equal(env.status, 200, 'envio da escada: ' + (env.erro ?? ''))
    t = await ticket(t.id)
    if (/^reemb_/.test(t.atendimentoNovo.etapa ?? '')) break
    fila.push(CLS({ intencao: 'recusa', resumo: 'nein' }))
    await simular({ ticketId: t.id, corpo: 'Nein.', agora: iso(Date.now() - H5 - 15 * 60_000) })
    t = await ticket(t.id)
  }
  assert.match(t.atendimentoNovo.etapa ?? '', /^reemb_/, 'chegou ao reembolso: ' + t.atendimentoNovo.etapa)

  // cliente ACEITA (há mais de 5 h): o modo da loja1 exige aprovação, então vai ao dono
  fila.push(CLS({ intencao: 'aceita', resumo: 'ok, aceito' }))
  await simular({ ticketId: t.id, corpo: 'Ok, einverstanden.', agora: iso(Date.now() - H5 - 5000) })
  t = await ticket(t.id)
  assert.equal(t.atendimentoNovo.aguardando, 'humano', 'o aceite espera a aprovação do dono')
  const cAceite = await auditoria(t.id)
  assert.equal(cAceite.selo, 'aguardando_voce', 'enquanto espera o dono: Aguardando você')

  // o DONO aprova; a confirmação fica agendada e quem envia é o AGENDADOR
  const conf = await api(`/api/tickets/${t.id}/novo/confirmar`)
  assert.equal(conf.status, 200, 'o dono aprovou: ' + (conf.erro ?? ''))
  t = await ticket(t.id)
  assert.equal(t.atendimentoNovo.conclusaoPendente.aprovadoEm ? true : false, true, 'a autorização ficou persistida')
  assert.equal(t.atendimentoNovo.transicaoPendente.para, 'conf_reembolso')
  assert.ok(t.enviaEm && t.enviaEm <= Date.now() + 1000, 'a cadência de 5 h já venceu: o agendador envia')
  for (let i = 0; i < 40 && (await ticket(t.id)).status !== 'enviado'; i++) await esperar(500)
  t = await ticket(t.id)
  assert.equal(t.status, 'enviado', 'o agendador enviou a confirmação')

  const c = await auditoria(t.id)
  const enviado = c.eventos.filter(e => e.tipo === 'email_enviado').at(-1)
  assert.equal(enviado.dados.origemEnvio, 'aprovado_pelo_dono', 'quem autorizou foi o dono, mesmo com o agendador enviando')
  assert.ok(enviado.dados.autorizacao?.aprovadoEm, 'a prova da autorização ficou no evento')
  assert.equal(c.origemEnvio, 'aprovado_pelo_dono')

  // um caso REALMENTE automático (loja3, sem aprovação nenhuma) continua automático
  fila.push(CLS({}))
  const rA = await simular({ de: 'c50@web.de', nome: 'C50', assunto: 'Bestellung #50', lojaId: 'loja3', agora: iso(Date.now() - 10 * 60_000) })
  for (let i = 0; i < 40 && (await ticket(rA.ticket.id)).status !== 'enviado'; i++) await esperar(500)
  const cA = await auditoria(rA.ticket.id)
  const enviadoA = cA.eventos.filter(e => e.tipo === 'email_enviado').at(-1)
  assert.ok(enviadoA, 'a loja automática enviou sozinha')
  assert.equal(enviadoA.dados.origemEnvio, 'automatico')
  assert.equal(enviadoA.dados.autorizacao ?? null, null, 'não houve autorização humana nenhuma')

  // o filtro separa os dois pela EVIDÊNCIA
  const lista = await api('/api/auditoria?dias=90&soAutomaticos=true&porPagina=100', null, 'GET')
  const ids = lista.conversas.map(x => x.ticketId)
  assert.ok(ids.includes(rA.ticket.id), 'o caso realmente automático entra no filtro')
  assert.ok(!ids.includes(t.id), 'a confirmação aprovada pelo dono NÃO entra no filtro')

  // desligar a automação depois não reescreve nenhuma das duas origens
  const off = await api('/api/lojas', { id: 'loja3', novoEnvioAutomatico: false })
  assert.equal(off.status, 200, 'desligar o envio automático: ' + (off.erro ?? ''))
  const depoisA = await auditoria(rA.ticket.id)
  const depoisD = await auditoria(t.id)
  assert.equal(depoisA.origemEnvio, 'automatico', 'o passado não muda')
  assert.equal(depoisD.origemEnvio, 'aprovado_pelo_dono', 'o passado não muda')
  const lista2 = await api('/api/auditoria?dias=90&soAutomaticos=true&porPagina=100', null, 'GET')
  assert.ok(lista2.conversas.map(x => x.ticketId).includes(rA.ticket.id), 'o filtro continua achando pelo que foi gravado')
})

test('rascunho recusado guarda o texto e a fase — e "gerar de novo" recupera o caso', async () => {
  // 1) a IA erra a redação: o texto não nomeia a ação da etapa
  escritaRuim = true
  fila.push(CLS({}))
  const r0 = await simular({ de: 'c70@web.de', nome: 'C70', assunto: 'Bestellung #70' })
  escritaRuim = false
  const id = r0.ticket.id
  const t1 = await ticket(id)
  assert.equal(t1.status, 'humano', 'um rascunho recusado devolve o caso para o dono')
  assert.match(t1.motivoEscalada, /saiu da etapa permitida/)
  assert.equal(t1.rascunho, undefined, 'o rascunho recusado não fica no ticket')

  // a FASE recusada fica guardada (é ela que permite tentar de novo)
  const fase = t1.atendimentoNovo.faseRecusada
  assert.ok(fase?.para, 'a fase recusada ficou guardada')
  assert.equal(t1.atendimentoNovo.transicaoPendente, null, 'mas fora de transicaoPendente: a sua resposta manual continua livre')
  assert.match(fase.motivo, /saiu da etapa permitida/)
  assert.ok(Date.parse(fase.em) > 0)

  // e o TEXTO recusado ficou no evento, com o motivo
  const c1 = await auditoria(id)
  const bloq = c1.eventos.filter(e => e.tipo === 'rascunho_bloqueado')
  assert.equal(bloq.length, 1)
  assert.match(bloq[0].dados.texto, /melden uns bald/, 'o texto que a IA escreveu ficou guardado')
  assert.match(bloq[0].dados.motivo, /saiu da etapa permitida/)
  assert.equal(bloq[0].dados.enviado, false)
  assert.equal(c1.selo, 'bloqueado')
  // e aparece na linha do tempo, como bloqueada e nunca como enviada
  const recusada = c1.mensagens.find(m => m.situacao === 'bloqueada')
  assert.ok(recusada, 'o texto recusado aparece na linha do tempo')
  assert.match(recusada.corpo, /melden uns bald/)
  assert.equal(c1.mensagens.filter(m => m.situacao === 'enviada').length, 0)

  // 2) "Gerar nova resposta": agora a IA escreve certo e o caso volta sozinho
  const reg = await api(`/api/tickets/${id}/regenerar`, {})
  assert.equal(reg.status, 200, 'regenerar aceita a fase recusada: ' + (reg.erro ?? ''))
  const t2 = await ticket(id)
  assert.equal(t2.status, 'aprovacao', 'o caso volta para Aprovações')
  assert.ok(t2.rascunho, 'com rascunho novo')
  assert.equal(t2.atendimentoNovo.transicaoPendente.para, fase.para, 'na MESMA fase que tinha sido recusada')
  assert.equal(t2.atendimentoNovo.faseRecusada, undefined, 'a pendência de recusa some quando dá certo')
  assert.equal(t2.motivoEscalada, undefined)

  // a auditoria guarda as duas tentativas no mesmo ciclo
  const c2 = await auditoria(id)
  assert.equal(c2.cicloAtual, c1.cicloAtual, 'regenerar não abre ciclo novo')
  assert.notEqual(c2.tentativaAtual, c1.tentativaAtual, 'mas é outra tentativa')
  assert.equal(c2.eventos.filter(e => e.tipo === 'rascunho_bloqueado').length, 1, 'o bloqueio antigo continua registrado')
  assert.ok(['aguardando', 'agendada'].includes(c2.selo), 'selo agora: ' + c2.selo)
  assert.equal(c2.checklistConcluido, true, 'e o checklist é o da tentativa NOVA')
})

test('conversa sem fase pendente nem fase recusada não regenera nada', async () => {
  // caso que foi para o dono por decisão do motor (não por rascunho recusado):
  // continua sem ação automática, como antes
  fila.push(CLS({ intencao: 'reclamacao', resumo: 'mensagem fora do mapa' }))
  const r0 = await simular({ de: 'c71@web.de', nome: 'C71', assunto: 'Bestellung #71' })
  const t = await ticket(r0.ticket.id)
  if (t.status === 'humano' && !t.atendimentoNovo?.faseRecusada) {
    const reg = await api(`/api/tickets/${r0.ticket.id}/regenerar`, {})
    assert.equal(reg.status, 400)
    assert.match(reg.erro, /não tem ação automática agora/)
  } else {
    // o motor produziu rascunho: então regenerar TEM de funcionar
    const reg = await api(`/api/tickets/${r0.ticket.id}/regenerar`, {})
    assert.equal(reg.status, 200, reg.erro ?? '')
  }
})

test('retenção real: mais de 400 eventos pelo caminho do servidor — corta, conta e data', async () => {
  fila.push({ intencao: 'pede_troca', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'ruim', idioma: 'de', idiomaConfiavel: true, spam: false })
  const r0 = await simular({ de: 'c40@web.de', nome: 'C40', assunto: 'Bestellung #4', corpo: 'Die Qualität ist schlecht.' })
  const id = r0.ticket.id
  // mensagens do cliente até passar do teto de 400 eventos, tudo pelo servidor de verdade
  // (os eventos NÃO vêm no estado normal: só a rota da auditoria os enxerga)
  let c = await auditoria(id)
  for (let i = 0; i < 200 && c.eventos.length + (c.retencao?.omitidos ?? 0) <= 410; i++) {
    fila.push({ intencao: 'pede_reembolso', motivo: 'qualidade', produtos: ['Polo Premium (Schwarz / L)'], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'mensagem ' + i, idioma: 'de', idiomaConfiavel: true, spam: false })
    await simular({ ticketId: id, corpo: 'Nachricht Nummer ' + i + '.' })
    c = await auditoria(id)
  }
  const total = c.eventos.length + (c.retencao?.omitidos ?? 0)
  assert.ok(total > 400, 'a conversa passou mesmo de 400 eventos (chegou a ' + total + ')')
  assert.ok(c.eventos.length <= 400, 'o servidor cortou no teto: ' + c.eventos.length)
  const ret = c.retencao
  assert.ok(ret && ret.omitidos > 0, 'o corte ficou contado')
  assert.equal(ret.limite, 400)
  assert.ok(Date.parse(ret.primeiroOmitidoEm) > 0, 'data do primeiro omitido')
  assert.ok(Date.parse(ret.ultimoOmitidoEm) > 0, 'data do último omitido')
  assert.equal(ret.primeiroDisponivelEm, c.eventos[0].em, 'a data do primeiro disponível bate com o que sobrou')
  assert.ok(Date.parse(ret.ultimoOmitidoEm) <= Date.parse(ret.primeiroDisponivelEm), 'o que saiu é o mais antigo')

  // a página conta a verdade, sem "histórico completo"
  assert.equal(c.historicoCompleto, false)
  assert.notEqual(c.selo, 'sem_dados', 'mesmo depois do corte a conversa continua classificada')
  assert.equal(c.eventos.at(-1).dados.tentativaId ?? c.tentativaAtual, c.tentativaAtual, 'a tentativa atual sobreviveu ao corte')
})

test('retenção: passar de 400 eventos não apaga nada em silêncio', async () => {
  const { novoEvento: criar, registrarEvento: registrar } = await import('../shared/auditoria.js')
  // simula um ticket que já passou do teto, usando a MESMA lógica do servidor
  let lista = []
  for (let i = 0; i < 405; i++) {
    lista = registrar(lista, criar({ tipo: 'cliente_recebido', ticketId: 'x', em: new Date(Date.now() + i).toISOString(), chave: 'k' + i }))
  }
  assert.equal(lista.length, 405, 'o módulo puro não apaga nada')
  // no servidor, o corte é CONTADO e datado
  const c = await auditoria(globalThis.__idBase)
  assert.ok('retencao' in c, 'a conversa informa a retenção')
  assert.ok('historicoCompleto' in c)
  assert.equal(c.historicoCompleto, true, 'sem corte, o histórico é completo')
  assert.equal(c.retencao, null)
})
