// Motor de etapas do atendimento novo — funções puras, sem servidor nem IA.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  novoEstado, decidir, confirmarTransicao, validarProposta, prazoDoPedido, somarDiasUteis,
  horarioMinimoEnvio, FASES, validarEndereco, conferirTextoDaFase, diferencaDeOferta,
  instrucaoAlteraOferta, assinaturaOferta,
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
  r = rodada(r.an, { intencao: 'pede_reembolso' }, { pedido: entregue }); assert.equal(r.fase, 'nr_reenvio_20')
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
  assert.equal(validarProposta('reemb_50', { acao_proposta: 'reemb_50', resposta: 'Frete de devolução ≈ 25% (17,50 €). Ofereço 50%.' }, loja).ok, true)
  assert.equal(validarProposta('qual_troca', { acao_proposta: 'qual_troca', resposta: 'Use DANKE15 ou KEEP35.' }, loja).ok, false)
  assert.equal(conferirTextoDaFase('reemb_25', 'Wir haben die Rückerstattung von 25% bereits veranlasst.', loja).ok, false, 'confirmação como fato consumado')
  assert.equal(conferirTextoDaFase('reemb_25', 'Wir bieten 25% (17,50 €) an — möchten Sie das annehmen?', loja).ok, true)
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

test('mapa de fases consistente', () => {
  for (const [id, f] of Object.entries(FASES)) {
    if (f.aoRecusar) assert.ok(FASES[f.aoRecusar], `${id}.aoRecusar aponta para fase inexistente`)
  }
})
