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

/* ------------------------------------------------------------------ */
/* Intenção de AÇÃO: só com a frase do cliente                          */
/* ------------------------------------------------------------------ */

/**
 * Intenções que afirmam um ATO do cliente — ele pediu, aceitou ou recusou.
 * Todas as outras (informa, pergunta_status, agradece, outro) descrevem o que
 * ele falou, não o que ele decidiu, e não precisam de prova.
 */
export const INTENCOES_DE_ACAO = new Set(['pede_troca', 'pede_reembolso', 'pede_cancelamento', 'aceita', 'recusa'])

/**
 * Soluções nomeadas pelo CLIENTE, procuradas no texto normalizado (sem acento,
 * minúsculo) — por isso escritas sem acento.
 *
 * Não são as mesmas de RE_ACAO em server/atendimento.js: aquelas conferem se o
 * RASCUNHO DA LOJA nomeia a ação da etapa e rodam sobre o texto cru. Estas leem
 * a frase do cliente. Direções opostas, listas separadas de propósito.
 *
 * DEVOLUÇÃO NÃO É TROCA: "quero devolver", "return it", "zurückschicken" pedem
 * o produto de volta, não outro produto. Ficam de fora de "troca" de propósito —
 * sem pedido explícito de troca, a intenção cai para "outro" e o mapa decide
 * pelo motivo.
 */
export const RE_ACAO_CLIENTE = {
  troca: /(troca|trocar|umtausch|tausch|austausch|ersatz(?!lieferung|sendung)|exchange|replace|replacement|echange|remplac|cambio|reemplaz|scambio|sostitu|ruil|omruil|vervang)/i,
  reenvio: /(reenvi|resend|erneut senden|ersatzlieferung|ersatzsendung|renvo|nouvel envoi|rispedi|nuovo invio|opnieuw verzend|nieuwe zending|send it again|ship it again)/i,
  reembolso: /(reembols|refund|erstatt|rimbors|rembours|terugbetal|terugstort|geld terug|geld zuruck|money back|dinheiro de volta|devolucao do valor|devolucion del)/i,
  cupom: /(cupom|cupon|coupon|gutschein|rabattcode|codigo de desconto|discount code|code promo|codice sconto|kortingscode|kortingsbon|voucher|tegoedbon)/i,
  cancelamento: /(cancel|storn|annul)/i,
}

/** Marcas que a IA usa para APONTAR o trecho (a decisão é tomada adiante). */
export const RE_INTENCAO = {
  pede_troca: RE_ACAO_CLIENTE.troca,
  pede_reembolso: RE_ACAO_CLIENTE.reembolso,
  pede_cancelamento: RE_ACAO_CLIENTE.cancelamento,
  aceita: /(\bja\b|\byes\b|\bsim\b|\boui\b|\bok\b|\bokay\b|\bokey\b|\boke\b|\bsi\b|\bsi'|akkoord|einverstanden|gerne|passt|perfekt|perfeito|perfect|d accord|daccord|\\bd'accord|parfait|perfett|va bene|de acuerdo|de acordo|concordo|aceito|acepto|accetto|accept|abgemacht|graag|prima|\bdeal\b)/i,
  recusa: /(nein|\bnee\b|\bnon\b|\bnao\b|\bno\b|\bniet\b|doch nicht|kein interesse|geen interesse|nicht einverstanden|nicht akzeptier|lehne ab|ablehnen|will nicht|wil niet|refus|rifiut|rechaz|recuso|weiger|not interested|not enough|reicht nicht|zu wenig|troppo poco|trop peu|\d{1,3} ?%)/i,
}

const ROTULO_INTENCAO = {
  pede_troca: 'pedir troca', pede_reembolso: 'pedir reembolso',
  pede_cancelamento: 'pedir cancelamento', aceita: 'aceitar a oferta', recusa: 'recusar a oferta',
}

/* ---- núcleo da declaração: o que sobra tirando saudação e cortesia ---- */

/**
 * Saudações, despedidas, agradecimentos e reforços que não mudam o sentido de
 * uma resposta curta. "Hallo, ja, danke!" decide o mesmo que "ja"; "Immer noch
 * nein" decide o mesmo que "nein".
 */
const CORTESIA = new Set((
  'ola oi hallo hi hello hey bonjour bonsoir salut ciao buongiorno hola buenas beste geachte goedendag dag ' +
  'guten tag morgen abend sehr geehrte geehrter geehrte damen herren frau herr senhor senhora senhores prezado prezada caro cara ' +
  'obrigado obrigada danke dank vielen sehr schon thanks thank you merci gracias grazie bedankt bitte please por favor ' +
  'mit freundlichen gruessen freundliche viele liebe beste gruessen gruesse gruss mfg lg vg kind best regards cordialement ' +
  'saludos cordiali saluti met vriendelijke groet groeten mvg atenciosamente abracos cumprimentos tschuess ciao adeus ' +
  'immer noch still ainda toujours ancora todavia nog steeds weiterhin definitiv absolut definitely really realmente mesmo ' +
  'e y and und en et'
).split(' ').filter(Boolean))

/** Texto comparável sem pontuação, sem saudação e sem cortesia. */
export function nucleoDaDeclaracao(texto) {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}%\s]+/gu, ' ')
    .split(/\s+/)
    .filter(p => p && !CORTESIA.has(p))
    .join(' ')
}

/** Negativas e afirmativas que, SOZINHAS, respondem uma oferta. */
const NEGATIVA_CURTA = new Set('nein nee neen non nao no nope niet nicht nunca jamais mai nunca'.split(' '))
const AFIRMATIVA_CURTA = new Set('ja jawohl sim oui ok okay okey oke si yes yep yeah klar genau perfekt perfeito perfect prima certo bene vale deal akkoord einverstanden abgemacht graag gerne aceito acepto accetto concordo'.split(' '))

/** A declaração inteira é uma resposta curta feita só destas palavras? */
const respostaCurta = (nucleo, conjunto) => {
  const ts = nucleo.split(' ').filter(Boolean)
  return ts.length > 0 && ts.length <= 4 && ts.every(t => conjunto.has(t))
}

/**
 * RECUSA EXPLÍCITA da oferta, nos sete idiomas. Um "não" dentro de uma frase
 * maior não entra aqui de propósito: "não recebi meu pedido" e "não ficou
 * pequeno" são relato, não recusa.
 */
const RE_RECUSA_EXPLICITA = new RegExp([
  // pt
  'nao quero', 'nao aceito', 'nao tenho interesse', 'sem interesse', 'nao e suficiente', 'nao basta', 'nao serve', 'rejeito', 'recuso',
  // de
  // alemao: querer/desejar + nicht com ate 12 caracteres entre eles ('will das nicht')
  '\\b(?:will|wollen|mochte|mochten|moechte)\\b[^.!?]{0,12}\\bnicht\\b', 'nicht akzeptier', 'akzeptiere nicht',
  'lehne ab', 'ablehnen', 'kein interesse', 'nicht einverstanden', 'reicht nicht', 'zu wenig', 'nicht genug',
  'auf keinen fall', 'keinesfalls', 'doch nicht',
  // nl
  // holandes: wil + niet com ate 12 caracteres entre eles ('wil ik niet', 'wil dat niet')
  '\\bwil\\b[^.!?]{0,12}\\bniet\\b', 'niet willen', 'geen interesse', 'niet akkoord', 'weiger', 'niet genoeg', 'te weinig',
  // fr
  'ne veux pas', 'je refuse', 'refuse', 'pas d accord', 'pas assez', 'trop peu', 'aucun interet',
  // it
  'non voglio', 'non accetto', 'rifiut', 'non basta', 'non e sufficiente', 'troppo poco', 'nessun interesse',
  // es
  'no quiero', 'no acepto', 'rechaz', 'no es suficiente', 'muy poco', 'sin interes',
  // en
  "don't want", 'dont want', 'do not want', 'not interested', 'not enough', 'not acceptable', 'i refuse', 'reject',
].join('|'), 'i')

/** Adversativa: "ok, MAS…" concorda e emenda outra coisa — não é aceite. */
const RE_ADVERSATIVA = /\b(?:mas|porem|contudo|todavia|so que|aber|jedoch|allerdings|but|however|though|mais|cependant|toutefois|pero|sin embargo|ma|maar|echter)\b/i

/** Percentuais citados no texto. */
const percentuaisCitados = t => [...String(t).matchAll(/(\d{1,3})\s?%/g)].map(x => Number(x[1]))

/** Ações que o texto do cliente nomeia. */
const acoesCitadas = t => Object.keys(RE_ACAO_CLIENTE).filter(a => RE_ACAO_CLIENTE[a].test(t))

/**
 * LIMITADORES: "só o cupom", "nur den Gutschein", "alleen de kortingsbon".
 * Em português "só" normaliza para "so", que em alemão é palavra comum ("so ist
 * es") — por isso só conta seguido de artigo, como no uso português de verdade.
 */
const RE_LIMITADOR = /\b(?:somente|apenas|unicamente|only|just|nur|blo(?:ss|ß)|lediglich|alleen|slechts|enkel|seulement|uniquement|juste|solamente|soltanto|solo)\b|\bso\s+(?:o|a|os|as|um|uma|el|la|los|las|un|una|il|lo|gli|le)\b/i

const NOME_ACAO_CLIENTE = { troca: 'a troca', reenvio: 'o reenvio', reembolso: 'o reembolso parcial', cupom: 'o cupom', cancelamento: 'o cancelamento' }

/** Ações que a oferta em aberto contém (uma etapa pode ter duas). */
export function acoesDaOfertaAberta(oferta) {
  const tipo = String(oferta?.tipo ?? '')
  const r = []
  if (/troca/.test(tipo)) r.push('troca')
  if (/reenvio/.test(tipo)) r.push('reenvio')
  if (/reembolso/.test(tipo)) r.push('reembolso')
  if (tipo === 'cupom' || oferta?.cupom) r.push('cupom')
  if (tipo === 'cancelamento') r.push('cancelamento')
  return r
}

/**
 * TRAVA DETERMINÍSTICA DA INTENÇÃO DE AÇÃO. A IA propõe; o servidor só aceita
 * com a frase do cliente, e julga a DECLARAÇÃO INTEIRA — não o trecho solto.
 *
 * - pedir troca/reembolso/cancelamento: a frase apontada tem de nomear aquilo.
 * - recusar: negativa isolada só vale quando a declaração inteira, tirada a
 *   saudação e a cortesia, é uma resposta curta ("Nein", "Não"). Em frase maior
 *   é preciso recusa explícita ("não quero", "não aceito", "não é suficiente")
 *   ou exigir um percentual diferente do que está na oferta. Assim "Não recebi
 *   meu pedido" nunca vira recusa.
 * - aceitar: "ok" só aceita quando não há contradição. Ressalva, pergunta,
 *   percentual diferente ou outra solução derrubam o aceite — e sem aceite o
 *   mapa manda o caso para o dono, que é o comportamento seguro.
 * - aceitar PARCIALMENTE uma oferta combinada (troca + cupom, reenvio +
 *   reembolso parcial) também vai para o dono: "somente o cupom" nunca aciona
 *   uma troca, e nomear uma das duas ações não decide a outra.
 *
 * Devolve { intencao, evidencia, evidenciaNoTextoAtual, descartada, motivo }.
 */
export function validarIntencao({ intencao = null, evidencia = '', textoAtual = '', oferta = null } = {}) {
  const base = {
    intencao: intencao ?? null, evidencia: String(evidencia ?? ''),
    evidenciaNoTextoAtual: false, descartada: null, motivo: null, ambigua: false,
  }
  if (!intencao || !INTENCOES_DE_ACAO.has(intencao)) return base

  const atual = normalizar(textoAtual)
  const ev = normalizar(evidencia)
  const descartar = motivo => ({ ...base, intencao: 'outro', descartada: intencao, motivo })
  // ambíguo: o cliente respondeu à oferta, mas o que ele aceitou não é óbvio.
  // Sai do automático como qualquer descarte — e ainda diz POR QUÊ, para o
  // motivo que chega até você ser o exato, nunca "não deu para entender".
  const ambiguo = motivo => ({ ...base, intencao: 'outro', descartada: intencao, motivo, ambigua: true })
  const aceitar = () => ({ ...base, evidenciaNoTextoAtual: true })

  if (!ev) return descartar(`a IA não apontou trecho do cliente que comprove "${ROTULO_INTENCAO[intencao]}"`)
  if (!atual.includes(ev)) {
    return descartar('o trecho apontado como prova não está na mensagem nova do cliente (veio do texto citado, do assunto ou do histórico)')
  }

  const nucleo = nucleoDaDeclaracao(textoAtual)
  const pcts = percentuaisCitados(atual)
  // percentuais que a oferta em aberto de fato contém (valor e/ou cupom)
  const permitidos = new Set([oferta?.pct, oferta?.cupom].filter(p => Number.isFinite(p)))
  const foraDaOferta = pcts.filter(p => !permitidos.has(p))

  if (intencao === 'recusa') {
    if (respostaCurta(nucleo, NEGATIVA_CURTA)) return aceitar()
    if (RE_RECUSA_EXPLICITA.test(atual)) return aceitar()
    // exigir outro percentual é recusar o que está na mesa
    if (foraDaOferta.length) return aceitar()
    return descartar('um "não" dentro de uma frase maior não é recusa da oferta — seria preciso "não quero", "não aceito", "não é suficiente" ou exigir outro percentual')
  }

  if (intencao === 'aceita') {
    if (RE_ADVERSATIVA.test(atual)) {
      return descartar('a mensagem concorda e emenda uma ressalva ("ok, mas…") — isso não é aceite')
    }
    if (String(textoAtual).includes('?') && !respostaCurta(nucleo, AFIRMATIVA_CURTA)) {
      return descartar('a mensagem faz uma pergunta em vez de confirmar a oferta')
    }
    if (foraDaOferta.length) {
      return descartar(`o cliente cita ${foraDaOferta.join('%, ')}%, que não é o que está na oferta em aberto`)
    }
    const daOferta = acoesDaOfertaAberta(oferta)
    const citadasTodas = acoesCitadas(atual)
    const fora = citadasTodas.filter(a => !daOferta.includes(a))
    if (fora.length) {
      return descartar(`o cliente fala de "${fora.join('", "')}" — não é a solução que está na oferta em aberto`)
    }
    if (!RE_INTENCAO.aceita.test(atual)) return descartar('a mensagem não confirma a oferta de forma clara')

    /* ---- ACEITE PARCIAL DE OFERTA COMBINADA ----
     * Uma etapa pode oferecer duas coisas (troca + cupom, reenvio + reembolso
     * parcial). Um "sim" genérico aceita o pacote inteiro. Mas quando o cliente
     * nomeia só uma parte — ou escreve "somente o cupom" — o que ele aceitou
     * deixa de ser óbvio, e despachar uma troca que ele não pediu é caro e
     * irreversível. Nesses casos o caso vai para você, sem gravar aceite. */
    if (daOferta.length > 1) {
      const citadas = citadasTodas.filter(a => daOferta.includes(a))
      const limitou = RE_LIMITADOR.test(atual)
      const parcial = citadas.length > 0 && citadas.length < daOferta.length
      const faltando = daOferta.filter(a => !citadas.includes(a))
      const pacote = daOferta.map(a => NOME_ACAO_CLIENTE[a]).join(' + ')

      if (limitou && parcial) {
        return ambiguo(`o cliente limitou o aceite a ${citadas.map(a => NOME_ACAO_CLIENTE[a]).join(' e ')} — a etapa oferece ${pacote}, e a parte de fora (${faltando.map(a => NOME_ACAO_CLIENTE[a]).join(' e ')}) não pode ser decidida sozinha`)
      }
      if (parcial) {
        // troca/reenvio + cupom: aceitar a ENTREGA leva o pacote junto (o cupom
        // é acréscimo). Aceitar "o cupom" nunca aciona troca nem reenvio.
        const entrega = daOferta.find(a => a === 'troca' || a === 'reenvio')
        const soCupomNaOferta = daOferta.includes('cupom') && entrega
        if (!(soCupomNaOferta && citadas.includes(entrega))) {
          return ambiguo(`o cliente nomeou ${citadas.map(a => NOME_ACAO_CLIENTE[a]).join(' e ')}, mas a etapa oferece ${pacote} — não dá para concluir sozinho se ele aceitou o resto`)
        }
      }
    }
    return aceitar()
  }

  if (!RE_INTENCAO[intencao].test(ev)) {
    return descartar(`o trecho apontado não diz ${ROTULO_INTENCAO[intencao]} — reclamar do produto ou pedir devolução não é isso`)
  }
  return aceitar()
}

/**
 * COBRANÇA DE REEMBOLSO JÁ PROMETIDO. O cliente não está abrindo uma
 * solicitação nova — está perguntando do dinheiro que a loja já disse que ia
 * devolver. Recomeçar a escada de ofertas aqui faz a loja oferecer duas vezes a
 * mesma coisa, e foi o que aconteceu com o cliente Andreas (#2567).
 *
 * Exige SEMPRE duas metades perto uma da outra: o termo do reembolso e a marca
 * de pendência ("ainda não", "onde está", "quando chega"). Assim "quero meu
 * dinheiro de volta" continua sendo pedido, não cobrança.
 */
export const RE_COBRANCA_REEMBOLSO = new RegExp([
  // onde/quando + reembolso
  '(?:wo ist|wo bleibt|wann kommt|wann erhalte ich|wann wird)[^.!?\n]{0,45}(?:ruckerstattung|erstattung|geld)',
  '(?:where is|wheres|when will|when do i get)[^.!?\n]{0,45}(?:refund|money)',
  '(?:onde esta|cade|quando chega|quando vou receber|quando sera)[^.!?\n]{0,45}(?:reembolso|dinheiro|estorno)',
  '(?:waar is|waar blijft|wanneer komt|wanneer krijg ik)[^.!?\n]{0,45}(?:terugbetaling|geld)',
  '(?:ou est|quand arrive|quand vais-je recevoir)[^.!?\n]{0,45}(?:remboursement|argent)',
  '(?:dove e|quando arriva|quando ricevo)[^.!?\n]{0,45}(?:rimborso|denaro|soldi)',
  '(?:donde esta|cuando llega|cuando recibo)[^.!?\n]{0,45}(?:reembolso|dinero)',
  // reembolso + ainda não
  '(?:ruckerstattung|erstattung)[^.!?\n]{0,45}(?:noch nicht|noch immer nicht|nicht angekommen|nicht auf meinem konto|nicht erhalten|nicht da)',
  '(?:noch (?:immer )?(?:nicht|kein|keine))[^.!?\n]{0,45}(?:ruckerstattung|erstattung|geld)',
  '(?:refund)[^.!?\n]{0,45}(?:not yet|not arrived|not received|hasnt arrived|still not|is missing)',
  '(?:still (?:no|not|havent|have not))[^.!?\n]{0,45}(?:refund|money)',
  '(?:reembolso|estorno)[^.!?\n]{0,45}(?:ainda nao|nao caiu|nao chegou|nao recebi|nao foi feito)',
  '(?:ainda nao)[^.!?\n]{0,45}(?:reembolso|dinheiro|estorno)',
  '(?:terugbetaling)[^.!?\n]{0,45}(?:nog niet|niet ontvangen|niet binnen)',
  '(?:nog (?:steeds )?(?:niet|geen))[^.!?\n]{0,45}(?:terugbetaling|geld)',
  '(?:remboursement)[^.!?\n]{0,45}(?:pas encore|toujours pas|pas recu)',
  '(?:toujours pas|pas encore)[^.!?\n]{0,45}(?:remboursement|argent)',
  '(?:rimborso)[^.!?\n]{0,45}(?:non ancora|ancora non|non e ancora|non e arrivato|non ricevuto)',
  '(?:ancora non|non ancora)[^.!?\n]{0,45}(?:rimborso|soldi|denaro)',
  '(?:reembolso)[^.!?\n]{0,45}(?:todavia no|aun no|no ha llegado|no recibi)',
  '(?:todavia no|aun no)[^.!?\n]{0,45}(?:reembolso|dinero)',
].join('|'), 'i')

/* ------------------------------------------------------------------ */
/* Declaração de PEDIDO INTEIRO                                         */
/* ------------------------------------------------------------------ */

/**
 * O cliente declarou, com todas as letras, que a solicitação é do PEDIDO
 * INTEIRO — "hiermit widerrufe ich meine Bestellung", "cancelar meu pedido",
 * "the whole order". Nos sete idiomas atendidos.
 */
export const RE_PEDIDO_INTEIRO = new RegExp([
  // de
  'widerrufe ich (?:hiermit )?(?:meine|die) bestellung', 'widerruf (?:meiner|der) bestellung', 'bestellung widerrufen',
  'gesamte bestellung', 'ganze bestellung', 'komplette bestellung', 'bestellung stornieren', 'bestellung annullieren',
  // nl
  'hele bestelling', 'gehele bestelling', 'bestelling annuleren', 'bestelling herroepen',
  // fr
  'toute ma commande', 'commande enti(?:e|è)re', 'annuler ma commande', 'annuler la commande', 'me r(?:e|é)tracte',
  // it
  'intero ordine', "tutto l'? ?ordine", "annullare (?:il mio |l'? ?)ordine", "recesso dall'? ?ordine",
  // es
  'pedido completo', 'todo el pedido', 'cancelar (?:mi|el) pedido', 'anular (?:mi|el) pedido', 'desistimiento',
  // en
  'whole order', 'entire order', 'full order', 'cancel (?:my|the) order', 'return the (?:whole|entire) order',
  // pt
  'pedido inteiro', 'pedido todo', 'todo o pedido', 'pedido completo', 'cancelar (?:o|meu) pedido',
  'revogo (?:minha compra|meu pedido)', 'desisto (?:da compra|do pedido)', 'devolver (?:o pedido|tudo)',
].join('|'), 'i')

/**
 * Linguagem de PARTE do pedido: derruba a regra acima. "um produto do pedido",
 * "nur eines der", "one of the items" — aí continua sendo coleta.
 */
export const RE_PARTE_DO_PEDIDO = new RegExp([
  'um (?:produto|item|artigo)', 'um dos (?:produtos|itens)', 'apenas um', 'somente um', '\bso um\b',
  'ein(?:en|es|e)? (?:artikel|produkt|st(?:u|ü)ck)', 'eine[rs]? der', 'nur ein', 'nur eine[rs]?', 'einzelne',
  'een van de', 'slechts (?:een|één)', 'alleen een',
  'un des', 'un (?:article|produit)', 'seulement un',
  'uno dei', 'un articolo', 'solo uno',
  'uno de los', 'un art(?:i|í)culo', 's(?:o|ó)lo uno',
  'one of the', 'one item', 'only one', 'a single item',
].join('|'), 'i')

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
