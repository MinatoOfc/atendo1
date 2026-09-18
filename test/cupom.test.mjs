// TRAVA ÚNICA DO CUPOM no pipeline REAL (servidor de verdade, IA e canal
// simulados): um código não conferido na Shopify desta loja, dentro das 24 h,
// não entra no prompt, no rascunho, no "só o texto", na aprovação manual, no
// autoenvio, na confirmação do aceite nem no e-mail. Nenhuma loja é ativada e
// nenhuma mensagem real é enviada.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-cupom-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8793'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
process.env.ATENDO_SIMULAR = '1'
// a simulação de integração só vale em teste
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
const agoraIso = (h = 0) => new Date(Date.now() - h * 3600_000).toISOString()
/** conferência da Shopify gravada na loja (o que a produção guarda). */
const conferencia = (lojaId, patch = {}, horas = 1) => ({
  permissao: true, erro: null, em: agoraIso(horas), lojaId,
  itens: Object.entries(CUPONS).map(([pct, codigo]) => ({
    pct: Number(pct), codigo, valor: Number(pct), situacao: 'ok', detalhe: `${pct}% ativo na Shopify`,
    ...(patch[pct] ?? {}),
  })),
})

const estado = estadoInicial()
estado.config.automacaoAtiva = true
estado.config.atrasoMinutos = 0.05
const lojaBase = extra => ({
  ativa: true, moeda: 'EUR', idioma: 'auto', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z',
  cupons: { ...CUPONS }, prazoEntrega: { min: 5, max: 12, processamento: 3 }, ...extra,
})
estado.lojas = [
  // todos os cupons conferidos: o caminho feliz continua funcionando
  lojaBase({ id: 'loja1', nome: 'Loja OK', verificacaoCupons: conferencia('loja1') }),
  // o cupom de 15% não existe e o de 35% expirou na Shopify desta loja
  lojaBase({ id: 'loja2', nome: 'Loja Cupom Ruim', verificacaoCupons: conferencia('loja2', {
    15: { situacao: 'inexistente', detalhe: 'nenhum cupom com esse código nesta loja' },
    35: { situacao: 'expirado', detalhe: 'expirou em 2026-08-01' },
  }) }),
  // autoenvio LIGADO e cupom de 15% expirado: nada pode sair sozinho
  lojaBase({ id: 'loja3', nome: 'Loja Autoenvio', novoEnvioAutomatico: true, verificacaoCupons: conferencia('loja3', { 15: { situacao: 'expirado', detalhe: 'expirou em 2026-08-01' } }) }),
  // conferência de 25 h atrás: vencida, mesmo com todos os códigos "ok"
  lojaBase({ id: 'loja4', nome: 'Loja Vencida', verificacaoCupons: conferencia('loja4', {}, 25) }),
]
estado.pedidos = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
  id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100,
  status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: n >= 7 ? 'loja4' : n >= 5 ? 'loja3' : n >= 3 ? 'loja2' : 'loja1',
  itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
}))

// OFERTA: fala do cupom e do percentual, nunca do código (o código só vai na confirmação)
const RASCUNHO_COM_CUPOM = 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Sie erhalten einen Gutschein über 15%. Lieferzeit 4 bis 11 Tage. Möchten Sie das annehmen?'
const RASCUNHO_REVELANDO_CODIGO = 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Gutschein: DANKE15 (15%). Lieferzeit 4 bis 11 Tage. Möchten Sie das annehmen?'
/** ticket do novo parado na fase qual_troca (que usa o cupom de 15%). */
const comCupom = (id, lojaId, extra = {}) => ({
  id, nome: 'C', de: `${id}@web.de`, assunto: 'Bestellung #1', corpo: 'Schlecht.', data: '2026-09-01T10:00:00.000Z',
  lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId, historico: [],
  motor: 'novo', motorAtendimento: 'novo', primeiroEmailEm: '2026-09-01T10:00:00.000Z',
  rascunho: RASCUNHO_COM_CUPOM, rascunhoGerado: RASCUNHO_COM_CUPOM, geradoPorIA: true,
  atendimentoNovo: {
    versao: 1, fluxo: 'qualidade', etapa: null, produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true,
    motivo: 'qualidade', historicoEtapas: [], transicaoPendente: { para: 'qual_troca', mensagem: 'schlecht', faltando: [] },
    aguardando: 'envio', acaoAceita: null, idioma: 'de', rascunhoGerado: RASCUNHO_COM_CUPOM, rascunhoIdioma: 'de',
  },
  ...extra,
})

estado.tickets = [
  comCupom('ok1', 'loja1'),                    // loja com cupom conferido
  comCupom('ok2', 'loja1'),                    // idem, para o caso do código revelado cedo
  comCupom('ruim1', 'loja2'),                  // cupom inexistente na Shopify
  comCupom('ruim2', 'loja2'),                  // idem, para o autoenvio
  comCupom('ruim3', 'loja2'),                  // idem, para "só o texto"
  comCupom('vencido1', 'loja4'),               // conferência de 25 h: vencida
  // autoenvio já agendado e vencido: o laço do agendador vai tentar enviar
  comCupom('auto1', 'loja3', { enviaEm: Date.now() - 1000 }),
  // aceite aguardando a aprovação do dono, na fase de cupom de 35%
  {
    ...comCupom('aceite1', 'loja2'),
    status: 'humano',
    atendimentoNovo: {
      versao: 1, fluxo: 'qualidade', etapa: 'qual_cupom_35', produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true,
      motivo: 'qualidade', historicoEtapas: [], transicaoPendente: null, aguardando: 'humano', acaoAceita: 'qual_cupom_35', idioma: 'de',
    },
  },
]
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

const url = 'http://localhost:8793'
let cookie = ''
let servidor = null
const api = (rota, corpo, metodo = 'POST') => fetch(url + rota, {
  method: metodo, headers: { 'Content-Type': 'application/json', cookie },
  body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
}).then(async r => ({ status: r.status, ...(await r.json()) }))
const ticket = async id => (await api('/api/state', null, 'GET')).state.tickets.find(t => t.id === id)
const loja = async id => (await api('/api/state', null, 'GET')).state.lojas.find(l => l.id === id)
const esperar = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
  servidor = await import('../server/index.js')
  await esperar(2000)
  const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@teste.local', senha: 'senha-teste-1234' }) })
  assert.equal(login.status, 200, 'login de teste')
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
})
after(async () => { await servidor.encerrar(); try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

/* =================================================================== */

test('cupom inexistente na Shopify: a regeneração não gera rascunho e o caso vai para Aprovações', async () => {
  const r = await api('/api/tickets/ruim1/regenerar', { instrucao: '' })
  assert.equal(r.status, 400)
  assert.match(r.erro, /cupom de 15%/i)
  assert.match(r.erro, /não serve|não existe/i)
  const t = await ticket('ruim1')
  // o rascunho anterior não é substituído por um texto com cupom inválido
  assert.equal(t.rascunho, RASCUNHO_COM_CUPOM, 'nada novo foi gerado')
})

test('"somente o texto" também bloqueia — não é atalho para o cupom não conferido', async () => {
  const r = await api('/api/tickets/ruim3/regenerar', { instrucao: '', somenteTexto: true })
  assert.equal(r.status, 400)
  assert.match(r.erro, /Não gerado/)
  assert.match(r.erro, /cupom de 15%/i)
  assert.equal(r.texto, undefined, 'nenhum texto com cupom inválido é devolvido')
})

test('aprovação manual não passa: nem com o dono clicando o código inválido sai', async () => {
  const r = await api('/api/tickets/ruim1/aprovar', { texto: RASCUNHO_COM_CUPOM, origem: 'ia' })
  assert.equal(r.status, 400)
  assert.match(r.erro, /Não enviado/)
  assert.match(r.erro, /cupom de 15%/i)
  const t = await ticket('ruim1')
  assert.equal(t.status, 'aprovacao', 'a conversa não foi marcada como enviada')
  assert.equal(t.respondidoEm, undefined)
})

test('confirmação do aceite com cupom inválido não sai', async () => {
  const r = await api('/api/tickets/aceite1/novo/confirmar', {})
  assert.equal(r.status, 400)
  assert.match(r.erro, /Não confirmado/)
  assert.match(r.erro, /cupom de 35%/i)
  const t = await ticket('aceite1')
  assert.equal(t.atendimentoNovo.aguardando, 'humano', 'o aceite continua com o dono')
  assert.equal(t.rascunho, RASCUNHO_COM_CUPOM, 'nenhuma confirmação foi escrita')
})

test('autoenvio com cupom inválido não envia: o agendador manda o caso para o dono', async () => {
  // o ticket auto1 nasceu com enviaEm vencido numa loja com autoenvio LIGADO
  await esperar(3500) // uma volta do agendador
  const t = await ticket('auto1')
  assert.equal(t.respondidoEm, undefined, 'nada saiu sozinho')
  assert.equal(t.enviaEm, undefined, 'o agendamento foi cancelado')
  assert.equal(t.status, 'humano', 'o caso foi para o dono')
  assert.match(t.motivoEscalada ?? '', /cupom de 15%/i)
  assert.match(t.atendimentoNovo.envioBloqueado ?? '', /cupom de 15%/i)
})

test('enviarResposta é a última barreira: texto editado à mão com cupom inválido não vira e-mail', async () => {
  const texto = 'Hallo! Gutschein: DANKE15 (15%). Umtausch kostenlos, 4 bis 11 Tage.'
  const r = await api('/api/tickets/ruim1/aprovar', { texto, origem: 'manual', confirmarAlteracao: true })
  assert.equal(r.status, 400)
  assert.match(r.erro, /cupom de 15%/i)
  const t = await ticket('ruim1')
  assert.equal(t.respondidoEm, undefined)
  assert.equal((t.historico ?? []).filter(h => h.autor === 'atendo').length, 0, 'nada foi para o histórico')
})

test('conferência vencida (mais de 24 h) bloqueia igual, mesmo com tudo "ok"', async () => {
  const l = await loja('loja4')
  assert.equal(l.verificacaoCupons.itens.every(i => i.situacao === 'ok'), true, 'a conferência antiga dizia ok')
  assert.equal(l.prontidaoNovo.cupons.find(c => c.pct === 15).situacao, 'vencida')
  assert.equal(l.prontidaoNovo.automatico.pronto, false)
  const r = await api('/api/tickets/vencido1/aprovar', { texto: RASCUNHO_COM_CUPOM, origem: 'ia' })
  assert.equal(r.status, 400)
  assert.match(r.erro, /conferido na Shopify/i)
  assert.match(r.erro, /vencida/i)
})

test('cupom conferido: o caminho feliz continua enviando normalmente', async () => {
  const r = await api('/api/tickets/ok1/aprovar', { texto: RASCUNHO_COM_CUPOM, origem: 'ia' })
  assert.equal(r.status, 200, 'com o cupom conferido o envio acontece: ' + (r.erro ?? ''))
  const t = await ticket('ok1')
  assert.ok(t.respondidoEm, 'a resposta saiu')
  assert.match(t.resposta ?? '', /Gutschein/)
  assert.doesNotMatch(t.resposta ?? '', /DANKE15/, 'o código não sai antes do aceite')
})

test('oferta que revela o código do cupom não é enviada, nem com o cupom conferido', async () => {
  const r = await api('/api/tickets/ok2/aprovar', { texto: RASCUNHO_REVELANDO_CODIGO, origem: 'ia' })
  assert.equal(r.status, 400, 'o código entregue antes do aceite bloqueia o envio')
  assert.match(r.erro, /antes de o cliente aceitar/)
  const t = await ticket('ok2')
  assert.equal(t.respondidoEm ?? null, null, 'nada saiu')
})

test('trocar o código apaga a conferência da loja na hora', async () => {
  const antes = await loja('loja1')
  assert.ok(antes.verificacaoCupons, 'a loja tinha conferência')
  const r = await api('/api/lojas', { id: 'loja1', cupons: { ...CUPONS, 15: 'NOVO15' } })
  assert.equal(r.status, 200)
  const depois = await loja('loja1')
  assert.equal(depois.cupons['15'], 'NOVO15')
  assert.equal(depois.verificacaoCupons, null, 'a conferência anterior morreu com a troca do código')
  // e a prontidão automática cai junto
  assert.equal(depois.prontidaoNovo.automatico.pronto, false)
  assert.ok(JSON.stringify(depois.prontidaoNovo.automatico.faltando).includes('não verificado'))
})

test('desconectar a Shopify invalida a conferência e a sincronização', async () => {
  const r = await api('/api/shopify/desconectar', { lojaId: 'loja2' })
  assert.equal(r.status, 200)
  const l = await loja('loja2')
  assert.equal(l.verificacaoCupons, null, 'conferência invalidada pela desconexão')
})

test('a rota de simulação de e-mail não mexe na prontidão nem nos cupons', async () => {
  const antes = await loja('loja1')
  const r = await api('/api/simular-email', { de: 'novo@web.de', nome: 'Novo', assunto: 'Frage', corpo: 'Hallo', lojaId: 'loja1' })
  assert.equal(r.status, 200, 'a rota de ensaio existe em teste')
  const depois = await loja('loja1')
  assert.equal(depois.verificacaoCupons, antes.verificacaoCupons)
  assert.deepEqual(depois.prontidaoNovo.automatico.faltando, antes.prontidaoNovo.automatico.faltando)
  assert.equal(depois.novoEnvioAutomatico, antes.novoEnvioAutomatico)
})

test('nenhuma fase passou a usar o cupom de 10%: ele segue só como reserva', async () => {
  const r = await api('/api/lojas/loja1/modo', null, 'GET')
  assert.deepEqual(r.cuponsNecessarios, [15, 25, 30, 35, 40])
  assert.equal(r.cupomReserva, 10)
  const l = await loja('loja1')
  const reserva = l.prontidaoNovo.cupons.find(c => c.pct === 10)
  assert.equal(reserva.usadoPeloFluxo, false)
  assert.equal(reserva.situacao, 'reserva')
})
