// Consulta GraphQL dos cupons (codeDiscountNodeByCode): classificação de cada
// resposta possível da Shopify. O fetch é substituído por um dublê — nenhuma
// chamada real de rede, nenhuma loja tocada.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
const { verificarCuponsShopify, ESCOPOS_PADRAO } = await import('../server/shopify.js')

const CX = { loja: 'teste.myshopify.com', token: 'shpat_teste', modo: 'oauth' }
const AGORA = Date.parse('2026-09-18T12:00:00.000Z')
const fetchReal = globalThis.fetch
let respostas = {} // código → resposta do dublê
const chamadas = []

const corpo = dados => ({ ok: true, status: 200, json: async () => dados })
const basico = extra => ({
  data: {
    codeDiscountNodeByCode: {
      id: 'gid://shopify/DiscountCodeNode/1',
      codeDiscount: {
        __typename: 'DiscountCodeBasic', title: 'Cupom', status: 'ACTIVE',
        startsAt: '2026-01-01T00:00:00Z', endsAt: null, usageLimit: null, asyncUsageCount: 0,
        customerGets: { value: { __typename: 'DiscountPercentage', percentage: 0.15 } },
        ...extra,
      },
    },
  },
})

before(() => {
  globalThis.fetch = async (url, opcoes) => {
    const { variables } = JSON.parse(opcoes.body)
    chamadas.push({ url: String(url), code: variables.code })
    const r = respostas[variables.code]
    if (!r) throw new Error('dublê sem resposta para ' + variables.code)
    return typeof r === 'function' ? r() : corpo(r)
  }
})
after(() => { globalThis.fetch = fetchReal })

test('a consulta usa GraphQL na versão configurada da API', async () => {
  respostas = { OK15: basico() }
  const r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'OK15' }], { agora: AGORA })
  assert.equal(r.permissao, true)
  assert.match(chamadas.at(-1).url, /\/admin\/api\/[\d-]+\/graphql\.json$/)
  assert.equal(r.itens[0].situacao, 'ok')
  assert.equal(r.itens[0].valor, 15)
  assert.equal(r.em, new Date(AGORA).toISOString())
})

test('read_discounts ausente: permissao=false com o recado de republicar o app e reconectar', async () => {
  respostas = { X: () => ({ ok: false, status: 403, text: async () => 'forbidden', json: async () => ({}) }) }
  const r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'X' }], { agora: AGORA })
  assert.equal(r.permissao, false)
  assert.match(r.erro, /read_discounts/)
  assert.match(r.erro, /Publique a nova configuração|reconecte/i)
  assert.deepEqual(r.itens, [])
  // ACCESS_DENIED vem com 200 + errors[]
  respostas = { Y: { errors: [{ message: 'Access denied for codeDiscountNodeByCode field', extensions: { code: 'ACCESS_DENIED' } }] } }
  const r2 = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'Y' }], { agora: AGORA })
  assert.equal(r2.permissao, false)
  assert.match(r2.erro, /read_discounts/)
})

test('código inexistente na loja', async () => {
  respostas = { SUMIU: { data: { codeDiscountNodeByCode: null } } }
  const r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'SUMIU' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'inexistente')
  assert.match(r.itens[0].detalhe, /nenhum cupom/i)
})

test('percentual divergente (a Shopify diz outro valor)', async () => {
  respostas = { MEIO: basico({ customerGets: { value: { __typename: 'DiscountPercentage', percentage: 0.2 } } }) }
  const r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'MEIO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'percentual_divergente')
  assert.match(r.itens[0].detalhe, /vale 20%/)
  assert.equal(r.itens[0].valor, 20)
})

test('desconto em valor fixo é incompatível', async () => {
  respostas = { FIXO: basico({ customerGets: { value: { __typename: 'DiscountAmount', amount: { amount: '10.0' } } } }) }
  const r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'FIXO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'incompativel')
  assert.match(r.itens[0].detalhe, /valor fixo/i)
})

test('BXGY, frete grátis e desconto de app são incompatíveis', async () => {
  const tipos = [
    ['BXGY', 'DiscountCodeBxgy', /compre-e-leve/i],
    ['FRETE', 'DiscountCodeFreeShipping', /frete grátis/i],
    ['APP', 'DiscountCodeApp', /criado por app/i],
  ]
  for (const [codigo, typename, esperado] of tipos) {
    respostas = { [codigo]: { data: { codeDiscountNodeByCode: { id: 'gid://1', codeDiscount: { __typename: typename, title: 't', status: 'ACTIVE', startsAt: '2026-01-01T00:00:00Z', endsAt: null } } } } }
    const r = await verificarCuponsShopify(CX, [{ pct: 15, codigo }], { agora: AGORA })
    assert.equal(r.itens[0].situacao, 'incompativel', codigo)
    assert.match(r.itens[0].detalhe, esperado, codigo)
  }
})

test('expirado, agendado, esgotado e inativo', async () => {
  respostas = { VELHO: basico({ endsAt: '2026-08-01T00:00:00Z', status: 'EXPIRED' }) }
  let r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'VELHO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'expirado')
  assert.match(r.itens[0].detalhe, /2026-08-01/)

  respostas = { FUTURO: basico({ startsAt: '2026-12-01T00:00:00Z', status: 'SCHEDULED' }) }
  r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'FUTURO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'nao_iniciado')
  assert.match(r.itens[0].detalhe, /2026-12-01/)

  respostas = { CHEIO: basico({ usageLimit: 5, asyncUsageCount: 5 }) }
  r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'CHEIO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'esgotado')

  respostas = { PARADO: basico({ status: 'INACTIVE' }) }
  r = await verificarCuponsShopify(CX, [{ pct: 15, codigo: 'PARADO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'inativo')
  assert.match(r.itens[0].detalhe, /INACTIVE/)
})

test('percentual em fração (0.15) e em inteiro (15) dão o mesmo resultado', async () => {
  respostas = { FRACAO: basico({ customerGets: { value: { __typename: 'DiscountPercentage', percentage: 0.4 } } }) }
  let r = await verificarCuponsShopify(CX, [{ pct: 40, codigo: 'FRACAO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'ok')
  respostas = { INTEIRO: basico({ customerGets: { value: { __typename: 'DiscountPercentage', percentage: 40 } } }) }
  r = await verificarCuponsShopify(CX, [{ pct: 40, codigo: 'INTEIRO' }], { agora: AGORA })
  assert.equal(r.itens[0].situacao, 'ok')
})

test('os cinco cupons do fluxo passam numa tacada', async () => {
  const pcts = [15, 25, 30, 35, 40]
  respostas = Object.fromEntries(pcts.map(p => [`C${p}`, basico({ customerGets: { value: { __typename: 'DiscountPercentage', percentage: p / 100 } } })]))
  const r = await verificarCuponsShopify(CX, pcts.map(p => ({ pct: p, codigo: `C${p}` })), { agora: AGORA })
  assert.equal(r.permissao, true)
  assert.equal(r.itens.length, 5)
  assert.deepEqual(r.itens.map(i => i.situacao), ['ok', 'ok', 'ok', 'ok', 'ok'])
  assert.deepEqual(r.itens.map(i => i.valor), pcts)
})

test('sem conexão nada é inventado, e read_discounts está nos escopos padrão', async () => {
  const r = await verificarCuponsShopify(null, [{ pct: 15, codigo: 'X' }], { agora: AGORA })
  assert.equal(r.permissao, false)
  assert.match(r.erro, /não conectada/i)
  assert.deepEqual(r.itens, [])
  assert.match(ESCOPOS_PADRAO, /read_discounts/)
})
