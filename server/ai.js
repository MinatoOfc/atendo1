import Anthropic from '@anthropic-ai/sdk'
import { gerarRascunhoLocal } from './logic.js'

export const iaConfigurada = !!process.env.ANTHROPIC_API_KEY
// Padrão econômico: Haiku 4.5 custa uma fração do Opus e dá conta de
// classificar e responder e-mails de atendimento. Suba para claude-sonnet-5
// ou claude-opus-4-8 via ATENDO_MODEL se quiser respostas mais elaboradas.
const MODEL = process.env.ATENDO_MODEL || 'claude-haiku-4-5'
// O parâmetro de raciocínio adaptativo só existe nos modelos maiores;
// enviá-lo ao Haiku derruba a requisição com erro 400.
const suportaAdaptive = /opus-4-[678]|sonnet-5|sonnet-4-6|fable/.test(MODEL)

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

// Preço por milhão de tokens (entrada, saída) — para estimar o custo por conversa
const PRECOS = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5': [3, 15],
  'claude-sonnet-4-6': [3, 15],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-fable-5': [10, 50],
}

function custoDeUso(u) {
  if (!u) return 0
  const [entrada, saida] = PRECOS[MODEL] ?? [3, 15]
  const tokensEntrada = (u.input_tokens || 0)
    + (u.cache_creation_input_tokens || 0) * 1.25
    + (u.cache_read_input_tokens || 0) * 0.1
  return (tokensEntrada * entrada + (u.output_tokens || 0) * saida) / 1e6
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['categoria', 'idioma', 'resposta', 'confianca', 'escalar_humano', 'motivo', 'spam', 'situacao'],
  properties: {
    situacao: { type: 'string', description: 'Resumo de UMA frase, em português, do que o cliente quer nesta conversa — para o atendente entender o caso de relance. Ex.: "Cliente solicita reembolso de 3 polos por reação alérgica ao material".' },
    categoria: { type: 'string', enum: ['rastreio', 'reembolso', 'troca', 'produto', 'entrega', 'outro'] },
    idioma: { type: 'string', description: 'Código ISO 639-1 do idioma do cliente, ex.: pt, en, it, de, fr, es' },
    resposta: { type: 'string', description: 'Resposta completa ao cliente, no idioma definido pelas instruções, pronta para envio. Se spam=true, deixe VAZIA ("") — spam não recebe resposta.' },
    confianca: { type: 'number', description: 'De 0 a 1: qualidade da resposta escrita. Pedir ao cliente um dado que falta (número do pedido, foto) é resposta boa e vale confiança alta — não abaixe a nota por não ter os dados.' },
    escalar_humano: { type: 'boolean', description: 'true apenas quando a LOJA precisa decidir algo (reembolso, exceção, caso jurídico). Não use quando basta pedir informação ao cliente.' },
    motivo: { type: 'string', description: 'Por que foi escalado ou por que a confiança é baixa; string vazia se nada a sinalizar. SEMPRE em português — este campo é para o lojista, não para o cliente.' },
    spam: { type: 'boolean', description: 'true quando o e-mail NÃO é um cliente tratando do próprio pedido, de uma compra ou de um produto da loja: marketing, ofertas comerciais, parcerias, SEO, newsletters, notificações automáticas e e-mails genéricos sem relação com pedidos' },
  },
}

const simbolos = { EUR: '€', BRL: 'R$', USD: '$', GBP: '£' }

function preco(p, moeda) {
  if (!p.precoMin) return 'preço sob consulta'
  const s = simbolos[moeda] ?? moeda
  return p.precoMin === p.precoMax ? `${s} ${p.precoMin.toFixed(2)}` : `${s} ${p.precoMin.toFixed(2)} a ${s} ${p.precoMax.toFixed(2)}`
}

const normalizarTexto = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Catálogo enxuto para economizar tokens: só os produtos que têm a ver com a
 * conversa vão completos (com opções, estoque e link); o restante vira uma
 * linha de nome + preço. Antes, os 120 produtos iam inteiros em toda chamada —
 * era de longe o maior custo por resposta.
 */
export function montarCatalogo(produtos, moeda, textoConversa = '') {
  const ativos = produtos.filter(p => p.ativo)
  if (!ativos.length) return '(catálogo não sincronizado — não afirme quais produtos a loja vende; peça ao cliente o que ele procura)'

  const termos = [...new Set(normalizarTexto(textoConversa).split(/[^a-z0-9]+/).filter(t => t.length > 3))]
  const pontos = p => {
    const alvo = normalizarTexto(`${p.titulo} ${p.tipo} ${p.tags.join(' ')} ${p.variantes.slice(0, 8).join(' ')}`)
    return termos.reduce((s, t) => s + (alvo.includes(t) ? 1 : 0), 0)
  }
  const ordenados = ativos.map(p => [pontos(p), p]).sort((a, b) => b[0] - a[0])
  const detalhados = ordenados.filter(([s]) => s > 0).slice(0, 12).map(([, p]) => p)
  const resumo = new Set(detalhados)
  const resumidos = ativos.filter(p => !resumo.has(p)).slice(0, 40)
  const restantes = ativos.length - detalhados.length - resumidos.length

  const linhas = []
  if (detalhados.length) {
    linhas.push('Produtos relacionados a esta conversa (detalhes completos):')
    for (const p of detalhados) {
      const partes = [`- ${p.titulo} — ${preco(p, moeda)}`]
      if (p.tipo) partes.push(`categoria: ${p.tipo}`)
      if (p.variantes.length) partes.push(`opções: ${p.variantes.slice(0, 5).join(', ')}`)
      // estoque não rastreado = sempre à venda; null = desconhecido (não afirmar nada)
      if (p.sempreDisponivel) partes.push('em estoque')
      else if (p.estoque != null) partes.push(p.estoque > 0 ? `em estoque (${p.estoque})` : 'sem estoque no momento')
      if (p.descricao) partes.push(p.descricao.slice(0, 80))
      linhas.push(partes.join(' | ') + `\n  link: ${p.url}`)
    }
    linhas.push('')
  }
  if (resumidos.length) {
    linhas.push('Demais produtos da loja (nome e preço; se o cliente perguntar detalhes de um deles, responda com nome e preço e peça mais contexto sobre o que ele procura):')
    for (const p of resumidos) linhas.push(`- ${p.titulo} — ${preco(p, moeda)}`)
  }
  if (restantes > 0) linhas.push(`(+${restantes} produtos não listados — se o cliente procurar algo fora da lista, peça mais detalhes)`)
  return linhas.join('\n')
}

function lojaDoTicket(state, ticket) {
  return (state.lojas ?? []).find(l => l.id === ticket?.lojaId) ?? state.lojas?.[0] ?? null
}

const nomesIdioma = { pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', nl: 'holandês' }

export function montarSystem(state, ticket) {
  const loja = lojaDoTicket(state, ticket)
  const nomeLoja = loja?.nome ?? state.config.nomeLoja
  const moeda = loja?.moeda ?? 'EUR'
  // idioma fixo escolhido pelo lojista; 'auto' (padrão) responde no idioma do cliente
  const idiomaFixo = loja?.idioma && loja.idioma !== 'auto' ? (nomesIdioma[loja.idioma] ?? loja.idioma) : null
  const politicas = state.politicas.filter(p => p.ativa)
  const faqs = state.faqs.filter(f => f.ativa)
  const comportamentos = (state.comportamentos ?? []).filter(c => c.ativa)
  // cada loja só enxerga o próprio catálogo
  const produtos = (state.produtos ?? []).filter(p => !p.lojaId || !loja || p.lojaId === loja.id)
  // texto da conversa para escolher quais produtos merecem detalhes completos
  const textoConversa = [
    ticket?.assunto, ticket?.corpo,
    ...(ticket?.historico ?? []).slice(-4).map(m => m.corpo),
  ].filter(Boolean).join(' ').slice(0, 6000)
  return [
    `Você é o atendimento ao cliente da loja "${nomeLoja}", um e-commerce.`,
    `Sua tarefa: ler o e-mail do cliente, classificá-lo e escrever a resposta${idiomaFixo ? ` em ${idiomaFixo}` : ' no idioma do cliente'}.`,
    ``,
    `Regras invioláveis:`,
    `- As políticas, FAQs e o catálogo abaixo são a ÚNICA fonte de verdade. NUNCA invente prazos, valores, regras, produtos ou promessas que não estejam neles.`,
    `- Ao falar de produtos, use apenas os do catálogo, com o nome e o preço exatos. Nunca invente um produto, preço ou disponibilidade.`,
    `- Se o cliente perguntar o que a loja vende, responda citando os produtos reais do catálogo (os mais relevantes para a pergunta), com preço e link.`,
    `- Se o cliente procurar algo que não existe no catálogo, diga com clareza que não trabalhamos com aquilo e sugira o que temos de mais próximo.`,
    idiomaFixo
      ? `- Escreva TODA resposta em ${idiomaFixo}, SEMPRE — mesmo que o cliente escreva em outro idioma (escolha do lojista). O campo "idioma" do JSON continua sendo o idioma em que o CLIENTE escreveu.`
      : `- Responda no idioma em que o cliente escreveu.`,
    `- Os campos "situacao" e "motivo" do JSON são para o LOJISTA (brasileiro): escreva-os SEMPRE em português, independentemente do idioma da resposta.`,
    `- Tom: cordial, direto, humano. Sem parecer robô. Termine com a assinatura abaixo, mantendo as quebras de linha exatamente como estão:`,
    loja?.assinatura || state.config.assinatura,
    ``,
    ...(comportamentos.length ? [
      `Comportamentos definidos pelo lojista — quando a conversa se encaixar em uma destas situações, siga a instrução correspondente à risca. Elas têm prioridade sobre o tom e o fluxo padrão (mas nunca sobre as regras invioláveis acima):`,
      comportamentos.map(c => `- Situação: ${c.situacao}\n  Como agir: ${c.instrucao}`).join('\n'),
      ``,
    ] : []),
    `Quando faltar informação, separe os dois casos:`,
    `- Falta um dado que o PRÓPRIO CLIENTE pode fornecer (número do pedido, e-mail usado na compra, foto do produto): pedir esse dado de forma clara e cordial É a resposta correta e completa. Trate como resposta normal, com confiança ALTA, sem escalar. É o que um atendente humano faria.`,
    `- Falta algo que só a LOJA pode decidir ou que não está nas políticas (aprovar exceção, autorizar desconto, definir uma regra inexistente): aí sim escale para humano.`,
    ``,
    `Sempre escale para humano (escalar_humano=true), mesmo com rascunho pronto:`,
    `- Reembolsos, disputas, chargebacks, ameaças legais, ameaças de exposição pública.`,
    `- Cliente muito irritado ou pedindo indenização.`,
    ``,
    `Filtro de spam — na caixa de entrada só ficam clientes falando de pedidos ou produtos:`,
    `- Mantenha (spam=false): qualquer assunto de um cliente sobre a própria compra — status do pedido, entrega, rastreio, troca, devolução, reembolso, pagamento, defeito — e dúvidas sobre produtos da loja, antes ou depois de comprar.`,
    `- Marque spam=true em TODO o resto: marketing, ofertas comerciais, parcerias, influenciadores, agências, consultoria, SEO, newsletters, notificações automáticas de plataformas (Shopify, Meta, bancos, transportadoras avisando a loja), fornecedores, convites e e-mails genéricos sem relação com pedidos ou produtos da loja — mesmo quando educados ou com cara de mensagem pessoal.`,
    `- Regra de decisão: se NÃO estiver claro que é um cliente tratando de uma compra ou de um produto, marque spam. A única exceção é haver indício concreto de cliente real falando da própria compra — aí nunca marque spam.`,
    `- Primeira mensagem genérica que NÃO menciona nenhum produto, pedido, compra ou entrega é abertura clássica de golpe — marque spam. Inclui: cumprimento vazio ("hello", "hi there"), teste de idioma ("do you speak English?", "I guess you speak English"), teste de presença ("are you there?") e pergunta se a loja está ativa/aberta/recebendo pedidos. Cliente real diz o que quer logo na primeira mensagem; quem só "testa o canal" é golpista preparando a oferta.`,
    `- O filtro vale também NO MEIO de uma conversa: se as mensagens seguintes revelarem oferta comercial, consultoria, otimização de site ou golpe, marque spam=true — mesmo que a conversa tenha começado parecendo um cliente.`,
    `- Spam NÃO recebe resposta: ao marcar spam=true, devolva resposta VAZIA (""), confianca 0 e escalar_humano=false. Não gaste uma palavra escrevendo resposta para spam.`,
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
    `Catálogo de produtos da loja (preços em ${moeda}):`,
    montarCatalogo(produtos, moeda, textoConversa),
  ].join('\n')
}

export async function processarEmailIA(state, ticket, instrucaoExtra = null) {
  if (!client) return null
  const emailCliente = ticket.de.trim().toLowerCase()
  const lojaTicket = lojaDoTicket(state, ticket)
  const pedidosCliente = state.pedidos
    .filter(p => !p.lojaId || !lojaTicket || p.lojaId === lojaTicket.id)
    .filter(p => p.email && p.email.trim().toLowerCase() === emailCliente)
    .slice(0, 3)
  // conversas longas: só as últimas 8 mensagens, cada uma limitada — histórico
  // inteiro crescia sem teto e encarecia cada resposta
  const todasMensagens = ticket.historico ?? []
  const recentes = todasMensagens.slice(-8)
  const historico = [
    ...(todasMensagens.length > recentes.length ? [`(${todasMensagens.length - recentes.length} mensagens mais antigas omitidas)`] : []),
    ...recentes.map(m => `${m.autor === 'atendo' ? 'Loja (você)' : 'Cliente'} em ${m.data?.slice(0, 16)}:\n${String(m.corpo).slice(0, 1500)}`),
  ].join('\n---\n')
  const user = [
    // sem a data de hoje o modelo não consegue calcular prazos de entrega
    `Hoje é ${new Date().toISOString().slice(0, 10)}.`,
    ``,
    ...(historico ? [`Histórico anterior desta conversa (do mais antigo ao mais recente):`, historico, ``] : []),
    `E-mail recebido${historico ? ' agora (responda a este)' : ''}:`,
    `De: ${ticket.nome} <${ticket.de}>`,
    `Assunto: ${ticket.assunto}`,
    ``,
    String(ticket.corpo ?? '').slice(0, 4000),
    ``,
    pedidosCliente.length
      ? `Pedidos deste cliente na Shopify (localizados pelo e-mail ${ticket.de}), do mais recente ao mais antigo:\n`
        + pedidosCliente.map(p =>
          `- ${p.numero}: status ${p.status}, rastreio ${p.rastreio}${p.urlRastreio ? ` (${p.urlRastreio})` : ''}${p.transportadora ? `, transportadora ${p.transportadora}` : ''}, país ${p.pais}, valor ${p.valor}, criado em ${p.criadoEm}`
          + (p.itens?.length ? `\n  itens: ${p.itens.map(i => `${i.quantidade}x ${i.titulo}${i.variante ? ` (${i.variante})` : ''}`).join('; ')}` : '')).join('\n')
      : `Nenhum pedido encontrado para o e-mail ${ticket.de} na Shopify. Se o cliente falar de um pedido, peça o número do pedido ou o e-mail usado na compra.`,
    ...(instrucaoExtra ? [
      ``,
      `INSTRUÇÃO DO LOJISTA para esta resposta (prioridade máxima — siga à risca, acima do fluxo padrão; este e-mail NÃO é spam, escreva a resposta):`,
      instrucaoExtra,
    ] : []),
  ].join('\n')

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      ...(suportaAdaptive ? { thinking: { type: 'adaptive' } } : {}),
      system: montarSystem(state, ticket),
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
      situacao: r.situacao || null,
      custo: custoDeUso(resp.usage),
      geradoPorIA: true,
    }
  } catch (err) {
    registrarErro(traduzirErro(err))
    console.error('[ai] falha, usando regras locais:', statusIA.erro)
    return null
  }
}

const SCHEMA_TRADUCAO = {
  type: 'object',
  additionalProperties: false,
  required: ['traducoes'],
  properties: {
    traducoes: {
      type: 'array',
      items: { type: 'string' },
      description: 'As traduções em português brasileiro, na MESMA ordem e quantidade das mensagens numeradas recebidas',
    },
  },
}

/** Traduz várias mensagens do cliente numa única chamada. Retorna {textos, custo} ou {erro}. */
export async function traduzirMensagens(mensagens) {
  if (!client) return { erro: 'A tradução usa o Claude — configure a ANTHROPIC_API_KEY primeiro.' }
  try {
    const conteudo = mensagens.map((m, i) => `[mensagem ${i + 1}]\n${String(m).slice(0, 4000)}`).join('\n\n')
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      ...(suportaAdaptive ? { thinking: { type: 'adaptive' } } : {}),
      system: 'Traduza cada mensagem numerada para português brasileiro, mantendo o tom e o significado. Não comente nem explique — apenas traduza, na mesma ordem.',
      messages: [{ role: 'user', content: conteudo }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA_TRADUCAO } },
    })
    if (resp.stop_reason === 'refusal') return { erro: 'O Claude recusou traduzir estas mensagens.' }
    const texto = resp.content.find(b => b.type === 'text')?.text
    const r = texto ? JSON.parse(texto) : null
    if (!r?.traducoes?.length) return { erro: 'A IA não devolveu as traduções.' }
    return { textos: r.traducoes.slice(0, mensagens.length), custo: custoDeUso(resp.usage) }
  } catch (err) {
    return { erro: traduzirErro(err) }
  }
}

// Pipeline completo: tenta IA, cai para regras locais
export async function processarEmail(state, ticket) {
  const ia = await processarEmailIA(state, ticket)
  if (ia) return ia
  const loja = lojaDoTicket(state, ticket)
  const idiomaFixo = loja?.idioma && loja.idioma !== 'auto' ? loja.idioma : null
  const assinatura = loja?.assinatura || state.config.assinatura
  const local = gerarRascunhoLocal(ticket, state.politicas, state.faqs, state.pedidos, assinatura, idiomaFixo)
  return { ...local, spam: false, geradoPorIA: false }
}
