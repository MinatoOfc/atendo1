// Regras do relatório que só o SERVIDOR pode provar: os campos estruturados são
// montados e conferidos lá (o navegador nunca dita o valor), o motor novo trava a
// ação e o percentual da solução aceita, a linha editada à mão continua sendo a
// descrição final sem mexer nos números, e os relatórios antigos seguem valendo.
// Nenhuma loja é ativada e nada é enviado: canal e IA simulados, banco temporário.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-relatorio-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8794'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
process.env.ATENDO_SIMULAR = '1'
delete process.env.DATABASE_URL
delete process.env.ATENDO_SMTP_FAKE
delete process.env.ATENDO_LIBERAR_AUTOENVIO

const { hashSenha } = await import('../server/auth.js')
const { novoEstado } = await import('../server/db.js')

const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
const estado = novoEstado()
estado.config.automacaoAtiva = false
estado.tokenRelatorio = 'abcdef0123456789'.repeat(2)
estado.linkMostraHoje = true
estado.lojas = [
  { id: 'loja1', nome: 'Loja Nova', ativa: true, moeda: 'EUR', idioma: 'de', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', prazoEntrega: { min: 5, max: 12, processamento: 3 } },
  { id: 'loja2', nome: 'Loja Clássica', ativa: true, moeda: 'GBP', idioma: 'auto' },
]
estado.produtos = [{ id: 'prodA', lojaId: 'loja1', imagem: IMG, imagemPorVariante: { varA: IMG } }]
estado.pedidos = [
  { id: 'p1', numero: '#1001', cliente: 'Ana Souza', email: 'ana@web.de', pais: 'Germany', valor: 100, status: 'entregue', criadoEm: '2026-09-01', lojaId: 'loja1', itens: [{ titulo: 'Polo Premium', variante: 'Preto / L', quantidade: 1, preco: 100, produtoId: 'prodA', varianteId: 'varA' }] },
  { id: 'p2', numero: '#2001', cliente: 'Carla UK', email: 'carla@uk.co', pais: 'UK', valor: 40, status: 'entregue', criadoEm: '2026-09-02', lojaId: 'loja2', itens: [{ titulo: 'Shirt', variante: null, quantidade: 1, preco: 40 }] },
  { id: 'p3', numero: '#1002', cliente: 'Ana Souza', email: 'ana@web.de', pais: 'Germany', valor: 50, status: 'entregue', criadoEm: '2026-09-03', lojaId: 'loja1', itens: [{ titulo: 'Hemd Classic', variante: 'Weiß / M', quantidade: 1, preco: 50 }] },
]
const base_ticket = (id, extra) => ({
  id, nome: 'Cliente', de: 'ana@web.de', assunto: 'Bestellung #1001', corpo: 'Hallo', data: '2026-09-10T10:00:00.000Z',
  lido: true, origem: 'cliente', categoria: 'reembolso', status: 'enviado', idioma: 'de', lojaId: 'loja1', historico: [], ...extra,
})
estado.tickets = [
  // clássico: o dono decide tudo no popup
  base_ticket('t-classico', { lojaId: 'loja2', de: 'carla@uk.co', assunto: 'Order #2001' }),
  // motor novo com conclusão automática já gravada: ação e percentual travados
  base_ticket('t-auto', {
    relatorioDia: '2026-09-10', relatorioTexto: 'REEMBOLSO 40%',
    relatorioAuto: { eventoId: 'e1', solucao: 'Reembolso de 40% sem devolução', percentual: 40, valor: 40, moeda: 'EUR', cupom: null, confirmacaoEnviadaEm: '2026-09-10T12:00:00.000Z', origem: 'motor_novo', pedido: '#1001', faseAceita: 'reemb_40' },
  }),
  // relatório antigo, só texto: nada de estruturado, e continua aparecendo
  base_ticket('t-antigo', { relatorioDia: '2026-09-09', relatorioTexto: 'REEMBOLSO 60%', relatorioProcessado: '2026-09-09T20:00:00.000Z' }),
  // relatório antigo com o número escrito na linha, mas sem esse pedido na Shopify
  base_ticket('t-vincular', { de: 'ninguem@web.de', assunto: 'Umtausch', corpo: 'Sem numero aqui.', relatorioDia: '2026-09-09', relatorioTexto: 'PEDIDO 7777 - TROCAR AS 2XL POR 4XL' }),
  // ana@web.de tem DOIS pedidos na loja1 (p1 e p3): nada pode ser escolhido sozinho
  base_ticket('t-ambiguo', { assunto: 'Frage', corpo: 'Sem numero.', relatorioDia: '2026-09-09', relatorioTexto: 'CANCELAMENTO' }),
]
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

const url = 'http://localhost:8794'
let cookie = ''
const api = (rota, corpo, metodo = 'POST') => fetch(url + rota, {
  method: metodo, headers: { 'Content-Type': 'application/json', cookie },
  body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
}).then(async r => ({ status: r.status, ...(await r.json()) }))
const ticket = async id => (await api('/api/state', null, 'GET')).state.tickets.find(t => t.id === id)

before(async () => {
  await import('../server/index.js')
  await new Promise(r => setTimeout(r, 1500))
  const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@teste.local', senha: 'senha-teste-1234' }) })
  assert.equal(login.status, 200, 'login de teste')
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
})
after(async () => {
  const servidor = await import('../server/index.js')
  await servidor.encerrar()
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

/* =================================================================== */

test('o popup recebe pedido, cliente e produtos prontos do servidor — e o motor novo vem travado', async () => {
  const classico = await api('/api/tickets/t-classico/relatorio/preparar', null, 'GET')
  assert.equal(classico.travado, false, 'clássico: o dono pode corrigir')
  assert.equal(classico.pedido.numero, '2001')
  assert.equal(classico.cliente.nome, 'Carla UK')
  assert.equal(classico.cliente.email, 'carla@uk.co')
  assert.equal(classico.produtosDoPedido.length, 1)
  assert.equal(classico.produtosDoPedido[0].titulo, 'Shirt')

  const novo = await api('/api/tickets/t-auto/relatorio/preparar', null, 'GET')
  assert.equal(novo.travado, true, 'motor novo: a solução aceita manda')
  assert.equal(novo.sugestao.tipo, 'reembolso')
  assert.equal(novo.sugestao.percentual, 40)
  assert.equal(novo.sugestao.valor, 40)
  assert.equal(novo.sugestao.moeda, 'EUR')
  // a miniatura sai do catálogo da loja, pela variante do item
  assert.equal(novo.produtosDoPedido[0].imagem, IMG)
})

test('o valor NUNCA vem do navegador: o servidor recalcula com o percentual e o total do pedido', async () => {
  // o navegador tenta gravar 999 com 25% num pedido de 40 (loja2)
  const r = await api('/api/tickets/t-classico/relatorio', {
    adicionar: true, texto: 'REEMBOLSO 25%',
    detalhes: { tipo: 'reembolso', percentual: 25, valor: 999, moeda: 'BRL', valorPedido: 999, clienteNome: 'Invasor', produtos: [{ titulo: 'Shirt' }] },
  })
  assert.equal(r.status, 200)
  const t = await ticket('t-classico')
  const d = t.relatorioDetalhes
  assert.equal(d.versao, 1)
  assert.equal(d.percentual, 25)
  assert.equal(d.valor, 10, '25% de 40 = 10 — o 999 do navegador é ignorado')
  assert.equal(d.moeda, 'GBP', 'a moeda é a da loja, não a que o navegador mandou')
  assert.equal(d.valorPedido, 40)
  assert.equal(d.clienteNome, 'Carla UK', 'o cliente vem do pedido, não do navegador')
  assert.equal(d.pedidoNumero, '2001')
  assert.equal(d.origem, 'manual')
  assert.equal(d.produtos[0].titulo, 'Shirt')
  assert.ok(d.criadoEm && d.atualizadoEm)
})

test('no motor novo o dono não consegue trocar a ação nem o percentual da solução aceita', async () => {
  const r = await api('/api/tickets/t-auto/relatorio', {
    adicionar: true, texto: 'REEMBOLSO 40%',
    detalhes: { tipo: 'cupom', percentual: 100, valor: 100, observacao: 'tentativa de troca' },
  })
  assert.equal(r.status, 200)
  const d = (await ticket('t-auto')).relatorioDetalhes
  assert.equal(d.tipo, 'reembolso', 'a ação continua sendo a aceita')
  assert.equal(d.percentual, 40, 'o percentual continua sendo o aceito')
  assert.equal(d.valor, 40, 'o valor é o exato da conclusão automática')
  assert.equal(d.origem, 'motor_novo_automatico')
  assert.equal(d.observacao, 'tentativa de troca', 'a observação é livre — ela não muda número nenhum')
})

test('percentual fora de 1–100 não entra e o valor não é inventado', async () => {
  await api('/api/tickets/t-classico/relatorio', { adicionar: true, texto: 'AJUSTE', detalhes: { tipo: 'outro', percentual: 0 } })
  let d = (await ticket('t-classico')).relatorioDetalhes
  assert.equal(d.percentual, null)
  assert.equal(d.valor, null, 'sem percentual provado o valor fica em branco, nunca zero')
  await api('/api/tickets/t-classico/relatorio', { adicionar: true, texto: 'AJUSTE', detalhes: { tipo: 'reembolso', percentual: 250 } })
  d = (await ticket('t-classico')).relatorioDetalhes
  assert.equal(d.percentual, null)
})

test('a linha editada à mão é a descrição final e não mexe nos campos estruturados', async () => {
  await api('/api/tickets/t-classico/relatorio', { adicionar: true, texto: 'REEMBOLSO 25%', detalhes: { tipo: 'reembolso', percentual: 25 } })
  const antes = (await ticket('t-classico')).relatorioDetalhes
  await api('/api/tickets/t-classico/relatorio-linha', { linha: 'PEDIDO 2001 - texto do dono, 90%' })
  const t = await ticket('t-classico')
  assert.equal(t.relatorioLinha, 'PEDIDO 2001 - texto do dono, 90%')
  assert.deepEqual(t.relatorioDetalhes, antes, 'editar o texto não altera percentual nem valor')
  // e a página externa mostra a linha editada como descrição, com os números originais
  const { normalizarCaso } = await import('../shared/relatorio.js')
  const caso = normalizarCaso(t, { pedidos: estado.pedidos, lojas: estado.lojas, produtos: estado.produtos })
  assert.equal(caso.descricao, 'PEDIDO 2001 - texto do dono, 90%')
  assert.equal(caso.percentual, 25)
  assert.equal(caso.valor, 10)
})

test('relatório antigo (só texto) continua aparecendo, com o processado preservado e sem valores inventados', async () => {
  const t = await ticket('t-antigo')
  assert.equal(t.relatorioDia, '2026-09-09')
  assert.equal(t.relatorioTexto, 'REEMBOLSO 60%')
  assert.equal(t.relatorioProcessado, '2026-09-09T20:00:00.000Z')
  assert.equal(t.relatorioDetalhes, undefined, 'nenhuma migração inventa campos para o caso antigo')
  const { normalizarCaso } = await import('../shared/relatorio.js')
  const caso = normalizarCaso(t, { pedidos: estado.pedidos, lojas: estado.lojas, produtos: estado.produtos })
  assert.equal(caso.percentual, 60, 'o percentual explícito no texto é aproveitado')
  assert.equal(caso.valor, 60, '60% de 100, com o pedido localizado')
  assert.equal(caso.processado, true)
})

test('tirar do relatório limpa também os campos estruturados', async () => {
  await api('/api/tickets/t-classico/relatorio', { adicionar: false })
  const t = await ticket('t-classico')
  assert.equal(t.relatorioDia, undefined)
  assert.equal(t.relatorioTexto, undefined)
  assert.equal(t.relatorioLinha, undefined)
  assert.equal(t.relatorioDetalhes, undefined)
})
test('caso antigo com número citado sem dados: o popup mostra o aviso e a lista de pedidos da loja', async () => {
  const r = await api('/api/tickets/t-vincular/relatorio/preparar', null, 'GET')
  assert.equal(r.status, 200)
  assert.deepEqual(r.pedidoNumeros, ['7777'])
  assert.deepEqual(r.pedidosSemDados, ['7777'])
  assert.equal(r.rotuloPedido, 'Pedido #7777 citado — dados não encontrados na Shopify')
  assert.equal(r.pedido, null)
  // só pedidos DESTA loja podem ser escolhidos
  assert.deepEqual(r.pedidosDaLoja.map(p => p.numero).sort(), ['1001', '1002'])
})

test('vincular pedido à mão: o servidor refaz cliente, produtos, imagem, valor do pedido e moeda', async () => {
  const r = await api('/api/tickets/t-vincular/relatorio/vincular', { pedidoIds: ['p1'] })
  assert.equal(r.status, 200)
  const d = (await ticket('t-vincular')).relatorioDetalhes
  assert.deepEqual(d.pedidoIds, ['p1'])
  assert.deepEqual(d.pedidoNumeros, ['1001'])
  assert.equal(d.pedidoNumero, '1001')
  assert.equal(d.clienteNome, 'Ana Souza', 'o cliente passa a ser o do pedido vinculado')
  assert.equal(d.clienteEmail, 'ana@web.de')
  assert.equal(d.valorPedido, 100)
  assert.equal(d.moeda, 'EUR')
  assert.equal(d.produtos[0].titulo, 'Polo Premium')
  assert.equal(d.produtos[0].imagem, IMG, 'a foto vem do catálogo, pela variante')
  assert.equal(d.valor, null, 'sem percentual escrito, o valor continua não registrado')
  // e a página externa passa a mostrar o pedido localizado
  const { normalizarCaso } = await import('../shared/relatorio.js')
  const caso = normalizarCaso(await ticket('t-vincular'), { pedidos: estado.pedidos, lojas: estado.lojas, produtos: estado.produtos })
  assert.equal(caso.pedidoTitulo, 'Pedido #1001')
  assert.equal(caso.pedidoLocalizado, true)
})

test('vincular NUNCA aceita pedido de outra loja', async () => {
  const r = await api('/api/tickets/t-vincular/relatorio/vincular', { pedidoIds: ['p2'] })
  assert.equal(r.status, 400)
  assert.match(r.erro, /mesma loja/i)
  const d = (await ticket('t-vincular')).relatorioDetalhes
  assert.deepEqual(d.pedidoIds, ['p1'], 'o vínculo anterior continua de pé')
})

test('vincular dois pedidos da mesma loja: os dois números aparecem e nada é somado', async () => {
  const r = await api('/api/tickets/t-vincular/relatorio/vincular', { pedidoIds: ['p1', 'p3'] })
  assert.equal(r.status, 200)
  const t = await ticket('t-vincular')
  assert.deepEqual(t.relatorioDetalhes.pedidoNumeros, ['1001', '1002'])
  assert.equal(t.relatorioDetalhes.valorPedido, null, 'totais de pedidos diferentes nunca se somam')
  assert.equal(t.relatorioDetalhes.valor, null)
  const { normalizarCaso } = await import('../shared/relatorio.js')
  const caso = normalizarCaso(t, { pedidos: estado.pedidos, lojas: estado.lojas, produtos: estado.produtos })
  assert.equal(caso.pedidoTitulo, 'Pedidos #1001 e #1002')
  assert.deepEqual(caso.produtos.map(p => p.titulo), ['Polo Premium', 'Hemd Classic'])
})
test('trocar o vínculo por outro pedido recalcula tudo a partir do novo', async () => {
  const r = await api('/api/tickets/t-vincular/relatorio/vincular', { pedidoIds: ['p3'] })
  assert.equal(r.status, 200)
  const d = (await ticket('t-vincular')).relatorioDetalhes
  assert.deepEqual(d.pedidoIds, ['p3'])
  assert.deepEqual(d.pedidoNumeros, ['1002'])
  assert.equal(d.valorPedido, 50, 'o valor passa a ser o do pedido novo')
  assert.equal(d.produtos[0].titulo, 'Hemd Classic')
})

test('remover o vínculo volta para a associação automática, sem inventar pedido', async () => {
  const r = await api('/api/tickets/t-vincular/relatorio/vincular', { pedidoIds: [] })
  assert.equal(r.status, 200)
  const t = await ticket('t-vincular')
  assert.deepEqual(t.relatorioDetalhes.pedidoIds, [])
  const { normalizarCaso, precisaVinculo } = await import('../shared/relatorio.js')
  const caso = normalizarCaso(t, { pedidos: estado.pedidos, lojas: estado.lojas, produtos: estado.produtos })
  // o texto continua citando o 7777, que não existe na Shopify
  assert.deepEqual(caso.pedidoNumeros, ['7777'])
  assert.equal(caso.pedidoLocalizado, false)
  assert.equal(caso.valorPedido, null)
  assert.equal(precisaVinculo(caso), true, 'o botão "Vincular pedido" volta a aparecer')
})

test('caso SEM número nenhum também oferece vínculo manual, e o e-mail ambíguo não escolhe sozinho', async () => {
  const { normalizarCaso, precisaVinculo, buscaInicialVinculo } = await import('../shared/relatorio.js')
  const t = await ticket('t-ambiguo')
  const caso = normalizarCaso(t, { pedidos: estado.pedidos, lojas: estado.lojas, produtos: estado.produtos })
  // ana@web.de tem DOIS pedidos na loja1: nada é associado automaticamente
  assert.deepEqual(caso.pedidoNumeros, [])
  assert.equal(caso.rotuloPedido, 'Sem pedido informado')
  assert.equal(precisaVinculo(caso), true)
  assert.equal(buscaInicialVinculo(caso), 'ana@web.de', 'o modal já abre procurando pelo e-mail')
  // e o vínculo manual resolve
  assert.equal((await api('/api/tickets/t-ambiguo/relatorio/vincular', { pedidoIds: ['p1'] })).status, 200)
  const d = (await ticket('t-ambiguo')).relatorioDetalhes
  assert.deepEqual(d.pedidoNumeros, ['1001'])
  assert.equal(d.valorPedido, 100)
})

test('o link externo do relatório continua só de leitura: nada de vincular por lá', async () => {
  const html = await (await fetch(`${url}/r/teste/${estado.tokenRelatorio}`)).text()
  // o id do caso de teste contém 'vincular': o que não pode existir é a AÇÃO
  assert.ok(!/vincular pedido/i.test(html), 'a página externa não oferece vínculo de pedido')
  assert.ok(!/corrigir o pedido/i.test(html), 'nem correção de pedido')
  assert.ok(!/<form/i.test(html), 'a página externa não tem formulário')
  // e a rota de vínculo exige sessão (o token do link não serve)
  const semSessao = await fetch(`${url}/api/tickets/t-ambiguo/relatorio/vincular`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoIds: ['p3'] }),
  })
  assert.equal(semSessao.status, 401)
})
