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
    aoAceitar: null, aoRecusar: 'nr_reenvio_35',
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
    etapa: null,
    produtosAfetados: [],
    motivo: null,
    ajusteTamanho: null,
    fotoSolicitada: false,
    fotoRecebida: false,     // chegou uma imagem (ainda não é prova de nada)
    fotoValidada: null,      // true só depois de o lojista confirmar que mostra o defeito
    aguardandoComprovacao: false, // imagem recebida no fluxo de defeito, esperando o lojista dizer se comprova
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
/* Cadência: 5 horas depois da última mensagem do cliente             */
/* ------------------------------------------------------------------ */

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
 * Quando a próxima resposta pode sair. Primeira resposta da loja: usa o atraso
 * normal do painel; depois disso, 5 h após a mensagem mais recente do cliente.
 */
export function horarioMinimoEnvio(t, atrasoMinutos = 0, agora = Date.now()) {
  if (!lojaJaRespondeu(t)) return agora + Math.max(0, atrasoMinutos) * 60_000
  return Math.max(agora, ultimaMensagemClienteMs(t) + CADENCIA_MS)
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
    const rotulo = item ? `${item.titulo}${item.variante ? ` (${item.variante})` : ''}` : String(c)
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
export function decidir({ an: anAntes, cls, pedido, loja, temFoto = false, agora = Date.now() }) {
  const an = { ...anAntes, produtosAfetados: [...(anAntes.produtosAfetados ?? [])], historicoEtapas: [...(anAntes.historicoEtapas ?? [])] }
  const saida = { an, fase: null, faltando: [], humano: null, encerrar: false, aceite: null }

  // --- dados novos trazidos pela mensagem ---
  if (cls.motivo && !an.motivo) an.motivo = cls.motivo
  if (cls.produtos?.length) {
    for (const p of casarProdutos(cls.produtos, pedido)) if (!an.produtosAfetados.includes(p)) an.produtosAfetados.push(p)
  }
  if (!an.produtosAfetados.length && rotulosDoPedido(pedido).length === 1) an.produtosAfetados = rotulosDoPedido(pedido)
  if (cls.ajustes?.length) {
    an.ajusteTamanho = { ...(an.ajusteTamanho ?? {}) }
    for (const a of cls.ajustes) if (a?.produto && (a.ajuste === 'pequeno' || a.ajuste === 'grande')) an.ajusteTamanho[a.produto] = a.ajuste
  }
  if (temFoto) an.fotoRecebida = true
  // endereço se acumula entre mensagens; só vira "confirmado" depois de validado
  if (cls.endereco) an.enderecoInformado = [an.enderecoInformado, cls.endereco].filter(Boolean).join('\n')

  // --- já está com o dono: não mexe ---
  if (an.aguardando === 'humano') { saida.humano = 'Caso já está com você — o cliente escreveu de novo'; return saida }

  // --- agradecimento puro: encerra ---
  if (cls.intencao === 'agradece') { saida.encerrar = true; return saida }

  // --- aguardando endereço (aceite de troca/reenvio) ---
  if (an.etapa === 'endereco') {
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
    if (!fluxo) { saida.humano = 'Fora do mapa do atendimento novo — responda você'; return saida }
    an.fluxo = fluxo
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
    return irPara(saida, alvo, agora)
  }

  // --- dentro do prazo: o prazo venceu? o cliente insiste? ---
  if (an.etapa === 'nc_no_prazo') {
    const prazo = prazoDoPedido(pedido, loja, agora)
    return irPara(saida, prazo.vencido ? 'nc_atrasado_25' : 'nc_no_prazo', agora)
  }
  if (an.etapa === 'nr_entregue_aguardar') {
    if (cls.intencao === 'informa' && /receb|chegou|arriv|erhalten|angekommen|ricevut|reçu|ontvangen/i.test(cls.resumo ?? '')) { saida.encerrar = true; return saida }
    return irPara(saida, atual.aoRecusar, agora)
  }

  // --- resposta a uma oferta ---
  if (cls.intencao === 'aceita') {
    if (!atual?.aoAceitar) { saida.humano = 'Cliente concordou, mas esta fase não tem oferta — confira'; return saida }
    an.acaoAceita = an.etapa
    if (atual.aoAceitar === 'endereco') return irPara(saida, 'endereco', agora)
    an.aguardando = 'humano'
    saida.aceite = { fase: an.etapa, oferta: atual.oferta }
    saida.humano = `Cliente aceitou "${atual.titulo}" — aprovar e confirmar`
    return saida
  }
  if (cls.intencao === 'recusa' || cls.intencao === 'pede_reembolso' || cls.intencao === 'pede_cancelamento') {
    if (!atual?.aoRecusar) { saida.humano = `Cliente recusou "${atual?.titulo ?? an.etapa}" e não há próxima etapa — decida você`; return saida }
    return irPara(saida, atual.aoRecusar, agora)
  }
  if (cls.intencao === 'informa' || cls.intencao === 'pergunta_status') {
    // informou algo sem aceitar nem recusar: repete a MESMA fase (não avança)
    return irPara(saida, an.etapa, agora)
  }
  saida.humano = 'Não deu para entender se o cliente aceitou ou recusou — responda você'
  return saida
}

/** Aponta a fase a escrever, respeitando dados faltantes, foto e cupons. */
function irPara(saida, alvo, agora) {
  const { an } = saida
  if (!alvo) { saida.humano = 'Sem próxima etapa definida'; return saida }
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
export function cupomDaFase(faseId, loja, an = null) {
  const pct = ofertaDaFase(faseId, an)?.cupom
  if (!pct) return { precisa: false, codigo: null }
  const codigo = loja?.cupons?.[String(pct)] || null
  return { precisa: true, pct, codigo }
}

/* ------------------------------------------------------------------ */
/* Prompts do modo novo                                                */
/* ------------------------------------------------------------------ */

const NOMES_IDIOMA = { pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', nl: 'holandês' }
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
export function promptClassificar({ loja, an, pedido, ticket, agora = Date.now() }) {
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
    `"situacaoEntrega": nao_chegou, entregue_nao_recebido (consta entregue mas ele não recebeu), voltou_remetente, recusou_na_porta, ou nenhuma.`,
    `"endereco": o endereço de entrega completo, se o cliente escreveu um; senão string vazia.`,
    `"resumo": uma frase em português do que o cliente disse. "idioma": código ISO do idioma do cliente.`,
    `"spam": true só se não for cliente falando da própria compra.`,
  ].join('\n')
  const user = [
    ultimaDaLoja ? `Última mensagem da loja:\n${String(ultimaDaLoja).slice(0, 1500)}\n\n---\n` : '',
    `Mensagem do cliente (${ticket.nome} <${ticket.de}>):`,
    `Assunto: ${ticket.assunto}`,
    String(ticket.corpo || '').slice(0, 4000),
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
export function promptEscrever({ loja, config, faseId, faltando = [], an, pedido, ticket, instrucaoEstilo = null, agora = Date.now() }) {
  const fase = FASES[faseId]
  const moeda = loja?.moeda ?? 'EUR'
  const idiomaFixo = loja?.idioma && loja.idioma !== 'auto' ? (NOMES_IDIOMA[loja.idioma] ?? loja.idioma) : null
  const valor = Number(pedido?.valor || 0)
  const conf = !!fase.confirmacao
  const aceita = conf ? FASES[an.acaoAceita] : null
  const oferta = conf ? (aceita?.oferta ?? null) : fase.oferta
  const dados = []
  if (conf) dados.push(`Opção aceita pelo cliente e aprovada pelo lojista: ${aceita?.titulo ?? an.acaoAceita} (${descreverOferta(oferta)}).`)
  if (oferta?.pct && (conf || oferta.pct < 100)) dados.push(`Reembolso de ${oferta.pct}% = ${dinheiro(valor * oferta.pct / 100, moeda)} (sobre ${dinheiro(valor, moeda)} pagos).`)
  if (faseId === 'reemb_50') dados.push(`Frete de devolução estimado: ${dinheiro(valor * 0.25, moeda)} — informe só este valor em dinheiro; não diga a porcentagem que ele representa.`)
  const cupom = cupomDaFase(faseId, loja, an)
  if (cupom.precisa) dados.push(`Cupom de ${cupom.pct}%: código ${cupom.codigo}. Use EXATAMENTE este código.`)
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

  const system = [
    `Você é o atendimento ao cliente da loja "${loja?.nome ?? config?.nomeLoja ?? 'loja'}", um e-commerce de roupas.`,
    `Escreva a resposta ao cliente ${idiomaFixo ? `em ${idiomaFixo}` : 'no idioma em que ele escreveu'}, cordial, direta, humana, sem parecer robô.`,
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
      `- Nomeie a ação com a palavra própria no idioma do cliente (troca/Umtausch/exchange, reenvio/erneut senden/resend, reembolso/Rückerstattung/refund, cupom/Gutschein/coupon) e escreva o percentual, o valor em dinheiro, o prazo e o código EXATAMENTE como estão nos dados abaixo.`,
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
    `No JSON, "acao_proposta" deve ser exatamente "${faseId}".`,
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
  troca: /\b(troca|trocar|trocamos|umtausch|tausch|austausch|ersatz|exchange|replace|replacement|[ée]change|remplac|cambio|reemplaz|scambio|sostitu|ruil|omruil|vervang)/i,
  reenvio: /(reenvi|resend|re-send|erneut|nochmal|noch einmal|neu(?:e|en|es)?\s+(?:sendung|versand|lieferung|paket)|ersatzlieferung|ersatzsendung|renvo|nouvel envoi|reenv[ií]|rispedi|nuovo invio|opnieuw|nieuwe zending|ship(?:ping)?\s+(?:it\s+)?again|send(?:ing)?\s+(?:it\s+|you\s+)?again|another (?:package|parcel|shipment)|new (?:shipment|package|parcel))/i,
  reembolso: /(reembols|refund|erstatt|rimbors|rembours|terugbetal|devolu[çc][aã]o do valor|devoluci[óo]n|money back|geld zur[üu]ck)/i,
  cupom: /(cupom|cup[óo]n|coupon|gutschein|rabattcode|c[óo]digo de desconto|discount code|code promo|codice sconto|kortingscode|voucher)/i,
  cancelamento: /(cancel|storn|annul)/i,
}
const acaoPrincipal = tipo => /troca/.test(tipo ?? '') ? 'troca' : /reenvio/.test(tipo ?? '') ? 'reenvio' : tipo ?? null
const NOME_ACAO = { troca: 'troca', reenvio: 'reenvio', reembolso: 'reembolso', cupom: 'cupom', cancelamento: 'cancelamento' }

const RE_DINHEIRO = /(?:(€|R\$|US\$|\$|£|EUR|BRL|USD|GBP)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?))|(?:(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(€|R\$|US\$|\$|£|EUR|BRL|USD|GBP|euros?)(?![a-z]))/gi

/** Números com moeda citados no texto (17,50 € · €17.50 · EUR 1.500,00 · 1,500.00 USD). */
export function valoresMonetarios(texto) {
  const out = []
  for (const m of String(texto || '').matchAll(RE_DINHEIRO)) {
    const bruto = (m[2] ?? m[3] ?? '').trim()
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

const RE_CUPOM_KW = /(cupom|cup[óo]n|coupon|gutschein(?:code)?|rabattcode|c[óo]digo|codice|code|kortingscode|voucher)/gi
/** Códigos de cupom citados no texto (token só com maiúsculas/dígitos, com ao menos uma letra). */
export function codigosCitados(texto) {
  const out = new Set()
  const s = String(texto || '')
  for (const m of s.matchAll(RE_CUPOM_KW)) {
    const resto = s.slice(m.index + m[0].length, m.index + m[0].length + 40)
    const tok = resto.match(/^[\s:\-–—"“«'’]*([A-Za-z0-9]{4,20})\b/)?.[1]
    if (tok && /^[A-Z0-9]+$/.test(tok) && /[A-Z]/.test(tok)) out.add(tok)
  }
  return [...out]
}

/**
 * Confere o texto final de uma fase — bloqueios NEGATIVOS (percentual/cupom de
 * outra etapa, fato consumado) e POSITIVOS (o que a fase exige tem de estar lá):
 * percentual obrigatório, valor em dinheiro igual ao cálculo do servidor, código
 * do cupom cadastrado (e nenhum inventado), ação nomeada e prazo obrigatório.
 */
export function conferirTextoDaFase(faseId, texto, loja, an = null, pedido = null) {
  const v = validarProposta(faseId, { acao_proposta: faseId, resposta: texto }, loja, an)
  if (!v.ok) return v
  const fase = FASES[faseId]
  const s = String(texto || '')
  // cupom inventado / código diferente do cadastrado
  const cadastrados = new Set(Object.values(loja?.cupons ?? {}).filter(Boolean))
  for (const c of codigosCitados(s)) {
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
  if (!oferta) return { ok: true, motivo: null }
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
    if (cup.codigo && !s.includes(cup.codigo)) return { ok: false, motivo: `falta o código do cupom cadastrado (${cup.codigo})` }
    if (!new RegExp(`\\b${cup.pct}\\s?%`).test(s)) return { ok: false, motivo: `falta o percentual do cupom (${cup.pct}%)` }
  }
  const acoes = []
  if (/troca/.test(oferta.tipo)) acoes.push('troca')
  if (/reenvio/.test(oferta.tipo)) acoes.push('reenvio')
  if (/reembolso/.test(oferta.tipo)) acoes.push('reembolso')
  if (oferta.tipo === 'cupom') acoes.push('cupom')
  if (oferta.tipo === 'cancelamento') acoes.push('cancelamento')
  for (const acao of acoes) {
    if (!RE_ACAO[acao].test(s)) return { ok: false, motivo: `o texto não nomeia a ação "${NOME_ACAO[acao]}" desta etapa${acoes.length > 1 ? ` (a etapa tem ${acoes.length} ações: ${acoes.join(' + ')})` : ''}` }
  }
  if (fase?.confirmacao && pctOferta && !/\b3\s*(?:[-–—]|a|à|to|bis|hasta|tot|e|und|and|ou|or|oder|\/)\s*14\b/i.test(s)) {
    return { ok: false, motivo: 'falta o prazo de 3 a 14 dias para o dinheiro voltar ao método de pagamento' }
  }
  if (oferta.prazo) {
    const [min, max] = oferta.prazo.match(/\d+/g) ?? []
    if (min && max && !new RegExp(`\\b${min}\\s*(?:[-–—]|a|à|to|bis|hasta|tot|e|und|and|ou|or|oder|\\/)\\s*${max}\\b`, 'i').test(s)) {
      return { ok: false, motivo: `falta o prazo obrigatório da etapa (${oferta.prazo})` }
    }
  }
  return { ok: true, motivo: null }
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
