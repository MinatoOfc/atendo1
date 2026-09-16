// Motor de etapas do atendimento novo — funções puras, sem servidor nem IA.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  novoEstado, decidir, confirmarTransicao, validarProposta, prazoDoPedido, somarDiasUteis,
  horarioMinimoEnvio, FASES, validarEndereco, conferirTextoDaFase, diferencaDeOferta,
  instrucaoAlteraOferta, assinaturaOferta, faseDeConfirmacao, promptEscrever, valoresMonetarios, codigosCitados, mencionaData,
} from '../server/atendimento.js'

const loja = { id: 'l1', nome: 'Von Alder', moeda: 'EUR', cupons: { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }, prazoEntrega: { min: 5, max: 12, processamento: 3 } }
const pedido1 = { numero: '#2202', valor: 70, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', itens: [{ titulo: 'Polo Premium', variante: 'Marine / M', quantidade: 1 }] }
const pedido2 = { numero: '#2201', valor: 130, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1 }, { titulo: 'Hemd Bügelfrei', variante: 'Weiß / XL', quantidade: 1 }] }
const agora = Date.parse('2026-09-15T12:00:00Z')

// cliente escreve → motor decide → e-mail sai → transição confirmada
function rodada(an, cls, extra = {}) {
  const r = decidir({ an, cls, pedido: 'pedido' in extra ? extra.pedido : pedido1, loja, temFoto: !!extra.temFoto, agora: extra.agora ?? agora })
  if (r.fase) confirmarTransicao(r.an, { para: r.fase, mensagem: cls.resumo ?? '', agora: extra.agora ?? agora })
  return r
}
const trilha = r => r.an.historicoEtapas.map(h => h.para).join(' → ')

test('cliente exigindo 100% em toda mensagem avança UMA etapa por vez, até o dono', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'qualidade', resumo: 'material ruim, quero 100%' })
  assert.equal(r.fase, 'qual_troca')
  const esperadas = ['qual_cupom_35', 'reemb_25', 'reemb_40', 'reemb_50', 'reemb_60', 'reemb_70']
  for (const e of esperadas) {
    r = rodada(r.an, { intencao: 'pede_reembolso', resumo: 'não quero 25%, 40%, 50%, 60% nem 70%; quero 100%' })
    assert.equal(r.fase, e, `deveria ir para ${e}`)
  }
  r = rodada(r.an, { intencao: 'pede_reembolso', resumo: '100%!' })
  assert.equal(r.fase, null)
  assert.equal(r.an.aguardando, 'humano')
  assert.match(r.humano, /100%/)
  assert.equal(trilha(r), 'qual_troca → qual_cupom_35 → reemb_25 → reemb_40 → reemb_50 → reemb_60 → reemb_70')
})

test('tamanho: pergunta pequeno/grande, troca gratuita, troca + 20% e entra na escada pelo 40%', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_troca', motivo: 'tamanho', resumo: 'ficou pequeno' })
  assert.equal(r.fase, 'tam_ajuste')
  r = rodada(r.an, { intencao: 'informa', ajustes: [{ produto: 'Polo Premium (Marine / M)', ajuste: 'pequeno' }] })
  assert.equal(r.fase, 'tam_troca')
  r = rodada(r.an, { intencao: 'pede_reembolso' }); assert.equal(r.fase, 'troca_20')
  r = rodada(r.an, { intencao: 'pede_reembolso' }); assert.equal(r.fase, 'reemb_40', 'não passa pelo 25% (5.7)')
})

test('pedido com dois itens exige dizer qual produto antes de qualquer oferta', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'qualidade', produtos: [] }, { pedido: pedido2 })
  assert.equal(r.fase, 'coleta'); assert.deepEqual(r.faltando, ['produtos'])
  r = rodada(r.an, { intencao: 'informa', produtos: ['polo premium'] }, { pedido: pedido2 })
  assert.equal(r.an.produtosAfetados[0], 'Polo Premium (Schwarz / L)')
  assert.equal(r.fase, 'qual_troca')
})

test('cliente sem pedido localizado recebe primeiro o pedido do número', () => {
  const r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'qualidade' }, { pedido: null })
  assert.equal(r.fase, 'coleta'); assert.deepEqual(r.faltando, ['pedido'])
})

test('imagem não é prova: defeito pede foto, imagem recebida vai ao dono, e só a validação libera a troca', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'defeito', resumo: 'veio rasgado' })
  assert.equal(r.fase, 'def_foto')
  r = rodada(r.an, { intencao: 'pede_reembolso', resumo: 'quero reembolso logo' })
  assert.equal(r.fase, 'def_foto', 'sem foto não avança')
  r = rodada(r.an, { intencao: 'informa', resumo: 'segue a foto' }, { temFoto: true })
  assert.equal(r.fase, null, 'imagem recebida não vira oferta sozinha')
  assert.equal(r.an.fotoRecebida, true)
  assert.notEqual(r.an.fotoValidada, true)
  assert.equal(r.an.aguardando, 'humano')
  assert.match(r.humano, /Imagem recebida/)
  // o lojista valida (rota /novo/foto faz isto) e o motor segue para a troca
  r.an.fotoValidada = true; r.an.aguardando = null
  r = rodada(r.an, { intencao: 'informa', resumo: 'foto validada' })
  assert.equal(r.fase, 'def_troca')
  assert.equal(FASES.def_troca.oferta.prazo, '5 a 11 dias', 'prazo da troca por defeito é o do mapa')
  r = rodada(r.an, { intencao: 'recusa' }); assert.equal(r.fase, 'troca_20')
})

test('endereço: qualquer texto não serve; pede só o que falta; aceite só segue completo', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_troca', motivo: 'errado', resumo: 'cor errada' })
  assert.equal(r.fase, 'err_envio')
  r = rodada(r.an, { intencao: 'aceita', resumo: 'pode mandar' })
  assert.equal(r.fase, 'endereco'); assert.deepEqual(r.faltando, [], 'sem nada informado pede o endereço inteiro')
  r = rodada(r.an, { intencao: 'informa', endereco: 'Berlin', resumo: 'ok pode mandar para Berlin' })
  assert.equal(r.fase, 'endereco', 'texto solto não é endereço')
  assert.ok(r.faltando.includes('end_rua') && r.faltando.includes('end_cep'))
  assert.equal(r.an.enderecoConfirmado, null)
  assert.equal(r.an.aguardando, 'cliente')
  r = rodada(r.an, { intencao: 'informa', endereco: 'Hauptstr. 1, 10115', resumo: 'x' })
  assert.equal(r.fase, null, 'partes se acumulam: Berlin + Hauptstr. 1, 10115 fecha o endereço')
  assert.equal(r.an.aguardando, 'humano')
  assert.ok(r.an.enderecoConfirmado)
  assert.equal(r.aceite.fase, 'err_envio')
})

test('endereço já enviado antes do aceite não é pedido de novo', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_troca', motivo: 'errado', endereco: 'Via Roma 5, 00100 Roma', resumo: 'x' })
  r = rodada(r.an, { intencao: 'aceita' })
  assert.equal(r.fase, null); assert.equal(r.an.aguardando, 'humano'); assert.ok(r.an.enderecoConfirmado)
})

test('validarEndereco: componentes mínimos', () => {
  assert.equal(validarEndereco('Hauptstr. 1, 10115 Berlin').ok, true)
  assert.equal(validarEndereco('Hauptstraße 12\n10115 Berlin\nDeutschland').ok, true)
  assert.equal(validarEndereco('12 rue de Rivoli, 75001 Paris').ok, true)
  assert.equal(validarEndereco('Keizersgracht 100, 1015 AB Amsterdam').ok, true)
  assert.deepEqual(validarEndereco('Berlin').faltando, ['end_rua', 'end_cep'])
  assert.deepEqual(validarEndereco('Hauptstr. 12').faltando, ['end_cep', 'end_cidade'])
  assert.deepEqual(validarEndereco('10115 Berlin').faltando, ['end_rua'])
  assert.deepEqual(validarEndereco('ok, pode mandar').faltando, ['end_rua', 'end_cep', 'end_cidade'])
  assert.equal(validarEndereco('').ok, false)
})

test('aceite no meio da escada vai ao dono e mensagem nova não move a etapa', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'qualidade' })
  r = rodada(r.an, { intencao: 'recusa' }); r = rodada(r.an, { intencao: 'recusa' })
  assert.equal(r.fase, 'reemb_25')
  r = rodada(r.an, { intencao: 'aceita' })
  assert.equal(r.an.aguardando, 'humano'); assert.equal(r.aceite.fase, 'reemb_25')
  const antes = trilha(r)
  r = rodada(r.an, { intencao: 'pede_reembolso', resumo: 'quero 100%' })
  assert.equal(trilha(r), antes)
})

test('não recebido: prazo decide; seção 7 quando já chega pedindo reembolso', () => {
  const emTransito = { ...pedido1, status: 'transito', despachadoEm: '2026-09-12' }
  assert.equal(prazoDoPedido(emTransito, loja, agora).vencido, false)
  let r = rodada(novoEstado(), { intencao: 'pergunta_status', motivo: 'nao_recebido' }, { pedido: emTransito })
  assert.equal(r.fase, 'nc_no_prazo')
  const atrasado = { ...pedido1, status: 'transito', despachadoEm: '2026-08-01' }
  r = rodada(novoEstado(), { intencao: 'pergunta_status', motivo: 'nao_recebido' }, { pedido: atrasado })
  assert.equal(r.fase, 'nc_atrasado_25')
  r = rodada(r.an, { intencao: 'pede_reembolso' }, { pedido: atrasado }); assert.equal(r.fase, 'nc_cupom_40')
  r = rodada(r.an, { intencao: 'recusa' }, { pedido: atrasado }); assert.equal(r.an.aguardando, 'humano')
  r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'nao_recebido', situacaoEntrega: 'nao_chegou' }, { pedido: atrasado })
  assert.equal(r.fase, 'nr_reenvio_30')
  r = rodada(r.an, { intencao: 'recusa' }, { pedido: atrasado }); assert.equal(r.fase, 'nr_reenvio_20')
  r = rodada(r.an, { intencao: 'recusa' }, { pedido: atrasado }); assert.equal(r.fase, 'nr_reenvio_35')
  r = rodada(r.an, { intencao: 'recusa' }, { pedido: atrasado }); assert.equal(r.an.aguardando, 'humano')
  const entregue = { ...pedido1, status: 'entregue' }
  r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'nao_recebido' }, { pedido: entregue })
  assert.equal(r.fase, 'nr_entregue_aguardar')
  r = rodada(r.an, { intencao: 'pede_reembolso' }, { pedido: entregue }); assert.equal(r.fase, 'nr_reenvio_35', '7.2: a seta do mapa entra no 35%')
})

test('cancelamento de pedido não processado, agradecimento e fora do mapa', () => {
  const naoProcessado = { ...pedido1, status: 'aguardando', despachadoEm: null }
  const r = rodada(novoEstado(), { intencao: 'pede_cancelamento' }, { pedido: naoProcessado })
  assert.equal(r.an.aguardando, 'humano'); assert.match(r.humano, /Cancelamento/)
  assert.equal(rodada(novoEstado(), { intencao: 'agradece' }).encerrar, true)
  assert.match(rodada(novoEstado(), { intencao: 'outro' }).humano, /Fora do mapa/)
})

test('bloqueios: percentual, cupom e ação fora da fase; confirmação como fato consumado', () => {
  assert.equal(validarProposta('reemb_40', { acao_proposta: 'reemb_40', resposta: 'Ofereço 40% agora e 50% depois.' }, loja).ok, false)
  assert.equal(validarProposta('reemb_40', { acao_proposta: 'reemb_40', resposta: 'Posso oferecer 40% (52,00 €).' }, loja).ok, true)
  assert.equal(validarProposta('reemb_40', { acao_proposta: 'reemb_70', resposta: 'ok' }, loja).ok, false)
  assert.equal(validarProposta('reemb_50', { acao_proposta: 'reemb_50', resposta: 'Frete de devolução ≈ 25% (17,50 €). Ofereço 50%.' }, loja).ok, false, 'mapa 5.9: o frete só em dinheiro, nunca a porcentagem')
  assert.equal(validarProposta('reemb_50', { acao_proposta: 'reemb_50', resposta: 'Frete de devolução ≈ 17,50 €. Ofereço 50% (35,00 €).' }, loja).ok, true)
  assert.equal(validarProposta('qual_troca', { acao_proposta: 'qual_troca', resposta: 'Use DANKE15 ou KEEP35.' }, loja).ok, false)
  assert.equal(conferirTextoDaFase('reemb_25', 'Wir haben die Rückerstattung von 25% bereits veranlasst.', loja).ok, false, 'confirmação como fato consumado')
  assert.equal(conferirTextoDaFase('reemb_25', 'Wir bieten eine Rückerstattung von 25% (17,50 €) an — möchten Sie das annehmen?', loja, novoEstado(), pedido1).ok, true)
})

test('edição humana: diferença de oferta só quando percentual/cupom mudam', () => {
  const rascunho = 'Wir bieten 25% (17,50 €) an. Möchten Sie das annehmen?'
  assert.equal(diferencaDeOferta(rascunho, rascunho, loja), null)
  assert.equal(diferencaDeOferta(rascunho, 'Wir bieten Ihnen 25% (17,50 €) an. Annehmen?', loja), null, 'só tom mudou')
  assert.match(diferencaDeOferta(rascunho, 'Wir bieten Ihnen eine Lösung an. Annehmen?', loja), /25%.*nenhum/)
  assert.match(diferencaDeOferta(rascunho, 'Wir bieten 25% und Gutschein KEEP35.', loja), /KEEP35/)
  assert.deepEqual(assinaturaOferta('40% e 25%, cupom WAIT40', loja).pcts, [25, 40])
})

test('instrução de regeneração não pode mexer em oferta, percentual, cupom ou etapa', () => {
  assert.equal(instrucaoAlteraOferta('seja mais curto e cordial', loja), null)
  assert.equal(instrucaoAlteraOferta('', loja), null)
  assert.match(instrucaoAlteraOferta('ofereça 50%', loja), /50%/)
  assert.match(instrucaoAlteraOferta('inclua o cupom KEEP35', loja), /cupom/)
  assert.match(instrucaoAlteraOferta('pule para a próxima etapa', loja), /etapa/)
  assert.match(instrucaoAlteraOferta('diga que o reembolso está aprovado', loja), /reembols/)
})

test('cadência e dias úteis', () => {
  const t0 = Date.parse('2026-09-15T10:00:00Z')
  assert.equal(horarioMinimoEnvio({ data: new Date(t0).toISOString(), historico: [] }, 10, t0), t0 + 10 * 60_000)
  const depois = { data: new Date(t0).toISOString(), resposta: 'oi', historico: [{ autor: 'atendo', corpo: 'x', data: new Date(t0 - 3600_000).toISOString() }] }
  assert.equal(horarioMinimoEnvio(depois, 10, t0 + 60_000), t0 + 5 * 3600_000)
  assert.equal(somarDiasUteis(new Date('2026-09-18T12:00:00Z'), 1).toISOString().slice(0, 10), '2026-09-21')
})

test('exigências positivas: percentual, valor do servidor, cupom cadastrado (nenhum inventado), ação nomeada e prazo', () => {
  const an0 = novoEstado()
  const conferir = (fase, txt) => conferirTextoDaFase(fase, txt, loja, an0, pedido1) // pedido de 70 €
  // percentual obrigatório ausente
  let v = conferir('reemb_40', 'Wir bieten Ihnen eine Rückerstattung von 28,00 € an. Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /percentual obrigatório/)
  // valor em dinheiro diferente do cálculo do servidor (40% de 70 = 28,00)
  v = conferir('reemb_40', 'Rückerstattung von 40% (30,00 €), Sie behalten das Produkt. Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /não corresponde ao cálculo/)
  assert.equal(conferir('reemb_40', 'Rückerstattung von 40% (28,00 €), Sie behalten das Produkt. Ok?').ok, true)
  assert.equal(conferir('reemb_40', 'Refund of 40% (€28.00 of €70.00). Ok?').ok, true, 'formatos de moeda diferentes')
  // ação não nomeada
  v = conferir('reemb_40', 'Wir bieten 40% (28,00 €) an. Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /não nomeia a ação/)
  // troca + cupom + prazo
  assert.equal(conferir('qual_troca', 'Kostenloser Umtausch, Lieferzeit 4 bis 11 Tage, Gutschein DANKE15 (15%). Ok?').ok, true)
  v = conferir('qual_troca', 'Kostenloser Umtausch mit Gutschein DANKE15 (15%). Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /prazo obrigatório/)
  v = conferir('qual_troca', 'Umtausch, 4 bis 11 Tage, Gutschein: FAKE99 (15%). Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /não está cadastrado/, 'cupom inventado')
  v = conferir('qual_troca', 'Umtausch, 4 bis 11 Tage, Gutschein KEEP35 (15%). Ok?')
  assert.equal(v.ok, false, 'código de outra etapa')
  v = conferir('qual_troca', 'Umtausch, 4 bis 11 Tage, mit Gutschein (15%). Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /falta o código do cupom/)
  // 50%: frete só em dinheiro (25% de 70 = 17,50) e o valor de 50% (35,00)
  assert.equal(conferir('reemb_50', 'Rücksendung kostet ca. 17,50 €. Wir bieten eine Rückerstattung von 50% (35,00 €). Ok?').ok, true)
  v = conferir('reemb_50', 'Rücksendung kostet ca. 20,00 €. Rückerstattung von 50% (35,00 €)?')
  assert.equal(v.ok, false); assert.match(v.motivo, /não corresponde/)
  // fases sem oferta não têm exigência positiva (só as negativas)
  assert.equal(conferir('coleta', 'Welches Produkt meinen Sie?').ok, true)
  assert.equal(conferir('endereco', 'Bitte senden Sie Straße, Hausnummer, PLZ und Stadt.').ok, true)
  // utilitários
  assert.deepEqual(valoresMonetarios('17,50 € und €1.500,00 und 1,500.00 USD und 12 EUR und 10115 Berlin'), [17.5, 1500, 1500, 12])
  assert.deepEqual(codigosCitados('Gutschein: FAKE99, código postal 10115, coupon code SORRY25'), ['FAKE99', 'SORRY25'])
})

test('valor em dinheiro obrigatório, ação composta completa, percentual do cupom, frete e prazo da confirmação', () => {
  const an0 = novoEstado()
  const conferir = (fase, txt, extra = an0) => conferirTextoDaFase(fase, txt, loja, extra, pedido1) // pedido de 70 €
  // reembolso: percentual certo mas SEM o valor em dinheiro → bloqueia
  let v = conferir('reemb_25', 'Wir bieten eine Rückerstattung von 25% an. Möchten Sie das annehmen?')
  assert.equal(v.ok, false); assert.match(v.motivo, /falta o valor em dinheiro/); assert.match(v.motivo, /17\.50/)
  assert.equal(conferir('reemb_25', 'Wir bieten eine Rückerstattung von 25% (17,50 €) an. Ok?').ok, true)
  // sem valor do pedido não há como conferir: bloqueia
  v = conferirTextoDaFase('reemb_25', 'Rückerstattung von 25% (17,50 €). Ok?', loja, an0, null)
  assert.equal(v.ok, false); assert.match(v.motivo, /valor do pedido/)
  // troca + reembolso de 20%: as DUAS ações, o percentual e o valor (14,00)
  v = conferir('troca_20', 'Kostenloser Umtausch, 5 bis 11 Tage, plus 20% (14,00 €). Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /"reembolso"/); assert.match(v.motivo, /2 ações/)
  v = conferir('troca_20', 'Rückerstattung von 20% (14,00 €), 5 bis 11 Tage. Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /"troca"/)
  v = conferir('troca_20', 'Kostenloser Umtausch plus Rückerstattung von 20%, 5 bis 11 Tage. Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /falta o valor em dinheiro/)
  assert.equal(conferir('troca_20', 'Kostenloser Umtausch plus Rückerstattung von 20% (14,00 €), Lieferzeit 5 bis 11 Tage. Ok?').ok, true)
  // reenvio + reembolso de 35%: idem (24,50)
  v = conferir('nr_reenvio_35', 'Wir senden das Paket erneut, 4 bis 11 Tage, plus 35% (24,50 €). Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /"reembolso"/)
  assert.equal(conferir('nr_reenvio_35', 'Wir senden das Paket erneut (4 bis 11 Tage) plus Rückerstattung von 35% (24,50 €). Ok?').ok, true)
  // 50%: o frete (17,50) tem de aparecer separado do reembolso (35,00)
  v = conferir('reemb_50', 'Wir bieten eine Rückerstattung von 50% (35,00 €). Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /frete de devolução/)
  assert.equal(conferir('reemb_50', 'Rücksendung ca. 17,50 €; wir bieten eine Rückerstattung von 50% (35,00 €). Ok?').ok, true)
  // cupom: código E percentual
  v = conferir('qual_cupom_35', 'Gutschein KEEP35 für jede Bestellung, Sie behalten das Produkt. Ok?')
  assert.equal(v.ok, false); assert.match(v.motivo, /percentual do cupom \(35%\)/)
  assert.equal(conferir('qual_cupom_35', 'Gutschein KEEP35 (35%) für jede Bestellung, Sie behalten das Produkt. Ok?').ok, true)
  v = conferir('nc_atrasado_25', 'Bitte 5 Werktage Geduld; Gutschein SORRY25 (25%).')
  assert.equal(v.ok, true)
  // confirmação de reembolso/cancelamento: valor exato e 3 a 14 dias
  const anAceite = { ...novoEstado(), acaoAceita: 'reemb_40' }
  v = conferir('conf_reembolso', 'Ihre Rückerstattung von 40% (28,00 €) wurde veranlasst.', anAceite)
  assert.equal(v.ok, false); assert.match(v.motivo, /3 a 14 dias/)
  v = conferir('conf_reembolso', 'Ihre Rückerstattung von 40% wurde veranlasst, 3 bis 14 Tage.', anAceite)
  assert.equal(v.ok, false); assert.match(v.motivo, /falta o valor em dinheiro/)
  assert.equal(conferir('conf_reembolso', 'Ihre Rückerstattung von 40% (28,00 €) wurde veranlasst — in 3 bis 14 Tagen auf Ihrer Zahlungsmethode.', anAceite).ok, true)
  const anCancel = { ...novoEstado(), acaoAceita: 'cancel_nao_processado' }
  v = conferir('conf_cancelamento', 'Ihre Bestellung wurde storniert, 3 bis 14 Tage.', anCancel)
  assert.equal(v.ok, false); assert.match(v.motivo, /falta o valor em dinheiro/)
  assert.equal(conferir('conf_cancelamento', 'Ihre Bestellung wurde storniert; 70,00 € kommen in 3 bis 14 Tagen zurück.', anCancel).ok, true)
})

test('fases sem oferta e ofertas compostas: nenhuma informação do mapa pode ser omitida', () => {
  const an0 = novoEstado()
  const c = (fase, txt, extra = {}) => conferirTextoDaFase(fase, txt, loja, extra.an ?? an0, 'pedido' in extra ? extra.pedido : pedido1, { faltando: extra.faltando })
  const bloqueia = (fase, txt, re, extra) => { const v = c(fase, txt, extra); assert.equal(v.ok, false, `${fase} devia bloquear: ${txt}`); assert.match(v.motivo, re) }
  const passa = (fase, txt, extra) => { const v = c(fase, txt, extra); assert.equal(v.ok, true, `${fase} devia passar: ${txt} — ${v.motivo}`) }

  // conf_troca: endereço confirmado por inteiro + prazo exato da troca
  const anTroca = { ...novoEstado(), acaoAceita: 'tam_troca', enderecoConfirmado: 'Hauptstraße 5, 10115 Berlin' }
  bloqueia('conf_troca', 'Ihr Umtausch ist bestätigt und kommt in 5 bis 11 Tagen an.', /endereço/, { an: anTroca })
  bloqueia('conf_troca', 'Ihr Umtausch ist bestätigt und geht an Hauptstraße 5, 10115 Berlin.', /prazo obrigatório/, { an: anTroca })
  bloqueia('conf_troca', 'Ihr Umtausch (5 bis 11 Tage) geht an Hauptstraße 5.', /faltou "10115 berlin"/, { an: anTroca })
  passa('conf_troca', 'Ihr Umtausch ist bestätigt und kommt in 5 bis 11 Tagen an: Hauptstraße 5, 10115 Berlin.', { an: anTroca })
  bloqueia('conf_troca', 'Umtausch bestätigt, 5 bis 11 Tage.', /não há endereço confirmado/, { an: { ...novoEstado(), acaoAceita: 'tam_troca' } })
  // conf_troca com reembolso parcial (troca + 20%): percentual, valor (14,00) e 3 a 14 dias
  const anTroca20 = { ...anTroca, acaoAceita: 'troca_20' }
  bloqueia('conf_troca', 'Umtausch bestätigt (5 bis 11 Tage) plus Rückerstattung von 20% (14,00 €): Hauptstraße 5, 10115 Berlin.', /3 a 14 dias/, { an: anTroca20 })
  bloqueia('conf_troca', 'Umtausch bestätigt (5 bis 11 Tage) plus Rückerstattung von 20% in 3 bis 14 Tagen: Hauptstraße 5, 10115 Berlin.', /falta o valor em dinheiro/, { an: anTroca20 })
  passa('conf_troca', 'Umtausch bestätigt (5 bis 11 Tage) plus Rückerstattung von 20% (14,00 €) in 3 bis 14 Tagen: Hauptstraße 5, 10115 Berlin.', { an: anTroca20 })
  // conf_troca com cupom (qual_troca): a palavra cupom, o código e o percentual
  const anTrocaCupom = { ...anTroca, acaoAceita: 'qual_troca' }
  bloqueia('conf_troca', 'Umtausch bestätigt (4 bis 11 Tage), DANKE15 (15%): Hauptstraße 5, 10115 Berlin.', /se trata de um cupom/, { an: anTrocaCupom })
  passa('conf_troca', 'Umtausch bestätigt (4 bis 11 Tage) plus Gutschein DANKE15 (15%): Hauptstraße 5, 10115 Berlin.', { an: anTrocaCupom })

  // ofertas compostas com cupom: código solto não basta
  bloqueia('qual_troca', 'Kostenloser Umtausch, 4 bis 11 Tage, DANKE15 (15%). Ok?', /se trata de um cupom/)
  passa('qual_troca', 'Kostenloser Umtausch, 4 bis 11 Tage, Gutschein DANKE15 (15%). Ok?')
  bloqueia('nr_reenvio_30', 'Wir senden das Paket erneut (4 bis 11 Tage), BACK30 (30%). Ok?', /se trata de um cupom/)
  bloqueia('nr_reenvio_30', 'Wir senden das Paket erneut, Gutschein BACK30 (30%). Ok?', /prazo obrigatório/)
  bloqueia('nr_reenvio_30', 'Gutschein BACK30 (30%), 4 bis 11 Tage. Ok?', /"reenvio"/)
  passa('nr_reenvio_30', 'Wir senden das Paket erneut (4 bis 11 Tage) plus Gutschein BACK30 (30%). Ok?')

  // não recebido
  bloqueia('nc_atrasado_25', 'Bitte etwas Geduld; Gutschein SORRY25 (25%).', /5 dias úteis/)
  bloqueia('nc_atrasado_25', 'Bitte noch 5 Tage Geduld; Gutschein SORRY25 (25%).', /5 dias úteis/, undefined)
  passa('nc_atrasado_25', 'Bitte noch maximal 5 Werktage Geduld; als Entschuldigung Gutschein SORRY25 (25%).')
  passa('nc_atrasado_25', 'Please wait at most five more business days; coupon SORRY25 (25%).')
  bloqueia('nr_entregue_aguardar', 'Bitte warten Sie noch etwas.', /2 dias/)
  bloqueia('nr_entregue_aguardar', 'Bitte warten Sie noch 2 Tage.', /vizinhos/)
  bloqueia('nr_entregue_aguardar', 'Bitte warten Sie noch 2 Tage und fragen Sie die Nachbarn; hier ein Gutschein.', /não se oferece/)
  passa('nr_entregue_aguardar', 'Bitte warten Sie noch 2 Tage und fragen Sie bei Nachbarn oder der Rezeption nach.')
  passa('nr_entregue_aguardar', 'Aguarde mais dois dias e verifique com vizinhos ou na portaria.')
  // dentro do prazo: prazo + data provável do servidor (pedido1 despachado 22/08 → 28/08/2026), sem benefício
  assert.equal(prazoDoPedido(pedido1, loja, agora).provavel, '2026-08-28')
  bloqueia('nc_no_prazo', 'Ihre Bestellung kommt voraussichtlich am 28.08.2026 an.', /dentro do prazo/)
  bloqueia('nc_no_prazo', 'Ihre Bestellung ist noch innerhalb der Lieferzeit.', /data provável/)
  bloqueia('nc_no_prazo', 'Ihre Bestellung ist innerhalb der Lieferzeit, voraussichtlich am 27.08.2026.', /data provável/)
  bloqueia('nc_no_prazo', 'Innerhalb der Lieferzeit, voraussichtlich am 28.08.2026 — als Entschuldigung ein Gutschein.', /não se oferece cupom/)
  bloqueia('nc_no_prazo', 'Innerhalb der Lieferzeit, voraussichtlich am 28.08.2026.', /sem pedido/, { pedido: null })
  passa('nc_no_prazo', 'Ihre Bestellung ist innerhalb der Lieferzeit und kommt voraussichtlich am 28.08.2026 an.')
  passa('nc_no_prazo', 'Still within the delivery window; expected around August 28.')
  passa('nc_no_prazo', 'Seu pedido está dentro do prazo; previsão de chegada em 28 de agosto de 2026.')
  assert.equal(mencionaData('le 28/08/2026', '2026-08-28'), true); assert.equal(mencionaData('28 août', '2026-08-28'), true); assert.equal(mencionaData('29.08.2026', '2026-08-28'), false)

  // coleta / tamanho / foto / endereço
  bloqueia('coleta', 'Können Sie mir mehr sagen?', /pedir o número do pedido/, { faltando: ['pedido'] })
  passa('coleta', 'Bitte nennen Sie Ihre Bestellnummer.', { faltando: ['pedido'] })
  bloqueia('coleta', 'Welchen Artikel meinen Sie?', /pedir o motivo/, { faltando: ['produtos', 'motivo'] })
  passa('coleta', 'Welchen Artikel meinen Sie, und was ist der Grund?', { faltando: ['produtos', 'motivo'] })
  bloqueia('coleta', 'Danke für die Info.', /PERGUNTAR/, { faltando: [] })
  bloqueia('tam_ajuste', 'Ist das Polo zu klein?', /PEQUENO ou GRANDE/)
  passa('tam_ajuste', 'Ist das Polo zu klein oder zu groß?')
  bloqueia('def_foto', 'Bitte beschreiben Sie den Schaden.', /foto/)
  passa('def_foto', 'Bitte senden Sie ein Foto des Schadens.')
  bloqueia('endereco', 'Bitte senden Sie Ihre Adresse.', /COMPLETO/, { faltando: [] })
  passa('endereco', 'Bitte senden Sie Ihre vollständige Adresse.', { faltando: [] })
  passa('endereco', 'Bitte Straße und Hausnummer, Postleitzahl und Stadt.', { faltando: [] })
  bloqueia('endereco', 'Bitte die Postleitzahl.', /rua e número/, { faltando: ['end_rua', 'end_cep'] })
  passa('endereco', 'Bitte Straße, Hausnummer und Postleitzahl.', { faltando: ['end_rua', 'end_cep'] })
  // todas as fases sem oferta têm exigência própria: nenhuma passa com texto vazio de conteúdo
  for (const id of Object.keys(FASES).filter(id => !FASES[id].oferta && FASES[id].instrucao && !FASES[id].confirmacao)) {
    assert.equal(c(id, 'Vielen Dank für Ihre Nachricht.', { faltando: ['pedido'] }).ok, false, `${id}: texto vazio de conteúdo não pode passar`)
  }
})

test('confirmação: só depois do aceite; fato consumado só ali e só com os números da opção aceita; depois, mensagem nova vai ao dono', () => {
  let r = rodada(novoEstado(), { intencao: 'pede_reembolso', motivo: 'qualidade' })
  r = rodada(r.an, { intencao: 'recusa' }); r = rodada(r.an, { intencao: 'recusa' })
  r = rodada(r.an, { intencao: 'aceita' })
  assert.equal(r.an.acaoAceita, 'reemb_25'); assert.equal(faseDeConfirmacao(r.an.acaoAceita), 'conf_reembolso')
  const an = r.an
  assert.equal(conferirTextoDaFase('conf_reembolso', 'Ihre Rückerstattung von 25% (17,50 €) wurde veranlasst — 3 bis 14 Tage.', loja, an, pedido1).ok, true, 'na confirmação pode falar de fato consumado')
  assert.equal(conferirTextoDaFase('conf_reembolso', 'Rückerstattung von 40% veranlasst.', loja, an, pedido1).ok, false, 'mas só com o percentual aceito')
  assert.equal(conferirTextoDaFase('reemb_25', 'Ihre Rückerstattung von 25% (17,50 €) wurde veranlasst.', loja, an, pedido1).ok, false, 'fora da confirmação continua proibido')
  assert.equal(faseDeConfirmacao(null), null); assert.equal(faseDeConfirmacao('coleta'), null)
  // o prompt da confirmação leva os prazos do mapa
  const ticket = { nome: 'X', corpo: 'ok', historico: [] }
  const q = promptEscrever({ loja, config: {}, faseId: 'conf_reembolso', an, pedido: pedido1, ticket })
  assert.match(q.system, /CONFIRMAÇÃO/); assert.match(q.system, /3 a 14 dias/); assert.match(q.system, /25% = 17,50 €/)
  const anTroca = { ...novoEstado(), acaoAceita: 'tam_troca', enderecoConfirmado: 'Hauptstr. 5, 10115 Berlin', produtosAfetados: ['Polo'] }
  const p = promptEscrever({ loja, config: {}, faseId: 'conf_troca', an: anTroca, pedido: pedido1, ticket })
  assert.match(p.system, /5 a 11 dias/); assert.match(p.system, /Hauptstr\. 5/); assert.doesNotMatch(p.system, /Prazo para o dinheiro voltar/)
  // enviada a confirmação, o caso fecha: mensagem nova vai ao dono sem reabrir a escada
  confirmarTransicao(an, { para: 'conf_reembolso', mensagem: 'aceite aprovado', agora })
  assert.equal(an.aguardando, null)
  const depois = decidir({ an, cls: { intencao: 'informa', resumo: 'e agora?' }, pedido: pedido1, loja, agora })
  assert.match(depois.humano, /confirmad/); assert.equal(depois.fase, null)
  // cada tipo de opção tem a sua confirmação; 100% e cancelamento chegam ao dono com a ação pendente registrada
  assert.equal(faseDeConfirmacao('tam_troca'), 'conf_troca'); assert.equal(faseDeConfirmacao('nr_reenvio_20'), 'conf_troca')
  assert.equal(faseDeConfirmacao('qual_cupom_35'), 'conf_cupom'); assert.equal(faseDeConfirmacao('reemb_100'), 'conf_reembolso')
  assert.equal(faseDeConfirmacao('cancel_nao_processado'), 'conf_cancelamento')
  const h = rodada(novoEstado(), { intencao: 'pede_cancelamento' }, { pedido: { ...pedido1, status: 'aguardando', despachadoEm: null } })
  assert.equal(h.an.acaoAceita, 'cancel_nao_processado')
})

test('mapa de fases consistente', () => {
  for (const [id, f] of Object.entries(FASES)) {
    if (f.aoRecusar) assert.ok(FASES[f.aoRecusar], `${id}.aoRecusar aponta para fase inexistente`)
    if (f.confirmacao) assert.ok(!f.oferta && !f.aoAceitar && !f.aoRecusar, `${id}: confirmação não oferece nem leva a lugar nenhum`)
    if (f.oferta && !['endereco'].includes(id)) assert.ok(faseDeConfirmacao(id), `${id}: toda oferta precisa de uma confirmação`)
  }
})
