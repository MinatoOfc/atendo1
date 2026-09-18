// PRODUÇÃO com ATENDO_SIMULAR=1: a variável tem de ser completamente inofensiva.
// Cada servidor sobe num PROCESSO FILHO de verdade (NODE_ENV=production), com
// todas as variáveis de ensaio ligadas ao mesmo tempo — SMTP falso, registro de
// envios, falha de gravação e queda proposital. Nada disso pode funcionar: o
// envio só passa pelo canal real, a leitura de e-mail real não é pulada e
// nenhuma transição é confirmada por envio simulado.
// Nenhuma loja é ativada e nenhuma mensagem real é enviada (o SMTP aponta para
// um host inválido de propósito).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-prod-canal-'))
const ENVIOS = path.join(DIR, 'envios.log')
const PORTA = 8791
const base = `http://localhost:${PORTA}`

const { hashSenha } = await import('../server/auth.js')
const { novoEstado } = await import('../server/db.js')

const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
const RASCUNHO = 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Lieferzeit 4 bis 11 Tage. Möchten Sie das annehmen?'
const estado = novoEstado()
estado.config.automacaoAtiva = true
estado.config.atrasoMinutos = 0.05
estado.lojas = [{
  id: 'loja1', nome: 'Loja Produção', ativa: true, moeda: 'EUR', idioma: 'de',
  modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', novoEnvioAutomatico: false,
  cupons: { ...CUPONS }, prazoEntrega: { min: 5, max: 12, processamento: 3 },
}]
estado.pedidos = [{
  id: 'p1', numero: '#1', cliente: 'Cliente 1', email: 'c1@web.de', pais: 'Germany', valor: 100,
  status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: 'loja1',
  itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
}]
// fase SEM cupom (tam_troca): o que está em teste aqui é o canal, não a trava de cupom
estado.tickets = [{
  id: 'pr1', nome: 'C1', de: 'c1@web.de', assunto: 'Bestellung #1', corpo: 'Zu klein.', data: '2026-09-01T10:00:00.000Z',
  lido: true, origem: 'cliente', categoria: 'troca', status: 'aprovacao', idioma: 'de', lojaId: 'loja1', historico: [],
  motor: 'novo', motorAtendimento: 'novo', primeiroEmailEm: '2026-09-01T10:00:00.000Z',
  rascunho: RASCUNHO, geradoPorIA: true,
  atendimentoNovo: {
    versao: 1, fluxo: 'tamanho', etapa: null, produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true,
    motivo: 'tamanho_pequeno', ajusteTamanho: { 'Polo Premium (Schwarz / L)': 'pequeno' }, historicoEtapas: [],
    transicaoPendente: { para: 'tam_troca', mensagem: 'zu klein', faltando: [] }, aguardando: 'envio', acaoAceita: null,
    idioma: 'de', rascunhoGerado: RASCUNHO, rascunhoIdioma: 'de',
  },
}]
writeFileSync(path.join(DIR, 'ws-prod.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-prod-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'prod@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-prod-1234'), workspaceId: 'prod' }],
  sessoes: [],
}))

/** TODAS as variáveis de ensaio ligadas — em produção nenhuma pode ter efeito. */
const ambiente = extra => ({
  ...process.env,
  DATA_DIR: DIR, PORT: String(PORTA), ANTHROPIC_API_KEY: 'sk-ant-teste', DATABASE_URL: '',
  NODE_ENV: 'production',
  ATENDO_SIMULAR: '1',
  ATENDO_SMTP_FAKE: 'ok',
  ATENDO_TESTE_ENVIOS: ENVIOS,
  ATENDO_TESTE_FALHA_GRAVACAO: '1',
  ATENDO_TESTE_QUEDA: 'antes',
  ATENDO_LIBERAR_AUTOENVIO: '',
  EMAIL_USER: 'loja1@teste.local', EMAIL_PASS: 'senha-falsa',
  EMAIL_IMAP_HOST: 'imap.invalido.test', EMAIL_SMTP_HOST: 'smtp.invalido.test',
  ...extra,
})

const estadoSalvo = () => JSON.parse(readFileSync(path.join(DIR, 'ws-prod.json'), 'utf8'))
const envios = () => (existsSync(ENVIOS) ? readFileSync(ENVIOS, 'utf8').split('\n').filter(Boolean) : [])
let filho = null
const subir = extra => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['server/index.js'], { cwd: RAIZ, env: ambiente(extra), stdio: ['ignore', 'pipe', 'pipe'] })
  let saida = ''
  const ler = d => { saida += d.toString(); if (/atendo servidor na porta/.test(saida)) resolve({ processo: p, saida: () => saida }) }
  p.stdout.on('data', ler); p.stderr.on('data', ler)
  p.on('exit', code => { if (!/atendo servidor na porta/.test(saida)) reject(new Error(`servidor saiu antes de subir (${code}): ${saida}`)) })
  setTimeout(() => reject(new Error('servidor não subiu: ' + saida)), 30_000)
})
const derrubar = async () => {
  if (!filho) return
  const p = filho.processo; filho = null
  const fim = new Promise(r => p.on('exit', r))
  p.kill(); await fim
}
after(async () => { await derrubar(); try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

const entrar = async () => {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'prod@teste.local', senha: 'senha-prod-1234' }) })
  assert.equal(login.status, 200)
  return login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}
const chamar = (cookie, rota, corpo, metodo = 'POST') => fetch(base + rota, {
  method: metodo, headers: { 'Content-Type': 'application/json', cookie },
  body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
}).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))

/* =================================================================== */

test('produção + ATENDO_SIMULAR=1 + ATENDO_SMTP_FAKE=ok: o envio NÃO é dado como feito', async () => {
  filho = await subir()
  assert.match(filho.saida(), /ATENDO_SIMULAR=1 está configurado FORA de NODE_ENV=test e foi IGNORADO/)
  const cookie = await entrar()
  const r = await chamar(cookie, '/api/tickets/pr1/aprovar', { texto: RASCUNHO, origem: 'ia' })
  assert.notEqual(r.status, 200, 'o canal falso não pode dar o envio por concluído')
  const { tickets } = estadoSalvo()
  const t = tickets.find(x => x.id === 'pr1')
  assert.equal(t.respondidoEm, undefined, 'nada foi marcado como respondido')
  assert.equal(t.resposta, undefined)
  // e o registro de envios simulados nem sequer existe
  assert.deepEqual(envios(), [], 'nenhum envio simulado foi registrado em produção')
  assert.equal(existsSync(ENVIOS), false, 'o arquivo de teste não é criado em produção')
})

test('falha do canal real mantém fase, transição e histórico intactos', async () => {
  const t = estadoSalvo().tickets.find(x => x.id === 'pr1')
  const an = t.atendimentoNovo
  assert.equal(an.etapa, null, 'a fase não avançou')
  assert.equal(an.transicaoPendente?.para, 'tam_troca', 'a transição continua pendente')
  assert.deepEqual(an.historicoEtapas, [], 'nada foi escrito no histórico')
  assert.equal(t.status, 'aprovacao', 'a conversa continua aguardando aprovação')
  assert.equal((t.historico ?? []).length, 0, 'nenhuma mensagem entrou na conversa')
})

test('a queda proposital não dispara em produção: o servidor continua de pé', async () => {
  const cookie = await entrar()
  const r = await chamar(cookie, '/api/state', null, 'GET')
  assert.equal(r.status, 200, 'o processo sobreviveu — ATENDO_TESTE_QUEDA não teve efeito')
  assert.ok(r.state?.tickets?.length)
})

test('a falha de gravação simulada é ignorada: o estado continua sendo salvo', async () => {
  const cookie = await entrar()
  const r = await chamar(cookie, '/api/tickets/pr1/rascunho', { texto: RASCUNHO + ' Danke!' })
  assert.equal(r.status, 200, 'gravar não pode falhar por ATENDO_TESTE_FALHA_GRAVACAO em produção')
  await new Promise(r2 => setTimeout(r2, 2500)) // a gravação é agrupada a cada 1,5 s
  const t = estadoSalvo().tickets.find(x => x.id === 'pr1')
  assert.match(t.rascunho, /Danke!/, 'a gravação aconteceu de verdade')
})

test('produção não pula a leitura dos e-mails reais: a sincronização tenta o IMAP e falha', async () => {
  const cookie = await entrar()
  const r = await chamar(cookie, '/api/sync', {})
  assert.equal(r.status, 500, 'em teste a leitura seria pulada e devolveria 200')
  assert.match(String(r.erro ?? ''), /imap\.invalido\.test|ENOTFOUND|getaddrinfo|EAI_AGAIN|conex/i, 'o erro prova a tentativa real: ' + r.erro)
})

test('sem ATENDO_SIMULAR_EMAIL a rota de injeção não existe; com ela, existe e nada mais muda', async () => {
  let cookie = await entrar()
  const semVar = await chamar(cookie, '/api/simular-email', { de: 'x@web.de', nome: 'X', assunto: 'a', corpo: 'b', lojaId: 'loja1' })
  assert.equal(semVar.status, 404)

  await derrubar()
  filho = await subir({ ATENDO_SIMULAR_EMAIL: '1' })
  cookie = await entrar()
  const comVar = await chamar(cookie, '/api/simular-email', { de: 'novo@web.de', nome: 'Novo', assunto: 'Frage', corpo: 'Hallo', lojaId: 'loja1' })
  assert.equal(comVar.status, 200, 'a rota de injeção é liberada pela variável própria')
  // mas ela NÃO liga o SMTP falso: aprovar continua falhando no canal real
  const envio = await chamar(cookie, '/api/tickets/pr1/aprovar', { texto: RASCUNHO, origem: 'ia' })
  assert.notEqual(envio.status, 200, 'ATENDO_SIMULAR_EMAIL não pode ligar o canal falso')
  assert.deepEqual(envios(), [], 'e continua sem registro de envios simulados')
  // nem impede a leitura dos e-mails reais
  const sync = await chamar(cookie, '/api/sync', {})
  assert.equal(sync.status, 500, 'a leitura real continua sendo tentada')
  // nem mexe na prontidão
  const modo = await chamar(cookie, '/api/lojas/loja1/modo', null, 'GET')
  assert.equal(modo.prontidao.pronto, false)
  assert.ok(modo.prontidao.faltando.some(f => f.chave === 'shopify'))
})
