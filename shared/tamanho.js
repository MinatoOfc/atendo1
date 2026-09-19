/**
 * TAMANHOS: leitura, ordem e coerência. Módulo PURO — sem servidor, sem IA.
 *
 * A regra que este arquivo existe para cumprir veio de um caso real (#2749).
 * O cliente escreveu só isto:
 *
 *   "Bitte senden Sie mir einen Retourenschein, da das Hemd in hellblau
 *    nicht passt."
 *
 * Ele disse que a camisa NÃO SERVE. Não disse se ficou pequena nem grande. A
 * IA decidiu sozinha que tinha ficado grande e ofereceu 2XL — um tamanho MENOR
 * do que o 3XL comprado. O checklist ficou verde.
 *
 * Aqui nada é deduzido. Ou a direção veio do cliente e a ordem dos rótulos é
 * conhecida com segurança, ou não existe oferta de tamanho nenhuma.
 */

/**
 * A ÚNICA ordem que dá para afirmar sem uma tabela da própria loja.
 * Números (38, 40, W32/L34) e rótulos de outros sistemas ficam de fora de
 * propósito: ordená-los às cegas é exatamente o erro que gerou este arquivo.
 */
const ORDEM = ['xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl']

/** XXL = 2XL, XXXL = 3XL, XXXXL = 4XL — e as formas por extenso mais comuns. */
const EQUIVALENTES = {
  xxs: 'xxs', '2xs': 'xxs',
  xs: 'xs', 'extrasmall': 'xs', 'extrapequeno': 'xs',
  s: 's', small: 's', pequeno: 's', pequena: 's',
  m: 'm', medium: 'm', medio: 'm', media: 'm', mittel: 'm',
  l: 'l', large: 'l',
  xl: 'xl', extralarge: 'xl',
  xxl: '2xl', '2xl': '2xl',
  xxxl: '3xl', '3xl': '3xl',
  xxxxl: '4xl', '4xl': '4xl',
  xxxxxl: '5xl', '5xl': '5xl',
  xxxxxxl: '6xl', '6xl': '6xl',
  xxxxxxxl: '7xl', '7xl': '7xl',
}

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
/** tira acento, caixa, espaços, pontos e hífens: "X X L" e "x-xl" viram "xxl" */
const cru = s => semAcento(s).toLowerCase().replace(/[\s.\-_/]/g, '')

/**
 * Rótulo canônico de um tamanho, ou null quando não dá para afirmar nada.
 * null NÃO é "não existe": é "não sei ordenar isto", e quem chama tem de
 * tratar como proibição, nunca como permissão.
 */
export function normalizarTamanho(bruto) {
  const s = cru(bruto)
  if (!s) return null
  return EQUIVALENTES[s] ?? null
}

/** O rótulo é de um sistema que sabemos ordenar? */
export const tamanhoConhecido = bruto => normalizarTamanho(bruto) !== null

/**
 * Tamanho de uma variante do pedido ("Hellblau / 3XL" → "3xl").
 * Devolve null quando nenhuma parte é um tamanho que sabemos ordenar — o que
 * inclui, de propósito, "Beige / 32" e qualquer numeração.
 */
export function tamanhoDaVariante(variante) {
  for (const parte of String(variante ?? '').split(/[/|,;]/)) {
    const t = normalizarTamanho(parte)
    if (t) return t
  }
  return null
}

/** -1, 0, 1 — ou null quando algum dos dois não é ordenável. */
export function compararTamanhos(a, b) {
  const x = ORDEM.indexOf(normalizarTamanho(a) ?? '')
  const y = ORDEM.indexOf(normalizarTamanho(b) ?? '')
  if (x < 0 || y < 0) return null
  return x === y ? 0 : (x < y ? -1 : 1)
}

/** palavra que anuncia um tamanho, nos sete idiomas do atendimento */
const PALAVRA_TAMANHO = 'tamanho|tamanhos|gro[sß]+e|groesse|size|sizes|taille|taglia|talla|maat|misura|nummer'
/** token que só pode ser tamanho (tem X): xs, xl, xxl, 2xl, 3xl… */
const RE_TOKEN_X = /\b(x{1,6}[sl]|[2-9]\s?x\s?l|[2-9]\s?x\s?s)\b/gi
/** letra solta só conta quando vem logo depois da palavra "tamanho" */
const RE_LETRA_COM_PALAVRA = new RegExp(`(?:${PALAVRA_TAMANHO})\\s*:?\\s*([smlx]{1,7}|[2-9]\\s?xl)\\b`, 'gi')

/**
 * Tamanhos CITADOS num texto, em ordem de aparição e sem repetir.
 *
 * Conservador de propósito: um "L" solto no meio de uma frase não vira
 * tamanho (seria ruído em sete idiomas). Ou o token tem X, ou vem logo depois
 * de "Größe"/"size"/"tamanho"/"taille"/"taglia"/"talla"/"maat".
 */
export function tamanhosCitados(texto) {
  const s = semAcento(texto ?? '')
  const achados = []
  for (const re of [RE_TOKEN_X, RE_LETRA_COM_PALAVRA]) {
    re.lastIndex = 0
    for (const m of s.matchAll(re)) {
      const t = normalizarTamanho(m[1] ?? m[0])
      if (t && !achados.includes(t)) achados.push(t)
    }
  }
  return achados
}

/** Os tamanhos que a loja realmente tem para este produto. */
export function tamanhosDoCatalogo(variantes = []) {
  const fora = []
  for (const v of variantes) {
    const t = tamanhoDaVariante(v)
    if (t && !fora.includes(t)) fora.push(t)
  }
  return fora
}

/**
 * CONTRADIÇÃO entre a direção informada e o tamanho pedido pelo cliente.
 *
 * O tamanho que ele pede vence a direção — mas só quando os dois cabem juntos.
 * "Ficou pequeno, quero 2XL" sobre um 3XL é um pedido que se contradiz: não se
 * adivinha qual das duas metades é a verdadeira, e nada sai sem confirmação.
 *
 * Devolve o motivo, ou null quando não há contradição (inclusive quando a
 * ordem dos rótulos não é conhecida — aí não dá para AFIRMAR contradição).
 */
export function contradicaoDeTamanho({ original = null, direcao = null, desejado = null } = {}) {
  const alvo = normalizarTamanho(desejado)
  if (!alvo || !direcao) return null
  const ordem = compararTamanhos(original, alvo)
  if (ordem === null) return null
  const o = String(original).toUpperCase()
  const d = alvo.toUpperCase()
  if (ordem === 0) return `o cliente pede o MESMO tamanho que comprou (${d})`
  if (direcao === 'pequeno' && ordem > 0) return `o cliente diz que ${o} ficou pequeno e pede ${d}, que é ainda MENOR`
  if (direcao === 'grande' && ordem < 0) return `o cliente diz que ${o} ficou grande e pede ${d}, que é ainda MAIOR`
  return null
}

/**
 * A OFERTA DE TAMANHO É COERENTE?
 *
 * Determinística e fechada: só devolve ok quando consegue PROVAR. Em qualquer
 * dúvida — direção não comprovada, rótulo que não sabemos ordenar, variante
 * que a loja não tem — a resposta é não.
 *
 *  - direcao 'pequeno' → o tamanho oferecido tem de ser MAIOR que o comprado;
 *  - direcao 'grande'  → tem de ser MENOR;
 *  - direcao null      → nenhum tamanho pode ser oferecido;
 *  - desejado          → vence a direção, mas só o que o cliente pediu, e só
 *                        se a loja tiver.
 */
export function conferirOfertaDeTamanho({
  original = null, direcao = null, desejado = null, oferecidos = [], catalogo = null,
} = {}) {
  const prop = oferecidos.map(t => normalizarTamanho(t)).filter(Boolean)
  const pedido = normalizarTamanho(desejado)
  const doCatalogo = Array.isArray(catalogo) ? catalogo.map(t => normalizarTamanho(t)).filter(Boolean) : null
  const nao = (codigo, motivo) => ({ ok: false, codigo, motivo, tamanho: prop[0] ?? null })

  // nenhum tamanho no texto: nada a conferir (a etapa pode nem oferecer um)
  if (!prop.length) return { ok: true, codigo: null, motivo: null, tamanho: null }
  if (prop.length > 1) return nao('multiplos', `o texto oferece mais de um tamanho (${prop.join(', ').toUpperCase()}) — só um pode sair`)
  const alvo = prop[0]

  // pedido do cliente que briga com a direção que ele mesmo deu: ninguém
  // decide por ele — vai para você ou volta como pergunta
  const contra = contradicaoDeTamanho({ original, direcao, desejado })
  if (contra) return nao('contradicao_tamanho', contra + ' — não dá para escolher por ele')

  // o cliente pediu um tamanho: é ele, e só ele
  if (pedido) {
    if (alvo !== pedido) return nao('pedido', `o cliente pediu ${pedido.toUpperCase()} e o texto oferece ${alvo.toUpperCase()}`)
  } else {
    if (!direcao) {
      return nao('sem_direcao', `o cliente não disse se ficou pequeno ou grande, e o texto já oferece ${alvo.toUpperCase()} — sem essa informação nenhum tamanho pode ser oferecido`)
    }
    const ordem = compararTamanhos(original, alvo)
    if (ordem === null) {
      return nao('desconhecido', original
        ? `não dá para comparar ${String(original).toUpperCase()} com ${alvo.toUpperCase()} sem uma tabela de tamanhos da loja`
        : `o tamanho comprado não foi identificado no pedido — sem ele não dá para conferir se ${alvo.toUpperCase()} é maior ou menor`)
    }
    if (ordem === 0) return nao('ordem', `o texto oferece o MESMO tamanho comprado (${alvo.toUpperCase()})`)
    if (direcao === 'pequeno' && ordem > 0) {
      return nao('ordem', `ficou pequeno, e o texto oferece ${alvo.toUpperCase()}, que é MENOR que ${String(original).toUpperCase()}`)
    }
    if (direcao === 'grande' && ordem < 0) {
      return nao('ordem', `ficou grande, e o texto oferece ${alvo.toUpperCase()}, que é MAIOR que ${String(original).toUpperCase()}`)
    }
  }

  // a loja tem esse tamanho? sem catálogo, não se promete
  if (doCatalogo === null) {
    return nao('catalogo', `não dá para confirmar no catálogo da loja que existe ${alvo.toUpperCase()} deste produto`)
  }
  if (!doCatalogo.includes(alvo)) {
    return nao('catalogo', doCatalogo.length
      ? `a loja não tem ${alvo.toUpperCase()} deste produto (tem: ${doCatalogo.join(', ').toUpperCase()})`
      : `este produto não tem tamanhos cadastrados no catálogo da loja`)
  }
  return { ok: true, codigo: null, motivo: null, tamanho: alvo }
}
