import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RevisaoEsperada } from '../shared/auditoria.js'

/* ---------------- Tipos ---------------- */

export type Categoria = 'rastreio' | 'reembolso' | 'troca' | 'produto' | 'entrega' | 'outro'
export type StatusTicket = 'inbox' | 'aprovacao' | 'humano' | 'enviado' | 'spam' | 'lixeira'

export interface AnexoImagem { id: string; nome: string; tipo: string }

/** produto de uma linha do relatório (sempre vindo de um item real do pedido) */
export interface ProdutoRelatorio {
  produtoId?: string | null
  varianteId?: string | null
  titulo: string
  variante?: string | null
  quantidade?: number | null
  imagem?: string | null
}
/** campos estruturados da linha do relatório — montados e conferidos no servidor */
export interface DetalhesRelatorio {
  versao: 1
  tipo: string
  percentual: number | null
  valor: number | null
  moeda: string | null
  valorPedido: number | null
  pedidoId: string | null
  pedidoNumero: string | null
  clienteNome: string | null
  clienteEmail: string | null
  produtos: ProdutoRelatorio[]
  origem: string
  observacao: string | null
  criadoEm: string
  atualizadoEm: string
}
/** o que o popup "Adicionar ao relatório" recebe pronto do servidor */
export interface PreparoRelatorio {
  travado: boolean
  motor: 'classico' | 'novo'
  pedido: { id: string; numero: string; valor: number | null; moeda: string | null } | null
  /** zero, um ou vários pedidos do caso (localizado=false: número citado sem dados na Shopify) */
  pedidos: { id: string | null; numero: string; valor: number | null; moeda: string | null; localizado: boolean }[]
  pedidoNumeros: string[]
  pedidosSemDados: string[]
  rotuloPedido: string
  /** pedidos DESTA loja, para o dono confirmar/corrigir o vínculo */
  pedidosDaLoja: { id: string; numero: string; cliente: string | null; email: string | null; valor: number | null; criadoEm: string | null }[]
  cliente: { nome: string | null; email: string | null }
  /** e-mail de quem escreveu (canônico) e aviso de que o pedido está em outro */
  emailRemetente: string | null
  emailDiferenteDoPedido: boolean
  /** pedidos possíveis quando nada foi provado — já aparecem prontos no popup */
  candidatos: { id: string; numero: string; valor: number | null; moeda: string | null; cliente: string | null; email: string | null; criadoEm: string | null }[]
  produtosDoPedido: ProdutoRelatorio[]
  sugestao: {
    tipo: string
    percentual: number | null
    valor: number | null
    moeda: string | null
    produtos: ProdutoRelatorio[]
    descricao: string
    acoes: { tipo: string; rotulo: string }[]
    solucaoAceita: string | null
  }
}

export interface Ticket {
  id: string
  nome: string
  de: string
  assunto: string
  corpo: string
  data: string
  lido: boolean
  origem: 'cliente' | 'shopify'
  categoria: Categoria
  status: StatusTicket
  statusAnterior?: StatusTicket
  idioma: string
  rascunho?: string
  confianca?: number
  motivoEscalada?: string
  resposta?: string
  respondidoEm?: string
  enviaEm?: number
  geradoPorIA?: boolean
  erroEnvio?: string
  tentativasEnvio?: number
  lojaId?: string
  historico?: { autor: 'cliente' | 'atendo'; corpo: string; data: string; traducao?: string; anexos?: AnexoImagem[]; origem?: 'ia' | 'manual' }[]
  /** quem escreveu a resposta atual: a IA ou você */
  respostaOrigem?: 'ia' | 'manual'
  /** imagens anexadas à mensagem atual do cliente (referências; bytes ficam no servidor) */
  anexos?: AnexoImagem[]
  resumoSituacao?: string
  resolucao?: string
  relatorioDia?: string
  relatorioTexto?: string
  /** linha criada sozinha pelo motor novo depois do envio real da confirmação (uma por aceite) */
  relatorioAuto?: { eventoId: string; solucao: string; percentual: number | null; valor: number | null; moeda: string; cupom: string | null; confirmacaoEnviadaEm: string; origem: string }
  /** linha final editada à mão — tem prioridade sobre a montada automaticamente */
  relatorioLinha?: string
  /** quando o dono marcou este caso como processado no link do relatório (ISO) */
  relatorioProcessado?: string
  /** campos estruturados da linha (pedido, cliente, produtos, percentual, valor) */
  relatorioDetalhes?: DetalhesRelatorio
  /** marcado à mão como "já respondida" (resposta saiu por outro caminho) */
  marcadoRespondido?: boolean
  custoIA?: number
  iaPausada?: boolean
  /** O canal está no meio de um envio nesta conversa: nada de assumir agora. */
  envioEmAndamento?: boolean
  /** O dono assumiu a conversa: a IA não age nela até ele retomar. */
  atendimentoHumano?: {
    ativo: boolean; por: string; em: string; motivo: string
    faseNoMomento?: string | null; rascunhoInvalidado?: string | null
  }
  traducao?: string
  assuntoTraducao?: string
  respostaTraducao?: string
  rascunhoTraducao?: string
  situacaoTraducao?: string
  motivoTraducao?: string
  /** estado do motor de etapas (só em lojas no modo novo) */
  atendimentoNovo?: AtendimentoNovo
  /** motivo do reembolso lido pelo relatório de reembolsos (cache) */
  motivoReembolso?: { motivo: string; categoria: string; em: string; local?: boolean }
  /** correção manual ATIVA da classificação feita na Central operacional */
  centralAjuste?: { fase: string | null; jornada: string | null; por: string; em: string; anterior: string | null; justificativa: string | null }
  /** auditoria: cada correção manual e cada remoção, em ordem */
  centralHistorico?: AjusteCentral[]
  /** Parte 8: fase/jornada/desfecho inferidos pela IA para casos antigos — só a Central usa; nunca muda o atendimento */
  inferenciaCentral?: InferenciaCentral
  /** motor em que esta conversa nasceu (não muda quando a loja troca de modo) */
  motor?: 'classico' | 'novo'
  /** motor DEFINITIVO, gravado no nascimento pela data real do primeiro e-mail × ativação do novo; nunca muda */
  motorAtendimento?: 'classico' | 'novo'
  primeiroEmailEm?: string
}

export interface InferenciaCentral {
  jornada: string
  fase: string | null
  desfecho: string
  percentual: number | null
  motivo: string | null
  categoria: string
  produtos: string[]
  confianca: number
  em: string
  origem?: 'ia'
}

export interface AjusteCentral {
  removido: boolean
  fase: string | null
  jornada: string | null
  anterior: string | null
  anteriorJornada?: string | null
  por: string
  em: string
  justificativa: string | null
}

export interface OfertaNovo { tipo: string; pct: number | null; cupom: number | null; prazo: string | null; semDevolucao: boolean }
export interface AtendimentoNovo {
  versao: number
  fluxo: string | null
  etapa: string | null
  produtosAfetados: string[]
  motivo: string | null
  ajusteTamanho: Record<string, 'pequeno' | 'grande'> | null
  fotoSolicitada: boolean
  /** chegou uma imagem — ainda não é prova de nada */
  fotoRecebida: boolean
  /** true só depois de você confirmar que a foto mostra o defeito */
  fotoValidada: boolean | null
  /** imagem recebida no fluxo de defeito, esperando você dizer se comprova */
  aguardandoComprovacao?: boolean
  /** fase que a coleta / a foto está destravando */
  proximaAposColeta?: string | null
  /** idioma-alvo da conversa (ISO 639-1), pela última mensagem completa do cliente */
  idioma?: string | null
  /** como veio da detecção (de-AT, nl-BE…) */
  idiomaOriginal?: string | null
  idiomaIncerto?: boolean
  /** idioma declarado pela IA no rascunho atual */
  rascunhoIdioma?: string | null
  /** motivo pelo qual este rascunho nunca sai sozinho (ex.: idioma não validado localmente) */
  aprovacaoObrigatoria?: string
  /** envio automático bloqueado (piloto): o rascunho fica em Aprovações */
  envioBloqueado?: string
  ofertaAtual: OfertaNovo | null
  ofertaEnviadaEm: string | null
  aguardando: 'cliente' | 'envio' | 'humano' | null
  acaoAceita: string | null
  /** solução aceita pelo cliente — modo (manual/automático) fotografado no instante do aceite */
  conclusaoPendente?: {
    id: string; faseAceita: string; tipo: string | null; jornada: string | null; modo: 'manual' | 'automatico'
    aceitaEm: string; mensagemDoCliente?: string; percentual: number | null; valor: number | null; moeda: string; cupom: string | null; cupomPct?: number | null
    produtos: string[]; endereco: string | null; historicoFases?: string[]
    status: 'aguardando_dados' | 'aguardando_aprovacao' | 'aguardando_cadencia' | 'enviando' | 'concluida' | 'cancelada' | 'recusada' | 'falha'
    faltando?: string[]; falha?: string; aprovadoPor?: string; aprovadoEm?: string; confirmadaEm?: string; recusadaEm?: string; observacao?: string
  } | null
  /** o que o cliente já escreveu de endereço (pode estar incompleto) */
  enderecoInformado: string | null
  /** só depois de validado: rua+número, código postal e cidade */
  enderecoConfirmado: string | null
  historicoEtapas: { de: string | null; para: string; mensagem: string; em: string; observacao?: string; evento?: string }[]
  transicaoPendente: { para: string; mensagem: string; faltando?: string[]; observacao?: string } | null
  proximoEnvioMinimo?: string
  rascunhoGerado?: string
}
export interface FaseNovo {
  titulo: string; jornada: string; aoAceitar: string | null; aoRecusar: string | null; oferta: OfertaNovo | null; instrucao?: string | null
  /** fase escrita só depois de você aprovar um aceite (única em que a IA confirma de fato) */
  confirmacao?: boolean
  /** 100% e cancelamento: chegam a você sem aceite do cliente */
  decisaoDono?: boolean
}

export interface Politica { id: string; titulo: string; conteudo: string; ativa: boolean }
export interface Comportamento { id: string; situacao: string; instrucao: string; ativa: boolean }
export interface ResumoDiario {
  id: string; dia: string; geradoEm: string
  atendimentos: number; recebidos: number; spam: number
  categorias: Record<string, number>
  clientes: { nome: string; email: string; categoria: Categoria; lojaId?: string; situacao?: string | null; resolucao?: string | null; pedidos: string[] }[]
  porLoja?: Record<string, { atendimentos: number; recebidos: number; spam: number; categorias: Record<string, number> }>
}
export interface Faq { id: string; pergunta: string; resposta: string; ativa: boolean }

export interface Produto {
  id: string; titulo: string; tipo: string; marca: string; tags: string[]
  precoMin: number; precoMax: number; estoque: number | null; ativo: boolean
  variantes: string[]; url: string; descricao: string; lojaId?: string
  imagem?: string | null
  imagemPorVariante?: Record<string, string>
  sempreDisponivel?: boolean
}

export interface Pedido {
  id: string; numero: string; cliente: string; email: string; pais: string
  valor: number; status: 'aguardando' | 'transito' | 'entregue' | 'problema'
  rastreio: string; criadoEm: string; lojaId?: string
  urlRastreio?: string | null; transportadora?: string | null
  itens?: { titulo: string; variante: string | null; quantidade: number; preco?: number; produtoId?: string | null; varianteId?: string | null }[]
}

export interface Config {
  nomeLoja: string
  emailConectado: string | null
  shopifyConectada: boolean
  tomDetectado: boolean
  automacaoAtiva: boolean
  atrasoMinutos: number
  escalarSensiveis: boolean
  confiancaMinima: number
  assinatura: string
}

export interface StatusEmail {
  ok: boolean | null; erro: string | null; verificadoEm: string | null
  envioPorApi?: boolean; remetente?: string | null
  envio?: { ok: boolean | null; erro: string | null; via?: string; porta?: number; aviso?: string }
}

export interface MensagemCaixa {
  de: string; assunto: string; data: string | null
  lido: boolean; virouTicket: boolean; respostaDoAtendo: boolean
}
export interface Diagnostico {
  ok: boolean; erro?: string; caixa?: string
  totalNaCaixa?: number; janelaDias?: number; encontradosNaJanela?: number
  mensagens?: MensagemCaixa[]
}
export interface StatusIA { ok: boolean | null; erro: string | null; verificadoEm: string | null; modelo?: string }
export interface StatusShopify {
  ok: boolean | null; erro: string | null; verificadoEm: string | null
  loja?: string | null; pedidos?: number; modo?: 'token' | 'oauth' | null
}

export interface Loja {
  id: string
  nome: string
  ativa: boolean
  moeda: string
  idioma?: string
  iaModelo?: string
  /** "classico" (o atendimento atual) ou "novo" (a reformulação) */
  modoAtendimento?: string
  /** desde quando o modo atual está ativo (ISO) */
  modoDesde?: string | null
  /** auditoria das trocas de modo */
  modoHistorico?: { de: string; para: string; por: string; lojaId: string; em: string }[]
  /** o que falta para ativar o novo (conferido no servidor) */
  prontidaoNovo?: {
    pronto: boolean
    faltando: { chave: string; texto: string }[]
    avisos?: { chave: string; texto: string }[]
    /** situação de cada cupom (o de 10% vem como reserva) */
    cupons?: { pct: number; codigo: string | null; usadoPeloFluxo: boolean; reserva: boolean; situacao: string; detalhe: string; verificadoEm?: string | null; verificadoNaLoja?: string | null; valeAte?: string | null; pctEncontrado?: number | null }[]
    /** resumo da última conferência (quando venceu, se houve permissão) */
    verificacaoCupons?: { em: string | null; lojaId: string | null; permissao: boolean; valeAte: string | null; vencida: boolean; erro: string | null } | null
    sincronizacao?: { ok: boolean; em: string; erro: string | null; valeAte?: string | null; vencida?: boolean } | null
    /** nível do envio TOTALMENTE automático (Shopify, sincronização, moeda, cupons verificados) */
    automatico?: { pronto: boolean; faltando: { chave: string; texto: string }[] }
  }
  /** modo novo: rascunhos saem sozinhos na cadência (desligado no piloto) */
  novoEnvioAutomatico?: boolean
  /** modo novo: depois que o cliente aceita, o dono aprova (true, padrão) ou a confirmação sai sozinha e entra no relatório (false) */
  exigirAprovacaoAceiteNovo?: boolean
  aceiteHistorico?: { lojaId: string; por: string; de: boolean; para: boolean; em: string }[]
  /** modo novo: prazo de entrega prometido, em dias úteis */
  prazoEntrega?: { min: number; max: number; processamento: number } | null
  /** modo novo: código do cupom por percentual ("15" → "DANKE15") */
  cupons?: Record<string, string>
  assinatura?: string | null
  email: {
    configurado: boolean; endereco: string | null; status: StatusEmail | null
    importacao?: { rodando: boolean; importados: number; erro?: string | null; concluidoEm?: string | null } | null
    provider?: string | null; remetenteNome?: string | null; origem?: 'site' | 'env' | null
  }
  shopify: {
    conectada: boolean; dominio: string | null; modo: 'token' | 'oauth' | null; status: StatusShopify | null
    oauthDisponivel?: boolean; appProprio?: boolean; appClientId?: string | null
  }
}

/** Relatório de reembolsos: o que o lojista marcou no relatório manual,
 *  agrupado por loja, com valor do pedido e o motivo alegado pelo cliente. */
export interface ItemReembolso {
  ticketId: string; lojaId: string; dia: string
  numero: string | null; cliente: string
  valor: number | null; valorTexto: string
  motivo: string; linha: string
}
export interface GrupoReembolso { lojaId: string; nome: string; moeda: string; itens: ItemReembolso[] }
export interface RelatorioReembolsos {
  erro?: string
  total?: number
  grupos?: GrupoReembolso[]
  /** link público de acompanhamento deste relatório */
  link?: string
  /** totais que alimentam os gráficos da página pública */
  resumo?: { reembolsado: number; moeda: string; cem: number; sessenta: number; porCategoria: { chave: string; rotulo: string; quantidade: number; reembolsado: number }[] }
  /** quantos motivos precisaram ser lidos agora (os demais vieram do cache) */
  lidosAgora?: number
  aviso?: string | null
  custoIA?: number
  texto?: string
}

export interface Usuario { id: string; nome: string; email: string }

/** Preferências deste dispositivo (ficam no navegador, não no servidor). */
export type Paleta = 'notion' | 'oceano' | 'floresta' | 'sol' | 'lavanda' | 'amoled'
const paletasValidas: readonly Paleta[] = ['notion', 'oceano', 'floresta', 'sol', 'lavanda', 'amoled']

export interface Prefs {
  tema: 'claro' | 'escuro'
  paleta: Paleta
  densidade: 'confortavel' | 'compacto'
  mostrarPreview: boolean
  moedaExibicao: 'loja' | 'USD' | 'EUR' | 'BRL'
  tamanhoFonte: 'pequeno' | 'padrao' | 'grande'
}

const prefsPadrao: Prefs = {
  tema: 'claro', paleta: 'notion', densidade: 'confortavel', mostrarPreview: true,
  moedaExibicao: 'loja', tamanhoFonte: 'padrao',
}

export interface ConfigEmail {
  provider?: string; user: string; pass: string
  from?: string; remetenteNome?: string
  imapHost?: string; smtpHost?: string; imapPort?: number; smtpPort?: number
}

export interface ResultadoTesteEmail {
  ok: boolean
  leitura?: { ok: boolean | null; erro: string | null }
  envio?: { ok: boolean | null; erro: string | null; via?: string }
  erro?: string
}
export interface Integracoes {
  email: boolean; shopify: boolean; ia: boolean
  shopifyOauth: boolean
  emailStatus: StatusEmail
  iaStatus: StatusIA
  shopifyStatus: StatusShopify
}

interface ServerState {
  tickets: Ticket[]
  politicas: Politica[]
  comportamentos?: Comportamento[]
  resumosDiarios?: ResumoDiario[]
  geminiDisponivel?: boolean
  /** catálogo do motor de etapas: id da fase → título, jornada e destinos */
  fasesNovo?: Record<string, FaseNovo>
  jornadasNovo?: Record<string, string>
  gastosIA?: Record<string, Record<string, number>>
  opcoesRelatorio?: string[]
  /** instruções salvas do "Gerar com IA" (1 clique em vez de digitar) */
  opcoesInstrucao?: string[]
  /** caminho do link público do relatório manual (ex.: /r/ws-x/token) ou null */
  relatorioLink?: string | null
  /** link externo do pipeline (somente leitura), ou null quando não existe/foi revogado */
  pipelineLink?: string | null
  /** envio automático do novo liberado no servidor (fora do piloto)? */
  envioAutomaticoLiberado?: boolean
  /** link público do último relatório de reembolsos gerado (mesmo token) */
  reembolsosLink?: string | null
  /** quando esse relatório foi gerado (ISO) */
  reembolsosEm?: string | null
  /** false = o dia de hoje só aparece no link depois da meia-noite */
  linkMostraHoje?: boolean
  /** mensagem de erro quando o banco NÃO está gravando (banner vermelho) */
  bancoErro?: string | null
  hojeChave?: string
  faqs: Faq[]
  pedidos: Pedido[]
  produtos: Produto[]
  moeda: string
  lojas: Loja[]
  provedoresEmail?: string[]
  cotacoes?: Record<string, number> | null
  escoposShopify?: string
  config: Config
  integracoes: Integracoes
}

const configPadrao: Config = {
  nomeLoja: 'minha loja', emailConectado: null, shopifyConectada: false,
  tomDetectado: false, automacaoAtiva: false, atrasoMinutos: 3,
  escalarSensiveis: true, confiancaMinima: 0.55,
  assinatura: 'Equipe de atendimento',
}

const estadoVazio: ServerState = {
  tickets: [], politicas: [], faqs: [], pedidos: [], produtos: [], moeda: 'EUR', lojas: [],
  config: configPadrao,
  integracoes: {
    email: false, shopify: false, ia: false, shopifyOauth: false,
    emailStatus: { ok: null, erro: null, verificadoEm: null },
    iaStatus: { ok: null, erro: null, verificadoEm: null },
    shopifyStatus: { ok: null, erro: null, verificadoEm: null },
  },
}

/* ---------------- API ---------------- */

async function api(caminho: string, metodo = 'POST', body?: unknown): Promise<{ state?: ServerState; novos?: number; erro?: string }> {
  const resp = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return resp.json()
}

/* ---------------- Contexto ---------------- */

interface Store extends ServerState {
  carregado: boolean
  tipsFechados: string[]
  usuario: Usuario | null
  autenticando: boolean
  entrar: (email: string, senha: string) => Promise<string | null>
  registrar: (nome: string, email: string, senha: string) => Promise<string | null>
  sair: () => void
  atualizarConta: (dados: { nome?: string; senhaAtual?: string; novaSenha?: string }) => Promise<string | null>
  salvarEmailLoja: (lojaId: string, cfg: ConfigEmail) => Promise<string | null>
  removerEmailLoja: (lojaId: string) => void
  testarEmailConfig: (cfg: ConfigEmail) => Promise<ResultadoTesteEmail>
  salvarShopifyApp: (lojaId: string, clientId: string, clientSecret: string) => Promise<string | null>
  removerShopifyApp: (lojaId: string) => void
  conectarShopifyToken: (lojaId: string, dominio: string, token: string) => Promise<string | null>
  prefs: Prefs
  setPref: (patch: Partial<Prefs>) => void
  /** Formata um valor na moeda de exibição preferida (converte pela cotação do dia). */
  fmtMoeda: (v: number, moedaOrigem?: string) => string
  /** 'todas' ou o id da loja selecionada na seta do topo da barra lateral */
  lojaAtiva: string
  setLojaAtiva: (id: string) => void
  lojasVisiveis: Loja[]
  atualizarLoja: (id: string, patch: {
    nome?: string; ativa?: boolean; idioma?: string; assinatura?: string; iaModelo?: string; modoAtendimento?: string
    novoEnvioAutomatico?: boolean; confirmar?: boolean; prazoEntrega?: { min: number; max: number; processamento: number }; cupons?: Record<string, string>
    exigirAprovacaoAceiteNovo?: boolean
  }) => void
  criarLoja: (nome?: string) => Promise<string | null>
  removerLoja: (id: string, confirmacao: string) => Promise<string | null>
  importarCaixa: (lojaId: string) => Promise<string | null>
  recarregar: () => void
  naoLidos: number
  aguardandoAprovacao: Ticket[]
  casosHumanos: Ticket[]
  setConfig: (patch: Partial<Config>) => void
  fecharTip: (id: string) => void
  sincronizar: () => Promise<number>
  enviarNovoEmail: (para: string, assunto: string, corpo: string, lojaId?: string) => void
  marcarLido: (id: string) => void
  marcarResolvido: (id: string) => void
  alternarRelatorio: (id: string, adicionar: boolean, texto?: string, detalhes?: Partial<DetalhesRelatorio>) => void
  /** dados prontos do caso para o popup do relatório (só leitura; nada muda no motor) */
  prepararRelatorio: (id: string) => Promise<PreparoRelatorio | null>
  /** vincula à mão o(s) pedido(s) de um caso do relatório (só pedidos da mesma loja) */
  vincularPedidosRelatorio: (id: string, pedidoIds: string[]) => void
  /** confere na Shopify os cupons cadastrados desta loja (existe, ativo, não expirado, percentual certo) */
  testarCupons: (lojaId: string) => Promise<{ erro?: string }>
  /** sincroniza os pedidos da Shopify e recalcula os casos do relatório (sem e-mail, sem IA) */
  atualizarRelatorio: () => Promise<{ casos: number; comPedido: number; erro?: string }>
  salvarOpcoesRelatorio: (opcoes: string[]) => void
  salvarOpcoesInstrucao: (opcoes: string[]) => void
  configurarRelatorioLink: (acao: 'criar' | 'revogar' | 'mostrar-hoje', valor?: boolean) => void
  editarLinhaRelatorio: (id: string, linha: string) => void
  /** move todos os casos marcados do dia `de` para o dia `para` (AAAA-MM-DD) */
  moverRelatorio: (de: string, para: string) => void
  marcarRespondido: (id: string, marcar: boolean) => void
  /**
   * CAMINHO OFICIAL DE ENVIO — o mesmo em Aprovações, na conversa e no modal
   * "Revisar e enviar" da Auditoria. `esperado` é opcional: quem manda o que
   * estava vendo pede a reconferência do servidor no instante do envio e
   * trata o erro por conta própria (sem alert).
   */
  aprovarEnviar: (id: string, texto: string, manterAberto?: boolean, origem?: 'ia' | 'manual', confirmarAlteracao?: boolean, esperado?: RevisaoEsperada)
    => Promise<{ erro?: string; desatualizado?: boolean; enviado?: boolean }>
  /** modo novo: você confirma se a imagem recebida comprova o defeito */
  validarFotoNovo: (id: string, valida: boolean) => void
  /** o dono recusa/corrige o aceite pendente: nada é confirmado; a conversa fica com ele */
  recusarAceiteNovo: (id: string) => void
  /** aceite aprovado por você: gera a confirmação ao cliente (troca/reenvio com prazo e endereço; reembolso 3–14 dias) */
  confirmarAceiteNovo: (id: string) => void
  /** Central operacional: correção manual da classificação de um caso */
  corrigirFaseCentral: (id: string, patch: { fase?: string | null; jornada?: string | null; justificativa?: string; remover?: boolean }) => void
  /** Parte 8: quantos casos históricos existem, quantos já têm inferência e quantos faltam */
  /** troca o modo da loja (individual, com validação e confirmação no servidor) */
  mudarModoLoja: (id: string, modo: 'classico' | 'novo') => Promise<{ erro?: string; faltando?: { chave: string; texto: string }[] }>
  /** link externo do pipeline: gerar (cria se não houver), novo (troca o token) ou revogar */
  configurarPipelineLink: (acao: 'gerar' | 'novo' | 'revogar') => Promise<void>
  statusMigracaoCentral: () => Promise<{ candidatos: number; inferidos: number; pendentes: number; iaConfigurada: boolean; ultima: { em: string; lidos: number; custoIA: number; por: string } | null }>
  /** Parte 8: roda a inferência da IA num lote de casos antigos (ou num só) — nunca automática */
  migrarCasosHistoricos: (opcoes: { limite?: number; forcar?: boolean; ticketId?: string; remover?: boolean }) => Promise<{ lidos?: number; restantes?: number; custoIA?: number; aviso?: string | null; erro?: string }>
  /** listas completas, sem o filtro de loja da barra lateral (Central operacional) */
  todosTickets: Ticket[]
  todosPedidos: Pedido[]
  editarRascunho: (id: string, texto: string) => void
  moverPara: (id: string, status: StatusTicket, motivo?: string) => void
  restaurar: (id: string) => void
  excluirDefinitivo: (id: string) => void
  addPolitica: (titulo: string, conteudo: string) => void
  togglePolitica: (id: string) => void
  removerPolitica: (id: string) => void
  addComportamento: (situacao: string, instrucao: string) => void
  editarComportamento: (id: string, situacao: string, instrucao: string) => void
  toggleComportamento: (id: string) => void
  removerComportamento: (id: string) => void
  addFaq: (pergunta: string, resposta: string) => void
  toggleFaq: (id: string) => void
  removerFaq: (id: string) => void
  instalarBiblioteca: () => void
  preencherPoliticas: () => void
  conectarShopify: () => void
  limparTudo: () => void
  testarEmail: (lojaId?: string) => Promise<StatusEmail>
  diagnosticarEmail: (lojaId?: string) => Promise<Diagnostico>
  testarIA: () => Promise<StatusIA>
  testarShopify: (lojaId?: string) => Promise<StatusShopify>
  desconectarShopify: (lojaId?: string) => void
  pausarIA: (id: string, pausar: boolean) => void
  moverParaHumano: (id: string, motivo: string) => Promise<boolean>
  retomarIA: (id: string, modo: 'reclassificar' | 'aguardar') => Promise<boolean>
  traduzirTicket: (id: string) => Promise<boolean>
  regenerarRascunho: (id: string, instrucao: string) => Promise<string | null>
  traduzirRascunho: (id: string) => Promise<string | null>
  gerarTexto: (id: string, instrucao: string) => Promise<{ erro?: string; texto?: string }>
  gerarEmail: (dados: { lojaId?: string; para: string; assunto?: string; instrucao?: string; idioma?: string }) => Promise<{ erro?: string; texto?: string }>
  relatorioReembolsos: () => Promise<RelatorioReembolsos>
  traduzirTexto: (texto: string) => Promise<{ erro?: string; traducao?: string }>
}

const Ctx = createContext<Store>(null as unknown as Store)
export const useStore = () => useContext(Ctx)

const TIPS_KEY = 'atendo-tips-fechados'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState>(estadoVazio)
  const [carregado, setCarregado] = useState(false)
  const [tipsFechados, setTipsFechados] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]') } catch { return [] }
  })
  const [lojaAtiva, setLojaAtivaState] = useState<string>(() => localStorage.getItem('atendo-loja-ativa') ?? 'todas')
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [autenticando, setAutenticando] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const p: Prefs = { ...prefsPadrao, ...JSON.parse(localStorage.getItem('atendo-prefs') ?? '{}') }
      if ((p.paleta as string) === 'cereja') p.paleta = 'amoled' // a paleta Cereja virou Amoled
      // valor desconhecido salvo no navegador (ex.: versão futura) cai no padrão
      if (!paletasValidas.includes(p.paleta)) p.paleta = 'notion'
      return p
    } catch { return prefsPadrao }
  })
  const debounces = useRef<Record<string, number>>({})

  // aplica tema e tamanho da fonte no documento
  useEffect(() => {
    localStorage.setItem('atendo-prefs', JSON.stringify(prefs))
    document.documentElement.dataset.theme = prefs.tema === 'escuro' ? 'dark' : ''
    if (prefs.paleta && prefs.paleta !== 'notion') document.documentElement.dataset.paleta = prefs.paleta
    else delete document.documentElement.dataset.paleta
    const zoom = { pequeno: '0.92', padrao: '1', grande: '1.08' }[prefs.tamanhoFonte]
    ;(document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = zoom
  }, [prefs])

  useEffect(() => { localStorage.setItem(TIPS_KEY, JSON.stringify(tipsFechados)) }, [tipsFechados])

  const aplicar = (r: { state?: ServerState; usuario?: Usuario }) => {
    if (r.state) setState(r.state)
    if (r.usuario) setUsuario(r.usuario)
  }

  // sessão inicial + polling (pega envios automáticos e e-mails novos do servidor)
  useEffect(() => {
    let ativo = true
    const buscar = async () => {
      try {
        const resp = await fetch('/api/me')
        if (resp.status === 401) { if (ativo) { setUsuario(null); setAutenticando(false) } return }
        const r = await resp.json()
        if (ativo) { aplicar(r); setCarregado(true); setAutenticando(false) }
      } catch { /* servidor fora do ar — tenta de novo no próximo tique */ }
    }
    buscar()
    const i = setInterval(buscar, 10_000)
    return () => { ativo = false; clearInterval(i) }
  }, [])

  const autenticar = async (rota: string, corpo: unknown): Promise<string | null> => {
    try {
      const resp = await fetch(`/api${rota}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      })
      const r = await resp.json()
      if (!resp.ok) return r.erro ?? 'Não foi possível entrar.'
      aplicar(r)
      setCarregado(true)
      return null
    } catch {
      return 'Servidor fora do ar. Tente novamente.'
    }
  }

  const store = useMemo<Store>(() => {
    const lojasVisiveis = state.lojas.filter(l => l.ativa)
    // Com uma loja específica selecionada, todas as listas do app são filtradas;
    // em "todas as lojas" a caixa é unificada.
    const daLoja = <T extends { lojaId?: string }>(x: T) =>
      lojaAtiva === 'todas' || (x.lojaId ?? 'loja1') === lojaAtiva
    const tickets = state.tickets.filter(daLoja)
    const pedidos = state.pedidos.filter(daLoja)
    const produtos = state.produtos.filter(daLoja)
    const lojaSel = state.lojas.find(l => l.id === lojaAtiva)
    const moedaLoja = lojaSel?.moeda ?? state.moeda

    // Moeda de exibição: converte pela cotação do dia (BCE); sem cotação
    // disponível, mostra na moeda da loja mesmo.
    const fmtMoeda = (v: number, origem: string = moedaLoja) => {
      const alvo = prefs.moedaExibicao
      const taxas = state.cotacoes
      if (alvo === 'loja' || alvo === origem || !taxas || !taxas[alvo] || !taxas[origem]) {
        return formatarMoeda(origem)(v)
      }
      return formatarMoeda(alvo)((v / taxas[origem]) * taxas[alvo])
    }

    return {
    ...state,
    tickets,
    pedidos,
    produtos,
    moeda: moedaLoja,
    carregado,
    tipsFechados,
    usuario,
    autenticando,
    prefs,
    setPref: patch => setPrefs(p => ({ ...p, ...patch })),
    fmtMoeda,
    entrar: (email, senha) => autenticar('/login', { email, senha }),
    registrar: (nome, email, senha) => autenticar('/registrar', { nome, email, senha }),
    sair: () => {
      fetch('/api/logout', { method: 'POST' }).finally(() => {
        setUsuario(null)
        setState(estadoVazio)
      })
    },
    atualizarConta: async dados => {
      const resp = await fetch('/api/conta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
      })
      const r = await resp.json()
      if (!resp.ok) return r.erro ?? 'Não foi possível salvar.'
      aplicar(r)
      return null
    },
    salvarEmailLoja: async (lojaId, cfg) => {
      const r = await api(`/lojas/${lojaId}/email`, 'POST', cfg)
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    removerEmailLoja: lojaId => api(`/lojas/${lojaId}/email`, 'DELETE').then(aplicar),
    salvarShopifyApp: async (lojaId, clientId, clientSecret) => {
      const r = await api(`/lojas/${lojaId}/shopify-app`, 'POST', { clientId, clientSecret })
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    removerShopifyApp: lojaId => api(`/lojas/${lojaId}/shopify-app`, 'DELETE').then(aplicar),
    conectarShopifyToken: async (lojaId, dominio, token) => {
      const r = await api(`/lojas/${lojaId}/shopify-token`, 'POST', { dominio, token })
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    testarEmailConfig: async cfg => {
      const r = (await api('/email/testar-config', 'POST', cfg)) as unknown as { resultado: ResultadoTesteEmail }
      return r.resultado ?? { ok: false, erro: 'Sem resposta do servidor.' }
    },
    lojaAtiva,
    lojasVisiveis,
    setLojaAtiva: id => { setLojaAtivaState(id); localStorage.setItem('atendo-loja-ativa', id) },
    atualizarLoja: (id, patch) => {
      setState(s => ({ ...s, lojas: s.lojas.map(l => (l.id === id ? { ...l, ...patch } : l)) }))
      api('/lojas', 'POST', { id, ...patch }).then(aplicar)
    },
    criarLoja: async nome => {
      const r = (await api('/lojas/nova', 'POST', { nome })) as unknown as { lojaId?: string; erro?: string; state?: ServerState }
      if (r.erro) return r.erro
      aplicar(r as { state?: ServerState })
      if (r.lojaId) { setLojaAtivaState(r.lojaId); localStorage.setItem('atendo-loja-ativa', r.lojaId) }
      return null
    },
    importarCaixa: async lojaId => {
      const r = await api(`/lojas/${lojaId}/importar`, 'POST')
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    recarregar: () => api('/state', 'GET').then(aplicar),
    removerLoja: async (id, confirmacao) => {
      const r = await api(`/lojas/${id}`, 'DELETE', { confirmacao })
      if (r.erro) return r.erro
      aplicar(r)
      // a loja removida pode ser a selecionada — volta para a visão geral
      if (lojaAtiva === id) { setLojaAtivaState('todas'); localStorage.setItem('atendo-loja-ativa', 'todas') }
      return null
    },
    naoLidos: tickets.filter(t => ['inbox', 'aprovacao', 'humano'].includes(t.status) && !t.lido).length,
    aguardandoAprovacao: tickets.filter(t => t.status === 'aprovacao'),
    casosHumanos: tickets.filter(t => t.status === 'humano'),

    fecharTip: id => setTipsFechados(x => [...x, id]),

    setConfig: patch => {
      setState(s => ({ ...s, config: { ...s.config, ...patch } }))
      api('/config', 'POST', patch).then(aplicar)
    },

    sincronizar: async () => {
      const r = await api('/sync')
      aplicar(r)
      return r.novos ?? 0
    },

    enviarNovoEmail: (para, assunto, corpo, lojaId) =>
      api('/compose', 'POST', { para, assunto, corpo, lojaId: lojaId ?? (lojaAtiva !== 'todas' ? lojaAtiva : undefined) }).then(aplicar),

    marcarLido: id => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, lido: true } : t)) }))
      api(`/tickets/${id}/lido`).then(aplicar)
    },

    marcarResolvido: id => api(`/tickets/${id}/resolver`, 'POST').then(aplicar),
    alternarRelatorio: (id, adicionar, texto, detalhes) => api(`/tickets/${id}/relatorio`, 'POST', { adicionar, texto, detalhes }).then(aplicar),
    vincularPedidosRelatorio: (id, pedidoIds) => api(`/tickets/${id}/relatorio/vincular`, 'POST', { pedidoIds }).then(aplicar),
    testarCupons: async lojaId => {
      const r = (await api(`/lojas/${lojaId}/testar-cupons`)) as { erro?: string; state?: ServerState }
      aplicar(r)
      return { erro: r.erro }
    },
    atualizarRelatorio: async () => {
      const r = (await api('/relatorio/atualizar')) as { casos?: number; comPedido?: number; erro?: string; state?: ServerState }
      aplicar(r)
      return { casos: r.casos ?? 0, comPedido: r.comPedido ?? 0, erro: r.erro }
    },
    prepararRelatorio: async id => {
      try {
        const r = await fetch(`/api/tickets/${id}/relatorio/preparar`)
        const d = await r.json()
        return d?.ok ? (d as PreparoRelatorio) : null
      } catch { return null }
    },
    salvarOpcoesRelatorio: opcoes => api('/relatorio-opcoes', 'POST', { opcoes }).then(aplicar),
    salvarOpcoesInstrucao: opcoes => api('/instrucao-opcoes', 'POST', { opcoes }).then(aplicar),
    configurarRelatorioLink: (acao, valor) => api('/relatorio-link', 'POST', { acao, valor }).then(aplicar),
    editarLinhaRelatorio: (id, linha) => api(`/tickets/${id}/relatorio-linha`, 'POST', { linha }).then(aplicar),
    moverRelatorio: (de, para) => api('/relatorio-mover', 'POST', { de, para }).then(aplicar),
    marcarRespondido: (id, marcar) => api(`/tickets/${id}/respondido`, 'POST', { marcar }).then(aplicar),

    editarRascunho: (id, texto) => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, rascunho: texto } : t)) }))
      clearTimeout(debounces.current[id])
      debounces.current[id] = window.setTimeout(() => { api(`/tickets/${id}/rascunho`, 'POST', { texto }) }, 800)
    },

    aprovarEnviar: async function aprovarEnviar(id, texto, manterAberto, origem, confirmarAlteracao, esperado) {
      clearTimeout(debounces.current[id])
      setState(s => ({
        ...s,
        tickets: s.tickets.map(t => (t.id === id
          ? { ...t, status: manterAberto ? t.status : 'enviado', resposta: texto, respostaOrigem: origem, respondidoEm: new Date().toISOString(), enviaEm: undefined }
          : t)),
      }))
      const r = await api(`/tickets/${id}/aprovar`, 'POST', { texto, manterAberto: !!manterAberto, origem, confirmarAlteracao: !!confirmarAlteracao, esperado })
      // modo novo: a edição mudou a oferta da etapa — só sai com confirmação explícita
      if ((r as { precisaConfirmar?: boolean }).precisaConfirmar && !confirmarAlteracao) {
        aplicar(r) // desfaz o "enviado" otimista
        if (window.confirm(`${r.erro}\n\nEnviar mesmo assim? A alteração fica registrada no histórico de fases.`)) {
          return aprovarEnviar(id, texto, manterAberto, origem, true, esperado)
        }
        return { erro: r.erro }
      }
      // quem mandou o que estava vendo mostra o motivo na própria tela
      if (r.erro && !esperado) alert(r.erro)
      aplicar(r)
      return { erro: r.erro, desatualizado: (r as { desatualizado?: boolean }).desatualizado, enviado: !r.erro }
    },
    validarFotoNovo: (id, valida) => api(`/tickets/${id}/novo/foto`, 'POST', { valida }).then(r => { if (r.erro) alert(r.erro); aplicar(r) }),
    recusarAceiteNovo: id => api(`/tickets/${id}/novo/recusar-aceite`, 'POST', {}).then(r => { if (r.erro) alert(r.erro); aplicar(r) }),
    confirmarAceiteNovo: id => api(`/tickets/${id}/novo/confirmar`, 'POST', {}).then(r => { if (r.erro) alert(r.erro); aplicar(r) }),
    corrigirFaseCentral: (id, patch) => api(`/tickets/${id}/central/fase`, 'POST', patch).then(r => { if (r.erro) alert(r.erro); aplicar(r) }),
    mudarModoLoja: async (id, modo) => {
      const r = await api(`/lojas/${id}/modo`, 'POST', { modo, confirmar: true }) as { erro?: string; faltando?: { chave: string; texto: string }[]; state?: ServerState }
      aplicar(r)
      return r
    },
    configurarPipelineLink: acao => api('/pipeline-link', 'POST', { acao }).then(aplicar),
    statusMigracaoCentral: () => fetch('/api/central/migracao').then(r => r.json()),
    migrarCasosHistoricos: async opcoes => {
      const r = await api('/central/migrar', 'POST', opcoes) as { lidos?: number; restantes?: number; custoIA?: number; aviso?: string | null; erro?: string; state?: ServerState }
      if (r.erro) alert(r.erro)
      aplicar(r)
      return r
    },
    todosTickets: state.tickets,
    todosPedidos: state.pedidos,

    moverPara: (id, status, motivo) => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, statusAnterior: t.status, status, enviaEm: undefined } : t)) }))
      api(`/tickets/${id}/mover`, 'POST', { status, motivo }).then(aplicar)
    },

    restaurar: id => api(`/tickets/${id}/restaurar`).then(aplicar),
    excluirDefinitivo: id => api(`/tickets/${id}`, 'DELETE').then(aplicar),

    addPolitica: (titulo, conteudo) => api('/politicas', 'POST', { titulo, conteudo }).then(aplicar),
    togglePolitica: id => api(`/politicas/${id}/toggle`).then(aplicar),
    removerPolitica: id => api(`/politicas/${id}`, 'DELETE').then(aplicar),
    addComportamento: (situacao, instrucao) => api('/comportamentos', 'POST', { situacao, instrucao }).then(aplicar),
    editarComportamento: (id, situacao, instrucao) => api(`/comportamentos/${id}/editar`, 'POST', { situacao, instrucao }).then(aplicar),
    toggleComportamento: id => api(`/comportamentos/${id}/toggle`).then(aplicar),
    removerComportamento: id => api(`/comportamentos/${id}`, 'DELETE').then(aplicar),
    addFaq: (pergunta, resposta) => api('/faqs', 'POST', { pergunta, resposta }).then(aplicar),
    toggleFaq: id => api(`/faqs/${id}/toggle`).then(aplicar),
    removerFaq: id => api(`/faqs/${id}`, 'DELETE').then(aplicar),
    instalarBiblioteca: () => api('/faqs/biblioteca').then(aplicar),
    preencherPoliticas: () => api('/politicas/sugeridas').then(aplicar),

    conectarShopify: () => api('/shopify/demo').then(aplicar),
    limparTudo: () => api('/reset').then(aplicar),

    testarEmail: async (lojaId = 'loja1') => {
      const r = (await api(`/email/testar?loja=${lojaId}`)) as { state?: ServerState; status: StatusEmail }
      aplicar(r)
      return r.status
    },

    diagnosticarEmail: async (lojaId = 'loja1') => {
      const r = (await api(`/email/diagnostico?loja=${lojaId}`)) as { state?: ServerState; diagnostico: Diagnostico }
      aplicar(r)
      return r.diagnostico
    },

    testarIA: async () => {
      const r = (await api('/ia/testar')) as { state?: ServerState; status: StatusIA }
      aplicar(r)
      return r.status
    },

    testarShopify: async (lojaId = 'loja1') => {
      const r = (await api(`/shopify/testar?lojaId=${lojaId}`)) as { state?: ServerState; status: StatusShopify }
      aplicar(r)
      return r.status
    },

    desconectarShopify: (lojaId = 'loja1') => api('/shopify/desconectar', 'POST', { lojaId }).then(aplicar),

    // O dono assume a conversa: uma chamada só, auditada e idempotente. Não é
    // "mover de pasta" — é desligar a IA nesta conversa.
    moverParaHumano: async (id, motivo) => {
      const r = await api(`/tickets/${id}/atendimento-humano`, 'POST', { confirmar: true, motivo })
      if (r.erro) { alert(r.erro); return false }
      aplicar(r); return true
    },
    // Devolve a conversa para a IA. O rascunho antigo nunca volta.
    retomarIA: async (id, modo) => {
      const r = await api(`/tickets/${id}/retomar-ia`, 'POST', { confirmar: true, modo })
      if (r.erro) { alert(r.erro); return false }
      aplicar(r); return true
    },

    pausarIA: (id, pausar) => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, iaPausada: pausar, enviaEm: pausar ? undefined : t.enviaEm } : t)) }))
      api(`/tickets/${id}/pausar-ia`, 'POST', { pausar }).then(aplicar)
    },

    traduzirTicket: async id => {
      const r = await api(`/tickets/${id}/traduzir`)
      if (r.erro) { alert(r.erro); return false }
      aplicar(r)
      return true
    },
    regenerarRascunho: async (id, instrucao) => {
      const r = await api(`/tickets/${id}/regenerar`, 'POST', { instrucao })
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    traduzirRascunho: async id => {
      const r = await api(`/tickets/${id}/traduzir-rascunho`, 'POST')
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    gerarTexto: async (id, instrucao) => {
      const r = (await api(`/tickets/${id}/regenerar`, 'POST', { instrucao, somenteTexto: true })) as { erro?: string; texto?: string; state?: ServerState }
      if (r.erro) return { erro: r.erro }
      aplicar(r)
      return { texto: r.texto }
    },
    traduzirTexto: async texto => {
      const r = (await api('/traduzir-texto', 'POST', { texto })) as { erro?: string; traducao?: string }
      if (r.erro) return { erro: r.erro }
      return { traducao: r.traducao }
    },
    relatorioReembolsos: async () => {
      const r = (await api('/relatorio-reembolsos', 'POST')) as RelatorioReembolsos & { state?: ServerState }
      if (r.erro) return { erro: r.erro }
      aplicar(r)
      return r
    },
    gerarEmail: async dados => {
      const r = (await api('/gerar-email', 'POST', dados)) as { erro?: string; texto?: string }
      if (r.erro) return { erro: r.erro }
      return { texto: r.texto }
    },
    }
  }, [state, carregado, tipsFechados, lojaAtiva, usuario, autenticando, prefs])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

/* ---------------- Helpers ---------------- */

export const nomeCategoria: Record<Categoria, string> = {
  rastreio: 'Rastreio', reembolso: 'Reembolso', troca: 'Troca',
  produto: 'Produto', entrega: 'Entrega', outro: 'Outro',
}

export const nomeIdioma: Record<string, string> = {
  pt: 'Português', en: 'Inglês', es: 'Espanhol', it: 'Italiano', de: 'Alemão', fr: 'Francês', nl: 'Holandês',
}

export function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return `${d} d`
}

export function formatarMoeda(moeda: string): (v: number) => string {
  try {
    const f = new Intl.NumberFormat('de-DE', { style: 'currency', currency: moeda || 'EUR' })
    return v => f.format(v)
  } catch {
    return v => `${moeda} ${v.toFixed(2)}`
  }
}

export function saudacaoDia(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}
