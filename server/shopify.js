import crypto from 'crypto'

const envClientId = (process.env.SHOPIFY_CLIENT_ID || '').trim()
const envClientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim()
const versao = (process.env.SHOPIFY_API_VERSION || '2026-07').trim()
// read_inventory: sem ele a API nova omite inventory_quantity e todo produto pareceria esgotado
const escopos = (process.env.SHOPIFY_SCOPES || 'read_orders,read_all_orders,read_customers,read_fulfillments,read_products,read_inventory').trim()

// Aceita "loja", "loja.myshopify.com" ou a URL completa colada do navegador
function normalizar(v) {
  const limpo = (v || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!limpo) return ''
  return /\.myshopify\.com$/.test(limpo) ? limpo : `${limpo}.myshopify.com`
}

// Token fixo por variável de ambiente (apps personalizados antigos) — vale para a loja 1
const lojaEnv = normalizar(process.env.SHOPIFY_STORE || '')
const tokenEnv = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim()

export const oauthDisponivel = !!(envClientId && envClientSecret)
// Credenciais do app configurado no servidor (o app do dono). Cada loja pode
// ter o seu próprio app — nesse caso as credenciais vêm do estado da loja.
export const credenciaisEnv = oauthDisponivel ? { clientId: envClientId, clientSecret: envClientSecret } : null
export const conexaoEnv = lojaEnv && tokenEnv ? { loja: lojaEnv, token: tokenEnv, modo: 'token' } : null
export const normalizarDominio = normalizar

/** Conexão efetiva de uma loja: env (só a loja 1) tem precedência sobre o OAuth salvo. */
export function conexaoDaLoja(lojaState, indice) {
  if (indice === 0 && conexaoEnv) return conexaoEnv
  if (lojaState?.shopify?.token && lojaState?.shopify?.loja) {
    return { loja: lojaState.shopify.loja, token: lojaState.shopify.token, modo: 'oauth' }
  }
  return null
}

/* ---------------- OAuth ---------------- */

export function urlInstalacao(cred, dominioPedido, redirectUri, nonce) {
  const loja = normalizar(dominioPedido)
  if (!loja) throw new Error('Informe o endereço da loja (ex.: sualoja.myshopify.com).')
  if (!cred?.clientId) throw new Error('Nenhum app da Shopify configurado para esta loja.')
  const q = new URLSearchParams({
    client_id: cred.clientId,
    scope: escopos,
    redirect_uri: redirectUri,
    state: nonce,
  })
  return { url: `https://${loja}/admin/oauth/authorize?${q}`, loja }
}

/** Confere a assinatura HMAC que a Shopify anexa ao callback (com o secret do app usado). */
export function hmacValido(query, clientSecret) {
  const { hmac, signature, ...resto } = query
  if (!hmac || !clientSecret) return false
  const base = Object.keys(resto).sort().map(k => `${k}=${resto[k]}`).join('&')
  const esperado = crypto.createHmac('sha256', clientSecret).update(base).digest('hex')
  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(String(hmac), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function trocarCodigoPorToken(cred, dominioPedido, code) {
  const loja = normalizar(dominioPedido)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(loja)) {
    throw new Error('Domínio de loja inválido.')
  }
  const resp = await fetch(`https://${loja}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cred.clientId, client_secret: cred.clientSecret, code }),
  })
  if (!resp.ok) {
    throw new Error(`A Shopify recusou a troca do código (${resp.status}). Confira o Client Secret e a Redirect URL cadastrada no app.`)
  }
  const dados = await resp.json()
  if (!dados.access_token) throw new Error('A Shopify não devolveu um token de acesso.')
  return { loja, token: dados.access_token, escopos: dados.scope }
}

/** Escopos que o app precisa — mostrados nas instruções de "criar seu app". */
export const escoposNecessarios = escopos

/* ---------------- Admin API ---------------- */

const nomesStatus = { fulfilled: 'entregue', partial: 'transito', restocked: 'problema' }

function traduzirErro(status, corpo, cx) {
  if (status === 401 || status === 403) {
    return 'A Shopify recusou o acesso. Reconecte a loja — o token pode ter sido revogado ou faltam permissões de leitura.'
  }
  if (status === 404) {
    return `Loja ou versão da API não encontrada (${cx.loja}, versão ${versao}). Se a versão foi aposentada, defina SHOPIFY_API_VERSION com uma mais recente.`
  }
  if (status === 429) return 'Limite de requisições da Shopify atingido. Tente de novo em alguns segundos.'
  if (status >= 500) return 'A API da Shopify está instável no momento. A sincronização volta sozinha.'
  return `A Shopify respondeu ${status}: ${String(corpo).slice(0, 200)}`
}

async function chamar(cx, caminho) {
  if (!cx) return { erro: 'Shopify não conectada.' }
  try {
    const resp = await fetch(`https://${cx.loja}/admin/api/${versao}/${caminho}`, {
      headers: { 'X-Shopify-Access-Token': cx.token },
    })
    if (!resp.ok) {
      return { erro: traduzirErro(resp.status, await resp.text().catch(() => ''), cx) }
    }
    return { dados: await resp.json() }
  } catch (err) {
    return { erro: `Não foi possível alcançar ${cx.loja}: ${err.message}` }
  }
}

function mapearPedido(o) {
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
    email: (o.email || o.contact_email || '').trim().toLowerCase(),
    pais: o.shipping_address?.country || '—',
    valor: Number(o.total_price || 0),
    status,
    rastreio: f?.tracking_number || '—',
    urlRastreio: f?.tracking_url || null,
    transportadora: f?.tracking_company || null,
    criadoEm: (o.created_at || '').slice(0, 10),
    itens: (o.line_items || []).map(li => ({
      titulo: li.title,
      variante: li.variant_title || null, // ex.: "Zwart / L" — cor e tamanho
      quantidade: Number(li.quantity) || 1,
      preco: Number(li.price || 0),
    })),
  }
}

function mapearProduto(p, dominio) {
  const variantes = p.variants || []
  const precos = variantes.map(v => Number(v.price || 0)).filter(n => n > 0)
  // Sem o escopo read_inventory a API omite inventory_quantity — aí o estoque é
  // DESCONHECIDO (null), não zero: ninguém deve dizer ao cliente que esgotou.
  const quantidades = variantes.map(v => v.inventory_quantity).filter(q => q !== undefined && q !== null)
  const estoque = quantidades.length ? quantidades.reduce((soma, q) => soma + (Number(q) || 0), 0) : null
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
    url: `https://${dominio}/products/${p.handle}`,
    descricao: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

export async function buscarPedidosShopify(cx) {
  const campos = 'id,name,email,contact_email,total_price,created_at,cancelled_at,fulfillment_status,fulfillments,customer,shipping_address,line_items'
  const { dados, erro } = await chamar(cx, `orders.json?status=any&limit=250&fields=${campos}`)
  if (erro) return { erro }
  return { pedidos: (dados.orders || []).map(mapearPedido) }
}

export async function buscarProdutosShopify(cx) {
  const campos = 'id,title,body_html,vendor,product_type,handle,status,tags,variants'
  const { dados, erro } = await chamar(cx, `products.json?limit=250&fields=${campos}`)
  if (erro) {
    if (/403|recusou o acesso/i.test(erro)) {
      return { erro: 'Faltou a permissão de leitura de produtos. Adicione o escopo read_products no app da Shopify, libere uma nova versão e reconecte.' }
    }
    return { erro }
  }
  return { produtos: (dados.products || []).map(p => mapearProduto(p, cx.loja)) }
}

/** Chamada leve para validar loja, token e permissões; devolve também a moeda. */
export async function testarShopify(cx) {
  const { dados, erro } = await chamar(cx, 'shop.json?fields=name,domain,currency')
  if (erro) return { ok: false, erro, verificadoEm: new Date().toISOString() }
  return {
    ok: true,
    erro: null,
    verificadoEm: new Date().toISOString(),
    moeda: dados?.shop?.currency || null,
  }
}
