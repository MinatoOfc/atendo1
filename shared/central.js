/**
 * Central operacional — cálculo ÚNICO, puro e sem interface.
 *
 * Usado pelo servidor (GET /api/central) e pela página (src/pages/Central.tsx)
 * a partir dos mesmos dados: conversas, pedidos, lojas e o catálogo de fases.
 * A tela nunca é a única dona da verdade: os números saem daqui.
 *
 * Regras (revisão da Parte 7):
 *  - "Todos os pedidos" é a junção pedido × caso: pedido sem conversa aparece
 *    como "sem atendimento" / "sem fase".
 *  - Métricas de fase contam UMA vez por pedido + fase (vários tickets, mensagens
 *    repetidas ou conversas fundidas não duplicam).
 *  - Só fase efetivamente ENVIADA (historicoEtapas sem evento) entra em passaram /
 *    pararam / avançaram. transicaoPendente, fase inferida e correção manual não
 *    contam — aparecem na tabela e em contadores separados (inferidos / manuais).
 *  - Valores nunca somam moedas diferentes: por moeda em cada fase e indicador.
 *  - "Cenário hipotético sem retenção" é hipótese (todos com 100%), não histórico.
 *  - Indicadores refletem EXATAMENTE as linhas visíveis depois de todos os filtros.
 *  - "Reembolsado de fato" só depois da confirmação realmente enviada (fase de
 *    confirmação em historicoEtapas) ou do reembolso marcado como processado no
 *    relatório; aceite aguardando o dono é "aceite pendente".
 *  - Casos históricos (Parte 8): a IA infere jornada, fase, desfecho, motivo e
 *    produtos dos tickets antigos e grava em ticket.inferenciaCentral — um campo
 *    só da Central, que nunca altera status, categoria, motor ou relatório. A
 *    linha do relatório manual tem prioridade sobre a inferência; reembolso só
 *    inferido é "inferido", nunca "efetivado".
 */

import { produtoFoiInformado } from './produto.js'

export const DESFECHOS = ['em_aberto', 'reembolso', 'troca', 'reenvio', 'cupom', 'cancelamento', 'encerrado']
const CATEGORIAS_MOTIVO = ['qualidade', 'tamanho', 'defeito', 'nao_recebeu', 'atraso', 'errado', 'nao_gostou', 'alergia', 'arrependimento', 'outro', 'nao_informado']

/**
 * Fases que a IA pode inferir para um caso antigo — lista explícita, usada no
 * schema da IA, na normalização e nos testes. Confirmações (conf_*) nunca:
 * elas só existem depois de o dono aprovar um aceite no motor.
 */
export const FASES_MIGRAVEIS = [
  'coleta', 'tam_ajuste', 'tam_troca', 'troca_20', 'err_envio', 'def_foto', 'def_troca', 'qual_troca', 'qual_cupom_35',
  'reemb_25', 'reemb_40', 'reemb_50', 'reemb_60', 'reemb_70', 'reemb_100',
  'nc_no_prazo', 'nc_atrasado_25', 'nc_cupom_40', 'nr_reenvio_30', 'nr_entregue_aguardar', 'nr_reenvio_20', 'nr_reenvio_35',
  'cancel_nao_processado', 'endereco',
]

/** O ticket tem relatório manual (fonte humana)? */
export const temRelatorio = t => !!(t?.relatorioDia || t?.relatorioLinha || t?.relatorioTexto)

/**
 * Caso ANTIGO SEM RELATÓRIO do modo clássico: o único tipo que a migração lê.
 * Qualquer ticket com estado do motor (atendimentoNovo, mesmo ainda em coleta,
 * com fluxo null) fica fora; quem já tem relatório manual também — o relatório
 * é a fonte humana e não precisa de IA.
 */
export function ehCandidatoMigracao(t) {
  if (!t || t.status === 'spam' || t.status === 'lixeira') return false
  if (t.atendimentoNovo) return false
  if (temRelatorio(t)) return false
  return ['reembolso', 'troca', 'entrega'].includes(t.categoria) || !!t.motivoReembolso
}

/** Quantos casos históricos existem, quantos já têm inferência e quantos faltam. */
export function statusMigracao(tickets) {
  const candidatos = tickets.filter(ehCandidatoMigracao)
  const inferidos = candidatos.filter(t => t.inferenciaCentral)
  return { candidatos: candidatos.length, inferidos: inferidos.length, pendentes: candidatos.length - inferidos.length }
}

/** Valida o que a IA devolveu para um caso; devolve null se não houver nada aproveitável. */
export function normalizarInferencia(bruto, fases) {
  if (!bruto || typeof bruto !== 'object') return null
  const jornada = ORDEM_JORNADAS.includes(bruto.jornada) ? bruto.jornada : 'entrada'
  // só fase da lista explícita, existente no catálogo e sem ser confirmação
  const fase = bruto.fase && FASES_MIGRAVEIS.includes(bruto.fase) && fases[bruto.fase] && !fases[bruto.fase].confirmacao ? bruto.fase : null
  const desfecho = DESFECHOS.includes(bruto.desfecho) ? bruto.desfecho : 'em_aberto'
  let percentual = Number(bruto.percentual)
  percentual = Number.isFinite(percentual) && percentual > 0 && percentual <= 100 ? Math.round(percentual) : null
  if (!['reembolso', 'troca', 'reenvio', 'cancelamento'].includes(desfecho)) percentual = null
  if (desfecho === 'cancelamento') percentual = 100
  const motivo = String(bruto.motivo ?? '').trim().slice(0, 80) || null
  const categoria = CATEGORIAS_MOTIVO.includes(bruto.categoria) ? bruto.categoria : (motivo ? 'outro' : 'nao_informado')
  const produtos = (Array.isArray(bruto.produtos) ? bruto.produtos : []).map(p => String(p).trim()).filter(Boolean).slice(0, 5)
  let confianca = Number(bruto.confianca)
  confianca = Number.isFinite(confianca) ? Math.min(1, Math.max(0, confianca)) : 0.5
  return { jornada, fase, desfecho, percentual, motivo, categoria, produtos, confianca }
}

export const ORDEM_JORNADAS = ['entrada', 'tamanho', 'qualidade', 'defeito_errado', 'nao_recebido', 'cancelamento']

export const JORNADA_DO_FLUXO = {
  tamanho: 'tamanho', errado: 'defeito_errado', defeito: 'defeito_errado', qualidade: 'qualidade',
  nao_recebido_status: 'nao_recebido', nao_recebido_reembolso: 'nao_recebido', entregue_nao_recebido: 'nao_recebido',
  cancelamento: 'cancelamento',
}
const JORNADA_DA_CATEGORIA_MOTIVO = {
  qualidade: 'qualidade', nao_gostou: 'qualidade', tamanho: 'tamanho', defeito: 'defeito_errado', errado: 'defeito_errado',
  nao_recebeu: 'nao_recebido', atraso: 'nao_recebido', arrependimento: 'cancelamento',
}
export const NOME_MOTIVO = {
  tamanho: 'tamanho não serviu', qualidade: 'qualidade/material', nao_gostou: 'não gostou', defeito: 'defeito',
  errado: 'produto errado', nao_recebido: 'não recebido', nao_informado: 'não informou',
}

export const FILTROS_PADRAO = { busca: '', lojaId: 'todas', periodo: 'todas', desfecho: 'todos', jornada: 'todas', fase: 'todas' }

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const ativo = t => t.status !== 'spam' && t.status !== 'lixeira'

/** Pedido de uma conversa: número citado na mesma loja, senão o mais recente pelo e-mail. */
export function pedidoDaConversa(t, pedidos) {
  const lojaId = t.lojaId ?? 'loja1'
  const texto = [t.assunto, t.corpo, t.resposta, ...((t.historico ?? []).map(m => m.corpo))].join('\n').toLowerCase()
  const numeros = new Set()
  for (const m of texto.matchAll(/(?:#\s?|\b(?:pedido|encomenda|order|bestell(?:ung|ing)?|bestelling|commande|ordine)\s*(?:nr\.?|n[º°o]\.?|#)?\s*)(\d{3,7})\b/g)) numeros.add(m[1])
  const daLoja = pedidos.filter(p => (p.lojaId ?? 'loja1') === lojaId)
  if (numeros.size) {
    const porNumero = daLoja.find(p => numeros.has(String(p.numero ?? '').replace(/\D/g, '')))
    if (porNumero) return porNumero
  }
  const email = String(t.de ?? '').trim().toLowerCase()
  return daLoja.filter(p => p.email && p.email.trim().toLowerCase() === email)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0] ?? null
}

function desfechoDaOferta(o) {
  if (!o) return { desfecho: 'em_aberto', percentual: null }
  if (o.tipo === 'reembolso') return { desfecho: 'reembolso', percentual: o.pct }
  if (o.tipo === 'cancelamento') return { desfecho: 'cancelamento', percentual: 100 }
  if (o.tipo === 'troca' || o.tipo === 'troca_reembolso') return { desfecho: 'troca', percentual: o.pct }
  if (o.tipo === 'reenvio' || o.tipo === 'reenvio_reembolso') return { desfecho: 'reenvio', percentual: o.pct }
  if (o.tipo === 'cupom') return { desfecho: 'cupom', percentual: null }
  return { desfecho: 'em_aberto', percentual: null }
}

const produtoDoPedido = p => p?.itens?.[0]
  ? `${p.itens[0].titulo}${p.itens[0].variante ? ` (${p.itens[0].variante})` : ''}${p.itens.length > 1 ? ` +${p.itens.length - 1}` : ''}`
  : null

/**
 * Monta os casos (uma conversa ligada a devolução/reembolso/entrega = um caso).
 *  trilha        SÓ fases enviadas (historicoEtapas sem evento) — base das métricas
 *  faseInferida  dedução do clássico (relatório manual + motivo lido)
 *  faseManual    correção do dono na Central (t.centralAjuste)
 *  faseAtual     o que a tabela mostra: manual > confirmada > inferida
 */
export function montarCasos(tickets, pedidos, lojas, fases) {
  const casos = []
  for (const t of tickets) {
    if (!ativo(t)) continue
    const an = t.atendimentoNovo
    const linha = t.relatorioLinha || t.relatorioTexto || t.resolucao || ''
    const inf = !an?.fluxo && t.inferenciaCentral ? t.inferenciaCentral : null
    const ehCasoClassico = !!t.relatorioDia || t.categoria === 'reembolso' || t.categoria === 'troca' || t.categoria === 'entrega' || !!t.motivoReembolso || !!inf
    if (!an?.fluxo && !ehCasoClassico) continue

    const loja = lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
    const pedido = pedidoDaConversa(t, pedidos)

    let jornada = 'entrada'
    let trilha = []
    let faseConfirmada = null
    let faseInferida = null
    let origem = 'inferida'
    let desfecho = 'em_aberto'
    let percentual = null
    let motivo = null
    let produto = null
    let comVoce = false
    let acaoPendente = null
    let escalouAoDono = false
    let situacaoReembolso = null // 'efetivado' | 'aceite_pendente' | 'registrado' | 'inferido' | null
    let confirmacaoEnviada = null
    let inferidaPor = null // 'relatorio' | 'ia' | null
    let motivoCategoria = 'nao_informado' // categoria FECHADA (a página externa só mostra isto, nunca o texto)
    const fluxo = an?.fluxo ?? null
    const subfluxo = an?.subfluxo ?? null

    if (an?.fluxo) {
      origem = 'confirmada'
      jornada = JORNADA_DO_FLUXO[an.fluxo] ?? 'entrada'
      faseConfirmada = an.etapa ?? null
      // só o que saiu de verdade; a mesma fase repetida (cliente só informou algo) conta uma vez.
      // A fase de confirmação (enviada só depois da aprovação do dono) fica à parte:
      // é a prova de que o reembolso/troca foi efetivado.
      const enviadas = (an.historicoEtapas ?? []).filter(h => !h.evento && h.para && fases[h.para]).map(h => h.para)
        .filter((id, i, arr) => arr.indexOf(id) === i)
      trilha = enviadas.filter(id => !fases[id].confirmacao)
      confirmacaoEnviada = enviadas.find(id => fases[id].confirmacao) ?? null
      motivo = an.motivo ? NOME_MOTIVO[an.motivo] ?? an.motivo : null
      const ajustes = Object.values(an.ajusteTamanho ?? {})
      motivoCategoria = an.motivo === 'tamanho' && ajustes.length && ajustes.every(a => a === 'pequeno') ? 'tamanho_pequeno'
        : an.motivo === 'tamanho' && ajustes.length && ajustes.every(a => a === 'grande') ? 'tamanho_grande'
          : NOME_MOTIVO[an.motivo] ? an.motivo : 'nao_informado'
      produto = an.produtosAfetados?.length ? an.produtosAfetados.join('; ') : null
      comVoce = an.aguardando === 'humano'
      const cpC = an.conclusaoPendente && !['cancelada', 'recusada'].includes(an.conclusaoPendente.status) ? an.conclusaoPendente : null
      if (an.acaoAceita || cpC) {
        const faseAceitaC = an.acaoAceita ?? cpC.faseAceita
        const d = desfechoDaOferta(fases[faseAceitaC]?.oferta ?? null); desfecho = d.desfecho; percentual = d.percentual
        acaoPendente = comVoce ? faseAceitaC : (cpC && cpC.status !== 'concluida' ? faseAceitaC : null)
        escalouAoDono = comVoce && !!fases[an.acaoAceita]?.decisaoDono
        if (percentual != null) situacaoReembolso = (confirmacaoEnviada || t.relatorioProcessado) ? 'efetivado' : 'aceite_pendente'
      } else if (t.status === 'enviado' && /^Encerrada/.test(t.resolucao ?? '')) desfecho = 'encerrado'
    } else {
      // 1) o que o dono registrou (relatório manual + motivo lido) tem prioridade
      const cat = t.motivoReembolso?.categoria ?? inf?.categoria
      motivoCategoria = typeof cat === 'string' && /^[a-z_]+$/.test(cat) ? cat : 'nao_informado'
      jornada = (cat && JORNADA_DA_CATEGORIA_MOTIVO[cat]) || inf?.jornada || 'entrada'
      motivo = t.motivoReembolso?.motivo ?? inf?.motivo ?? null
      const pct = linha.match(/(\d{1,3})\s*%/)
      if (/reembols|refund|estorno/i.test(linha)) { desfecho = 'reembolso'; percentual = pct ? Number(pct[1]) : null }
      else if (/reenvio|resend/i.test(linha)) desfecho = 'reenvio'
      else if (/troca|exchange|umtausch/i.test(linha)) desfecho = 'troca'
      else if (/cancel/i.test(linha)) { desfecho = 'cancelamento'; percentual = 100 }
      else if (t.status === 'enviado' && t.relatorioDia) desfecho = 'encerrado'
      comVoce = t.status === 'humano'
      const doRelatorio = desfecho !== 'em_aberto'
      // clássico: a linha do relatório é registro; efetivado só quando o dono marcou "processado"
      if (doRelatorio && (desfecho === 'reembolso' || desfecho === 'cancelamento') && percentual != null) situacaoReembolso = t.relatorioProcessado ? 'efetivado' : 'registrado'
      // fase final deduzida do desfecho — o clássico não percorreu a escada (nada entra em trilha)
      if (desfecho === 'reembolso') faseInferida = percentual === 100 ? 'reemb_100' : percentual && fases[`reemb_${percentual}`] ? `reemb_${percentual}` : 'reemb_100'
      else if (desfecho === 'troca') faseInferida = jornada === 'tamanho' ? 'tam_troca' : jornada === 'defeito_errado' ? 'def_troca' : 'qual_troca'
      else if (desfecho === 'reenvio') faseInferida = 'nr_reenvio_30'
      else if (desfecho === 'cancelamento') faseInferida = 'cancel_nao_processado'
      if (doRelatorio || t.relatorioDia) inferidaPor = 'relatorio'
      // 2) sem registro do dono: a inferência da IA (Parte 8) — desfecho, percentual e fase
      const faseInf = inf?.fase && FASES_MIGRAVEIS.includes(inf.fase) && fases[inf.fase] && !fases[inf.fase].confirmacao ? inf.fase : null
      if (!doRelatorio && inf) {
        inferidaPor = 'ia'
        desfecho = inf.desfecho ?? 'em_aberto'
        percentual = inf.percentual ?? null
        faseInferida = faseInf
        if (['reembolso', 'cancelamento'].includes(desfecho) && percentual != null) situacaoReembolso = t.relatorioProcessado ? 'efetivado' : 'inferido'
      } else if (inf && !faseInferida) faseInferida = faseInf
      if (!produto && inf?.produtos?.length) produto = inf.produtos.join('; ')
    }

    let faseManual = null
    let temManual = false
    if (t.centralAjuste) {
      origem = 'manual'; temManual = true
      if (t.centralAjuste.jornada) jornada = t.centralAjuste.jornada
      faseManual = t.centralAjuste.fase ?? null
    }
    const faseAtual = temManual ? faseManual : (faseConfirmada ?? faseInferida)
    const titulo = id => (id ? fases[id]?.titulo ?? id : null)

    if (!produto) produto = produtoDoPedido(pedido)
    const valor = pedido?.valor ?? null
    const concluido = desfecho !== 'em_aberto'
    const reembolsado = valor != null && percentual != null && ['reembolso', 'troca', 'reenvio', 'cancelamento'].includes(desfecho) ? Math.round(valor * percentual) / 100 : null
    casos.push({
      ticketId: t.id, pedidoId: pedido?.id ?? null,
      lojaId: t.lojaId ?? 'loja1', lojaNome: loja?.nome ?? (t.lojaId ?? 'loja1'), moeda: loja?.moeda ?? 'EUR',
      cliente: t.nome || t.de,
      pedidoNumero: pedido ? String(pedido.numero).replace('#', '') : null, pedidoValor: valor,
      produto, produtoIdentificado: produtoFoiInformado(an), // regra única (shared/produto.js): só com a marca do cliente
      motivo, jornada,
      faseAtual, faseTitulo: titulo(faseAtual) ?? (origem === 'confirmada' ? 'Triagem' : 'sem fase'),
      faseConfirmada, faseInferida, faseManual, origem, trilha,
      pendente: an?.transicaoPendente?.para ?? null,
      desfecho, percentual, reembolsado, concluido, comVoce, acaoPendente, escalouAoDono,
      situacaoReembolso, confirmacaoEnviada, inferidaPor, inferencia: inf, motivoCategoria, fluxo, subfluxo,
      conclusao: an?.conclusaoPendente ? { modo: an.conclusaoPendente.modo, status: an.conclusaoPendente.status, faseAceita: an.conclusaoPendente.faseAceita } : null,
      dataMs: new Date(pedido?.criadoEm ? pedido.criadoEm + 'T12:00:00' : t.data).getTime(),
      ajuste: t.centralAjuste ?? null,
      historicoAjustes: t.centralHistorico ?? [],
    })
  }
  return casos
}

/**
 * Um registro por pedido (ou por conversa sem pedido). Vários tickets do mesmo
 * pedido viram UM registro: o principal é o de trilha mais longa (empate: o mais
 * recente); as fases dos outros entram na união só como "passaram / deixaram".
 */
export function consolidarPorPedido(casos) {
  const grupos = new Map()
  for (const c of casos) {
    const chave = c.pedidoId ? `p:${c.pedidoId}` : `t:${c.ticketId}`
    if (!grupos.has(chave)) grupos.set(chave, [])
    grupos.get(chave).push(c)
  }
  const registros = []
  for (const [chave, lista] of grupos) {
    const ordenada = [...lista].sort((a, b) => (b.trilha.length - a.trilha.length) || (b.dataMs - a.dataMs))
    const principal = ordenada[0]
    const uniao = [...principal.trilha]
    for (const c of ordenada.slice(1)) for (const id of c.trilha) if (!uniao.includes(id)) uniao.push(id)
    registros.push({
      ...principal, chave,
      tickets: ordenada.map(c => c.ticketId),
      trilhaUniao: uniao,
      comVoce: ordenada.some(c => c.comVoce),
    })
  }
  return registros.sort((a, b) => b.dataMs - a.dataMs)
}

/** Relação de um registro com uma fase enviada: pararam / avançaram / em aberto. */
export function relacaoComFase(r, faseId) {
  const i = r.trilha.indexOf(faseId)
  if (i < 0) return r.trilhaUniao?.includes(faseId) ? 'avancaram' : null
  if (i < r.trilha.length - 1) return 'avancaram'
  if (r.escalouAoDono) return 'avancaram' // recusou tudo: o 100%/cancelamento está com o dono
  return r.concluido ? 'pararam' : 'em_aberto'
}

/** Métricas por fase — só fases ENVIADAS; um pedido conta uma vez por fase; valor por moeda. */
export function metricasPorFase(registros, fases) {
  const m = {}
  for (const id of Object.keys(fases)) m[id] = { id, passaram: 0, pararam: 0, avancaram: 0, emAberto: 0, valorPorMoeda: {}, inferidos: 0, manuais: 0 }
  for (const r of registros) {
    for (const id of r.trilhaUniao ?? r.trilha) {
      if (!m[id]) continue
      m[id].passaram++
      m[id].valorPorMoeda[r.moeda] = Math.round(((m[id].valorPorMoeda[r.moeda] ?? 0) + (r.pedidoValor ?? 0)) * 100) / 100
      const rel = relacaoComFase(r, id)
      if (rel === 'avancaram') m[id].avancaram++
      else if (rel === 'pararam') m[id].pararam++
      else if (rel === 'em_aberto') m[id].emAberto++
    }
    if (r.confirmacaoEnviada && m[r.confirmacaoEnviada]) {
      const c = m[r.confirmacaoEnviada]
      c.passaram++; c.pararam++
      c.valorPorMoeda[r.moeda] = Math.round(((c.valorPorMoeda[r.moeda] ?? 0) + (r.pedidoValor ?? 0)) * 100) / 100
    }
    // classificações não confirmadas: aparecem separadas, nunca em passaram
    if (r.origem === 'manual' && r.faseManual && m[r.faseManual]) m[r.faseManual].manuais++
    else if (r.origem === 'inferida' && r.faseInferida && m[r.faseInferida]) m[r.faseInferida].inferidos++
  }
  return m
}

const dataDoPedidoMs = p => new Date((p.criadoEm ?? '1970-01-01') + 'T12:00:00').getTime()

export function filtrarPedidos(pedidos, f, agora = Date.now()) {
  const corte = f.periodo === 'todas' ? 0 : agora - Number(f.periodo) * 864e5
  return pedidos.filter(p => (f.lojaId === 'todas' || (p.lojaId ?? 'loja1') === f.lojaId) && (!corte || dataDoPedidoMs(p) >= corte))
}

function passaNaBusca(q, campos) {
  if (!q) return true
  return norm(campos.filter(Boolean).join(' ')).includes(q)
}

/** Filtros simultâneos sobre os registros: busca, loja, período, desfecho/percentual, jornada e fase atual. */
export function filtrarRegistros(registros, f, agora = Date.now()) {
  const q = norm(f.busca.trim())
  const corte = f.periodo === 'todas' ? 0 : agora - Number(f.periodo) * 864e5
  return registros.filter(r => {
    if (f.lojaId !== 'todas' && r.lojaId !== f.lojaId) return false
    if (corte && r.dataMs < corte) return false
    if (f.desfecho !== 'todos') {
      if (/^\d+$/.test(f.desfecho)) { if (r.percentual !== Number(f.desfecho)) return false }
      else if (r.desfecho !== f.desfecho) return false
    }
    if (f.jornada !== 'todas' && r.jornada !== f.jornada) return false
    if (f.fase === 'sem_fase') { if (r.faseAtual) return false }
    else if (f.fase !== 'todas' && r.faseAtual !== f.fase) return false
    return passaNaBusca(q, [r.pedidoNumero, r.produto, r.motivo, r.lojaNome, r.cliente])
  })
}

/**
 * "Todos os pedidos": junção dos pedidos filtrados com os registros. Pedido sem
 * conversa vira linha "sem atendimento" / "sem fase". Conversas sem pedido
 * localizado entram no fim, para não sumirem.
 */
export function linhasDePedidos(pedidosFiltrados, registrosTodos, registrosFiltrados, lojas, f) {
  const q = norm((f.busca ?? '').trim())
  const comCaso = new Set(registrosTodos.filter(r => r.pedidoId).map(r => r.pedidoId))
  const porPedido = new Map(registrosFiltrados.filter(r => r.pedidoId).map(r => [r.pedidoId, r]))
  const linhas = []
  for (const p of pedidosFiltrados) {
    const r = porPedido.get(p.id) ?? null
    // tem caso, mas ele ficou fora dos filtros: a linha não entra (e não vira "sem atendimento")
    if (!r && comCaso.has(p.id)) continue
    if (!r) {
      // pedido sem caso: só passa se os filtros de caso estiverem abertos
      if (f.desfecho !== 'todos' || f.jornada !== 'todas' || (f.fase !== 'todas' && f.fase !== 'sem_fase')) continue
      const loja = lojas.find(l => l.id === (p.lojaId ?? 'loja1'))
      if (!passaNaBusca(q, [String(p.numero ?? '').replace('#', ''), p.cliente, p.email, produtoDoPedido(p), loja?.nome])) continue
    }
    const loja = lojas.find(l => l.id === (p.lojaId ?? 'loja1'))
    linhas.push({
      chave: `p:${p.id}`, pedidoId: p.id, pedidoNumero: String(p.numero ?? '').replace('#', ''),
      cliente: r?.cliente ?? p.cliente ?? p.email ?? '', lojaId: p.lojaId ?? 'loja1', lojaNome: loja?.nome ?? (p.lojaId ?? 'loja1'), moeda: loja?.moeda ?? 'EUR',
      valor: p.valor ?? null, dataMs: dataDoPedidoMs(p), produto: r?.produto ?? produtoDoPedido(p),
      registro: r, atendimento: r ? r.origem : 'sem atendimento',
      faseTitulo: r?.faseTitulo ?? 'sem fase',
    })
  }
  for (const r of registrosFiltrados.filter(r => !r.pedidoId)) {
    linhas.push({
      chave: r.chave, pedidoId: null, pedidoNumero: null, cliente: r.cliente, lojaId: r.lojaId, lojaNome: r.lojaNome, moeda: r.moeda,
      valor: null, dataMs: r.dataMs, produto: r.produto, registro: r, atendimento: r.origem, faseTitulo: r.faseTitulo,
    })
  }
  return linhas.sort((a, b) => b.dataMs - a.dataMs)
}

/** Ids dos pedidos que têm ao menos uma conversa (fora spam/lixeira). */
export function pedidosComConversa(tickets, pedidos) {
  const ids = new Set()
  for (const t of tickets) {
    if (!ativo(t)) continue
    const p = pedidoDaConversa(t, pedidos)
    if (p) ids.add(p.id)
  }
  return ids
}

const soma = (lista, f) => Math.round(lista.reduce((s, x) => s + (f(x) || 0), 0) * 100) / 100

/**
 * Indicadores por moeda, calculados SOBRE AS LINHAS VISÍVEIS (depois de busca,
 * loja, período, desfecho, jornada e fase) — lojas de moedas diferentes não se somam.
 *  reembolsadoEfetivo     só reembolsos EFETIVADOS: confirmação enviada (fase de
 *                         confirmação no histórico) ou marcado como processado no relatório
 *  aceitesPendentes       aceite do cliente aguardando decisão/confirmação do dono
 *  reembolsosRegistrados  linha do relatório manual (clássico) ainda não processada
 *  hipoteticoSemRetencao  HIPÓTESE: os mesmos efetivados, se tivessem recebido 100%
 *  historicoSuficiente    false sem reembolso efetivado confirmado pelo motor
 */
export function indicadores(linhas) {
  const moedas = [...new Set(linhas.map(l => l.moeda))]
  return moedas.map(moeda => {
    const ls = linhas.filter(l => l.moeda === moeda)
    const ps = ls.filter(l => l.pedidoId)
    const rs = ls.filter(l => l.registro).map(l => l.registro)
    const envolvidos = rs.filter(r => r.desfecho === 'reembolso' || r.desfecho === 'cancelamento')
    const efetivados = rs.filter(r => r.situacaoReembolso === 'efetivado' && r.reembolsado != null)
    const pendentes = rs.filter(r => r.situacaoReembolso === 'aceite_pendente')
    const registrados = rs.filter(r => r.situacaoReembolso === 'registrado')
    const inferidos = rs.filter(r => r.situacaoReembolso === 'inferido')
    const confirmados = efetivados.filter(r => r.origem === 'confirmada')
    const porJornada = ORDEM_JORNADAS.map(chave => {
      const d = rs.filter(r => r.jornada === chave)
      return { chave, pedidos: d.length, valor: soma(d, r => r.pedidoValor), pct: rs.length ? Math.round((d.length / rs.length) * 1000) / 10 : 0 }
    })
    return {
      moeda,
      pedidosTotais: ps.length,
      pedidosComAtendimento: ps.filter(l => l.registro).length,
      valorTotalPedidos: soma(ps, l => l.valor),
      valorComAtendimento: soma(ps.filter(l => l.registro), l => l.valor),
      pedidosEmReembolso: envolvidos.length,
      valorPedidosReembolsados: soma(envolvidos, r => r.pedidoValor),
      reembolsadoEfetivo: soma(efetivados, r => r.reembolsado),
      reembolsosEfetivados: efetivados.length,
      aceitesPendentes: pendentes.length,
      valorAceitesPendentes: soma(pendentes, r => r.reembolsado),
      reembolsosRegistrados: registrados.length,
      reembolsosInferidos: inferidos.length,
      hipoteticoSemRetencao: soma(efetivados, r => r.pedidoValor),
      historicoSuficiente: confirmados.length > 0,
      reembolsosConfirmados: confirmados.length,
      reembolsosParciais: efetivados.filter(r => (r.percentual ?? 100) < 100).length,
      casos: rs.length,
      pctProdutoIdentificado: rs.length ? Math.round((rs.filter(r => r.produtoIdentificado).length / rs.length) * 100) : 0,
      porJornada,
    }
  })
}

/** Ponto único de cálculo: o servidor e a página chamam isto com os mesmos dados. */
export function calcularCentral({ tickets, pedidos, lojas, fases, filtros = FILTROS_PADRAO, agora = Date.now() }) {
  const f = { ...FILTROS_PADRAO, ...filtros }
  const casos = montarCasos(tickets, pedidos, lojas, fases)
  const registros = consolidarPorPedido(casos)
  const registrosFiltrados = filtrarRegistros(registros, f, agora)
  const pedidosFiltrados = filtrarPedidos(pedidos, f, agora)
  const linhas = linhasDePedidos(pedidosFiltrados, registros, registrosFiltrados, lojas, f)
  const metricas = metricasPorFase(registrosFiltrados, fases)
  const kpis = indicadores(linhas)
  return { filtros: f, casos, registros: registrosFiltrados, linhas, metricas, indicadores: kpis }
}
