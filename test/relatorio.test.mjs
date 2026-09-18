// Normalizador único do relatório diário (shared/relatorio.js): pedido, cliente,
// produtos, imagens, tipo, percentual e valor. A regra número um é NÃO INVENTAR —
// sem prova, o valor sai null e a página mostra "Valor não registrado".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acharPedido, clienteDoCaso, imagemDoItem, produtosDoCaso, percentualDoTexto, tipoDoTexto,
  normalizarCaso, filtrarCasos, filtrosDoRelatorio, indicadoresDoRelatorio, agruparPorDia,
  acharPedidos, numerosDePedidoNoTexto, numerosCitados,
  precisaVinculo, buscaInicialVinculo,
  emailCanonico,
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

test('pedido: relatorioAuto, número citado, e-mail da mesma loja com um único pedido — e NUNCA outra loja', () => {
  // 1) o que a conclusão automática gravou
  assert.equal(acharPedido(tk('a', { relatorioAuto: { pedido: '#1002' } }), pedidos).id, 'p2')
  // 2) número citado na conversa
  assert.equal(acharPedido(tk('b', { corpo: 'Meine Bestellung 1001 ist kaputt' }), pedidos).id, 'p1')
  // 3) e-mail na mesma loja
  assert.equal(acharPedido(tk('c', { de: 'bruno@web.de' }), pedidos).id, 'p2')
  // vários pedidos do mesmo e-mail: NÃO escolhe o mais recente — fica sem pedido e o dono vincula à mão
  assert.equal(acharPedido(tk('d', { de: 'ana@web.de' }), pedidos), null)
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

/* ====================================================================
   Relatórios ANTIGOS: o número do pedido está escrito na linha/no texto,
   não na conversa. Casos reais da produção (PEDIDO 2614, PEDIDOS 2673 E
   2695, PEDIDO 1591) que antes caíam em "Sem pedido localizado".
   ==================================================================== */

const lojasAntigas = [{ id: 'l1', nome: 'Von Alder', moeda: 'EUR' }, { id: 'l2', nome: 'Northway UK', moeda: 'GBP' }]
const produtosAntigos = [
  { id: 'cat-polo', lojaId: 'l1', titulo: 'Polo Premium', imagem: IMG1, imagemPorVariante: {} },
  { id: 'cat-camisa', lojaId: 'l1', titulo: 'Camisa Dupla', imagem: IMG1, imagemPorVariante: {} },
  { id: 'cat-camisa-2', lojaId: 'l1', titulo: 'Camisa Dupla', imagem: IMG_VAR, imagemPorVariante: {} }, // título repetido
]
const itemSemId = (titulo, extra = {}) => ({ titulo, variante: null, quantidade: 1, ...extra })
const pedidosAntigos = [
  { id: 'a2614', numero: '#2614', cliente: 'Marta Klein', email: 'marta@web.de', valor: 120, lojaId: 'l1', criadoEm: '2026-08-01', itens: [itemSemId('Polo Premium', { variante: '2XL' })] },
  { id: 'a2673', numero: '#2673', cliente: 'Jonas Weber', email: 'jonas@web.de', valor: 80, lojaId: 'l1', criadoEm: '2026-08-02', itens: [itemSemId('Polo Premium', { variante: '2XL' })] },
  { id: 'a2695', numero: '#2695', cliente: 'Jonas Weber', email: 'jonas@web.de', valor: 60, lojaId: 'l1', criadoEm: '2026-08-03', itens: [itemSemId('Camisa Dupla', { variante: '3XL' })] },
  { id: 'a1591', numero: '#1591', cliente: 'Rita Alves', email: 'rita@web.de', valor: 210, lojaId: 'l1', criadoEm: '2026-08-04', itens: [itemSemId('Polo Premium', { quantidade: 3 })] },
  { id: 'b2614', numero: '#2614', cliente: 'Outro Cliente', email: 'outro@uk.co', valor: 999, lojaId: 'l2', criadoEm: '2026-08-05', itens: [itemSemId('Shirt')] },
]
const antigo = (id, extra = {}) => ({
  id, nome: 'Cliente antigo', de: 'desconhecido@web.de', assunto: 'Umtausch', corpo: 'Mensagem sem número.',
  historico: [], lojaId: 'l1', relatorioDia: '2026-09-10', ...extra,
})
const opcoesAntigas = { pedidos: pedidosAntigos, lojas: lojasAntigas, produtos: produtosAntigos }

test('linha antiga "PEDIDO 2614 - TROCAR AS 2XL POR 4XL" localiza o pedido', () => {
  const c = normalizarCaso(antigo('t1', { relatorioLinha: 'PEDIDO 2614 - TROCAR AS 2XL POR 4XL' }), opcoesAntigas)
  assert.equal(c.pedidoNumero, '2614')
  assert.equal(c.pedidoId, 'a2614')
  assert.equal(c.pedidoLocalizado, true)
  assert.equal(c.pedidoTitulo, 'Pedido #2614')
  assert.equal(c.clienteNome, 'Marta Klein')
  assert.equal(c.valorPedido, 120)
  assert.equal(c.produtos[0].titulo, 'Polo Premium')
})

test('"PEDIDO 2673 E 2695" devolve os DOIS pedidos, com os produtos dos dois', () => {
  const c = normalizarCaso(antigo('t2', { relatorioLinha: 'PEDIDO 2673 E 2695 - TROCAR POR 4XL' }), opcoesAntigas)
  assert.deepEqual(c.pedidoNumeros, ['2673', '2695'])
  assert.equal(c.pedidos.length, 2)
  assert.ok(c.pedidos.every(p => p.localizado))
  assert.equal(c.pedidoTitulo, 'Pedidos #2673 e #2695')
  assert.equal(c.pedidoNumero, null, 'o campo singular só vale com um pedido')
  assert.deepEqual(c.produtos.map(p => p.titulo), ['Polo Premium', 'Camisa Dupla'])
  assert.equal(c.valorPedido, null, 'nunca soma os totais de pedidos diferentes')
  assert.equal(c.valor, null, 'e por isso não calcula reembolso sozinho')
})

test('pedido citado mas ausente na Shopify mostra o número e o aviso — sem valor inventado', () => {
  const c = normalizarCaso(antigo('t3', { relatorioTexto: 'PEDIDO 9911 - REEMBOLSO 50%' }), opcoesAntigas)
  assert.deepEqual(c.pedidoNumeros, ['9911'])
  assert.equal(c.pedidoLocalizado, false)
  assert.deepEqual(c.pedidosSemDados, ['9911'])
  assert.equal(c.rotuloPedido, 'Pedido #9911 citado — dados não encontrados na Shopify')
  assert.equal(c.percentual, 50)
  assert.equal(c.valorPedido, null)
  assert.equal(c.valor, null)
  assert.equal(dinheiro(c.valor, c.moeda), 'Valor não registrado')
})

test('sem número escrito em lugar nenhum: "Sem pedido informado", não "sem pedido localizado"', () => {
  const c = normalizarCaso(antigo('t4', { relatorioTexto: 'ATENDIDO' }), opcoesAntigas)
  assert.deepEqual(c.pedidoNumeros, [])
  assert.equal(c.pedidoTitulo, 'Sem pedido informado')
  assert.equal(c.rotuloPedido, 'Sem pedido informado')
})

test('"REEMBOLSO 100%" não vira pedido 100 e "TROCAR POR 4XL" não vira pedido 4', () => {
  assert.deepEqual(numerosDePedidoNoTexto('REEMBOLSO 100%'), [])
  assert.deepEqual(numerosDePedidoNoTexto('TROCAR 3 POLOS POR 6XL'), [])
  assert.deepEqual(numerosDePedidoNoTexto('REEMBOLSO DE 103,50 EUR'), [])
  assert.deepEqual(numerosDePedidoNoTexto('CEP 01310-100, tel 99999-9999, em 12/09/2026'), [])
  // com palavra de contexto, aí sim
  assert.deepEqual(numerosDePedidoNoTexto('PEDIDO 1591 - TROCAR 3 POLOS POR 6XL'), ['1591'])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIDO #2614'), ['2614'])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIDOS 2673 E 2695'), ['2673', '2695'])
  assert.deepEqual(numerosDePedidoNoTexto('ORDER 2614'), ['2614'])
  assert.deepEqual(numerosDePedidoNoTexto('Bestellung 2614'), ['2614'])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIDO 100% DEVOLVIDO'), [], 'percentual nunca é pedido')
  // um caso inteiro: 100% no texto não associa pedido nenhum
  const c = normalizarCaso(antigo('t5', { relatorioTexto: 'REEMBOLSO 100%' }), opcoesAntigas)
  assert.deepEqual(c.pedidoNumeros, [])
  assert.equal(c.percentual, 100)
})

test('o número da linha final vence o número antigo escrito no texto e o citado na conversa', () => {
  const t = antigo('t6', {
    corpo: 'Bestellung 1591, bitte tauschen.',
    relatorioTexto: 'PEDIDO 2673 - TROCA',
    relatorioLinha: 'PEDIDO 2614 - TROCAR AS 2XL POR 4XL',
  })
  const c = normalizarCaso(t, opcoesAntigas)
  assert.equal(c.pedidoNumero, '2614')
  assert.equal(acharPedidos(t, pedidosAntigos).origem, 'linha')
  // sem a linha, vale o texto; sem o texto, vale a conversa
  const semLinha = normalizarCaso({ ...t, relatorioLinha: undefined }, opcoesAntigas)
  assert.equal(semLinha.pedidoNumero, '2673')
  const soConversa = normalizarCaso({ ...t, relatorioLinha: undefined, relatorioTexto: undefined }, opcoesAntigas)
  assert.equal(soConversa.pedidoNumero, '1591')
})

test('número escrito na linha NUNCA associa pedido de outra loja', () => {
  const daOutra = normalizarCaso(antigo('t7', { lojaId: 'l2', relatorioLinha: 'PEDIDO 2614 - TROCA' }), opcoesAntigas)
  assert.equal(daOutra.pedidoId, 'b2614', 'na loja 2 vale o pedido da loja 2')
  assert.equal(daOutra.valorPedido, 999)
  const daUm = normalizarCaso(antigo('t8', { relatorioLinha: 'PEDIDO 2614 - TROCA' }), opcoesAntigas)
  assert.equal(daUm.pedidoId, 'a2614')
  // pedido que só existe na outra loja não é associado
  const so2 = normalizarCaso(antigo('t9', { relatorioLinha: 'PEDIDO 2614 - TROCA' }), { ...opcoesAntigas, pedidos: pedidosAntigos.filter(p => p.lojaId === 'l2') })
  assert.equal(so2.pedidoLocalizado, false)
  assert.deepEqual(so2.pedidosSemDados, ['2614'])
})

test('pedido histórico sem produtoId: imagem só por título EXATO e ÚNICO na mesma loja', () => {
  // "Polo Premium" existe uma única vez no catálogo da loja 1
  const um = normalizarCaso(antigo('t10', { relatorioLinha: 'PEDIDO 2614 - TROCA' }), opcoesAntigas)
  assert.equal(um.produtos[0].imagem, IMG1)
  // "Camisa Dupla" está repetida: ícone neutro (imagem null), nunca o palpite
  const ambiguo = normalizarCaso(antigo('t11', { relatorioLinha: 'PEDIDO 2695 - TROCA' }), opcoesAntigas)
  assert.equal(ambiguo.produtos[0].titulo, 'Camisa Dupla')
  assert.equal(ambiguo.produtos[0].imagem, null)
  // título diferente não casa de jeito nenhum (nada de aproximado)
  assert.equal(imagemDoItem({ titulo: 'Polo' }, 'l1', produtosAntigos), null)
  assert.equal(imagemDoItem({ titulo: 'Polo Premium' }, 'l2', produtosAntigos), null, 'catálogo é por loja')
})

test('a associação do relatório NUNCA escreve no estado do motor', () => {
  const t = antigo('t12', { relatorioLinha: 'PEDIDO 2614 - TROCA', atendimentoNovo: { versao: 1, produtosAfetados: [], produtosInformados: false } })
  const antes = JSON.stringify(t.atendimentoNovo)
  const c = normalizarCaso(t, opcoesAntigas)
  assert.equal(c.produtos.length, 1)
  assert.equal(JSON.stringify(t.atendimentoNovo), antes, 'produtosAfetados continua vazio')
  assert.deepEqual(t.atendimentoNovo.produtosAfetados, [])
})

test('caso #2026 (já estruturado) continua idêntico: foto, cliente, 100% e € 103,50', () => {
  const pedido2026 = {
    id: 'p2026', numero: '#2026', cliente: 'Ana Souza', email: 'ana@web.de', valor: 103.5, lojaId: 'l1', criadoEm: '2026-09-01',
    itens: [{ titulo: 'Polo Premium', variante: 'Preto / L', quantidade: 1, produtoId: 'prod1', varianteId: 'v9' }],
  }
  const t = {
    ...tk('c2026', { relatorioTexto: 'CANCELAMENTO INTEGRAL' }),
    relatorioDetalhes: {
      versao: 1, tipo: 'cancelamento', percentual: 100, valor: 103.5, moeda: 'EUR', valorPedido: 103.5,
      pedidoId: 'p2026', pedidoNumero: '2026', clienteNome: 'Ana Souza', clienteEmail: 'ana@web.de',
      produtos: [{ produtoId: 'prod1', varianteId: 'v9', titulo: 'Polo Premium', variante: 'Preto / L', quantidade: 1, imagem: null }],
      origem: 'manual', observacao: null, criadoEm: '2026-09-10T08:00:00.000Z', atualizadoEm: '2026-09-10T08:00:00.000Z',
    },
  }
  const c = normalizarCaso(t, { ...opcoes, pedidos: [...pedidos, pedido2026] })
  assert.equal(c.pedidoNumero, '2026')
  assert.equal(c.pedidoTitulo, 'Pedido #2026')
  assert.equal(c.pedidoLocalizado, true)
  assert.equal(c.clienteNome, 'Ana Souza')
  assert.equal(c.percentual, 100)
  assert.equal(c.valor, 103.5)
  assert.equal(dinheiro(c.valor, c.moeda), '€ 103,50')
  assert.equal(c.produtos[0].imagem, IMG_VAR, 'a foto da variante continua vindo do catálogo')
})
/* ====================================================================
   "PEDIU DUAS VEZES": duplicidade escrita à mão, e-mail ambíguo e o que
   o vínculo manual precisa mostrar.
   ==================================================================== */

const pedidosDuplos = [
  ...pedidosAntigos,
  { id: 'a3085', numero: '#3085', cliente: 'Angela Ruiz', email: 'angela@web.de', valor: 90, lojaId: 'l1', criadoEm: '2026-08-10', itens: [itemSemId('Polo Premium')] },
  { id: 'a3086', numero: '#3086', cliente: 'Angela Ruiz', email: 'angela@web.de', valor: 90, lojaId: 'l1', criadoEm: '2026-08-10', itens: [itemSemId('Camisa Dupla')] },
]
const LINHA_ANGELA = 'PEDIU DUAS VEZES SEM QUERER 3085 E 3086, ELE QUER CANCELAR UM'

test('"PEDIU DUAS VEZES SEM QUERER 3085 E 3086" localiza os DOIS pedidos', () => {
  const c = normalizarCaso(antigo('d1', { de: 'angela@web.de', relatorioTexto: LINHA_ANGELA }), { ...opcoesAntigas, pedidos: pedidosDuplos })
  assert.deepEqual(c.pedidoNumeros, ['3085', '3086'])
  assert.equal(c.pedidoTitulo, 'Pedidos #3085 e #3086')
  assert.equal(c.rotuloPedido, 'Pedidos #3085 e #3086')
  assert.equal(c.pedidoLocalizado, true)
  assert.deepEqual(c.pedidos.map(p => p.id), ['a3085', 'a3086'])
  assert.equal(c.clienteNome, 'Angela Ruiz')
  assert.equal(c.valorPedido, null, 'dois pedidos nunca somam')
})

test('a mesma frase preserva os números quando os pedidos não estão sincronizados', () => {
  const c = normalizarCaso(antigo('d2', { relatorioTexto: LINHA_ANGELA }), opcoesAntigas)
  assert.deepEqual(c.pedidoNumeros, ['3085', '3086'])
  assert.equal(c.pedidoLocalizado, false)
  assert.deepEqual(c.pedidosSemDados, ['3085', '3086'])
  assert.equal(c.rotuloPedido, 'Pedidos #3085 e #3086 citados — dados não encontrados na Shopify')
  assert.equal(c.valor, null)
})

test('a construção de duplicidade NÃO vira porta aberta para qualquer número', () => {
  assert.deepEqual(numerosDePedidoNoTexto(LINHA_ANGELA), ['3085', '3086'])
  assert.deepEqual(numerosDePedidoNoTexto('COMPROU 2 VEZES 3085 E 3086'), ['3085', '3086'])
  // sem a frase de duplicidade, número solto continua fora
  assert.deepEqual(numerosDePedidoNoTexto('SEM QUERER 3085 E 3086'), [])
  // um número só não basta: a construção é de DOIS pedidos
  assert.deepEqual(numerosDePedidoNoTexto('PEDIU DUAS VEZES 3085'), [])
  // percentual, dinheiro, data, CEP e telefone continuam de fora
  assert.deepEqual(numerosDePedidoNoTexto('pediu reembolso de 100%'), [])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIU DUAS VEZES 100% E 50%'), [])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIU DUAS VEZES EM 12/09/2026 E 13/09/2026'), [])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIU DUAS VEZES, VALOR 103,50 E 210,00'), [])
  assert.deepEqual(numerosDePedidoNoTexto('PEDIU DUAS VEZES, CEP 01310-100 E TEL 99999-9999'), [])
})

test('dois pedidos do mesmo e-mail NUNCA são associados sozinhos; um só continua sendo', () => {
  // Angela tem dois pedidos na loja: sem número escrito, o caso fica sem pedido
  const ambiguo = normalizarCaso(antigo('d3', { de: 'angela@web.de', relatorioTexto: 'CANCELAMENTO' }), { ...opcoesAntigas, pedidos: pedidosDuplos })
  assert.equal(ambiguo.pedidoLocalizado, false)
  assert.deepEqual(ambiguo.pedidoNumeros, [])
  assert.equal(ambiguo.rotuloPedido, 'Sem pedido informado')
  assert.equal(precisaVinculo(ambiguo), true, 'o dono vincula à mão')
  // Marta tem um só: continua associada automaticamente
  const unico = normalizarCaso(antigo('d4', { de: 'marta@web.de', relatorioTexto: 'REEMBOLSO 50%' }), { ...opcoesAntigas, pedidos: pedidosDuplos })
  assert.equal(unico.pedidoId, 'a2614')
  assert.equal(precisaVinculo(unico), false)
  assert.equal(acharPedidos(antigo('d5', { de: 'marta@web.de' }), pedidosDuplos).origem, 'email')
})

test('o vínculo manual já abre pesquisando pelo número, pelo e-mail ou pelo nome', () => {
  const citado = normalizarCaso(antigo('d6', { relatorioTexto: LINHA_ANGELA }), opcoesAntigas)
  assert.equal(buscaInicialVinculo(citado), '3085', 'com número citado, procura pelo número')
  const semNumero = normalizarCaso(antigo('d7', { de: 'angela@web.de', relatorioTexto: 'CANCELAMENTO' }), { ...opcoesAntigas, pedidos: pedidosDuplos })
  assert.equal(buscaInicialVinculo(semNumero), 'angela@web.de', 'sem número, procura pelo e-mail')
  const semEmail = normalizarCaso({ ...antigo('d8', { relatorioTexto: 'CANCELAMENTO' }), de: '', nome: 'Angela Ruiz' }, opcoesAntigas)
  assert.equal(buscaInicialVinculo(semEmail), 'Angela Ruiz', 'sem e-mail, procura pelo nome')
  // caso já resolvido não precisa de vínculo
  const comPedido = normalizarCaso(antigo('d9', { relatorioLinha: 'PEDIDO 2614 - TROCA' }), opcoesAntigas)
  assert.equal(precisaVinculo(comPedido), false)
})
/* ====================================================================
   E-mail canônico, desempates e cálculo do reembolso sobre o total pago.
   ==================================================================== */

const lojasV = [{ id: 'l1', nome: 'Von Alder', moeda: 'EUR' }, { id: 'l2', nome: 'Northway UK', moeda: 'GBP' }]
const itemV = (titulo, extra = {}) => ({ titulo, variante: null, quantidade: 1, ...extra })
const pedidosV = [
  { id: 'v100', numero: '#4001', cliente: 'Maria Silva', email: 'maria@email.com', valor: 100, lojaId: 'l1', criadoEm: '2026-08-01', rastreio: 'LX123456789DE', itens: [itemV('Polo Premium')] },
  { id: 'v136', numero: '#4002', cliente: 'Joao Pires', email: 'joao@email.com', valor: 136, lojaId: 'l1', criadoEm: '2026-08-02', rastreio: '—', itens: [itemV('Hemd Classic')] },
  { id: 'vgbp', numero: '#5001', cliente: 'Kate UK', email: 'kate@uk.co', valor: 89.9, lojaId: 'l2', criadoEm: '2026-08-03', rastreio: '—', itens: [itemV('Shirt')] },
]
// mesmo e-mail, três pedidos: base dos desempates
const trio = [
  { id: 'x1', numero: '#7001', cliente: 'Rita Alves', email: 'rita@email.com', valor: 50, lojaId: 'l1', criadoEm: '2026-08-01', rastreio: 'AA111111111DE', itens: [itemV('Polo Premium')] },
  { id: 'x2', numero: '#7002', cliente: 'Rita Alves', email: 'rita@email.com', valor: 60, lojaId: 'l1', criadoEm: '2026-08-05', rastreio: 'BB222222222DE', itens: [itemV('Chino Slim')] },
  { id: 'x3', numero: '#7003', cliente: 'Rita Alves', email: 'rita@email.com', valor: 70, lojaId: 'l1', criadoEm: '2026-08-20', rastreio: '—', itens: [itemV('Jacke Urban')] },
]
const caso = (extra = {}) => ({
  id: 'e1', nome: 'Cliente', de: 'maria@email.com', assunto: 'Frage', corpo: 'Mensagem.', historico: [],
  lojaId: 'l1', relatorioDia: '2026-09-10', ...extra,
})
const opcoesV = { pedidos: pedidosV, lojas: lojasV, produtos: [] }

test('e-mail canônico: "Nome <email>", "<email>", maiúsculas e espaços chegam ao mesmo pedido', () => {
  assert.equal(emailCanonico('Maria Silva <maria@email.com>'), 'maria@email.com')
  assert.equal(emailCanonico('<maria@email.com>'), 'maria@email.com')
  assert.equal(emailCanonico('maria@email.com'), 'maria@email.com')
  assert.equal(emailCanonico('  MARIA@Email.COM  '), 'maria@email.com')
  assert.equal(emailCanonico('Maria Silva < MARIA@EMAIL.COM >'), 'maria@email.com')
  assert.equal(emailCanonico(''), null)
  assert.equal(emailCanonico(null), null)
  // e o caso inteiro acha o mesmo pedido nas três formas
  for (const de of ['Maria Silva <maria@email.com>', '<maria@email.com>', 'maria@email.com', ' MARIA@EMAIL.COM ']) {
    const c = normalizarCaso(caso({ de }), opcoesV)
    assert.equal(c.pedidoNumero, '4001', 'falhou para: ' + de)
    assert.equal(c.origemPedido, 'email')
    assert.equal(c.clienteNome, 'Maria Silva')
    assert.equal(c.valorPedido, 100)
  }
})

test('vários pedidos do mesmo e-mail: desempate por número, rastreio, produto e data', () => {
  const opc = { ...opcoesV, pedidos: trio }
  const base = { de: 'Rita Alves <rita@email.com>', nome: 'Rita Alves' }
  // sem nada que desempate: ninguém é escolhido, e os candidatos ficam à mão
  const empate = normalizarCaso(caso({ ...base, id: 'r0' }), opc)
  assert.equal(empate.pedidoLocalizado, false)
  assert.equal(empate.candidatos.length, 3)
  // 1) número citado
  const porNumero = normalizarCaso(caso({ ...base, id: 'r1', relatorioTexto: 'PEDIDO 7002 - REEMBOLSO 50%' }), opc)
  assert.equal(porNumero.pedidoNumero, '7002')
  // 2) rastreio citado
  const porRastreio = normalizarCaso(caso({ ...base, id: 'r2', corpo: 'Meu codigo AA111111111DE nao anda.' }), opc)
  assert.equal(porRastreio.pedidoNumero, '7001')
  assert.equal(porRastreio.origemPedido, 'rastreio')
  // 3) produto citado (com e-mail repetido)
  const porProduto = normalizarCaso(caso({ ...base, id: 'r3', corpo: 'O Chino Slim veio errado.' }), opc)
  assert.equal(porProduto.pedidoNumero, '7002')
  assert.equal(porProduto.origemPedido, 'email_produto')
  // 4) data: pedido criado ANTES da primeira mensagem e mais próximo dela
  const porData = normalizarCaso(caso({ ...base, id: 'r4', corpo: 'Quero cancelar.', data: '2026-08-07T10:00:00.000Z' }), opc)
  assert.equal(porData.pedidoNumero, '7002', 'o de 05/08 é o mais próximo antes de 07/08')
  assert.equal(porData.origemPedido, 'email_data')
})

test('pedido de outra loja continua fora, mesmo com o e-mail batendo', () => {
  const c = normalizarCaso(caso({ id: 'o1', de: 'Kate <kate@uk.co>' }), opcoesV)
  assert.equal(c.pedidoLocalizado, false, 'kate só tem pedido na loja 2')
  const naLoja2 = normalizarCaso(caso({ id: 'o2', lojaId: 'l2', de: 'Kate <kate@uk.co>' }), opcoesV)
  assert.equal(naLoja2.pedidoNumero, '5001')
})

test('reembolso calculado sobre o total REALMENTE PAGO, em centavos e na moeda do pedido', () => {
  const valorDe = (extra, opc = opcoesV) => normalizarCaso(caso(extra), opc)
  const c40 = valorDe({ id: 'm1', relatorioTexto: 'REEMBOLSO 40%' })
  assert.equal(c40.percentual, 40); assert.equal(c40.valor, 40); assert.equal(dinheiro(c40.valor, c40.moeda), '€ 40,00')
  const c60 = valorDe({ id: 'm2', relatorioTexto: 'REEMBOLSO 60%' })
  assert.equal(c60.valor, 60); assert.equal(dinheiro(c60.valor, c60.moeda), '€ 60,00')
  const c25 = valorDe({ id: 'm3', de: 'joao@email.com', relatorioTexto: 'REEMBOLSO 25%' })
  assert.equal(c25.valorPedido, 136); assert.equal(c25.valor, 34); assert.equal(dinheiro(c25.valor, c25.moeda), '€ 34,00')
  const gbp = valorDe({ id: 'm4', lojaId: 'l2', de: 'kate@uk.co', relatorioTexto: 'REEMBOLSO 40%' })
  assert.equal(gbp.valorPedido, 89.9); assert.equal(gbp.valor, 35.96); assert.equal(dinheiro(gbp.valor, gbp.moeda), '£ 35,96')
  const integral = valorDe({ id: 'm5', de: 'joao@email.com', relatorioTexto: 'CANCELAMENTO INTEGRAL do pedido' })
  assert.equal(integral.percentual, 100); assert.equal(integral.valor, 136)
  const cem = valorDe({ id: 'm6', de: 'joao@email.com', relatorioTexto: 'REEMBOLSO 100%' })
  assert.equal(cem.valor, 136, '100% é exatamente o total pago')
})

test('sem prova não há valor: troca pura, cupom, vários pedidos e percentual ausente', () => {
  const troca = normalizarCaso(caso({ id: 'n1', relatorioTexto: 'TROCA DE TAMANHO' }), opcoesV)
  assert.equal(troca.valor, null); assert.deepEqual(troca.acoes, ['troca'])
  const cupom = normalizarCaso(caso({ id: 'n2', relatorioTexto: 'CUPOM 35% para a próxima' }), opcoesV)
  assert.equal(cupom.valor, null)
  const semPct = normalizarCaso(caso({ id: 'n3', relatorioTexto: 'REEMBOLSO' }), opcoesV)
  assert.equal(semPct.valor, null); assert.equal(dinheiro(semPct.valor, semPct.moeda), 'Valor não registrado')
  const varios = normalizarCaso(caso({ id: 'n4', relatorioTexto: 'PEDIDO 4001 E 4002 - REEMBOLSO 50%' }), opcoesV)
  assert.equal(varios.pedidos.length, 2); assert.equal(varios.valorPedido, null); assert.equal(varios.valor, null)
  const semPedido = normalizarCaso(caso({ id: 'n5', de: 'ninguem@web.de', relatorioTexto: 'REEMBOLSO 40%' }), opcoesV)
  assert.equal(semPedido.pedidoLocalizado, false); assert.equal(semPedido.valor, null)
})

test('indicadores: pendente entra em previsto, processado entra em reembolsado — e moedas nunca se somam', () => {
  const pendente = normalizarCaso(caso({ id: 'i1', relatorioTexto: 'REEMBOLSO 40%' }), opcoesV)
  const processado = normalizarCaso(caso({ id: 'i2', de: 'joao@email.com', relatorioTexto: 'REEMBOLSO 25%', relatorioProcessado: '2026-09-11T10:00:00.000Z' }), opcoesV)
  const libras = normalizarCaso(caso({ id: 'i3', lojaId: 'l2', de: 'kate@uk.co', relatorioTexto: 'REEMBOLSO 40%', relatorioProcessado: '2026-09-11T10:00:00.000Z' }), opcoesV)
  const ind = indicadoresDoRelatorio([pendente, processado, libras])
  assert.deepEqual(ind.previstoPorMoeda, [{ moeda: 'EUR', valor: 40 }], 'oferta aceita não é dinheiro devolvido')
  assert.deepEqual(ind.reembolsadoPorMoeda, [{ moeda: 'EUR', valor: 34 }, { moeda: 'GBP', valor: 35.96 }])
  assert.equal(ind.pendentes, 1); assert.equal(ind.processados, 2)
})

test('relatório interno e página externa mostram exatamente os mesmos números', async () => {
  const { paginaRelatorio } = await import('../server/relatorio-externo.js')
  const tickets = [
    caso({ id: 's1', relatorioTexto: 'REEMBOLSO 40%' }),
    caso({ id: 's2', de: 'joao@email.com', relatorioTexto: 'REEMBOLSO 25%' }),
  ]
  const dados = dadosDoRelatorio({ tickets, pedidos: pedidosV, lojas: lojasV, produtos: [], filtros: filtrosDoRelatorio({}) })
  const html = paginaRelatorio(dados)
  const copia = textoParaCopiar(dados.dias)
  for (const esperado of ['Pedido #4001', '€ 40,00', 'Pedido #4002', '€ 34,00']) {
    assert.ok(html.includes(esperado), 'a página externa mostra ' + esperado)
  }
  for (const esperado of ['PEDIDO 4001', '€ 40,00', 'PEDIDO 4002', '€ 34,00']) {
    assert.ok(copia.includes(esperado), 'o relatório interno mostra ' + esperado)
  }
  // e a origem da associação aparece no detalhe
  assert.ok(html.includes('e-mail do cliente (único pedido na loja)'))
})

test('troca com reembolso parcial aparece como uma ação só, com percentual e valor', async () => {
  const { paginaRelatorio } = await import('../server/relatorio-externo.js')
  const t = caso({ id: 'tp1', relatorioTexto: 'TROCA + REEMBOLSO 40%' })
  const c = normalizarCaso(t, opcoesV)
  assert.deepEqual(c.acoes, ['troca', 'reembolso'])
  assert.equal(c.valor, 40)
  const html = paginaRelatorio(dadosDoRelatorio({ tickets: [t], pedidos: pedidosV, lojas: lojasV, filtros: filtrosDoRelatorio({}) }))
  assert.ok(html.includes('Troca + reembolso'))
  assert.ok(html.includes('€ 40,00'))
  assert.ok(html.includes('pedido: € 100,00'))
})
test('relatório antigo se corrige sozinho quando os pedidos chegam da Shopify', () => {
  // o caso já está no relatório, mas a loja ainda não tinha sido sincronizada
  const t = caso({ id: 'rc1', relatorioTexto: 'REEMBOLSO 40%' })
  const antes = normalizarCaso(t, { ...opcoesV, pedidos: [] })
  assert.equal(antes.pedidoLocalizado, false)
  assert.equal(antes.rotuloPedido, 'Sem pedido informado')
  assert.equal(antes.valor, null)
  // chegaram os pedidos: nada é preciso refazer à mão no ticket
  const depois = normalizarCaso(t, opcoesV)
  assert.equal(depois.pedidoNumero, '4001')
  assert.equal(depois.valor, 40)
  assert.equal(depois.clienteNome, 'Maria Silva')
  // e o ticket continua intocado: relatório não escreve no atendimento
  assert.equal(t.relatorioDetalhes, undefined)
  assert.equal(t.atendimentoNovo, undefined)
  assert.equal(t.relatorioTexto, 'REEMBOLSO 40%')
})
/* ====================================================================
   Caso real: "Bestellung #2206", endereço com CEP e data 02.08.2026 —
   e a loja tem MESMO um pedido #2026. A data não pode roubar a
   associação, e o pedido pode estar num e-mail diferente do remetente.
   ==================================================================== */

const CONVERSA_2206 = [
  'Rückgabe Bestellung #2206',
  'Sehr geehrte Damen und Herren, ich benötige eine andere Größe für Bestellung #2206.',
  'Senden Sie mir die Polos der Bestellung #2206 seiner Zeit.',
  'Bestellt am 02.08.2026 / Anschrift des Verbrauchers: Andreas Ossenkop, Am Garten 15, 36208 Wildeck',
  'Gesendet 14:23:04',
].join('\n')
const pedidosOssen = [
  { id: 'o2206', numero: '#2206', cliente: 'Ossenkop Ossenkop', email: '8gauntlet8@gmail.com', valor: 114, lojaId: 'l1', criadoEm: '2026-08-02', itens: [itemV('Premium-Poloshirt Capri', { variante: 'Bleu Nuit / 2XL', quantidade: 2 })] },
  { id: 'o2026', numero: '#2026', cliente: 'Outro Cliente', email: 'outro@web.de', valor: 50, lojaId: 'l1', criadoEm: '2026-07-01', itens: [itemV('Hemd Classic')] },
  { id: 'o36208', numero: '#36208', cliente: 'Terceiro', email: 'terceiro@web.de', valor: 30, lojaId: 'l1', criadoEm: '2026-07-02', itens: [itemV('Chino Slim')] },
]
const ossen = (extra = {}) => ({
  id: 'ossen', nome: 'Andreas Ossenkop', de: 'Andreas Ossenkop <8gauntlet8@googlemail.com>',
  assunto: 'Rückgabe Bestellung #2206', corpo: CONVERSA_2206, historico: [], lojaId: 'l1', relatorioDia: '2026-09-18', ...extra,
})

test('data, hora e CEP não viram número de pedido — nem quando existe um pedido com esse número', () => {
  const citados = [...numerosCitados(CONVERSA_2206)]
  assert.ok(citados.includes('2206'))
  assert.ok(!citados.includes('2026'), 'a data 02.08.2026 não é o pedido 2026')
  assert.ok(!citados.includes('1423'), 'a hora não vira pedido')
  // o CEP ainda é um número solto, mas perde para o número escrito com "Bestellung"
  assert.deepEqual(numerosDePedidoNoTexto(CONVERSA_2206), ['2206'])
})

test('"Bestellung #2206" localiza o pedido mesmo com o cliente escrevendo de outro e-mail', () => {
  const c = normalizarCaso(ossen(), { pedidos: pedidosOssen, lojas: lojasV, produtos: [] })
  assert.equal(c.pedidoTitulo, 'Pedido #2206')
  assert.equal(c.pedidoId, 'o2206')
  assert.equal(c.origemPedido, 'conversa')
  assert.equal(c.clienteNome, 'Ossenkop Ossenkop')
  assert.equal(c.clienteEmail, '8gauntlet8@gmail.com')
  assert.equal(c.emailRemetente, '8gauntlet8@googlemail.com')
  assert.equal(c.emailDiferenteDoPedido, true, 'o popup avisa que o pedido está em outro e-mail')
  assert.equal(c.valorPedido, 114)
  assert.equal(c.produtos[0].titulo, 'Premium-Poloshirt Capri')
  assert.equal(c.produtos[0].quantidade, 2)
  // e o valor do reembolso sai do total realmente pago
  const comPct = normalizarCaso(ossen({ relatorioTexto: 'REEMBOLSO 60%' }), { pedidos: pedidosOssen, lojas: lojasV, produtos: [] })
  assert.equal(comPct.percentual, 60)
  assert.equal(comPct.valor, 68.4)
  assert.equal(dinheiro(comPct.valor, comPct.moeda), '€ 68,40')
})

test('a página externa mostra o pedido e o aviso de e-mail diferente no detalhe', async () => {
  const { paginaRelatorio } = await import('../server/relatorio-externo.js')
  const t = ossen({ relatorioTexto: 'REEMBOLSO 60%' })
  const html = paginaRelatorio(dadosDoRelatorio({ tickets: [t], pedidos: pedidosOssen, lojas: lojasV, filtros: filtrosDoRelatorio({}) }))
  assert.ok(html.includes('Pedido #2206'))
  assert.ok(html.includes('€ 68,40'))
  assert.ok(html.includes('pedido: € 114,00'))
  assert.ok(html.includes('pedido em outro e-mail'))
  assert.ok(!html.includes('Sem pedido informado'))
})
