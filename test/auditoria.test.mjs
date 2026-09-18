// Auditoria da IA (shared/auditoria.js): registro append-only, checklist da
// resposta e linha do tempo. Lógica pura — nenhuma rede, nenhum servidor.
// A auditoria observa: nada aqui decide, envia ou muda fase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TIPOS_AUDITORIA, novoEvento, registrarEvento, checklistDaResposta, ITENS_CHECKLIST,
  linhaDoTempo, passosCompactos, seloDaConversa, filtrosDaAuditoria, filtrarConversas, ROTULO_GERAL,
} from '../shared/auditoria.js'

const EM = '2026-09-18T12:00:00.000Z'
const ev = (tipo, extra = {}) => novoEvento({ tipo, ticketId: 't1', lojaId: 'loja1', em: EM, ...extra })

test('os 18 tipos obrigatórios existem e um tipo desconhecido é recusado', () => {
  const esperados = [
    'cliente_recebido', 'ia_classificou', 'motor_decidiu', 'rascunho_gerado', 'rascunho_validado',
    'rascunho_bloqueado', 'envio_agendado', 'envio_reagendado', 'envio_iniciado', 'email_enviado',
    'envio_falhou', 'cliente_aceitou', 'cliente_recusou', 'aguardando_aprovacao', 'aprovado_pelo_dono',
    'respondido_manualmente', 'fase_confirmada', 'caso_encerrado',
  ]
  assert.deepEqual(TIPOS_AUDITORIA, esperados)
  assert.equal(TIPOS_AUDITORIA.length, 18)
  assert.throws(() => novoEvento({ tipo: 'inventado' }), /tipo de auditoria desconhecido/)
})

test('todo evento tem id, data, tipo, loja, ticket, fase, jornada, resumo, situação e dados', () => {
  const e = ev('ia_classificou', { fase: 'qual_troca', jornada: 'qualidade', resumo: 'IA entendeu', situacao: 'ok', dados: { intencao: 'reclamacao' } })
  for (const campo of ['id', 'em', 'tipo', 'lojaId', 'ticketId', 'fase', 'jornada', 'resumo', 'situacao', 'dados', 'chave']) {
    assert.ok(campo in e, 'falta ' + campo)
  }
  assert.equal(e.em, EM)
  assert.equal(e.situacao, 'ok')
  assert.equal(e.dados.intencao, 'reclamacao')
  // situação inválida vira informativo, nunca quebra o pipeline
  assert.equal(ev('cliente_recebido', { situacao: 'qualquer' }).situacao, 'informativo')
})

test('append-only: nada é editado ou apagado, e a chave idempotente não duplica', () => {
  let lista = []
  lista = registrarEvento(lista, ev('cliente_recebido', { chave: 'a' }))
  lista = registrarEvento(lista, ev('ia_classificou', { chave: 'b' }))
  const antes = JSON.stringify(lista)
  // a atualização automática tenta registrar o MESMO acontecimento de novo
  lista = registrarEvento(lista, ev('cliente_recebido', { chave: 'a', resumo: 'outro texto' }))
  assert.equal(lista.length, 2, 'evento repetido não entra')
  assert.equal(JSON.stringify(lista), antes, 'nada do que já estava lá mudou')
  lista = registrarEvento(lista, ev('email_enviado', { chave: 'c' }))
  assert.deepEqual(lista.map(e => e.tipo), ['cliente_recebido', 'ia_classificou', 'email_enviado'])
})

test('checklist: 16 itens, cores e resultado geral', () => {
  assert.equal(ITENS_CHECKLIST.length, 16)
  const tudoOk = Object.fromEntries(ITENS_CHECKLIST.map(([id]) => [id, true]))
  const c1 = checklistDaResposta({ ...tudoOk, enviado: true })
  assert.equal(c1.geral, 'tudo_certo')
  assert.equal(ROTULO_GERAL[c1.geral], 'Tudo certo')
  assert.ok(c1.itens.every(i => i.estado === 'verde'))

  const c2 = checklistDaResposta({ ...tudoOk, foto: 'atencao' })
  assert.equal(c2.geral, 'revisar')
  assert.equal(c2.itens.find(i => i.id === 'foto').estado, 'amarelo')

  const c3 = checklistDaResposta({ ...tudoOk, idioma: false, detalhes: { idioma: 'resposta em alemão, cliente escreveu em francês' } })
  assert.equal(c3.geral, 'bloqueado')
  assert.equal(ROTULO_GERAL[c3.geral], 'Bloqueado — não foi enviado')
  assert.equal(c3.itens.find(i => i.id === 'idioma').detalhe, 'resposta em alemão, cliente escreveu em francês')

  // null = não se aplica (cinza) e não derruba o resultado
  const c4 = checklistDaResposta({ ...tudoOk, cupom: null, endereco: null, foto: null })
  assert.equal(c4.geral, 'tudo_certo')
  assert.equal(c4.itens.find(i => i.id === 'cupom').estado, 'cinza')
})

test('percentual, valor e cupom errados aparecem bloqueados', () => {
  const tudoOk = Object.fromEntries(ITENS_CHECKLIST.map(([id]) => [id, true]))
  for (const item of ['percentual', 'valor', 'cupom']) {
    const c = checklistDaResposta({ ...tudoOk, [item]: false })
    assert.equal(c.geral, 'bloqueado', item)
    assert.equal(c.itens.find(i => i.id === item).estado, 'vermelho', item)
  }
})

test('linha do tempo: cliente à esquerda, IA e você à direita, e rascunho NUNCA como enviado', () => {
  const t = {
    id: 't1', idioma: 'de', status: 'aprovacao', enviaEm: Date.parse('2026-09-18T13:00:00Z'),
    historico: [
      { autor: 'cliente', corpo: 'Zu klein', data: '2026-09-18T10:00:00.000Z' },
      { autor: 'atendo', corpo: 'Wir tauschen um', data: '2026-09-18T11:00:00.000Z', origem: 'ia' },
      { autor: 'atendo', corpo: 'Escrevi eu', data: '2026-09-18T11:30:00.000Z', origem: 'manual' },
    ],
    rascunho: 'Rascunho novo',
    atendimentoNovo: { transicaoPendente: { para: 'tam_troca' }, proximoEnvioMinimo: '2026-09-18T13:00:00.000Z', rascunhoIdioma: 'de' },
    auditoriaIA: [ev('email_enviado', { em: '2026-09-18T11:00:00.000Z', dados: { minimoEnvio: '2026-09-18T10:03:00.000Z' } })],
  }
  const linha = linhaDoTempo(t)
  assert.equal(linha[0].lado, 'esquerda')
  assert.equal(linha[0].origem, 'cliente')
  assert.equal(linha[1].lado, 'direita')
  assert.equal(linha[1].origem, 'ia')
  assert.equal(linha[2].rotuloOrigem, 'Você', 'resposta manual aparece como Você')
  const rascunho = linha.find(m => m.chave === 'rascunho')
  assert.ok(rascunho)
  assert.equal(rascunho.situacao, 'agendada')
  assert.equal(rascunho.naoEnviado, true)
  assert.notEqual(rascunho.situacao, 'enviada', 'rascunho jamais aparece como enviado')
  // horários do envio real: mínimo, real e diferença
  const enviada = linha[1]
  assert.equal(enviada.minimoEnvio, '2026-09-18T10:03:00.000Z')
  assert.equal(enviada.envioReal, '2026-09-18T11:00:00.000Z')
  assert.equal(enviada.atrasoMs, 57 * 60_000)
})

test('rascunho bloqueado aparece como bloqueado, com o motivo, e nunca como enviado', () => {
  const t = {
    id: 't2', status: 'humano', rascunho: 'Texto que não saiu',
    atendimentoNovo: { transicaoPendente: { para: 'qual_troca' }, envioBloqueado: 'cupom de 15% não conferido' },
    auditoriaIA: [ev('rascunho_bloqueado', { resumo: 'cupom de 15% não conferido', situacao: 'bloqueado' })],
    historico: [],
  }
  const linha = linhaDoTempo(t)
  const m = linha.find(x => x.chave === 'rascunho')
  assert.equal(m.situacao, 'bloqueada')
  assert.equal(m.naoEnviado, true)
  assert.match(m.motivo, /cupom de 15%/)
  assert.equal(seloDaConversa(t.auditoriaIA), 'bloqueado')
})

test('falha de envio vira mensagem vermelha e não gera "enviada"', () => {
  const t = {
    id: 't3', historico: [],
    auditoriaIA: [ev('envio_falhou', { resumo: 'Falha no envio: SMTP fora', dados: { erro: 'SMTP fora', texto: 'oi' } })],
  }
  const linha = linhaDoTempo(t)
  assert.equal(linha.length, 1)
  assert.equal(linha[0].situacao, 'falha')
  assert.equal(linha[0].naoEnviado, true)
  assert.ok(!linha.some(m => m.situacao === 'enviada'))
})

test('passos compactos mostram a sequência e avisam quando foi bloqueada', () => {
  const ok = ['ia_classificou', 'motor_decidiu', 'rascunho_validado', 'envio_agendado', 'email_enviado'].map(t2 => ev(t2))
  assert.equal(passosCompactos(ok), 'IA classificou → servidor escolheu a fase → resposta validada → agendada → enviada')
  const bloqueado = [ev('ia_classificou'), ev('motor_decidiu'), ev('rascunho_bloqueado')]
  assert.match(passosCompactos(bloqueado), /bloqueada — não foi enviada$/)
})

test('selo da conversa vem do último checklist registrado', () => {
  const eventos = [
    ev('rascunho_validado', { dados: { checklist: { geral: 'revisar', itens: [], enviado: false } } }),
    ev('email_enviado', { dados: { checklist: { geral: 'tudo_certo', itens: [], enviado: true } } }),
  ]
  assert.equal(seloDaConversa(eventos), 'tudo_certo')
  assert.equal(seloDaConversa([]), 'sem_dados')
})

test('filtros: período 7/30/90, situação e os três "somente"', () => {
  const f = filtrosDaAuditoria({ dias: '30', situacao: 'revisar', soErro: 'true', pagina: '2' })
  assert.equal(f.dias, 30)
  assert.equal(f.situacao, 'revisar')
  assert.equal(f.soErro, true)
  assert.equal(f.pagina, 2)
  assert.equal(filtrosDaAuditoria({ dias: '5' }).dias, 7, 'período inválido cai em 7 dias')
  assert.equal(filtrosDaAuditoria({}).classico, false, 'clássico só quando pedido')

  const lista = [
    { ticketId: 'a', motor: 'novo', cliente: 'Ana', email: 'ana@web.de', pedido: '1001', lojaId: 'l1', jornada: 'qualidade', fase: 'qual_troca', idioma: 'de', selo: 'tudo_certo', aguardandoAprovacao: false, envioAutomatico: true },
    { ticketId: 'b', motor: 'novo', cliente: 'Bruno', email: 'b@web.de', pedido: '1002', lojaId: 'l2', jornada: 'tamanho', fase: 'tam_troca', idioma: 'fr', selo: 'bloqueado', aguardandoAprovacao: true, envioAutomatico: false },
    { ticketId: 'c', motor: 'classico', cliente: 'Carla', email: 'c@web.de', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', selo: 'sem_dados', aguardandoAprovacao: false, envioAutomatico: false },
  ]
  const padrao = filtrarConversas(lista, filtrosDaAuditoria({}))
  assert.deepEqual(padrao.map(c => c.ticketId), ['a', 'b'], 'clássico fica fora por padrão')
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ classico: true })).map(c => c.ticketId), ['a', 'b', 'c'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ soErro: true })).map(c => c.ticketId), ['b'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ soAprovacao: true })).map(c => c.ticketId), ['b'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ soAutomaticos: true })).map(c => c.ticketId), ['a'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ busca: 'ana@web.de' })).map(c => c.ticketId), ['a'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ loja: 'l2' })).map(c => c.ticketId), ['b'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ idioma: 'fr' })).map(c => c.ticketId), ['b'])
})

test('conversa sem auditoria detalhada não ganha classificação inventada', () => {
  const t = {
    id: 'velho', historico: [{ autor: 'cliente', corpo: 'oi', data: '2026-09-01T10:00:00.000Z' }],
    atendimentoNovo: { etapa: 'qual_troca', historicoEtapas: [{ de: null, para: 'qual_troca', em: '2026-09-01T11:00:00.000Z' }] },
  }
  const linha = linhaDoTempo(t)
  assert.equal(linha.length, 1, 'só a mensagem que existe de verdade')
  assert.equal(passosCompactos(t.auditoriaIA ?? []), '', 'nenhum passo é inventado')
  assert.equal(seloDaConversa(t.auditoriaIA ?? []), 'sem_dados')
})

test('o corpo do cliente é devolvido como TEXTO — nada de HTML executável', () => {
  const t = {
    id: 't4',
    historico: [{ autor: 'cliente', corpo: '<img src=x onerror="window.x=1"><script>alert(1)</script>', data: '2026-09-18T10:00:00.000Z' }],
  }
  const m = linhaDoTempo(t)[0]
  assert.equal(typeof m.corpo, 'string')
  assert.match(m.corpo, /<script>/, 'o texto original é preservado como dado')
  // a auditoria nunca entrega HTML pronto para injetar: é string, a tela escapa
  assert.ok(!('html' in m))
})
