import type { Ticket, Pedido, Loja, Produto, ProdutoRelatorio } from '../src/store'

export interface PedidoDoCaso {
  id: string | null
  numero: string
  valor: number | null
  moeda: string | null
  /** false quando o número foi escrito mas o pedido não está sincronizado */
  localizado: boolean
}

export interface CasoRelatorio {
  ticketId: string
  dia: string | null
  lojaId: string
  lojaNome: string
  /** id do pedido quando existe exatamente UM localizado */
  pedidoId: string | null
  /** número quando existe exatamente UM (mesmo sem os dados da Shopify) */
  pedidoNumero: string | null
  pedidoLocalizado: boolean
  pedidos: PedidoDoCaso[]
  pedidoNumeros: string[]
  /** números escritos pelo dono que não batem com nenhum pedido sincronizado */
  pedidosSemDados: string[]
  /** "Pedido #2614", "Pedidos #2673 e #2695" ou "Sem pedido informado" */
  pedidoTitulo: string
  /** o título acima, com o aviso quando nada foi encontrado na Shopify */
  rotuloPedido: string
  origemPedido: string | null
  /** como o pedido foi encontrado, em português (detalhe do caso) */
  rotuloOrigemPedido: string | null
  /** pedidos possíveis quando nada foi provado — o dono escolhe no modal */
  candidatos: { id: string; numero: string; valor: number | null; moeda: string | null; cliente: string | null; email: string | null; criadoEm: string | null }[]
  clienteNome: string | null
  clienteEmail: string | null
  /** e-mail canônico de quem escreveu */
  emailRemetente: string | null
  /** o pedido está num e-mail diferente do remetente (gmail x googlemail) */
  emailDiferenteDoPedido: boolean
  tipo: string
  acoes: string[]
  descricao: string
  percentual: number | null
  valor: number | null
  moeda: string | null
  valorPedido: number | null
  cupom: string | null
  produtos: ProdutoRelatorio[]
  origem: string
  processado: boolean
  processadoEm: string | null
  confirmadoEm: string | null
  incluidoEm: string | null
  observacao: string | null
  faseAceita: string | null
  faseTitulo: string | null
}

export interface OpcoesNormalizacao {
  pedidos?: Pedido[]
  lojas?: Loja[]
  produtos?: Produto[]
  fases?: Record<string, { titulo?: string }>
}

export declare const TIPOS_RELATORIO: string[]
export declare const ROTULO_TIPO: Record<string, string>
export declare function dinheiro(valor: number | null, moeda?: string | null): string
export declare function numerosCitados(txt: unknown): Set<string>
export declare function numerosDePedidoNoTexto(txt: unknown): string[]
export declare function imagemSegura(url: unknown): string | null
export declare function tituloDoPedido(itens: { numero: string; pedido: Pedido | null }[]): string
export declare function rotuloDoPedido(itens: { numero: string; pedido: Pedido | null }[]): string
export declare function acharPedidos(t: Ticket, pedidos?: Pedido[]): {
  itens: { numero: string; pedido: Pedido | null }[]
  origem: string | null
  pedidos: Pedido[]
  numeros: string[]
}
export declare function acharPedido(t: Ticket, pedidos?: Pedido[]): Pedido | null
export declare const ROTULO_ORIGEM_PEDIDO: Record<string, string>
export declare function emailCanonico(v: unknown): string | null
export declare function precisaVinculo(caso: CasoRelatorio): boolean
export declare function buscaInicialVinculo(caso: CasoRelatorio): string
export declare function normalizarCaso(t: Ticket, opcoes?: OpcoesNormalizacao): CasoRelatorio
