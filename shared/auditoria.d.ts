export type SituacaoAuditoria = 'ok' | 'atencao' | 'bloqueado' | 'informativo'
export type EstadoItem = 'verde' | 'amarelo' | 'vermelho' | 'cinza'
export type GeralChecklist = 'tudo_certo' | 'revisar' | 'bloqueado'

export interface EventoAuditoria {
  id: string
  em: string
  tipo: string
  lojaId: string | null
  ticketId: string | null
  fase: string | null
  jornada: string | null
  resumo: string
  situacao: SituacaoAuditoria
  dados: Record<string, unknown>
  chave: string
}

export interface ItemChecklist { id: string; rotulo: string; estado: EstadoItem; detalhe: string | null }
export interface Checklist { itens: ItemChecklist[]; geral: GeralChecklist; enviado: boolean }

export interface MensagemAuditoria {
  chave: string
  lado: 'esquerda' | 'direita'
  origem: 'cliente' | 'ia' | 'manual'
  rotuloOrigem: string
  corpo: string
  em: string | null
  idioma: string | null
  fase: string | null
  situacao: 'recebida' | 'enviada' | 'agendada' | 'rascunho' | 'bloqueada' | 'falha'
  motivo?: string | null
  minimoEnvio: string | null
  envioReal: string | null
  atrasoMs: number | null
  naoEnviado?: boolean
}

export interface ResumoConversaAuditoria {
  ticketId: string
  lojaId: string
  loja: string
  motor: string
  cliente: string
  email: string
  assunto: string
  pedido: string | null
  jornada: string | null
  fase: string | null
  faseTitulo: string | null
  idioma: string | null
  ultimaAtividade: string | null
  aguardandoAprovacao: boolean
  envioAutomatico: boolean
  selo: GeralChecklist | 'sem_dados'
  semAuditoriaDetalhada: boolean
  revisao: { resultado: string; por: string; em: string; observacao: string | null } | null
}

export interface ConversaAuditoria extends ResumoConversaAuditoria {
  aviso: string | null
  mensagens: MensagemAuditoria[]
  passos: string
  eventos: EventoAuditoria[]
  classificacao: Record<string, unknown> | null
  decisao: Record<string, unknown> | null
  checklist: Checklist | null
  faseAnterior: string | null
  faseAtual: string | null
  proximaPermitida: string | null
  produtos: string[]
  pedidoValor: number | null
  moeda: string | null
  percentual: number | null
  valor: number | null
  cupom: string | null
  cadencia: { minimo: string | null; agendado: string | null; primeiraResposta: boolean }
}

export declare const TIPOS_AUDITORIA: string[]
export declare const ROTULO_TIPO_AUDITORIA: Record<string, string>
export declare const SITUACOES_AUDITORIA: SituacaoAuditoria[]
export declare const ITENS_CHECKLIST: [string, string][]
export declare const ROTULO_GERAL: Record<GeralChecklist, string>
export declare const ROTULO_SELO: Record<string, string>
export declare function novoEvento(dados: Partial<EventoAuditoria> & { tipo: string }): EventoAuditoria
export declare function registrarEvento(lista: EventoAuditoria[] | null, evento: EventoAuditoria): EventoAuditoria[]
export declare function checklistDaResposta(fatos: Record<string, unknown>): Checklist
export declare function linhaDoTempo(t: unknown, opcoes?: { eventos?: EventoAuditoria[] | null }): MensagemAuditoria[]
export declare function passosCompactos(eventos?: EventoAuditoria[]): string
export declare function seloDaConversa(eventos?: EventoAuditoria[]): string
export declare function filtrosDaAuditoria(q?: Record<string, unknown>): Record<string, unknown>
export declare function filtrarConversas<T>(lista: T[], f: Record<string, unknown>): T[]
