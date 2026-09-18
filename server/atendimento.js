/**
 * Modos de atendimento.
 *
 * "classico" é o atendimento original: fluxo de devolução em 5 etapas dentro do
 * prompt, com as travas que impedem a IA de confirmar reembolso ou troca.
 *
 * "novo" é o motor de estados descrito em docs/atendimento-novo-decisoes.md:
 * a IA só CLASSIFICA o que o cliente disse; quem escolhe a única ação permitida
 * é este arquivo, a partir da fase gravada no ticket. Uma etapa por resposta do
 * cliente, sem saltos, com aceite indo para o dono decidir.
 *
 * Os dois convivem: cada loja escolhe o seu (loja.modoAtendimento).
 */

import { confirmacaoIndevida } from './logic.js'
import { produtoFoiInformado } from '../shared/produto.js'
// só o texto NOVO do cliente vale como declaração dele (o citado é referência)
import { separarTexto } from '../shared/mensagem.js'

export const MODOS_ATENDIMENTO = {
  classico: 'Clássico — o atendimento atual',
  novo: 'Novo — motor de etapas',
}

/** Modo de uma loja, com o clássico como padrão para quem nunca escolheu. */
export const modoDaLoja = loja => (loja?.modoAtendimento === 'novo' ? 'novo' : 'classico')

/** Percentuais de cupom que o mapa usa — cada loja cadastra o código de cada um. */
export const PERCENTUAIS_CUPOM = [10, 15, 25, 30, 35, 40]

/* ------------------------------------------------------------------ */
/* Jornadas e fases                                                    */
/* ------------------------------------------------------------------ */

export const JORNADAS = {
  entrada: 'Entrada geral',
  tamanho: 'Tamanho / caimento',
  qualidade: 'Qualidade / não gostou',
  defeito_errado: 'Defeito / produto errado',
  nao_recebido: 'Não recebeu / atraso',
  cancelamento: 'Cancelamento',
}

/**
 * Cada fase é a ÚNICA ação permitida naquele ponto da conversa.
 *
 *  oferta        o que a loja oferece nesta fase (tipo, percentual, cupom, prazo)
 *  requer        dados que precisam existir antes de enviar esta fase
 *  aoAceitar     para onde vai se o cliente aceitar ('humano' = decisão do dono;
 *                'endereco' = pedir endereço completo antes de ir ao dono)
 *  aoRecusar     próxima fase se o cliente recusar (null = não há próxima)
 *  instrucao     o que a IA deve escrever — só esta ação, nada de outras etapas
 *  confirmacao   true nas fases que só existem depois de o dono aprovar um aceite
 */
export const FASES = {
  /* ---- coleta ---- */
  coleta: {
    jornada: 'entrada', titulo: 'Coletar o que falta',
    oferta: null, requer: [],
    aoAceitar: null, aoRecusar: null,
    instrucao: 'Peça, de forma curta e cordial, SOMENTE as informações que faltam (listadas abaixo). Não ofereça nada: nem troca, nem cupom, nem reembolso, nem etiqueta.',
  },

  /* ---- tamanho (3.1) ---- */
  tam_ajuste: {
    jornada: 'tamanho', titulo: 'Perguntar se ficou pequeno ou grande',
    oferta: null, requer: ['produtos'],
    aoAceitar: null, aoRecusar: null,
    instrucao: 'Para cada produto envolvido, pergunte se ficou PEQUENO ou GRANDE. Não recomende tamanho ainda e não ofereça nada.',
  },
  tam_troca: {
    jornada: 'tamanho', titulo: 'Troca gratuita pelo tamanho certo',
    oferta: { tipo: 'troca', pct: null, cupom: null, prazo: '5 a 11 dias', semDevolucao: true },
    requer: ['produtos', 'ajuste'],
    aoAceitar: 'endereco', aoRecusar: 'troca_20',
    instrucao: 'Recomende o tamanho correto para cada produto com base no ajuste informado (ficou pequeno → um tamanho MAIOR; ficou grande → um tamanho MENOR; nunca o contrário). Ofereça a troca GRATUITA por esse tamanho, sem necessidade de devolver o produto atual, com frete expresso e prazo de 5 a 11 dias. Pergunte se o cliente aceita.',
  },
  troca_20: {
    jornada: 'tamanho', titulo: 'Troca gratuita + reembolso de 20%',
    oferta: { tipo: 'troca_reembolso', pct: 20, cupom: null, prazo: '5 a 11 dias', semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'endereco', aoRecusar: 'reemb_40',
    instrucao: 'Ofereça novamente a troca gratuita (sem devolver o produto atual, frete expresso, 5 a 11 dias) e, além dela, um reembolso de 20% do valor pago, informando o valor em dinheiro. Pergunte se aceita.',
  },

  /* ---- produto errado (3.2) ---- */
  err_envio: {
    jornada: 'defeito_errado', titulo: 'Enviar o produto correto + cupom de 15%',
    oferta: { tipo: 'reenvio', pct: null, cupom: 15, prazo: '4 a 11 dias', semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'endereco', aoRecusar: 'qual_cupom_35',
    instrucao: 'Peça desculpas pelo erro e ofereça o envio GRATUITO do produto correto, sem necessidade de devolver o que recebeu, com frete expresso de 4 a 11 dias, mais um cupom de 15% como pedido de desculpas (informe o código). Pergunte se aceita.',
  },

  /* ---- defeito (3.3) ---- */
  def_foto: {
    jornada: 'defeito_errado', titulo: 'Pedir foto do defeito',
    oferta: null, requer: ['produtos'],
    aoAceitar: null, aoRecusar: null,
    instrucao: 'Lamente o ocorrido e peça uma foto do produto mostrando o defeito ou dano, para dar andamento. Não ofereça nada até a foto chegar.',
  },
  def_troca: {
    jornada: 'defeito_errado', titulo: 'Troca gratuita do produto com defeito',
    oferta: { tipo: 'troca', pct: null, cupom: null, prazo: '5 a 11 dias', semDevolucao: true },
    requer: ['produtos', 'foto'],
    aoAceitar: 'endereco', aoRecusar: 'troca_20',
    instrucao: 'Agradeça a foto, peça desculpas e ofereça a troca GRATUITA do produto, sem necessidade de devolver o recebido, com frete expresso de 5 a 11 dias. Pergunte se aceita.',
  },

  /* ---- qualidade / não gostou (4.3) ---- */
  qual_troca: {
    jornada: 'qualidade', titulo: 'Troca por outra cor/tamanho/modelo + cupom de 15%',
    oferta: { tipo: 'troca', pct: null, cupom: 15, prazo: '4 a 11 dias', semDevolucao: true },
    requer: ['produtos', 'motivo'],
    aoAceitar: 'endereco', aoRecusar: 'qual_cupom_35',
    instrucao: 'Lamente que o produto não agradou e ofereça GRATUITAMENTE outra cor, tamanho, modelo ou versão que atenda melhor, sem devolver a primeira remessa, com frete expresso de 4 a 11 dias, mais um cupom de 15% (informe o código). Pergunte qual opção prefere.',
  },
  qual_cupom_35: {
    jornada: 'qualidade', titulo: 'Cupom de 35% ficando com o produto',
    oferta: { tipo: 'cupom', pct: null, cupom: 35, prazo: null, semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'humano', aoRecusar: 'reemb_25',
    instrucao: 'Ofereça um cupom de 35% válido para qualquer pedido (informe o código), e o cliente FICA com o produto. Pergunte se aceita.',
  },

  /* ---- escada de reembolso (5) ---- */
  reemb_25: {
    jornada: 'qualidade', titulo: 'Reembolso de 25%',
    oferta: { tipo: 'reembolso', pct: 25, cupom: null, prazo: null, semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'humano', aoRecusar: 'reemb_40',
    instrucao: 'Ofereça reembolso de 25% do valor pago (informe o valor em dinheiro), e o cliente FICA com o produto. Pergunte se aceita.',
  },
  reemb_40: {
    jornada: 'qualidade', titulo: 'Reembolso de 40%',
    oferta: { tipo: 'reembolso', pct: 40, cupom: null, prazo: null, semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'humano', aoRecusar: 'reemb_50',
    instrucao: 'Explique que, na devolução, o reembolso integral só seria feito depois que o pedido chegasse às instalações e fosse revisado, o que demoraria mais de dez dias. Para evitar isso, ofereça 40% do valor pago (informe o valor em dinheiro) sem necessidade de devolução. Pergunte se aceita.',
  },
  reemb_50: {
    jornada: 'qualidade', titulo: 'Reembolso de 50%',
    oferta: { tipo: 'reembolso', pct: 50, cupom: null, prazo: null, semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'humano', aoRecusar: 'reemb_60',
    instrucao: 'Explique que, numa devolução, o frete de retorno ficaria por conta do cliente e custaria aproximadamente o valor indicado abaixo — diga SOMENTE esse valor em dinheiro; NUNCA diga a porcentagem que o frete representa. Para evitar a devolução, ofereça 50% do valor pago (informe o valor) ficando com o produto. Pergunte se aceita.',
  },
  reemb_60: {
    jornada: 'qualidade', titulo: 'Reembolso de 60%',
    oferta: { tipo: 'reembolso', pct: 60, cupom: null, prazo: null, semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'humano', aoRecusar: 'reemb_70',
    instrucao: 'Reforce com clareza os pontos negativos da devolução (frete por conta do cliente, espera de mais de dez dias pela revisão) e ofereça 60% do valor pago (informe o valor) ficando com o produto. Pergunte se aceita.',
  },
  reemb_70: {
    jornada: 'qualidade', titulo: 'Reembolso de 70%',
    oferta: { tipo: 'reembolso', pct: 70, cupom: null, prazo: null, semDevolucao: true },
    requer: ['produtos'],
    aoAceitar: 'humano', aoRecusar: 'reemb_100',
    instrucao: 'Reforce os pontos negativos da devolução e explique que, descontado o frete de retorno, financeiramente a devolução ficaria equivalente para o cliente. Ofereça 70% do valor pago (informe o valor) ficando com o produto. Pergunte se aceita.',
  },
  reemb_100: {
    jornada: 'qualidade', titulo: 'Reembolso de 100% — decisão do dono',
    oferta: { tipo: 'reembolso', pct: 100, cupom: null, prazo: null, semDevolucao: false },
    requer: [], aoAceitar: 'humano', aoRecusar: null,
    instrucao: null, // não escreve: vai direto para a fila humana
  },

  /* ---- não recebido: perguntou o status (6) / ainda não chegou (8) ---- */
  nc_no_prazo: {
    jornada: 'nao_recebido', titulo: 'Dentro do prazo — acalmar e informar a data',
    oferta: null, requer: [],
    aoAceitar: null, aoRecusar: null,
    instrucao: 'Acalme o cliente: o pedido está dentro do prazo. Informe o prazo e a data provável de recebimento indicados abaixo. Se ele pediu cancelamento ou reembolso, explique com gentileza que isso só pode seguir depois do fim do prazo de entrega, conforme os termos de entrega. Não ofereça nada.',
  },
  nc_atrasado_25: {
    jornada: 'nao_recebido', titulo: 'Atrasado — pedir 5 dias úteis + cupom de 25%',
    oferta: { tipo: 'cupom', pct: null, cupom: 25, prazo: null, semDevolucao: false },
    requer: [],
    aoAceitar: 'humano', aoRecusar: 'nc_cupom_40',
    instrucao: 'Peça desculpas com cuidado. Explique que a transportadora teve atrasos logísticos e que a loja NÃO deixará o cliente no prejuízo. Peça que aguarde no máximo mais cinco dias úteis, conforme informação da transportadora, e ofereça um cupom de 25% como pedido de desculpas (informe o código). Pergunte se aceita aguardar.',
  },
  nc_cupom_40: {
    jornada: 'nao_recebido', titulo: 'Cupom de 40% para aguardar mais um pouco',
    oferta: { tipo: 'cupom', pct: null, cupom: 40, prazo: null, semDevolucao: false },
    requer: [],
    aoAceitar: 'humano', aoRecusar: 'reemb_100',
    instrucao: 'Entenda a frustração e ofereça um cupom de 40% para a próxima compra (informe o código) como compensação por aguardar mais um pouco. Pergunte se aceita.',
  },

  /* ---- chegou pedindo reembolso por não recebido (7) ---- */
  nr_reenvio_30: {
    jornada: 'nao_recebido', titulo: 'Reenvio expresso + cupom de 30%',
    oferta: { tipo: 'reenvio', pct: null, cupom: 30, prazo: '4 a 11 dias', semDevolucao: false },
    requer: [],
    aoAceitar: 'endereco', aoRecusar: 'nr_reenvio_20',
    instrucao: 'Informe que o reembolso só poderá ser efetuado quando o pedido retornar às instalações, e que esse retorno pode demorar mais de 17 dias por ser mais lento que a entrega. Como solução rápida, ofereça o REENVIO com frete expresso de 4 a 11 dias mais um cupom de 30% para a próxima compra (informe o código). Pergunte se aceita.',
  },
  nr_entregue_aguardar: {
    jornada: 'nao_recebido', titulo: 'Marcado como entregue — aguardar 2 dias',
    oferta: null, requer: [],
    aoAceitar: null, aoRecusar: 'nr_reenvio_20',
    instrucao: 'Explique que a transportadora às vezes marca como entregue enquanto o pacote ainda está a caminho. Peça que aguarde mais dois dias e que verifique com vizinhos ou na portaria se alguém recebeu na ausência dele. Não ofereça nada ainda.',
  },
  nr_reenvio_20: {
    jornada: 'nao_recebido', titulo: 'Reenvio expresso + reembolso de 20%',
    oferta: { tipo: 'reenvio_reembolso', pct: 20, cupom: null, prazo: '4 a 11 dias', semDevolucao: false },
    requer: [],
    aoAceitar: 'endereco', aoRecusar: 'nr_reenvio_35',
    instrucao: 'Informe novamente que o reembolso depende do retorno do pedido às instalações e pode demorar mais de 17 dias. Ofereça o REENVIO com frete expresso de 4 a 11 dias mais reembolso de 20% do valor pago (informe o valor). Pergunte se aceita.',
  },
  nr_reenvio_35: {
    jornada: 'nao_recebido', titulo: 'Reenvio expresso + reembolso de 35%',
    oferta: { tipo: 'reenvio_reembolso', pct: 35, cupom: null, prazo: '4 a 11 dias', semDevolucao: false },
    requer: [],
    aoAceitar: 'endereco', aoRecusar: 'reemb_100',
    instrucao: 'Reforce os pontos negativos de esperar o retorno do pedido e ofereça o REENVIO expresso de 4 a 11 dias mais reembolso de 35% do valor pago (informe o valor). Pergunte se aceita.',
  },

  /* ---- cancelamento de pedido não processado (8.3) ---- */
  cancel_nao_processado: {
    jornada: 'cancelamento', titulo: 'Cancelamento — decisão do dono',
    oferta: { tipo: 'cancelamento', pct: 100, cupom: null, prazo: null, semDevolucao: false },
    requer: [], aoAceitar: 'humano', aoRecusar: null,
    instrucao: null, // vai direto para a fila humana
  },

  /* ---- aceite (9) ---- */
  endereco: {
    jornada: 'entrada', titulo: 'Confirmar endereço completo',
    oferta: null, requer: [],
    aoAceitar: null, aoRecusar: null,
    instrucao: 'Confirme que a opção aceita será providenciada e peça o endereço de entrega COMPLETO (rua, número, complemento, CEP/código postal, cidade, país) para o envio. Não prometa data nem diga que já foi despachado.',
  },

  /* ---- confirmação depois de o dono aprovar o aceite (9) ---- */
  // Únicas fases em que a IA pode falar de fato consumado. O motor nunca entra
  // nelas sozinho: só o clique do lojista ("Aprovar e gerar a confirmação").
  conf_troca: {
    jornada: 'entrada', titulo: 'Confirmação — troca/reenvio aprovado', confirmacao: true,
    oferta: null, requer: [], aoAceitar: null, aoRecusar: null,
    instrucao: 'Confirme ao cliente que a opção aceita foi APROVADA e já está sendo processada: o envio sai com frete expresso e chega no prazo indicado abaixo. Repita o endereço de entrega confirmado e peça que avise imediatamente se algo nele estiver errado. Se a opção incluir reembolso parcial, informe o valor e que ele volta ao método de pagamento original em 3 a 14 dias. Se incluir cupom, repita o código. Não ofereça nada além disso.',
  },
  conf_reembolso: {
    jornada: 'entrada', titulo: 'Confirmação — reembolso aprovado', confirmacao: true,
    oferta: null, requer: [], aoAceitar: null, aoRecusar: null,
    instrucao: 'Confirme ao cliente que o reembolso aceito foi APROVADO e será processado: informe o percentual e o valor em dinheiro, e que o dinheiro volta ao método de pagamento original em 3 a 14 dias. Se a opção previa que ele fica com o produto, diga isso. Se ele questionar o prazo, explique que a loja segue a lei do país. Não ofereça nada além disso.',
  },
  conf_cupom: {
    jornada: 'entrada', titulo: 'Confirmação — cupom liberado', confirmacao: true,
    oferta: null, requer: [], aoAceitar: null, aoRecusar: null,
    instrucao: 'Confirme ao cliente que o acordo foi APROVADO: repita o código do cupom, diga que vale para qualquer pedido na loja e, quando for o caso, que ele fica com o produto. Se o combinado era aguardar a entrega, reforce que a loja acompanha o pedido. Não ofereça nada além disso.',
  },
  conf_cancelamento: {
    jornada: 'entrada', titulo: 'Confirmação — pedido cancelado', confirmacao: true,
    oferta: null, requer: [], aoAceitar: null, aoRecusar: null,
    instrucao: 'Confirme ao cliente que o pedido foi CANCELADO, como é direito dele, e que o valor pago volta ao método de pagamento original em 3 a 14 dias. Se ele questionar o prazo, explique que a loja segue a lei do país. Não ofereça nada além disso.',
  },
}

/** Fases que fecham a rodada da IA mandando o caso para o dono. */
export const FASES_HUMANAS = new Set(['reemb_100', 'cancel_nao_processado'])

/**
 * Fase de confirmação que corresponde à opção aceita (ou decidida pelo dono).
 * Mapa, seção 9: troca/reenvio → prazo e endereço; reembolso/cancelamento →
 * 3 a 14 dias para o dinheiro voltar; cupom → código liberado.
 */
export function faseDeConfirmacao(faseAceitaId) {
  const tipo = FASES[faseAceitaId]?.oferta?.tipo
  if (!tipo) return null
  if (/troca|reenvio/.test(tipo)) return 'conf_troca'
  if (tipo === 'reembolso') return 'conf_reembolso'
  if (tipo === 'cupom') return 'conf_cupom'
  if (tipo === 'cancelamento') return 'conf_cancelamento'
  return null
}

/* ------------------------------------------------------------------ */
/* Estado gravado no ticket                                            */
/* ------------------------------------------------------------------ */

export function novoEstado() {
  return {
    versao: 1,
    fluxo: null,
    subfluxo: null,          // não recebido: 'status' | 'cancelamento' | 'nao_chegou' | 'recusado' | 'entregue'
    etapa: null,
    produtosAfetados: [],
    produtosInformados: false,
    conclusaoPendente: null,   // solução aceita pelo cliente (fotografa o modo manual/automático no instante do aceite)
    motivo: null,
    ajusteTamanho: null,
    fotoSolicitada: false,
    fotoRecebida: false,     // chegou uma imagem (ainda não é prova de nada)
    fotoValidada: null,      // true só depois de o lojista confirmar que mostra o defeito
    aguardandoComprovacao: false, // imagem recebida no fluxo de defeito, esperando o lojista dizer se comprova
    idioma: null,            // idioma-alvo da conversa (ISO 639-1), pela última mensagem completa do cliente
    idiomaOriginal: null,    // como veio da detecção (de-AT, nl-BE…), só para exibir
    idiomaIncerto: false,    // ainda sem mensagem longa o bastante para ter certeza
    ofertaAtual: null,
    ofertaEnviadaEm: null,
    aguardando: null,
    acaoAceita: null,
    enderecoInformado: null, // o que o cliente já escreveu (pode estar incompleto)
    enderecoConfirmado: null, // só depois de validado por componentes
    historicoEtapas: [],
    transicaoPendente: null,
    proximaAposColeta: null,
  }
}

/* ------------------------------------------------------------------ */
/* Prazo de entrega em dias úteis                                      */
/* ------------------------------------------------------------------ */

const DIA = 864e5
const fimDeSemana = d => d.getUTCDay() === 0 || d.getUTCDay() === 6

/** Soma N dias úteis a uma data (sábado e domingo não contam). */
export function somarDiasUteis(data, dias) {
  const d = new Date(data)
  let faltam = dias
  while (faltam > 0) {
    d.setTime(d.getTime() + DIA)
    if (!fimDeSemana(d)) faltam--
  }
  return d
}

/** Prazo padrão quando a loja ainda não cadastrou o dela. */
export const PRAZO_PADRAO = { min: 5, max: 12, processamento: 3 }

/**
 * Situação do prazo de um pedido: limite (fim do prazo máximo), data provável
 * (prazo mínimo) e se já venceu. Base: data de despacho; sem despacho, a data
 * do pedido mais os dias de processamento.
 */
export function prazoDoPedido(pedido, loja, agora = Date.now()) {
  const p = { ...PRAZO_PADRAO, ...(loja?.prazoEntrega ?? {}) }
  const despacho = pedido?.despachadoEm ? new Date(pedido.despachadoEm) : null
  const base = despacho ?? (pedido?.criadoEm ? somarDiasUteis(new Date(pedido.criadoEm + 'T12:00:00Z'), p.processamento) : new Date(agora))
  const limite = somarDiasUteis(base, p.max)
  const provavel = somarDiasUteis(base, p.min)
  return {
    inicio: base.toISOString().slice(0, 10),
    provavel: provavel.toISOString().slice(0, 10),
    limite: limite.toISOString().slice(0, 10),
    vencido: agora > limite.getTime(),
    diasUteis: `${p.min} a ${p.max} dias úteis`,
  }
}

/* ------------------------------------------------------------------ */
/* Cadência do modo novo (fixa, não depende de config.atrasoMinutos)  */
/*   1ª resposta: 3 minutos depois da mensagem mais recente do cliente  */
/*   depois: 5 horas depois da mensagem mais recente do cliente         */
/* ------------------------------------------------------------------ */

export const PRIMEIRA_RESPOSTA_MS = 3 * 60_000
export const CADENCIA_MS = 5 * 3600_000

/** Já existe resposta da loja nesta conversa? (a cadência só vale depois dela) */
export const lojaJaRespondeu = t =>
  !!t.resposta || (t.historico ?? []).some(m => m.autor === 'atendo')

/** Última mensagem do cliente, em ms. */
export function ultimaMensagemClienteMs(t) {
  const datas = [t.data, ...(t.historico ?? []).filter(m => m.autor !== 'atendo').map(m => m.data)]
  return Math.max(0, ...datas.filter(Boolean).map(d => new Date(d).getTime()))
}

/**
 * Quando a próxima resposta pode sair (modo novo). O prazo parte do horário da
 * mensagem mais recente do CLIENTE, não do fim do processamento:
 *   primeira resposta da loja: max(agora, últimaMensagem + 3 min)
 *   demais respostas:          max(agora, últimaMensagem + 5 h)
 * Mensagem nova do cliente reinicia o relógio (a mais recente manda). Se o
 * servidor só processar depois do prazo, a resposta já pode sair (= agora).
 * Não usa config.atrasoMinutos — esse seletor é só do atendimento clássico.
 */
export function horarioMinimoEnvio(t, agora = Date.now()) {
  const espera = lojaJaRespondeu(t) ? CADENCIA_MS : PRIMEIRA_RESPOSTA_MS
  return Math.max(agora, ultimaMensagemClienteMs(t) + espera)
}

/* ------------------------------------------------------------------ */
/* A máquina de estados                                                */
/* ------------------------------------------------------------------ */

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Casa os produtos que o cliente citou com os itens do pedido. */
export function casarProdutos(citados, pedido) {
  const itens = pedido?.itens ?? []
  const achados = []
  for (const c of citados ?? []) {
    const n = norm(c)
    if (!n) continue
    const item = itens.find(i => {
      const t = norm(`${i.titulo} ${i.variante ?? ''}`)
      return t === n || t.includes(n) || n.includes(norm(i.titulo))
    })
    if (!item) continue // "o CLIENTE tem que informar quais produtos": só vale o que casa com um item real do pedido
    const rotulo = `${item.titulo}${item.variante ? ` (${item.variante})` : ''}`
    if (!achados.includes(rotulo)) achados.push(rotulo)
  }
  return achados
}

/** Rótulos de todos os itens do pedido (para preencher sozinho quando só há um). */
const rotulosDoPedido = pedido => (pedido?.itens ?? []).map(i => `${i.titulo}${i.variante ? ` (${i.variante})` : ''}`)

/** Primeira OFERTA de cada fluxo. As fases de coleta (perguntar pequeno/grande,
 *  pedir foto, pedir produtos) entram sozinhas quando falta o dado exigido. */
function faseInicialDoFluxo(fluxo) {
  return {
    tamanho: 'tam_troca',
    errado: 'err_envio',
    defeito: 'def_troca',
    qualidade: 'qual_troca',
    nao_recebido_status: 'nc_no_prazo',
    nao_recebido_reembolso: 'nr_reenvio_30',
    entregue_nao_recebido: 'nr_entregue_aguardar',
    cancelamento: 'cancel_nao_processado',
  }[fluxo] ?? null
}

/**
 * Escolhe o fluxo na triagem, a partir da classificação e do pedido.
 * Retorna null quando o caso está fora do mapa.
 */
export function escolherFluxo(cls, pedido, loja, agora = Date.now()) {
  const querReembolso = cls.intencao === 'pede_reembolso'
  const querCancelar = cls.intencao === 'pede_cancelamento'
  const status = pedido?.status ?? null

  // cancelamento de pedido ainda não processado
  if (querCancelar && (status === 'aguardando' || !pedido)) return 'cancelamento'

  // entrega: o que o cliente relata + o que a Shopify sabe
  const sit = cls.situacaoEntrega
  if (sit === 'entregue_nao_recebido' || (cls.motivo === 'nao_recebido' && status === 'entregue')) return 'entregue_nao_recebido'
  if (sit === 'voltou_remetente' || sit === 'recusou_na_porta') return 'nao_recebido_reembolso'
  if (cls.motivo === 'nao_recebido' || sit === 'nao_chegou' || cls.intencao === 'pergunta_status') {
    const prazo = prazoDoPedido(pedido, loja, agora)
    // já chegou pedindo reembolso de um pedido que não veio: seção 7
    if (querReembolso && prazo.vencido) return 'nao_recebido_reembolso'
    // pediu cancelamento/reembolso ou só perguntou: seção 6/8 (o prazo decide a fase)
    return 'nao_recebido_status'
  }

  // devolução/troca/reembolso com o produto em mãos
  if (querReembolso || querCancelar || cls.intencao === 'pede_troca' || cls.motivo) {
    switch (cls.motivo) {
      case 'tamanho': return 'tamanho'
      case 'errado': return 'errado'
      case 'defeito': return 'defeito'
      case 'qualidade':
      case 'nao_gostou':
      case 'nao_informado':
      case null:
      case undefined:
        return 'qualidade'
      default: return 'qualidade'
    }
  }
  return null
}

/** Dados que ainda faltam para uma fase. */
export function faltaPara(faseId, an) {
  const fase = FASES[faseId]
  if (!fase) return []
  const faltando = []
  for (const r of fase.requer) {
    if (r === 'produtos' && !an.produtosAfetados.length) faltando.push('produtos')
    if (r === 'motivo' && !an.motivo) faltando.push('motivo')
    if (r === 'ajuste' && !(an.ajusteTamanho && Object.keys(an.ajusteTamanho).length)) faltando.push('ajuste')
    if (r === 'foto' && an.fotoValidada !== true) faltando.push('foto')
  }
  return faltando
}

/**
 * Decide o que fazer com a mensagem que acabou de chegar.
 *
 *  an        estado atendimentoNovo do ticket (não é alterado; devolve cópia)
 *  cls       classificação da IA
 *  pedido    pedido da Shopify (pode ser null)
 *  loja      loja do ticket
 *  temFoto   a mensagem trouxe imagem
 *  agora     timestamp
 *
 * Retorna { an, fase, faltando, humano, encerrar, aceite }:
 *  fase      id da fase a ESCREVER agora (null quando não há o que escrever)
 *  faltando  dados que a fase "coleta" deve pedir
 *  humano    motivo para ir à fila humana (string) ou null
 *  encerrar  true quando a mensagem não pede nada (agradecimento)
 *  aceite    { fase, oferta } quando o cliente aceitou algo
 */
/** O cliente disse que recebeu (qualquer idioma do mapa). */
export const RE_RECEBEU = /receb|chegou|arriv|erhalten|angekommen|ricevut|reçu|ontvangen/i
/** "Aguardar 2 dias" = dois dias completos (48 h) contados do envio REAL do e-mail da fase. */
export const AGUARDAR_ENTREGUE_MS = 48 * 3600_000
/**
 * Prazo dos 2 dias do cenário "marcado como entregue": começa no PRIMEIRO envio
 * de nr_entregue_aguardar registrado em historicoEtapas (o horário confirmado do
 * envio). Uma resposta antecipada repete a fase e gera outro registro, mas o
 * relógio continua o mesmo. Sem horário confiável, o motor não avança sozinho.
 */
export function prazoAguardarEntregue(an, agora = Date.now()) {
  const envio = (an?.historicoEtapas ?? []).find(h => h.para === 'nr_entregue_aguardar')
  const desdeMs = envio ? Date.parse(envio.em) : NaN
  if (!Number.isFinite(desdeMs) || desdeMs > agora) return { confiavel: false, desde: null, ate: null, vencido: false }
  const ateMs = desdeMs + AGUARDAR_ENTREGUE_MS
  return { confiavel: true, desde: new Date(desdeMs).toISOString(), ate: new Date(ateMs).toISOString(), vencido: agora >= ateMs }
}

/** O cliente ainda não informou os produtos (regra global do mapa) — fonte única: shared/produto.js. */
export const semProduto = an => !produtoFoiInformado(an)
/**
 * TRAVA GLOBAL DE PRODUTO: nenhuma fase, oferta, aceite, encaminhamento ao dono,
 * reembolso de 100%, cancelamento ou confirmação sai enquanto o cliente não
 * informar os produtos. Sai só a coleta perguntando o produto; a fase pendente
 * fica em proximaAposColeta e é retomada EXATAMENTE quando o produto chegar.
 * Pendências especiais: '__aceite__' (aceite de oferta) e '__humano__' (escalada).
 */
function travaProduto(saida, pendente, extra = {}) {
  const { an } = saida
  Object.assign(an, extra)
  an.aguardandoProduto = true // pendência de produto: nada sai além da coleta até o cliente informar
  an.proximaAposColeta = pendente
  saida.fase = 'coleta'; saida.faltando = ['produtos']; saida.humano = null; saida.aceite = null
  return saida
}
/** Retoma EXATAMENTE a pendência guardada pela trava de produto (fase, aceite ou escalada). */
function retomarPendencia(saida, agora) {
  const { an } = saida
  const alvo = an.proximaAposColeta
  an.aguardandoProduto = false
  an.proximaAposColeta = undefined
  if (alvo === '__aceite__') return concluirAceite(saida, agora)
  if (alvo === '__humano__') { saida.humano = an.humanoPendente || 'Decida você'; an.humanoPendente = undefined; an.aguardando = 'humano'; return saida }
  return irPara(saida, alvo, agora)
}
/** Conclui o aceite de uma oferta (endereço ou decisão do dono) — só com produto informado. */
function concluirAceite(saida, agora) {
  const { an } = saida
  const fase = FASES[an.acaoAceita]
  if (!fase) { saida.humano = 'Aceite sem fase registrada — confira'; return saida }
  if (fase.aoAceitar === 'endereco') return irPara(saida, 'endereco', agora)
  an.aguardando = 'humano'
  saida.aceite = { fase: an.acaoAceita, oferta: fase.oferta }
  saida.humano = `Cliente aceitou "${fase.titulo}" — aprovar e confirmar`
  return saida
}

export function decidir({ an: anAntes, cls, pedido, loja, temFoto = false, agora = Date.now() }) {
  const an = { ...anAntes, produtosAfetados: [...(anAntes.produtosAfetados ?? [])], historicoEtapas: [...(anAntes.historicoEtapas ?? [])] }
  const saida = { an, fase: null, faltando: [], humano: null, encerrar: false, aceite: null }

  // --- dados novos trazidos pela mensagem ---
  if (cls.motivo && !an.motivo) an.motivo = cls.motivo
  if (cls.produtos?.length) {
    for (const p of casarProdutos(cls.produtos, pedido)) { if (!an.produtosAfetados.includes(p)) an.produtosAfetados.push(p); an.produtosInformados = true }
  }
  // NUNCA preencher pelo catálogo do pedido: "O CLIENTE TEM QUE INFORMAR QUAIS PRODUTOS SEMPRE,
  // NÃO PROSSEGUIR SEM ESSA INFO" — vale para pedidos de um item e de vários itens
  if (cls.ajustes?.length) {
    an.ajusteTamanho = { ...(an.ajusteTamanho ?? {}) }
    for (const a of cls.ajustes) if (a?.produto && (a.ajuste === 'pequeno' || a.ajuste === 'grande')) an.ajusteTamanho[a.produto] = a.ajuste
  }
  if (temFoto) an.fotoRecebida = true
  // endereço se acumula entre mensagens; só vira "confirmado" depois de validado
  if (cls.endereco) an.enderecoInformado = [an.enderecoInformado, cls.endereco].filter(Boolean).join('\n')

  // --- pendência de produto (trava ou caso antigo migrado): sem prova, só a coleta; com prova, retoma a pendência exata ---
  if (an.aguardandoProduto && an.proximaAposColeta && pedido) {
    if (semProduto(an)) return travaProduto(saida, an.proximaAposColeta)
    return retomarPendencia(saida, agora)
  }

  // --- confirmação JÁ AUTORIZADA esperando a cadência (automática, ou manual já aprovada pelo dono):
  //     a confirmação antiga NUNCA sai sem analisar a mensagem nova. O agendamento é cancelado, a
  //     mensagem é reclassificada e o mesmo conclusaoPendente.id é preservado nos dois caminhos. ---
  const cp = an.conclusaoPendente
  const autorizada = cp && ['aguardando_cadencia', 'enviando'].includes(cp.status) && (cp.modo === 'automatico' || !!cp.aprovadoEm)
  if (autorizada && pedido) {
    // o cliente voltou atrás: recusa, outro percentual, outra solução → decisão HUMANA (nunca a próxima oferta sozinha)
    if (cls.intencao === 'recusa' || cls.intencao === 'pede_reembolso' || cls.intencao === 'pede_cancelamento' || cls.intencao === 'pede_troca') {
      cp.status = 'cancelada'; cp.canceladaEm = new Date(agora).toISOString(); cp.motivoCancelamento = 'cliente voltou atrás depois do aceite'
      an.aguardando = 'humano'
      saida.cancelarConfirmacao = true
      saida.humano = `Cliente aceitou "${FASES[cp.faseAceita]?.titulo ?? cp.faseAceita}" e depois voltou atrás — decida você (a confirmação ${cp.modo === 'automatico' ? 'automática' : 'aprovada'} foi cancelada; a próxima oferta NÃO é automática)`
      return saida
    }
    // agradece, reafirma o aceite, informa dado complementar ou pergunta quando sai:
    // mesma solução, confirmação regerada e revalidada, 5 h reiniciadas a partir desta mensagem.
    // No manual já aprovado, a autorização do dono é preservada — nenhuma segunda aprovação.
    saida.fase = faseDeConfirmacao(cp.faseAceita)
    saida.reconfirmar = true
    return saida
  }

  // --- já está com o dono: não mexe (mas sem produto informado, nem o dono decide: pede o produto antes) ---
  if (an.aguardando === 'humano') {
    if (semProduto(an) && pedido) {
      const pendente = an.aguardandoComprovacao ? '__humano__' : an.acaoAceita ? (FASES_HUMANAS.has(an.acaoAceita) ? an.acaoAceita : '__aceite__') : '__humano__'
      return travaProduto(saida, pendente, { aguardando: 'cliente', humanoPendente: an.humanoPendente || 'Caso estava com você — decida' })
    }
    saida.humano = 'Caso já está com você — o cliente escreveu de novo'; return saida
  }

  // --- agradecimento puro: encerra ---
  if (cls.intencao === 'agradece') { saida.encerrar = true; return saida }

  // --- aguardando endereço (aceite de troca/reenvio) — sem produto informado, o endereço espera ---
  if (an.etapa === 'endereco') {
    if (semProduto(an) && pedido) return travaProduto(saida, 'endereco')
    const v = validarEndereco(an.enderecoInformado)
    if (v.ok) {
      an.enderecoConfirmado = v.normalizado
      an.aguardando = 'humano'
      saida.aceite = { fase: an.acaoAceita, oferta: FASES[an.acaoAceita]?.oferta ?? null }
      saida.humano = `Cliente aceitou "${FASES[an.acaoAceita]?.titulo ?? an.acaoAceita}" e confirmou o endereço — aprovar e despachar`
      return saida
    }
    // incompleto: pede só o que falta, e não encaminha o aceite ainda
    saida.fase = 'endereco'; saida.faltando = v.faltando; return saida
  }

  // --- triagem: primeira vez (ou ainda esperando o número do pedido) ---
  if (!an.etapa || (an.etapa === 'coleta' && !an.fluxo)) {
    // sem pedido localizado não há valor, itens nem prazo: pede o número primeiro
    if (!pedido) { saida.fase = 'coleta'; saida.faltando = ['pedido']; an.proximaAposColeta = null; return saida }
    const fluxo = escolherFluxo(cls, pedido, loja, agora)
    if (!fluxo) {
      if (semProduto(an)) return travaProduto(saida, '__humano__', { humanoPendente: 'Fora do mapa do atendimento novo — responda você' })
      saida.humano = 'Fora do mapa do atendimento novo — responda você'; return saida
    }
    an.fluxo = fluxo
    // cenário do mapa dentro de "não recebido" (o mapa visual separa os caminhos)
    an.subfluxo = fluxo === 'nao_recebido_status' ? (cls.intencao === 'pergunta_status' ? 'status' : 'cancelamento')
      : fluxo === 'nao_recebido_reembolso' ? ((cls.situacaoEntrega === 'voltou_remetente' || cls.situacaoEntrega === 'recusou_na_porta') ? 'recusado' : 'nao_chegou')
        : fluxo === 'entregue_nao_recebido' ? 'entregue' : null
    let alvo = faseInicialDoFluxo(fluxo)
    if (fluxo === 'nao_recebido_status') alvo = prazoDoPedido(pedido, loja, agora).vencido ? 'nc_atrasado_25' : 'nc_no_prazo'
    return irPara(saida, alvo, agora)
  }

  const atual = FASES[an.etapa]

  // --- já confirmado ao cliente: o caso está encerrado; quem responde é o dono ---
  if (atual?.confirmacao) { saida.humano = 'Caso já confirmado ao cliente — ele escreveu de novo; responda você'; return saida }

  // --- fase de coleta: o cliente respondeu o que faltava? ---
  if (an.etapa === 'coleta' || an.etapa === 'tam_ajuste' || an.etapa === 'def_foto') {
    const alvo = an.proximaAposColeta ?? faseInicialDoFluxo(an.fluxo)
    // retoma EXATAMENTE o que ficou pendente na trava de produto (sem repetir, adiantar ou pular)
    if (alvo === '__aceite__') { if (semProduto(an)) return travaProduto(saida, '__aceite__'); an.proximaAposColeta = undefined; return concluirAceite(saida, agora) }
    if (alvo === '__humano__') { if (semProduto(an)) return travaProduto(saida, '__humano__'); an.proximaAposColeta = undefined; saida.humano = an.humanoPendente || 'Decida você'; an.humanoPendente = undefined; return saida }
    return irPara(saida, alvo, agora)
  }

  // --- dentro do prazo: o prazo venceu? o cliente insiste? ---
  if (an.etapa === 'nc_no_prazo') {
    const prazo = prazoDoPedido(pedido, loja, agora)
    return irPara(saida, prazo.vencido ? 'nc_atrasado_25' : 'nc_no_prazo', agora)
  }
  if (an.etapa === 'nr_entregue_aguardar') {
    // recebeu: encerra a qualquer momento
    if (cls.intencao === 'informa' && RE_RECEBEU.test(cls.resumo ?? '')) { saida.encerrar = true; return saida }
    // os 2 dias (48 h) contam do envio REAL do e-mail desta fase; a resposta antecipada
    // repete a fase ("o período ainda não terminou") e NÃO reinicia o relógio
    const pz = prazoAguardarEntregue(an, agora)
    if (!pz.confiavel) {
      const msg = 'Sem horário confiável do envio de "aguardar 2 dias" — o motor não avança sozinho; decida você'
      if (semProduto(an)) return travaProduto(saida, '__humano__', { humanoPendente: msg })
      saida.humano = msg; return saida
    }
    an.aguardarEntregue = { desde: pz.desde, ate: pz.ate }
    if (!pz.vencido) return irPara(saida, 'nr_entregue_aguardar', agora)
    // única saída após os 2 dias: reenvio + 20% (nenhuma mensagem leva direto ao 35%)
    return irPara(saida, 'nr_reenvio_20', agora)
  }

  // --- resposta a uma oferta ---
  if (cls.intencao === 'aceita') {
    if (!atual?.aoAceitar) {
      const msg = 'Cliente concordou, mas esta fase não tem oferta — confira'
      if (semProduto(an)) return travaProduto(saida, '__humano__', { humanoPendente: msg })
      saida.humano = msg; return saida
    }
    an.acaoAceita = an.etapa
    // aceite sem produto informado: pede o produto antes e retoma o aceite depois (nada vai ao dono)
    if (semProduto(an)) return travaProduto(saida, '__aceite__')
    return concluirAceite(saida, agora)
  }
  if (cls.intencao === 'recusa' || cls.intencao === 'pede_reembolso' || cls.intencao === 'pede_cancelamento') {
    if (!atual?.aoRecusar) {
      const msg = `Cliente recusou "${atual?.titulo ?? an.etapa}" e não há próxima etapa — decida você`
      if (semProduto(an)) return travaProduto(saida, '__humano__', { humanoPendente: msg })
      saida.humano = msg; return saida
    }
    return irPara(saida, atual.aoRecusar, agora)
  }
  if (cls.intencao === 'informa' || cls.intencao === 'pergunta_status') {
    // informou algo sem aceitar nem recusar: repete a MESMA fase (não avança)
    return irPara(saida, an.etapa, agora)
  }
  if (semProduto(an)) return travaProduto(saida, '__humano__', { humanoPendente: 'Não deu para entender se o cliente aceitou ou recusou — responda você' })
  saida.humano = 'Não deu para entender se o cliente aceitou ou recusou — responda você'
  return saida
}

/** Aponta a fase a escrever, respeitando dados faltantes, foto e cupons. */
function irPara(saida, alvo, agora) {
  const { an } = saida
  if (!alvo) { saida.humano = 'Sem próxima etapa definida'; return saida }
  // TRAVA GLOBAL: antes de fase, oferta, endereço, 100% ou cancelamento — sem produto, só a coleta
  if (semProduto(an) && alvo !== 'coleta') return travaProduto(saida, alvo)
  if (FASES_HUMANAS.has(alvo)) {
    an.aguardando = 'humano'
    an.acaoAceita = alvo // ação pendente da decisão do dono (a confirmação parte dela)
    saida.humano = alvo === 'reemb_100'
      ? 'Cliente recusou todas as alternativas — reembolso de 100% é decisão sua'
      : 'Cancelamento de pedido não processado — decisão sua'
    saida.aceite = { fase: alvo, oferta: FASES[alvo].oferta }
    return saida
  }
  if (alvo === 'endereco') {
    // o cliente pode ter mandado o endereço antes de aceitar: se já está completo, não pergunta de novo
    const v = validarEndereco(an.enderecoInformado)
    if (v.ok) {
      an.enderecoConfirmado = v.normalizado
      an.aguardando = 'humano'
      saida.aceite = { fase: an.acaoAceita, oferta: FASES[an.acaoAceita]?.oferta ?? null }
      saida.humano = `Cliente aceitou "${FASES[an.acaoAceita]?.titulo ?? an.acaoAceita}" e o endereço está completo — aprovar e despachar`
      return saida
    }
    saida.fase = 'endereco'
    saida.faltando = an.enderecoInformado ? v.faltando : [] // sem nada informado, pede o endereço inteiro
    return saida
  }
  const faltando = faltaPara(alvo, an)
  if (faltando.length) {
    if (faltando.includes('foto')) {
      an.proximaAposColeta = alvo
      if (!an.fotoRecebida) { an.fotoSolicitada = true; saida.fase = 'def_foto'; return saida }
      // imagem chegou, mas imagem não é prova: quem confirma que ela mostra o defeito é o lojista
      an.aguardando = 'humano'
      an.aguardandoComprovacao = true
      saida.humano = 'Imagem recebida — confirme na conversa se ela comprova o defeito antes de a troca ser oferecida'
      return saida
    }
    if (faltando.includes('ajuste') && !faltando.includes('produtos')) { saida.fase = 'tam_ajuste'; an.proximaAposColeta = alvo; return saida }
    saida.fase = 'coleta'; saida.faltando = faltando; an.proximaAposColeta = alvo; return saida
  }
  an.proximaAposColeta = undefined
  saida.fase = alvo
  return saida
}

/** Registra a transição depois de o e-mail sair com sucesso. */
export function confirmarTransicao(an, { para, mensagem, observacao = null, agora = Date.now() }) {
  const fase = FASES[para]
  an.historicoEtapas.push({
    de: an.etapa, para, mensagem: String(mensagem || '').slice(0, 200), em: new Date(agora).toISOString(),
    ...(observacao ? { observacao: String(observacao).slice(0, 300) } : {}),
  })
  an.etapa = para
  // fases sem oferta (coleta, endereço) não apagam a oferta que está em jogo
  if (fase?.oferta) { an.ofertaAtual = fase.oferta; an.ofertaEnviadaEm = new Date(agora).toISOString() }
  // confirmação enviada: o caso fecha; qualquer mensagem nova vai ao dono
  an.aguardando = fase?.confirmacao ? null : 'cliente'
  an.transicaoPendente = null
  return an
}

/* ------------------------------------------------------------------ */
/* Bloqueios contra salto de etapa (11)                                */
/* ------------------------------------------------------------------ */

/** Oferta que rege uma fase: a própria, ou — numa confirmação — a opção aceita. */
export function ofertaDaFase(faseId, an = null) {
  const fase = FASES[faseId]
  if (!fase) return null
  return fase.confirmacao ? (FASES[an?.acaoAceita]?.oferta ?? null) : fase.oferta
}

const PCT_RE = /(\d{1,3})\s?%/g

/**
 * Confere o resultado da IA contra a fase permitida: ação proposta, percentuais
 * e cupons citados no texto. Retorna { ok, motivo }.
 */
export function validarProposta(faseId, resultado, loja, an = null) {
  const fase = FASES[faseId]
  if (!fase) return { ok: false, motivo: `fase desconhecida (${faseId})` }
  if (resultado.acao_proposta && resultado.acao_proposta !== faseId) {
    return { ok: false, motivo: `a IA propôs "${resultado.acao_proposta}" mas a etapa permitida era "${faseId}"` }
  }
  const texto = String(resultado.resposta || '')
  // confirmação: os números permitidos são os da opção que o cliente aceitou
  const oferta = ofertaDaFase(faseId, an)
  const permitidos = new Set()
  if (oferta?.pct) permitidos.add(oferta.pct)
  if (oferta?.cupom) permitidos.add(oferta.cupom)
  // o frete de devolução da fase de 50% NÃO pode ser citado em percentual — só em dinheiro (mapa 5.9)
  for (const m of texto.matchAll(PCT_RE)) {
    const n = Number(m[1])
    if (!permitidos.has(n)) return { ok: false, motivo: `o texto cita ${n}%, que não pertence à etapa "${fase.titulo}"` }
  }
  // cupom: só o código da fase pode aparecer
  const codigos = Object.entries(loja?.cupons ?? {})
  for (const [pct, codigo] of codigos) {
    if (codigo && texto.includes(codigo) && Number(pct) !== oferta?.cupom) {
      return { ok: false, motivo: `o texto cita o cupom de ${pct}% (${codigo}), que não pertence à etapa "${fase.titulo}"` }
    }
  }
  return { ok: true, motivo: null }
}

/** Código do cupom exigido pela fase, ou null se a loja não cadastrou. */
/**
 * A fase pode REVELAR o código do cupom? Só a confirmação, depois de o cliente
 * aceitar e o lojista aprovar. Durante a negociação a IA fala do cupom e do
 * percentual, nunca do código: código entregue cedo é benefício entregue sem
 * aceite.
 */
export const faseRevelaCupom = faseId => FASES[faseId]?.confirmacao === true

/** Palavras aceitas para nomear cada ação (as mesmas que o validador exige). */
const EXEMPLOS_ACAO = {
  troca: 'troca / Umtausch / Tausch / Austausch / Ersatz / exchange / échange / cambio / ruil',
  reenvio: 'reenvio / erneut senden / Ersatzlieferung / resend / renvoi / reenvío / opnieuw verzenden',
  reembolso: 'reembolso / Rückerstattung / Erstattung / refund / remboursement / rimborso / terugbetaling',
  cupom: 'cupom / Gutschein / Rabattcode / coupon / code promo / kortingscode',
  cancelamento: 'cancelamento / Stornierung / cancellation / annulation',
}

export function cupomDaFase(faseId, loja, an = null) {
  const pct = ofertaDaFase(faseId, an)?.cupom
  if (!pct) return { precisa: false, codigo: null }
  const codigo = loja?.cupons?.[String(pct)] || null
  return { precisa: true, pct, codigo }
}

/* ------------------------------------------------------------------ */
/* Prompts do modo novo                                                */
/* ------------------------------------------------------------------ */

export const NOMES_IDIOMA = { pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', nl: 'holandês', pl: 'polonês', sv: 'sueco', da: 'dinamarquês', no: 'norueguês', fi: 'finlandês', cs: 'tcheco', hu: 'húngaro', ro: 'romeno', el: 'grego', tr: 'turco' }

/* ------------------------------------------------------------------ */
/* Idioma da conversa                                                  */
/* ------------------------------------------------------------------ */

/** Idiomas que o validador local sabe ler (palavras de ação, oferta, negação). */
export const IDIOMAS_VALIDADOS = new Set(['de', 'nl', 'fr', 'it', 'es', 'en', 'pt'])

/** "nl-BE" → "nl", "de_AT" → "de", "PT-br" → "pt"; null se não for um código. */
export function normalizarIdioma(cod) {
  const base = String(cod || '').trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(base) ? base : null
}

const RE_CURTA = /^\s*(ok(?:ay|é|ey)?|sim|ja|yes|yep|oui|s[ií]|nee|nein|no|non|n[aã]o|nope|danke|thanks?|merci|gracias|grazie|obrigad[oa]|bedankt|dank|bitte|please|top|super|perfekt|perfeito|perfect|genau|certo|d'accord|akkoord|prima|klar|fine|good|gut)[\s.!,]*$/i
const soDados = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// intenções que, por si, mostram uma solicitação linguística (mesmo curta)
const INTENCOES_LINGUISTICAS = new Set(['pede_troca', 'pede_reembolso', 'pede_cancelamento', 'aceita', 'recusa', 'pergunta_status'])
// cortesias e confirmações neutras: não carregam idioma "de verdade"
const NEUTRAS = new Set('ok okay oke okey sim ja yes yep oui si sì nee nein no non nao não nope danke dank thanks thank thx merci gracias grazie obrigado obrigada bedankt bitte please top super perfekt perfeito perfect genau certo prima klar fine good gut hallo hello hi hola olá ola bonjour ciao dag mfg lg vg grüße gruesse gruss groeten cordialement saludos cumprimentos atenciosamente regards thanks'.split(' '))
const RE_TAMANHO = /^(xs|s|m|l|xl|xxl|xxxl|\d{2,3})$/
let _reLinguistica = null
// palavras de ação, aceite/recusa, ajuste de tamanho e pedido explícito, em de/nl/fr/it/es/en/pt
const reLinguistica = () => (_reLinguistica ??= new RegExp([
  RE_ACAO.troca.source, RE_ACAO.reenvio.source, RE_ACAO.reembolso.source, RE_ACAO.cupom.source, RE_ACAO.cancelamento.source,
  '(aceit|accept|akzept|einverstanden|accord|akkoord|va bene|recus|refus|lehne|ablehn|weiger|rifiut|rechaz|annehm)',
  RE_PALAVRAS.pequeno.source, RE_PALAVRAS.grande.source,
  '\\b(quero|queria|gostaria|wil|wilt|want|would like|m[öo]chte|veux|voudrais|voglio|vorrei|quiero|quisiera|por favor|alstublieft|graag|s il vous plait|wo ist|where is|waar is|où est|dove è|dónde está|onde está)\\b',
].join('|'), 'i'))
const remover = (texto, parte) => (parte ? texto.replace(parte, ' ') : texto)

/**
 * A mensagem é só um DADO pedido (endereço, número do pedido/CEP/rastreio, nome
 * de produto, tamanho, foto, cortesia curta) e não uma solicitação? Decidido
 * pelo SERVIDOR com o significado classificado: intenção, ajustes, motivo e
 * palavras de ação contam; contagem de palavras sozinha não decide.
 */
export function mensagemEhDados(cls, corpo) {
  const texto = String(corpo || '').replace(/https?:\/\/\S+/g, ' ')
  const c = soDados(texto)
  if (!c) return true // vazio ou só a foto
  if (RE_CURTA.test(texto)) return true // "ok", "danke", "bedankt"…
  // desconta o que é dado puro: endereço extraído, nomes de produto, números/códigos, tamanhos, cortesias
  let resto = remover(c, soDados(cls?.endereco))
  for (const p of (cls?.produtos ?? []).map(soDados).filter(Boolean)) resto = remover(resto, p)
  const tokens = resto.split(/\s+/).filter(w => /^\p{L}{2,}$/u.test(w) && !NEUTRAS.has(w) && !RE_TAMANHO.test(w))
  if (!tokens.length) return true // só endereço / produto / número / tamanho (+ cortesia)
  // sobrou texto: é solicitação se a classificação ou as palavras mostram intenção/ajuste/motivo/pedido
  if (INTENCOES_LINGUISTICAS.has(cls?.intencao)) return false
  if (cls?.ajustes?.length) return false
  if (cls?.motivo && cls.motivo !== 'nao_informado' && cls.motivo !== 'nenhum') return false
  if (reLinguistica().test(resto)) return false
  // resto curto sem sinal linguístico ("Berlin Mitte", "blau") continua sendo dado
  // cara de endereço sem a IA ter extraído (código postal + poucas palavras): ainda é dado
  if (/\b\d{4,5}\b/.test(c) && tokens.length <= 6) return true
  return tokens.length < 3
}

/** A mensagem tem texto o bastante para confiar no idioma detectado? ("ok", endereço, números, só foto: não) */
export function idiomaConfiavel(cls, corpo) {
  if (cls?.idiomaConfiavel === false) return false
  return !mensagemEhDados(cls, corpo)
}

/**
 * Define/atualiza o idioma-alvo da conversa a partir da classificação: só uma
 * mensagem completa troca o idioma; mensagem curta preserva o último confiável.
 * Sem nenhum idioma ainda, usa o detectado (marcado como incerto) — nunca cai
 * em português ou inglês por padrão.
 */
export function definirIdioma(an, cls, corpo) {
  const detectado = normalizarIdioma(cls?.idioma)
  if (!detectado) return an.idioma ?? null
  if (idiomaConfiavel(cls, corpo)) {
    an.idioma = detectado; an.idiomaOriginal = String(cls.idioma).trim(); an.idiomaIncerto = false
  } else if (!an.idioma) {
    an.idioma = detectado; an.idiomaOriginal = String(cls.idioma).trim(); an.idiomaIncerto = true
  }
  return an.idioma
}

// palavras funcionais distintivas por idioma (detecção local, sem rede)
const PISTAS_IDIOMA = {
  de: 'der die das und nicht ist sie ihre ihnen wir mit für bitte vielen dank bestellung gerne können werden wird haben sehr geehrte hallo grüße zu auf bei wenn ihr ihrer uns dass noch ein eine einen einem einer dem den des vom zum zur wurde tage tagen wieder zurück nach möchten',
  nl: 'de het een en niet is wij we uw u met voor graag alstublieft bedankt bestelling kunnen zullen dat van wordt hebben beste groeten naar bij als ook dit nog binnen op aan te ik mijn wel zijn heeft moet kan wilt dagen',
  fr: 'le la les et pas est vous votre nous avec pour merci commande bonjour cordialement dans une des un sera avons si ne que à sous au vos du aux ce cette sont ont été jours',
  it: 'il lo gli le e non è lei suo sua noi con per grazie ordine buongiorno cordiali saluti che una del della sarà abbiamo entro di dei delle nel al sono hanno giorni',
  es: 'el los las y no es usted su nosotros con para gracias pedido hola saludos que una del será hemos si le en al lo se han fue ya por días',
  en: 'the and not is you your we with for thank thanks order hello regards please will have if can would of to within it this that are was our at by from days',
  pt: 'o os as e não é você seu sua nós com para obrigado obrigada pedido olá atenciosamente que uma do da será temos se em um dos das no na ao à foi já dias',
}
const CONJUNTOS_IDIOMA = Object.fromEntries(Object.entries(PISTAS_IDIOMA).map(([k, v]) => [k, new Set(v.split(' '))]))

/** Detecção local por palavras funcionais. Devolve { idioma, pontos, pontosPorIdioma }. */
export function detectarIdioma(texto) {
  const tokens = String(texto || '').toLowerCase().replace(/[^\p{L}\s'’]/gu, ' ').split(/\s+/).filter(Boolean)
  const pontos = {}
  for (const [id, set] of Object.entries(CONJUNTOS_IDIOMA)) pontos[id] = tokens.filter(t => set.has(t)).length
  const melhor = Object.entries(pontos).sort((a, b) => b[1] - a[1])[0]
  return { idioma: melhor && melhor[1] > 0 ? melhor[0] : null, pontos: melhor?.[1] ?? 0, pontosPorIdioma: pontos }
}

/**
 * Prova do idioma antes do envio: (1) o código que o escritor declarou no JSON
 * tem de ser o alvo; (2) a detecção local não pode apontar com força outro
 * idioma validável. Sem alvo, nada a conferir.
 */
export function conferirIdioma(texto, alvo, declarado = null) {
  if (!alvo) return { ok: true, motivo: null }
  const decl = normalizarIdioma(declarado)
  if (decl && decl !== alvo) return { ok: false, motivo: `o escritor declarou "${decl}" (${NOMES_IDIOMA[decl] ?? decl}) e o alvo é "${alvo}" (${NOMES_IDIOMA[alvo] ?? alvo})` }
  const d = detectarIdioma(texto)
  const doAlvo = d.pontosPorIdioma[alvo] ?? 0
  if (d.idioma && d.idioma !== alvo && d.pontos >= 4 && d.pontos >= 2 * doAlvo) {
    return { ok: false, motivo: `o texto parece estar em ${NOMES_IDIOMA[d.idioma] ?? d.idioma} ("${d.idioma}"), e o alvo é "${alvo}" (${NOMES_IDIOMA[alvo] ?? alvo})` }
  }
  return { ok: true, motivo: null }
}
const SIMBOLOS = { EUR: '€', BRL: 'R$', USD: 'US$', GBP: '£' }
const dinheiro = (v, moeda) => `${Number(v || 0).toFixed(2).replace('.', ',')} ${SIMBOLOS[moeda] ?? moeda ?? ''}`.trim()

const nomeFase = id => FASES[id]?.titulo ?? id

/** Texto do pedido para a IA: itens, valor pago, status e prazo. */
function blocoPedido(pedido, loja, agora) {
  if (!pedido) return 'Nenhum pedido localizado para este cliente.'
  const prazo = prazoDoPedido(pedido, loja, agora)
  const itens = (pedido.itens ?? []).map(i => `- ${i.quantidade}x ${i.titulo}${i.variante ? ` (${i.variante})` : ''}`).join('\n') || '- (itens não sincronizados)'
  const status = { aguardando: 'ainda não despachado', transito: 'em trânsito', entregue: 'marcado como entregue', problema: 'com problema/cancelado' }[pedido.status] ?? pedido.status
  return [
    `Pedido ${pedido.numero} — VALOR TOTAL PAGO: ${dinheiro(pedido.valor, loja?.moeda)} — status: ${status}${pedido.rastreio && pedido.rastreio !== '—' ? ` — rastreio ${pedido.rastreio}` : ''}`,
    `Itens:\n${itens}`,
    `Prazo de entrega: ${prazo.diasUteis} a partir de ${prazo.inicio}; data provável ${prazo.provavel}; limite ${prazo.limite}${prazo.vencido ? ' (PRAZO VENCIDO)' : ' (dentro do prazo)'}.`,
  ].join('\n')
}

/**
 * Prompt da 1ª chamada: só CLASSIFICAR o que o cliente disse. A IA não escreve
 * resposta aqui e não vê a escada — só o que foi oferecido por último.
 */
/* ------------------------------------------------------------------ */
/* Base de Conhecimento: EXCLUSIVA do atendimento clássico              */
/* ------------------------------------------------------------------ */

/** Campos do estado que formam a Base de Conhecimento (políticas, FAQs, comportamentos, biblioteca, sugestões, aprendizado de estilo). */
export const CAMPOS_BASE_CONHECIMENTO = ['politicas', 'faqs', 'comportamentos', 'biblioteca', 'sugestoes', 'politicasSugeridas', 'estiloExemplos']
/** A única parte da configuração que o motor novo pode ver: nome e assinatura da loja. */
export const configDoNovo = config => ({ nomeLoja: config?.nomeLoja ?? null, assinatura: config?.assinatura ?? null })
/** Trava: nenhum objeto entregue aos prompts do motor novo pode carregar a Base de Conhecimento nem o estado completo. */
export function assertSemBaseDeConhecimento(obj, nome) {
  if (!obj || typeof obj !== 'object') return
  for (const campo of CAMPOS_BASE_CONHECIMENTO) if (campo in obj) throw new Error(`motor novo: "${nome}" trouxe a Base de Conhecimento (${campo}) — ela é exclusiva do atendimento clássico`)
  if ('tickets' in obj && 'config' in obj) throw new Error(`motor novo: "${nome}" é o estado completo — o motor de etapas só recebe fase, conversa, pedido, loja e assinatura`)
}

export function promptClassificar({ loja, an, pedido, ticket, agora = Date.now() }) {
  for (const [n, o] of [['loja', loja], ['an', an], ['pedido', pedido], ['ticket', ticket]]) assertSemBaseDeConhecimento(o, n)
  const ultimaDaLoja = [...(ticket.historico ?? [])].reverse().find(m => m.autor === 'atendo')?.corpo ?? ticket.resposta ?? null
  const system = [
    `Você classifica mensagens de clientes de uma loja de roupas online. Você NÃO responde ao cliente: só extrai dados no JSON pedido.`,
    ``,
    `Situação atual da conversa:`,
    an.etapa ? `- Última ação da loja: "${nomeFase(an.etapa)}"${an.ofertaAtual ? ` (oferta em aberto: ${descreverOferta(an.ofertaAtual)})` : ''}.` : `- Primeira mensagem: ainda não há ação da loja.`,
    an.motivo ? `- Motivo já conhecido: ${an.motivo}.` : `- Motivo ainda desconhecido.`,
    an.produtosAfetados.length ? `- Produtos já identificados: ${an.produtosAfetados.join('; ')}.` : `- Produtos envolvidos ainda não identificados.`,
    ``,
    blocoPedido(pedido, loja, agora),
    ``,
    `REGRA DE LEITURA: só a MENSAGEM NOVA do cliente conta como fala dele. O assunto do e-mail, a notificação automática da loja e qualquer texto citado abaixo da resposta são referência — nunca declaração. Um cliente que responde ao aviso "sua entrega foi entregue" reclamando da roupa NÃO está dizendo que não recebeu: ele está com a peça na mão.`,
    ``,
    `Como classificar "intencao":`,
    `- aceita: o cliente concorda com a oferta em aberto (ex.: "ok", "aceito", "pode ser", "quero a troca", "manda o cupom").`,
    `- recusa: rejeita a oferta em aberto sem exigir outra coisa específica.`,
    `- pede_reembolso: rejeita e quer o dinheiro de volta (inclui "quero 100%", "só aceito reembolso").`,
    `- pede_cancelamento: quer cancelar o pedido.`,
    `- pede_troca: quer trocar/devolver o produto (primeira mensagem, sem exigir reembolso).`,
    `- informa: só traz dados pedidos (produto, tamanho, foto, endereço) ou responde a uma pergunta da loja.`,
    `- pergunta_status: só quer saber onde está o pedido / quando chega.`,
    `- agradece: agradece ou confirma que está tudo certo, sem pedir nada.`,
    `- outro: não se encaixa (dúvida de produto antes de comprar, nota fiscal, etc.).`,
    ``,
    `"motivo": o motivo que o CLIENTE alegou — tamanho, qualidade, nao_gostou, defeito, errado, nao_recebido, nao_informado (quando pede reembolso/devolução sem dizer por quê) ou nenhum. Nunca invente.`,
    `"produtos": os itens do pedido que o cliente citou, com o nome como aparece na lista acima (lista vazia se não citou).`,
    `"ajustes": para cada produto que o cliente disse que ficou pequeno ou grande.`,
    `"situacaoEntrega": nao_chegou, entregue_nao_recebido (consta entregue mas ele não recebeu), voltou_remetente, recusou_na_porta, ou nenhuma. Só preencha quando a MENSAGEM NOVA perguntar onde está / quando chega / quantos dias faltam, ou disser explicitamente que não recebeu. Status da Shopify, assunto do e-mail e texto citado NÃO valem.`,
    `"evidenciaEntrega": o trecho LITERAL da mensagem nova que justifica a situacaoEntrega, copiado exatamente como está lá. String vazia quando for "nenhuma". O servidor confere se esse trecho existe mesmo na mensagem nova — trecho inventado faz a situação ser descartada.`,
    `"endereco": o endereço de entrega completo, se o cliente escreveu um; senão string vazia.`,
    `"resumo": uma frase em português do que o cliente disse.`,
    `"idioma": código ISO 639-1 do idioma em que ESTA mensagem foi escrita, com região quando reconhecível (de, de-AT, nl, nl-BE, fr-BE, en, pt…). Não deduza pelo país: um cliente da Áustria pode escrever em inglês e um da Bélgica em holandês, francês ou alemão.`,
    `"idiomaConfiavel": false quando a mensagem é curta demais para saber o idioma com segurança ("ok", "sim", só um endereço, números, só uma foto).`,
    `"spam": true só se não for cliente falando da própria compra.`,
  ].join('\n')
  // O classificador recebe SOMENTE o texto novo do cliente. Nada de texto citado
  // nem de assunto automático: enquanto estiverem no prompt, contaminam intenção,
  // aceite, recusa, motivo, endereço, produto, tamanho e entrega — rotular como
  // "referência" não impede isso. O contexto do pedido já vem estruturado e
  // conferido pelo servidor no bloco de dados do system.
  const partes = separarTexto(ticket.corpo)
  const user = [
    ultimaDaLoja ? `Última mensagem da loja:\n${String(ultimaDaLoja).slice(0, 1500)}\n\n---\n` : '',
    `MENSAGEM NOVA do cliente (${ticket.nome} <${ticket.de}>) — é só isto que ele escreveu agora:`,
    partes.atual.slice(0, 4000) || '(sem texto novo)',
    ticket.anexos?.length ? `\n(O cliente anexou ${ticket.anexos.length} imagem(ns).)` : '',
  ].join('\n')
  return { system, user }
}

function descreverOferta(o) {
  if (!o) return ''
  const partes = []
  if (o.tipo === 'troca') partes.push('troca gratuita')
  if (o.tipo === 'troca_reembolso') partes.push(`troca gratuita + reembolso de ${o.pct}%`)
  if (o.tipo === 'reenvio') partes.push('reenvio expresso')
  if (o.tipo === 'reenvio_reembolso') partes.push(`reenvio expresso + reembolso de ${o.pct}%`)
  if (o.tipo === 'reembolso') partes.push(`reembolso de ${o.pct}%`)
  if (o.tipo === 'cupom') partes.push(`cupom de ${o.cupom}%`)
  if (o.tipo === 'cancelamento') partes.push('cancelamento do pedido')
  if (o.cupom && o.tipo !== 'cupom') partes.push(`cupom de ${o.cupom}%`)
  if (o.semDevolucao) partes.push('sem devolução')
  return partes.join(', ')
}

/**
 * Prompt da 2ª chamada: ESCREVER a resposta de UMA fase, e só dela. A IA
 * recebe a instrução da fase, os valores já calculados e o código do cupom —
 * nunca a escada inteira.
 */
export function promptEscrever({ loja, config: configBruta, faseId, faltando = [], an, pedido, ticket, instrucaoEstilo = null, idiomaAlvo = null, instrucaoIdioma = null, agora = Date.now() }) {
  for (const [n, o] of [['loja', loja], ['config', configBruta], ['an', an], ['pedido', pedido], ['ticket', ticket]]) assertSemBaseDeConhecimento(o, n)
  const config = configDoNovo(configBruta) // só nome e assinatura da loja — políticas, FAQs e comportamentos nunca entram aqui
  const fase = FASES[faseId]
  const moeda = loja?.moeda ?? 'EUR'
  // no modo novo a resposta segue SEMPRE o idioma do cliente — a configuração fixa da loja não entra aqui
  const alvo = normalizarIdioma(idiomaAlvo)
  const linhaIdioma = alvo
    ? `Escreva a resposta OBRIGATORIAMENTE em ${NOMES_IDIOMA[alvo] ?? alvo} (código "${alvo}") — o idioma da última mensagem completa do cliente. Ignore o idioma da loja, do histórico ou destas instruções.`
    : 'Escreva a resposta no idioma em que o cliente escreveu a última mensagem completa — nunca em português ou inglês "por padrão".'
  const valor = Number(pedido?.valor || 0)
  const conf = !!fase.confirmacao
  const aceita = conf ? FASES[an.acaoAceita] : null
  const oferta = conf ? (aceita?.oferta ?? null) : fase.oferta
  const dados = []
  if (conf) dados.push(`Opção aceita pelo cliente e aprovada pelo lojista: ${aceita?.titulo ?? an.acaoAceita} (${descreverOferta(oferta)}).`)
  if (oferta?.pct && (conf || oferta.pct < 100)) dados.push(`Reembolso de ${oferta.pct}% = ${dinheiro(valor * oferta.pct / 100, moeda)} (sobre ${dinheiro(valor, moeda)} pagos).`)
  if (faseId === 'reemb_50') dados.push(`Frete de devolução estimado: ${dinheiro(valor * 0.25, moeda)} — informe só este valor em dinheiro; não diga a porcentagem que ele representa.`)
  const cupom = cupomDaFase(faseId, loja, an)
  if (cupom.precisa) {
    // o CÓDIGO só é entregue ao escritor na confirmação. Na negociação ele nem
    // chega ao prompt: o que a IA não recebe, ela não pode revelar cedo demais.
    dados.push(conf
      ? `Cupom de ${cupom.pct}%: código ${cupom.codigo}. Use EXATAMENTE este código.`
      : `Cupom de ${cupom.pct}%: diga que o cliente receberá um cupom de ${cupom.pct}%. NÃO escreva nenhum código de cupom — o código só é entregue na confirmação, depois de o cliente aceitar.`)
  }
  if (oferta?.prazo) dados.push(`Prazo do envio expresso: ${oferta.prazo}.`)
  if (conf && /troca|reenvio/.test(oferta?.tipo ?? '')) {
    if (!oferta?.prazo) dados.push(`Prazo do envio expresso: 4 a 11 dias.`)
    if (an.enderecoConfirmado) dados.push(`Endereço de entrega confirmado: ${an.enderecoConfirmado}.`)
  }
  if (conf && (oferta?.pct || oferta?.tipo === 'cancelamento')) dados.push(`Prazo para o dinheiro voltar ao método de pagamento original: 3 a 14 dias. Se o cliente questionar esse prazo, a loja segue a lei do país.`)
  if (an.produtosAfetados.length) dados.push(`Produtos envolvidos: ${an.produtosAfetados.join('; ')}.`)
  if (an.ajusteTamanho && Object.keys(an.ajusteTamanho).length) dados.push(`Ajuste informado: ${Object.entries(an.ajusteTamanho).map(([p, a]) => `${p} ficou ${a}`).join('; ')}.`)
  if (faltando.length) {
    const nomes = {
      pedido: 'o número do pedido (ou o e-mail usado na compra)', produtos: 'quais produtos do pedido estão envolvidos',
      motivo: 'o motivo da devolução/reembolso', ajuste: 'se ficou pequeno ou grande',
      end_rua: 'rua e número', end_cep: 'código postal (CEP)', end_cidade: 'cidade',
      foto_melhor: 'outra foto, nítida, mostrando o defeito',
    }
    const lista = faltando.map(f => nomes[f] ?? f).join(' e ')
    if (faseId === 'endereco') dados.push(`O cliente já mandou parte do endereço (${String(an.enderecoInformado || '').slice(0, 200)}). Peça SOMENTE o que falta: ${lista}.`)
    else if (faseId === 'def_foto') dados.push(`A imagem que o cliente mandou não serviu como comprovação. Peça ${lista}.`)
    else dados.push(`Informações que faltam: ${lista}.`)
  }
  if (faseId === 'nc_no_prazo' && pedido) {
    const pz = prazoDoPedido(pedido, loja, agora)
    dados.push(`Diga claramente que o pedido está DENTRO do prazo de entrega (${pz.diasUteis}). Data provável de recebimento: ${pz.provavel} — escreva essa data por extenso ou como DD/MM/AAAA. Não ofereça cupom, reembolso, troca nem reenvio.`)
  }
  if (faseId === 'nr_entregue_aguardar') {
    dados.push('Peça que aguarde mais 2 dias e que verifique com vizinhos ou na portaria. Não ofereça nada.')
    if (an?.etapa === 'nr_entregue_aguardar' && an.aguardarEntregue?.ate) dados.push(`O período de 2 dias já está correndo desde o e-mail anterior (${an.aguardarEntregue.desde}) e termina em ${an.aguardarEntregue.ate}: diga que o período ainda não terminou e que a contagem continua a mesma — NÃO reinicie os 2 dias nem prometa nada.`)
  }
  if (faseId === 'nc_atrasado_25') dados.push('Peça que aguarde no máximo mais 5 dias úteis (diga "5 dias úteis").')
  if (conf && an.enderecoConfirmado) dados.push('Repita o endereço de entrega confirmado EXATAMENTE como está acima.')
  if (cupom.precisa) dados.push('Diga que é um CUPOM (Gutschein / coupon / código de desconto), com o código e o percentual.')

  const system = [
    `Você é o atendimento ao cliente da loja "${loja?.nome ?? config?.nomeLoja ?? 'loja'}", um e-commerce de roupas.`,
    `${linhaIdioma} Cordial, direta, humana, sem parecer robô.`,
    ...(instrucaoIdioma ? [`ATENÇÃO: ${instrucaoIdioma}. Reescreva TODA a resposta ${alvo ? `em ${NOMES_IDIOMA[alvo] ?? alvo} ("${alvo}")` : 'no idioma do cliente'}.`] : []),
    ``,
    `Regras invioláveis:`,
    ...(conf ? [
      `- Esta resposta é uma CONFIRMAÇÃO: a opção listada nos dados abaixo já foi aprovada pelo lojista. Confirme-a exatamente como está — e nada mais.`,
      `- Não ofereça, não insinue e não prometa nenhuma outra opção, percentual, cupom ou etapa.`,
      `- Só cite valores, percentuais, prazos e códigos que estejam nos dados abaixo. Nunca invente prazo, valor, política ou código.`,
    ] : [
      `- Você executa SOMENTE a ação abaixo. Não mencione, não insinue e não prometa nenhuma outra opção, percentual, cupom ou etapa — nem "se não aceitar, podemos…".`,
      `- Você NUNCA confirma reembolso, troca, reenvio ou cancelamento como fato consumado. Você OFERECE e PERGUNTA se o cliente aceita; quem confirma depois é o lojista.`,
      `- Só cite valores, percentuais e códigos que estejam nos dados abaixo. Nunca invente prazo, valor, política ou código.`,
      `- Não escreva "aprovado", "confirmado", "já está em andamento", "enviaremos", "o dinheiro chegará".`,
      `- Escreva o percentual, o valor em dinheiro e o prazo EXATAMENTE como estão nos dados abaixo.`,
      ...acoesDaOferta(oferta).map(a => `- OBRIGATÓRIO: a resposta PRECISA conter a palavra que nomeia a ação "${a}" no idioma do cliente. Palavras aceitas: ${EXEMPLOS_ACAO[a]}. Descrever a ação sem nomeá-la faz a resposta ser recusada.`),
      ...(cupomDaFase(faseId, loja, an).precisa ? [`- PROIBIDO escrever qualquer código de cupom nesta resposta. Diga só que haverá um cupom e o percentual; o código vai na confirmação, depois do aceite.`] : []),
    ]),
    ``,
    `AÇÃO DESTA RESPOSTA — ${fase.titulo}:`,
    fase.instrucao,
    ``,
    ...(instrucaoEstilo ? [`Instrução de estilo do lojista (vale só para tom, tamanho e forma — NÃO muda a ação, os valores, os percentuais nem os códigos): ${instrucaoEstilo}`, ``] : []),
    dados.length ? `Dados para usar:\n${dados.map(d => `- ${d}`).join('\n')}` : '',
    ``,
    blocoPedido(pedido, loja, agora),
    ``,
    `Termine com a assinatura abaixo, mantendo as quebras de linha:`,
    loja?.assinatura || config?.assinatura || '',
    ``,
    `No JSON, "acao_proposta" deve ser exatamente "${faseId}" e "idioma" deve ser o código ISO 639-1 do idioma em que você escreveu a resposta${alvo ? ` (esperado: "${alvo}")` : ''}.`,
  ].filter(l => l !== undefined).join('\n')

  const historico = (ticket.historico ?? []).slice(-6).map(m => `${m.autor === 'atendo' ? 'Loja' : 'Cliente'}: ${String(m.corpo).slice(0, 800)}`).join('\n---\n')
  const user = [
    historico ? `Conversa até aqui:\n${historico}\n\n---\n` : '',
    `Mensagem atual do cliente (${ticket.nome}):`,
    String(ticket.corpo || '').slice(0, 3000),
  ].join('\n')
  return { system, user }
}

/* ------------------------------------------------------------------ */
/* Endereço: componentes mínimos antes de encaminhar troca/reenvio     */
/* ------------------------------------------------------------------ */

const escaparRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Confere se um endereço tem rua+número, código postal e cidade. Qualquer
 * texto NÃO é endereço: "ok, pode mandar" falha nos três. Retorna
 * { ok, faltando: ['end_rua'|'end_cep'|'end_cidade'], normalizado }.
 */
export function validarEndereco(texto) {
  // partes por linha/vírgula: o cliente pode mandar "Berlin" numa mensagem e a rua noutra
  const partes = String(texto || '').split(/[\n,;]+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!partes.length) return { ok: false, faltando: ['end_rua', 'end_cep', 'end_cidade'], normalizado: null }
  const t = partes.join(', ')
  const faltando = []
  // CEP europeu (4–5 dígitos, NL com letras) ou britânico
  const cep = t.match(/\b(\d{4,5}(?:\s?[A-Z]{2})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)
  const semCep = cep ? t.replace(cep[0], ' ') : t
  // "Hauptstraße 12" / "Via Roma 5" ou "12 rue de Rivoli"
  const rua = /[A-Za-zÀ-ÿ.'’-]{3,}[^\d\n]{0,25}\b\d{1,4}\s?[a-zA-Z]?\b/.test(semCep)
    || /\b\d{1,4}\s?[a-zA-Z]?\b[,\s]+[A-Za-zÀ-ÿ.'’-]{3,}/.test(semCep)
  // cidade: parte só de palavras começando por maiúscula ("Berlin", "Rio de Janeiro"),
  // ou palavra capitalizada colada ao CEP ("10115 Berlin", "Paris 75001")
  let cidade = partes.some(p => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]{2,}(?: [A-Za-zÀ-ÿ'.-]{2,})*$/.test(p))
  if (!cidade && cep) {
    const c = escaparRe(cep[0])
    cidade = new RegExp(`${c}\\s*,?\\s*[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]{2,}`).test(t) || new RegExp(`[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]{2,}\\s*,?\\s+${c}`).test(t)
  }
  if (!rua) faltando.push('end_rua')
  if (!cep) faltando.push('end_cep')
  if (!cidade) faltando.push('end_cidade')
  return { ok: faltando.length === 0, faltando, normalizado: faltando.length ? null : t }
}

/* ------------------------------------------------------------------ */
/* Conferência do texto final — usada por TODO caminho que envia       */
/* ------------------------------------------------------------------ */

/** O texto pode sair nesta fase? (ação, percentuais, cupons e linguagem de confirmação) */
/* ---- exigências positivas: o texto tem de conter o que a fase manda ---- */

const RE_ACAO = {
  troca: /(troca|trocar|trocamos|umtausch|tausch|austausch|ersatz|exchange|replace|replacement|[ée]change|remplac|cambio|reemplaz|scambio|sostitu|ruil|omruil|vervang)/i,
  reenvio: /(reenvi|resend|re-send|erneut|nochmal|noch einmal|neu(?:e|en|es)?\s+(?:sendung|versand|lieferung|paket)|ersatzlieferung|ersatzsendung|renvo|nouvel envoi|reenv[ií]|rispedi|nuovo invio|opnieuw|nieuwe (?:zending|verzending)|nogmaals (?:verzend|verstu|stur)|ship(?:ping)?\s+(?:it\s+)?again|send(?:ing)?\s+(?:it\s+|you\s+)?again|another (?:package|parcel|shipment)|new (?:shipment|package|parcel))/i,
  reembolso: /(reembols|refund|erstatt|rimbors|rembours|terugbetal|terugstort|geld terug|devolu[çc][aã]o do valor|devoluci[óo]n|money back|geld zur[üu]ck)/i,
  cupom: /(cupom|cup[óo]n|coupon|gutschein|rabattcode|c[óo]digo de desconto|discount code|code promo|codice sconto|kortingscode|kortingsbon|kortingscoupon|tegoedbon|voucher)/i,
  cancelamento: /(cancel|storn|annul)/i,
}
const acaoPrincipal = tipo => /troca/.test(tipo ?? '') ? 'troca' : /reenvio/.test(tipo ?? '') ? 'reenvio' : tipo ?? null
const NOME_ACAO = { troca: 'troca', reenvio: 'reenvio', reembolso: 'reembolso', cupom: 'cupom', cancelamento: 'cancelamento' }

const RE_DINHEIRO = /(?:(€|R\$|US\$|\$|£|EUR|BRL|USD|GBP|CHF)\s?(\d{1,3}(?:[.,'’]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?))|(?:(\d{1,3}(?:[.,'’]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(€|R\$|US\$|\$|£|EUR|BRL|USD|GBP|CHF|euros?)(?![a-z]))/gi

/** Números com moeda citados no texto (17,50 € · €17.50 · EUR 1.500,00 · 1,500.00 USD · CHF 1’234.50). */
export function valoresMonetarios(texto) {
  const out = []
  for (const m of String(texto || '').matchAll(RE_DINHEIRO)) {
    // apóstrofo suíço (1’234.50) é sempre milhar — sai antes da análise
    const bruto = (m[2] ?? m[3] ?? '').trim().replace(/['’]/g, '')
    const seps = bruto.match(/[.,]/g) ?? []
    let n
    if (seps.length === 0) n = Number(bruto)
    else {
      const ultimo = bruto.lastIndexOf(seps[seps.length - 1])
      const depois = bruto.length - ultimo - 1
      const decimal = seps.length > 1 ? seps[seps.length - 1] !== seps[0] || depois !== 3 : depois !== 3
      n = decimal
        ? Number(bruto.slice(0, ultimo).replace(/[.,]/g, '') + '.' + bruto.slice(ultimo + 1))
        : Number(bruto.replace(/[.,]/g, ''))
    }
    if (Number.isFinite(n)) out.push(Math.round(n * 100) / 100)
  }
  return out
}

/** Valores em dinheiro que o servidor calculou para a fase (só esses podem aparecer). */
export function valoresPermitidos(faseId, an, pedido) {
  const valor = Number(pedido?.valor || 0)
  if (!valor) return []
  const oferta = ofertaDaFase(faseId, an)
  const lista = [valor]
  if (oferta?.pct) lista.push(valor * oferta.pct / 100)
  if (faseId === 'reemb_50') lista.push(valor * 0.25)
  return lista.map(v => Math.round(v * 100) / 100)
}

const RE_CUPOM_KW = /(cupom|cup[óo]n|coupon(?:code)?|gutschein(?:code)?|rabattcode|c[óo]digo|codice|code|kortingscode|kortingsbon|tegoedbon|voucher)/gi
/**
 * Códigos de cupom citados no texto: token em MAIÚSCULAS/dígitos, com ao menos
 * uma letra. Hífen e sublinhado fazem PARTE do código — a Shopify gera códigos
 * como "V7KQ-M4XN", e ler só "V7KQ" faria o validador acusar de inventado um
 * código que está cadastrado, travando toda etapa com cupom. O token começa e
 * termina em letra ou dígito, então o hífen de pontuação ("Gutschein - ABC123")
 * continua de fora. Ênfase de Markdown (**CODE**, *CODE*, _CODE_, `CODE`) é
 * descascada: sem isso um código inventado em negrito passaria batido.
 */
export function codigosCitados(texto) {
  const out = new Set()
  const s = String(texto || '')
  for (const m of s.matchAll(RE_CUPOM_KW)) {
    const resto = s.slice(m.index + m[0].length, m.index + m[0].length + 40)
    const tok = resto.match(/^[\s:\-–—"“«'’*_`]*([A-Za-z0-9][A-Za-z0-9_-]{2,22}[A-Za-z0-9])/)?.[1]
    if (tok && /^[A-Z0-9_-]+$/.test(tok) && /[A-Z]/.test(tok)) out.add(tok)
  }
  return [...out]
}

/* ---- exigências das fases SEM oferta: nada do mapa pode ser omitido ---- */

const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const RE_PALAVRAS = {
  pedido: /pedido|encomenda|bestell|bestel|order|commande|ordine|n[úu]mero|nummer|number|num[ée]ro/i,
  produtos: /produto|artikel|product|produit|prodotto|art[ií]culo|\bitem/i,
  motivo: /motivo|grund|reason|raison|ragione|reden|\bwhy\b|warum|waarom|por\s?qu[eê]|pourquoi|perch[ée]/i,
  pequeno: /pequen|klein|small|tight|petit|piccol|\bkrap|\beng\b|apertad/i,
  grande: /grand|gro[ßs]|large|\bbig\b|\bweit|groot|ampi|folgad/i,
  foto: /foto|photo|bild|picture|image|imagem|immagine|afbeelding/i,
  end_rua: /\brua\b|stra(?:ß|ss)e|street|\brue\b|calle|\bvia\b|straat|hausnummer|huisnummer|n[úu]mero|number|nummer/i,
  end_cep: /\bcep\b|postleitzahl|\bplz\b|postal|\bzip\b|postcode|c[óo]digo postal/i,
  end_cidade: /cidade|stadt|\bcity\b|ville|ciudad|citt[àa]|plaats|\bstad\b|\bort\b|localidade/i,
  endereco: /endere[çc]o|adresse|address|indirizzo|direcci[óo]n|\badres\b/i,
  completo: /complet|vollst[äa]ndig|volledig|inteir|enti[er]/i,
  prazo: /prazo|frist|lieferzeit|zeitraum|zeitfenster|delivery (?:time|window|period)|d[ée]lai|plazo|termine|levertijd|levertermijn|binnen de|op tijd|within|innerhalb|dentro d[oe]|on time|p[üu]nktlich|im rahmen/i,
  vizinhos: /vizinh|nachbar|neighbo|voisin|vecin|vicin|\bburen\b|buurman|buurvrouw|portaria|hausmeister|concierge|conci[eë]rge|reception|receptie|rezeption|portier|porteir|conserje|portineria|lobby|mailroom|poststelle/i,
}
const NOMES_FALTA = {
  pedido: 'o número do pedido', produtos: 'quais produtos estão envolvidos', motivo: 'o motivo', ajuste: 'se ficou pequeno ou grande',
  end_rua: 'rua e número', end_cep: 'código postal', end_cidade: 'cidade', foto_melhor: 'outra foto',
}
const NUM_DIAS = { 2: 'dois|duas|zwei|two|deux|dos|due|twee', 5: 'cinco|f[üu]nf|five|cinq|cinque|vijf' }
const RE_DIAS = '(?:dias?\\s*[úu]teis|werktage?n?|business days?|working days?|jours? ouvr[ée]s?|d[ií]as? h[áa]biles|giorni lavorativi|werkdagen|dias?|tage?n?|days?|jours?|d[ií]as?|giorn[oi]|dagen)'
const RE_DIAS_UTEIS = '(?:dias?\\s*[úu]teis|werktage?n?|business days?|working days?|jours? ouvr[ée]s?|d[ií]as? h[áa]biles|giorni lavorativi|werkdagen)'
const EXTRA = '(?:weitere?n?\\s+|more\\s+|mais\\s+|de plus\\s+|m[áa]s\\s+|altri\\s+|extra\\s+|noch\\s+)?'
/** "mais 2 dias", "2 weitere Tage", "two more days"… */
export const mencionaDias = (texto, n) => new RegExp(`\\b(?:${n}|${NUM_DIAS[n]})\\s*${EXTRA}${RE_DIAS}`, 'i').test(texto)
/** "5 dias úteis", "fünf Werktage", "5 business days"… */
export const mencionaDiasUteis = (texto, n) => new RegExp(`\\b(?:${n}|${NUM_DIAS[n]})\\s*${EXTRA}${RE_DIAS_UTEIS}`, 'i').test(texto)

const MESES = ['jan|gen|ene', 'feb|fev', 'mar|marz|mrz|mrt', 'apr|abr|avr', 'mai|may|mag|mei', 'jun|giu|juin', 'jul|lug|juil', 'aug|ago|aout', 'sep|set', 'okt|oct|out|ott', 'nov', 'dez|dec|dic']
/** A data ISO aparece no texto em algum formato usual (28/08/2026, 28.08.2026, 28 de agosto, August 28…)? */
export function mencionaData(texto, iso) {
  const [y, m, d] = String(iso || '').split('-')
  if (!y || !m || !d) return false
  const dn = String(Number(d)); const mn = String(Number(m))
  const s = semAcento(texto)
  const nomes = MESES[Number(m) - 1]
  const padroes = [
    `${y}-${m}-${d}`, `\\b${d}\\.${m}\\.${y}`, `\\b${dn}\\.${mn}\\.${y}`, `\\b${d}/${m}/${y}`, `\\b${dn}/${mn}/${y}`, `\\b${m}/${d}/${y}`, `\\b${d}-${m}-${y}`,
    `\\b${dn}(?:\\.|º|°|st|nd|rd|th)?\\s*(?:de\\s+|di\\s+|du\\s+|of\\s+)?(?:${nomes})`,
    `(?:${nomes})[a-z]*\\.?\\s+(?:the\\s+)?${dn}\\b`,
  ]
  return padroes.some(p => new RegExp(p, 'i').test(s))
}

/* ---- oferta indevida: promessa ou oferta de ação que a fase não permite ---- */

// marcadores de oferta/promessa positiva (a ação está sendo oferecida ou garantida)
const RE_OFERECE = /\b(oferec|ofrec|offr|offer|biet|propos|kostenlos|gratuit|gratis|gr[áa]tis|free\b|podemos|pode(?:r[ií]amos)?\b|we (?:can|could|will|would)|we'll|wir (?:k[oö]nn(?:en|ten)|werden|senden|schicken|tauschen|erstatten)|k[oö]nn(?:en|ten) wir|werden wir|senden wir|schicken wir|tauschen wir|erstatten wir|enviaremos|faremos|reenviaremos|trocaremos|reembolsaremos|cancelaremos|vamos\b|possiamo|potremmo|pouvons|pourrions|allons|podr[ií]amos|com prazer|gerne|happy to|glad to|erhalten sie|sie erhalten|sie bekommen|bekommen sie|receber[áa]|you(?:'ll| will) (?:get|receive)|providenci|arrange|veranlass|organis|garant|assegur|alternativ|como alternativa|as an alternative|stattdessen|instead|aanbied|bieden (?:wij|we)|(?:wij|we) (?:kunnen|zullen|bieden|sturen|verzenden|ruilen|vervangen|betalen)|kunnen (?:wij|we)|zullen (?:wij|we)|graag|kosteloos|u (?:krijgt|ontvangt)|krijgt u|ontvangt u)/i
// marcadores de negação / limitação: a ação está sendo explicada como ainda não possível
const RE_NEGA = /\b(n[aã]o|nicht|not|kein|keine|keinen|nie|niemals|never|pas|non|niet|geen|ainda n[aã]o|noch nicht|not yet|erst\b|s[oó] (?:depois|ap[oó]s|quando|poder)|only (?:after|once|when|possible)|nur (?:nach|wenn|sobald|m[oö]glich)|nach ablauf|ap[oó]s o (?:fim|t[ée]rmino|prazo)|after the (?:deadline|delivery|period)|infelizmente|leider|unfortunately|malheureusement|purtroppo|lamentablemente|helaas|imposs|nicht m[oö]glich|cannot|can't|can not|couldn't|antes d[oe]|before the|until|bis (?:zum|zur|der|die|das)|solange|enquanto|nog niet|kan niet|kunnen niet|niet mogelijk|pas na|alleen na|voordat|totdat|jammer genoeg)\b/i
// frases: só pontuação forte. Segmentos: só conjunções adversativas/consecutivas —
// vírgula, dois-pontos, travessão, artigos e "ou/or/oder" NÃO separam o marcador da ação.
const RE_FRASES = /[.!?;\n]+/
const RE_SEGMENTOS = /\b(?:mas|por[ée]m|contudo|entretanto|todavia|ent[ãa]o|portanto|but|however|yet|therefore|then|aber|jedoch|doch|sondern|daher|deshalb|deswegen|dann|pero|sino|entonces|ma|per[òo]|tuttavia|quindi|mais|toutefois|cependant|donc|alors|maar|echter|dus|daarom|toch)\b/i

/** Ações que uma oferta traz (troca, reenvio, reembolso, cupom, cancelamento). */
export function acoesDaOferta(o) {
  if (!o) return []
  const a = []
  if (/troca/.test(o.tipo)) a.push('troca')
  if (/reenvio/.test(o.tipo)) a.push('reenvio')
  if (/reembolso/.test(o.tipo) || (o.pct && o.tipo !== 'cancelamento' && o.tipo !== 'cupom')) a.push('reembolso')
  if (o.tipo === 'cupom' || o.cupom) a.push('cupom')
  if (o.tipo === 'cancelamento') a.push('cancelamento')
  return [...new Set(a)]
}

/**
 * Procura, cláusula a cláusula, uma ação NÃO permitida que esteja sendo oferecida
 * ou prometida (tem marcador de oferta e nenhum de negação). Explicar que algo
 * ainda não pode ser feito ("só depois do prazo") não é oferta. Devolve o nome
 * da ação indevida ou null.
 */
export function ofertaIndevida(texto, permitidas = []) {
  const global = re => new RegExp(re.source, 'gi')
  for (const frase of String(texto || '').split(RE_FRASES)) {
    for (const bruta of frase.split(RE_SEGMENTOS)) {
      const seg = bruta.trim()
      if (!seg) continue
      // posição em palavras (o marcador de oferta alcança toda ação do mesmo segmento)
      const palavra = i => seg.slice(0, i).split(/\s+/).length - 1
      const ofertas = [...seg.matchAll(global(RE_OFERECE))].map(m => palavra(m.index))
      if (!ofertas.length) continue
      // a negação vale pela última palavra do marcador ("ainda não", "erst nach", "cannot")
      const negacoes = [...seg.matchAll(global(RE_NEGA))].map(m => palavra(m.index + m[0].length - 1))
      for (const acao of Object.keys(RE_ACAO)) {
        if (permitidas.includes(acao)) continue
        for (const m of seg.matchAll(global(RE_ACAO[acao]))) {
          const a = palavra(m.index)
          // oferecida = há marcador de oferta sem negação entre (ou colada a) marcador e ação
          const oferecida = ofertas.some(o => !negacoes.some(n => n >= Math.min(a, o) - 1 && n <= Math.max(a, o) + 1))
          if (oferecida) return NOME_ACAO[acao]
        }
      }
    }
  }
  return null
}

/** Exigências das fases sem oferta. Devolve o motivo do bloqueio ou null. */
function exigenciasSemOferta(faseId, s, { an, pedido, loja, faltando }) {
  const tem = re => re.test(s)
  switch (faseId) {
    case 'coleta': {
      if (!faltando?.length) return tem(/\?/) ? null : 'a coleta tem de PERGUNTAR o que falta'
      for (const f of faltando) {
        if (f === 'ajuste') { if (!tem(RE_PALAVRAS.pequeno) || !tem(RE_PALAVRAS.grande)) return 'falta perguntar se ficou pequeno ou grande'; continue }
        const re = RE_PALAVRAS[f === 'foto_melhor' ? 'foto' : f]
        if (re && !tem(re)) return `falta pedir ${NOMES_FALTA[f] ?? f}`
      }
      return null
    }
    case 'tam_ajuste':
      return tem(RE_PALAVRAS.pequeno) && tem(RE_PALAVRAS.grande) ? null : 'falta perguntar se ficou PEQUENO ou GRANDE'
    case 'def_foto':
      return tem(RE_PALAVRAS.foto) ? null : 'falta pedir a foto do defeito'
    case 'endereco': {
      const pendentes = (faltando ?? []).filter(f => /^end_/.test(f))
      if (pendentes.length) {
        for (const f of pendentes) if (!tem(RE_PALAVRAS[f])) return `falta pedir ${NOMES_FALTA[f]}`
        return null
      }
      const componentes = tem(RE_PALAVRAS.end_rua) && tem(RE_PALAVRAS.end_cep) && tem(RE_PALAVRAS.end_cidade)
      if (!tem(RE_PALAVRAS.endereco) && !componentes) return 'falta pedir o endereço de entrega'
      if (!componentes && !tem(RE_PALAVRAS.completo)) return 'falta pedir o endereço COMPLETO (rua e número, código postal e cidade)'
      return null
    }
    case 'nc_no_prazo': {
      if (!tem(RE_PALAVRAS.prazo)) return 'falta dizer que o pedido está dentro do prazo de entrega'
      if (!pedido) return 'sem pedido localizado não há data provável para informar'
      const prov = prazoDoPedido(pedido, loja).provavel
      if (!mencionaData(s, prov)) return `falta a data provável de recebimento calculada pelo servidor (${prov})`
      if (tem(RE_ACAO.cupom)) return 'dentro do prazo não se oferece cupom nem benefício'
      return null
    }
    case 'nr_entregue_aguardar': {
      if (!mencionaDias(s, 2)) return 'falta pedir que aguarde mais 2 dias'
      if (!tem(RE_PALAVRAS.vizinhos)) return 'falta orientar a verificar com vizinhos ou na portaria'
      if (tem(RE_ACAO.cupom)) return 'nesta fase não se oferece nada'
      return null
    }
    default:
      return null
  }
}

/**
 * Confere o texto final de uma fase — bloqueios NEGATIVOS (percentual/cupom de
 * outra etapa, fato consumado) e POSITIVOS (o que a fase exige tem de estar lá):
 * percentual obrigatório, valor em dinheiro igual ao cálculo do servidor, código
 * do cupom cadastrado (e nenhum inventado), ação nomeada e prazo obrigatório.
 */
export function conferirTextoDaFase(faseId, texto, loja, an = null, pedido = null, opcoes = {}) {
  const v = validarProposta(faseId, { acao_proposta: faseId, resposta: texto }, loja, an)
  if (!v.ok) return v
  const fase = FASES[faseId]
  const s = String(texto || '')
  // idioma que o validador local não sabe ler: confere só números/códigos; o texto
  // fica obrigatoriamente na aprovação humana (prepararRascunhoNovo nunca agenda)
  const idiomaAlvo = normalizarIdioma(opcoes.idioma)
  const leve = !!(idiomaAlvo && !IDIOMAS_VALIDADOS.has(idiomaAlvo))
  const aviso = leve ? `idioma "${idiomaAlvo}" não é validado localmente — aprovação humana obrigatória` : null
  // cupom inventado / código diferente do cadastrado. Vale mesmo em Markdown:
  // um código correto acompanhado de outro inventado também bloqueia.
  const cadastrados = new Set(Object.values(loja?.cupons ?? {}).filter(Boolean))
  const codigosNoTexto = codigosCitados(s)
  for (const c of codigosNoTexto) {
    if (!cadastrados.has(c)) return { ok: false, motivo: `o texto cita o código de cupom "${c}", que não está cadastrado na loja` }
  }
  // valores em dinheiro: só os calculados pelo servidor
  const permitidos = valoresPermitidos(faseId, an, pedido)
  if (permitidos.length) {
    for (const n of valoresMonetarios(s)) {
      if (!permitidos.some(p => Math.abs(p - n) < 0.011)) {
        return { ok: false, motivo: `o texto cita o valor ${n.toFixed(2)}, que não corresponde ao cálculo do servidor (${permitidos.map(p => p.toFixed(2)).join(' / ')})` }
      }
    }
  }
  // fato consumado só na fase de confirmação (depois do clique do dono)
  if (!fase?.confirmacao) {
    const indevida = confirmacaoIndevida(s)
    if (indevida) return { ok: false, motivo: `o texto confirma ${indevida} como fato consumado — a oferta tem de ser apresentada como pergunta` }
  }
  // exigências positivas da oferta (ou da opção aceita, na confirmação):
  // percentual + valor em dinheiro do servidor, frete (50%), cupom (código +
  // percentual), TODAS as ações da etapa, prazo da oferta e 3 a 14 dias na confirmação
  const oferta = ofertaDaFase(faseId, an)
  // nenhuma ação fora da oferta desta fase (ou da opção já aceita) pode ser oferecida ou prometida
  // no pedido de endereço, a opção que o cliente já aceitou pode ser repetida — nada além dela
  const indevidaAqui = leve ? null : ofertaIndevida(s, acoesDaOferta(faseId === 'endereco' ? (FASES[an?.acaoAceita]?.oferta ?? null) : oferta))
  if (indevidaAqui) return { ok: false, motivo: `o texto oferece ou promete ${indevidaAqui}, que não é permitido nesta etapa${oferta ? '' : ' (antes dos dados obrigatórios, da foto validada ou do prazo, nenhuma oferta pode aparecer)'}` }
  if (!oferta) {
    const motivo = leve ? null : exigenciasSemOferta(faseId, s, { an, pedido, loja, faltando: opcoes.faltando ?? an?.transicaoPendente?.faltando ?? [] })
    return motivo ? { ok: false, motivo } : { ok: true, motivo: null, aviso }
  }
  const valor = Number(pedido?.valor || 0)
  const citados = valoresMonetarios(s)
  const temValor = n => citados.some(v => Math.abs(v - n) < 0.011)
  const pctOferta = oferta.tipo === 'cancelamento' ? 100 : oferta.pct
  if (pctOferta) {
    if (oferta.tipo !== 'cancelamento' && !new RegExp(`\\b${pctOferta}\\s?%`).test(s)) {
      return { ok: false, motivo: `falta o percentual obrigatório da etapa (${pctOferta}%)` }
    }
    if (!valor) return { ok: false, motivo: 'não há valor do pedido para calcular o reembolso em dinheiro — sem ele o texto não pode sair' }
    const esperado = Math.round(valor * pctOferta) / 100
    if (!temValor(esperado)) return { ok: false, motivo: `falta o valor em dinheiro calculado pelo servidor (${esperado.toFixed(2)} = ${pctOferta}% de ${valor.toFixed(2)})` }
  }
  if (faseId === 'reemb_50') {
    const frete = Math.round(valor * 25) / 100
    if (!valor || !temValor(frete)) return { ok: false, motivo: `falta o valor do frete de devolução calculado pelo servidor (${frete.toFixed(2)}), separado do valor do reembolso` }
  }
  const cup = cupomDaFase(faseId, loja, an)
  if (cup.precisa) {
    if (!new RegExp(`\\b${cup.pct}\\s?%`).test(s)) return { ok: false, motivo: `falta o percentual do cupom (${cup.pct}%)` }
    if (!leve && !RE_ACAO.cupom.test(s)) return { ok: false, motivo: 'falta dizer que se trata de um cupom (Gutschein / coupon / código de desconto) — o código solto não basta' }
    if (faseRevelaCupom(faseId)) {
      // CONFIRMAÇÃO: o código cadastrado é obrigatório (e só ele — outro código
      // já foi barrado acima, cadastrado ou inventado)
      if (cup.codigo && !s.includes(cup.codigo)) return { ok: false, motivo: `falta o código do cupom cadastrado (${cup.codigo})` }
    } else {
      // NEGOCIAÇÃO: nenhum código pode aparecer antes do aceite do cliente
      const revelado = codigosNoTexto[0] ?? (cup.codigo && s.includes(cup.codigo) ? cup.codigo : null)
      if (revelado) {
        return { ok: false, motivo: `o código do cupom ("${revelado}") não pode aparecer antes de o cliente aceitar — nesta etapa diga só que haverá um cupom de ${cup.pct}%` }
      }
    }
  }
  // atrasado: o prazo máximo de mais 5 dias úteis é obrigatório
  if (!leve && faseId === 'nc_atrasado_25' && !mencionaDiasUteis(s, 5)) {
    return { ok: false, motivo: 'falta pedir que aguarde no máximo mais 5 dias úteis' }
  }
  // confirmação de troca/reenvio: o endereço confirmado tem de ser repetido por inteiro
  if (faseId === 'conf_troca') {
    const partes = String(an?.enderecoConfirmado || '').split(/[,\n;]+/).map(p => semAcento(p).replace(/\s+/g, ' ').trim()).filter(p => p.length >= 3)
    const st = semAcento(s).replace(/\s+/g, ' ')
    if (!partes.length) return { ok: false, motivo: 'não há endereço confirmado pelo cliente — a confirmação da troca/reenvio não pode sair sem ele' }
    const faltou = partes.find(p => !st.includes(p))
    if (faltou) return { ok: false, motivo: `não repete o endereço de entrega confirmado por inteiro (faltou "${faltou}")` }
  }
  const acoes = []
  if (/troca/.test(oferta.tipo)) acoes.push('troca')
  if (/reenvio/.test(oferta.tipo)) acoes.push('reenvio')
  if (/reembolso/.test(oferta.tipo)) acoes.push('reembolso')
  if (oferta.tipo === 'cupom') acoes.push('cupom')
  if (oferta.tipo === 'cancelamento') acoes.push('cancelamento')
  for (const acao of leve ? [] : acoes) {
    if (!RE_ACAO[acao].test(s)) return { ok: false, motivo: `o texto não nomeia a ação "${NOME_ACAO[acao]}" desta etapa${acoes.length > 1 ? ` (a etapa tem ${acoes.length} ações: ${acoes.join(' + ')})` : ''}` }
  }
  if (fase?.confirmacao && pctOferta && !/\b3\s*(?:[-–—]|a|à|to|bis|hasta|tot|e|und|and|ou|or|oder|\/|\S{1,8})\s*14\b/i.test(s)) {
    return { ok: false, motivo: 'falta o prazo de 3 a 14 dias para o dinheiro voltar ao método de pagamento' }
  }
  if (oferta.prazo) {
    const [min, max] = oferta.prazo.match(/\d+/g) ?? []
    if (min && max && !new RegExp(`\\b${min}\\s*(?:[-–—]|a|à|to|bis|hasta|tot|e|und|and|ou|or|oder|\\/|\\S{1,8})\\s*${max}\\b`, 'i').test(s)) {
      return { ok: false, motivo: `falta o prazo obrigatório da etapa (${oferta.prazo})` }
    }
  }
  return { ok: true, motivo: null, aviso }
}

/** Percentuais e cupons presentes num texto — a "assinatura" da oferta. */
export function assinaturaOferta(texto, loja) {
  const t = String(texto || '')
  const pcts = [...new Set([...t.matchAll(/(\d{1,3})\s?%/g)].map(m => Number(m[1])))].sort((a, b) => a - b)
  const cupons = Object.values(loja?.cupons ?? {}).filter(c => c && t.includes(c)).sort()
  return { pcts, cupons, chave: `${pcts.join('/')}|${cupons.join('/')}` }
}

/** Uma edição humana mudou a oferta em relação ao rascunho? Devolve a descrição ou null. */
export function diferencaDeOferta(rascunho, texto, loja) {
  if (String(rascunho ?? '') === String(texto ?? '')) return null
  const a = assinaturaOferta(rascunho, loja)
  const b = assinaturaOferta(texto, loja)
  if (a.chave === b.chave) return null
  const fmt = s => [...s.pcts.map(p => `${p}%`), ...s.cupons].join(', ') || 'nenhum percentual ou cupom'
  return `o rascunho tinha ${fmt(a)}; o texto final tem ${fmt(b)}`
}

/** Instrução do lojista que tentaria mudar oferta, percentual, cupom ou etapa. Devolve o motivo ou null. */
const RE_INSTRUCAO_PROIBIDA = /\d+\s?%|\b(reembols|refund|erstatt|rimbors|rembours|cupom|cupon|coupon|gutschein|desconto|discount|rabatt|troca|umtausch|exchange|reenvi|resend|oferta|oferec|offer|etapa|fase|escada|percentual|porcent|dinheiro|gr[aá]tis|gratuit|kostenlos|free|cancel)/i
export function instrucaoAlteraOferta(instrucao, loja) {
  const s = String(instrucao || '')
  if (!s.trim()) return null
  const m = s.match(RE_INSTRUCAO_PROIBIDA)
  if (m) return `a instrução menciona "${m[0]}" — no modo novo a instrução não pode mudar oferta, percentual, cupom ou etapa`
  const codigo = Object.values(loja?.cupons ?? {}).find(c => c && s.toUpperCase().includes(String(c).toUpperCase()))
  if (codigo) return `a instrução cita o cupom ${codigo}`
  return null
}
