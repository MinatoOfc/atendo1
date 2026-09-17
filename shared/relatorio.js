/**
 * Normalizador ÚNICO do relatório diário.
 *
 * A página externa (/r/:wsId/:token), o relatório interno e os testes usam
 * exatamente estas funções — nada é recalculado no navegador. A regra número um
 * é NÃO INVENTAR: quando o pedido não é localizado com segurança, ou quando a
 * base de cálculo é ambígua, o valor sai como null e a página mostra
 * "Valor não registrado" (nunca zero, nunca um número deduzido).
 *
 * Nada aqui altera o motor, as fases, as ofertas ou o estado do atendimento: a
 * associação de pedido, cliente e produto existe SÓ para exibir o relatório.
 */

export const TIPOS_RELATORIO = ['reembolso', 'troca', 'reenvio', 'cancelamento', 'cupom', 'outro']

/** Etiqueta e cor de cada tipo (as cores são as etiquetas padrão do Atendo). */
export const ROTULO_TIPO = {
  reembolso: 'Reembolso', troca: 'Troca', reenvio: 'Reenvio',
  cancelamento: 'Cancelamento', cupom: 'Cupom', outro: 'Outro',
}

const SIMBOLO = { EUR: '€', BRL: 'R$', USD: 'US$', GBP: '£' }
export const dinheiro = (valor, moeda) => valor == null
  ? 'Valor não registrado'
  : `${(SIMBOLO[moeda] ?? moeda ?? '')} ${Number(valor).toFixed(2).replace('.', ',')}`.trim()

const texto = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
// null/undefined/'' NÃO são zero: sem número, é null (a página mostra "não registrado")
const numero = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const arredondar = v => (v == null ? null : Math.round(Number(v) * 100) / 100)
const soDigitos = v => String(v ?? '').replace(/\D/g, '')
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Números de pedido citados no texto (3 a 8 dígitos, como no resto do sistema). */
export function numerosCitados(txt) {
  const achados = new Set()
  for (const m of String(txt ?? '').matchAll(/#?\b(\d{3,8})\b/g)) achados.add(m[1])
  return achados
}

/** Imagem utilizável: só catálogo (HTTPS) ou data:image das fixtures — nunca texto da conversa. */
export const imagemSegura = url => {
  const u = texto(url)
  if (!u) return null
  return /^https:\/\//i.test(u) || /^data:image\//i.test(u) ? u : null
}

/**
 * Pedido do caso, nesta ordem:
 *   1. relatorioAuto.pedido (a conclusão automática já gravou qual era)
 *   2. número citado explicitamente na conversa
 *   3. pedido da MESMA loja com o mesmo e-mail
 *   4. pedido mais recente da mesma loja, só quando não houver ambiguidade
 * Nunca associa pedido de outra loja.
 */
export function acharPedido(t, pedidos = []) {
  const lojaId = t.lojaId ?? 'loja1'
  const daLoja = pedidos.filter(p => (p.lojaId ?? 'loja1') === lojaId)
  if (!daLoja.length) return null

  // 1) o que a conclusão automática gravou
  const doAuto = soDigitos(t.relatorioAuto?.pedido)
  if (doAuto) {
    const achado = daLoja.find(p => soDigitos(p.numero) === doAuto)
    if (achado) return achado
  }
  // 2) número citado na conversa
  const conversa = [t.assunto, t.corpo, t.resposta, ...(t.historico ?? []).map(m => m.corpo)].join('\n')
  const citados = numerosCitados(conversa)
  if (citados.size) {
    const achados = daLoja.filter(p => citados.has(soDigitos(p.numero)))
    if (achados.length === 1) return achados[0]
    if (achados.length > 1) return null // ambíguo: melhor não associar
  }
  // 3) mesmo e-mail na mesma loja
  const email = norm(t.de).trim()
  if (email) {
    const porEmail = daLoja.filter(p => norm(p.email).trim() === email)
    if (porEmail.length === 1) return porEmail[0]
    if (porEmail.length > 1) {
      // vários pedidos do mesmo cliente: só o mais recente, e só se as datas desempatarem
      const ordenados = [...porEmail].sort((a, b) => String(b.criadoEm ?? '').localeCompare(String(a.criadoEm ?? '')))
      if (String(ordenados[0].criadoEm ?? '') !== String(ordenados[1].criadoEm ?? '')) return ordenados[0]
      return null
    }
  }
  return null
}

/** Cliente: prefere o do pedido; senão o do ticket. Nunca inventa. */
export function clienteDoCaso(t, pedido) {
  return {
    nome: texto(pedido?.cliente) ?? texto(t.nome) ?? null,
    email: texto(pedido?.email) ?? texto(t.de) ?? null,
  }
}

/** Imagem de um item do pedido, pelo catálogo da MESMA loja (variante → produto → nada). */
export function imagemDoItem(item, lojaId, produtos = []) {
  if (!item?.produtoId) return null
  const p = produtos.find(x => String(x.id) === String(item.produtoId) && (x.lojaId ?? 'loja1') === (lojaId ?? 'loja1'))
  if (!p) return null
  if (item.varianteId && p.imagemPorVariante) {
    const daVariante = imagemSegura(p.imagemPorVariante[String(item.varianteId)])
    if (daVariante) return daVariante
  }
  return imagemSegura(p.imagem)
}

/**
 * Produtos do caso: os comprovadamente relacionados (detalhes salvos, produtos
 * do motor novo ou do relatorioAuto), casados com os itens do pedido. Sem
 * nenhuma correspondência, devolve os itens do pedido — que é o que o caso
 * realmente envolve. NUNCA grava nada no estado do motor.
 */
export function produtosDoCaso(t, pedido, produtos = []) {
  const lojaId = t.lojaId ?? 'loja1'
  const itens = pedido?.itens ?? []
  const comImagem = it => ({
    produtoId: it.produtoId ?? null, varianteId: it.varianteId ?? null,
    titulo: texto(it.titulo) ?? 'Produto', variante: texto(it.variante),
    quantidade: numero(it.quantidade) ?? 1,
    imagem: imagemDoItem(it, lojaId, produtos),
  })
  // 1) detalhes estruturados já gravados pelo dono
  const salvos = t.relatorioDetalhes?.produtos
  if (Array.isArray(salvos) && salvos.length) {
    return salvos.map(p => {
      const item = itens.find(i => (p.varianteId && String(i.varianteId) === String(p.varianteId)) || norm(i.titulo) === norm(p.titulo))
      return {
        produtoId: p.produtoId ?? item?.produtoId ?? null, varianteId: p.varianteId ?? item?.varianteId ?? null,
        titulo: texto(p.titulo) ?? texto(item?.titulo) ?? 'Produto',
        variante: texto(p.variante) ?? texto(item?.variante),
        quantidade: numero(p.quantidade) ?? numero(item?.quantidade) ?? 1,
        imagem: imagemSegura(p.imagem) ?? (item ? imagemDoItem(item, lojaId, produtos) : null),
      }
    })
  }
  // 2) produtos citados pelo cliente (motor novo) ou gravados pela conclusão automática
  const citados = (t.relatorioAuto?.produtos?.length ? t.relatorioAuto.produtos : t.atendimentoNovo?.produtosAfetados) ?? []
  if (citados.length && itens.length) {
    const casados = citados.map(rotulo => itens.find(i => {
      const cheio = norm(`${i.titulo}${i.variante ? ` (${i.variante})` : ''}`)
      return cheio === norm(rotulo) || norm(rotulo).includes(norm(i.titulo))
    })).filter(Boolean)
    if (casados.length) return [...new Set(casados)].map(comImagem)
  }
  // 3) itens do pedido
  return itens.map(comImagem)
}

/** Percentual explícito no texto do relatório (só quando está escrito lá). */
export function percentualDoTexto(txt) {
  const m = String(txt ?? '').match(/(\d{1,3})\s*%/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 100 ? n : null
}

/** Tipo da solução a partir do texto do relatório (conservador). */
export function tipoDoTexto(txt) {
  const s = norm(txt)
  if (!s) return null
  if (/cancel/.test(s)) return 'cancelamento'
  if (/reenvi|reenvio|resend/.test(s)) return 'reenvio'
  if (/troca|umtausch|exchange/.test(s)) return 'troca'
  if (/cupom|cupao|gutschein|coupon|desconto/.test(s)) return 'cupom'
  if (/reembols|estorno|refund|ruckerstattung|ruckerstattung/.test(s)) return 'reembolso'
  return null
}

/** Ações da solução (troca + reembolso parcial mostra as duas). */
function acoesDoCaso({ tipo, percentual, tipoAuto }) {
  const acoes = []
  const base = tipoAuto ?? tipo
  if (base === 'troca' || base === 'reenvio') acoes.push(base)
  if (base === 'cancelamento') acoes.push('cancelamento')
  if (base === 'cupom') acoes.push('cupom')
  if (percentual != null && base !== 'cupom') acoes.push('reembolso')
  if (!acoes.length && base) acoes.push(base)
  return [...new Set(acoes)]
}

/**
 * Normaliza UM caso do relatório. Devolve sempre os mesmos campos, com null
 * onde não há prova. `agora` só entra em testes determinísticos.
 */
export function normalizarCaso(t, { pedidos = [], lojas = [], produtos = [], fases = {} } = {}) {
  const lojaId = t.lojaId ?? 'loja1'
  const loja = lojas.find(l => l.id === lojaId) ?? null
  const det = t.relatorioDetalhes?.versao === 1 ? t.relatorioDetalhes : null
  const auto = t.relatorioAuto ?? null

  // pedido: o dos detalhes salvos (quando ainda existe) tem prioridade sobre a busca
  const pedido = (det?.pedidoId && pedidos.find(p => p.id === det.pedidoId && (p.lojaId ?? 'loja1') === lojaId))
    || acharPedido(t, pedidos)

  const cliente = {
    nome: texto(det?.clienteNome) ?? clienteDoCaso(t, pedido).nome,
    email: texto(det?.clienteEmail) ?? clienteDoCaso(t, pedido).email,
  }
  const linha = texto(t.relatorioLinha)
  const descricao = linha ?? texto(t.relatorioTexto) ?? texto(t.resolucao) ?? texto(t.resumoSituacao) ?? 'Atendido'

  // tipo e percentual: automático > detalhes salvos > texto explícito
  const tipoAuto = auto ? (auto.trocaOuReenvio ? (/reenvio/.test(auto.trocaOuReenvio) ? 'reenvio' : 'troca') : tipoDoTexto(auto.solucao) ?? 'reembolso') : null
  const tipo = tipoAuto ?? det?.tipo ?? tipoDoTexto(t.relatorioTexto) ?? tipoDoTexto(t.resolucao) ?? tipoDoTexto(linha) ?? 'outro'
  const percentual = auto ? numero(auto.percentual)
    : det ? numero(det.percentual)
      : percentualDoTexto(t.relatorioTexto) ?? percentualDoTexto(linha)

  // moeda: da conclusão automática, dos detalhes, ou da loja
  const moeda = texto(auto?.moeda) ?? texto(det?.moeda) ?? texto(loja?.moeda) ?? null
  const valorPedido = numero(pedido?.valor) ?? numero(det?.valorPedido) ?? null

  // VALOR: só quando há prova. Automático usa o valor exato gravado; manual usa o
  // salvo; textual só calcula com pedido localizado E percentual explícito. Cupom nunca.
  let valor = null
  if (tipo !== 'cupom') {
    if (auto && numero(auto.valor) != null) valor = arredondar(auto.valor)
    else if (det && numero(det.valor) != null) valor = arredondar(det.valor)
    else if (percentual != null && valorPedido != null) valor = arredondar(valorPedido * percentual / 100)
    else if (tipo === 'cancelamento' && percentual == null && valorPedido != null && /integral|total|100/.test(norm(descricao))) valor = arredondar(valorPedido)
  }
  const percentualFinal = percentual ?? (tipo === 'cancelamento' && valor != null && valorPedido != null && valor === valorPedido ? 100 : null)

  return {
    ticketId: t.id,
    dia: t.relatorioDia ?? null,
    lojaId, lojaNome: texto(loja?.nome) ?? lojaId,
    pedidoId: pedido?.id ?? det?.pedidoId ?? null,
    pedidoNumero: pedido ? soDigitos(pedido.numero) : (soDigitos(det?.pedidoNumero) || soDigitos(auto?.pedido) || null),
    pedidoLocalizado: !!pedido,
    clienteNome: cliente.nome, clienteEmail: cliente.email,
    tipo, acoes: acoesDoCaso({ tipo, percentual: percentualFinal, tipoAuto }),
    descricao,
    percentual: percentualFinal, valor, moeda, valorPedido,
    cupom: texto(auto?.cupom) ?? null,
    produtos: produtosDoCaso(t, pedido, produtos),
    origem: auto ? 'motor_novo_automatico' : (det?.origem ?? 'manual'),
    processado: !!t.relatorioProcessado,
    processadoEm: texto(t.relatorioProcessado),
    confirmadoEm: texto(auto?.confirmacaoEnviadaEm) ?? null,
    incluidoEm: texto(det?.criadoEm) ?? texto(auto?.confirmacaoEnviadaEm) ?? null,
    observacao: texto(det?.observacao) ?? null,
    faseAceita: texto(auto?.faseAceita) ?? null,
    faseTitulo: auto?.faseAceita ? (texto(fases[auto.faseAceita]?.titulo) ?? auto.faseAceita) : null,
  }
}

/** Filtros da página externa (validados; o resto cai no padrão). */
export function filtrosDoRelatorio(q = {}) {
  return {
    busca: String(q.busca ?? '').slice(0, 80),
    loja: String(q.loja ?? 'todas'),
    tipo: TIPOS_RELATORIO.includes(String(q.tipo)) ? String(q.tipo) : 'todos',
    situacao: ['pendentes', 'processados'].includes(String(q.situacao)) ? String(q.situacao) : 'todas',
    dia: /^\d{4}-\d{2}-\d{2}$/.test(String(q.dia)) ? String(q.dia) : 'todos',
  }
}

const casaBusca = (c, q) => !q || norm([c.pedidoNumero, c.clienteNome, c.clienteEmail, c.lojaNome, c.descricao, ...c.produtos.map(p => `${p.titulo} ${p.variante ?? ''}`)].filter(Boolean).join(' ')).includes(norm(q))

/** Aplica os filtros a uma lista já normalizada. */
export function filtrarCasos(casos, f) {
  return casos.filter(c =>
    casaBusca(c, f.busca.trim())
    && (f.loja === 'todas' || c.lojaId === f.loja)
    && (f.tipo === 'todos' || c.tipo === f.tipo || c.acoes.includes(f.tipo))
    && (f.situacao === 'todas' || (f.situacao === 'processados' ? c.processado : !c.processado))
    && (f.dia === 'todos' || c.dia === f.dia))
}

/** Indicadores dos casos VISÍVEIS. Moedas nunca se somam: uma linha por moeda. */
export function indicadoresDoRelatorio(casos) {
  const porMoeda = new Map()
  for (const c of casos) {
    if (c.tipo === 'cupom' || c.valor == null) continue
    if (!c.acoes.includes('reembolso') && c.tipo !== 'cancelamento') continue
    const m = c.moeda ?? '—'
    porMoeda.set(m, arredondar((porMoeda.get(m) ?? 0) + c.valor))
  }
  return {
    total: casos.length,
    pendentes: casos.filter(c => !c.processado).length,
    processados: casos.filter(c => c.processado).length,
    reembolsos: casos.filter(c => c.acoes.includes('reembolso')).length,
    trocasReenvios: casos.filter(c => c.acoes.includes('troca') || c.acoes.includes('reenvio')).length,
    valorPorMoeda: [...porMoeda.entries()].map(([moeda, valor]) => ({ moeda, valor })).sort((a, b) => a.moeda.localeCompare(b.moeda)),
    semValor: casos.filter(c => c.acoes.includes('reembolso') && c.valor == null).length,
  }
}

/** Agrupa por dia (mais recente primeiro) e, dentro do dia, por loja. */
export function agruparPorDia(casos) {
  const dias = new Map()
  for (const c of casos) {
    if (!c.dia) continue
    if (!dias.has(c.dia)) dias.set(c.dia, [])
    dias.get(c.dia).push(c)
  }
  return [...dias.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([dia, lista]) => {
    const lojas = new Map()
    for (const c of lista) {
      if (!lojas.has(c.lojaNome)) lojas.set(c.lojaNome, [])
      lojas.get(c.lojaNome).push(c)
    }
    return { dia, indicadores: indicadoresDoRelatorio(lista), lojas: [...lojas.entries()].map(([nome, casos]) => ({ nome, casos })) }
  })
}

/**
 * Tudo o que a página externa precisa, já filtrado e agrupado. `hoje` e
 * `mostrarHoje` reproduzem a regra antiga: com "mostrar hoje" desligado, o dia
 * atual só entra depois da meia-noite.
 */
export function dadosDoRelatorio({ tickets = [], pedidos = [], lojas = [], produtos = [], fases = {}, filtros, hoje = null, mostrarHoje = true, limiteDias = 60 }) {
  const f = filtros ?? filtrosDoRelatorio({})
  const doRelatorio = tickets.filter(t => t.relatorioDia && (mostrarHoje || t.relatorioDia !== hoje))
  const todos = doRelatorio.map(t => normalizarCaso(t, { pedidos, lojas, produtos, fases }))
  const diasPermitidos = new Set([...new Set(todos.map(c => c.dia))].sort().reverse().slice(0, limiteDias))
  const visiveis = filtrarCasos(todos.filter(c => diasPermitidos.has(c.dia)), f)
  return {
    filtros: f,
    lojas: lojas.map(l => ({ id: l.id, nome: l.nome, moeda: l.moeda ?? 'EUR' })),
    indicadores: indicadoresDoRelatorio(visiveis),
    dias: agruparPorDia(visiveis),
    totalDias: diasPermitidos.size,
    totalCasos: todos.filter(c => diasPermitidos.has(c.dia)).length,
  }
}

/** Texto para "copiar relatório" — pedido, cliente, produto, ação, percentual e valor quando existirem. */
export function textoParaCopiar(dias) {
  return dias.map(({ dia, lojas }) => {
    const [ano, mes, d] = dia.split('-')
    const corpo = lojas.map(({ nome, casos }) => [
      `Loja: ${nome}`,
      ...casos.map(c => {
        const partes = [
          c.pedidoNumero ? `PEDIDO ${c.pedidoNumero}` : (c.clienteNome ? c.clienteNome.toUpperCase() : 'SEM PEDIDO'),
          c.descricao,
          c.clienteNome || c.clienteEmail ? `cliente: ${[c.clienteNome, c.clienteEmail].filter(Boolean).join(' / ')}` : null,
          c.produtos.length ? `produto: ${c.produtos.map(p => `${p.titulo}${p.variante ? ` (${p.variante})` : ''}${p.quantidade > 1 ? ` x${p.quantidade}` : ''}`).join('; ')}` : null,
          c.percentual != null ? `${c.percentual}%` : null,
          c.valor != null ? dinheiro(c.valor, c.moeda) : (c.acoes.includes('reembolso') ? 'Valor não registrado' : null),
          c.processado ? 'processado' : 'pendente',
        ].filter(Boolean)
        return `- ${partes.join(' — ')}`
      }),
    ].join('\n')).join('\n\n')
    return `RELATÓRIO ${d}/${mes}/${ano}\n\n${corpo}`
  }).join('\n\n\n')
}
