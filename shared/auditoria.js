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
  'respondido_manualmente', 'fase_confirmada', 'caso_encerrado',
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
      minimoEnvio: null, envioReal: m.data ?? null, atrasoMs: null,
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
      corpo: String(t.resposta), em: t.respondidoEm, idioma: an?.rascunhoIdioma ?? null,
      fase: an?.etapa ?? null, situacao: 'enviada', minimoEnvio: null, envioReal: t.respondidoEm, atrasoMs: null,
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

  // horários: mínimo permitido × real, e a diferença
  const enviados = aud.filter(e => e.tipo === 'email_enviado')
  for (const m of mensagens) {
    if (m.situacao !== 'enviada' || !m.em) continue
    const perto = enviados.find(e => Math.abs(Date.parse(e.em) - Date.parse(m.em)) < 120_000)
    if (!perto) continue
    m.minimoEnvio = perto.dados?.minimoEnvio ?? null
    m.envioReal = perto.em
    m.fase = m.fase ?? perto.fase ?? null
    if (m.minimoEnvio) m.atrasoMs = Date.parse(perto.em) - Date.parse(m.minimoEnvio)
  }

  mensagens.sort((a, b) => {
    const ta = a.em ? Date.parse(a.em) : Number.MAX_SAFE_INTEGER
    const tb = b.em ? Date.parse(b.em) : Number.MAX_SAFE_INTEGER
    return ta - tb
  })
  return mensagens
}

/** "IA classificou → servidor escolheu a fase → resposta validada → agendada → enviada." */
export function passosCompactos(eventos = []) {
  const ordem = ['ia_classificou', 'motor_decidiu', 'rascunho_validado', 'envio_agendado', 'email_enviado']
  const nomes = {
    ia_classificou: 'IA classificou', motor_decidiu: 'servidor escolheu a fase',
    rascunho_validado: 'resposta validada', envio_agendado: 'agendada', email_enviado: 'enviada',
  }
  const houve = ordem.filter(tipo => eventos.some(e => e.tipo === tipo))
  const bloqueado = eventos.some(e => e.tipo === 'rascunho_bloqueado')
  if (bloqueado) return [...houve.map(t2 => nomes[t2]), 'bloqueada — não foi enviada'].join(' → ')
  return houve.map(t2 => nomes[t2]).join(' → ')
}

/* ------------------------------------------------------------------ */
/* Lista de conversas e filtros                                        */
/* ------------------------------------------------------------------ */

/** Selo da conversa a partir do último checklist registrado. */
export function seloDaConversa(eventos = []) {
  const ultimo = [...eventos].reverse().find(e => e.dados?.checklist)
  if (eventos.some(e => e.tipo === 'rascunho_bloqueado')) return 'bloqueado'
  if (!ultimo) return 'sem_dados'
  return ultimo.dados.checklist.geral ?? 'sem_dados'
}

export const ROTULO_SELO = { tudo_certo: 'Tudo certo', revisar: 'Revisar', bloqueado: 'Bloqueado', sem_dados: 'Sem registro' }

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
    situacao: ['tudo_certo', 'revisar', 'bloqueado'].includes(String(q.situacao)) ? String(q.situacao) : 'todas',
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
    && (!f.soErro || c.selo === 'bloqueado' || c.selo === 'revisar')
    && (!f.soAprovacao || c.aguardandoAprovacao === true)
    && (!f.soAutomaticos || c.envioAutomatico === true)
    && (f.classico ? true : c.motor === 'novo'))
}
