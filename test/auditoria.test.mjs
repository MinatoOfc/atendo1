// Auditoria da IA (shared/auditoria.js): registro append-only, checklist da
// resposta e linha do tempo. Lógica pura — nenhuma rede, nenhum servidor.
// A auditoria observa: nada aqui decide, envia ou muda fase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TIPOS_AUDITORIA, novoEvento, registrarEvento, checklistDaResposta, ITENS_CHECKLIST,
  linhaDoTempo, passosCompactos, seloDaConversa, filtrosDaAuditoria, filtrarConversas, ROTULO_GERAL,
  ROTULO_SELO, tentativaAtual, eventosDaTentativa, checklistDaTentativa, origemDoEnvio,
  cicloAtual, eventosDoCiclo,
} from '../shared/auditoria.js'

const EM = '2026-09-18T12:00:00.000Z'
const ev = (tipo, extra = {}) => novoEvento({ tipo, ticketId: 't1', lojaId: 'loja1', em: EM, ...extra })

test('os 18 tipos obrigatórios existem, mais "caso_para_humano", e um tipo desconhecido é recusado', () => {
  const esperados = [
    'cliente_recebido', 'ia_classificou', 'motor_decidiu', 'rascunho_gerado', 'rascunho_validado',
    'rascunho_bloqueado', 'envio_agendado', 'envio_reagendado', 'envio_iniciado', 'email_enviado',
    'envio_falhou', 'cliente_aceitou', 'cliente_recusou', 'aguardando_aprovacao', 'aprovado_pelo_dono',
    'respondido_manualmente', 'fase_confirmada', 'caso_encerrado',
    // o caso voltou para você: classificação que falhou, IA pausada ou decisão do motor
    'caso_para_humano',
    // releitura da mensagem depois de um conserto do sistema
    'correcao_do_sistema',
    // o dono devolveu a conversa para a IA, com ciclo e tentativa novos
    'ia_retomada',
  ]
  assert.deepEqual(TIPOS_AUDITORIA, esperados)
  assert.equal(TIPOS_AUDITORIA.length, 21)
  for (const t of esperados.slice(0, 18)) assert.ok(TIPOS_AUDITORIA.includes(t), 'os 18 originais continuam: ' + t)
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

test('checklist: 19 itens, cores e resultado geral', () => {
  // 19: os tres ultimos entraram com a trava de tamanho (#2749)
  assert.equal(ITENS_CHECKLIST.length, 19)
  for (const id of ['direcao_ajuste', 'tamanho_coerente', 'variante_catalogo']) {
    assert.ok(ITENS_CHECKLIST.some(([x]) => x === id), 'o checklist tem ' + id)
  }
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

test('rascunho VALIDADO que espera aprovação é âmbar, nunca vermelho', () => {
  // o validador aprovou o texto; o que falta é o clique do dono. Vermelho aqui
  // fazia a Auditoria dizer "Bloqueada" para uma resposta que está só na fila.
  const t = {
    id: 'amb', status: 'aprovacao', rascunho: 'Welche der beiden Polohemden meinen Sie?',
    atendimentoNovo: {
      tentativaAtual: 'tent-1', transicaoPendente: { para: 'coleta' },
      aprovacaoObrigatoria: 'releitura da mensagem depois de uma correção — aprovação humana obrigatória',
    },
    auditoriaIA: [ev('rascunho_validado', { resumo: 'validado', situacao: 'ok', dados: { tentativaId: 'tent-1', enviado: false } })],
    historico: [],
  }
  const m = linhaDoTempo(t).find(x => x.chave === 'rascunho')
  assert.equal(m.situacao, 'aguardando_aprovacao')
  assert.equal(m.naoEnviado, true)
  assert.match(m.motivo, /aprovação humana obrigatória/)

  // envio automático desligado no piloto também é espera, não proibição
  const piloto = { ...t, atendimentoNovo: { tentativaAtual: 'tent-1', transicaoPendente: { para: 'coleta' }, envioBloqueado: 'envio automático bloqueado durante o piloto' } }
  assert.equal(linhaDoTempo(piloto).find(x => x.chave === 'rascunho').situacao, 'aguardando_aprovacao')

  // e uma tentativa que FOI recusada e depois validada de novo não fica vermelha
  const recuperado = {
    ...t,
    auditoriaIA: [
      ev('rascunho_bloqueado', { resumo: 'cupom não conferido', situacao: 'bloqueado', dados: { tentativaId: 'tent-1' } }),
      ev('rascunho_validado', { resumo: 'validado', situacao: 'ok', dados: { tentativaId: 'tent-1', enviado: false } }),
    ],
  }
  assert.equal(linhaDoTempo(recuperado).find(x => x.chave === 'rascunho').situacao, 'aguardando_aprovacao')

  // agendado continua agendado
  const agendado = { ...t, enviaEm: Date.parse('2026-09-19T12:00:00.000Z') }
  assert.equal(linhaDoTempo(agendado).find(x => x.chave === 'rascunho').situacao, 'agendada')
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

test('selo sem tentativa registrada: só vira "tudo certo" com a prova do envio', () => {
  // eventos antigos, sem tentativaId: o selo ainda exige prova do envio
  const semProva = [
    ev('rascunho_validado', { dados: { checklist: { geral: 'revisar', itens: [], enviado: false } } }),
    ev('email_enviado', { dados: { checklist: { geral: 'tudo_certo', itens: [], enviado: true } } }),
  ]
  assert.equal(seloDaConversa(semProva), 'revisar', 'sem Message-ID não há comprovação')
  const comProva = [
    ev('rascunho_validado', { dados: { checklist: { geral: 'tudo_certo', itens: [], enviado: false } } }),
    ev('email_enviado', { dados: { mensagemId: 'atendo-1', enviado: true, canalConfirmou: true, checklist: { geral: 'tudo_certo', itens: [], enviado: true } } }),
  ]
  assert.equal(seloDaConversa(comProva), 'tudo_certo')
  assert.equal(seloDaConversa([]), 'sem_dados')
  // sem tentativaId, eventosDaTentativa cai para os eventos de ciclo
  assert.equal(eventosDaTentativa(comProva).length, 2)
  assert.equal(tentativaAtual(comProva), null)
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
    { ticketId: 'a', motor: 'novo', cliente: 'Ana', email: 'ana@web.de', pedido: '1001', lojaId: 'l1', jornada: 'qualidade', fase: 'qual_troca', idioma: 'de', selo: 'tudo_certo', aguardandoAprovacao: false, envioAutomatico: true, origemEnvio: 'automatico' },
    { ticketId: 'b', motor: 'novo', cliente: 'Bruno', email: 'b@web.de', pedido: '1002', lojaId: 'l2', jornada: 'tamanho', fase: 'tam_troca', idioma: 'fr', selo: 'bloqueado', aguardandoAprovacao: true, envioAutomatico: false, origemEnvio: null },
    { ticketId: 'c', motor: 'classico', cliente: 'Carla', email: 'c@web.de', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', selo: 'sem_dados', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: null },
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

  // os dois estados novos entram no filtro
  assert.equal(filtrosDaAuditoria({ situacao: 'aguardando' }).situacao, 'aguardando')
  assert.equal(filtrosDaAuditoria({ situacao: 'agendada' }).situacao, 'agendada')
  assert.equal(filtrosDaAuditoria({ situacao: 'inventada' }).situacao, 'todas')
  const lista2 = [
    { ticketId: 'ag', motor: 'novo', selo: 'aguardando', cliente: '', email: '', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', aguardandoAprovacao: true, envioAutomatico: false, origemEnvio: null },
    { ticketId: 'sc', motor: 'novo', selo: 'agendada', cliente: '', email: '', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: null },
  ]
  assert.deepEqual(filtrarConversas(lista2, filtrosDaAuditoria({ situacao: 'aguardando' })).map(c => c.ticketId), ['ag'])
  assert.deepEqual(filtrarConversas(lista2, filtrosDaAuditoria({ situacao: 'agendada' })).map(c => c.ticketId), ['sc'])
})

test('"somente enviados automaticamente" usa a evidência do envio, não a configuração de hoje', () => {
  // a loja DESLIGOU o envio automático hoje; o que saiu sozinho ontem continua saindo no filtro
  const lista = [
    { ticketId: 'auto', motor: 'novo', selo: 'tudo_certo', cliente: '', email: '', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: 'automatico' },
    { ticketId: 'aprovada', motor: 'novo', selo: 'tudo_certo', cliente: '', email: '', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', aguardandoAprovacao: false, envioAutomatico: true, origemEnvio: 'aprovado_pelo_dono' },
    { ticketId: 'manual', motor: 'novo', selo: 'tudo_certo', cliente: '', email: '', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'pt', aguardandoAprovacao: false, envioAutomatico: true, origemEnvio: 'manual' },
  ]
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ soAutomaticos: true })).map(c => c.ticketId), ['auto'])

  const ev = (tipo, dados) => novoEvento({ tipo, ticketId: 't', resumo: tipo, dados })
  assert.equal(origemDoEnvio([ev('email_enviado', { origemEnvio: 'aprovado_pelo_dono' })]), 'aprovado_pelo_dono')
  // vale sempre o ÚLTIMO envio da conversa
  assert.equal(origemDoEnvio([
    ev('email_enviado', { origemEnvio: 'automatico' }),
    ev('email_enviado', { origemEnvio: 'manual' }),
  ]), 'manual')
  assert.equal(origemDoEnvio([ev('rascunho_validado', {})]), null, 'sem envio, sem origem')
  assert.equal(origemDoEnvio([ev('email_enviado', {})]), null, 'registro antigo não inventa origem')
})

test('selo compara a ORDEM dos eventos, não o relógio (mesmo milissegundo)', () => {
  const em = '2026-09-18T10:00:00.000Z'
  const base = { tentativaId: 'tent-1', mensagemId: 'm1', enviado: true, canalConfirmou: true, checklist: { itens: [], geral: 'tudo_certo', enviado: true } }
  const ev = (tipo, dados, resumo = tipo) => ({ ...novoEvento({ tipo, ticketId: 't', resumo, dados }), em })

  // falha DEPOIS do envio no vetor append-only: a conversa está bloqueada
  assert.equal(seloDaConversa([
    ev('email_enviado', base),
    ev('envio_falhou', { tentativaId: 'tent-1' }),
  ]), 'bloqueado')

  // falha ANTES e envio DEPOIS, no mesmo milissegundo: vale o envio
  assert.equal(seloDaConversa([
    ev('envio_falhou', { tentativaId: 'tent-1' }),
    ev('email_enviado', base),
  ]), 'tudo_certo')

  // bloqueio no mesmo milissegundo, depois do envio
  assert.equal(seloDaConversa([
    ev('email_enviado', base),
    ev('rascunho_bloqueado', { tentativaId: 'tent-1' }),
  ]), 'bloqueado')

  // bloqueio de uma tentativa ANTIGA não afeta a tentativa atual
  assert.equal(seloDaConversa([
    ev('rascunho_bloqueado', { tentativaId: 'tent-1' }),
    ev('email_enviado', { ...base, tentativaId: 'tent-2', mensagemId: 'm2' }),
  ]), 'tudo_certo')
})

test('"Tudo certo" exige confirmação explícita do canal', () => {
  const checklist = { itens: [], geral: 'tudo_certo', enviado: true }
  const ev = (tipo, dados) => novoEvento({ tipo, ticketId: 't', resumo: tipo, dados })
  const completo = { tentativaId: 'tent-1', mensagemId: 'm1', enviado: true, canalConfirmou: true, checklist }
  assert.equal(seloDaConversa([ev('email_enviado', completo)]), 'tudo_certo')
  // sem canalConfirmou (registro antigo ou envio não comprovado) fica em "Revisar"
  assert.equal(seloDaConversa([ev('email_enviado', { ...completo, canalConfirmou: undefined })]), 'revisar')
  assert.equal(seloDaConversa([ev('email_enviado', { ...completo, canalConfirmou: false })]), 'revisar')
  assert.equal(seloDaConversa([ev('email_enviado', { ...completo, mensagemId: null })]), 'revisar')
  assert.equal(seloDaConversa([ev('email_enviado', { ...completo, checklist: null })]), 'revisar')
})

test('checklist mostrado é o da tentativa atual — nunca o verde de uma tentativa anterior', () => {
  const verde = { itens: [{ id: 'idioma', rotulo: 'Idioma', estado: 'verde', detalhe: null }], geral: 'tudo_certo', enviado: true }
  const ev = (tipo, dados, resumo = tipo) => novoEvento({ tipo, ticketId: 't', resumo, dados })

  // tentativa 1 terminou bem; a tentativa 2 foi bloqueada ANTES de gerar checklist
  const eventos = [
    ev('rascunho_validado', { tentativaId: 'tent-1', checklist: verde }),
    ev('email_enviado', { tentativaId: 'tent-1', mensagemId: 'm1', enviado: true, canalConfirmou: true, checklist: verde }),
    ev('rascunho_bloqueado', { tentativaId: 'tent-2' }, 'Cupom da etapa não existe na Shopify'),
  ]
  const r = checklistDaTentativa(eventos)
  assert.equal(r.checklist, null, 'não reaproveita o checklist verde de tent-1')
  assert.equal(r.concluido, false)
  assert.equal(r.motivo, 'Cupom da etapa não existe na Shopify')
  assert.equal(r.tentativaId, 'tent-2')
  assert.equal(seloDaConversa(eventos), 'bloqueado')

  // já com checklist na tentativa atual, é esse que aparece
  const eventos2 = [...eventos, ev('rascunho_validado', { tentativaId: 'tent-2', checklist: { ...verde, geral: 'revisar' } })]
  const r2 = checklistDaTentativa(eventos2)
  assert.equal(r2.concluido, true)
  assert.equal(r2.checklist.geral, 'revisar')
  assert.equal(r2.tentativaId, 'tent-2')
})

/* ---------------- ciclo de auditoria (uma mensagem do cliente = um ciclo) ---------------- */

const evC = (tipo, ciclo, dados = {}, extra = {}) => novoEvento({
  tipo, ticketId: 't1', lojaId: 'loja1', em: EM, resumo: extra.resumo ?? tipo,
  situacao: extra.situacao ?? 'informativo', dados: { cicloId: ciclo, ...dados },
})
const checklistVerde = () => ({ itens: [{ id: 'idioma', rotulo: 'Idioma', estado: 'verde', detalhe: null }], geral: 'tudo_certo', enviado: true })
// ciclo 1 inteiro: chegou, classificou, decidiu, validou e ENVIOU com prova
const cicloVerde = () => [
  evC('cliente_recebido', 'c1'),
  evC('ia_classificou', 'c1', { intencao: 'reclamacao' }),
  evC('motor_decidiu', 'c1', { faseUnicaPermitida: 'qual_troca' }),
  evC('rascunho_gerado', 'c1', { tentativaId: 'c1-t1' }),
  evC('rascunho_validado', 'c1', { tentativaId: 'c1-t1', checklist: checklistVerde() }),
  evC('email_enviado', 'c1', { tentativaId: 'c1-t1', mensagemId: 'm1', enviado: true, canalConfirmou: true, checklist: checklistVerde() }),
]

test('mensagem nova abre um ciclo: a conversa verde não continua verde quando a classificação falha', () => {
  const verde = cicloVerde()
  assert.equal(seloDaConversa(verde), 'tudo_certo')
  const eventos = [
    ...verde,
    evC('cliente_recebido', 'c2'),
    evC('caso_para_humano', 'c2', { motivo: 'A IA não conseguiu classificar a mensagem (limite da API)', origem: 'classificacao' }, { resumo: 'A IA não conseguiu classificar a mensagem (limite da API)', situacao: 'bloqueado' }),
  ]
  assert.equal(cicloAtual(eventos), 'c2')
  assert.equal(seloDaConversa(eventos), 'revisar', 'classificação que falhou é erro da IA: Revisar')
  const r = checklistDaTentativa(eventos)
  assert.equal(r.checklist, null, 'não reaproveita o checklist verde do ciclo anterior')
  assert.equal(r.concluido, false)
  assert.match(r.motivo, /não conseguiu classificar/)
})

test('mensagem nova com IA pausada ou decisão do motor: "Aguardando você"', () => {
  const pausada = [...cicloVerde(), evC('cliente_recebido', 'c2'), evC('caso_para_humano', 'c2', { motivo: 'IA pausada nesta conversa', origem: 'ia_pausada' }, { situacao: 'atencao' })]
  assert.equal(seloDaConversa(pausada), 'aguardando_voce')
  const doMotor = [...cicloVerde(), evC('cliente_recebido', 'c2'), evC('ia_classificou', 'c2', {}), evC('motor_decidiu', 'c2', {}), evC('caso_para_humano', 'c2', { motivo: 'Fora do mapa do atendimento novo — responda você', origem: 'motor' }, { situacao: 'atencao' })]
  assert.equal(seloDaConversa(doMotor), 'aguardando_voce')
  assert.equal(ROTULO_SELO.aguardando_voce, 'Aguardando você')
})

test('cliente agradeceu e o motor encerrou sem precisar responder: estado próprio', () => {
  const eventos = [
    ...cicloVerde(),
    evC('cliente_recebido', 'c2'),
    evC('ia_classificou', 'c2', { intencao: 'agradece' }),
    evC('motor_decidiu', 'c2', {}),
    evC('caso_encerrado', 'c2', { motivo: 'cliente confirmou que está tudo certo' }, { situacao: 'ok' }),
  ]
  assert.equal(seloDaConversa(eventos), 'encerrado')
  assert.equal(ROTULO_SELO.encerrado, 'Encerrado — sem resposta necessária')
  // a confirmação ENVIADA também encerra o caso: aí quem manda é o envio provado
  const comEnvio = [
    evC('cliente_recebido', 'c3'),
    evC('rascunho_gerado', 'c3', { tentativaId: 'c3-t1' }),
    evC('email_enviado', 'c3', { tentativaId: 'c3-t1', mensagemId: 'm3', enviado: true, canalConfirmou: true, checklist: checklistVerde() }),
    evC('caso_encerrado', 'c3', { faseConfirmada: 'conf_reembolso' }, { situacao: 'ok' }),
  ]
  assert.equal(seloDaConversa(comEnvio), 'tudo_certo', 'encerramento depois do envio não apaga o envio')
})

test('bloqueio e regeneração ficam no MESMO ciclo, com tentativas diferentes', () => {
  const eventos = [
    evC('cliente_recebido', 'c1'),
    evC('ia_classificou', 'c1', {}),
    evC('motor_decidiu', 'c1', {}),
    evC('rascunho_gerado', 'c1', { tentativaId: 'c1-t1' }),
    evC('rascunho_bloqueado', 'c1', { tentativaId: 'c1-t1' }, { situacao: 'bloqueado', resumo: 'cupom não conferido' }),
    evC('rascunho_gerado', 'c1', { tentativaId: 'c1-t2' }),
    evC('rascunho_validado', 'c1', { tentativaId: 'c1-t2', checklist: checklistVerde() }),
    evC('email_enviado', 'c1', { tentativaId: 'c1-t2', mensagemId: 'm2', enviado: true, canalConfirmou: true, checklist: checklistVerde() }),
  ]
  assert.equal(cicloAtual(eventos), 'c1', 'regenerar não abre ciclo novo')
  assert.equal(eventosDoCiclo(eventos).length, 8, 'o ciclo guarda as duas tentativas')
  assert.equal(tentativaAtual(eventos), 'c1-t2')
  assert.deepEqual([...new Set(eventosDoCiclo(eventos).map(e => e.dados.tentativaId).filter(Boolean))], ['c1-t1', 'c1-t2'])
  assert.equal(seloDaConversa(eventos), 'tudo_certo')
})

test('checklist, classificação, decisão, passos e selo vêm do ciclo atual — e o histórico anterior continua inteiro', () => {
  const verde = cicloVerde()
  const eventos = [
    ...verde,
    evC('cliente_recebido', 'c2'),
    evC('caso_para_humano', 'c2', { motivo: 'Fora do mapa do atendimento novo — responda você', origem: 'motor' }, { situacao: 'atencao' }),
  ]
  // ciclo atual: nada do ciclo 1 entra
  const doCiclo = eventosDoCiclo(eventos)
  assert.equal(doCiclo.length, 2)
  assert.ok(!doCiclo.some(e => e.tipo === 'ia_classificou'), 'a interpretação da mensagem anterior não vale pela nova')
  assert.ok(!doCiclo.some(e => e.tipo === 'email_enviado'))
  assert.equal(seloDaConversa(eventos), 'aguardando_voce')
  assert.equal(checklistDaTentativa(eventos).checklist, null)
  const passos = passosCompactos(eventos)
  assert.ok(!passos.includes('enviada'), 'os passos são do ciclo atual: ' + passos)
  assert.match(passos, /aguardando você/)
  // histórico: os eventos do ciclo anterior continuam guardados e consultáveis
  assert.equal(eventos.length, 8)
  assert.equal(eventosDoCiclo(eventos, 'c1').length, 6)
  assert.ok(eventosDoCiclo(eventos, 'c1').some(e => e.tipo === 'email_enviado'))
  assert.equal(seloDaConversa(eventosDoCiclo(eventos, 'c1')), 'tudo_certo', 'o ciclo antigo continua verde quando consultado')
})

test('registro antigo sem cicloId continua valendo como um ciclo só', () => {
  const antigos = [
    novoEvento({ tipo: 'cliente_recebido', ticketId: 't9', em: EM, resumo: 'x' }),
    novoEvento({ tipo: 'rascunho_gerado', ticketId: 't9', em: EM, resumo: 'x', dados: { tentativaId: 'v1' } }),
    novoEvento({ tipo: 'email_enviado', ticketId: 't9', em: EM, resumo: 'x', dados: { tentativaId: 'v1', mensagemId: 'm', enviado: true, canalConfirmou: true, checklist: checklistVerde() } }),
  ]
  assert.equal(cicloAtual(antigos), null)
  assert.equal(eventosDoCiclo(antigos).length, 3)
  assert.equal(seloDaConversa(antigos), 'tudo_certo')
})

test('envio com checklist histórico indisponível: entra em "somente com erro" e nos passos', () => {
  const ev = (tipo, dados, extra = {}) => novoEvento({ tipo, ticketId: 't1', lojaId: 'loja1', em: EM, resumo: extra.resumo ?? tipo, situacao: extra.situacao ?? 'informativo', dados })
  // registro antigo reconstruído: o canal enviou, mas a fotografia do checklist não existe
  const eventos = [
    ev('cliente_recebido', { cicloId: 'c1' }),
    ev('rascunho_gerado', { cicloId: 'c1', tentativaId: 'c1-t1' }),
    ev('email_enviado', {
      cicloId: 'c1', tentativaId: 'c1-t1', mensagemId: 'm1', enviado: true, canalConfirmou: true,
      checklist: null, checklistHistoricoAusente: true, reconciliado: true,
    }, { situacao: 'ok' }),
  ]
  assert.equal(seloDaConversa(eventos), 'revisar_historico')
  assert.equal(ROTULO_SELO.revisar_historico, 'Revisar — envio confirmado, checklist histórico indisponível')
  // os passos compactos explicam POR QUE pede revisão
  const passos = passosCompactos(eventos)
  assert.match(passos, /checklist histórico indisponível/)
  assert.match(passos, /enviada/, 'e continuam dizendo que a mensagem saiu: ' + passos)

  const lista = [
    { ticketId: 'hist', motor: 'novo', selo: 'revisar_historico', cliente: 'Hist', email: 'h@web.de', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'de', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: 'automatico' },
    { ticketId: 'bloq', motor: 'novo', selo: 'bloqueado', cliente: 'Bloq', email: 'b@web.de', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'de', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: null },
    { ticketId: 'rev', motor: 'novo', selo: 'revisar', cliente: 'Rev', email: 'r@web.de', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'de', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: null },
    { ticketId: 'ok', motor: 'novo', selo: 'tudo_certo', cliente: 'Ok', email: 'o@web.de', pedido: null, lojaId: 'l1', jornada: null, fase: null, idioma: 'de', aguardandoAprovacao: false, envioAutomatico: false, origemEnvio: null },
  ]
  // "somente com erro" não pode esconder o que precisa ser revisado
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ soErro: true })).map(c => c.ticketId), ['hist', 'bloq', 'rev'])
  // e o filtro específico continua isolando só esse estado
  assert.equal(filtrosDaAuditoria({ situacao: 'revisar_historico' }).situacao, 'revisar_historico')
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ situacao: 'revisar_historico' })).map(c => c.ticketId), ['hist'])
  assert.deepEqual(filtrarConversas(lista, filtrosDaAuditoria({ situacao: 'revisar' })).map(c => c.ticketId), ['rev'], 'os dois estados não se misturam')
})

test('rascunho recusado aparece na linha do tempo COM o texto que a IA escreveu', () => {
  // o ticket não guarda mais o rascunho (foi para o dono), então sem o texto no
  // evento a auditoria diria "bloqueado" sem deixar ver o quê
  const t = {
    id: 'rec', corpo: 'Die Qualität ist schlecht.', data: '2026-09-18T10:00:00.000Z',
    status: 'humano', motivoEscalada: 'A IA saiu da etapa permitida: o texto não nomeia a ação "troca" desta etapa',
    historico: [],
    auditoriaIA: [
      novoEvento({ tipo: 'cliente_recebido', ticketId: 'rec', em: '2026-09-18T10:00:00.000Z', resumo: 'cliente', dados: { cicloId: 'c1' } }),
      novoEvento({
        tipo: 'rascunho_bloqueado', ticketId: 'rec', em: '2026-09-18T10:01:00.000Z', situacao: 'bloqueado',
        resumo: 'A IA saiu da etapa permitida: o texto não nomeia a ação "troca" desta etapa', fase: 'qual_troca',
        dados: { cicloId: 'c1', tentativaId: 'c1-t1', fase: 'qual_troca', enviado: false, motivo: 'A IA saiu da etapa permitida: o texto não nomeia a ação "troca" desta etapa', texto: 'Guten Tag, hier ist Ihr Gutschein V7KQ-M4XN (15%).' },
      }),
    ],
  }
  const linha = linhaDoTempo(t, { eventos: t.auditoriaIA })
  const m = linha.find(x => x.situacao === 'bloqueada')
  assert.ok(m, 'o rascunho recusado está na linha do tempo')
  assert.match(m.corpo, /V7KQ-M4XN/, 'com o texto exato que foi recusado')
  assert.match(m.motivo, /não nomeia a ação "troca"/)
  assert.equal(m.naoEnviado, true)
  assert.equal(m.fase, 'qual_troca')
  assert.equal(m.em, '2026-09-18T10:01:00.000Z')
  // e nada disso vira "enviada"
  assert.equal(linha.filter(x => x.situacao === 'enviada').length, 0)
  assert.equal(seloDaConversa(t.auditoriaIA), 'bloqueado')

  // com rascunho no ticket, continua sendo ele que aparece (sem duplicar)
  const comRascunho = { ...t, rascunho: 'Texto ainda em edição' }
  const linha2 = linhaDoTempo(comRascunho, { eventos: t.auditoriaIA })
  assert.equal(linha2.filter(x => x.situacao === 'bloqueada').length, 1)
  assert.equal(linha2.find(x => x.situacao === 'bloqueada').corpo, 'Texto ainda em edição')
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
/* ====================================================================
   Selo pela tentativa ATUAL, vínculo pelo Message-ID e prova de envio.
   ==================================================================== */

const evT = (tipo, tentativaId, extra = {}, minutos = 0) => novoEvento({
  tipo, ticketId: 't1', lojaId: 'loja1', em: new Date(Date.parse(EM) + minutos * 60_000).toISOString(),
  ...extra, dados: { tentativaId, ...(extra.dados ?? {}) },
})
const checklistOk = (geral = 'tudo_certo') => ({
  geral, enviado: geral === 'tudo_certo',
  itens: ITENS_CHECKLIST.map(([id, rotulo]) => ({ id, rotulo, estado: geral === 'tudo_certo' ? 'verde' : 'amarelo', detalhe: null })),
})
const envioProvado = (tentativa, minutos, mensagemId = 'atendo-1') => evT('email_enviado', tentativa, {
  situacao: 'ok',
  dados: { enviado: true, canalConfirmou: true, mensagemId, checklist: checklistOk(), minimoEnvio: EM },
}, minutos)

test('bloqueado → regenerado → validado → enviado: o selo final é "Tudo certo"', () => {
  const eventos = [
    evT('rascunho_gerado', 'tent-1', {}, 0),
    evT('rascunho_bloqueado', 'tent-1', { situacao: 'bloqueado', resumo: 'cupom não conferido' }, 1),
    // o dono corrige e o ciclo recomeça: OUTRA tentativa
    evT('rascunho_gerado', 'tent-2', {}, 5),
    evT('rascunho_validado', 'tent-2', { dados: { checklist: checklistOk('tudo_certo') } }, 5),
    evT('envio_agendado', 'tent-2', {}, 6),
    envioProvado('tent-2', 7),
    evT('fase_confirmada', 'tent-2', {}, 7),
  ]
  assert.equal(tentativaAtual(eventos), 'tent-2')
  assert.equal(seloDaConversa(eventos), 'tudo_certo')
  assert.equal(ROTULO_SELO.tudo_certo, 'Tudo certo — enviada e confirmada')
  // o bloqueio antigo continua registrado (linha do tempo), mas não marca mais a conversa
  assert.ok(eventos.some(e => e.tipo === 'rascunho_bloqueado'))
  assert.equal(passosCompactos(eventos).includes('bloqueada'), false)
})

test('bloqueio antigo + nova tentativa ainda pendente: nem bloqueado, nem tudo certo', () => {
  const eventos = [
    evT('rascunho_bloqueado', 'tent-1', { situacao: 'bloqueado' }, 1),
    evT('rascunho_gerado', 'tent-2', {}, 5),
    evT('rascunho_validado', 'tent-2', { dados: { checklist: checklistOk('tudo_certo') } }, 5),
    evT('aguardando_aprovacao', 'tent-2', { situacao: 'atencao' }, 5),
  ]
  const selo = seloDaConversa(eventos)
  assert.equal(selo, 'aguardando')
  assert.notEqual(selo, 'bloqueado')
  assert.notEqual(selo, 'tudo_certo')
  assert.equal(ROTULO_SELO.aguardando, 'Resposta validada — aguardando aprovação')
  assert.match(passosCompactos(eventos), /aguardando sua aprovação$/)
})

test('a tentativa ATUAL bloqueada continua vermelha e nunca aparece como enviada', () => {
  const eventos = [
    envioProvado('tent-1', 0),
    evT('rascunho_gerado', 'tent-2', {}, 10),
    evT('rascunho_bloqueado', 'tent-2', { situacao: 'bloqueado', resumo: 'idioma errado' }, 10),
  ]
  assert.equal(seloDaConversa(eventos), 'bloqueado')
  assert.equal(ROTULO_SELO.bloqueado, 'Bloqueada — não foi enviada')
  assert.match(passosCompactos(eventos), /bloqueada — não foi enviada$/)
})

test('falha de envio depois do e-mail da MESMA tentativa manda no selo', () => {
  const eventos = [envioProvado('tent-1', 0), evT('envio_falhou', 'tent-1', { situacao: 'bloqueado' }, 1)]
  assert.equal(seloDaConversa(eventos), 'bloqueado')
})

test('"Tudo certo" exige prova: enviado + canal + Message-ID + checklist final', () => {
  const base = tentativa => [evT('rascunho_validado', tentativa, { dados: { checklist: checklistOk() } }, 0)]
  // sem Message-ID não há prova
  const semId = [...base('t'), evT('email_enviado', 't', { dados: { enviado: true, checklist: checklistOk() } }, 1)]
  assert.equal(seloDaConversa(semId), 'revisar')
  // sem checklist da mensagem enviada também não
  const semChecklist = [...base('t'), evT('email_enviado', 't', { dados: { enviado: true, mensagemId: 'x' } }, 1)]
  assert.equal(seloDaConversa(semChecklist), 'revisar')
  // com tudo: tudo certo
  assert.equal(seloDaConversa([...base('t'), envioProvado('t', 1)]), 'tudo_certo')
})

test('rascunho válido aguardando aprovação NUNCA é "Tudo certo"', () => {
  const eventos = [
    evT('rascunho_gerado', 't', {}, 0),
    evT('rascunho_validado', 't', { dados: { checklist: checklistOk('tudo_certo') } }, 0),
    evT('aguardando_aprovacao', 't', {}, 0),
  ]
  assert.equal(seloDaConversa(eventos), 'aguardando')
  const agendado = [...eventos.slice(0, 2), evT('envio_agendado', 't', {}, 1)]
  assert.equal(seloDaConversa(agendado), 'agendada')
  assert.equal(ROTULO_SELO.agendada, 'Agendada — ainda não enviada')
})

test('vínculo EXATO pelo Message-ID: dois envios em menos de 2 minutos não se confundem', () => {
  const t = {
    id: 't1',
    historico: [
      { autor: 'cliente', corpo: 'oi', data: '2026-09-18T11:58:00.000Z' },
      { autor: 'atendo', corpo: 'primeira', data: '2026-09-18T12:00:00.000Z', origem: 'ia', mensagemId: 'atendo-A', fase: 'qual_troca' },
      { autor: 'atendo', corpo: 'segunda', data: '2026-09-18T12:01:00.000Z', origem: 'manual', mensagemId: 'atendo-B', fase: 'reemb_25' },
    ],
    auditoriaIA: [
      novoEvento({ tipo: 'email_enviado', em: '2026-09-18T12:00:00.000Z', fase: 'qual_troca', dados: { mensagemId: 'atendo-A', minimoEnvio: '2026-09-18T11:59:00.000Z', enviado: true, tentativaId: 'a' } }),
      novoEvento({ tipo: 'email_enviado', em: '2026-09-18T12:01:00.000Z', fase: 'reemb_25', dados: { mensagemId: 'atendo-B', minimoEnvio: '2026-09-18T11:30:00.000Z', enviado: true, tentativaId: 'b' } }),
    ],
  }
  const linha = linhaDoTempo(t)
  const primeira = linha.find(m => m.corpo === 'primeira')
  const segunda = linha.find(m => m.corpo === 'segunda')
  assert.equal(primeira.vinculo, 'exato')
  assert.equal(primeira.mensagemId, 'atendo-A')
  assert.equal(primeira.minimoEnvio, '2026-09-18T11:59:00.000Z')
  assert.equal(primeira.atrasoMs, 60_000)
  assert.equal(primeira.fase, 'qual_troca')
  assert.equal(segunda.vinculo, 'exato')
  assert.equal(segunda.mensagemId, 'atendo-B')
  assert.equal(segunda.minimoEnvio, '2026-09-18T11:30:00.000Z')
  assert.equal(segunda.atrasoMs, 31 * 60_000)
  assert.equal(segunda.rotuloOrigem, 'Você')
})

test('registro antigo sem Message-ID: a associação é marcada como INFERIDA', () => {
  const t = {
    id: 't2',
    historico: [{ autor: 'atendo', corpo: 'antiga', data: '2026-09-18T12:00:00.000Z', origem: 'ia' }],
    auditoriaIA: [novoEvento({ tipo: 'email_enviado', em: '2026-09-18T12:00:30.000Z', dados: { minimoEnvio: '2026-09-18T11:59:00.000Z', enviado: true } })],
  }
  const m = linhaDoTempo(t).find(x => x.corpo === 'antiga')
  assert.equal(m.vinculo, 'inferido')
  assert.equal(m.mensagemId, null)
  assert.ok(m.envioReal, 'ainda mostra o horário, mas sem alegar prova')
})
test('retenção: passar do teto não apaga em silêncio — o que sai fica contado e datado', async () => {
  const { aplicarRetencao, LIMITE_AUDITORIA } = await import('../shared/auditoria.js')
  const base = new Date('2026-09-18T00:00:00.000Z').getTime()
  let lista = []
  for (let i = 0; i < LIMITE_AUDITORIA + 5; i++) {
    lista = registrarEvento(lista, novoEvento({ tipo: 'cliente_recebido', ticketId: 't1', em: new Date(base + i * 60_000).toISOString(), chave: 'k' + i }))
  }
  const r = aplicarRetencao(lista)
  assert.equal(r.lista.length, LIMITE_AUDITORIA, 'a lista fica no teto')
  assert.equal(r.retencao.omitidos, 5, 'os 5 que saíram estão contados')
  assert.equal(r.retencao.primeiroOmitidoEm, new Date(base).toISOString())
  assert.equal(r.retencao.ultimoOmitidoEm, new Date(base + 4 * 60_000).toISOString())
  assert.equal(r.retencao.primeiroDisponivelEm, new Date(base + 5 * 60_000).toISOString())
  assert.equal(r.retencao.limite, LIMITE_AUDITORIA)

  // um segundo corte SOMA ao anterior e mantém a data do primeiro omitido
  let maior = r.lista
  for (let i = 0; i < 3; i++) {
    maior = registrarEvento(maior, novoEvento({ tipo: 'cliente_recebido', ticketId: 't1', em: new Date(base + 10_000_000 + i).toISOString(), chave: 'z' + i }))
  }
  const r2 = aplicarRetencao(maior, { anterior: r.retencao })
  assert.equal(r2.retencao.omitidos, 8)
  assert.equal(r2.retencao.primeiroOmitidoEm, r.retencao.primeiroOmitidoEm)

  // abaixo do teto nada é cortado e não se inventa retenção
  const pequeno = aplicarRetencao(lista.slice(0, 10))
  assert.equal(pequeno.lista.length, 10)
  assert.equal(pequeno.retencao, null)
})

test('leitor de valores: formatos europeu, americano e suíço (o mesmo do motor)', async () => {
  const { valoresMonetarios } = await import('../server/atendimento.js')
  assert.deepEqual(valoresMonetarios('€ 40,00'), [40])
  assert.deepEqual(valoresMonetarios('40.00 €'), [40])
  assert.deepEqual(valoresMonetarios('€ 1.234,50'), [1234.5])
  assert.deepEqual(valoresMonetarios('€ 1,234.50'), [1234.5])
  assert.deepEqual(valoresMonetarios('CHF 1’234.50'), [1234.5])
  assert.deepEqual(valoresMonetarios("CHF 1'234.50"), [1234.5])
  // texto com total do pedido, reembolso e percentual ao mesmo tempo
  const misto = 'Ihre Bestellung von € 1.234,50: wir erstatten 40% = € 493,80 zurück.'
  assert.deepEqual(valoresMonetarios(misto), [1234.5, 493.8])
  // o valor do reembolso é encontrado sem confundir com o total
  const esperado = Math.round(1234.5 * 40) / 100
  assert.equal(esperado, 493.8)
  assert.ok(valoresMonetarios(misto).some(v => Math.abs(v - esperado) < 0.011))
  assert.ok(!valoresMonetarios('40%').length, 'percentual sozinho não é dinheiro')
})
