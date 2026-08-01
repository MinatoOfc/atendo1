/**
 * Tradução gratuita pelo endpoint público do Google Tradutor (client=gtx),
 * o mesmo que o widget do Google usa — sem chave e sem custo. A Claude não
 * participa: traduzir conversas não gasta créditos de IA.
 *
 * O serviço limita requisições por IP (429) — e no Railway o IP de saída é
 * compartilhado. Por isso: espaçamento entre pedidos, retentativas com
 * espera crescente e troca de host quando o limite bate.
 */

const espera = ms => new Promise(r => setTimeout(r, ms))

const HOSTS = ['https://translate.googleapis.com', 'https://translate.google.com']

async function chamar(host, texto) {
  const resp = await fetch(host + '/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(texto),
  })
  if (!resp.ok) {
    const erro = new Error(`o tradutor respondeu ${resp.status}`)
    erro.status = resp.status
    throw erro
  }
  const dados = await resp.json()
  // resposta: [[["trecho traduzido","trecho original",...], ...], ...]
  const traduzido = (dados?.[0] ?? []).map(seg => seg?.[0] ?? '').join('')
  return traduzido || texto
}

async function traduzirTexto(texto) {
  // 429/erros de rede: espera e tenta de novo, alternando o host — o limite
  // é por host, então o segundo endereço costuma responder na hora
  const tentativas = [
    { host: HOSTS[0], antes: 0 },
    { host: HOSTS[1], antes: 400 },
    { host: HOSTS[0], antes: 1500 },
    { host: HOSTS[1], antes: 3000 },
  ]
  let ultimo
  for (const t of tentativas) {
    if (t.antes) await espera(t.antes)
    try {
      return await chamar(t.host, texto)
    } catch (err) {
      ultimo = err
      const s = err.status
      if (s && s !== 429 && s < 500) throw err // erro de pedido (não de limite): repetir não ajuda
    }
  }
  throw ultimo
}

/** Traduz cada mensagem para português. Retorna {textos} ou {erro}. */
export async function traduzirGratis(mensagens) {
  const textos = []
  const cache = new Map() // mensagens idênticas na mesma leva: traduz uma vez só
  try {
    for (const m of mensagens) {
      const texto = String(m).slice(0, 4500)
      if (!texto.trim()) { textos.push(texto); continue }
      if (!cache.has(texto)) {
        if (cache.size) await espera(350) // espaço entre pedidos: evita o limite do serviço
        cache.set(texto, await traduzirTexto(texto))
      }
      textos.push(cache.get(texto))
    }
    return { textos }
  } catch (err) {
    return { erro: `A tradução gratuita falhou (${err.message}). Tente de novo em instantes.` }
  }
}
