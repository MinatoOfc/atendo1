/**
 * Auditoria da IA — registro append-only dos acontecimentos do motor novo e a
 * comprovação, item a item, de cada resposta.
 *
 * Este módulo é PURO: não decide nada, não envia nada, não muda fase, oferta,
 * cadência nem relatório. Ele só descreve o que já aconteceu. A auditoria
 * observa o pipeline — nunca o controla.
 *
 * Nada de raciocínio oculto, prompt, token, chave ou segredo entra aqui: só a
 * classificação estruturada e o resultado objetivo das validações.
 */

export const TIPOS_AUDITORIA = [
  'cliente_recebido', 'ia_classificou', 'motor_decidiu', 'rascunho_gerado', 'rascunho_validado',
  'rascunho_bloqueado', 'envio_agendado', 'envio_reagendado', 'envio_iniciado', 'email_enviado',
  'envio_falhou', 'cliente_aceitou', 'cliente_recusou', 'aguardando_aprovacao', 'aprovado_pelo_dono',
  'respondido_manualmente', 'fase_confirmada', 'caso_encerrado', 'caso_para_humano',
]

export const ROTULO_TIPO_AUDITORIA = {
  cliente_recebido: 'Mensagem do cliente',
  ia_classificou: 'IA classificou',
  motor_decidiu: 'Servidor escolheu a fase',
  rascunho_gerado: 'Rascunho gerado',
  rascunho_validado: 'Resposta validada',
  rascunho_bloqueado: 'Rascunho bloqueado',
  envio_agendado: 'Envio agendado',
  envio_reagendado: 'Envio reagendado',
  envio_iniciado: 'Envio iniciado',
  email_enviado: 'E-mail enviado',
  envio_falhou: 'Falha no envio',
  cliente_aceitou: 'Cliente aceitou',
  cliente_recusou: 'Cliente recusou',
  aguardando_aprovacao: 'Aguardando sua aprovação',
  aprovado_pelo_dono: 'Aprovado por você',
  respondido_manualmente: 'Respondido por você',
  fase_confirmada: 'Fase confirmada',
  caso_encerrado: 'Caso encerrado',
  caso_para_humano: 'Caso foi para você',
}

export const SITUACOES_AUDITORIA = ['ok', 'atencao', 'bloqueado', 'informativo']

const texto = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
const limite = (v, n) => (texto(v) ? texto(v).slice(0, n) : null)

/**
 * Monta um evento. `chave` é a chave IDEMPOTENTE do acontecimento: o mesmo
 * acontecimento nunca vira dois eventos, mesmo com reinício ou nova tentativa.
 */
export function novoEvento({
  tipo, ticketId, lojaId = null, fase = null, jornada = null, resumo = '',
  situacao = 'informativo', dados = {}, em = null, chave = null, id = null,
} = {}) {
  if (!TIPOS_AUDITORIA.includes(tipo)) throw new Error(`tipo de auditoria desconhecido: ${tipo}`)
  const quando = em ?? new Date().toISOString()
  return {
    id: id ?? `aud-${tipo}-${quando}-${Math.random().toString(36).slice(2, 8)}`,
    em: quando,
    tipo,
    lojaId: lojaId ?? null,
    ticketId: ticketId ?? null,
    fase: fase ?? null,
    jornada: jornada ?? null,
    resumo: limite(resumo, 300) ?? ROTULO_TIPO_AUDITORIA[tipo],
    situacao: SITUACOES_AUDITORIA.includes(situacao) ? situacao : 'informativo',
    dados: dados ?? {},
    chave: chave ?? `${tipo}:${quando}`,
  }
}

/**
 * Append-only: acrescenta no fim e NUNCA edita ou apaga o que já estava lá.
 * Evento com chave repetida é ignorado (idempotência de atualização e reinício).
 */
export function registrarEvento(lista, evento) {
  const atual = Array.isArray(lista) ? lista : []
  if (evento?.chave && atual.some(e => e.chave === evento.chave)) return atual
  return [...atual, evento]
}

/** Teto de eventos guardados por conversa. */
export const LIMITE_AUDITORIA = 400

/**
 * Retenção HONESTA: quando passa do teto, os eventos mais antigos saem da lista
 * — mas ficam CONTADOS e datados. Nada some em silêncio, e a interface sabe que
 * o histórico não está completo.
 */
export function aplicarRetencao(lista = [], { limite = LIMITE_AUDITORIA, anterior = null } = {}) {
  if (lista.length <= limite) {
    return {
      lista,
      retencao: anterior ? { ...anterior, primeiroDisponivelEm: lista[0]?.em ?? null } : null,
    }
  }
  const sobra = lista.length - limite
  const removidos = lista.slice(0, sobra)
  const restante = lista.slice(sobra)
  return {
    lista: restante,
    retencao: {
      omitidos: (anterior?.omitidos ?? 0) + removidos.length,
      primeiroOmitidoEm: anterior?.primeiroOmitidoEm ?? removidos[0]?.em ?? null,
      ultimoOmitidoEm: removidos.at(-1)?.em ?? anterior?.ultimoOmitidoEm ?? null,
      primeiroDisponivelEm: restante[0]?.em ?? null,
      limite,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Comprovação da resposta                                             */
/* ------------------------------------------------------------------ */

/** Os 16 itens conferidos pelo servidor, na ordem em que aparecem na tela. */
export const ITENS_CHECKLIST = [
  ['idioma', 'Idioma igual ao do cliente'],
  ['produto_informado', 'Produto informado pelo cliente'],
  ['produto_do_pedido', 'Produto pertence ao pedido'],
  ['fase_correta', 'Fase correta'],
  ['sem_pulo', 'Nenhuma fase pulada'],
  ['acao_correta', 'Ação correta'],
  ['percentual', 'Percentual correto'],
  ['valor', 'Valor em dinheiro correto'],
  ['cupom', 'Cupom correto e verificado na Shopify'],
  ['prazo', 'Prazo correto'],
  ['endereco', 'Endereço completo quando necessário'],
  ['foto', 'Foto validada quando necessário'],
  ['sem_oferta_indevida', 'Nenhuma oferta indevida'],
  ['conta_propria', 'Conta de e-mail da própria loja'],
  ['cadencia', 'Cadência respeitada'],
  ['envio_confirmado', 'Envio confirmado pelo canal'],
]

/** true → verde, false → vermelho, 'atencao' → amarelo, null → cinza. */
const cor = v => (v === true ? 'verde' : v === false ? 'vermelho' : v === 'atencao' ? 'amarelo' : 'cinza')

/**
 * Checklist da resposta. Recebe FATOS já apurados pelo servidor (nunca opinião)
 * e devolve o estado de cada item mais o resultado geral.
 */
export function checklistDaResposta(fatos = {}) {
  const f = fatos
  const itens = ITENS_CHECKLIST.map(([id, rotulo]) => ({
    id, rotulo, estado: cor(f[id]), detalhe: texto(f.detalhes?.[id]) ?? null,
  }))
  const temVermelho = itens.some(i => i.estado === 'vermelho')
  const temAmarelo = itens.some(i => i.estado === 'amarelo')
  const geral = temVermelho ? 'bloqueado' : temAmarelo ? 'revisar' : 'tudo_certo'
  return { itens, geral, enviado: f.enviado === true }
}

export const ROTULO_GERAL = {
  tudo_certo: 'Tudo certo',
  revisar: 'Revisar',
  bloqueado: 'Bloqueado — não foi enviado',
}

/* ------------------------------------------------------------------ */
/* Linha do tempo                                                      */
/* ------------------------------------------------------------------ */

const ORIGENS = { cliente: 'Cliente', ia: 'IA', manual: 'Você' }

/**
 * Mensagens da conversa em ordem cronológica, cada uma com a situação real:
 * enviada, agendada, rascunho, bloqueada ou falha. Um rascunho NUNCA aparece
 * como enviado.
 */
export function linhaDoTempo(t, { eventos = null } = {}) {
  const aud = Array.isArray(eventos) ? eventos : (t?.auditoriaIA ?? [])
  const an = t?.atendimentoNovo ?? null
  const mensagens = []

  for (const [i, m] of (t?.historico ?? []).entries()) {
    const origem = m.autor === 'cliente' ? 'cliente' : (m.origem === 'manual' ? 'manual' : 'ia')
    mensagens.push({
      chave: `hist-${i}`,
      lado: m.autor === 'cliente' ? 'esquerda' : 'direita',
      origem, rotuloOrigem: ORIGENS[origem],
      corpo: String(m.corpo ?? ''),
      em: m.data ?? null,
      idioma: m.idioma ?? (m.autor === 'cliente' ? t?.idioma ?? null : an?.rascunhoIdioma ?? null),
      fase: m.fase ?? null,
      situacao: m.autor === 'cliente' ? 'recebida' : 'enviada',
      mensagemId: m.mensagemId ?? null,
      // "enviado" só vale para o que a loja mandou: mensagem do cliente foi recebida
      minimoEnvio: null, envioReal: m.autor === 'cliente' ? null : (m.data ?? null), atrasoMs: null,
    })
  }

  // mensagem atual do cliente (só entra no histórico quando chega a próxima)
  if (texto(t?.corpo)) {
    mensagens.push({
      chave: 'atual-cliente', lado: 'esquerda', origem: 'cliente', rotuloOrigem: ORIGENS.cliente,
      corpo: String(t.corpo), em: t.data ?? null, idioma: t?.idioma ?? null, fase: null,
      situacao: 'recebida', minimoEnvio: null, envioReal: null, atrasoMs: null,
    })
  }
  // resposta atual já ENVIADA (também só vai para o histórico na próxima mensagem)
  if (texto(t?.resposta) && t?.respondidoEm) {
    const origem = t.respostaOrigem === 'manual' ? 'manual' : 'ia'
    mensagens.push({
      chave: 'atual-resposta', lado: 'direita', origem, rotuloOrigem: ORIGENS[origem],
      corpo: String(t.resposta), em: t.respondidoEm,
      idioma: t.respostaIdioma ?? an?.rascunhoIdioma ?? null,
      fase: t.respostaFase ?? an?.etapa ?? null, situacao: 'enviada',
      mensagemId: t.respostaMensagemId ?? null,
      minimoEnvio: null, envioReal: t.respondidoEm, atrasoMs: null,
    })
  }

  // rascunho ainda não enviado: agendado, bloqueado ou esperando aprovação
  if (texto(t?.rascunho)) {
    const bloqueado = !!(an?.envioBloqueado || an?.aprovacaoObrigatoria) || t?.status === 'humano'
    const agendado = !!t?.enviaEm && !bloqueado
    const minimo = an?.proximoEnvioMinimo ?? (t?.enviaEm ? new Date(t.enviaEm).toISOString() : null)
    mensagens.push({
      chave: 'rascunho',
      lado: 'direita',
      origem: t?.geradoPorIA === false ? 'manual' : 'ia',
      rotuloOrigem: ORIGENS[t?.geradoPorIA === false ? 'manual' : 'ia'],
      corpo: String(t.rascunho),
      em: null,
      idioma: an?.rascunhoIdioma ?? null,
      fase: an?.transicaoPendente?.para ?? null,
      situacao: bloqueado ? 'bloqueada' : agendado ? 'agendada' : 'rascunho',
      motivo: texto(an?.envioBloqueado) ?? texto(an?.aprovacaoObrigatoria) ?? texto(t?.motivoEscalada),
      minimoEnvio: minimo, envioReal: null, atrasoMs: null,
      naoEnviado: true,
    })
  }

  const falhas = aud.filter(e => e.tipo === 'envio_falhou')
  for (const [i, e] of falhas.entries()) {
    mensagens.push({
      chave: `falha-${i}-${e.id}`, lado: 'direita', origem: 'ia', rotuloOrigem: ORIGENS.ia,
      corpo: texto(e.dados?.texto) ?? '', em: e.em, idioma: null, fase: e.fase ?? null,
      situacao: 'falha', motivo: texto(e.dados?.erro) ?? e.resumo, naoEnviado: true,
      minimoEnvio: null, envioReal: null, atrasoMs: null,
    })
  }

  // VÍNCULO EXATO pelo Message-ID: duas respostas no mesmo minuto continuam
  // ligadas ao evento certo. Sem Message-ID (registro antigo), o vínculo por
  // horário aparece como "associação inferida" — nunca como comprovação.
  const enviados = aud.filter(e => e.tipo === 'email_enviado')
  const usados = new Set()
  for (const m of mensagens) {
    if (m.situacao !== 'enviada') continue
    let evento = null
    if (m.mensagemId) {
      evento = enviados.find(e => e.dados?.mensagemId === m.mensagemId) ?? null
      if (evento) m.vinculo = 'exato'
    }
    if (!evento && m.em) {
      evento = enviados.find(e => !usados.has(e.id) && !e.dados?.mensagemId && Math.abs(Date.parse(e.em) - Date.parse(m.em)) < 120_000)
        ?? enviados.find(e => !usados.has(e.id) && Math.abs(Date.parse(e.em) - Date.parse(m.em)) < 120_000)
      if (evento) m.vinculo = 'inferido'
    }
    if (!evento) { m.vinculo = m.vinculo ?? 'sem_evento'; continue }
    usados.add(evento.id)
    m.minimoEnvio = evento.dados?.minimoEnvio ?? null
    m.envioReal = evento.em
    m.fase = m.fase ?? evento.fase ?? null
    m.tentativaId = evento.dados?.tentativaId ?? null
    if (m.minimoEnvio) m.atrasoMs = Date.parse(evento.em) - Date.parse(m.minimoEnvio)
  }

  mensagens.sort((a, b) => {
    const ta = a.em ? Date.parse(a.em) : Number.MAX_SAFE_INTEGER
    const tb = b.em ? Date.parse(b.em) : Number.MAX_SAFE_INTEGER
    return ta - tb
  })
  return mensagens
}

/* ------------------------------------------------------------------ */
/* Tentativa atual                                                     */
/* ------------------------------------------------------------------ */

/** Eventos que pertencem a um ciclo de resposta (têm tentativaId). */
const TIPOS_DA_TENTATIVA = [
  'rascunho_gerado', 'rascunho_validado', 'rascunho_bloqueado', 'envio_agendado', 'envio_reagendado',
  'aguardando_aprovacao', 'envio_iniciado', 'email_enviado', 'envio_falhou', 'fase_confirmada',
]

/**
 * Id do CICLO mais recente. Um ciclo nasce a cada mensagem nova do cliente e
 * cobre tudo o que aconteceu por causa dela: classificação, decisão, aceite,
 * recusa, escalada, rascunho, validação, bloqueio, agendamento, envio e
 * encerramento. Registro antigo sem cicloId devolve null (e aí a conversa
 * inteira conta como um ciclo só).
 */
export function cicloAtual(eventos = []) {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const id = eventos[i]?.dados?.cicloId
    if (id) return id
  }
  return null
}

/** Eventos do ciclo atual (ou todos, quando nenhum evento tem ciclo). */
export function eventosDoCiclo(eventos = [], cicloId = null) {
  const alvo = cicloId ?? cicloAtual(eventos)
  if (!alvo) return [...eventos]
  return eventos.filter(e => (e?.dados?.cicloId ?? null) === alvo)
}

/**
 * Id da tentativa MAIS RECENTE, sempre DENTRO do ciclo atual. Um bloqueio antigo
 * não pode marcar a conversa para sempre, e uma tentativa verde de um ciclo
 * anterior não pode responder por uma mensagem nova ainda sem resposta.
 */
export function tentativaAtual(eventos = []) {
  const doCiclo = eventosDoCiclo(eventos)
  for (let i = doCiclo.length - 1; i >= 0; i--) {
    const id = doCiclo[i]?.dados?.tentativaId
    if (id) return id
  }
  return null
}

/** Eventos da tentativa atual, dentro do ciclo atual. */
export function eventosDaTentativa(eventos = [], tentativaId = null) {
  const doCiclo = eventosDoCiclo(eventos)
  const alvo = tentativaId ?? tentativaAtual(eventos)
  if (!alvo) return doCiclo.filter(e => TIPOS_DA_TENTATIVA.includes(e.tipo))
  return doCiclo.filter(e => e?.dados?.tentativaId === alvo)
}

/** Prova completa de que a mensagem saiu mesmo, gravada no próprio evento. */
function envioProvado(evento) {
  const d = evento?.dados ?? {}
  return d.enviado === true && d.canalConfirmou === true && !!d.mensagemId && !!d.checklist
}

/**
 * Situação da conversa pelo CICLO ATUAL — a mensagem mais recente do cliente.
 * A decisão é tomada pela POSIÇÃO append-only (dois eventos podem cair no mesmo
 * milissegundo): vale o último evento decisivo do ciclo. "Tudo certo" só sai de
 * um email_enviado comprovado (enviado + canal confirmou + Message-ID +
 * checklist final) da tentativa atual deste ciclo — nunca de um ciclo anterior.
 */
export function seloDaConversa(eventos = []) {
  if (!eventos.length) return 'sem_dados'
  const doCiclo = eventosDoCiclo(eventos)
  if (!doCiclo.length) return 'sem_dados'
  const daVez = eventosDaTentativa(eventos)
  const naTentativa = new Set(daVez)
  // o encerramento só decide quando NADA foi enviado no ciclo (a confirmação
  // enviada também encerra o caso, e aí quem manda é o envio)
  const enviouNoCiclo = doCiclo.some(e => e.tipo === 'email_enviado')

  for (let i = doCiclo.length - 1; i >= 0; i--) {
    const e = doCiclo[i]
    switch (e.tipo) {
      case 'email_enviado': {
        if (!naTentativa.has(e)) break
        // envio comprovado de um registro ANTIGO, sem a fotografia do checklist:
        // a prova do canal vale, o checklist não é inventado como verde
        if (e.dados?.checklistHistoricoAusente === true && e.dados.enviado === true
          && e.dados.canalConfirmou === true && !!e.dados.mensagemId) return 'revisar_historico'
        if (!envioProvado(e)) return 'revisar'
        // a mensagem SAIU: checklist com pendência pede revisão, mas nunca pode
        // virar "Bloqueada — não foi enviada", que seria mentira sobre o envio
        return e.dados.checklist.geral !== 'tudo_certo' ? 'revisar' : 'tudo_certo'
      }
      case 'envio_falhou':
      case 'rascunho_bloqueado':
        if (!naTentativa.has(e)) break
        return 'bloqueado'
      case 'caso_para_humano':
        // classificação que falhou é erro da IA: vai para "Revisar", com o motivo.
        // IA pausada ou decisão do motor é uma espera legítima por você.
        return e.dados?.origem === 'classificacao' ? 'revisar' : 'aguardando_voce'
      case 'caso_encerrado':
        if (enviouNoCiclo) break
        return 'encerrado'
      case 'aguardando_aprovacao':
      case 'envio_agendado': {
        if (!naTentativa.has(e)) break
        // um checklist com pendência não some porque o rascunho foi agendado ou
        // mandado para aprovação: o que precisa de revisão continua em revisão
        const validado = [...daVez].reverse().find(x => x.tipo === 'rascunho_validado')
        const geralV = validado?.dados?.checklist?.geral ?? null
        if (geralV === 'bloqueado') return 'bloqueado'
        if (geralV === 'revisar') return 'revisar'
        return e.tipo === 'envio_agendado' ? 'agendada' : 'aguardando'
      }
      case 'rascunho_validado': {
        if (!naTentativa.has(e)) break
        const geral = e.dados?.checklist?.geral ?? null
        if (geral === 'bloqueado') return 'bloqueado'
        if (geral === 'revisar') return 'revisar'
        return 'aguardando'
      }
      default:
        break
    }
  }
  return 'sem_dados'
}

/**
 * Checklist da TENTATIVA ATUAL do CICLO ATUAL — nunca o de uma tentativa ou de
 * um ciclo anterior. Quando a tentativa atual parou antes de gerar o checklist
 * completo, devolve o motivo atual e avisa que o checklist não foi concluído.
 */
export function checklistDaTentativa(eventos = []) {
  const daVez = eventosDaTentativa(eventos)
  const comChecklist = [...daVez].reverse().find(e => e.dados?.checklist?.itens?.length)
  if (comChecklist) {
    return {
      checklist: comChecklist.dados.checklist,
      concluido: true,
      motivo: null,
      tentativaId: comChecklist.dados?.tentativaId ?? null,
      em: comChecklist.em,
    }
  }
  // envio antigo comprovado, sem fotografia do checklist: diz isso em vez de
  // deixar a impressão de que nada foi verificado
  const antigo = [...daVez].reverse().find(e => e.tipo === 'email_enviado' && e.dados?.checklistHistoricoAusente === true)
  if (antigo) {
    return {
      checklist: null,
      concluido: false,
      motivo: 'Envio confirmado pelo Message-ID, mas o checklist daquela tentativa não foi guardado (registro anterior à fotografia do envio).',
      tentativaId: antigo.dados?.tentativaId ?? null,
      em: antigo.em,
    }
  }
  const doCiclo = eventosDoCiclo(eventos)
  const parou = [...doCiclo].reverse().find(e => ['rascunho_bloqueado', 'envio_falhou', 'caso_para_humano', 'caso_encerrado'].includes(e.tipo))
  return {
    checklist: null,
    concluido: false,
    motivo: parou ? (parou.dados?.motivo ?? parou.resumo) : null,
    tentativaId: parou?.dados?.tentativaId ?? tentativaAtual(eventos),
    em: parou?.em ?? null,
  }
}

export const ROTULO_SELO = {
  tudo_certo: 'Tudo certo — enviada e confirmada',
  revisar: 'Revisar',
  aguardando: 'Resposta validada — aguardando aprovação',
  agendada: 'Agendada — ainda não enviada',
  bloqueado: 'Bloqueada — não foi enviada',
  revisar_historico: 'Revisar — envio confirmado, checklist histórico indisponível',
  aguardando_voce: 'Aguardando você',
  encerrado: 'Encerrado — sem resposta necessária',
  sem_dados: 'Sem registro',
}
/** Rótulo curto para a lista lateral. */
export const ROTULO_SELO_CURTO = {
  tudo_certo: 'Tudo certo', revisar: 'Revisar', aguardando: 'Aguardando',
  agendada: 'Agendada', bloqueado: 'Bloqueado', revisar_historico: 'Revisar (histórico)',
  aguardando_voce: 'Aguardando você',
  encerrado: 'Encerrado', sem_dados: 'Sem registro',
}

/** "IA classificou → servidor escolheu a fase → resposta validada → agendada → enviada." */
export function passosCompactos(eventos = []) {
  const daVez = eventosDaTentativa(eventos)
  // a classificação e a decisão são do CICLO atual, mesmo sem tentativaId
  const antes = eventosDoCiclo(eventos).filter(e => ['ia_classificou', 'motor_decidiu'].includes(e.tipo))
  const lista = [...antes, ...daVez]
  const ordem = ['ia_classificou', 'motor_decidiu', 'rascunho_validado', 'envio_agendado', 'email_enviado']
  const nomes = {
    ia_classificou: 'IA classificou', motor_decidiu: 'servidor escolheu a fase',
    rascunho_validado: 'resposta validada', envio_agendado: 'agendada', email_enviado: 'enviada',
  }
  const houve = ordem.filter(tipo => lista.some(e => e.tipo === tipo))
  const passos = houve.map(t2 => nomes[t2])
  const selo = seloDaConversa(eventos)
  if (selo === 'bloqueado') passos.push('bloqueada — não foi enviada')
  else if (selo === 'revisar_historico') passos.push('checklist histórico indisponível')
  else if (selo === 'aguardando_voce') passos.push('aguardando você')
  else if (selo === 'encerrado') passos.push('encerrado — sem resposta necessária')
  else if (selo === 'aguardando' && !passos.includes('agendada')) passos.push('aguardando sua aprovação')
  return passos.join(' → ')
}

/**
 * Como a última mensagem realmente saiu, pela EVIDÊNCIA gravada no envio:
 * 'automatico' (saiu sozinha), 'aprovado_pelo_dono' (o dono liberou o aceite) ou
 * 'manual' (você escreveu). Mudar a configuração da loja hoje não reescreve o
 * passado — e desligar a automação não apaga a origem dos envios anteriores.
 */
export function origemDoEnvio(eventos = []) {
  const enviados = eventos.filter(e => e.tipo === 'email_enviado')
  const ultimo = enviados.at(-1)
  return ultimo?.dados?.origemEnvio ?? null
}

export const ROTULO_ORIGEM_ENVIO = {
  automatico: 'enviada automaticamente',
  aprovado_pelo_dono: 'enviada depois da sua aprovação',
  manual: 'escrita e enviada por você',
}

/** Filtros da página (validados; o resto cai no padrão). */
export function filtrosDaAuditoria(q = {}) {
  const dias = [7, 30, 90].includes(Number(q.dias)) ? Number(q.dias) : 7
  return {
    busca: String(q.busca ?? '').slice(0, 80),
    loja: String(q.loja ?? 'todas'),
    dias,
    jornada: String(q.jornada ?? 'todas'),
    fase: String(q.fase ?? 'todas'),
    idioma: String(q.idioma ?? 'todos'),
    situacao: ['tudo_certo', 'revisar', 'revisar_historico', 'aguardando', 'agendada', 'bloqueado', 'aguardando_voce', 'encerrado'].includes(String(q.situacao)) ? String(q.situacao) : 'todas',
    soErro: q.soErro === true || q.soErro === 'true' || q.soErro === '1',
    soAprovacao: q.soAprovacao === true || q.soAprovacao === 'true' || q.soAprovacao === '1',
    soAutomaticos: q.soAutomaticos === true || q.soAutomaticos === 'true' || q.soAutomaticos === '1',
    classico: q.classico === true || q.classico === 'true' || q.classico === '1',
    pagina: Math.max(1, Number(q.pagina) || 1),
    porPagina: Math.min(50, Math.max(5, Number(q.porPagina) || 20)),
  }
}

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Aplica os filtros a uma lista de resumos já montada pelo servidor. */
export function filtrarConversas(lista, f) {
  const q = norm(f.busca.trim())
  return lista.filter(c =>
    (!q || norm([c.cliente, c.email, c.pedido, c.assunto].filter(Boolean).join(' ')).includes(q))
    && (f.loja === 'todas' || c.lojaId === f.loja)
    && (f.jornada === 'todas' || c.jornada === f.jornada)
    && (f.fase === 'todas' || c.fase === f.fase)
    && (f.idioma === 'todos' || c.idioma === f.idioma)
    && (f.situacao === 'todas' || c.selo === f.situacao)
    // "somente com erro" tem de mostrar TUDO o que pede revisão — inclusive o
    // envio comprovado cujo checklist histórico não existe
    && (!f.soErro || ['bloqueado', 'revisar', 'revisar_historico'].includes(c.selo))
    && (!f.soAprovacao || c.aguardandoAprovacao === true)
    && (!f.soAutomaticos || c.origemEnvio === 'automatico')
    && (f.classico ? true : c.motor === 'novo'))
}
