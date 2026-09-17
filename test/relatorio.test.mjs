// Normalizador único do relatório diário (shared/relatorio.js): pedido, cliente,
// produtos, imagens, tipo, percentual e valor. A regra número um é NÃO INVENTAR —
// sem prova, o valor sai null e a página mostra "Valor não registrado".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acharPedido, clienteDoCaso, imagemDoItem, produtosDoCaso, percentualDoTexto, tipoDoTexto,
  normalizarCaso, filtrarCasos, filtrosDoRelatorio, indicadoresDoRelatorio, agruparPorDia,
  dadosDoRelatorio, dinheiro, textoParaCopiar,
} from '../shared/relatorio.js'

const IMG1 = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
const IMG_VAR = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACw='
const lojas = [{ id: 'l1', nome: 'Von Alder', moeda: 'EUR' }, { id: 'l2', nome: 'Northway UK', moeda: 'GBP' }]
const produtos = [
  { id: 'prod1', lojaId: 'l1', imagem: IMG1, imagemPorVariante: { v9: IMG_VAR } },
  { id: 'prod2', lojaId: 'l1', imagem: null, imagemPorVariante: {} },
  { id: 'prod1', lojaId: 'l2', imagem: 'http://inseguro.example/x.png', imagemPorVariante: {} },
]
const item = (titulo, extra = {}) => ({ titulo, variante: null, quantidade: 1, produtoId: null, varianteId: null, ...extra })
const pedidos = [
  { id: 'p1', numero: '#1001', cliente: 'Ana Souza', email: 'ana@web.de', valor: 100, lojaId: 'l1', criadoEm: '2026-09-01', itens: [item('Polo Premium', { variante: 'Preto / L', produtoId: 'prod1', varianteId: 'v9' })] },
  { id: 'p2', numero: '#1002', cliente: 'Bruno Lima', email: 'bruno@web.de', valor: 80, lojaId: 'l1', criadoEm: '2026-09-02', itens: [item('Chino Slim', { produtoId: 'prod2' }), item('Jacke Urban', { variante: 'Navy / XL', quantidade: 2 })] },
  { id: 'p3', numero: '#2001', cliente: 'Carla UK', email: 'carla@uk.co', valor: 50, lojaId: 'l2', criadoEm: '2026-09-03', itens: [item('Shirt', { produtoId: 'prod1' })] },
  { id: 'p4', numero: '#1003', cliente: 'Ana Souza', email: 'ana@web.de', valor: 60, lojaId: 'l1', criadoEm: '2026-09-05', itens: [item('Hemd')] },
]
const tk = (id, extra = {}) => ({
  id, nome: 'Cliente ' + id, de: 'cliente@web.de', assunto: 'Bestellung', corpo: 'texto', historico: [],
  lojaId: 'l1', relatorioDia: '2026-09-10', ...extra,
})
const opcoes = { pedidos, lojas, produtos, fases: { reemb_40: { titulo: 'Reembolso de 40% sem devolução' } } }

test('pedido: relatorioAuto, número citado, e-mail da mesma loja, mais recente sem ambiguidade — e NUNCA outra loja', () => {
  // 1) o que a conclusão automática gravou
  assert.equal(acharPedido(tk('a', { relatorioAuto: { pedido: '#1002' } }), pedidos).id, 'p2')
  // 2) número citado na conversa
  assert.equal(acharPedido(tk('b', { corpo: 'Meine Bestellung 1001 ist kaputt' }), pedidos).id, 'p1')
  // 3) e-mail na mesma loja
  assert.equal(acharPedido(tk('c', { de: 'bruno@web.de' }), pedidos).id, 'p2')
  // vários pedidos do mesmo e-mail: o mais recente (datas desempatam)
  assert.equal(acharPedido(tk('d', { de: 'ana@web.de' }), pedidos).id, 'p4')
  // pedido de OUTRA loja nunca é associado (nem pelo número, nem pelo e-mail)
  assert.equal(acharPedido(tk('e', { corpo: 'pedido 2001' }), pedidos), null)
  assert.equal(acharPedido(tk('f', { de: 'carla@uk.co' }), pedidos), null)
  assert.equal(acharPedido(tk('g', { lojaId: 'l2', de: 'carla@uk.co' }), pedidos).id, 'p3')
  // sem nada que prove: null (não chuta o mais recente da loja)
  assert.equal(acharPedido(tk('h', { de: 'desconhecido@web.de' }), pedidos), null)
})

test('cliente: prefere o do pedido, cai para o do ticket e nunca inventa', () => {
  assert.deepEqual(clienteDoCaso(tk('a'), pedidos[0]), { nome: 'Ana Souza', email: 'ana@web.de' })
  assert.deepEqual(clienteDoCaso(tk('b', { nome: 'Zé', de: 'ze@web.de' }), null), { nome: 'Zé', email: 'ze@web.de' })
  assert.deepEqual(clienteDoCaso({ id: 'c', nome: '', de: '' }, null), { nome: null, email: null })
})

test('imagem: variante → produto → nada; só catálogo da mesma loja e só HTTPS ou data:', () => {
  assert.equal(imagemDoItem(pedidos[0].itens[0], 'l1', produtos), IMG_VAR, 'variante tem prioridade')
  assert.equal(imagemDoItem({ produtoId: 'prod1', varianteId: null }, 'l1', produtos), IMG1, 'cai para a foto do produto')
  assert.equal(imagemDoItem({ produtoId: 'prod2' }, 'l1', produtos), null, 'produto sem foto → ícone')
  assert.equal(imagemDoItem({ produtoId: 'prod1' }, 'l2', produtos), null, 'http:// não é aceito')
  assert.equal(imagemDoItem({ produtoId: 'prod1' }, 'l2', []), null)
  assert.equal(imagemDoItem({ produtoId: null }, 'l1', produtos), null)
})

test('produtos: detalhes salvos, produtos do caso ou itens do pedido — com quantidade e variante', () => {
  const t = tk('a', { atendimentoNovo: { produtosAfetados: ['Polo Premium (Preto / L)'] } })
  const ps = produtosDoCaso(t, pedidos[0], produtos)
  assert.equal(ps.length, 1); assert.equal(ps[0].titulo, 'Polo Premium'); assert.equal(ps[0].variante, 'Preto / L'); assert.equal(ps[0].imagem, IMG_VAR)
  // vários produtos do pedido quando o caso não aponta um específico
  const todos = produtosDoCaso(tk('b'), pedidos[1], produtos)
  assert.deepEqual(todos.map(p => p.titulo), ['Chino Slim', 'Jacke Urban'])
  assert.equal(todos[1].quantidade, 2); assert.equal(todos[0].imagem, null, 'sem foto no catálogo')
})

test('texto: percentual só quando explícito e tipo conservador', () => {
  assert.equal(percentualDoTexto('REEMBOLSO 40%'), 40)
  assert.equal(percentualDoTexto('reembolso parcial'), null)
  assert.equal(percentualDoTexto('desconto de 500%'), null)
  assert.equal(tipoDoTexto('TROCA enviada'), 'troca')
  assert.equal(tipoDoTexto('CANCELAMENTO do pedido'), 'cancelamento')
  assert.equal(tipoDoTexto('cupom de 10%'), 'cupom')
  assert.equal(tipoDoTexto('atendido'), null)
})

test('reembolso AUTOMÁTICO usa exatamente o percentual, valor e moeda gravados', () => {
  const t = tk('auto', {
    relatorioAuto: { eventoId: 'e1', pedido: '#1001', solucao: 'Reembolso de 40% sem devolução', percentual: 40, valor: 40, moeda: 'EUR', cupom: null, faseAceita: 'reemb_40', confirmacaoEnviadaEm: '2026-09-10T12:00:00.000Z', produtos: ['Polo Premium (Preto / L)'] },
  })
  const c = normalizarCaso(t, opcoes)
  assert.equal(c.tipo, 'reembolso'); assert.equal(c.percentual, 40); assert.equal(c.valor, 40); assert.equal(c.moeda, 'EUR')
  assert.equal(c.valorPedido, 100); assert.equal(c.origem, 'motor_novo_automatico'); assert.equal(c.pedidoNumero, '1001')
  assert.equal(c.clienteNome, 'Ana Souza'); assert.equal(c.clienteEmail, 'ana@web.de')
  assert.equal(c.produtos[0].imagem, IMG_VAR); assert.equal(c.faseTitulo, 'Reembolso de 40% sem devolução')
  assert.deepEqual(c.acoes, ['reembolso'])
})

test('reembolso MANUAL estruturado: o que o dono gravou manda, com produtos e observação', () => {
  const t = tk('man', {
    relatorioTexto: 'REEMBOLSO PARCIAL',
    relatorioDetalhes: {
      versao: 1, tipo: 'reembolso', percentual: 25, valor: 25, moeda: 'EUR', valorPedido: 100,
      pedidoId: 'p1', pedidoNumero: '1001', clienteNome: 'Ana Souza', clienteEmail: 'ana@web.de',
      produtos: [{ produtoId: 'prod1', varianteId: 'v9', titulo: 'Polo Premium', variante: 'Preto / L', quantidade: 1, imagem: null }],
      origem: 'manual', observacao: 'combinado por telefone', criadoEm: '2026-09-10T09:00:00.000Z', atualizadoEm: '2026-09-10T09:00:00.000Z',
    },
  })
  const c = normalizarCaso(t, opcoes)
  assert.equal(c.percentual, 25); assert.equal(c.valor, 25); assert.equal(c.origem, 'manual')
  assert.equal(c.observacao, 'combinado por telefone'); assert.equal(c.produtos[0].imagem, IMG_VAR, 'a imagem vem do catálogo')
})

test('relatório ANTIGO só textual: percentual só se explícito; valor só com pedido localizado', () => {
  const comPct = normalizarCaso(tk('t1', { relatorioTexto: 'REEMBOLSO 60%', corpo: 'pedido 1001' }), opcoes)
  assert.equal(comPct.percentual, 60); assert.equal(comPct.valor, 60); assert.equal(comPct.moeda, 'EUR')
  // mesmo texto, sem pedido localizado: percentual sim, valor NÃO
  const semPedido = normalizarCaso(tk('t2', { relatorioTexto: 'REEMBOLSO 60%', de: 'ninguem@web.de' }), opcoes)
  assert.equal(semPedido.percentual, 60); assert.equal(semPedido.valor, null); assert.equal(semPedido.pedidoLocalizado, false)
  // texto sem percentual: nada é deduzido
  const vago = normalizarCaso(tk('t3', { relatorioTexto: 'REEMBOLSO PARCIAL', corpo: 'pedido 1001' }), opcoes)
  assert.equal(vago.percentual, null); assert.equal(vago.valor, null)
})

test('valor desconhecido NUNCA vira zero e cupom não é reembolso', () => {
  const c = normalizarCaso(tk('x', { relatorioTexto: 'REEMBOLSO', de: 'ninguem@web.de' }), opcoes)
  assert.equal(c.valor, null); assert.notEqual(c.valor, 0)
  assert.equal(dinheiro(null, 'EUR'), 'Valor não registrado')
  assert.equal(dinheiro(40, 'EUR'), '€ 40,00')
  // cupom: sem valor e fora do total reembolsado
  const cup = normalizarCaso(tk('c', { relatorioTexto: 'CUPOM 35%', corpo: 'pedido 1001' }), opcoes)
  assert.equal(cup.tipo, 'cupom'); assert.equal(cup.valor, null)
  assert.deepEqual(indicadoresDoRelatorio([cup]).valorPorMoeda, [])
})

test('troca com reembolso parcial mostra as DUAS ações e o valor parcial; troca de vários produtos', () => {
  const t = tk('tr', {
    relatorioAuto: { eventoId: 'e2', pedido: '#1002', solucao: 'Troca gratuita + reembolso de 20%', percentual: 20, valor: 16, moeda: 'EUR', cupom: null, trocaOuReenvio: 'troca_reembolso', confirmacaoEnviadaEm: '2026-09-10T12:00:00.000Z', produtos: [] },
  })
  const c = normalizarCaso(t, opcoes)
  assert.equal(c.tipo, 'troca'); assert.deepEqual(c.acoes, ['troca', 'reembolso'])
  assert.equal(c.percentual, 20); assert.equal(c.valor, 16)
  assert.deepEqual(c.produtos.map(p => p.titulo), ['Chino Slim', 'Jacke Urban'], 'todos os produtos do pedido')
  // reenvio puro
  const re = normalizarCaso(tk('re', { relatorioAuto: { eventoId: 'e3', pedido: '#1001', solucao: 'Reenvio expresso', percentual: null, valor: null, moeda: 'EUR', trocaOuReenvio: 'reenvio', confirmacaoEnviadaEm: '2026-09-10T12:00:00.000Z' } }), opcoes)
  assert.equal(re.tipo, 'reenvio'); assert.deepEqual(re.acoes, ['reenvio']); assert.equal(re.valor, null)
})

test('cancelamento integral usa 100% e o total do pedido SOMENTE com o pedido localizado', () => {
  const com = normalizarCaso(tk('k1', { relatorioTexto: 'CANCELAMENTO INTEGRAL', corpo: 'pedido 1001' }), opcoes)
  assert.equal(com.tipo, 'cancelamento'); assert.equal(com.valor, 100); assert.equal(com.percentual, 100)
  const sem = normalizarCaso(tk('k2', { relatorioTexto: 'CANCELAMENTO INTEGRAL', de: 'ninguem@web.de' }), opcoes)
  assert.equal(sem.valor, null); assert.equal(sem.percentual, null)
})

test('duas moedas nunca se somam: uma linha por moeda', () => {
  const eur = normalizarCaso(tk('m1', { relatorioAuto: { eventoId: 'a', pedido: '#1001', solucao: 'Reembolso de 40%', percentual: 40, valor: 40, moeda: 'EUR', confirmacaoEnviadaEm: 'x' } }), opcoes)
  const gbp = normalizarCaso(tk('m2', { lojaId: 'l2', relatorioAuto: { eventoId: 'b', pedido: '#2001', solucao: 'Reembolso de 50%', percentual: 50, valor: 25, moeda: 'GBP', confirmacaoEnviadaEm: 'x' } }), opcoes)
  const ind = indicadoresDoRelatorio([eur, gbp])
  assert.deepEqual(ind.valorPorMoeda, [{ moeda: 'EUR', valor: 40 }, { moeda: 'GBP', valor: 25 }])
  assert.equal(ind.reembolsos, 2); assert.equal(ind.total, 2)
})

test('filtros mudam as linhas E os indicadores; agrupamento por dia e loja', () => {
  const tickets = [
    tk('f1', { relatorioAuto: { eventoId: 'a', pedido: '#1001', solucao: 'Reembolso de 40%', percentual: 40, valor: 40, moeda: 'EUR', confirmacaoEnviadaEm: 'x' } }),
    tk('f2', { lojaId: 'l2', de: 'carla@uk.co', relatorioDia: '2026-09-11', relatorioTexto: 'TROCA', relatorioProcessado: '2026-09-11T10:00:00.000Z' }),
    tk('f3', { relatorioTexto: 'CUPOM 10%', de: 'bruno@web.de' }),
  ]
  const base = { tickets, pedidos, lojas, produtos, fases: {}, mostrarHoje: true }
  const tudo = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({}) })
  assert.equal(tudo.indicadores.total, 3); assert.equal(tudo.dias.length, 2)
  assert.equal(tudo.dias[0].dia, '2026-09-11', 'mais recente primeiro')
  const soLoja1 = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({ loja: 'l1' }) })
  assert.equal(soLoja1.indicadores.total, 2); assert.deepEqual(soLoja1.indicadores.valorPorMoeda, [{ moeda: 'EUR', valor: 40 }])
  const soProcessados = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({ situacao: 'processados' }) })
  assert.equal(soProcessados.indicadores.total, 1); assert.equal(soProcessados.indicadores.processados, 1)
  const soTroca = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({ tipo: 'troca' }) })
  assert.equal(soTroca.indicadores.total, 1)
  const busca = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({ busca: 'ana@web.de' }) })
  assert.equal(busca.indicadores.total, 1); assert.equal(busca.dias[0].lojas[0].casos[0].clienteEmail, 'ana@web.de')
  const porDia = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({ dia: '2026-09-10' }) })
  assert.equal(porDia.dias.length, 1); assert.equal(porDia.indicadores.total, 2)
  // "mostrar hoje" desligado tira o dia atual
  const semHoje = dadosDoRelatorio({ ...base, filtros: filtrosDoRelatorio({}), hoje: '2026-09-11', mostrarHoje: false })
  assert.equal(semHoje.dias.length, 1); assert.equal(semHoje.dias[0].dia, '2026-09-10')
})

test('agrupamento por loja dentro do dia e texto para copiar com pedido, cliente, produto, ação, percentual e valor', () => {
  const casos = [
    normalizarCaso(tk('c1', { relatorioAuto: { eventoId: 'a', pedido: '#1001', solucao: 'Reembolso de 40%', percentual: 40, valor: 40, moeda: 'EUR', confirmacaoEnviadaEm: 'x', produtos: ['Polo Premium (Preto / L)'] } }), opcoes),
    normalizarCaso(tk('c2', { lojaId: 'l2', de: 'carla@uk.co', relatorioTexto: 'TROCA' }), opcoes),
  ]
  const dias = agruparPorDia(casos)
  assert.equal(dias.length, 1); assert.deepEqual(dias[0].lojas.map(l => l.nome), ['Von Alder', 'Northway UK'])
  const txt = textoParaCopiar(dias)
  assert.match(txt, /RELATÓRIO 10\/09\/2026/)
  assert.match(txt, /PEDIDO 1001/); assert.match(txt, /cliente: Ana Souza \/ ana@web\.de/)
  assert.match(txt, /produto: Polo Premium \(Preto \/ L\)/); assert.match(txt, /40%/); assert.match(txt, /€ 40,00/); assert.match(txt, /pendente/)
  assert.match(txt, /Loja: Northway UK/)
})

test('pedido não localizado: o caso aparece, com aviso e sem valores inventados', () => {
  const c = normalizarCaso(tk('np', { de: 'ninguem@web.de', relatorioTexto: 'REEMBOLSO' }), opcoes)
  assert.equal(c.pedidoLocalizado, false); assert.equal(c.pedidoNumero, null)
  assert.equal(c.valor, null); assert.equal(c.valorPedido, null)
  assert.equal(c.clienteNome, 'Cliente np'); assert.equal(c.clienteEmail, 'ninguem@web.de')
  assert.deepEqual(c.produtos, [], 'sem pedido, sem produtos inventados')
})

test('filtrarCasos e indicadores são coerentes entre si', () => {
  const casos = [
    { ticketId: '1', dia: '2026-09-10', lojaId: 'l1', lojaNome: 'A', tipo: 'reembolso', acoes: ['reembolso'], valor: 10, moeda: 'EUR', processado: false, produtos: [], descricao: 'x', pedidoNumero: '1', clienteNome: null, clienteEmail: null },
    { ticketId: '2', dia: '2026-09-10', lojaId: 'l1', lojaNome: 'A', tipo: 'troca', acoes: ['troca'], valor: null, moeda: 'EUR', processado: true, produtos: [], descricao: 'y', pedidoNumero: '2', clienteNome: null, clienteEmail: null },
  ]
  const f = filtrosDoRelatorio({ situacao: 'pendentes' })
  const visiveis = filtrarCasos(casos, f)
  assert.equal(visiveis.length, 1)
  const ind = indicadoresDoRelatorio(visiveis)
  assert.equal(ind.total, 1); assert.equal(ind.pendentes, 1); assert.equal(ind.processados, 0); assert.deepEqual(ind.valorPorMoeda, [{ moeda: 'EUR', valor: 10 }])
})
