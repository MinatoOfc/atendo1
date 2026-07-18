const loja = process.env.SHOPIFY_STORE // ex.: minhaloja.myshopify.com
const token = process.env.SHOPIFY_ADMIN_TOKEN

export const shopifyConfigurada = !!(loja && token)

const nomesStatus = { fulfilled: 'entregue', partial: 'transito', null: 'aguardando' }

export async function buscarPedidosShopify() {
  if (!shopifyConfigurada) return null
  const url = `https://${loja}/admin/api/2024-10/orders.json?status=any&limit=100&fields=id,name,email,total_price,created_at,fulfillment_status,fulfillments,customer,shipping_address`
  const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  if (!resp.ok) {
    console.error('[shopify] erro ao buscar pedidos:', resp.status, await resp.text().catch(() => ''))
    return null
  }
  const dados = await resp.json()
  return (dados.orders || []).map(o => {
    const f = o.fulfillments?.[0]
    return {
      id: String(o.id),
      numero: o.name,
      cliente: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || '—',
      email: o.email || '',
      pais: o.shipping_address?.country || '—',
      valor: Number(o.total_price || 0),
      status: f?.tracking_number ? (o.fulfillment_status === 'fulfilled' ? 'entregue' : 'transito') : (nomesStatus[o.fulfillment_status] ?? 'aguardando'),
      rastreio: f?.tracking_number || '—',
      criadoEm: (o.created_at || '').slice(0, 10),
    }
  })
}
