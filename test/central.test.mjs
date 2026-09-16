// Central operacional — cálculo único (shared/central.js), sem interface e sem servidor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FASES, FASES_HUMANAS } from '../server/atendimento.js'
import { calcularCentral, montarCasos, consolidarPorPedido, metricasPorFase, relacaoComFase, filtrarRegistros, FILTROS_PADRAO, ehCandidatoMigracao, statusMigracao, normalizarInferencia, FASES_MIGRAVEIS, temRelatorio } from '../shared/central.js'

const fases = Object.fromEntries(Object.entries(FASES).map(([id, f]) => [id, { titulo: f.titulo, jornada: f.jornada, aoAceitar: f.aoAceitar, aoRecusar: f.aoRecusar, oferta: f.oferta, instrucao: f.instrucao, confirmacao: !!f.confirmacao, decisaoDono: FASES_HUMANAS.has(id) }]))
const lojas = [
  { id: 'l1', nome: 'Loja Euro', moeda: 'EUR', modoAtendimento: 'novo' },
  { id: 'l2', nome: 'Loja Dólar', moeda: 'USD', modoAtendimento: 'novo' },
]
const agora = Date.parse('2026-09-16T12:00:00Z')
const dia = n => new Date(agora - n * 864e5).toISOString().slice(0, 10)
const ped = (id, lojaId, valor, criadoEm, email) => ({ id, numero: '#' + id.replace('p', '90'), cliente: 'Cliente ' + id, email, pais: 'DE', valor, status: 'entregue', criadoEm, lojaId, itens: [{ titulo: 'Polo', variante: 'M', quantidade: 1, preco: valor }] })
const pedidos = [
  ped('p1', 'l1', 100, dia(2), 'c1@x.de'),
  ped('p2', 'l1', 80, dia(5), 'c2@x.de'),
  ped('p3', 'l2', 50, dia(3), 'c3@x.de'),
  ped('p4', 'l1', 60, dia(1), 'c4@x.de'), // sem nenhuma conversa
  ped('p5', 'l1', 90, dia(40), 'c5@x.de'), // caso do clássico (inferido)
  ped('p6', 'l1', 40, dia(3), 'c6@x.de'), // confirmação de reembolso ENVIADA
  ped('p7', 'l1', 90, dia(50), 'c7@x.de'), // clássico marcado como processado no relatório
  ped('p8', 'l1', 30, dia(4), 'c8@x.de'), // encerrado sem reembolso
]
const hist = ids => ids.map((para, i) => ({ de: ids[i - 1] ?? null, para, mensagem: 'x', em: new Date(agora - (ids.length - i) * 3600e3).toISOString() }))
const an = (etapa, trilha, extra = {}) => ({
  versao: 1, fluxo: 'qualidade', etapa, produtosAfetados: ['Polo (M)'], motivo: 'qualidade', ajusteTamanho: null,
  fotoSolicitada: false, fotoRecebida: false, fotoValidada: null, ofertaAtual: null, ofertaEnviadaEm: null,
  aguardando: 'cliente', acaoAceita: null, enderecoInformado: null, enderecoConfirmado: null,
  historicoEtapas: hist(trilha), transicaoPendente: null, ...extra,
})
const tk = (id, de, lojaId, extra) => ({ id, nome: de, de, assunto: 'Bestellung', corpo: 'x', data: new Date(agora - 3600e3).toISOString(), lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId, historico: [], ...extra })
const tickets = [
  // p1: DUAS conversas do mesmo pedido; a principal tem rascunho pendente (reemb_25) que NÃO conta
  tk('t1', 'c1@x.de', 'l1', { atendimentoNovo: an('qual_cupom_35', ['qual_troca', 'qual_cupom_35'], { aguardando: 'envio', transicaoPendente: { para: 'reemb_25', mensagem: 'nein' } }) }),
  tk('t1b', 'c1@x.de', 'l1', { status: 'enviado', atendimentoNovo: an('qual_troca', ['qual_troca']) }),
  // p2: aceitou 25% (com o dono)
  tk('t2', 'c2@x.de', 'l1', { status: 'humano', atendimentoNovo: an('reemb_25', ['qual_troca', 'qual_cupom_35', 'reemb_25'], { aguardando: 'humano', acaoAceita: 'reemb_25' }) }),
  // p3 (USD): em aberto no qual_troca, com correção MANUAL para reemb_40 (não é fase enviada)
  tk('t3', 'c3@x.de', 'l2', { atendimentoNovo: an('qual_troca', ['qual_troca']), centralAjuste: { fase: 'reemb_40', jornada: 'qualidade', por: 'Teste', em: new Date(agora).toISOString(), anterior: 'qual_troca', justificativa: 'era 40' }, centralHistorico: [{ removido: false, fase: 'reemb_40', jornada: 'qualidade', anterior: 'qual_troca', anteriorJornada: null, por: 'Teste', em: new Date(agora).toISOString(), justificativa: 'era 40' }] }),
  // p5: clássico com relatório manual — fase INFERIDA (nunca enviada pelo motor)
  tk('t5', 'c5@x.de', 'l1', { status: 'enviado', relatorioDia: dia(30), relatorioTexto: 'REEMBOLSO 60%', motivoReembolso: { motivo: 'material ruim', categoria: 'qualidade', em: new Date(agora).toISOString() } }),
  // p6: aceitou 25% e a CONFIRMAÇÃO saiu (fase conf_reembolso no histórico) → efetivado
  tk('t6', 'c6@x.de', 'l1', { status: 'enviado', atendimentoNovo: an('conf_reembolso', ['qual_troca', 'qual_cupom_35', 'reemb_25', 'conf_reembolso'], { aguardando: null, acaoAceita: 'reemb_25' }) }),
  // p7: clássico REEMBOLSO 60% marcado como processado no link do relatório → efetivado
  tk('t7', 'c7@x.de', 'l1', { status: 'enviado', relatorioDia: dia(45), relatorioTexto: 'REEMBOLSO 60%', relatorioProcessado: new Date(agora).toISOString(), motivoReembolso: { motivo: 'não gostou', categoria: 'nao_gostou', em: new Date(agora).toISOString() } }),
  // p8: encerrado sem reembolso
  tk('t8', 'c8@x.de', 'l1', { status: 'enviado', resolucao: 'Encerrada — cliente confirmou que está tudo certo', atendimentoNovo: an('qual_troca', ['qual_troca'], { aguardando: null }) }),
  // spam nunca entra
  tk('t9', 'c4@x.de', 'l1', { status: 'spam' }),
]
const calc = (filtros = {}) => calcularCentral({ tickets, pedidos, lojas, fases, filtros, agora })

test('"Todos os pedidos" é a junção pedido × caso: pedido sem conversa aparece como sem atendimento / sem fase', () => {
  const { linhas } = calc()
  assert.equal(linhas.length, 8, 'todos os pedidos filtrados, com ou sem ticket')
  const p4 = linhas.find(l => l.pedidoId === 'p4')
  assert.equal(p4.atendimento, 'sem atendimento'); assert.equal(p4.faseTitulo, 'sem fase'); assert.equal(p4.registro, null)
  assert.equal(p4.valor, 60); assert.equal(p4.lojaNome, 'Loja Euro')
  const p1 = linhas.find(l => l.pedidoId === 'p1')
  assert.equal(p1.atendimento, 'confirmada'); assert.deepEqual(p1.registro.tickets, ['t1', 't1b'])
  assert.equal(linhas.find(l => l.pedidoId === 'p5').atendimento, 'inferida')
  assert.equal(linhas.find(l => l.pedidoId === 'p3').atendimento, 'manual')
})

test('métricas deduplicadas por pedido + fase: duas conversas do mesmo pedido contam uma vez', () => {
  const { metricas, registros } = calc()
  assert.equal(registros.filter(r => r.pedidoId === 'p1').length, 1)
  assert.equal(metricas.qual_troca.passaram, 5, 'p1 (uma vez), p2, p3, p6 e p8')
  assert.equal(metricas.qual_cupom_35.passaram, 3, 'p1, p2 e p6')
  const casos = montarCasos(tickets, pedidos, lojas, fases)
  assert.equal(casos.filter(c => c.pedidoId === 'p1').length, 2, 'os dois tickets existem como casos…')
  assert.equal(consolidarPorPedido(casos).filter(r => r.pedidoId === 'p1').length, 1, '…mas viram um registro')
})

test('só fase enviada conta: pendência, inferência e correção manual ficam fora de passaram/pararam/avançaram', () => {
  const { metricas } = calc()
  // t1 tem transicaoPendente para reemb_25 — não conta; só t2 enviou reemb_25
  assert.equal(metricas.reemb_25.passaram, 2); assert.equal(metricas.reemb_25.pararam, 2, 'aceite no 25% (p2 pendente, p6 confirmado)')
  assert.equal(metricas.conf_reembolso.passaram, 1, 'a confirmação enviada conta na própria fase de confirmação')
  // inferido (clássico, REEMBOLSO 60%): aparece separado
  assert.equal(metricas.reemb_60.passaram, 0); assert.equal(metricas.reemb_60.pararam, 0); assert.equal(metricas.reemb_60.inferidos, 2, 'p5 e p7 (clássico, mesmo o processado não é fase enviada)')
  // correção manual para reemb_40: não vira fase enviada
  assert.equal(metricas.reemb_40.passaram, 0); assert.equal(metricas.reemb_40.manuais, 1)
  // a trilha confirmada do caso corrigido continua contando
  assert.equal(metricas.qual_troca.emAberto, 1, 'p3 (em aberto); p1 já avançou para o cupom')
  assert.equal(metricas.qual_cupom_35.emAberto, 1, 'p1: rascunho pendente não move a fase')
  const casos = montarCasos(tickets, pedidos, lojas, fases)
  const t3 = casos.find(c => c.ticketId === 't3')
  assert.equal(t3.origem, 'manual'); assert.equal(t3.faseAtual, 'reemb_40'); assert.deepEqual(t3.trilha, ['qual_troca'])
  assert.equal(t3.historicoAjustes.length, 1)
  const t5 = casos.find(c => c.ticketId === 't5')
  assert.equal(t5.origem, 'inferida'); assert.equal(t5.faseAtual, 'reemb_60'); assert.deepEqual(t5.trilha, [])
  const t1 = casos.find(c => c.ticketId === 't1')
  assert.equal(t1.pendente, 'reemb_25'); assert.ok(!t1.trilha.includes('reemb_25'))
})

test('valores das fases separados por moeda — EUR e USD nunca se somam', () => {
  const { metricas, indicadores } = calc()
  assert.deepEqual(metricas.qual_troca.valorPorMoeda, { EUR: 250, USD: 50 })
  assert.deepEqual(metricas.qual_cupom_35.valorPorMoeda, { EUR: 220 })
  const eur = indicadores.find(k => k.moeda === 'EUR'); const usd = indicadores.find(k => k.moeda === 'USD')
  assert.equal(eur.pedidosTotais, 7); assert.equal(usd.pedidosTotais, 1)
  assert.equal(eur.valorTotalPedidos, 490); assert.equal(usd.valorTotalPedidos, 50)
})

test('"antes do pipeline" é hipótese: cenário sem retenção separado do reembolsado de fato, e "insuficiente" sem histórico confirmado', () => {
  const { indicadores } = calc()
  const eur = indicadores.find(k => k.moeda === 'EUR')
  assert.equal(eur.hipoteticoSemRetencao, 130, 'os mesmos efetivados (p6 40 + p7 90) com 100%')
  assert.equal(eur.reembolsadoEfetivo, 64, '25% de 40 (confirmação enviada) + 60% de 90 (processado no relatório)')
  assert.equal(eur.historicoSuficiente, true); assert.equal(eur.reembolsosConfirmados, 1, 'só p6 veio do motor')
  const usd = indicadores.find(k => k.moeda === 'USD')
  assert.equal(usd.historicoSuficiente, false); assert.equal(usd.reembolsadoEfetivo, 0)
})

test('filtros combinados: busca + loja + período + desfecho + jornada + fase agem juntos', () => {
  let r = calc({ lojaId: 'l1', jornada: 'qualidade', fase: 'reemb_25', desfecho: 'reembolso', busca: 'c2' })
  assert.deepEqual(r.registros.map(x => x.pedidoId), ['p2']); assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p2'])
  r = calc({ lojaId: 'l1', jornada: 'qualidade', fase: 'reemb_25', desfecho: 'reembolso', busca: 'c1' })
  assert.equal(r.registros.length, 0)
  r = calc({ desfecho: '25' })
  assert.deepEqual(r.registros.map(x => x.pedidoId), ['p6', 'p2'], 'p6 (confirmado) e p2 (pendente) aceitaram 25%')
  r = calc({ fase: 'sem_fase' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p4'], 'só pedidos sem fase')
  r = calc({ periodo: '7' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId).sort(), ['p1', 'p2', 'p3', 'p4', 'p6', 'p8'], 'p5 e p7 são antigos')
  r = calc({ lojaId: 'l2' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p3']); assert.equal(r.indicadores.length, 1); assert.equal(r.indicadores[0].moeda, 'USD')
  r = calc({ busca: 'cliente p4' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p4'], 'busca acha pedido sem ticket')
  r = calc({ fase: 'qual_cupom_35' })
  assert.deepEqual(r.registros.map(x => x.pedidoId), ['p1'], 'fase ATUAL: p1 está no cupom de 35% (o rascunho pendente não conta)…')
  assert.deepEqual(calc({ fase: 'qual_troca' }).registros.map(x => x.pedidoId), ['p8'], 'só p8 está no qual_troca (p3 foi corrigido à mão)')
  assert.equal(filtrarRegistros(consolidarPorPedido(montarCasos(tickets, pedidos, lojas, fases)), { ...FILTROS_PADRAO, fase: 'reemb_40' }, agora)[0].pedidoId, 'p3', '…e a correção manual define a fase atual de p3')
})

test('todos os filtros mudam TODOS os indicadores (pedidos totais, valor total, com atendimento, casos, reembolsos)', () => {
  const eur = f => calc(f).indicadores.find(k => k.moeda === 'EUR')
  const base = eur({})
  assert.deepEqual([base.pedidosTotais, base.valorTotalPedidos, base.pedidosComAtendimento, base.valorComAtendimento, base.casos], [7, 490, 6, 430, 6])
  // busca
  let k = eur({ busca: 'c2' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.pedidosComAtendimento, k.casos, k.aceitesPendentes, k.reembolsadoEfetivo], [1, 80, 1, 1, 1, 0])
  // loja: l2 é USD → não existe indicador EUR
  assert.equal(eur({ lojaId: 'l2' }), undefined)
  const usd = calc({ lojaId: 'l2' }).indicadores[0]
  assert.deepEqual([usd.moeda, usd.pedidosTotais, usd.valorTotalPedidos, usd.casos], ['USD', 1, 50, 1])
  // período
  k = eur({ periodo: '7' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.pedidosComAtendimento, k.reembolsadoEfetivo, k.aceitesPendentes], [5, 310, 4, 10, 1])
  // desfecho
  k = eur({ desfecho: 'encerrado' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.casos, k.pedidosEmReembolso, k.reembolsadoEfetivo], [1, 30, 1, 0, 0])
  k = eur({ desfecho: 'reembolso' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.pedidosEmReembolso, k.reembolsadoEfetivo, k.aceitesPendentes, k.reembolsosRegistrados], [4, 300, 4, 64, 1, 1])
  // jornada: exclui o pedido sem caso (p4) e os casos de outras jornadas
  k = eur({ jornada: 'qualidade' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.pedidosComAtendimento], [6, 430, 6])
  assert.equal(eur({ jornada: 'tamanho' }), undefined, 'nenhum caso de tamanho → nenhum indicador')
  // fase atual
  k = eur({ fase: 'reemb_25' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.aceitesPendentes, k.reembolsadoEfetivo], [1, 80, 1, 0])
  k = eur({ fase: 'sem_fase' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.pedidosComAtendimento, k.casos], [1, 60, 0, 0])
  // combinação: busca + período + jornada + fase
  k = eur({ busca: 'c6', periodo: '7', jornada: 'qualidade', fase: 'conf_reembolso' })
  assert.deepEqual([k.pedidosTotais, k.valorTotalPedidos, k.reembolsadoEfetivo, k.hipoteticoSemRetencao], [1, 40, 10, 40])
  const porJ = k.porJornada.find(j => j.chave === 'qualidade')
  assert.deepEqual([porJ.pedidos, porJ.valor, porJ.pct], [1, 40, 100])
})

test('"Reembolsado de fato" só com confirmação enviada ou reembolso processado; aceite pendente e encerramento ficam fora', () => {
  const { registros, indicadores } = calc()
  const reg = id => registros.find(r => r.pedidoId === id)
  // aceite + aguardando humano = aceite pendente
  assert.equal(reg('p2').situacaoReembolso, 'aceite_pendente'); assert.equal(reg('p2').confirmacaoEnviada, null)
  // confirmação enviada (fase conf_reembolso no histórico) = efetivado
  assert.equal(reg('p6').situacaoReembolso, 'efetivado'); assert.equal(reg('p6').confirmacaoEnviada, 'conf_reembolso')
  // processado no relatório (clássico) = efetivado; só a linha do relatório = registrado
  assert.equal(reg('p7').situacaoReembolso, 'efetivado'); assert.equal(reg('p5').situacaoReembolso, 'registrado')
  // encerramento sem reembolso: fora de tudo
  assert.equal(reg('p8').situacaoReembolso, null); assert.equal(reg('p8').desfecho, 'encerrado')
  const eur = indicadores.find(k => k.moeda === 'EUR')
  assert.equal(eur.reembolsadoEfetivo, 64); assert.equal(eur.reembolsosEfetivados, 2)
  assert.equal(eur.aceitesPendentes, 1); assert.equal(eur.valorAceitesPendentes, 20)
  assert.equal(eur.reembolsosRegistrados, 1)
  assert.equal(eur.pedidosEmReembolso, 4, 'p2, p5, p6, p7 envolvidos; p8 não')
  // se a confirmação ainda não saiu (rascunho pendente), continua pendente
  const t6Pendente = { ...tickets.find(t => t.id === 't6'), atendimentoNovo: an('reemb_25', ['qual_troca', 'qual_cupom_35', 'reemb_25'], { aguardando: 'envio', acaoAceita: 'reemb_25', transicaoPendente: { para: 'conf_reembolso', mensagem: 'aceite aprovado' } }) }
  const r2 = calcularCentral({ tickets: [t6Pendente], pedidos, lojas, fases, agora })
  assert.equal(r2.registros[0].situacaoReembolso, 'aceite_pendente'); assert.equal(r2.indicadores[0].reembolsadoEfetivo, 0); assert.equal(r2.indicadores[0].aceitesPendentes, 1)
})

test('Parte 8: casos antigos com inferência da IA entram como "inferida (IA)", abaixo do relatório manual e fora do reembolsado de fato', () => {
  const infer = (extra = {}) => ({ jornada: 'tamanho', fase: 'tam_troca', desfecho: 'troca', percentual: null, motivo: 'Cliente disse que ficou pequeno', categoria: 'tamanho', produtos: ['Polo Premium'], confianca: 0.8, em: new Date(agora).toISOString(), origem: 'ia', ...extra })
  const pedidosH = [ped('h1', 'l1', 100, dia(10), 'h1@x.de'), ped('h2', 'l1', 50, dia(12), 'h2@x.de'), ped('h3', 'l1', 80, dia(14), 'h3@x.de'), ped('h4', 'l1', 60, dia(16), 'h4@x.de')]
  const ticketsH = [
    // sem relatório: a IA infere troca por tamanho
    tk('th1', 'h1@x.de', 'l1', { status: 'enviado', categoria: 'troca', inferenciaCentral: infer() }),
    // sem relatório: a IA infere reembolso de 60% → "inferido", nunca efetivado
    tk('th2', 'h2@x.de', 'l1', { status: 'enviado', inferenciaCentral: infer({ jornada: 'qualidade', fase: 'reemb_60', desfecho: 'reembolso', percentual: 60, categoria: 'qualidade', motivo: 'Cliente não gostou do material' }) }),
    // COM relatório (REEMBOLSO 100%) e inferência divergente (troca): o relatório manda
    tk('th3', 'h3@x.de', 'l1', { status: 'enviado', relatorioDia: dia(13), relatorioTexto: 'REEMBOLSO 100%', inferenciaCentral: infer() }),
    // categoria entrega, sem relatório e sem inferência: candidato, ainda sem fase
    tk('th4', 'h4@x.de', 'l1', { status: 'enviado', categoria: 'entrega' }),
    // modo novo: nunca é candidato
    tk('th5', 'c1@x.de', 'l1', { atendimentoNovo: an('qual_troca', ['qual_troca']) }),
  ]
  // candidato = clássico SEM relatório; th3 tem relatório (fonte humana) e fica fora do lote
  assert.deepEqual(ticketsH.map(ehCandidatoMigracao), [true, true, false, true, false])
  assert.deepEqual(statusMigracao(ticketsH), { candidatos: 3, inferidos: 2, pendentes: 1 })
  // qualquer estado do motor exclui — inclusive em coleta, com fluxo null
  assert.equal(ehCandidatoMigracao(tk('n1', 'x@x.de', 'l1', { categoria: 'reembolso', atendimentoNovo: { ...an(null, []), fluxo: null, etapa: null } })), false, 'modo novo em coleta (fluxo null) não é candidato')
  assert.equal(ehCandidatoMigracao(tk('n2', 'x@x.de', 'l1', { categoria: 'reembolso', atendimentoNovo: an('qual_troca', ['qual_troca'], { fluxo: 'qualidade' }) })), false, 'modo novo com fluxo não é candidato')
  assert.equal(ehCandidatoMigracao(tk('n3', 'x@x.de', 'l1', { categoria: 'reembolso' })), true, 'clássico sem atendimentoNovo é candidato')
  assert.equal(ehCandidatoMigracao(tk('n4', 'x@x.de', 'l1', { categoria: 'reembolso', relatorioTexto: 'REEMBOLSO 60%' })), false, 'relatorioTexto basta para ficar fora')
  assert.equal(ehCandidatoMigracao(tk('n5', 'x@x.de', 'l1', { categoria: 'reembolso', relatorioLinha: '#1 - REEMBOLSO' })), false, 'relatorioLinha também')
  assert.equal(ehCandidatoMigracao(tk('n6', 'x@x.de', 'l1', { categoria: 'rastreio' })), false, 'rastreio não é caso')
  assert.equal(ehCandidatoMigracao(tk('n7', 'x@x.de', 'l1', { categoria: 'reembolso', status: 'spam' })), false)
  assert.deepEqual([temRelatorio({ relatorioDia: '2026-09-01' }), temRelatorio({ relatorioLinha: 'x' }), temRelatorio({ relatorioTexto: 'x' }), temRelatorio({})], [true, true, true, false])
  const r = calcularCentral({ tickets: ticketsH, pedidos: pedidosH, lojas, fases, agora })
  const reg = id => r.registros.find(x => x.pedidoId === id)
  assert.deepEqual([reg('h1').origem, reg('h1').inferidaPor, reg('h1').jornada, reg('h1').faseAtual, reg('h1').desfecho, reg('h1').motivo, reg('h1').produto], ['inferida', 'ia', 'tamanho', 'tam_troca', 'troca', 'Cliente disse que ficou pequeno', 'Polo Premium'])
  assert.deepEqual([reg('h2').desfecho, reg('h2').percentual, reg('h2').reembolsado, reg('h2').situacaoReembolso, reg('h2').faseAtual], ['reembolso', 60, 30, 'inferido', 'reemb_60'])
  assert.deepEqual([reg('h3').inferidaPor, reg('h3').desfecho, reg('h3').percentual, reg('h3').situacaoReembolso, reg('h3').faseAtual], ['relatorio', 'reembolso', 100, 'registrado', 'reemb_100'], 'relatório manual vence a inferência')
  assert.equal(reg('h4').faseAtual, null); assert.equal(reg('h4').inferidaPor, null)
  const eur = r.indicadores[0]
  assert.equal(eur.reembolsadoEfetivo, 0, 'inferido e registrado não são efetivados'); assert.equal(eur.reembolsosInferidos, 1); assert.equal(eur.reembolsosRegistrados, 1)
  assert.equal(r.metricas.tam_troca.passaram, 0); assert.equal(r.metricas.tam_troca.inferidos, 1, 'inferência não vira fase enviada')
  assert.equal(r.metricas.reemb_60.inferidos, 1)
  // normalização do que a IA devolve
  assert.equal(normalizarInferencia(null, fases), null)
  const n = normalizarInferencia({ jornada: 'lua', fase: 'inexistente', desfecho: 'reembolso', percentual: '40', motivo: 'Cliente x', categoria: 'zzz', produtos: ['A', '', 'B'], confianca: 7 }, fases)
  assert.deepEqual(n, { jornada: 'entrada', fase: null, desfecho: 'reembolso', percentual: 40, motivo: 'Cliente x', categoria: 'outro', produtos: ['A', 'B'], confianca: 1 })
  assert.equal(normalizarInferencia({ desfecho: 'troca', percentual: 30 }, fases).percentual, 30, 'troca com reembolso parcial mantém o percentual')
  assert.equal(normalizarInferencia({ desfecho: 'cupom', percentual: 30 }, fases).percentual, null, 'cupom e encerrado não têm percentual')
  assert.equal(normalizarInferencia({ desfecho: 'cancelamento' }, fases).percentual, 100)
  assert.equal(normalizarInferencia({ desfecho: 'reembolso', percentual: 250 }, fases).percentual, null)
  // só fases da lista explícita; confirmações nunca
  for (const id of FASES_MIGRAVEIS) { assert.ok(fases[id], `${id} existe no catálogo`); assert.ok(!fases[id].confirmacao, `${id} não é confirmação`) }
  assert.deepEqual(Object.keys(fases).filter(id => !fases[id].confirmacao).sort(), [...FASES_MIGRAVEIS].sort(), 'a lista cobre todas as fases não confirmatórias')
  for (const id of ['conf_reembolso', 'conf_troca', 'conf_cupom', 'conf_cancelamento', 'inexistente']) {
    assert.equal(normalizarInferencia({ desfecho: 'reembolso', percentual: 25, fase: id }, fases).fase, null, `${id} é recusada`)
  }
  assert.equal(normalizarInferencia({ desfecho: 'reembolso', percentual: 25, fase: 'reemb_25' }, fases).fase, 'reemb_25')
  // inferência antiga gravada com confirmação nunca aparece na Central
  const rConf = calcularCentral({ tickets: [tk('th6', 'h1@x.de', 'l1', { status: 'enviado', inferenciaCentral: infer({ fase: 'conf_reembolso', desfecho: 'reembolso', percentual: 25 }) })], pedidos: pedidosH, lojas, fases, agora })
  assert.equal(rConf.registros[0].faseAtual, null); assert.equal(rConf.registros[0].desfecho, 'reembolso')
})

test('relação com a fase: recusou tudo e chegou ao 100% conta como avançou (o 100% está com o dono, não foi enviado)', () => {
  const t = tk('tx', 'c2@x.de', 'l1', { status: 'humano', atendimentoNovo: an('reemb_70', ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40', 'reemb_50', 'reemb_60', 'reemb_70'], { aguardando: 'humano', acaoAceita: 'reemb_100' }) })
  const [r] = consolidarPorPedido(montarCasos([t], pedidos, lojas, fases))
  assert.equal(r.escalouAoDono, true); assert.equal(r.percentual, 100)
  assert.equal(relacaoComFase(r, 'reemb_70'), 'avancaram'); assert.equal(relacaoComFase(r, 'reemb_100'), null)
  const m = metricasPorFase([r], fases)
  assert.equal(m.reemb_100.passaram, 0); assert.equal(m.reemb_70.avancaram, 1)
})
