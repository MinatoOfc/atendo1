export type SituacaoAuditoria = 'ok' | 'atencao' | 'bloqueado' | 'informativo'
export type EstadoItem = 'verde' | 'amarelo' | 'vermelho' | 'cinza'
export type GeralChecklist = 'tudo_certo' | 'revisar' | 'bloqueado'
export type SeloConversa = GeralChecklist | 'aguardando' | 'agendada' | 'aguardando_voce' | 'encerrado' | 'revisar_historico' | 'sem_dados'
/** Como a mensagem saiu, gravado no próprio evento de envio (campo fechado). */
export type OrigemEnvio = 'automatico' | 'aprovado_pelo_dono' | 'manual'

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
  situacao: 'recebida' | 'enviada' | 'agendada' | 'rascunho' | 'aguardando_aprovacao' | 'bloqueada' | 'falha'
  motivo?: string | null
  minimoEnvio: string | null
  envioReal: string | null
  atrasoMs: number | null
  naoEnviado?: boolean
  mensagemId?: string | null
  /** exato = pelo Message-ID; inferido = registro antigo, ligado por horário */
  vinculo?: 'exato' | 'inferido' | 'sem_evento'
  tentativaId?: string | null
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
  origemEnvio: OrigemEnvio | null
  selo: SeloConversa
  retencao: { omitidos: number; primeiroOmitidoEm: string | null; ultimoOmitidoEm: string | null; primeiroDisponivelEm: string | null; limite: number } | null
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
  checklistConcluido: boolean | null
  checklistTentativa: string | null
  motivoChecklist: string | null
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
  tentativaAtual: string | null
  cicloAtual: string | null
  historicoCompleto: boolean
  envio: EnvioAuditoria
}

/** Estado do envio da tentativa atual, como a Auditoria o enxerga. */
export type EstadoEnvioAuditoria =
  | 'humano' | 'em_andamento' | 'bloqueada' | 'enviada' | 'agendada'
  | 'aguardando_aprovacao' | 'rascunho' | 'sem_rascunho'

export interface PrazoEntrega { min: number; max: number; processamento: number }

/**
 * FOTOGRAFIA DA APROVAÇÃO — calculada pelo servidor e devolvida por ela mesma
 * no instante do envio, pelas três telas (Auditoria, Aprovações e a tela da
 * conversa). É o RASCUNHO-BASE, nunca o texto final, que o dono pode editar.
 * No motor novo ela é obrigatória: sem ela o servidor recusa o envio.
 */
export interface FotografiaAprovacao {
  workspaceId: string
  lojaId: string
  ticketId: string
  /** id/data da última mensagem do cliente */
  mensagemEm: string | null
  cicloId: string | null
  tentativaId: string | null
  fase: string | null
  rascunhoHash: string | null
  validado: boolean
  /** digest do resto que muda o que pode ser enviado (oferta, cupom, prazo, cadência…) */
  versao: string
}

export interface EnvioAuditoria {
  estado: EstadoEnvioAuditoria
  /** as cinco condições do botão "Revisar e enviar", decididas no servidor */
  podeRevisar: boolean
  rascunhoValidado: boolean
  /** a mesma fotografia que Aprovações e a tela da conversa recebem */
  esperado: FotografiaAprovacao
  /** texto original completo que será enviado (idioma do cliente) */
  rascunho: string | null
  rascunhoIdioma: string | null
  mensagemAtual: string | null
  minimoEnvio: string | null
  percentual: number | null
  valor: number | null
  cupom: string | null
  prazo: PrazoEntrega | null
  canal: { configurado: boolean; propria: boolean; endereco: string | null; remetente: string | null }
  enviada: { mensagemId: string | null; em: string | null; canalConfirmou: boolean } | null
}

export declare const TIPOS_AUDITORIA: string[]
export declare const ROTULO_TIPO_AUDITORIA: Record<string, string>
export declare const SITUACOES_AUDITORIA: SituacaoAuditoria[]
export declare const ITENS_CHECKLIST: [string, string][]
export declare const ROTULO_GERAL: Record<GeralChecklist, string>
export declare const ROTULO_SELO: Record<string, string>
export declare const ROTULO_SELO_CURTO: Record<string, string>
export declare const ROTULO_ORIGEM_ENVIO: Record<OrigemEnvio, string>
export declare const LIMITE_AUDITORIA: number
export declare function tentativaAtual(eventos?: EventoAuditoria[]): string | null
export declare function cicloAtual(eventos?: EventoAuditoria[]): string | null
export declare function eventosDoCiclo(eventos?: EventoAuditoria[], cicloId?: string | null): EventoAuditoria[]
export declare function eventosDaTentativa(eventos?: EventoAuditoria[], tentativaId?: string | null): EventoAuditoria[]
export declare function novoEvento(dados: Partial<EventoAuditoria> & { tipo: string }): EventoAuditoria
export declare function registrarEvento(lista: EventoAuditoria[] | null, evento: EventoAuditoria): EventoAuditoria[]
export declare function checklistDaResposta(fatos: Record<string, unknown>): Checklist
export declare function linhaDoTempo(t: unknown, opcoes?: { eventos?: EventoAuditoria[] | null }): MensagemAuditoria[]
export declare function passosCompactos(eventos?: EventoAuditoria[]): string
export declare function seloDaConversa(eventos?: EventoAuditoria[]): SeloConversa
export declare function checklistDaTentativa(eventos?: EventoAuditoria[]): { checklist: Checklist | null; concluido: boolean; motivo: string | null; tentativaId: string | null; em: string | null }
export declare function origemDoEnvio(eventos?: EventoAuditoria[]): OrigemEnvio | null
export declare function aplicarRetencao(lista?: EventoAuditoria[], opcoes?: { limite?: number; anterior?: unknown }): { eventos: EventoAuditoria[]; retencao: unknown }
export declare function filtrosDaAuditoria(q?: Record<string, unknown>): Record<string, unknown>
export declare function filtrarConversas<T>(lista: T[], f: Record<string, unknown>): T[]
