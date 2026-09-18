// NODE_ENV=production com ATENDO_SIMULAR=1: a variável NÃO pode falsificar
// prontidão. Shopify, sincronização e cupons continuam sendo conferidos de
// verdade, e a rota de simulação de e-mail não existe sem ATENDO_SIMULAR_EMAIL.
// Nenhuma loja é ativada e nenhuma mensagem real é enviada.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-producao-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8792'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
// o cenário do problema: alguém deixou ATENDO_SIMULAR=1 no Railway
process.env.ATENDO_SIMULAR = '1'
process.env.NODE_ENV = 'production'
delete process.env.ATENDO_SIMULAR_EMAIL
delete process.env.DATABASE_URL
delete process.env.ATENDO_LIBERAR_AUTOENVIO
process.env.EMAIL_USER = 'loja1@teste.local'; process.env.EMAIL_PASS = 'senha-falsa'
process.env.EMAIL_IMAP_HOST = 'imap.invalido.test'; process.env.EMAIL_SMTP_HOST = 'smtp.invalido.test'

const { hashSenha } = await import('../server/auth.js')
const { novoEstado } = await import('../server/db.js')

const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
const estado = novoEstado()
estado.config.automacaoAtiva = true
estado.lojas = [{
  id: 'loja1', nome: 'Loja Produção', ativa: true, moeda: 'EUR', idioma: 'de',
  modoAtendimento: 'classico', cupons: { ...CUPONS }, prazoEntrega: { min: 5, max: 12, processamento: 3 },
}]
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

const url = 'http://localhost:8792'
let cookie = ''
let servidor = null
const api = (rota, corpo, metodo = 'POST') => fetch(url + rota, {
  method: metodo, headers: { 'Content-Type': 'application/json', cookie },
  body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
}).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))

before(async () => {
  servidor = await import('../server/index.js')
  await new Promise(r => setTimeout(r, 1500))
  const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@teste.local', senha: 'senha-teste-1234' }) })
  assert.equal(login.status, 200, 'login de teste')
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
})
after(async () => { await servidor.encerrar(); try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

/* =================================================================== */

test('ATENDO_SIMULAR=1 em produção NÃO dá Shopify nem sincronização por prontas', async () => {
  const r = await api('/api/lojas/loja1/modo', null, 'GET')
  assert.equal(r.status, 200)
  const chaves = r.prontidao.faltando.map(f => f.chave)
  assert.ok(chaves.includes('shopify'), 'Shopify continua sendo exigida: ' + JSON.stringify(chaves))
  assert.equal(r.prontidao.pronto, false)
  assert.equal(r.prontidao.automatico.pronto, false)
  // a sincronização também não é dada por feita
  assert.equal(r.sincronizacao, null)
})

test('cupom não vira "ok" sozinho em produção: sem conferência, a situação é não verificado', async () => {
  const st = (await api('/api/state', null, 'GET')).state
  const pr = st.lojas.find(l => l.id === 'loja1').prontidaoNovo
  for (const pct of [15, 25, 30, 35, 40]) {
    const c = pr.cupons.find(x => x.pct === pct)
    assert.equal(c.situacao, 'nao_verificado', `cupom de ${pct}% não pode aparecer como conferido`)
  }
  assert.equal(pr.cupons.find(c => c.pct === 10).situacao, 'reserva')
  assert.ok(JSON.stringify(pr.automatico.faltando).includes('não verificado'))
})

test('ativar o modo novo em produção sem Shopify é recusado, com a lista do que falta', async () => {
  const r = await api('/api/lojas/loja1/modo', { modo: 'novo', confirmar: true })
  assert.equal(r.status, 400)
  assert.match(r.erro, /Shopify conectada/i)
  assert.ok(r.faltando.some(f => f.chave === 'shopify'))
  // e a loja continua no clássico
  const st = (await api('/api/state', null, 'GET')).state
  assert.equal(st.lojas.find(l => l.id === 'loja1').modoAtendimento, 'classico')
})

test('sem ATENDO_SIMULAR_EMAIL a rota de simulação de e-mail não existe em produção', async () => {
  const r = await api('/api/simular-email', { de: 'x@web.de', nome: 'X', assunto: 'a', corpo: 'b', lojaId: 'loja1' })
  assert.equal(r.status, 404, 'a rota de ensaio não pode existir em produção sem a variável própria')
})

test('"Testar cupons" em produção sem Shopify devolve não verificado, nunca ok', async () => {
  const r = await api('/api/lojas/loja1/testar-cupons', {})
  assert.equal(r.status, 200)
  assert.equal(r.verificacao.permissao, false, 'sem conexão não há permissão para conferir')
  assert.match(r.verificacao.erro ?? '', /Shopify não conectada/i)
  assert.equal(r.verificacao.lojaId, 'loja1')
  for (const c of r.cupons.filter(x => x.usadoPeloFluxo)) {
    assert.notEqual(c.situacao, 'ok', `cupom de ${c.pct}% não pode ficar verde`)
  }
})
