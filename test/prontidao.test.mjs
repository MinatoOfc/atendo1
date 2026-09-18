// Prontidão REAL do modo novo (shared/prontidao.js): Shopify conectada,
// sincronização de pedidos concluída, cupons conferidos na Shopify e a separação
// entre "piloto com aprovação humana" e "envio totalmente automático".
// Lógica pura: nenhuma rede, nenhum servidor, nenhuma loja ativada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  prontidaoDaLoja, conferirCupons, estadoCupom, cupomParaMensagem, PCT_CUPOM_RESERVA, SITUACAO_CUPOM,
} from '../shared/prontidao.js'

// percentuais que as fases realmente usam (server/atendimento.js é a fonte)
const USADOS = [15, 25, 30, 35, 40]
const CODIGOS = { 10: 'RESERVA10', 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
const loja = (extra = {}) => ({
  id: 'loja1', nome: 'Loja Nova', moeda: 'EUR', modoAtendimento: 'novo',
  prazoEntrega: { min: 5, max: 12, processamento: 3 }, cupons: { ...CODIGOS }, ...extra,
})
const verificacaoOk = (lojaId = 'loja1', extra = []) => ({
  permissao: true, erro: null, em: '2026-09-18T10:00:00.000Z', lojaId,
  itens: [...USADOS.map(pct => ({ pct, codigo: CODIGOS[pct], situacao: 'ok', detalhe: `${pct}% ativo na Shopify` })), ...extra],
})
const comItem = (pct, patch) => {
  const v = verificacaoOk()
  v.itens = v.itens.map(i => (i.pct === pct ? { ...i, ...patch } : i))
  return v
}
const completo = (extra = {}) => ({
  loja: loja(), emailOk: true, shopify: { conectada: true },
  sincronizacao: { ok: true, em: '2026-09-18T09:00:00.000Z', erro: null },
  verificacaoCupons: verificacaoOk(), pctsUsados: USADOS, ...extra,
})
const chaves = lista => lista.map(f => f.chave)

test('loja completa: pronta para o piloto E para o envio automático', () => {
  const r = prontidaoDaLoja(completo())
  assert.equal(r.pronto, true)
  assert.deepEqual(r.faltando, [])
  assert.equal(r.automatico.pronto, true)
  assert.deepEqual(r.avisos, [])
})

test('Shopify desconectada bloqueia a prontidão (e o automático junto)', () => {
  const r = prontidaoDaLoja(completo({ shopify: { conectada: false } }))
  assert.equal(r.pronto, false)
  assert.ok(chaves(r.faltando).includes('shopify'))
  assert.match(r.faltando.find(f => f.chave === 'shopify').texto, /Shopify conectada/i)
  assert.equal(r.automatico.pronto, false)
})

test('sincronização de pedidos que falhou bloqueia, e o erro aparece no texto', () => {
  const semSync = prontidaoDaLoja(completo({ sincronizacao: null }))
  assert.equal(semSync.pronto, false)
  assert.ok(chaves(semSync.faltando).includes('sincronizacao'))
  const falhou = prontidaoDaLoja(completo({ sincronizacao: { ok: false, erro: 'token revogado', em: '2026-09-18T09:00:00.000Z' } }))
  assert.equal(falhou.pronto, false)
  assert.match(falhou.faltando.find(f => f.chave === 'sincronizacao').texto, /token revogado/)
})

test('cupom que não existe na Shopify: piloto com aprovação continua, automático bloqueado', () => {
  const v = comItem(25, { situacao: 'inexistente', detalhe: 'nenhum cupom com esse código nesta loja' })
  const r = prontidaoDaLoja(completo({ verificacaoCupons: v }))
  assert.equal(r.pronto, true, 'o piloto com aprovação humana continua')
  assert.equal(r.automatico.pronto, false)
  assert.ok(chaves(r.automatico.faltando).includes('cupons_invalidos'))
  assert.match(r.automatico.faltando.find(f => f.chave === 'cupons_invalidos').texto, /25% \(nenhum cupom/)
  assert.ok(r.avisos.some(a => /25%/.test(a.texto)))
})

test('percentual divergente na Shopify bloqueia o automático', () => {
  const v = comItem(40, { situacao: 'percentual_divergente', detalhe: 'na Shopify vale 20%, não 40%' })
  const r = prontidaoDaLoja(completo({ verificacaoCupons: v }))
  assert.equal(r.automatico.pronto, false)
  assert.match(r.automatico.faltando.find(f => f.chave === 'cupons_invalidos').texto, /vale 20%/)
  // e a mensagem com esse cupom não sai nem com aprovação humana
  const uso = cupomParaMensagem({ pct: 40, cupons: CODIGOS, verificacao: v, lojaId: 'loja1' })
  assert.equal(uso.ok, false)
  assert.equal(uso.codigo, null)
  assert.match(uso.motivo, /vale 20%/)
})

test('cupom expirado bloqueia o automático e nunca vai para a mensagem', () => {
  const v = comItem(35, { situacao: 'expirado', detalhe: 'expirou em 2026-08-01' })
  const r = prontidaoDaLoja(completo({ verificacaoCupons: v }))
  assert.equal(r.automatico.pronto, false)
  assert.ok(r.avisos.some(a => /expirou/.test(a.texto)))
  assert.equal(cupomParaMensagem({ pct: 35, cupons: CODIGOS, verificacao: v, lojaId: 'loja1' }).codigo, null)
})

test('verificação feita em OUTRA loja não vale: nada de misturar código entre lojas', () => {
  const daOutra = verificacaoOk('loja2')
  const e = estadoCupom(30, CODIGOS[30], daOutra, 'loja1')
  assert.equal(e.situacao, 'outra_loja')
  assert.equal(e.detalhe, SITUACAO_CUPOM.outra_loja)
  const r = prontidaoDaLoja(completo({ verificacaoCupons: daOutra }))
  assert.equal(r.pronto, true, 'o piloto com aprovação continua')
  assert.equal(r.automatico.pronto, false)
  assert.ok(chaves(r.automatico.faltando).includes('cupons_nao_verificados'))
  // e a mensagem automática não usa esse código
  assert.equal(cupomParaMensagem({ pct: 30, cupons: CODIGOS, verificacao: daOutra, lojaId: 'loja1', exigirVerificado: true }).codigo, null)
})

test('sem permissão read_discounts: "cupom não verificado" e só o automático é bloqueado', () => {
  const semPermissao = { permissao: false, erro: 'Faltou a permissão de leitura de descontos.', em: '2026-09-18T10:00:00.000Z', lojaId: 'loja1', itens: [] }
  const r = prontidaoDaLoja(completo({ verificacaoCupons: semPermissao }))
  assert.equal(r.pronto, true, 'o piloto com aprovação humana pode continuar')
  assert.equal(r.automatico.pronto, false)
  assert.ok(chaves(r.automatico.faltando).includes('cupons_nao_verificados'))
  assert.ok(r.avisos.some(a => /não verificado/.test(a.texto) && /piloto com aprovação continua/.test(a.texto)))
  // com aprovação humana o código ainda é usado (com o aviso); sozinho, não
  const comHumano = cupomParaMensagem({ pct: 15, cupons: CODIGOS, verificacao: semPermissao, lojaId: 'loja1' })
  assert.equal(comHumano.codigo, 'DANKE15')
  assert.match(comHumano.motivo, /permissão|não verificado/i)
  assert.equal(cupomParaMensagem({ pct: 15, cupons: CODIGOS, verificacao: semPermissao, lojaId: 'loja1', exigirVerificado: true }).codigo, null)
})

test('cupom não cadastrado no Atendo bloqueia os dois níveis', () => {
  const semCodigo = loja({ cupons: { ...CODIGOS, 30: '' } })
  const r = prontidaoDaLoja(completo({ loja: semCodigo }))
  assert.equal(r.pronto, false)
  assert.match(r.faltando.find(f => f.chave === 'cupons').texto, /30%/)
  assert.equal(cupomParaMensagem({ pct: 30, cupons: semCodigo.cupons, verificacao: verificacaoOk(), lojaId: 'loja1' }).codigo, null)
})

test('o cupom de 10% é RESERVA: aparece na lista, nunca vira requisito', () => {
  const r = prontidaoDaLoja(completo())
  const reserva = r.cupons.find(c => c.pct === PCT_CUPOM_RESERVA)
  assert.ok(reserva, 'o de 10% aparece na lista')
  assert.equal(reserva.usadoPeloFluxo, false)
  assert.equal(reserva.reserva, true)
  assert.equal(reserva.situacao, 'reserva')
  assert.equal(reserva.detalhe, 'reserva — não utilizado pelo fluxo')
  // sem o código de 10% a loja continua pronta nos dois níveis
  const sem10 = prontidaoDaLoja(completo({ loja: loja({ cupons: { ...CODIGOS, 10: '' } }) }))
  assert.equal(sem10.pronto, true)
  assert.equal(sem10.automatico.pronto, true)
  assert.ok(!JSON.stringify(sem10.faltando).includes('10%'))
  // e nenhuma fase pede 10%: pedir cupom de 10% numa mensagem não é caso de uso
  assert.equal(conferirCupons({ cupons: CODIGOS, pctsUsados: USADOS }).itens.filter(c => c.usadoPeloFluxo).length, USADOS.length)
})

test('o código mudou depois da verificação: volta a valer como não verificado', () => {
  const v = verificacaoOk()
  const e = estadoCupom(15, 'OUTRO15', v, 'loja1')
  assert.equal(e.situacao, 'nao_verificado')
  assert.match(e.detalhe, /mudou depois/)
})

test('moeda inválida bloqueia só o envio automático', () => {
  const r = prontidaoDaLoja(completo({ loja: loja({ moeda: 'XYZ' }) }))
  assert.equal(r.pronto, true)
  assert.equal(r.automatico.pronto, false)
  assert.ok(chaves(r.automatico.faltando).includes('moeda'))
})

test('e-mail próprio e prazo continuam obrigatórios, e o que falta é explicado item a item', () => {
  const r = prontidaoDaLoja(completo({ emailOk: false, loja: loja({ prazoEntrega: null }), shopify: { conectada: false } }))
  assert.equal(r.pronto, false)
  assert.deepEqual(chaves(r.faltando).sort(), ['email', 'prazo', 'shopify'])
  for (const f of r.faltando) assert.ok(f.texto.length > 10, 'cada item explica o que falta: ' + f.chave)
})
