// Central operacional — cálculo único (shared/central.js), sem interface e sem servidor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FASES, FASES_HUMANAS } from '../server/atendimento.js'
import { calcularCentral, montarCasos, consolidarPorPedido, metricasPorFase, relacaoComFase, filtrarRegistros, FILTROS_PADRAO } from '../shared/central.js'

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
  // spam nunca entra
  tk('t9', 'c4@x.de', 'l1', { status: 'spam' }),
]
const calc = (filtros = {}) => calcularCentral({ tickets, pedidos, lojas, fases, filtros, agora })

test('"Todos os pedidos" é a junção pedido × caso: pedido sem conversa aparece como sem atendimento / sem fase', () => {
  const { linhas } = calc()
  assert.equal(linhas.length, 5, 'todos os pedidos filtrados, com ou sem ticket')
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
  assert.equal(metricas.qual_troca.passaram, 3, 'p1 (uma vez), p2 e p3')
  assert.equal(metricas.qual_cupom_35.passaram, 2, 'p1 e p2')
  const casos = montarCasos(tickets, pedidos, lojas, fases)
  assert.equal(casos.filter(c => c.pedidoId === 'p1').length, 2, 'os dois tickets existem como casos…')
  assert.equal(consolidarPorPedido(casos).filter(r => r.pedidoId === 'p1').length, 1, '…mas viram um registro')
})

test('só fase enviada conta: pendência, inferência e correção manual ficam fora de passaram/pararam/avançaram', () => {
  const { metricas } = calc()
  // t1 tem transicaoPendente para reemb_25 — não conta; só t2 enviou reemb_25
  assert.equal(metricas.reemb_25.passaram, 1); assert.equal(metricas.reemb_25.pararam, 1, 'aceite no 25%')
  // inferido (clássico, REEMBOLSO 60%): aparece separado
  assert.equal(metricas.reemb_60.passaram, 0); assert.equal(metricas.reemb_60.pararam, 0); assert.equal(metricas.reemb_60.inferidos, 1)
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
  assert.deepEqual(metricas.qual_troca.valorPorMoeda, { EUR: 180, USD: 50 })
  assert.deepEqual(metricas.qual_cupom_35.valorPorMoeda, { EUR: 180 })
  const eur = indicadores.find(k => k.moeda === 'EUR'); const usd = indicadores.find(k => k.moeda === 'USD')
  assert.equal(eur.pedidosTotais, 4); assert.equal(usd.pedidosTotais, 1)
  assert.equal(eur.valorTotalPedidos, 330); assert.equal(usd.valorTotalPedidos, 50)
})

test('"antes do pipeline" é hipótese: cenário sem retenção separado do reembolsado de fato, e "insuficiente" sem histórico confirmado', () => {
  const { indicadores } = calc()
  const eur = indicadores.find(k => k.moeda === 'EUR')
  assert.equal(eur.hipoteticoSemRetencao, 170, 'p2 (80) + p5 (90) com 100%')
  assert.equal(eur.reembolsadoEfetivo, 74, '25% de 80 + 60% de 90')
  assert.equal(eur.historicoSuficiente, true); assert.equal(eur.reembolsosConfirmados, 1)
  const usd = indicadores.find(k => k.moeda === 'USD')
  assert.equal(usd.historicoSuficiente, false); assert.equal(usd.reembolsadoEfetivo, 0)
})

test('filtros combinados: busca + loja + período + desfecho + jornada + fase agem juntos', () => {
  let r = calc({ lojaId: 'l1', jornada: 'qualidade', fase: 'reemb_25', desfecho: 'reembolso', busca: 'c2' })
  assert.deepEqual(r.registros.map(x => x.pedidoId), ['p2']); assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p2'])
  r = calc({ lojaId: 'l1', jornada: 'qualidade', fase: 'reemb_25', desfecho: 'reembolso', busca: 'c1' })
  assert.equal(r.registros.length, 0)
  r = calc({ desfecho: '25' })
  assert.deepEqual(r.registros.map(x => x.pedidoId), ['p2'])
  r = calc({ fase: 'sem_fase' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p4'], 'só pedidos sem fase')
  r = calc({ periodo: '7' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId).sort(), ['p1', 'p2', 'p3', 'p4'], 'p5 tem 40 dias')
  r = calc({ lojaId: 'l2' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p3']); assert.equal(r.indicadores.length, 1); assert.equal(r.indicadores[0].moeda, 'USD')
  r = calc({ busca: 'cliente p4' })
  assert.deepEqual(r.linhas.map(l => l.pedidoId), ['p4'], 'busca acha pedido sem ticket')
  r = calc({ fase: 'qual_cupom_35' })
  assert.deepEqual(r.registros.map(x => x.pedidoId), ['p1'], 'fase ATUAL: p1 está no cupom de 35% (o rascunho pendente não conta)…')
  assert.equal(calc({ fase: 'qual_troca' }).registros.length, 0, 'ninguém está parado no qual_troca (p3 foi corrigido à mão)')
  assert.equal(filtrarRegistros(consolidarPorPedido(montarCasos(tickets, pedidos, lojas, fases)), { ...FILTROS_PADRAO, fase: 'reemb_40' }, agora)[0].pedidoId, 'p3', '…e a correção manual define a fase atual de p3')
})

test('relação com a fase: recusou tudo e chegou ao 100% conta como avançou (o 100% está com o dono, não foi enviado)', () => {
  const t = tk('tx', 'c2@x.de', 'l1', { status: 'humano', atendimentoNovo: an('reemb_70', ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40', 'reemb_50', 'reemb_60', 'reemb_70'], { aguardando: 'humano', acaoAceita: 'reemb_100' }) })
  const [r] = consolidarPorPedido(montarCasos([t], pedidos, lojas, fases))
  assert.equal(r.escalouAoDono, true); assert.equal(r.percentual, 100)
  assert.equal(relacaoComFase(r, 'reemb_70'), 'avancaram'); assert.equal(relacaoComFase(r, 'reemb_100'), null)
  const m = metricasPorFase([r], fases)
  assert.equal(m.reemb_100.passaram, 0); assert.equal(m.reemb_70.avancaram, 1)
})
