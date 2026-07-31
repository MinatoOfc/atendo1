/* Referências citadas numa conversa: números de pedido e e-mails.
   Compartilhado entre o servidor (fusão de conversas) e a IA (busca de
   pedidos — cliente às vezes abre o chamado com outro e-mail e só cita
   o e-mail da compra ou o número do pedido no corpo da mensagem). */

export function numerosDePedido(texto) {
  const achados = new Set()
  const re = /(?:#\s?|\b(?:pedido|encomenda|order|bestell(?:ung|ing)?|bestelling|commande|ordine)\s*(?:nr\.?|n[º°o]\.?|#)?\s*)(\d{3,7})\b/gi
  for (const m of String(texto || '').matchAll(re)) achados.add(m[1])
  return achados
}

export function emailsCitados(texto) {
  const achados = new Set()
  for (const m of String(texto || '').toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)) {
    achados.add(m[0])
  }
  return achados
}
