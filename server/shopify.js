import crypto from 'crypto'

const envClientId = (process.env.SHOPIFY_CLIENT_ID || '').trim()
const envClientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim()
const versao = (process.env.SHOPIFY_API_VERSION || '2026-07').trim()
// read_inventory: sem ele a API nova omite inventory_quantity e todo produto pareceria esgotado
// read_discounts: sem ele os cupons do fluxo não podem ser conferidos e o envio
// automático fica bloqueado (é preciso publicar a nova configuração do app e reconectar a loja)
const escopos = (process.env.SHOPIFY_SCOPES || 'read_orders,read_all_orders,read_customers,read_fulfillments,read_products,read_inventory,read_discounts').trim()
export const ESCOPOS_PADRAO = escopos

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
    // limite de requisições: espera o tempo que a Shopify pedir e tenta de novo uma vez
    if (resp.status === 429) {
      const espera = Math.min(10, Number(resp.headers.get('Retry-After') || 2))
      await new Promise(r => setTimeout(r, espera * 1000))
      return chamar(cx, caminho)
    }
    if (!resp.ok) {
      return { erro: traduzirErro(resp.status, await resp.text().catch(() => ''), cx) }
    }
    // cursor da próxima página (cabeçalho Link, rel="next") — a API pagina de 250 em 250
    const link = resp.headers.get('link') || ''
    const proximaPagina = link.match(/[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)?.[1] ?? null
    return { dados: await resp.json(), proximaPagina }
  } catch (err) {
    return { erro: `Não foi possível alcançar ${cx.loja}: ${err.message}` }
  }
}

// Teto de segurança: mantém o estado e a tela saudáveis mesmo em lojas gigantes.
// Ajustável por env se alguém precisar de mais.
const MAX_PEDIDOS = Number(process.env.SHOPIFY_MAX_PEDIDOS ?? 5000)
const MAX_PRODUTOS = Number(process.env.SHOPIFY_MAX_PRODUTOS ?? 1000)

/** Percorre todas as páginas de um recurso (a Shopify entrega no máximo 250 por página). */
async function chamarTodas(cx, recurso, query, extrair, maxItens) {
  const itens = []
  let caminho = `${recurso}?${query}&limit=250`
  while (itens.length < maxItens) {
    const { dados, erro, proximaPagina } = await chamar(cx, caminho)
    if (erro) return itens.length ? { itens } : { erro } // erro no meio: fica com o que já veio
    itens.push(...extrair(dados))
    if (!proximaPagina) break
    // com page_info, a Shopify só aceita limit e fields como parâmetros extras
    const fields = new URLSearchParams(query).get('fields')
    caminho = `${recurso}?limit=250${fields ? `&fields=${fields}` : ''}&page_info=${proximaPagina}`
  }
  return { itens: itens.slice(0, maxItens) }
}

export function mapearPedido(o) {
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
    // data do despacho: base do prazo de entrega no atendimento novo
    despachadoEm: f?.created_at ? String(f.created_at).slice(0, 10) : null,
    itens: (o.line_items || []).map(li => {
      const qtd = Number(li.quantity) || 1
      // Preço realmente PAGO por unidade: tabela menos os descontos alocados à
      // linha (promoções de item e do pedido). Com o preço de tabela cru, a IA
      // "calculava" reembolsos maiores do que o cliente pagou.
      const bruto = Number(li.price || 0) * qtd
      const descontos = Array.isArray(li.discount_allocations) && li.discount_allocations.length
        ? li.discount_allocations.reduce((s, d) => s + Number(d.amount || 0), 0)
        : Number(li.total_discount || 0)
      return {
        titulo: li.title,
        variante: li.variant_title || null, // ex.: "Zwart / L" — cor e tamanho
        quantidade: qtd,
        preco: Math.round(Math.max(0, bruto - descontos) / qtd * 100) / 100,
        // ligam o item ao produto sincronizado — é de lá que vem a foto
        produtoId: li.product_id ? String(li.product_id) : null,
        varianteId: li.variant_id ? String(li.variant_id) : null,
      }
    }),
  }
}

export function mapearProduto(p, dominio) {
  const variantes = p.variants || []
  const precos = variantes.map(v => Number(v.price || 0)).filter(n => n > 0)
  // Estoque não rastreado na Shopify (inventory_management vazio) ou venda
  // permitida sem estoque (inventory_policy "continue"): o produto está SEMPRE
  // disponível — o zero que a API devolve nesses casos não significa esgotado.
  const rastreadas = variantes.filter(v => v.inventory_management)
  const sempreDisponivel = (variantes.length > 0 && rastreadas.length === 0)
    || variantes.some(v => v.inventory_policy === 'continue')
  // Sem o escopo read_inventory a API omite inventory_quantity — aí o estoque é
  // DESCONHECIDO (null), não zero: ninguém deve dizer ao cliente que esgotou.
  const quantidades = rastreadas.map(v => v.inventory_quantity).filter(q => q !== undefined && q !== null)
  const estoque = sempreDisponivel ? null : (quantidades.length ? quantidades.reduce((soma, q) => soma + (Number(q) || 0), 0) : null)
  return {
    sempreDisponivel,
    id: String(p.id),
    titulo: p.title,
    tipo: p.product_type || '',
    marca: p.vendor || '',
    tags: (p.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    precoMin: precos.length ? Math.min(...precos) : 0,
    precoMax: precos.length ? Math.max(...precos) : 0,
    estoque,
    imagem: p.image?.src || p.images?.[0]?.src || null,
    // foto específica de cada variante (ex.: a cor escolhida), via image_id
    imagemPorVariante: Object.fromEntries(variantes
      .filter(v => v.image_id)
      .map(v => [String(v.id), (p.images || []).find(img => img.id === v.image_id)?.src])
      .filter(([, src]) => src)),
    ativo: p.status === 'active',
    variantes: variantes.map(v => v.title).filter(t => t && t !== 'Default Title'),
    url: `https://${dominio}/products/${p.handle}`,
    descricao: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
  }
}

export async function buscarPedidosShopify(cx) {
  const campos = 'id,name,email,contact_email,total_price,created_at,cancelled_at,fulfillment_status,fulfillments,customer,shipping_address,line_items'
  const r = await chamarTodas(cx, 'orders.json', `status=any&fields=${campos}`, d => d.orders || [], MAX_PEDIDOS)
  if (r.erro) return { erro: r.erro }
  return { pedidos: r.itens.map(mapearPedido) }
}

export async function buscarProdutosShopify(cx) {
  const campos = 'id,title,body_html,vendor,product_type,handle,status,tags,variants,image,images'
  const r = await chamarTodas(cx, 'products.json', `fields=${campos}`, d => d.products || [], MAX_PRODUTOS)
  if (r.erro) {
    if (/403|recusou o acesso/i.test(r.erro)) {
      return { erro: 'Faltou a permissão de leitura de produtos. Adicione o escopo read_products no app da Shopify, libere uma nova versão e reconecte.' }
    }
    return { erro: r.erro }
  }
  return { produtos: r.itens.map(p => mapearProduto(p, cx.loja)) }
}

const SEM_PERMISSAO_DESCONTOS = 'Faltou a permissão de leitura de descontos (read_discounts). Publique a nova configuração do app na Shopify e reconecte esta loja.'

/** Consulta GraphQL na MESMA versão configurada da API. */
async function graphql(cx, query, variables = {}) {
  if (!cx) return { erro: 'Shopify não conectada.' }
  try {
    const resp = await fetch(`https://${cx.loja}/admin/api/${versao}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': cx.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (resp.status === 429) {
      const espera = Math.min(10, Number(resp.headers.get('Retry-After') || 2))
      await new Promise(r => setTimeout(r, espera * 1000))
      return graphql(cx, query, variables)
    }
    if (resp.status === 401 || resp.status === 403) return { semPermissao: true, erro: SEM_PERMISSAO_DESCONTOS }
    if (!resp.ok) return { erro: traduzirErro(resp.status, await resp.text().catch(() => ''), cx) }
    const d = await resp.json()
    // erro de permissão no GraphQL vem 200 com errors[].extensions.code = ACCESS_DENIED
    const erros = d?.errors ?? []
    if (erros.some(e => /ACCESS_DENIED|access denied|read_discounts/i.test(`${e?.extensions?.code ?? ''} ${e?.message ?? ''}`))) {
      return { semPermissao: true, erro: SEM_PERMISSAO_DESCONTOS }
    }
    if (erros.length) return { erro: `A Shopify respondeu: ${String(erros[0]?.message ?? 'erro no GraphQL').slice(0, 200)}` }
    return { dados: d?.data ?? null }
  } catch (err) {
    return { erro: `Não foi possível alcançar ${cx.loja}: ${err.message}` }
  }
}

const CONSULTA_CUPOM = `query($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        title status startsAt endsAt usageLimit asyncUsageCount
        customerGets { value { __typename ... on DiscountPercentage { percentage } } }
      }
      ... on DiscountCodeBxgy { title status startsAt endsAt }
      ... on DiscountCodeFreeShipping { title status startsAt endsAt }
      ... on DiscountCodeApp { title status startsAt endsAt }
    }
  }
}`

/**
 * Confere na Shopify (GraphQL `codeDiscountNodeByCode`) os cupons cadastrados no
 * Atendo: o código existe NESTA loja, é um DiscountCodeBasic de percentual, está
 * ACTIVE, já começou, não expirou e ainda tem uso disponível — e o percentual
 * bate exatamente. Sem `read_discounts` devolve { permissao: false }: quem chama
 * mostra "cupom não verificado na Shopify".
 *
 * `pedidos` = [{ pct, codigo }]. Nada é inventado: cada item volta com a
 * situação que a própria Shopify respondeu.
 */
export async function verificarCuponsShopify(cx, pedidos = [], { agora = Date.now() } = {}) {
  const em = new Date(agora).toISOString()
  if (!cx) return { permissao: false, erro: 'Shopify não conectada.', em, itens: [] }
  const itens = []

  for (const { pct, codigo } of pedidos) {
    const cod = String(codigo ?? '').trim()
    if (!cod) continue
    const r = await graphql(cx, CONSULTA_CUPOM, { code: cod })
    if (r.semPermissao) return { permissao: false, erro: r.erro, em, itens: [] }
    if (r.erro) { itens.push({ pct, codigo: cod, situacao: 'erro', detalhe: r.erro }); continue }

    const no = r.dados?.codeDiscountNodeByCode
    const d = no?.codeDiscount
    if (!no || !d) { itens.push({ pct, codigo: cod, situacao: 'inexistente', detalhe: 'nenhum cupom com esse código nesta loja' }); continue }

    const tipo = d.__typename
    if (tipo !== 'DiscountCodeBasic') {
      const nomes = { DiscountCodeBxgy: 'compre-e-leve (BXGY)', DiscountCodeFreeShipping: 'frete grátis', DiscountCodeApp: 'desconto criado por app' }
      itens.push({ pct, codigo: cod, situacao: 'incompativel', detalhe: `na Shopify é ${nomes[tipo] ?? tipo}, não um cupom de percentual` })
      continue
    }
    const valorTipo = d.customerGets?.value?.__typename
    if (valorTipo !== 'DiscountPercentage') {
      itens.push({ pct, codigo: cod, situacao: 'incompativel', detalhe: 'na Shopify é desconto em valor fixo, não em percentual' })
      continue
    }
    // a API devolve fração (0.15 = 15%); aceitamos os dois formatos com segurança
    const bruto = Number(d.customerGets.value.percentage ?? 0)
    const encontrado = bruto > 0 && bruto <= 1 ? Math.round(bruto * 10000) / 100 : Math.round(bruto * 100) / 100
    const inicio = d.startsAt ? Date.parse(d.startsAt) : null
    const fim = d.endsAt ? Date.parse(d.endsAt) : null
    const base = { pct, codigo: cod, valor: encontrado, inicio: d.startsAt ?? null, fim: d.endsAt ?? null, tipo }

    if (Math.round(encontrado * 100) !== Math.round(Number(pct) * 100)) {
      itens.push({ ...base, situacao: 'percentual_divergente', detalhe: `na Shopify vale ${encontrado}%, não ${pct}%` })
    } else if (String(d.status).toUpperCase() === 'EXPIRED' || (fim != null && fim < agora)) {
      itens.push({ ...base, situacao: 'expirado', detalhe: `expirou em ${String(d.endsAt ?? '').slice(0, 10) || 'data não informada'}` })
    } else if (String(d.status).toUpperCase() === 'SCHEDULED' || (inicio != null && inicio > agora)) {
      itens.push({ ...base, situacao: 'nao_iniciado', detalhe: `só começa em ${String(d.startsAt ?? '').slice(0, 10) || 'data não informada'}` })
    } else if (d.usageLimit != null && Number(d.asyncUsageCount ?? 0) >= Number(d.usageLimit)) {
      itens.push({ ...base, situacao: 'esgotado', detalhe: 'o limite de usos do cupom já foi atingido' })
    } else if (String(d.status).toUpperCase() !== 'ACTIVE') {
      itens.push({ ...base, situacao: 'inativo', detalhe: `status na Shopify: ${d.status}` })
    } else {
      itens.push({ ...base, situacao: 'ok', detalhe: `${encontrado}% ativo na Shopify` })
    }
  }
  return { permissao: true, erro: null, em, itens }
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
