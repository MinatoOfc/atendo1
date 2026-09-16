// Mapa visual completo do pipeline (shared/mapa.js): lista FECHADA e ORDENADA de
// todos os itens da apresentação (Miro + exemplo externo), jornadas independentes
// e métricas por ITEM (fase real × segmento do caso). Falha se qualquer item for
// removido, omitido, duplicado ou colocado fora de ordem.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FASES, FASES_HUMANAS } from '../server/atendimento.js'
import { MAPA_VISUAL, TIPOS_MAPA, JORNADAS_MAPA, SEGMENTOS, itensDaJornada, fasesDoMapa, validarMapa, metricasPorItem, segmentoDoRegistro, itemPorId } from '../shared/mapa.js'
import { metricasPorFase, relacaoComFase } from '../shared/central.js'

const fases = Object.fromEntries(Object.entries(FASES).map(([id, f]) => [id, { titulo: f.titulo, jornada: f.jornada, oferta: f.oferta, instrucao: f.instrucao, confirmacao: !!f.confirmacao, decisaoDono: FASES_HUMANAS.has(id) }]))

// a lista fechada: exatamente estes ids, exatamente nesta ordem (transcrição da apresentação)
const LISTA_FECHADA = [
  // Entrada geral — triagem, cadência, execução/confirmação, confirmações do motor, cupons
  'entry-request', 'entry-received', 'entry-products', 'entry-products-required',
  'entry-first-response', 'entry-interval-5h',
  'rule-phase-only', 'rule-email-confirm', 'rule-exchange-confirm', 'rule-refund-window',
  'entry-confirm-exchange', 'entry-confirm-refund', 'entry-confirm-coupon', 'entry-confirm-cancel',
  'rule-coupon-10', 'rule-coupon-standard',
  // Tamanho / caimento — caminho completo
  'size-direction', 'size-free-exchange', 'size-exchange-20', 'size-refund-40', 'size-refund-50', 'size-refund-60', 'size-refund-70', 'size-full',
  // Qualidade / não gostou — caminho completo
  'quality-check', 'quality-alternative', 'quality-coupon-35', 'quality-refund-25', 'quality-refund-40', 'quality-refund-50', 'quality-refund-60', 'quality-refund-70', 'quality-full',
  // Defeito / produto errado — dois subfluxos completos
  'defect-photo', 'defect-photo-review', 'defect-free-exchange', 'defect-exchange-20', 'defect-refund-40', 'defect-refund-50', 'defect-refund-60', 'defect-refund-70', 'defect-full',
  'wrong-confirm', 'wrong-correct', 'wrong-coupon-35', 'wrong-refund-25', 'wrong-refund-40', 'wrong-refund-50', 'wrong-refund-60', 'wrong-refund-70', 'wrong-full',
  // Não recebeu / atraso — todos os cenários
  'delivery-status-within-check', 'delivery-status-within',
  'delivery-status-late-check', 'delivery-status-late',
  'delivery-refund-only', 'delivery-returned', 'delivery-returned-reship30', 'delivery-returned-address', 'delivery-returned-report', 'delivery-returned-reship20', 'delivery-returned-reship35', 'delivery-returned-full',
  'delivery-delivered-scan', 'delivery-delivered-wait2', 'delivery-delivered-report', 'delivery-delivered-reship20', 'delivery-delivered-reship35', 'delivery-delivered-full',
  'delivery-refused-eligibility', 'delivery-refused-reship30', 'delivery-refused-20', 'delivery-refused-35', 'delivery-refused-full',
  'delivery-never-arrived-within', 'delivery-processed-within', 'delivery-processed-terms',
  'delivery-deadline-passed', 'delivery-late-wait', 'delivery-late-coupon40', 'delivery-late-full',
  'delivery-unprocessed-check', 'delivery-unprocessed-cancel',
  // Cancelamento
  'cancel-check', 'cancel-complete',
]

test('o mapa visual tem exatamente os itens da lista fechada, na ordem da apresentação', () => {
  assert.deepEqual(MAPA_VISUAL.map(i => i.id), LISTA_FECHADA)
  assert.equal(new Set(LISTA_FECHADA).size, LISTA_FECHADA.length, 'sem duplicados')
  assert.equal(MAPA_VISUAL.length, 85)
  assert.deepEqual(JORNADAS_MAPA.map(j => itensDaJornada(j).length), [16, 8, 9, 18, 32, 2])
})

test('cada item tem id próprio, jornada, grupo, segmento, ordem, título, descrição, tipo válido e destinos existentes; jornadas independentes', () => {
  const ids = new Set(MAPA_VISUAL.map(i => i.id))
  for (const i of MAPA_VISUAL) {
    assert.match(i.id, /^[a-z0-9-]+$/); assert.ok(JORNADAS_MAPA.includes(i.jornada), i.id); assert.ok(SEGMENTOS[i.segmento], i.id)
    assert.ok(i.grupo && i.titulo && i.descricao, i.id); assert.ok(Number.isInteger(i.ordem) && i.ordem > 0, i.id)
    assert.ok(TIPOS_MAPA.includes(i.tipo), `${i.id}: tipo ${i.tipo}`)
    for (const dest of i.destinos) {
      assert.ok(ids.has(dest), `${i.id} → ${dest}`)
      // lida isoladamente, cada jornada chega à conclusão sem apontar para cartão de outra jornada
      // (a única saída permitida é a Entrada geral: aceite / endereço / confirmação, comuns a todas)
      assert.ok(i.jornada === 'entrada' || itemPorId[dest].jornada === i.jornada || itemPorId[dest].jornada === 'entrada', `${i.id} aponta para ${dest} (${itemPorId[dest].jornada})`)
    }
  }
  for (const j of JORNADAS_MAPA) assert.deepEqual(itensDaJornada(j).map(i => i.ordem), itensDaJornada(j).map((_, k) => k + 1), `${j}: ordem contínua`)
  assert.deepEqual(validarMapa(fases), [])
  // cada jornada de caso termina no 100% dentro dela mesma
  for (const fim of ['size-full', 'quality-full', 'defect-full', 'wrong-full', 'delivery-returned-full', 'delivery-delivered-full', 'delivery-refused-full', 'delivery-late-full']) assert.equal(itemPorId[fim].fase, 'reemb_100')
  // ofertas reutilizadas têm ids próprios em cada jornada
  assert.deepEqual(MAPA_VISUAL.filter(i => i.fase === 'reemb_40').map(i => i.id), ['size-refund-40', 'quality-refund-40', 'defect-refund-40', 'wrong-refund-40'])
})

test('toda fase do motor está no mapa; regra e decisão nunca contam como fase enviada; contagens', () => {
  assert.deepEqual(fasesDoMapa().sort(), Object.keys(FASES).sort(), 'as 28 fases do motor aparecem, e o mapa não inventa fase')
  for (const i of MAPA_VISUAL) {
    if (i.tipo === 'regra' || i.tipo === 'decisao') assert.ok(!i.fase || !FASES[i.fase].oferta, `${i.id}: regra/decisão sem oferta`)
    if (i.tipo === 'oferta') assert.ok(i.fase && FASES[i.fase].oferta, `${i.id}: oferta aponta para fase com oferta`)
    if (i.tipo === 'confirmacao') assert.ok(i.fase && FASES[i.fase].confirmacao, `${i.id}: confirmação aponta para fase de confirmação`)
  }
  const comFase = MAPA_VISUAL.filter(i => i.fase)
  const enviaveis = Object.keys(FASES).filter(id => FASES[id].instrucao !== null)
  assert.equal(comFase.length, 59); assert.equal(MAPA_VISUAL.length - comFase.length, 26); assert.equal(fasesDoMapa().length, 28); assert.equal(enviaveis.length, 26)
  assert.deepEqual(Object.keys(FASES).filter(id => FASES[id].instrucao === null).sort(), ['cancel_nao_processado', 'reemb_100'])
})

/* ---------- métricas por item: fase real × segmento ---------- */
const agora = Date.parse('2026-09-16T12:00:00Z')
const reg = (chave, fluxo, trilha, extra = {}) => ({
  chave, pedidoId: chave, ticketId: 't' + chave, tickets: ['t' + chave], lojaId: 'l1', lojaNome: 'L', moeda: 'EUR', pedidoValor: 100,
  fluxo, subfluxo: null, motivoCategoria: 'nao_informado', jornada: { tamanho: 'tamanho', qualidade: 'qualidade', defeito: 'defeito_errado', errado: 'defeito_errado', nao_recebido_status: 'nao_recebido', nao_recebido_reembolso: 'nao_recebido', entregue_nao_recebido: 'nao_recebido', cancelamento: 'cancelamento' }[fluxo] ?? 'entrada',
  faseAtual: trilha.at(-1) ?? null, origem: 'confirmada', inferidaPor: null, faseInferida: null, faseManual: null,
  trilha, trilhaUniao: trilha, desfecho: 'em_aberto', percentual: null, reembolsado: null, concluido: false, comVoce: false, escalouAoDono: false, confirmacaoEnviada: null, dataMs: agora, ...extra,
})
const registros = [
  reg('T1', 'tamanho', ['tam_ajuste', 'tam_troca', 'troca_20', 'reemb_40']),                       // tamanho parado no 40%
  reg('Q1', 'qualidade', ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40']),                 // qualidade parada no 40%
  reg('D1', 'defeito', ['def_foto', 'def_troca', 'troca_20', 'reemb_40']),                          // defeito parado no 40%
  reg('E1', 'errado', ['err_envio', 'qual_cupom_35', 'reemb_25']),                                   // produto errado no 25%
  reg('E2', 'errado', ['err_envio']),                                                                 // produto errado na primeira oferta
  reg('N1', 'nao_recebido_status', ['nc_no_prazo'], { subfluxo: 'status' }),                        // só perguntou o status
  reg('N2', 'nao_recebido_status', ['nc_atrasado_25', 'nc_cupom_40'], { subfluxo: 'cancelamento' }), // pediu cancelamento, atrasado
  reg('N3', 'nao_recebido_reembolso', ['nr_reenvio_30', 'nr_reenvio_20'], { subfluxo: 'nao_chegou' }),
  reg('N4', 'nao_recebido_reembolso', ['nr_reenvio_30'], { subfluxo: 'recusado' }),
  reg('N5', 'entregue_nao_recebido', ['nr_entregue_aguardar', 'nr_reenvio_35'], { subfluxo: 'entregue' }),
]
const porItem = metricasPorItem(registros, fases, metricasPorFase, relacaoComFase)
const p = id => porItem[id].passaram

test('um caso de Tamanho no 40% conta só no 40% de Tamanho; Qualidade só em Qualidade; Defeito só em Defeito', () => {
  assert.deepEqual([p('size-refund-40'), p('quality-refund-40'), p('defect-refund-40'), p('wrong-refund-40')], [1, 1, 1, 0])
  assert.deepEqual([porItem['size-refund-40'].emAberto, porItem['quality-refund-40'].emAberto, porItem['defect-refund-40'].emAberto], [1, 1, 1])
  // a fase global reemb_40 teria 3; nenhum cartão mostra o total global
  assert.equal(metricasPorFase(registros, fases).reemb_40.passaram, 3)
  for (const id of ['size-refund-40', 'quality-refund-40', 'defect-refund-40']) assert.notEqual(p(id), 3)
})

test('Produto errado não entra nos números de Defeito (e vice-versa), mesmo compartilhando a jornada técnica', () => {
  assert.deepEqual([p('wrong-correct'), p('wrong-coupon-35'), p('wrong-refund-25')], [2, 1, 1])
  assert.deepEqual([p('defect-photo'), p('defect-free-exchange'), p('defect-exchange-20')], [1, 1, 1])
  assert.equal(p('defect-refund-25' in porItem ? 'defect-refund-25' : 'quality-refund-25'), 1, 'o 25% da qualidade conta só Q1')
  assert.equal(p('wrong-refund-40'), 0); assert.equal(p('size-exchange-20'), 1); assert.equal(p('defect-exchange-20'), 1, 'troca_20 separada entre tamanho e defeito')
  assert.equal(segmentoDoRegistro(registros[3]), 'errado'); assert.equal(segmentoDoRegistro(registros[2]), 'defeito')
})

test('não recebido: cada cenário do mapa conta só os seus casos', () => {
  assert.equal(p('delivery-status-within'), 1); assert.equal(p('delivery-processed-within'), 0, 'N1 só perguntou o status')
  assert.equal(p('delivery-late-wait'), 1); assert.equal(p('delivery-status-late'), 0, 'N2 pediu cancelamento')
  assert.equal(p('delivery-late-coupon40'), 1)
  assert.equal(p('delivery-returned-reship30'), 1); assert.equal(p('delivery-refused-reship30'), 1, 'N3 não chegou; N4 recusado')
  assert.equal(p('delivery-returned-reship20'), 1); assert.equal(p('delivery-refused-20'), 0)
  assert.equal(p('delivery-delivered-wait2'), 1); assert.equal(p('delivery-delivered-reship35'), 1); assert.equal(p('delivery-refused-35'), 0); assert.equal(p('delivery-returned-reship35'), 0)
  for (const [id, m] of Object.entries(porItem)) assert.equal(m.pctPassaram, m.totalSegmento ? Math.round((m.passaram / m.totalSegmento) * 1000) / 10 : 0, id)
})

test('funil coerente em cada jornada: nenhuma etapa tem mais casos que a anterior e a soma pararam + avançaram + em aberto = passaram', () => {
  const cadeias = [
    ['size-free-exchange', 'size-exchange-20', 'size-refund-40', 'size-refund-50', 'size-refund-60', 'size-refund-70'],
    ['quality-alternative', 'quality-coupon-35', 'quality-refund-25', 'quality-refund-40', 'quality-refund-50', 'quality-refund-60', 'quality-refund-70'],
    ['defect-free-exchange', 'defect-exchange-20', 'defect-refund-40', 'defect-refund-50', 'defect-refund-60', 'defect-refund-70'],
    ['wrong-correct', 'wrong-coupon-35', 'wrong-refund-25', 'wrong-refund-40', 'wrong-refund-50', 'wrong-refund-60', 'wrong-refund-70'],
    ['delivery-returned-reship30', 'delivery-returned-reship20', 'delivery-returned-reship35'],
    ['delivery-late-wait', 'delivery-late-coupon40'],
  ]
  for (const cadeia of cadeias) {
    for (let k = 1; k < cadeia.length; k++) assert.ok(p(cadeia[k]) <= p(cadeia[k - 1]), `${cadeia[k]} (${p(cadeia[k])}) ≤ ${cadeia[k - 1]} (${p(cadeia[k - 1])})`)
  }
  for (const [id, m] of Object.entries(porItem)) assert.equal(m.pararam + m.avancaram + m.emAberto, m.passaram, id)
})
