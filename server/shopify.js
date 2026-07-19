import crypto from 'crypto'

const lojaBruta = (process.env.SHOPIFY_STORE || '').trim()
// Token fixo (apps personalizados antigos). Lojas migradas para o Dev Dashboard
// não têm mais essa opção e usam o fluxo OAuth abaixo.
const tokenFixo = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim()
const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim()
const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim()
const versao = (process.env.SHOPIFY_API_VERSION || '2026-07').trim()
const escopos = (process.env.SHOPIFY_SCOPES || 'read_orders,read_all_orders,read_customers,read_fulfillments,read_products').trim()

// Aceita "loja", "loja.myshopify.com" ou a URL completa colada do navegador
function normalizar(v) {
  const limpo = (v || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!limpo) return ''
  return /\.myshopify\.com$/.test(limpo) ? limpo : `${limpo}.myshopify.com`
}

const lojaEnv = normalizar(lojaBruta)

export const oauthDisponivel = !!(clientId && clientSecret)
export const statusShopify = { ok: null, erro: null, verificadoEm: null, loja: lojaEnv || null, pedidos: 0, modo: null, moeda: null }

// Token obtido via OAuth, injetado pelo index.js a partir do estado persistido
let sessao = { loja: null, token: null }
export function carregarSessao(s) {
  if (s?.token && s?.loja) sessao = { loja: s.loja, token: s.token }
}

function credenciais() {
  if (tokenFixo && lojaEnv) return { loja: lojaEnv, token: tokenFixo, modo: 'token' }
  if (sessao.token && sessao.loja) return { loja: sessao.loja, token: sessao.token, modo: 'oauth' }
  return null
}

export function shopifyPronta() {
  return !!credenciais()
}

/* ---------------- OAuth ---------------- */

export function urlInstalacao(lojaPedida, redirectUri, nonce) {
  const loja = normalizar(lojaPedida || lojaEnv)
  if (!loja) throw new Error('Informe o endereço da loja (ex.: sualoja.myshopify.com).')
  if (!oauthDisponivel) throw new Error('Faltam SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET.')
  const q = new URLSearchParams({
    client_id: clientId,
    scope: escopos,
    redirect_uri: redirectUri,
    state: nonce,
  })
  return { url: `https://${loja}/admin/oauth/authorize?${q}`, loja }
}

/** Confere a assinatura HMAC que a Shopify anexa ao callback. */
export function hmacValido(query) {
  const { hmac, signature, ...resto } = query
  if (!hmac || !clientSecret) return false
  const base = Object.keys(resto).sort().map(k => `${k}=${resto[k]}`).join('&')
  const esperado = crypto.createHmac('sha256', clientSecret).update(base).digest('hex')
  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(String(hmac), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function trocarCodigoPorToken(lojaPedida, code) {
  const loja = normalizar(lojaPedida)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(loja)) {
    throw new Error('Domínio de loja inválido.')
  }
  const resp = await fetch(`https://${loja}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })
  if (!resp.ok) {
    throw new Error(`A Shopify recusou a troca do código (${resp.status}). Confira o Client Secret e a Redirect URL cadastrada no app.`)
  }
  const dados = await resp.json()
  if (!dados.access_token) throw new Error('A Shopify não devolveu um token de acesso.')
  sessao = { loja, token: dados.access_token }
  registrar(true, null)
  return { loja, token: dados.access_token, escopos: dados.scope }
}

/* ---------------- Admin API ---------------- */

const nomesStatus = { fulfilled: 'entregue', partial: 'transito', restocked: 'problema' }

function registrar(ok, erro) {
  const c = credenciais()
  Object.assign(statusShopify, {
    ok, erro,
    verificadoEm: new Date().toISOString(),
    loja: c?.loja ?? lojaEnv ?? null,
    modo: c?.modo ?? null,
  })
}

function traduzirErro(status, corpo) {
  if (status === 401 || status === 403) {
    return 'A Shopify recusou o acesso. Reinstale o app pelo botão "Conectar Shopify" — o token pode ter sido revogado ou faltam permissões de leitura em Pedidos.'
  }
  if (status === 404) {
    return `Loja ou versão da API não encontrada. A versão em uso é ${versao}; se ela tiver sido aposentada, defina SHOPIFY_API_VERSION com uma mais recente.`
  }
  if (status === 429) return 'Limite de requisições da Shopify atingido. Tente de novo em alguns segundos.'
  if (status >= 500) return 'A API da Shopify está instável no momento. A sincronização volta sozinha.'
  return `A Shopify respondeu ${status}: ${String(corpo).slice(0, 200)}`
}

function mapear(o) {
  const f = o.fulfillments?.find(x => x.tracking_number) ?? o.fulfillments?.[0]
  let status
  if (o.cancelled_at) status = 'problema'
  else if (o.fulfillment_status === 'fulfilled') status = f?.shipment_status === 'delivered' ? 'entregue' : 'transito'
  else if (f?.tracking_number) status = 'transito'
  else status = nomesStatus[o.fulfillment_status] ?? 'aguardando'

  return {
    id: String(o.id),
    numero: o.name,
    cliente: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || '—',
    email: (o.email || o.contact_email || '').toLowerCase(),
    pais: o.shipping_address?.country || '—',
    valor: Number(o.total_price || 0),
    status,
    rastreio: f?.tracking_number || '—',
    urlRastreio: f?.tracking_url || null,
    transportadora: f?.tracking_company || null,
    criadoEm: (o.created_at || '').slice(0, 10),
  }
}

async function chamar(caminho) {
  const c = credenciais()
  if (!c) return { erro: 'Shopify não conectada.' }
  try {
    const resp = await fetch(`https://${c.loja}/admin/api/${versao}/${caminho}`, {
      headers: { 'X-Shopify-Access-Token': c.token },
    })
    if (!resp.ok) {
      const erro = traduzirErro(resp.status, await resp.text().catch(() => ''))
      registrar(false, erro)
      return { erro }
    }
    return { dados: await resp.json() }
  } catch (err) {
    const erro = `Não foi possível alcançar ${c.loja}: ${err.message}`
    registrar(false, erro)
    return { erro }
  }
}

export async function buscarPedidosShopify() {
  const campos = 'id,name,email,contact_email,total_price,created_at,cancelled_at,fulfillment_status,fulfillments,customer,shipping_address'
  const { dados, erro } = await chamar(`orders.json?status=any&limit=250&fields=${campos}`)
  if (erro) return null
  const pedidos = (dados.orders || []).map(mapear)
  registrar(true, null)
  statusShopify.pedidos = pedidos.length
  return pedidos
}

function mapearProduto(p, loja) {
  const variantes = p.variants || []
  const precos = variantes.map(v => Number(v.price || 0)).filter(n => n > 0)
  const estoque = variantes.reduce((soma, v) => soma + (Number(v.inventory_quantity) || 0), 0)
  return {
    id: String(p.id),
    titulo: p.title,
    tipo: p.product_type || '',
    marca: p.vendor || '',
    tags: (p.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    precoMin: precos.length ? Math.min(...precos) : 0,
    precoMax: precos.length ? Math.max(...precos) : 0,
    estoque,
    ativo: p.status === 'active',
    variantes: variantes.map(v => v.title).filter(t => t && t !== 'Default Title'),
    url: `https://${loja}/products/${p.handle}`,
    // descrição sem HTML, curta — vai para o contexto da IA
    descricao: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

export async function buscarProdutosShopify() {
  const c = credenciais()
  if (!c) return null
  const campos = 'id,title,body_html,vendor,product_type,handle,status,tags,variants'
  const { dados, erro } = await chamar(`products.json?limit=250&fields=${campos}`)
  if (erro) {
    // Sem o escopo read_products a Shopify devolve 403; avisa de forma específica
    if (/403|recusou o acesso/i.test(erro)) {
      registrar(false, 'Faltou a permissão de leitura de produtos. No app da Shopify, adicione o escopo read_products aos Scopes, libere uma nova versão e reinstale o app.')
    }
    return null
  }
  return (dados.products || []).map(p => mapearProduto(p, c.loja))
}

export async function testarShopify() {
  if (!credenciais()) {
    Object.assign(statusShopify, { ok: null, erro: null, verificadoEm: null, modo: null })
    return statusShopify
  }
  const { dados, erro } = await chamar('shop.json?fields=name,domain,currency')
  if (!erro) {
    registrar(true, null)
    statusShopify.moeda = dados?.shop?.currency || statusShopify.moeda || null
  }
  return statusShopify
}
