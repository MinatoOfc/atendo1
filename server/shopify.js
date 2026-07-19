const lojaBruta = (process.env.SHOPIFY_STORE || '').trim()
const token = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim()
// A Shopify aposenta cada versão da API depois de ~12 meses; deixe configurável
// para não quebrar quando esta expirar.
const versao = (process.env.SHOPIFY_API_VERSION || '2026-01').trim()

// Aceita "loja", "loja.myshopify.com" ou a URL completa colada do navegador
const loja = lojaBruta
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '')
  .replace(/^(?!.*\.myshopify\.com$)(.+)$/, '$1.myshopify.com')

export const shopifyConfigurada = !!(loja && token)
export const statusShopify = { ok: null, erro: null, verificadoEm: null, loja: loja || null, pedidos: 0 }

const nomesStatus = { fulfilled: 'entregue', partial: 'transito', restocked: 'problema' }

function registrar(ok, erro) {
  Object.assign(statusShopify, { ok, erro, verificadoEm: new Date().toISOString() })
}

function traduzirErro(status, corpo) {
  if (status === 401 || status === 403) {
    return 'A Shopify recusou o token. Confirme que você copiou o "Admin API access token" (começa com shpat_) e que o app foi instalado na loja com permissão de leitura em Pedidos (read_orders).'
  }
  if (status === 404) {
    return `Loja ou versão da API não encontrada. Confirme SHOPIFY_STORE (deve ser algo como sualoja.myshopify.com) — a versão da API em uso é ${versao}; se ela tiver sido aposentada, defina SHOPIFY_API_VERSION com uma mais recente.`
  }
  if (status === 429) return 'Limite de requisições da Shopify atingido. Tente de novo em alguns segundos.'
  if (status >= 500) return 'A API da Shopify está instável no momento. A sincronização volta sozinha.'
  return `A Shopify respondeu ${status}: ${String(corpo).slice(0, 200)}`
}

function mapear(o) {
  const f = o.fulfillments?.find(x => x.tracking_number) ?? o.fulfillments?.[0]
  const cancelado = !!o.cancelled_at
  let status
  if (cancelado) status = 'problema'
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

export async function buscarPedidosShopify() {
  if (!shopifyConfigurada) return null
  const campos = 'id,name,email,contact_email,total_price,created_at,cancelled_at,fulfillment_status,fulfillments,customer,shipping_address'
  const url = `https://${loja}/admin/api/${versao}/orders.json?status=any&limit=250&fields=${campos}`

  let resp
  try {
    resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  } catch (err) {
    registrar(false, `Não foi possível alcançar ${loja}: ${err.message}`)
    return null
  }

  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '')
    registrar(false, traduzirErro(resp.status, corpo))
    console.error('[shopify]', statusShopify.erro)
    return null
  }

  const dados = await resp.json()
  const pedidos = (dados.orders || []).map(mapear)
  registrar(true, null)
  statusShopify.pedidos = pedidos.length
  return pedidos
}

/** Chamada leve só para validar loja, token e permissões. */
export async function testarShopify() {
  if (!shopifyConfigurada) {
    Object.assign(statusShopify, { ok: null, erro: null, verificadoEm: null })
    return statusShopify
  }
  try {
    const resp = await fetch(`https://${loja}/admin/api/${versao}/shop.json?fields=name,domain`, {
      headers: { 'X-Shopify-Access-Token': token },
    })
    if (!resp.ok) {
      registrar(false, traduzirErro(resp.status, await resp.text().catch(() => '')))
    } else {
      registrar(true, null)
    }
  } catch (err) {
    registrar(false, `Não foi possível alcançar ${loja}: ${err.message}`)
  }
  return statusShopify
}
