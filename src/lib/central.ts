/**
 * Central operacional — lógica pura sobre os dados que o app já tem.
 *
 * Um "caso" é uma conversa ligada a devolução/reembolso/entrega. Vem de três
 * origens, nesta ordem de prioridade (13.7):
 *  - manual:     o dono corrigiu a classificação na Central (t.centralAjuste)
 *  - confirmada: estado real do motor do modo novo (t.atendimentoNovo)
 *  - inferida:   caso do modo clássico, deduzido do relatório manual e do
 *                motivo já lido pelo relatório de reembolsos
 */
import type { Ticket, Pedido, Loja, FaseNovo } from '../store'

export type OrigemFase = 'confirmada' | 'inferida' | 'manual'
export type Desfecho = 'em_aberto' | 'reembolso' | 'troca' | 'reenvio' | 'cupom' | 'cancelamento' | 'encerrado'

export interface Caso {
  ticketId: string
  lojaId: string
  lojaNome: string
  moeda: string
  cliente: string
  pedidoNumero: string | null
  pedidoValor: number | null
  produto: string | null
  produtoIdentificado: boolean
  motivo: string | null
  jornada: string
  faseAtual: string | null
  faseTitulo: string
  origem: OrigemFase
  trilha: string[]
  desfecho: Desfecho
  percentual: number | null
  reembolsado: number | null
  concluido: boolean
  comVoce: boolean
  dataMs: number
  ajuste?: NonNullable<Ticket['centralAjuste']>
}

export const ORDEM_JORNADAS = ['entrada', 'tamanho', 'qualidade', 'defeito_errado', 'nao_recebido', 'cancelamento'] as const

const JORNADA_DO_FLUXO: Record<string, string> = {
  tamanho: 'tamanho', errado: 'defeito_errado', defeito: 'defeito_errado', qualidade: 'qualidade',
  nao_recebido_status: 'nao_recebido', nao_recebido_reembolso: 'nao_recebido', entregue_nao_recebido: 'nao_recebido',
  cancelamento: 'cancelamento',
}
const JORNADA_DA_CATEGORIA_MOTIVO: Record<string, string> = {
  qualidade: 'qualidade', nao_gostou: 'qualidade', tamanho: 'tamanho', defeito: 'defeito_errado', errado: 'defeito_errado',
  nao_recebeu: 'nao_recebido', atraso: 'nao_recebido', arrependimento: 'cancelamento',
}
const NOME_MOTIVO: Record<string, string> = {
  tamanho: 'tamanho não serviu', qualidade: 'qualidade/material', nao_gostou: 'não gostou', defeito: 'defeito',
  errado: 'produto errado', nao_recebido: 'não recebido', nao_informado: 'não informou',
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Pedido de uma conversa: número citado na mesma loja, senão o mais recente pelo e-mail. */
export function pedidoDaConversa(t: Ticket, pedidos: Pedido[]): Pedido | null {
  const lojaId = t.lojaId ?? 'loja1'
  const texto = [t.assunto, t.corpo, t.resposta, ...(t.historico?.map(m => m.corpo) ?? [])].join('\n').toLowerCase()
  const numeros = new Set<string>()
  for (const m of texto.matchAll(/(?:#\s?|\b(?:pedido|encomenda|order|bestell(?:ung|ing)?|bestelling|commande|ordine)\s*(?:nr\.?|n[º°o]\.?|#)?\s*)(\d{3,7})\b/g)) numeros.add(m[1])
  const daLoja = pedidos.filter(p => (p.lojaId ?? 'loja1') === lojaId)
  if (numeros.size) {
    const porNumero = daLoja.find(p => numeros.has(p.numero.replace(/\D/g, '')))
    if (porNumero) return porNumero
  }
  const email = t.de.trim().toLowerCase()
  return daLoja.filter(p => p.email && p.email.trim().toLowerCase() === email)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0] ?? null
}

function desfechoDaOferta(o: FaseNovo['oferta']): { desfecho: Desfecho; percentual: number | null } {
  if (!o) return { desfecho: 'em_aberto', percentual: null }
  if (o.tipo === 'reembolso') return { desfecho: 'reembolso', percentual: o.pct }
  if (o.tipo === 'cancelamento') return { desfecho: 'cancelamento', percentual: 100 }
  if (o.tipo === 'troca' || o.tipo === 'troca_reembolso') return { desfecho: 'troca', percentual: o.pct }
  if (o.tipo === 'reenvio' || o.tipo === 'reenvio_reembolso') return { desfecho: 'reenvio', percentual: o.pct }
  if (o.tipo === 'cupom') return { desfecho: 'cupom', percentual: null }
  return { desfecho: 'em_aberto', percentual: null }
}

/** Monta os casos a partir das conversas de TODAS as lojas. */
export function montarCasos(tickets: Ticket[], pedidos: Pedido[], lojas: Loja[], fases: Record<string, FaseNovo>): Caso[] {
  const casos: Caso[] = []
  for (const t of tickets) {
    if (t.status === 'spam' || t.status === 'lixeira') continue
    const an = t.atendimentoNovo
    const linha = t.relatorioLinha || t.relatorioTexto || t.resolucao || ''
    const ehCasoClassico = !!t.relatorioDia || t.categoria === 'reembolso' || t.categoria === 'troca' || !!t.motivoReembolso
    if (!an?.fluxo && !ehCasoClassico) continue

    const loja = lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
    const pedido = pedidoDaConversa(t, pedidos)
    const titulo = (id: string | null) => (id ? fases[id]?.titulo ?? id : 'Triagem')

    let jornada = 'entrada'
    let faseAtual: string | null = null
    let trilha: string[] = []
    let origem: OrigemFase = 'inferida'
    let desfecho: Desfecho = 'em_aberto'
    let percentual: number | null = null
    let motivo: string | null = null
    let produto: string | null = null
    let comVoce = false

    if (an?.fluxo) {
      origem = 'confirmada'
      jornada = JORNADA_DO_FLUXO[an.fluxo] ?? 'entrada'
      faseAtual = an.etapa
      trilha = an.historicoEtapas.filter(h => !h.evento).map(h => h.para)
      motivo = an.motivo ? NOME_MOTIVO[an.motivo] ?? an.motivo : null
      produto = an.produtosAfetados.length ? an.produtosAfetados.join('; ') : null
      comVoce = an.aguardando === 'humano'
      if (an.acaoAceita) {
        const d = desfechoDaOferta(fases[an.acaoAceita]?.oferta ?? null); desfecho = d.desfecho; percentual = d.percentual
      } else if (comVoce && /100\s*%/.test(t.resolucao ?? '')) { desfecho = 'reembolso'; percentual = 100; faseAtual = 'reemb_100'; if (!trilha.includes('reemb_100')) trilha = [...trilha, 'reemb_100'] }
      else if (comVoce && /Cancelamento/.test(t.resolucao ?? '')) { desfecho = 'cancelamento'; percentual = 100; faseAtual = 'cancel_nao_processado' }
      else if (t.status === 'enviado' && /^Encerrada/.test(t.resolucao ?? '')) desfecho = 'encerrado'
    } else {
      const cat = t.motivoReembolso?.categoria
      jornada = (cat && JORNADA_DA_CATEGORIA_MOTIVO[cat]) || 'entrada'
      motivo = t.motivoReembolso?.motivo ?? null
      const pct = linha.match(/(\d{1,3})\s*%/)
      if (/reembols|refund|estorno/i.test(linha)) { desfecho = 'reembolso'; percentual = pct ? Number(pct[1]) : null }
      else if (/reenvio|resend/i.test(linha)) desfecho = 'reenvio'
      else if (/troca|exchange|umtausch/i.test(linha)) desfecho = 'troca'
      else if (/cancel/i.test(linha)) { desfecho = 'cancelamento'; percentual = 100 }
      else if (t.status === 'enviado' && t.relatorioDia) desfecho = 'encerrado'
      comVoce = t.status === 'humano'
      // fase final deduzida do desfecho — o clássico não percorreu a escada
      if (desfecho === 'reembolso') faseAtual = percentual === 100 ? 'reemb_100' : percentual && fases[`reemb_${percentual}`] ? `reemb_${percentual}` : 'reemb_100'
      else if (desfecho === 'troca') faseAtual = jornada === 'tamanho' ? 'tam_troca' : jornada === 'defeito_errado' ? 'def_troca' : 'qual_troca'
      else if (desfecho === 'reenvio') faseAtual = 'nr_reenvio_30'
      else if (desfecho === 'cancelamento') faseAtual = 'cancel_nao_processado'
      trilha = faseAtual ? [faseAtual] : []
    }

    // correção manual tem prioridade sobre as duas
    if (t.centralAjuste) {
      origem = 'manual'
      if (t.centralAjuste.jornada) jornada = t.centralAjuste.jornada
      if (t.centralAjuste.fase !== null) {
        faseAtual = t.centralAjuste.fase
        if (faseAtual && !trilha.includes(faseAtual)) trilha = [...trilha, faseAtual]
      }
    }

    if (!produto) produto = pedido?.itens?.[0] ? `${pedido.itens[0].titulo}${pedido.itens[0].variante ? ` (${pedido.itens[0].variante})` : ''}${(pedido.itens.length > 1) ? ` +${pedido.itens.length - 1}` : ''}` : null
    const valor = pedido?.valor ?? null
    const concluido = desfecho !== 'em_aberto'
    const reembolsado = valor != null && percentual != null && (desfecho === 'reembolso' || desfecho === 'troca' || desfecho === 'reenvio' || desfecho === 'cancelamento') ? Math.round(valor * percentual) / 100 : null
    casos.push({
      ticketId: t.id, lojaId: t.lojaId ?? 'loja1', lojaNome: loja?.nome ?? (t.lojaId ?? 'loja1'), moeda: loja?.moeda ?? 'EUR',
      cliente: t.nome || t.de,
      pedidoNumero: pedido ? pedido.numero.replace('#', '') : null, pedidoValor: valor,
      produto, produtoIdentificado: !!(an?.produtosAfetados?.length) || (!!pedido && (pedido.itens?.length ?? 0) === 1),
      motivo, jornada, faseAtual, faseTitulo: titulo(faseAtual), origem, trilha,
      desfecho, percentual, reembolsado, concluido, comVoce,
      dataMs: new Date((pedido?.criadoEm ? pedido.criadoEm + 'T12:00:00' : t.data)).getTime(),
      ajuste: t.centralAjuste ?? undefined,
    })
  }
  return casos
}

export interface Filtros { busca: string; lojaId: string; periodo: '7' | '30' | '90' | 'todas'; desfecho: string }

export function filtrarCasos(casos: Caso[], f: Filtros, agora = Date.now()): Caso[] {
  const q = norm(f.busca.trim())
  const corte = f.periodo === 'todas' ? 0 : agora - Number(f.periodo) * 864e5
  return casos.filter(c => {
    if (f.lojaId !== 'todas' && c.lojaId !== f.lojaId) return false
    if (corte && c.dataMs < corte) return false
    if (f.desfecho !== 'todos') {
      if (/^\d+$/.test(f.desfecho)) { if (c.percentual !== Number(f.desfecho)) return false }
      else if (c.desfecho !== f.desfecho) return false
    }
    if (q) {
      const alvo = norm([c.pedidoNumero, c.produto, c.motivo, c.lojaNome, c.cliente].filter(Boolean).join(' '))
      if (!alvo.includes(q)) return false
    }
    return true
  })
}

export interface MetricaFase { id: string; passaram: number; pararam: number; avancaram: number; emAberto: number; valor: number }

/** Passaram / pararam / avançaram / valor por fase — um pedido conta uma vez por fase. */
export function metricasPorFase(casos: Caso[], fases: Record<string, FaseNovo>): Record<string, MetricaFase> {
  const m: Record<string, MetricaFase> = {}
  for (const id of Object.keys(fases)) m[id] = { id, passaram: 0, pararam: 0, avancaram: 0, emAberto: 0, valor: 0 }
  for (const c of casos) {
    const vistas = new Set<string>()
    c.trilha.forEach((id, i) => {
      if (!m[id] || vistas.has(id)) return
      vistas.add(id)
      m[id].passaram++
      m[id].valor += c.pedidoValor ?? 0
      const ultima = i === c.trilha.length - 1
      if (!ultima) m[id].avancaram++
      else if (c.concluido) m[id].pararam++
      else m[id].emAberto++
    })
  }
  return m
}

export function relacaoComFase(c: Caso, faseId: string): 'pararam' | 'avancaram' | 'em_aberto' | null {
  const i = c.trilha.indexOf(faseId)
  if (i < 0) return null
  if (i < c.trilha.length - 1) return 'avancaram'
  return c.concluido ? 'pararam' : 'em_aberto'
}

export interface Indicadores {
  moeda: string
  pedidosTotais: number
  pedidosComTicket: number
  pedidosEmReembolso: number
  valorTotalPedidos: number
  valorComTicket: number
  valorPedidosReembolsados: number
  antesPipeline: number
  depoisPipeline: number
  reembolsosParciais: number
  casos: number
  pctProdutoIdentificado: number
  porJornada: { chave: string; pedidos: number; valor: number; pct: number }[]
}

/**
 * Indicadores por moeda (lojas de moedas diferentes não se somam).
 * pedidosFiltrados: já recortados por loja e período.
 */
export function indicadores(casos: Caso[], pedidosFiltrados: Pedido[], lojas: Loja[], pedidosComTicket: Set<string>): Indicadores[] {
  const moedaDaLoja = (id?: string) => lojas.find(l => l.id === (id ?? 'loja1'))?.moeda ?? 'EUR'
  const moedas = [...new Set([...pedidosFiltrados.map(p => moedaDaLoja(p.lojaId)), ...casos.map(c => c.moeda)])]
  return moedas.map(moeda => {
    const ps = pedidosFiltrados.filter(p => moedaDaLoja(p.lojaId) === moeda)
    const cs = casos.filter(c => c.moeda === moeda)
    const reembolsos = cs.filter(c => c.reembolsado != null && (c.desfecho === 'reembolso' || c.desfecho === 'cancelamento'))
    const comTicket = ps.filter(p => pedidosComTicket.has(p.id))
    const porJornada = ORDEM_JORNADAS.map(chave => {
      const d = cs.filter(c => c.jornada === chave)
      return { chave, pedidos: d.length, valor: d.reduce((s, c) => s + (c.pedidoValor ?? 0), 0), pct: cs.length ? Math.round((d.length / cs.length) * 1000) / 10 : 0 }
    })
    return {
      moeda,
      pedidosTotais: ps.length,
      pedidosComTicket: comTicket.length,
      pedidosEmReembolso: reembolsos.length,
      valorTotalPedidos: ps.reduce((s, p) => s + (p.valor || 0), 0),
      valorComTicket: comTicket.reduce((s, p) => s + (p.valor || 0), 0),
      valorPedidosReembolsados: reembolsos.reduce((s, c) => s + (c.pedidoValor ?? 0), 0),
      antesPipeline: reembolsos.reduce((s, c) => s + (c.pedidoValor ?? 0), 0),
      depoisPipeline: reembolsos.reduce((s, c) => s + (c.reembolsado ?? 0), 0),
      reembolsosParciais: reembolsos.filter(c => (c.percentual ?? 100) < 100).length,
      casos: cs.length,
      pctProdutoIdentificado: cs.length ? Math.round((cs.filter(c => c.produtoIdentificado).length / cs.length) * 100) : 0,
      porJornada,
    }
  })
}

/** Ids dos pedidos que têm ao menos uma conversa (qualquer status fora spam/lixeira). */
export function pedidosComConversa(tickets: Ticket[], pedidos: Pedido[]): Set<string> {
  const ids = new Set<string>()
  for (const t of tickets) {
    if (t.status === 'spam' || t.status === 'lixeira') continue
    const p = pedidoDaConversa(t, pedidos)
    if (p) ids.add(p.id)
  }
  return ids
}
