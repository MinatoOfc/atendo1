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
export const WS = 'visual'
export const LINK = `/p/${WS}/${TOKEN}`

const { novoEstado } = await import('../../server/db.js')
const estado = novoEstado()
estado.tokenPipeline = TOKEN
estado.config.automacaoAtiva = false
const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
estado.lojas = [
  { id: 'loja1', nome: 'Von Alder', ativa: true, moeda: 'EUR', idioma: 'de', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 } },
  { id: 'loja2', nome: 'Northway UK', ativa: true, moeda: 'GBP', idioma: 'en', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 } },
]
const PRODUTOS = [['Polo Premium', 'Schwarz / L'], ['Hemd Classic', 'Weiß / M'], ['Chino Slim', 'Beige / 32'], ['Jacke Urban', 'Navy / XL']]
const pedido = (n, lojaId, valor, extra = {}) => ({
  id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: lojaId === 'loja2' ? 'United Kingdom' : 'Germany', valor,
  status: 'entregue', criadoEm: `2026-08-${String(1 + (n % 27)).padStart(2, '0')}`, despachadoEm: `2026-08-${String(3 + (n % 25)).padStart(2, '0')}`, lojaId,
  itens: [{ titulo: PRODUTOS[n % 4][0], variante: PRODUTOS[n % 4][1], quantidade: 1, preco: valor }], ...extra,
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
