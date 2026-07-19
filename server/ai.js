import Anthropic from '@anthropic-ai/sdk'
import { gerarRascunhoLocal } from './logic.js'

export const iaConfigurada = !!process.env.ANTHROPIC_API_KEY
const MODEL = process.env.ATENDO_MODEL || 'claude-opus-4-8'

const client = iaConfigurada ? new Anthropic() : null

// Estado da IA, exposto na interface — sem isso uma falha da API some no log
// e o usuário só vê "gerada por regras" sem saber o motivo.
export const statusIA = { ok: null, erro: null, verificadoEm: null, modelo: MODEL }

function registrarErro(msg) {
  Object.assign(statusIA, { ok: false, erro: msg, verificadoEm: new Date().toISOString() })
}

function traduzirErro(err) {
  const status = err?.status
  const m = String(err?.message || err)
  if (status === 401) return 'Chave de API inválida ou revogada. Confira ANTHROPIC_API_KEY no Railway.'
  if (status === 403) return 'A chave não tem permissão para este modelo. Verifique o plano da conta em console.anthropic.com.'
  if (status === 404) return `O modelo "${MODEL}" não existe ou não está disponível para sua conta. Defina ATENDO_MODEL com um modelo que você tenha acesso (ex.: claude-sonnet-5).`
  if (status === 429) return 'Limite de uso atingido (rate limit). Aguarde um pouco ou aumente o limite da sua conta.'
  if (status === 400 && /credit|balance|billing/i.test(m)) return 'Sua conta Anthropic está sem créditos. Adicione créditos em console.anthropic.com → Billing.'
  if (status === 400) return `A API recusou a requisição: ${m.slice(0, 200)}`
  if (status >= 500) return 'A API da Anthropic está indisponível no momento. As respostas voltam sozinhas quando o serviço normalizar.'
  if (/credit|balance|insufficient/i.test(m)) return 'Sua conta Anthropic está sem créditos. Adicione créditos em console.anthropic.com → Billing.'
  return m.slice(0, 250)
}

/** Chamada barata só para validar chave, modelo e créditos. */
export async function testarIA() {
  if (!client) {
    Object.assign(statusIA, { ok: null, erro: null, verificadoEm: null })
    return statusIA
  }
  try {
    await client.messages.create({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Responda apenas: ok' }],
    })
    Object.assign(statusIA, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
  } catch (err) {
    registrarErro(traduzirErro(err))
  }
  return statusIA
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['categoria', 'idioma', 'resposta', 'confianca', 'escalar_humano', 'motivo', 'spam'],
  properties: {
    categoria: { type: 'string', enum: ['rastreio', 'reembolso', 'troca', 'produto', 'entrega', 'outro'] },
    idioma: { type: 'string', description: 'Código ISO 639-1 do idioma do cliente, ex.: pt, en, it, de, fr, es' },
    resposta: { type: 'string', description: 'Resposta completa ao cliente, no idioma dele, pronta para envio' },
    confianca: { type: 'number', description: 'De 0 a 1: qualidade da resposta escrita. Pedir ao cliente um dado que falta (número do pedido, foto) é resposta boa e vale confiança alta — não abaixe a nota por não ter os dados.' },
    escalar_humano: { type: 'boolean', description: 'true apenas quando a LOJA precisa decidir algo (reembolso, exceção, caso jurídico). Não use quando basta pedir informação ao cliente.' },
    motivo: { type: 'string', description: 'Por que foi escalado ou por que a confiança é baixa; string vazia se nada a sinalizar' },
    spam: { type: 'boolean', description: 'true se não é um cliente: oferta comercial, cold outreach, consultoria, SEO' },
  },
}

function preco(p) {
  if (!p.precoMin) return 'preço sob consulta'
  return p.precoMin === p.precoMax ? `R$ ${p.precoMin.toFixed(2)}` : `R$ ${p.precoMin.toFixed(2)} a R$ ${p.precoMax.toFixed(2)}`
}

function montarCatalogo(produtos) {
  const ativos = produtos.filter(p => p.ativo)
  if (!ativos.length) return '(catálogo não sincronizado — não afirme quais produtos a loja vende; peça ao cliente o que ele procura)'
  const linhas = ativos.slice(0, 120).map(p => {
    const partes = [`- ${p.titulo} — ${preco(p)}`]
    if (p.tipo) partes.push(`categoria: ${p.tipo}`)
    if (p.variantes.length) partes.push(`opções: ${p.variantes.slice(0, 8).join(', ')}`)
    partes.push(p.estoque > 0 ? `em estoque (${p.estoque})` : 'sem estoque no momento')
    if (p.descricao) partes.push(p.descricao.slice(0, 140))
    return partes.join(' | ') + `\n  link: ${p.url}`
  })
  const extra = ativos.length > 120 ? `\n(e mais ${ativos.length - 120} produtos — se o cliente procurar algo fora desta lista, peça mais detalhes)` : ''
  return linhas.join('\n') + extra
}

export function montarSystem(state) {
  const politicas = state.politicas.filter(p => p.ativa)
  const faqs = state.faqs.filter(f => f.ativa)
  const produtos = state.produtos ?? []
  return [
    `Você é o atendimento ao cliente da loja "${state.config.nomeLoja}", um e-commerce.`,
    `Sua tarefa: ler o e-mail do cliente, classificá-lo e escrever a resposta no idioma do cliente.`,
    ``,
    `Regras invioláveis:`,
    `- As políticas, FAQs e o catálogo abaixo são a ÚNICA fonte de verdade. NUNCA invente prazos, valores, regras, produtos ou promessas que não estejam neles.`,
    `- Ao falar de produtos, use apenas os do catálogo, com o nome e o preço exatos. Nunca invente um produto, preço ou disponibilidade.`,
    `- Se o cliente perguntar o que a loja vende, responda citando os produtos reais do catálogo (os mais relevantes para a pergunta), com preço e link.`,
    `- Se o cliente procurar algo que não existe no catálogo, diga com clareza que não trabalhamos com aquilo e sugira o que temos de mais próximo.`,
    `- Responda no idioma em que o cliente escreveu.`,
    `- Tom: cordial, direto, humano. Sem parecer robô. Termine com a assinatura: "${state.config.assinatura}".`,
    ``,
    `Quando faltar informação, separe os dois casos:`,
    `- Falta um dado que o PRÓPRIO CLIENTE pode fornecer (número do pedido, e-mail usado na compra, foto do produto): pedir esse dado de forma clara e cordial É a resposta correta e completa. Trate como resposta normal, com confiança ALTA, sem escalar. É o que um atendente humano faria.`,
    `- Falta algo que só a LOJA pode decidir ou que não está nas políticas (aprovar exceção, autorizar desconto, definir uma regra inexistente): aí sim escale para humano.`,
    ``,
    `Sempre escale para humano (escalar_humano=true), mesmo com rascunho pronto:`,
    `- Reembolsos, disputas, chargebacks, ameaças legais, ameaças de exposição pública.`,
    `- Cliente muito irritado ou pedindo indenização.`,
    ``,
    `O campo "confianca" mede a qualidade da SUA RESPOSTA, não se você tinha todos os dados.`,
    `- 0.9 ou mais: a resposta resolve o caso ou pede corretamente o que falta.`,
    `- 0.6 a 0.9: a resposta é adequada, mas você teve que ser genérico em algum ponto.`,
    `- abaixo de 0.5: você não sabe o que responder, ou responder errado causaria dano. Use com parcimônia.`,
    ``,
    `Políticas da loja:`,
    politicas.length ? politicas.map(p => `- ${p.titulo}: ${p.conteudo}`).join('\n') : '(nenhuma cadastrada)',
    ``,
    `FAQs:`,
    faqs.length ? faqs.map(f => `- P: ${f.pergunta}\n  R: ${f.resposta}`).join('\n') : '(nenhuma cadastrada)',
    ``,
    `Catálogo de produtos da loja:`,
    montarCatalogo(produtos),
  ].join('\n')
}

export async function processarEmailIA(state, ticket) {
  if (!client) return null
  const pedido = state.pedidos.find(p => p.email?.toLowerCase() === ticket.de.toLowerCase())
  const user = [
    `E-mail recebido:`,
    `De: ${ticket.nome} <${ticket.de}>`,
    `Assunto: ${ticket.assunto}`,
    ``,
    ticket.corpo,
    ``,
    pedido
      ? `Pedido deste cliente na Shopify: número ${pedido.numero}, status: ${pedido.status}, rastreio: ${pedido.rastreio}, país: ${pedido.pais}, valor: ${pedido.valor}, criado em ${pedido.criadoEm}.`
      : `Nenhum pedido encontrado para este e-mail na Shopify.`,
  ].join('\n')

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      system: montarSystem(state),
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    })
    if (resp.stop_reason === 'refusal') {
      registrarErro('O Claude recusou responder a este e-mail por política de segurança. O rascunho veio das regras locais.')
      return null
    }
    const texto = resp.content.find(b => b.type === 'text')?.text
    if (!texto) {
      registrarErro('O Claude respondeu sem conteúdo de texto.')
      return null
    }
    const r = JSON.parse(texto)
    Object.assign(statusIA, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
    return {
      categoria: r.categoria,
      idioma: r.idioma,
      resposta: r.resposta,
      confianca: Math.max(0, Math.min(1, r.confianca)),
      escalarHumano: r.escalar_humano,
      motivo: r.motivo || null,
      spam: r.spam,
      geradoPorIA: true,
    }
  } catch (err) {
    registrarErro(traduzirErro(err))
    console.error('[ai] falha, usando regras locais:', statusIA.erro)
    return null
  }
}

// Pipeline completo: tenta IA, cai para regras locais
export async function processarEmail(state, ticket) {
  const ia = await processarEmailIA(state, ticket)
  if (ia) return ia
  const local = gerarRascunhoLocal(ticket, state.politicas, state.faqs, state.pedidos, state.config.assinatura)
  return { ...local, spam: false, geradoPorIA: false }
}
