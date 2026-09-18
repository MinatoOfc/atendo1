/**
 * Prontidão REAL do modo novo — lógica pura, sem rede e sem estado global.
 *
 * Dois níveis, porque são decisões diferentes:
 *   1. `prontidao`  → a loja pode rodar o modo novo COM aprovação humana;
 *   2. `automatico` → a loja pode concluir SOZINHA, sem o dono olhar.
 *
 * Um cupom que a Shopify ainda não confirmou (por exemplo, quando o app não tem
 * a permissão read_discounts) não derruba o piloto com aprovação: ele aparece
 * como aviso e bloqueia SÓ o envio totalmente automático.
 *
 * Nada aqui conhece fases, ofertas, percentuais ou idiomas: os percentuais em
 * uso chegam prontos de quem chama (server/atendimento.js é a fonte).
 */

/** Cupom citado no Miro como observação — nenhuma fase do fluxo usa. */
export const PCT_CUPOM_RESERVA = 10

export const SITUACAO_CUPOM = {
  ok: 'confere na Shopify',
  ausente: 'não cadastrado no Atendo',
  nao_verificado: 'cupom não verificado na Shopify',
  inexistente: 'não existe na Shopify',
  percentual_divergente: 'percentual diferente do cadastrado',
  expirado: 'expirado na Shopify',
  nao_iniciado: 'ainda não começou a valer',
  inativo: 'desativado na Shopify',
  erro: 'não foi possível verificar',
  outra_loja: 'verificação é de outra loja',
}

const texto = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
/** Situações que provam que o código NÃO serve — bloqueiam o envio automático. */
const RUINS = ['inexistente', 'percentual_divergente', 'expirado', 'nao_iniciado', 'inativo']

/**
 * Situação de um cupom, cruzando o que está cadastrado no Atendo com o
 * resultado da última verificação na Shopify DA MESMA LOJA.
 */
export function estadoCupom(pct, codigo, verificacao = null, lojaId = null) {
  const cod = texto(codigo)
  const base = { pct: Number(pct), codigo: cod, usadoPeloFluxo: true, reserva: false }
  if (!cod) return { ...base, situacao: 'ausente', detalhe: SITUACAO_CUPOM.ausente }
  // verificação de outra loja nunca vale: código nunca se mistura entre lojas
  if (verificacao && lojaId && verificacao.lojaId && verificacao.lojaId !== lojaId) {
    return { ...base, situacao: 'outra_loja', detalhe: SITUACAO_CUPOM.outra_loja }
  }
  if (!verificacao || verificacao.permissao === false || !Array.isArray(verificacao.itens)) {
    return { ...base, situacao: 'nao_verificado', detalhe: verificacao?.erro ?? SITUACAO_CUPOM.nao_verificado, em: verificacao?.em ?? null }
  }
  const achado = verificacao.itens.find(i => Number(i.pct) === Number(pct))
  if (!achado) return { ...base, situacao: 'nao_verificado', detalhe: SITUACAO_CUPOM.nao_verificado, em: verificacao.em ?? null }
  // o código mudou depois da verificação: vale como não verificado, nunca como ok
  if (texto(achado.codigo)?.toUpperCase() !== cod.toUpperCase()) {
    return { ...base, situacao: 'nao_verificado', detalhe: 'o código mudou depois da última verificação', em: verificacao.em ?? null }
  }
  return {
    ...base,
    situacao: achado.situacao ?? 'erro',
    detalhe: achado.detalhe ?? SITUACAO_CUPOM[achado.situacao] ?? SITUACAO_CUPOM.erro,
    em: verificacao.em ?? null,
  }
}

/**
 * Conferência dos cupons de uma loja.
 * `pctsUsados` são os percentuais que ALGUMA fase realmente usa; o de 10% entra
 * como reserva (aparece na lista, nunca vira requisito).
 */
export function conferirCupons({ cupons = {}, pctsUsados = [], verificacao = null, lojaId = null } = {}) {
  const itens = pctsUsados.map(pct => estadoCupom(pct, cupons?.[String(pct)], verificacao, lojaId))
  const reserva = texto(cupons?.[String(PCT_CUPOM_RESERVA)])
  itens.push({
    pct: PCT_CUPOM_RESERVA,
    codigo: reserva,
    usadoPeloFluxo: false,
    reserva: true,
    situacao: 'reserva',
    detalhe: 'reserva — não utilizado pelo fluxo',
  })
  const usados = itens.filter(i => i.usadoPeloFluxo)
  return {
    itens,
    ausentes: usados.filter(i => i.situacao === 'ausente').map(i => i.pct),
    invalidos: usados.filter(i => RUINS.includes(i.situacao)),
    naoVerificados: usados.filter(i => ['nao_verificado', 'erro', 'outra_loja'].includes(i.situacao)).map(i => i.pct),
    verificados: usados.filter(i => i.situacao === 'ok').map(i => i.pct),
  }
}

/**
 * O cupom pode ser usado numa mensagem? Reconfere, no instante do uso, o
 * percentual da fase, o código cadastrado NESTA loja e a última verificação.
 * Devolve `{ codigo, ok, situacao, motivo }` — sem `codigo`, nada é enviado.
 */
export function cupomParaMensagem({ pct, cupons = {}, verificacao = null, lojaId = null, exigirVerificado = false } = {}) {
  if (pct == null) return { codigo: null, ok: false, situacao: 'sem_cupom', motivo: 'a fase não usa cupom' }
  const e = estadoCupom(pct, cupons?.[String(pct)], verificacao, lojaId)
  if (e.situacao === 'ausente') return { codigo: null, ok: false, situacao: e.situacao, motivo: `cupom de ${pct}% não cadastrado nesta loja` }
  if (RUINS.includes(e.situacao)) return { codigo: null, ok: false, situacao: e.situacao, motivo: `cupom de ${pct}%: ${e.detalhe}` }
  if (e.situacao !== 'ok' && exigirVerificado) {
    return { codigo: null, ok: false, situacao: e.situacao, motivo: `cupom de ${pct}%: ${e.detalhe}` }
  }
  // não verificado com aprovação humana: o código vale, mas o aviso acompanha
  return { codigo: e.codigo, ok: true, situacao: e.situacao, motivo: e.situacao === 'ok' ? null : e.detalhe }
}

/**
 * Prontidão da loja. `shopify` e `sincronizacao` descrevem a integração DESTA
 * loja: `{ conectada }` e `{ ok, em, erro }` da última sincronização de pedidos.
 */
export function prontidaoDaLoja({
  loja = {}, emailOk = false, shopify = null, sincronizacao = null,
  verificacaoCupons = null, pctsUsados = [], moedasValidas = ['EUR', 'BRL', 'USD', 'GBP'],
} = {}) {
  const faltando = []
  const avisos = []
  const lojaId = loja?.id ?? null

  if (!emailOk) faltando.push({ chave: 'email', texto: 'conta de e-mail própria da loja (Configurações → E-mail)' })

  const p = loja?.prazoEntrega
  if (!p || !(Number(p.min) > 0) || !(Number(p.max) >= Number(p.min))) {
    faltando.push({ chave: 'prazo', texto: 'prazo de entrega em dias úteis (mínimo e máximo)' })
  }

  // Shopify conectada e sincronização de pedidos concluída com sucesso NESTA loja
  if (!shopify?.conectada) {
    faltando.push({ chave: 'shopify', texto: 'Shopify conectada nesta loja' })
  } else if (!sincronizacao || sincronizacao.ok !== true) {
    faltando.push({
      chave: 'sincronizacao',
      texto: sincronizacao?.erro
        ? `sincronização de pedidos concluída com sucesso (última falhou: ${sincronizacao.erro})`
        : 'sincronização de pedidos concluída com sucesso nesta loja',
    })
  }

  const cupons = conferirCupons({ cupons: loja?.cupons ?? {}, pctsUsados, verificacao: verificacaoCupons, lojaId })
  if (cupons.ausentes.length) {
    faltando.push({ chave: 'cupons', texto: `cupom de ${cupons.ausentes.map(x => x + '%').join(', ')}` })
  }

  // moeda só vale para o automático (o piloto com aprovação mostra o valor na tela)
  const moeda = texto(loja?.moeda)
  const moedaOk = !!moeda && moedasValidas.includes(moeda)

  const faltandoAuto = [...faltando]
  if (!moedaOk) faltandoAuto.push({ chave: 'moeda', texto: 'moeda válida na loja (EUR, BRL, USD ou GBP)' })
  if (cupons.invalidos.length) {
    faltandoAuto.push({
      chave: 'cupons_invalidos',
      texto: `cupom inválido na Shopify: ${cupons.invalidos.map(i => `${i.pct}% (${i.detalhe})`).join('; ')}`,
    })
  }
  if (cupons.naoVerificados.length) {
    const t = `cupom não verificado na Shopify: ${cupons.naoVerificados.map(x => x + '%').join(', ')}`
    faltandoAuto.push({ chave: 'cupons_nao_verificados', texto: t })
    avisos.push({ chave: 'cupons_nao_verificados', texto: `${t} — o piloto com aprovação continua; o envio totalmente automático fica bloqueado.` })
  }
  for (const i of cupons.invalidos) {
    avisos.push({ chave: 'cupom_invalido', texto: `Cupom de ${i.pct}% (${i.codigo}): ${i.detalhe}.` })
  }

  return {
    pronto: faltando.length === 0,
    faltando,
    avisos,
    cupons: cupons.itens,
    automatico: { pronto: faltandoAuto.length === 0, faltando: faltandoAuto },
  }
}
