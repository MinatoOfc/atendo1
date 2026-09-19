/**
 * O que o cliente REALMENTE escreveu agora, separado do que veio colado no
 * e-mail (notificação da Shopify, mensagem anterior, encaminhamento, rodapé).
 *
 * Isto existe por um caso real: um cliente respondeu ao aviso "sua entrega foi
 * entregue" da Shopify escrevendo "que porcaria é essa, ninguém consegue vestir
 * isso". O texto citado abaixo da resposta fez o motor entender "não recebi" e
 * oferecer "aguarde mais 2 dias e pergunte aos vizinhos" para alguém que estava
 * com a roupa na mão. Nada do que está citado pode contar como declaração do
 * cliente.
 *
 * Módulo puro: nenhuma rede, nenhum estado, nenhuma decisão de negócio.
 */

/** Cabeçalhos de e-mail citado, nos idiomas atendidos. */
const CABECALHOS = [
  // alemão
  'gesendet', 'von', 'an', 'betreff',
  // inglês
  'sent', 'from', 'to', 'subject',
  // português
  'enviado', 'de', 'para', 'assunto',
  // holandês
  'verzonden', 'van', 'aan', 'onderwerp',
  // francês
  'envoyé', 'envoye', 'à', 'objet',
  // italiano
  'inviato', 'da', 'a', 'oggetto',
  // espanhol
  'asunto',
]

/** "Em 12/09, Fulano escreveu:" e equivalentes. */
const RE_ESCREVEU = /^\s*(?:on|am|op|le|il|el|em|den)\b[^\n]{0,180}?\b(?:wrote|schrieb|schreef|a écrit|a ecrit|ha scritto|escribió|escribio|escreveu|napisał)\s*:?\s*$/i

/** "-----Original Message-----" e variantes. */
const RE_ORIGINAL = /^\s*-{2,}\s*(?:original message|ursprüngliche nachricht|urspruengliche nachricht|mensagem original|mensaje original|message d'origine|messaggio originale|oorspronkelijk bericht|forwarded message|weitergeleitete nachricht|mensagem encaminhada)\s*-{2,}\s*$/i

/** Marcadores de citação em HTML. */
const RE_HTML_CITACAO = /<blockquote|class\s*=\s*["'][^"']*(?:gmail_quote|moz-cite-prefix|yahoo_quoted|ms-outlook-quote|OutlookMessageHeader)/i

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Texto comparável: sem acento, sem caixa, espaços normalizados. */
export const normalizar = s => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim()

/** A linha abre um bloco citado? */
function abreCitacao(linha) {
  const l = linha.trim()
  if (!l) return false
  if (RE_ORIGINAL.test(l)) return true
  if (RE_ESCREVEU.test(l)) return true
  // "Gesendet: sexta-feira, 18 de setembro" / "From: loja@..." — cabeçalho com valor
  const m = l.match(/^([\wÀ-ÿ'’ ]{1,12})\s*:\s*\S/)
  if (m && CABECALHOS.includes(normalizar(m[1]))) return true
  return false
}

/**
 * Separa a mensagem em { atual, citado, completo }.
 *
 * `atual` é o único texto que pode valer como declaração do cliente. `citado`
 * serve para localizar a conversa e o número do pedido — nunca para decidir
 * intenção, motivo, entrega, produto, aceite, recusa ou idioma.
 */
export function separarTexto(corpo) {
  const completo = String(corpo ?? '')
  if (!completo.trim()) return { atual: '', declaracao: '', assinatura: '', citado: '', completo }

  // HTML: o bloco citado começa na primeira marca de citação
  const html = completo.search(RE_HTML_CITACAO)
  const base = html >= 0 ? completo.slice(0, html) : completo
  const restoHtml = html >= 0 ? completo.slice(html) : ''

  const linhas = base.split(/\r?\n/)
  let corte = -1
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]
    // linha inteiramente citada com ">"
    if (/^\s*>/.test(l)) { corte = i; break }
    if (abreCitacao(l)) { corte = i; break }
  }

  const atual = corte < 0 ? base.trim() : linhas.slice(0, corte).join('\n').trim()
  const citado = corte < 0 ? restoHtml.trim() : [linhas.slice(corte).join('\n'), restoHtml].filter(Boolean).join('\n').trim()
  // a assinatura fica PRESERVADA, mas separada: empresa, rua, telefone e site no
  // rodapé não podem informar endereço, produto, idioma nem intenção
  const { declaracao, assinatura } = separarAssinatura(atual)
  return { atual, declaracao, assinatura, citado, completo }
}

/* ------------------------------------------------------------------ */
/* Assinatura e rodapé                                                  */
/* ------------------------------------------------------------------ */

/** Linha típica de assinatura/rodapé: telefone, site, e-mail, CNPJ/VAT, empresa. */
const RE_LINHA_ASSINATURA = new RegExp([
  '^\\s*--\\s*$', // separador clássico de assinatura
  '\\btel\\.?\\s*:', '\\btelefon', '\\bmobil\\b', '\\bhandy\\b', '\\bfax\\b', '\\bphone\\b', '\\bwhatsapp\\b',
  'www\\.', 'https?:\\/\\/', // site
  '\\b[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}\\b', // e-mail
  '\\b(?:ust-?idnr|steuernr|cnpj|cpf|vat|btw|kvk|siret)\\b', // identificação fiscal por nome
  '\\b[A-Z]{2,3}\\d{7,}\\b', // ATU51886008 e afins
  '^\\s*(?:fa\\.|firma|gmbh|ltda|inc\\.|ltd\\.|s\\.a\\.)', // razão social abrindo a linha
].join('|'), 'i')

/**
 * Corta a assinatura/rodapé do FIM da mensagem. Conservador de propósito: só
 * remove um bloco final de linhas que parecem assinatura, e nunca devolve
 * declaração vazia — se a mensagem inteira parecer assinatura (por exemplo o
 * cliente respondendo com o endereço que a loja pediu), ela continua inteira.
 *
 * Isto existe porque a assinatura do cliente trazia empresa, rua, telefone e
 * site: dali saía um "endereço" que ele nunca declarou como endereço de entrega.
 */
export function separarAssinatura(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/)
  let corte = linhas.length
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i].trim()
    if (!l) continue
    if (RE_LINHA_ASSINATURA.test(l)) { corte = i; continue }
    break
  }
  const declaracao = linhas.slice(0, corte).join('\n').trim()
  const assinatura = linhas.slice(corte).join('\n').trim()
  if (!declaracao) return { declaracao: String(texto ?? '').trim(), assinatura: '' }
  return { declaracao, assinatura }
}

/* ------------------------------------------------------------------ */
/* Sinais de entrega — só o texto ATUAL do cliente pode acioná-los      */
/* ------------------------------------------------------------------ */

/** Pergunta logística: onde está, quando chega, quantos dias faltam. */
export const RE_PERGUNTA_LOGISTICA = /\b(?:wo ist|wo bleibt|wann kommt|wann kommen|wann erhalte|wie viele tage|wie lange dauert|lieferzeit|where is|where's|when will|when is|how many days|how long does|onde esta|onde anda|quando chega|quando vai chegar|quantos dias|prazo de entrega|waar is|waar blijft|wanneer komt|hoeveel dagen|hoe lang duurt|ou est|ou en est|quand arrive|quand vais-je|combien de jours|dove e|dove si trova|quando arriva|quanti giorni|donde esta|cuando llega|cuantos dias)\b/i

/** Declaração explícita de não recebimento. */
export const RE_NAO_RECEBIDO = /\b(?:nicht erhalten|nichts erhalten|nicht angekommen|nie angekommen|nicht da|nichts da|nicht bekommen|nichts bekommen|nichts angekommen|noch nicht da|noch nichts|kein paket|not received|haven'?t received|has not arrived|hasn'?t arrived|nothing arrived|never arrived|nao recebi|nao chegou|nada chegou|nao recebemos|niet ontvangen|niets ontvangen|niet aangekomen|pas recu|pas recue|rien recu|jamais recu|non ricevuto|non e arrivato|niente ricevuto|no recibi|no ha llegado|no llego|not there|not here|nothing here|nunca chegou|nao esta aqui|niet hier)\b/i

/** "Consta como entregue" — o sistema diz entregue. */
export const RE_CONSTA_ENTREGUE = /\b(?:zugestellt|geliefert|ausgeliefert|delivered|entregue|bezorgd|afgeleverd|livre|livree|consegnato|entregado|als zugestellt|als geliefert|zugestellt angezeigt|zugestellt markiert|wird als (?:zugestellt|geliefert)|marked as delivered|shows as delivered|says delivered|consta (?:como )?entregue|marcado como entregue|aparece como entregue|als bezorgd|comme livre|marque comme livre|come consegnato|risulta consegnato|como entregado|figura como entregado)\b/i

/**
 * Posse física do produto: o cliente está com a peça na mão. Isso torna
 * "consta entregue mas não recebi" incompatível — não dá para reclamar do
 * tecido de uma roupa que não chegou.
 */
export const RE_POSSE_FISICA = /\b(?:erhalten habe|bekommen habe|angezogen|anziehen|tragen|getragen|der stoff|das material|die qualitat|zu klein|zu gross|zu eng|zu weit|kaputt|defekt|besch[a]digt|falsche(?:s|n)? (?:artikel|produkt|gro[s]e)|recebi|chegou (?:hoje|ontem)|o tecido|a qualidade|ficou pequen|ficou grande|veio (?:quebrad|errad|defeituos)|vesti|usei|the fabric|the material|the quality|too small|too big|too tight|broken|damaged|wrong (?:item|product|size)|received it|tried it on|wore it|ontvangen heb|de stof|de kwaliteit|te klein|te groot|kapot|het weefsel|la qualite|trop petit|trop grand|casse|il tessuto|la qualita|troppo piccolo|troppo grande|rotto|el tejido|la calidad|demasiado pequeno|roto)\b/i

/**
 * TRAVA DETERMINÍSTICA da situação de entrega. A IA propõe; o servidor só
 * aceita com prova no texto ATUAL do cliente. Sem prova, a situação é
 * descartada — e o descarte fica registrado, nunca silencioso.
 *
 * Devolve { situacao, evidencia, evidenciaNoTextoAtual, descartada, motivo, conflito }.
 */
export function validarSituacaoEntrega({ situacao = null, evidencia = '', textoAtual = '' } = {}) {
  const base = { situacao: null, evidencia: String(evidencia ?? ''), evidenciaNoTextoAtual: false, descartada: false, motivo: null, conflito: false }
  if (!situacao || situacao === 'nenhuma') return base

  const atual = normalizar(textoAtual)
  const ev = normalizar(evidencia)
  const descartar = motivo => ({ ...base, descartada: true, motivo })

  if (!ev) return descartar('a IA não apontou trecho do texto do cliente que comprove a situação de entrega')
  if (!atual.includes(ev)) {
    return descartar('o trecho apontado como prova não está na mensagem nova do cliente (veio do texto citado, do assunto ou do catálogo)')
  }

  // as marcas são procuradas no texto NORMALIZADO: "Onde está" e "onde esta"
  // são a mesma pergunta
  const pergunta = RE_PERGUNTA_LOGISTICA.test(ev)
  const naoRecebido = RE_NAO_RECEBIDO.test(ev)
  const constaEntregue = RE_CONSTA_ENTREGUE.test(ev)

  if (situacao === 'entregue_nao_recebido') {
    // exige as DUAS metades: consta entregue E não recebi
    if (!(constaEntregue && naoRecebido)) {
      return descartar('para "consta entregue mas não recebi" a prova precisa dizer as duas coisas: que consta entregue e que não foi recebido')
    }
    // posse física no texto atual é incompatível com "não recebi"
    if (RE_POSSE_FISICA.test(atual)) {
      return { ...descartar('o cliente fala do produto em mãos e ao mesmo tempo de não ter recebido — declarações conflitantes'), conflito: true }
    }
  } else if (!(pergunta || naoRecebido)) {
    return descartar('a prova não traz pergunta logística nem declaração explícita de não recebimento')
  }

  return { situacao, evidencia: String(evidencia ?? ''), evidenciaNoTextoAtual: true, descartada: false, motivo: null, conflito: false }
}

/**
 * Produtos que o CLIENTE citou no texto atual. Produto que só aparece na
 * notificação citada ou que veio do catálogo do pedido não conta como
 * informado — na dúvida, o mapa manda perguntar qual é.
 */
const COMUNS = ['com', 'mit', 'und', 'and', 'the', 'das', 'der', 'die', 'van', 'von', 'para', 'por', 'les', 'del']
const tokensDoProduto = p => normalizar(p).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !COMUNS.includes(t))

export function produtosDoTextoAtual(produtos = [], textoAtual = '') {
  const lista = produtos ?? []
  // REGRA LITERAL, sem excecao por tamanho do pedido: o catalogo nunca informa
  // produto. Mesmo com um item so, quem diz qual peca tem problema e o cliente.
  const atual = normalizar(textoAtual)
  if (!atual) return []
  const todos = lista.map(tokensDoProduto)
  return lista.filter((p, i) => {
    // o que DISTINGUE este produto dos outros do pedido (cor, tamanho, modelo).
    // Sem isso, "Polohemd" citado pelo cliente marcaria os dois polos do pedido
    // e o mapa deixaria de perguntar qual deles é.
    const outros = new Set(todos.filter((_, j) => j !== i).flat())
    const distintos = todos[i].filter(t => !outros.has(t))
    const alvo = distintos.length ? distintos : todos[i]
    return alvo.some(t => atual.includes(t))
  })
}
