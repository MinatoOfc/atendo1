/**
 * Prontidão REAL do modo novo — lógica pura, sem rede e sem estado global.
 *
 * Dois níveis, porque são decisões diferentes:
 *   1. `prontidao`  → a loja pode rodar o modo novo COM aprovação humana;
 *   2. `automatico` → a loja pode concluir SOZINHA, sem o dono olhar.
 *
 * Para a MENSAGEM a régua é outra e é sempre a mais dura: só um cupom conferido
 * na Shopify, dentro da validade, entra em prompt, rascunho ou e-mail. Ausente,
 * não verificado, vencido, inválido ou de outra loja param a fase — o caso vai
 * para Aprovações com o motivo exato, e nenhuma oferta é pulada.
 *
 * `agora` entra como argumento em tudo que depende de tempo, para os testes
 * serem determinísticos.
 *
 * Nada aqui conhece fases, ofertas, percentuais ou idiomas: os percentuais em
 * uso chegam prontos de quem chama (server/atendimento.js é a fonte).
 */

/** Cupom citado no Miro como observação — nenhuma fase do fluxo usa. */
export const PCT_CUPOM_RESERVA = 10

/** Uma conferência não vale para sempre: 24 h para cupons e para a sincronização. */
export const VALIDADE_VERIFICACAO_MS = 24 * 3600_000

export const SITUACAO_CUPOM = {
  ok: 'confere na Shopify',
  ausente: 'não cadastrado no Atendo',
  nao_verificado: 'cupom não verificado na Shopify',
  vencida: 'verificação vencida (mais de 24 h)',
  inexistente: 'não existe na Shopify',
  percentual_divergente: 'percentual diferente do cadastrado',
  incompativel: 'tipo de desconto incompatível (só cupom de percentual)',
  expirado: 'expirado na Shopify',
  nao_iniciado: 'ainda não começou a valer',
  inativo: 'desativado na Shopify',
  esgotado: 'limite de usos atingido',
  erro: 'não foi possível verificar',
  outra_loja: 'verificação é de outra loja',
}

const texto = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Situações que provam que o código NÃO serve. Nunca entram numa mensagem. */
export const SITUACOES_INVALIDAS = ['inexistente', 'percentual_divergente', 'incompativel', 'expirado', 'nao_iniciado', 'inativo', 'esgotado', 'outra_loja', 'erro']
/** Situações sem prova: também param a fase, mas são falta de conferência, não defeito. */
export const SITUACOES_SEM_PROVA = ['ausente', 'nao_verificado', 'vencida']

/** A conferência (cupons ou sincronização) ainda vale? */
export function verificacaoVencida(verificacao, agora = Date.now()) {
  const em = Date.parse(verificacao?.em ?? '')
  if (!Number.isFinite(em)) return true
  return agora - em > VALIDADE_VERIFICACAO_MS
}

/** Quando a conferência vence (ISO), ou null quando não há conferência. */
export function venceEm(verificacao) {
  const em = Date.parse(verificacao?.em ?? '')
  return Number.isFinite(em) ? new Date(em + VALIDADE_VERIFICACAO_MS).toISOString() : null
}

/**
 * Situação de um cupom, cruzando o que está cadastrado no Atendo com o
 * resultado da última verificação na Shopify DA MESMA LOJA, dentro da validade.
 */
export function estadoCupom(pct, codigo, verificacao = null, lojaId = null, agora = Date.now()) {
  const cod = texto(codigo)
  const base = {
    pct: Number(pct), codigo: cod, usadoPeloFluxo: true, reserva: false,
    verificadoEm: verificacao?.em ?? null, verificadoNaLoja: verificacao?.lojaId ?? null,
    valeAte: venceEm(verificacao), pctEncontrado: null,
  }
  if (!cod) return { ...base, situacao: 'ausente', detalhe: SITUACAO_CUPOM.ausente }
  // verificação de outra loja nunca vale: código nunca se mistura entre lojas
  if (verificacao && lojaId && verificacao.lojaId && verificacao.lojaId !== lojaId) {
    return { ...base, situacao: 'outra_loja', detalhe: SITUACAO_CUPOM.outra_loja }
  }
  if (!verificacao || verificacao.permissao === false || !Array.isArray(verificacao.itens)) {
    return { ...base, situacao: 'nao_verificado', detalhe: verificacao?.erro ?? SITUACAO_CUPOM.nao_verificado }
  }
  const achado = verificacao.itens.find(i => Number(i.pct) === Number(pct))
  if (!achado) return { ...base, situacao: 'nao_verificado', detalhe: SITUACAO_CUPOM.nao_verificado }
  // o código mudou depois da verificação: vale como não verificado, nunca como ok
  if (texto(achado.codigo)?.toUpperCase() !== cod.toUpperCase()) {
    return { ...base, situacao: 'nao_verificado', detalhe: 'o código mudou depois da última verificação' }
  }
  const completo = { ...base, pctEncontrado: achado.valor ?? null }
  // conferência antiga não prova nada sobre o cupom de hoje
  if (verificacaoVencida(verificacao, agora)) {
    return { ...completo, situacao: 'vencida', detalhe: SITUACAO_CUPOM.vencida }
  }
  return {
    ...completo,
    situacao: achado.situacao ?? 'erro',
    detalhe: achado.detalhe ?? SITUACAO_CUPOM[achado.situacao] ?? SITUACAO_CUPOM.erro,
  }
}

/**
 * Conferência dos cupons de uma loja.
 * `pctsUsados` são os percentuais que ALGUMA fase realmente usa; o de 10% entra
 * como reserva (aparece na lista, nunca vira requisito).
 */
export function conferirCupons({ cupons = {}, pctsUsados = [], verificacao = null, lojaId = null, agora = Date.now() } = {}) {
  const itens = pctsUsados.map(pct => estadoCupom(pct, cupons?.[String(pct)], verificacao, lojaId, agora))
  const reserva = texto(cupons?.[String(PCT_CUPOM_RESERVA)])
  itens.push({
    pct: PCT_CUPOM_RESERVA, codigo: reserva, usadoPeloFluxo: false, reserva: true,
    situacao: 'reserva', detalhe: 'reserva — não utilizado pelo fluxo',
    verificadoEm: null, verificadoNaLoja: null, valeAte: null, pctEncontrado: null,
  })
  const usados = itens.filter(i => i.usadoPeloFluxo)
  return {
    itens,
    ausentes: usados.filter(i => i.situacao === 'ausente').map(i => i.pct),
    invalidos: usados.filter(i => SITUACOES_INVALIDAS.includes(i.situacao)),
    naoVerificados: usados.filter(i => ['nao_verificado', 'vencida'].includes(i.situacao)).map(i => i.pct),
    verificados: usados.filter(i => i.situacao === 'ok').map(i => i.pct),
  }
}

/**
 * TRAVA DA MENSAGEM: o cupom pode ir para o prompt, o rascunho ou o e-mail?
 * Só quando a Shopify confirmou o código DESTA loja, com o percentual exato,
 * dentro das 24 h de validade. Qualquer outra coisa devolve `codigo: null` e o
 * motivo exato — quem chama para a fase e manda o caso para Aprovações.
 */
export function cupomParaMensagem({ pct, cupons = {}, verificacao = null, lojaId = null, agora = Date.now() } = {}) {
  if (pct == null) return { codigo: null, ok: true, precisa: false, situacao: 'sem_cupom', motivo: null }
  const e = estadoCupom(pct, cupons?.[String(pct)], verificacao, lojaId, agora)
  const comum = { precisa: true, pct: Number(pct), situacao: e.situacao, estado: e }
  if (e.situacao === 'ok') return { ...comum, codigo: e.codigo, ok: true, motivo: null }
  if (e.situacao === 'ausente') return { ...comum, codigo: null, ok: false, motivo: `o cupom de ${pct}% não está cadastrado nesta loja (Configurações → Loja)` }
  if (SITUACOES_SEM_PROVA.includes(e.situacao)) {
    return { ...comum, codigo: null, ok: false, motivo: `o cupom de ${pct}% ainda não foi conferido na Shopify (${e.detalhe}) — use "Testar cupons" em Configurações` }
  }
  return { ...comum, codigo: null, ok: false, motivo: `o cupom de ${pct}% não serve: ${e.detalhe}` }
}

/** A sincronização de pedidos desta loja está concluída E dentro da validade? */
export function sincronizacaoValida(sincronizacao, agora = Date.now()) {
  if (!sincronizacao || sincronizacao.ok !== true) return { ok: false, vencida: false }
  return { ok: !verificacaoVencida(sincronizacao, agora), vencida: verificacaoVencida(sincronizacao, agora) }
}

/**
 * Prontidão da loja. `shopify` e `sincronizacao` descrevem a integração DESTA
 * loja: `{ conectada }` e `{ ok, em, erro }` da última sincronização de pedidos.
 */
export function prontidaoDaLoja({
  loja = {}, emailOk = false, shopify = null, sincronizacao = null,
  verificacaoCupons = null, pctsUsados = [], moedasValidas = ['EUR', 'BRL', 'USD', 'GBP'],
  agora = Date.now(),
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
  const sync = sincronizacaoValida(sincronizacao, agora)
  if (!shopify?.conectada) {
    faltando.push({ chave: 'shopify', texto: 'Shopify conectada nesta loja' })
  } else if (!sync.ok) {
    faltando.push({
      chave: 'sincronizacao',
      texto: sync.vencida
        ? 'sincronização de pedidos vencida (mais de 24 h) — sincronize de novo'
        : sincronizacao?.erro
          ? `sincronização de pedidos concluída com sucesso (última falhou: ${sincronizacao.erro})`
          : 'sincronização de pedidos concluída com sucesso nesta loja',
    })
  }

  const cupons = conferirCupons({ cupons: loja?.cupons ?? {}, pctsUsados, verificacao: verificacaoCupons, lojaId, agora })
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
    avisos.push({ chave: 'cupons_nao_verificados', texto: `${t} — o piloto com aprovação continua, o envio totalmente automático fica bloqueado e as etapas com esse cupom param em Aprovações.` })
  }
  for (const i of cupons.invalidos) {
    avisos.push({ chave: 'cupom_invalido', texto: `Cupom de ${i.pct}% (${i.codigo}): ${i.detalhe}.` })
  }

  return {
    pronto: faltando.length === 0,
    faltando,
    avisos,
    cupons: cupons.itens,
    verificacaoCupons: verificacaoCupons
      ? { em: verificacaoCupons.em ?? null, lojaId: verificacaoCupons.lojaId ?? null, permissao: verificacaoCupons.permissao !== false, valeAte: venceEm(verificacaoCupons), vencida: verificacaoVencida(verificacaoCupons, agora), erro: verificacaoCupons.erro ?? null }
      : null,
    sincronizacao: sincronizacao
      ? { ...sincronizacao, valeAte: venceEm(sincronizacao), vencida: verificacaoVencida(sincronizacao, agora) }
      : null,
    automatico: { pronto: faltandoAuto.length === 0, faltando: faltandoAuto },
  }
}
