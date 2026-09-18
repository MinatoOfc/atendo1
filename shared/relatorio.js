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

/**
 * Números citados numa conversa (3 a 8 dígitos). Continua largo de propósito —
 * o resultado só vale depois de bater com um pedido REAL da mesma loja —, mas
 * nunca aceita percentual (100%), dinheiro (103,50) nem tamanho (4XL).
 */
export function numerosCitados(txt) {
  // 02.08.2026, 2/8/26, 2026-08-02 e 14:23:04 não são pedidos — e "2026" batia
  // com um pedido real da loja, derrubando a associação como se fosse ambígua
  const s = String(txt ?? '')
    .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
  const achados = new Set()
  for (const m of s.matchAll(/#?\b(\d{3,8})\b/g)) {
    if (numeroLimpo(s.slice(m.index + m[0].length))) achados.add(m[1])
  }
  return achados
}

// o que vem DEPOIS do número o desqualifica: "100%", "103,50", "4XL", "2.000"
const PROIBIDO_DEPOIS = /^(?:\s*%|[.,]\d|[A-Za-zÀ-ÖØ-öø-ÿ])/
const numeroLimpo = resto => !PROIBIDO_DEPOIS.test(String(resto ?? ''))

/**
 * Números de pedido ESCRITOS no texto do relatório. Só conta o que vem
 * acompanhado de uma palavra de contexto (pedido, order, Bestellung,
 * bestelling, commande, ordine) ou de "#" — e aceita vários no mesmo texto:
 *   "PEDIDO 2614 - TROCAR AS 2XL POR 4XL"  → ['2614']
 *   "PEDIDO 2673 E 2695 - TROCAR POR 4XL"  → ['2673', '2695']
 *   "REEMBOLSO 100%" / "TROCAR POR 4XL"    → []
 * CEP, telefone, data e dinheiro nunca entram: não têm palavra de contexto e
 * são barrados por numeroLimpo.
 */
export function numerosDePedidoNoTexto(txt) {
  const s = String(txt ?? '')
  const achados = []
  const guardar = n => { if (n && !achados.includes(n)) achados.push(n) }

  const palavra = /\b(?:pedidos?|orders?|bestellung(?:en)?|bestelling(?:en)?|commandes?|ordini|ordine)\b/gi
  let m
  while ((m = palavra.exec(s)) !== null) {
    const resto = s.slice(m.index + m[0].length)
    const primeiro = resto.match(/^[\s:;.\-–—]*(?:n[.ºo°]?|nr\.?|no\.?)?[\s#]*(\d{3,8})\b/i)
    if (!primeiro) continue
    let pos = primeiro[0].length
    if (!numeroLimpo(resto.slice(pos))) continue
    guardar(primeiro[1])
    // "2673 E 2695", "2673, 2695", "2673/2695" — só continua enquanto vier número
    for (;;) {
      const ligado = resto.slice(pos).match(/^\s*(?:e|und|and|en|et|ou|or|&|\+|,|;|\/)\s*#?\s*(\d{3,8})\b/i)
      if (!ligado) break
      pos += ligado[0].length
      if (!numeroLimpo(resto.slice(pos))) break
      guardar(ligado[1])
    }
  }
  // "PEDIU DUAS VEZES SEM QUERER 3085 E 3086": contexto claro de dois pedidos.
  // Só vale com a frase de duplicidade E dois números ligados por "e" — nunca um
  // número solto, e nunca percentual, dinheiro, data, CEP, telefone ou tamanho.
  const duplicidade = /\b(?:pediu|pedi|comprou|comprei|fez|realizou|feito|fizeram)\s+(?:duas|dois|2)\s+(?:vezes|pedidos)\b|\bem\s+duplicidade\b|\bpedido\s+duplicado\b/i
  const dupe = s.match(duplicidade)
  if (dupe) {
    const resto = s.slice(dupe.index + dupe[0].length)
    const par = resto.match(/(?:^|[^\d])#?\s?(\d{3,8})\s*(?:e|und|and|et|&|\+|,|\/)\s*#?\s*(\d{3,8})\b/i)
    if (par) {
      const fim = par.index + par[0].length
      const limpo = numeroLimpo(resto.slice(fim))
      // o primeiro número não pode ser percentual/dinheiro: confere o que vem logo depois dele
      const depoisDoPrimeiro = resto.slice(resto.indexOf(par[1], par.index) + par[1].length)
      if (limpo && numeroLimpo(depoisDoPrimeiro)) { guardar(par[1]); guardar(par[2]) }
    }
  }
  // "#2614" solto: o # já é marca de pedido
  for (const h of s.matchAll(/(?:^|[^\w#])#\s?(\d{3,8})\b/g)) {
    if (numeroLimpo(s.slice(h.index + h[0].length))) guardar(h[1])
  }
  return achados
}

/** Imagem utilizável: só catálogo (HTTPS) ou data:image das fixtures — nunca texto da conversa. */
export const imagemSegura = url => {
  const u = texto(url)
  if (!u) return null
  return /^https:\/\//i.test(u) || /^data:image\//i.test(u) ? u : null
}

const juntarNumeros = nums => {
  const arr = nums.map(n => '#' + n)
  if (arr.length <= 1) return arr[0] ?? ''
  return `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`
}

/** Título curto do pedido do caso: "Pedido #2614", "Pedidos #2673 e #2695" ou "Sem pedido informado". */
export function tituloDoPedido(itens = []) {
  if (!itens.length) return 'Sem pedido informado'
  const nums = itens.map(i => i.numero)
  return `${nums.length > 1 ? 'Pedidos' : 'Pedido'} ${juntarNumeros(nums)}`
}

/** Frase completa, com o aviso quando o número existe mas o pedido não está sincronizado. */
export function rotuloDoPedido(itens = []) {
  const titulo = tituloDoPedido(itens)
  if (!itens.length || itens.some(i => i.pedido)) return titulo
  return `${titulo} citado${itens.length > 1 ? 's' : ''} — dados não encontrados na Shopify`
}

/**
 * E-mail canônico, usado no relatório E na busca manual. O remetente do e-mail
 * vem como "Maria Silva <maria@email.com>", "<maria@email.com>" ou só o endereço
 * — comparar o campo inteiro com pedido.email nunca casava.
 */
export function emailCanonico(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  const entreAngulos = s.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/)
  const alvo = entreAngulos ? entreAngulos[1] : s
  const m = alvo.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)
  return m ? m[0] : null
}

/** Rastreio utilizável (a Shopify manda "—" quando não há). */
const rastreioDe = p => {
  const r = String(p?.rastreio ?? '').trim()
  return r && r !== '—' && r.length >= 6 ? r.toLowerCase() : null
}

/** Primeira mensagem do cliente (ISO) — base do desempate por data. */
function primeiraMensagemEm(t) {
  const doCliente = (t?.historico ?? []).filter(m => m?.autor === 'cliente' && m?.data)
  const datas = [...doCliente.map(m => m.data), t?.data].filter(Boolean).map(d => new Date(d).getTime()).filter(n => Number.isFinite(n))
  return datas.length ? Math.min(...datas) : null
}

/** O pedido menciona algum produto/variante citado no caso? */
function produtoBate(pedido, textoDoCaso, citados = []) {
  const alvo = norm(textoDoCaso)
  return (pedido?.itens ?? []).some(it => {
    const titulo = norm(it?.titulo)
    if (!titulo || titulo.length < 4) return false
    const variante = norm(it?.variante)
    const casaTexto = alvo.includes(titulo)
    const casaCitado = citados.some(c => norm(c).includes(titulo))
    if (!casaTexto && !casaCitado) return false
    // variante escrita (tamanho/cor) deixa o sinal mais forte, mas não é exigida
    return true || variante
  })
}

/** Rótulo de como o pedido foi encontrado — aparece no detalhe do caso. */
export const ROTULO_ORIGEM_PEDIDO = {
  manual: 'vínculo manual',
  detalhes: 'pedido já gravado no relatório',
  auto: 'conclusão automática do motor novo',
  linha: 'número escrito na linha do relatório',
  texto: 'número escrito no texto do relatório',
  conversa: 'número citado na conversa',
  rastreio: 'código de rastreio citado',
  email: 'e-mail do cliente (único pedido na loja)',
  email_numero: 'e-mail do cliente + número citado',
  email_rastreio: 'e-mail do cliente + código de rastreio',
  email_produto: 'e-mail do cliente + produto citado',
  email_data: 'e-mail do cliente + data da primeira mensagem',
  nome: 'nome do cliente (único pedido na loja)',
}

/**
 * Pedidos do caso: zero, um ou vários, SEMPRE da mesma loja. Ordem:
 *   1. vínculo manual gravado em relatorioDetalhes (nunca é sobrescrito)
 *   2. relatorioAuto.pedido (a conclusão automática já gravou qual era)
 *   3. id/número já gravado no relatório (sem vínculo manual)
 *   4. número escrito na linha final do dono
 *   5. número escrito no texto do relatório
 *   6. número citado no assunto, corpo ou histórico
 *   7. código de rastreio exato citado
 *   8. e-mail canônico do cliente
 *   9. nome exato do cliente, só como sinal auxiliar
 * Com vários pedidos do mesmo e-mail, desempata por número citado, rastreio,
 * produto citado e, por fim, pedido criado ANTES da primeira mensagem e mais
 * próximo dela. Sobrando empate, nada é escolhido: o caso fica sem pedido e os
 * candidatos vão para o modal de vínculo. Nunca associa pedido de outra loja.
 */
export function acharPedidos(t, pedidos = []) {
  const lojaId = t.lojaId ?? 'loja1'
  const daLoja = pedidos.filter(p => (p.lojaId ?? 'loja1') === lojaId)
  const det = t.relatorioDetalhes?.versao === 1 ? t.relatorioDetalhes : null
  const conversa = [t.assunto, t.corpo, t.resposta, t.resumoSituacao, ...(t.historico ?? []).map(m => m?.corpo)].filter(Boolean).join('\n')
  const resultado = (itens, origem, candidatos = []) => ({
    itens, origem, candidatos,
    pedidos: itens.map(i => i.pedido).filter(Boolean),
    numeros: itens.map(i => i.numero).filter(Boolean),
  })
  const um = (p, origem) => resultado([{ numero: soDigitos(p.numero), pedido: p }], origem)
  const vazio = (candidatos = []) => resultado([], null, candidatos)
  // um número só vira pedido quando existe UM pedido com ele nesta loja
  const porNumero = n => {
    const achados = daLoja.filter(p => soDigitos(p.numero) === n)
    return achados.length === 1 ? achados[0] : null
  }
  const deNumeros = (nums, origem) => {
    const itens = []
    for (const bruto of nums) {
      const n = soDigitos(bruto)
      if (!n || n.length < 3 || itens.some(i => i.numero === n)) continue
      itens.push({ numero: n, pedido: porNumero(n) })
    }
    return itens.length ? resultado(itens, origem) : null
  }
  const dosDetalhes = origem => {
    const ids = (Array.isArray(det?.pedidoIds) ? det.pedidoIds : (det?.pedidoId ? [det.pedidoId] : [])).filter(Boolean)
    const nums = (Array.isArray(det?.pedidoNumeros) ? det.pedidoNumeros : (det?.pedidoNumero ? [det.pedidoNumero] : [])).map(soDigitos).filter(Boolean)
    const itens = []
    for (const id of ids) {
      const p = daLoja.find(x => String(x.id) === String(id))
      if (p) itens.push({ numero: soDigitos(p.numero), pedido: p })
    }
    for (const n of nums) {
      if (itens.some(i => i.numero === n)) continue
      itens.push({ numero: n, pedido: porNumero(n) })
    }
    return itens.length ? resultado(itens, origem) : null
  }

  // 1) vínculo escolhido à mão: manda sempre, e a sincronização nunca o desfaz
  if (det?.vinculoManual) {
    const manual = dosDetalhes('manual')
    if (manual) return manual
  }
  // 2) conclusão automática
  const doAuto = deNumeros([t.relatorioAuto?.pedido].filter(Boolean), 'auto')
  if (doAuto) return doAuto
  // 3) id/número já gravado no relatório (caso já estruturado continua igual)
  const gravado = dosDetalhes('detalhes')
  if (gravado?.pedidos.length) return gravado
  // 4) linha final editada à mão — tem prioridade sobre o texto antigo
  const daLinha = deNumeros(numerosDePedidoNoTexto(t.relatorioLinha), 'linha')
  if (daLinha) return daLinha
  // 5) texto escolhido no popup
  const doTexto = deNumeros(numerosDePedidoNoTexto(t.relatorioTexto), 'texto')
  if (doTexto) return doTexto
  // 6) números citados na conversa. Primeiro os ESCRITOS com palavra de pedido ou
  // "#" ("Bestellung #2206"): endereço, CEP e data não competem com eles.
  const escritos = numerosDePedidoNoTexto(conversa)
  if (escritos.length) {
    const achados = daLoja.filter(p => escritos.includes(soDigitos(p.numero)))
    if (achados.length === 1) return um(achados[0], 'conversa')
    if (achados.length > 1) return vazio(achados)
  }
  // depois qualquer número solto, que só vale se um único pedido bater
  const citadosNaConversa = numerosCitados(conversa)
  if (citadosNaConversa.size) {
    const achados = daLoja.filter(p => citadosNaConversa.has(soDigitos(p.numero)))
    if (achados.length === 1) return um(achados[0], 'conversa')
    if (achados.length > 1) return vazio(achados) // ambíguo: o dono decide
  }
  // 7) código de rastreio exato citado no caso
  const textoBusca = norm(conversa).replace(/\s+/g, ' ')
  const porRastreio = daLoja.filter(p => { const r = rastreioDe(p); return r && textoBusca.includes(norm(r)) })
  if (porRastreio.length === 1) return um(porRastreio[0], 'rastreio')
  // 8) e-mail canônico do cliente
  const email = emailCanonico(t.de)
  const porEmail = email ? daLoja.filter(p => emailCanonico(p.email) === email) : []
  if (porEmail.length === 1) return um(porEmail[0], 'email')
  if (porEmail.length > 1) {
    // a) número citado em qualquer lugar do caso
    const numeros = new Set([...citadosNaConversa, ...numerosDePedidoNoTexto(t.relatorioLinha), ...numerosDePedidoNoTexto(t.relatorioTexto)].map(soDigitos))
    let cand = porEmail.filter(p => numeros.has(soDigitos(p.numero)))
    if (cand.length === 1) return um(cand[0], 'email_numero')
    // b) código de rastreio citado
    cand = porEmail.filter(p => { const r = rastreioDe(p); return r && textoBusca.includes(norm(r)) })
    if (cand.length === 1) return um(cand[0], 'email_rastreio')
    // c) produto, SKU ou variante citados
    const citadosProduto = (t.relatorioAuto?.produtos?.length ? t.relatorioAuto.produtos : t.atendimentoNovo?.produtosAfetados) ?? []
    cand = porEmail.filter(p => produtoBate(p, conversa, citadosProduto))
    if (cand.length === 1) return um(cand[0], 'email_produto')
    // d) pedido criado ANTES da primeira mensagem e mais próximo dela
    const marco = primeiraMensagemEm(t)
    if (marco != null) {
      const antes = porEmail
        .map(p => ({ p, quando: new Date(`${String(p.criadoEm ?? '').slice(0, 10)}T12:00:00`).getTime() }))
        .filter(x => Number.isFinite(x.quando) && x.quando <= marco)
        .sort((a, b) => (marco - a.quando) - (marco - b.quando))
      if (antes.length === 1) return um(antes[0].p, 'email_data')
      if (antes.length > 1 && antes[0].quando !== antes[1].quando) return um(antes[0].p, 'email_data')
    }
    return vazio(porEmail) // empate de verdade: o dono escolhe no modal
  }
  // 9) nome exato do cliente, só como sinal auxiliar
  const nome = norm(t.nome).trim()
  if (nome.length > 4) {
    const porNome = daLoja.filter(p => norm(p.cliente).trim() === nome)
    if (porNome.length === 1) return um(porNome[0], 'nome')
    if (porNome.length > 1) return vazio(porNome)
  }
  // nada provado: se havia número gravado sem pedido, ele continua aparecendo
  return gravado ?? vazio()
}

/** Compatibilidade: o pedido único do caso (null quando são vários ou nenhum). */
export function acharPedido(t, pedidos = []) {
  const achados = acharPedidos(t, pedidos).pedidos
  return achados.length === 1 ? achados[0] : null
}

/** Cliente: prefere o do pedido; senão o do ticket. Nunca inventa. */
export function clienteDoCaso(t, pedido) {
  return {
    nome: texto(pedido?.cliente) ?? texto(t.nome) ?? null,
    // sempre o endereço limpo: "Maria <maria@x.com>" vira "maria@x.com"
    email: texto(pedido?.email) ?? emailCanonico(t.de) ?? texto(t.de) ?? null,
  }
}

/**
 * Imagem de um item do pedido, sempre pelo catálogo da MESMA loja:
 *   1. produtoId + varianteId
 *   2. produtoId + imagem principal
 *   3. pedido histórico sem produtoId: título EXATO e ÚNICO na loja
 *   4. nada (a página mostra o ícone neutro)
 * Não existe correspondência aproximada: título repetido na loja fica sem foto.
 */
export function imagemDoItem(item, lojaId, produtos = []) {
  const daLoja = produtos.filter(x => (x.lojaId ?? 'loja1') === (lojaId ?? 'loja1'))
  if (item?.produtoId) {
    const p = daLoja.find(x => String(x.id) === String(item.produtoId))
    if (p) {
      if (item.varianteId && p.imagemPorVariante) {
        const daVariante = imagemSegura(p.imagemPorVariante[String(item.varianteId)])
        if (daVariante) return daVariante
      }
      const doProduto = imagemSegura(p.imagem)
      if (doProduto) return doProduto
    }
  }
  // registro antigo: só casa quando o título bate exatamente e não se repete
  const alvo = norm(item?.titulo)
  if (!alvo) return null
  const iguais = daLoja.filter(x => norm(x.titulo) === alvo)
  return iguais.length === 1 ? imagemSegura(iguais[0].imagem) : null
}

/**
 * Produtos do caso: os comprovadamente relacionados (detalhes salvos, produtos
 * do motor novo ou do relatorioAuto), casados com os itens do pedido. Sem
 * nenhuma correspondência, devolve os itens do pedido — que é o que o caso
 * realmente envolve. NUNCA grava nada no estado do motor.
 */
export function produtosDoCaso(t, pedido, produtos = []) {
  const lojaId = t.lojaId ?? 'loja1'
  // um pedido, vários pedidos ou nenhum: os itens de todos entram na mesma lista
  const lista = Array.isArray(pedido) ? pedido.filter(Boolean) : (pedido ? [pedido] : [])
  const itens = lista.flatMap(p => p?.itens ?? [])
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

  // pedidos do caso: zero, um ou vários, sempre da mesma loja (ver acharPedidos)
  const encontro = acharPedidos(t, pedidos)
  const localizados = encontro.pedidos
  const pedido = localizados.length === 1 ? localizados[0] : null
  const doCliente = localizados[0] ?? null

  const cliente = {
    nome: texto(det?.clienteNome) ?? clienteDoCaso(t, doCliente).nome,
    email: texto(det?.clienteEmail) ?? clienteDoCaso(t, doCliente).email,
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
  // com mais de um pedido nada é somado: a base do cálculo deixa de ser inequívoca
  const valorPedido = localizados.length > 1 ? null : (numero(pedido?.valor) ?? numero(det?.valorPedido) ?? null)

  // VALOR: só quando há prova. Automático usa o valor exato gravado; manual usa o
  // salvo; textual calcula com UM pedido localizado E percentual explícito, sempre
  // sobre o total realmente pago (pedido.valor = total_price). Cupom nunca.
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
    pedidoId: pedido?.id ?? null,
    pedidoNumero: encontro.itens.length === 1 ? encontro.itens[0].numero : null,
    pedidoLocalizado: localizados.length > 0,
    // zero, um ou vários: o número escrito pelo dono aparece mesmo sem o pedido sincronizado
    pedidos: encontro.itens.map(i => ({ id: i.pedido?.id ?? null, numero: i.numero, valor: numero(i.pedido?.valor), moeda, localizado: !!i.pedido })),
    pedidoNumeros: encontro.numeros,
    pedidosSemDados: encontro.itens.filter(i => !i.pedido).map(i => i.numero),
    // o pedido pode estar num e-mail diferente do remetente (gmail x googlemail)
    emailRemetente: emailCanonico(t.de),
    emailDiferenteDoPedido: !!(pedido?.email && emailCanonico(t.de) && emailCanonico(pedido.email) !== emailCanonico(t.de)),
    pedidoTitulo: tituloDoPedido(encontro.itens),
    rotuloPedido: rotuloDoPedido(encontro.itens),
    origemPedido: encontro.origem,
    rotuloOrigemPedido: encontro.origem ? (ROTULO_ORIGEM_PEDIDO[encontro.origem] ?? encontro.origem) : null,
    // quando nada foi provado: os pedidos que o dono pode escolher no modal
    candidatos: (encontro.candidatos ?? []).map(p => ({
      id: p.id, numero: soDigitos(p.numero), valor: numero(p.valor), moeda,
      cliente: texto(p.cliente), email: emailCanonico(p.email), criadoEm: texto(p.criadoEm),
    })),
    clienteNome: cliente.nome, clienteEmail: cliente.email,
    tipo, acoes: acoesDoCaso({ tipo, percentual: percentualFinal, tipoAuto }),
    descricao,
    percentual: percentualFinal, valor, moeda, valorPedido,
    cupom: texto(auto?.cupom) ?? null,
    produtos: produtosDoCaso(t, localizados, produtos),
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

/** Precisa de vínculo manual? Nenhum pedido localizado — com ou sem número escrito. */
export function precisaVinculo(caso) {
  return !caso?.pedidoLocalizado
}

/**
 * O que já vai escrito na busca do vínculo manual: o número citado quando
 * existe; senão o e-mail do cliente; senão o nome. Nunca inventa nada.
 */
export function buscaInicialVinculo(caso) {
  const numero = caso?.pedidosSemDados?.[0] ?? caso?.pedidoNumeros?.[0] ?? null
  return texto(numero) ?? texto(caso?.clienteEmail) ?? texto(caso?.clienteNome) ?? ''
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

const casaBusca = (c, q) => !q || norm([c.pedidoNumero, ...(c.pedidoNumeros ?? []), c.clienteNome, c.clienteEmail, c.lojaNome, c.descricao, ...c.produtos.map(p => `${p.titulo} ${p.variante ?? ''}`)].filter(Boolean).join(' ')).includes(norm(q))

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
  const previsto = new Map()
  const feito = new Map()
  for (const c of casos) {
    if (c.tipo === 'cupom' || c.valor == null) continue
    if (!c.acoes.includes('reembolso') && c.tipo !== 'cancelamento') continue
    const m = c.moeda ?? '—'
    porMoeda.set(m, arredondar((porMoeda.get(m) ?? 0) + c.valor))
    // pendente é PREVISÃO: uma oferta aceita ainda não é dinheiro devolvido
    const alvo = c.processado ? feito : previsto
    alvo.set(m, arredondar((alvo.get(m) ?? 0) + c.valor))
  }
  const emLista = mapa => [...mapa.entries()].map(([moeda, valor]) => ({ moeda, valor })).sort((a, b) => a.moeda.localeCompare(b.moeda))
  return {
    total: casos.length,
    pendentes: casos.filter(c => !c.processado).length,
    processados: casos.filter(c => c.processado).length,
    reembolsos: casos.filter(c => c.acoes.includes('reembolso')).length,
    trocasReenvios: casos.filter(c => c.acoes.includes('troca') || c.acoes.includes('reenvio')).length,
    valorPorMoeda: emLista(porMoeda),
    previstoPorMoeda: emLista(previsto),
    reembolsadoPorMoeda: emLista(feito),
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
          c.pedidoNumeros?.length ? `PEDIDO${c.pedidoNumeros.length > 1 ? 'S' : ''} ${c.pedidoNumeros.join(' E ')}` : (c.clienteNome ? c.clienteNome.toUpperCase() : 'SEM PEDIDO'),
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
