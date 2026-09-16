// Mapa visual completo do pipeline (shared/mapa.js): lista FECHADA e ORDENADA de
// todos os itens do mapa mental. Falha se qualquer item for removido, omitido,
// duplicado ou colocado fora de ordem — ou se uma fase do motor ficar fora do mapa.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FASES, FASES_HUMANAS } from '../server/atendimento.js'
import { MAPA_VISUAL, TIPOS_MAPA, itensDaJornada, fasesDoMapa, validarMapa } from '../shared/mapa.js'

const fases = Object.fromEntries(Object.entries(FASES).map(([id, f]) => [id, { titulo: f.titulo, jornada: f.jornada, oferta: f.oferta, instrucao: f.instrucao, confirmacao: !!f.confirmacao, decisaoDono: FASES_HUMANAS.has(id) }]))

// a lista fechada: exatamente estes ids, exatamente nesta ordem
const LISTA_FECHADA = [
  // entrada geral
  'regra_cadencia', 'regra_produtos', 'regra_nao_antecipar', 'regra_cupons', 'regra_idioma', 'triagem',
  'coleta_pedido', 'coleta_produtos', 'coleta_motivo', 'regra_aceite', 'endereco', 'dono_aceite',
  'conf_troca', 'conf_reembolso', 'conf_cupom', 'conf_cancelamento', 'regra_prazos', 'regra_relatorio', 'encerramento',
  // tamanho / caimento
  'tam_ajuste', 'tam_recomendar', 'tam_troca', 'tam_decisao_1', 'troca_20', 'tam_decisao_2',
  // qualidade / não gostou + escada
  'qual_troca', 'qual_decisao_1', 'qual_cupom_35', 'qual_decisao_2',
  'reemb_25', 'esc_decisao_25', 'reemb_40', 'esc_decisao_40', 'reemb_50', 'esc_decisao_50', 'reemb_60', 'esc_decisao_60', 'reemb_70', 'esc_decisao_70', 'reemb_100',
  // defeito / produto errado
  'def_foto', 'def_validacao', 'def_troca', 'def_decisao', 'err_envio', 'err_decisao',
  // não recebeu / atraso
  'nc_decisao', 'nc_no_prazo', 'nc_atrasado_25', 'nc_decisao_25', 'nc_cupom_40', 'nc_decisao_40',
  'nr_reenvio_30', 'nr_decisao_30', 'nr_entregue_aguardar', 'nr_decisao_entregue', 'nr_reenvio_20', 'nr_decisao_20', 'nr_reenvio_35', 'nr_decisao_35',
  // cancelamento
  'cancel_decisao', 'cancel_nao_processado',
]

test('o mapa visual tem exatamente os itens da lista fechada, na ordem do mapa mental', () => {
  assert.deepEqual(MAPA_VISUAL.map(i => i.id), LISTA_FECHADA)
  assert.equal(new Set(LISTA_FECHADA).size, LISTA_FECHADA.length, 'sem duplicados')
  assert.equal(MAPA_VISUAL.length, 62)
})

test('cada item tem identificador, jornada, grupo, ordem, título, descrição, tipo válido e destinos existentes', () => {
  const ids = new Set(MAPA_VISUAL.map(i => i.id))
  for (const i of MAPA_VISUAL) {
    assert.match(i.id, /^[a-z0-9_]+$/); assert.ok(['entrada', 'tamanho', 'qualidade', 'defeito_errado', 'nao_recebido', 'cancelamento'].includes(i.jornada), i.id)
    assert.ok(i.grupo && i.titulo && i.descricao, i.id); assert.ok(Number.isInteger(i.ordem) && i.ordem > 0, i.id)
    assert.ok(TIPOS_MAPA.includes(i.tipo), `${i.id}: tipo ${i.tipo}`)
    for (const d of i.destinos) assert.ok(ids.has(d), `${i.id} → ${d}`)
  }
  for (const j of ['entrada', 'tamanho', 'qualidade', 'defeito_errado', 'nao_recebido', 'cancelamento']) {
    assert.deepEqual(itensDaJornada(j).map(i => i.ordem), itensDaJornada(j).map((_, k) => k + 1), `${j}: ordem contínua`)
  }
  assert.deepEqual(validarMapa(fases), [])
})

test('toda fase do motor está no mapa; regra e decisão nunca contam como fase enviada; contagens', () => {
  const noMapa = fasesDoMapa().sort()
  assert.deepEqual(noMapa, Object.keys(FASES).sort(), 'as 28 fases do motor aparecem no mapa, e o mapa não inventa fase')
  for (const i of MAPA_VISUAL) {
    if (i.tipo === 'regra' || i.tipo === 'decisao') assert.ok(!i.fase || !FASES[i.fase].oferta, `${i.id}: regra/decisão sem oferta`)
    if (i.tipo === 'oferta') assert.ok(i.fase && FASES[i.fase].oferta, `${i.id}: oferta aponta para fase com oferta`)
    if (i.tipo === 'confirmacao') assert.ok(i.fase && FASES[i.fase].confirmacao, `${i.id}: confirmação aponta para fase de confirmação`)
  }
  const semFase = MAPA_VISUAL.filter(i => !i.fase)
  const enviaveis = Object.keys(FASES).filter(id => FASES[id].instrucao !== null)
  assert.equal(MAPA_VISUAL.length, 62); assert.equal(fasesDoMapa().length, 28); assert.equal(enviaveis.length, 26); assert.equal(semFase.length, 32)
  assert.deepEqual(Object.keys(FASES).filter(id => FASES[id].instrucao === null).sort(), ['cancel_nao_processado', 'reemb_100'], 'as duas fases humanas nunca são enviadas pela IA')
})
