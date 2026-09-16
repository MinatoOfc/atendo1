import type { Ticket, Pedido, Loja, FaseNovo, AjusteCentral, InferenciaCentral } from '../src/store'

export type OrigemFase = 'confirmada' | 'inferida' | 'manual'
export type Desfecho = 'em_aberto' | 'reembolso' | 'troca' | 'reenvio' | 'cupom' | 'cancelamento' | 'encerrado'
export type Periodo = '7' | '30' | '90' | 'todas'

export interface Filtros { busca: string; lojaId: string; periodo: Periodo; desfecho: string; jornada: string; fase: string }

export interface Caso {
  ticketId: string
  pedidoId: string | null
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
  faseConfirmada: string | null
  faseInferida: string | null
  faseManual: string | null
  origem: OrigemFase
  /** só fases ENVIADAS (historicoEtapas sem evento) */
  trilha: string[]
  pendente: string | null
  desfecho: Desfecho
  percentual: number | null
  reembolsado: number | null
  concluido: boolean
  comVoce: boolean
  acaoPendente: string | null
  escalouAoDono: boolean
  /** efetivado = confirmação enviada ou processado no relatório; aceite_pendente = com o dono; registrado = linha do relatório clássico */
  situacaoReembolso: 'efetivado' | 'aceite_pendente' | 'registrado' | 'inferido' | null
  confirmacaoEnviada: string | null
  /** de onde veio a fase inferida: linha do relatório manual ou inferência da IA (Parte 8) */
  inferidaPor: 'relatorio' | 'ia' | null
  inferencia: InferenciaCentral | null
  dataMs: number
  ajuste: AjusteCentral | null
  historicoAjustes: AjusteCentral[]
}

export interface Registro extends Caso {
  chave: string
  tickets: string[]
  trilhaUniao: string[]
}

export interface MetricaFase {
  id: string; passaram: number; pararam: number; avancaram: number; emAberto: number
  valorPorMoeda: Record<string, number>
  inferidos: number; manuais: number
}

export interface Linha {
  chave: string
  pedidoId: string | null
  pedidoNumero: string | null
  cliente: string
  lojaId: string
  lojaNome: string
  moeda: string
  valor: number | null
  dataMs: number
  produto: string | null
  registro: Registro | null
  atendimento: OrigemFase | 'sem atendimento'
  faseTitulo: string
}

export interface Indicadores {
  moeda: string
  pedidosTotais: number
  pedidosComAtendimento: number
  pedidosEmReembolso: number
  valorTotalPedidos: number
  valorComAtendimento: number
  valorPedidosReembolsados: number
  hipoteticoSemRetencao: number
  reembolsadoEfetivo: number
  reembolsosEfetivados: number
  aceitesPendentes: number
  valorAceitesPendentes: number
  reembolsosRegistrados: number
  reembolsosInferidos: number
  historicoSuficiente: boolean
  reembolsosConfirmados: number
  reembolsosParciais: number
  casos: number
  pctProdutoIdentificado: number
  porJornada: { chave: string; pedidos: number; valor: number; pct: number }[]
}

export interface ResultadoCentral {
  filtros: Filtros
  casos: Caso[]
  registros: Registro[]
  linhas: Linha[]
  metricas: Record<string, MetricaFase>
  indicadores: Indicadores[]
}

export const ORDEM_JORNADAS: readonly string[]
export const DESFECHOS: readonly Desfecho[]
export const FASES_MIGRAVEIS: readonly string[]
export function temRelatorio(t: Ticket): boolean
export function ehCandidatoMigracao(t: Ticket): boolean
export function statusMigracao(tickets: Ticket[]): { candidatos: number; inferidos: number; pendentes: number }
export function normalizarInferencia(bruto: unknown, fases: Record<string, FaseNovo>): Omit<InferenciaCentral, 'em' | 'modelo'> | null
export const JORNADA_DO_FLUXO: Record<string, string>
export const NOME_MOTIVO: Record<string, string>
export const FILTROS_PADRAO: Filtros
export function pedidoDaConversa(t: Ticket, pedidos: Pedido[]): Pedido | null
export function montarCasos(tickets: Ticket[], pedidos: Pedido[], lojas: Loja[], fases: Record<string, FaseNovo>): Caso[]
export function consolidarPorPedido(casos: Caso[]): Registro[]
export function relacaoComFase(r: Registro, faseId: string): 'pararam' | 'avancaram' | 'em_aberto' | null
export function metricasPorFase(registros: Registro[], fases: Record<string, FaseNovo>): Record<string, MetricaFase>
export function filtrarPedidos(pedidos: Pedido[], f: Filtros, agora?: number): Pedido[]
export function filtrarRegistros(registros: Registro[], f: Filtros, agora?: number): Registro[]
export function linhasDePedidos(pedidosFiltrados: Pedido[], registrosTodos: Registro[], registrosFiltrados: Registro[], lojas: Loja[], f: Filtros): Linha[]
export function pedidosComConversa(tickets: Ticket[], pedidos: Pedido[]): Set<string>
export function indicadores(linhas: Linha[]): Indicadores[]
export function calcularCentral(args: { tickets: Ticket[]; pedidos: Pedido[]; lojas: Loja[]; fases: Record<string, FaseNovo>; filtros?: Partial<Filtros>; agora?: number }): ResultadoCentral
