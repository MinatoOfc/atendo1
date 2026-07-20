/**
 * Tradução gratuita pelo endpoint público do Google Tradutor (client=gtx),
 * o mesmo que o widget do Google usa — sem chave e sem custo. A Claude não
 * participa: traduzir conversas não gasta créditos de IA.
 */

async function traduzirTexto(texto) {
  const resp = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(texto),
  })
  if (!resp.ok) throw new Error(`o tradutor respondeu ${resp.status}`)
  const dados = await resp.json()
  // resposta: [[["trecho traduzido","trecho original",...], ...], ...]
  const traduzido = (dados?.[0] ?? []).map(seg => seg?.[0] ?? '').join('')
  return traduzido || texto
}

/** Traduz cada mensagem para português. Retorna {textos} ou {erro}. */
export async function traduzirGratis(mensagens) {
  const textos = []
  try {
    // sequencial de propósito: educado com o serviço gratuito e suficiente para poucas mensagens
    for (const m of mensagens) textos.push(await traduzirTexto(String(m).slice(0, 4500)))
    return { textos }
  } catch (err) {
    return { erro: `A tradução gratuita falhou (${err.message}). Tente de novo em instantes.` }
  }
}
