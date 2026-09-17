// Servidor de ensaio para os testes visuais (Playwright): estado DETERMINÍSTICO
// gravado num DATA_DIR temporário, sem IA, sem e-mail, sem envio automático.
// Casos reais do motor novo em todas as jornadas (fases enviadas em
// historicoEtapas), duas lojas em moedas diferentes (EUR e GBP) e um token
// fixo do link externo. Nada aqui toca o workspace real.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-visual-'))
process.env.DATA_DIR = DIR
process.env.PORT = process.env.PORT_VISUAL || '8798'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
process.env.ATENDO_SIMULAR = '1'
delete process.env.DATABASE_URL
delete process.env.ATENDO_LIBERAR_AUTOENVIO
delete process.env.ATENDO_SMTP_FAKE

export const TOKEN = '0123456789abcdef'.repeat(4)
export const TOKEN_RELATORIO = 'fedcba9876543210'.repeat(2)
export const WS = 'visual'
export const LINK = `/p/${WS}/${TOKEN}`

const { novoEstado } = await import('../../server/db.js')
const estado = novoEstado()
estado.tokenPipeline = TOKEN
estado.tokenRelatorio = TOKEN_RELATORIO
estado.linkMostraHoje = true
estado.config.automacaoAtiva = false
const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
estado.lojas = [
  { id: 'loja1', nome: 'Von Alder', ativa: true, moeda: 'EUR', idioma: 'de', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 } },
  { id: 'loja2', nome: 'Northway UK', ativa: true, moeda: 'GBP', idioma: 'en', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 } },
]
const PRODUTOS = [['Polo Premium', 'Schwarz / L'], ['Hemd Classic', 'Weiß / M'], ['Chino Slim', 'Beige / 32'], ['Jacke Urban', 'Navy / XL']]
// imagens em data: — o teste visual não pode depender da internet
const PNG = (cor) => 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="' + cor + '"/></svg>').toString('base64')
estado.produtos = [
  { id: 'prod-polo', lojaId: 'loja1', titulo: 'Polo Premium', imagem: PNG('#3b5c7a'), imagemPorVariante: { 'var-polo-l': PNG('#7a3b5c') }, variantes: ['Schwarz / L'], ativo: true },
  { id: 'prod-hemd', lojaId: 'loja1', titulo: 'Hemd Classic', imagem: PNG('#5c7a3b'), imagemPorVariante: {}, variantes: ['Weiß / M'], ativo: true },
  { id: 'prod-chino', lojaId: 'loja1', titulo: 'Chino Slim', imagem: null, imagemPorVariante: {}, variantes: [], ativo: true }, // SEM foto: ícone neutro
  { id: 'prod-shirt', lojaId: 'loja2', titulo: 'Jacke Urban', imagem: PNG('#7a5c3b'), imagemPorVariante: {}, variantes: [], ativo: true },
]
const pedido = (n, lojaId, valor, extra = {}) => ({
  id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: lojaId === 'loja2' ? 'United Kingdom' : 'Germany', valor,
  status: 'entregue', criadoEm: `2026-08-${String(1 + (n % 27)).padStart(2, '0')}`, despachadoEm: `2026-08-${String(3 + (n % 25)).padStart(2, '0')}`, lojaId,
  itens: [{ titulo: PRODUTOS[n % 4][0], variante: PRODUTOS[n % 4][1], quantidade: 1, preco: valor, produtoId: ['prod-polo', 'prod-hemd', 'prod-chino', 'prod-shirt'][n % 4], varianteId: n % 4 === 0 ? 'var-polo-l' : null }], ...extra,
})
// 24 pedidos: 16 na loja EUR, 8 na loja GBP; parte deles sem ticket
estado.pedidos = []
for (let n = 1001; n <= 1016; n++) estado.pedidos.push(pedido(n, 'loja1', 60 + (n % 7) * 15))
for (let n = 2001; n <= 2008; n++) estado.pedidos.push(pedido(n, 'loja2', 45 + (n % 5) * 12))

const FLUXO = { tamanho: 'tamanho', qualidade: 'qualidade', defeito: 'defeito', errado: 'errado', nr_entregue: 'entregue_nao_recebido', nr_nao_chegou: 'nao_recebido_reembolso', nr_status: 'nao_recebido_status', cancelamento: 'cancelamento' }
const SUB = { nr_entregue: 'entregue', nr_nao_chegou: 'nao_chegou', nr_status: 'status' }
const CAT = { tamanho: 'troca', qualidade: 'reembolso', defeito: 'produto', errado: 'produto', nr_entregue: 'entrega', nr_nao_chegou: 'entrega', nr_status: 'rastreio', cancelamento: 'reembolso' }
let k = 0
const caso = (n, lojaId, seg, trilha, { motivo = 'qualidade', humano = false, percentual = null } = {}) => {
  k++
  const base = Date.parse('2026-09-01T09:00:00Z') + k * 3600_000
  const historicoEtapas = trilha.map((para, i) => ({ de: i ? trilha[i - 1] : null, para, mensagem: 'mensagem do cliente', em: new Date(base + i * 26 * 3600_000).toISOString() }))
  const idioma = lojaId === 'loja2' ? 'en' : 'de'
  return {
    id: 'v' + n, nome: 'Cliente ' + n, de: `c${n}@web.de`, assunto: `Bestellung #${n}`, corpo: 'Nachricht.', data: new Date(base).toISOString(), lido: true, origem: 'cliente',
    categoria: CAT[seg], status: humano ? 'humano' : 'enviado', idioma, lojaId, historico: [], motor: 'novo',
    resposta: 'Antwort der Loja.', respondidoEm: new Date(base + trilha.length * 26 * 3600_000).toISOString(),
    ...(humano ? { motivoEscalada: 'Cliente recusou todas as alternativas — reembolso de 100% é decisão sua' } : {}),
    atendimentoNovo: {
      versao: 1, fluxo: FLUXO[seg], subfluxo: SUB[seg] ?? null, etapa: trilha[trilha.length - 1] ?? null, produtosAfetados: [PRODUTOS[n % 4][0]], produtosInformados: true, motivo,
      historicoEtapas, transicaoPendente: null, aguardando: humano ? 'humano' : 'cliente', acaoAceita: humano ? 'reemb_100' : null, idioma,
      ...(percentual != null ? { percentualAceito: percentual } : {}),
    },
  }
}
estado.tickets = [
  // Tamanho: em aberto na troca, no 20%, no 40% e um que chegou ao dono (100%)
  caso(1001, 'loja1', 'tamanho', ['tam_ajuste', 'tam_troca'], { motivo: 'tamanho_pequeno' }),
  caso(1002, 'loja1', 'tamanho', ['tam_ajuste', 'tam_troca', 'troca_20'], { motivo: 'tamanho_grande' }),
  caso(1003, 'loja1', 'tamanho', ['tam_ajuste', 'tam_troca', 'troca_20', 'reemb_40'], { motivo: 'tamanho_pequeno' }),
  caso(1004, 'loja1', 'tamanho', ['tam_ajuste', 'tam_troca', 'troca_20', 'reemb_40', 'reemb_50', 'reemb_60', 'reemb_70'], { motivo: 'tamanho_pequeno', humano: true }),
  // Qualidade
  caso(1005, 'loja1', 'qualidade', ['qual_troca']),
  caso(1006, 'loja1', 'qualidade', ['qual_troca', 'qual_cupom_35', 'reemb_25']),
  caso(1007, 'loja1', 'qualidade', ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40'], { motivo: 'nao_gostou' }),
  // Defeito e produto errado
  caso(1008, 'loja1', 'defeito', ['def_foto', 'def_troca'], { motivo: 'defeito' }),
  caso(1009, 'loja1', 'defeito', ['def_foto', 'def_troca', 'troca_20', 'reemb_40'], { motivo: 'defeito' }),
  caso(1010, 'loja1', 'errado', ['err_envio', 'qual_cupom_35'], { motivo: 'errado' }),
  // Não recebeu: marcado como entregue (aguardar → 20% → 35%), não chegou, só status
  caso(1011, 'loja1', 'nr_entregue', ['nr_entregue_aguardar', 'nr_entregue_aguardar', 'nr_reenvio_20'], { motivo: 'nao_recebido' }),
  caso(1012, 'loja1', 'nr_entregue', ['nr_entregue_aguardar', 'nr_reenvio_20', 'nr_reenvio_35'], { motivo: 'nao_recebido' }),
  caso(1013, 'loja1', 'nr_nao_chegou', ['nr_reenvio_30'], { motivo: 'nao_recebido' }),
  caso(1014, 'loja1', 'nr_status', ['nc_atrasado_25', 'nc_cupom_40'], { motivo: 'atraso' }),
  // Cancelamento
  caso(1015, 'loja1', 'cancelamento', [], { motivo: 'cancelamento', humano: true }),
  // Loja em libras
  caso(2001, 'loja2', 'tamanho', ['tam_ajuste', 'tam_troca', 'troca_20'], { motivo: 'tamanho_grande' }),
  caso(2002, 'loja2', 'qualidade', ['qual_troca', 'qual_cupom_35'], { motivo: 'nao_gostou' }),
  caso(2003, 'loja2', 'nr_entregue', ['nr_entregue_aguardar'], { motivo: 'nao_recebido' }),
]
/* ---------- casos do RELATÓRIO DIÁRIO (todos os tipos, duas moedas, com e sem foto) ----------
   Pedidos próprios (3001+ e 4001): o relatório não pode encostar nos casos do
   pipeline — cliente repetido lá vira "2 conversas" e muda o mapa. */
const ONTEM = '2026-09-15', HOJE_REL = '2026-09-16'
const itemRel = (titulo, variante, produtoId, varianteId, preco) => ({ titulo, variante, quantidade: 1, preco, produtoId, varianteId })
estado.pedidos.push(
  { ...pedido(3001, 'loja1', 100), email: 'c3001@web.de', cliente: 'Cliente 3001', itens: [itemRel('Polo Premium', 'Schwarz / L', 'prod-polo', 'var-polo-l', 100)] },
  { ...pedido(3002, 'loja1', 90), email: 'c3002@web.de', cliente: 'Cliente 3002', itens: [itemRel('Hemd Classic', 'Weiß / M', 'prod-hemd', null, 90)] },
  { ...pedido(3003, 'loja1', 100), email: 'c3003@web.de', cliente: 'Cliente 3003', itens: [itemRel('Polo Premium', 'Schwarz / L', 'prod-polo', null, 100)] },
  { ...pedido(3004, 'loja1', 90), email: 'c3004@web.de', cliente: 'Cliente 3004', itens: [itemRel('Chino Slim', 'Beige / 32', 'prod-chino', null, 90)] },
  { ...pedido(3005, 'loja1', 70), email: 'c3005@web.de', cliente: 'Cliente 3005', itens: [itemRel('Hemd Classic', 'Weiß / M', 'prod-hemd', null, 70)] },
  { ...pedido(3006, 'loja1', 80), email: 'c3006@web.de', cliente: 'Cliente 3006', itens: [itemRel('Polo Premium', 'Schwarz / L', 'prod-polo', null, 80)] },
  { ...pedido(3007, 'loja1', 120), email: 'c3007@web.de', cliente: 'Cliente 3007', itens: [itemRel('Hemd Classic', 'Weiß / M', 'prod-hemd', null, 120)] },
  { ...pedido(3008, 'loja1', 50), email: 'c3008@web.de', cliente: 'Cliente 3008', itens: [itemRel('Polo Premium', 'Schwarz / L', 'prod-polo', null, 50)] },
  { ...pedido(4001, 'loja2', 57), email: 'c4001@web.de', cliente: 'Cliente 4001', itens: [itemRel('Jacke Urban', 'Navy / XL', 'prod-shirt', null, 57)] },
)
const doRelatorio = (n, lojaId, dia, extra = {}) => ({
  id: 'r' + n, nome: 'Cliente ' + n, de: `c${n}@web.de`, assunto: 'Bestellung #' + n, corpo: 'Mensagem do cliente sobre o pedido ' + n,
  data: '2026-09-15T10:00:00.000Z', lido: true, origem: 'cliente', categoria: 'reembolso', status: 'enviado', idioma: 'de', lojaId,
  historico: [], motor: 'classico', motorAtendimento: 'classico', primeiroEmailEm: '2026-09-15T10:00:00.000Z',
  relatorioDia: dia, ...extra,
})
estado.tickets.push(
  // 1) reembolso AUTOMÁTICO do motor novo (percentual, valor e moeda exatos) — pendente, com foto da variante
  doRelatorio(3001, 'loja1', HOJE_REL, {
    motor: 'novo', motorAtendimento: 'novo', categoria: 'reembolso',
    relatorioTexto: 'Reembolso de 40% sem devolução — 40% = 40,00 EUR — motor novo, conclusão automática',
    relatorioAuto: { eventoId: 'ev-r3001', ticketId: 'r3001', pedido: '#3001', lojaId: 'loja1', loja: 'Von Alder', cliente: 'Cliente 3001', jornada: 'qualidade', faseAceita: 'reemb_40', solucao: 'Reembolso de 40% sem devolução', produtos: ['Polo Premium'], percentual: 40, valor: 40, moeda: 'EUR', cupom: null, trocaOuReenvio: null, enderecoConfirmado: null, aceitaEm: '2026-09-15T12:00:00.000Z', confirmacaoEnviadaEm: '2026-09-15T17:00:00.000Z', origem: 'motor novo — conclusão automática', mensagemConfirmacaoId: 'atendo-ev-r3001' },
  }),
  // 2) reembolso MANUAL estruturado, já PROCESSADO
  doRelatorio(3002, 'loja1', HOJE_REL, {
    relatorioTexto: 'REEMBOLSO 25%', relatorioProcessado: '2026-09-16T09:30:00.000Z',
    relatorioDetalhes: { versao: 1, tipo: 'reembolso', percentual: 25, valor: 22.5, moeda: 'EUR', valorPedido: 90, pedidoId: 'p3002', pedidoNumero: '3002', clienteNome: 'Cliente 3002', clienteEmail: 'c3002@web.de', produtos: [{ produtoId: 'prod-hemd', varianteId: null, titulo: 'Hemd Classic', variante: 'Weiß / M', quantidade: 1, imagem: null }], origem: 'manual', observacao: 'combinado por telefone', criadoEm: '2026-09-16T08:00:00.000Z', atualizadoEm: '2026-09-16T08:00:00.000Z' },
  }),
  // 3) relatório ANTIGO só textual, com percentual explícito
  doRelatorio(3003, 'loja1', HOJE_REL, { relatorioTexto: 'REEMBOLSO 60%' }),
  // 4) valor DESCONHECIDO: sem pedido localizado (e-mail que não existe) — "Valor não registrado"
  doRelatorio(9999, 'loja1', HOJE_REL, { de: 'desconhecido@web.de', relatorioTexto: 'REEMBOLSO' }),
  // 5) TROCA com reembolso parcial (duas etiquetas), produto sem foto no catálogo
  doRelatorio(3004, 'loja1', HOJE_REL, {
    motor: 'novo', motorAtendimento: 'novo', categoria: 'troca',
    relatorioTexto: 'Troca gratuita + reembolso de 20%',
    relatorioAuto: { eventoId: 'ev-r3004', ticketId: 'r3004', pedido: '#3004', lojaId: 'loja1', loja: 'Von Alder', jornada: 'tamanho', faseAceita: 'troca_20', solucao: 'Troca gratuita + reembolso de 20%', produtos: [], percentual: 20, valor: 18, moeda: 'EUR', cupom: null, trocaOuReenvio: 'troca', aceitaEm: '2026-09-15T12:00:00.000Z', confirmacaoEnviadaEm: '2026-09-15T18:00:00.000Z', origem: 'motor novo — conclusão automática', mensagemConfirmacaoId: 'atendo-ev-r3004' },
  }),
  // 6) REENVIO puro, pendente
  doRelatorio(3005, 'loja1', ONTEM, { categoria: 'entrega', relatorioTexto: 'REENVIO expresso do pedido' }),
  // 7) CUPOM (não é reembolso, não entra no total)
  doRelatorio(3006, 'loja1', ONTEM, { relatorioTexto: 'CUPOM 35% para a próxima compra' }),
  // 8) CANCELAMENTO integral, processado
  doRelatorio(3007, 'loja1', ONTEM, { relatorioTexto: 'CANCELAMENTO INTEGRAL do pedido', relatorioProcessado: '2026-09-16T10:00:00.000Z' }),
  // 9) outra MOEDA (GBP): nunca soma com o euro
  doRelatorio(4001, 'loja2', HOJE_REL, {
    motor: 'novo', motorAtendimento: 'novo',
    relatorioTexto: 'Reembolso de 50% sem devolução',
    relatorioAuto: { eventoId: 'ev-r4001', ticketId: 'r4001', pedido: '#4001', lojaId: 'loja2', loja: 'Northway UK', jornada: 'qualidade', faseAceita: 'reemb_50', solucao: 'Reembolso de 50% sem devolução', produtos: [], percentual: 50, valor: 28.5, moeda: 'GBP', cupom: null, trocaOuReenvio: null, aceitaEm: '2026-09-15T12:00:00.000Z', confirmacaoEnviadaEm: '2026-09-15T19:00:00.000Z', origem: 'motor novo — conclusão automática', mensagemConfirmacaoId: 'atendo-ev-r4001' },
  }),
  // 10) texto MALICIOSO: tem de sair totalmente escapado
  doRelatorio(3008, 'loja1', ONTEM, { nome: '<script>window.__invadido=1</script>', relatorioTexto: '<img src=x onerror="window.__invadido=1">REEMBOLSO 10%' }),
)

/* ---------- relatórios ANTIGOS: o número do pedido está escrito na linha/no texto ----------
   Reproduz a produção: um pedido, dois pedidos e um número citado que não existe
   na Shopify. Nenhum deles tem relatorioDetalhes — a associação é só de leitura. */
estado.pedidos.push(
  { ...pedido(3009, 'loja1', 120), email: 'c3009@web.de', cliente: 'Cliente 3009', itens: [itemRel('Polo Premium', 'Schwarz / 2XL', 'prod-polo', 'var-polo-l', 120)] },
  { ...pedido(3010, 'loja1', 80), email: 'c3010@web.de', cliente: 'Cliente 3010', itens: [itemRel('Polo Premium', 'Schwarz / 2XL', 'prod-polo', null, 80)] },
  { ...pedido(3011, 'loja1', 60), email: 'c3011@web.de', cliente: 'Cliente 3011', itens: [itemRel('Hemd Classic', 'Weiß / 2XL', 'prod-hemd', null, 60)] },
)
estado.tickets.push(
  // 11) um pedido, achado pela LINHA final editada pelo dono
  doRelatorio(3009, 'loja1', ONTEM, { categoria: 'troca', relatorioTexto: 'TROCA DE TAMANHO', relatorioLinha: 'PEDIDO 3009 - TROCAR AS 2XL POR 4XL' }),
  // 12) DOIS pedidos no mesmo caso: os dois números e os produtos dos dois
  doRelatorio(3010, 'loja1', ONTEM, { categoria: 'troca', relatorioTexto: 'PEDIDO 3010 E 3011 - TROCAR POR 4XL' }),
  // 13) número escrito, mas o pedido não está sincronizado na Shopify
  doRelatorio(3012, 'loja1', ONTEM, { categoria: 'troca', relatorioTexto: 'PEDIDO 8888 - TROCAR AS 2XL POR 4XL' }),
)

// o caso 1015 (cancelamento) está com o dono: fase pendente de decisão
estado.tickets[14].atendimentoNovo.acaoAceita = 'cancel_nao_processado'
estado.tickets[14].motivoEscalada = 'Cancelamento de pedido não processado — decisão sua'
writeFileSync(path.join(DIR, `ws-${WS}.json`), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({ segredo: 'segredo-visual-'.padEnd(64, 'x'), usuarios: [], sessoes: [] }))

const servidor = await import('../../server/index.js')
console.log(`[visual] servidor de ensaio em http://localhost:${process.env.PORT}${LINK}`)

// Encerramento DETERMINÍSTICO: o globalTeardown do Playwright chama POST /encerrar na
// porta de controle; o servidor fecha o HTTP (8798) e sai com código 0. Rede de
// segurança: vida máxima de 20 minutos e sinais do sistema — nunca fica escutando.
const CONTROLE = Number(process.env.PORT_VISUAL_CONTROLE || 8796)
async function sair() { try { await servidor.encerrar() } catch {} process.exit(0) }
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/encerrar') { res.end('encerrando'); setTimeout(sair, 20) } else { res.statusCode = 404; res.end() }
}).listen(CONTROLE, '127.0.0.1')
setTimeout(sair, 20 * 60_000).unref()
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, sair)
process.stdin.on('end', sair); process.stdin.on('close', sair); try { process.stdin.resume() } catch {}
