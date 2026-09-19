// Recuperação de envios interrompidos × Auditoria da IA. O canal envia o e-mail e o
// servidor CAI antes da gravação final e antes de registrar email_enviado. No reinício,
// a reconciliação precisa reconstruir a PROVA completa (evento, fase confirmada,
// encerramento, metadados da resposta, vínculo exato e origem real) usando o CONTEXTO
// gravado antes do envio — nunca a configuração de então. Cada servidor roda num
// PROCESSO FILHO de verdade. Nenhuma loja real é ativada e nenhuma mensagem real sai.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-queda-auditoria-'))
const ENVIOS = path.join(DIR, 'envios.log')
const PORTA = 8788
const base = `http://localhost:${PORTA}`

const { hashSenha } = await import('../server/auth.js')
const { novoEstado } = await import('../server/db.js')
const { novoEvento } = await import('../shared/auditoria.js')

const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
const CONF = 'Hallo! Wir haben die Rückerstattung von 40% (40,00 €) veranlasst. Das Geld ist in 3 bis 14 Tagen wieder da.'
const hist = ids => ids.map((para, i) => ({ de: ids[i - 1] ?? null, para, mensagem: 'x', em: new Date(Date.parse('2026-09-01T10:00:00Z') + i * 3600e3).toISOString() }))

const estado = novoEstado()
estado.config.automacaoAtiva = true
estado.config.atrasoMinutos = 0.05
const loja = extra => ({
  ativa: true, moeda: 'EUR', idioma: 'de', modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z',
  cupons: { ...CUPONS }, prazoEntrega: { min: 5, max: 12, processamento: 3 }, ...extra,
})
estado.lojas = [
  // loja1 EXIGE aprovação: o dono aprova e o agendador só envia na cadência.
  // A conferência de cupons fica GRAVADA (e não simulada) para poder vencer no meio do caminho.
  loja({
    id: 'loja1', nome: 'Loja Aprovação', novoEnvioAutomatico: false, exigirAprovacaoAceiteNovo: true,
    verificacaoCupons: {
      permissao: true, erro: null, em: new Date().toISOString(), lojaId: 'loja1',
      itens: Object.entries(CUPONS).map(([pct, codigo]) => ({ pct: Number(pct), codigo, valor: Number(pct), situacao: 'ok', detalhe: 'ok' })),
    },
  }),
  // loja2 é a única com envio realmente automático (só no ensaio)
  loja({ id: 'loja2', nome: 'Loja Automática', novoEnvioAutomatico: true, exigirAprovacaoAceiteNovo: false }),
]
// um cliente e um pedido POR cenário: conversas distintas nunca se fundem
const CENARIOS = {
  qa1: 'loja1', qa2: 'loja2', qa3: 'loja1', qa4: 'loja1', qa5: 'loja1', qa6: 'loja2',
  qa7: 'loja1', qa8: 'loja1', qa9: 'loja1', qa10: 'loja1', qa11: 'loja1', qa12: 'loja1',
  qa13: 'loja2', qa14: 'loja2',
}
estado.pedidos = Object.entries(CENARIOS).map(([id, lojaId], i) => ({
  id: 'p-' + id, numero: '#' + (101 + i), cliente: 'Cliente ' + id, email: `${id}@web.de`, pais: 'Germany', valor: 100,
  status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId,
  itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }],
}))
const pedidoDe = id => estado.pedidos.find(p => p.id === 'p-' + id)
writeFileSync(path.join(DIR, 'ws-qa.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-queda-auditoria-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'qa@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-qa-12345'), workspaceId: 'qa' }],
  sessoes: [],
}))

const ambiente = extra => ({
  ...process.env, DATA_DIR: DIR, PORT: String(PORTA), ANTHROPIC_API_KEY: 'sk-ant-teste',
  ATENDO_SIMULAR: '1', ATENDO_SMTP_FAKE: 'ok', ATENDO_TESTE_ENVIOS: ENVIOS,
  NODE_ENV: 'test', DATABASE_URL: '', ATENDO_LIBERAR_AUTOENVIO: '1',
  EMAIL_USER: 'loja1@teste.local', EMAIL_PASS: 'senha-falsa', EMAIL_IMAP_HOST: 'imap.invalido.test', EMAIL_SMTP_HOST: 'smtp.invalido.test',
  EMAIL2_USER: 'loja2@teste.local', EMAIL2_PASS: 'senha-falsa', EMAIL2_IMAP_HOST: 'imap.invalido.test', EMAIL2_SMTP_HOST: 'smtp.invalido.test',
  ...extra,
})
const arquivo = path.join(DIR, 'ws-qa.json')
const estadoSalvo = () => JSON.parse(readFileSync(arquivo, 'utf8'))
// cada linha do registro durável é "<Message-ID>\t<data ISO informada pelo provedor>"
const linhasDeEnvio = () => (existsSync(ENVIOS) ? readFileSync(ENVIOS, 'utf8').split('\n').filter(Boolean) : [])
const envios = () => linhasDeEnvio().map(l => l.split('\t')[0])
const NL = String.fromCharCode(10)
const esperar = ms => new Promise(r => setTimeout(r, ms))
let filho = null
const subir = extra => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['server/index.js'], { cwd: RAIZ, env: ambiente(extra), stdio: ['ignore', 'pipe', 'pipe'] })
  let saida = ''
  const ler = d => { saida += d.toString(); if (/atendo servidor na porta/.test(saida)) resolve({ processo: p, saida: () => saida }) }
  p.stdout.on('data', ler); p.stderr.on('data', ler)
  p.on('exit', code => { if (!/atendo servidor na porta/.test(saida)) reject(new Error(`servidor saiu antes de subir (${code}): ${saida}`)) })
  setTimeout(() => reject(new Error('servidor não subiu: ' + saida)), 30_000)
})
const morreu = processo => new Promise(resolve => processo.on('exit', (code, sinal) => resolve({ code, sinal })))
const matar = async () => { try { filho?.kill() } catch { /* já morreu */ } filho = null; await esperar(1200) }
after(async () => { await matar(); try { rmSync(DIR, { recursive: true, force: true }) } catch { /* temp */ } })

const entrar = async () => {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa@teste.local', senha: 'senha-qa-12345' }) })
  assert.equal(login.status, 200, 'login do ensaio')
  return login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}
const verEstado = async cookie => (await fetch(base + '/api/state', { headers: { cookie } }).then(r => r.json())).state
const verAuditoria = async (cookie, id) => (await fetch(base + `/api/auditoria/${id}`, { headers: { cookie } }).then(r => r.json())).conversa

/**
 * Estado salvo com um aceite de 40% pronto para a confirmação sair, já com um ciclo
 * de auditoria aberto (o cliente escreveu, a IA classificou, o motor decidiu).
 */
const CONF_CUPOM = 'Hallo! Ihr Gutschein KEEP35 (35%) ist freigegeben und gilt für jede Bestellung. Sie behalten den Artikel.'
function preparar(id, { lojaId = 'loja1', modo = 'manual', aprovado = true, agendado = true, tipo = 'reembolso' } = {}) {
  const cupom = tipo === 'cupom'
  const salvo = estadoSalvo()
  // cada cenário começa com o mundo em ordem: códigos originais, conferência de
  // cupons recém-feita e pedido no valor de origem (um teste anterior pode ter
  // envelhecido a conferência ou trocado o código de propósito)
  const l1 = salvo.lojas.find(x => x.id === 'loja1')
  if (l1?.verificacaoCupons) {
    l1.cupons = { ...CUPONS }
    l1.verificacaoCupons.em = new Date().toISOString()
    l1.verificacaoCupons.itens = Object.entries(CUPONS).map(([pct, codigo]) => ({ pct: Number(pct), codigo, valor: Number(pct), situacao: 'ok', detalhe: 'ok' }))
  }
  const pedidoOriginal = pedidoDe(id)
  const pSalvo = (salvo.pedidos ?? []).find(x => x.id === 'p-' + id)
  if (pSalvo && pedidoOriginal) pSalvo.valor = pedidoOriginal.valor
  const ciclo = `ciclo-${id}`
  const tentativa = `tent-${id}`
  const evento = (tipo, extra = {}) => novoEvento({
    tipo, ticketId: id, lojaId, em: '2026-09-01T10:00:00.000Z', resumo: extra.resumo ?? tipo,
    situacao: extra.situacao ?? 'informativo', chave: `${tipo}:${id}:semente`,
    dados: { cicloId: ciclo, ...(extra.dados ?? {}) },
  })
  const faseAceita = cupom ? 'qual_cupom_35' : 'reemb_40'
  const faseConf = cupom ? 'conf_cupom' : 'conf_reembolso'
  const texto = cupom ? CONF_CUPOM : CONF
  const cp = {
    id: `ev-${id}`, ticketId: id, faseAceita, tipo, jornada: 'qualidade', modo,
    ofertaAceita: cupom ? { tipo: 'cupom', pct: null, cupom: 35, prazo: null, semDevolucao: true } : { tipo: 'reembolso', pct: 40, cupom: null, prazo: null, semDevolucao: true },
    aceitaEm: '2026-09-01T10:00:00.000Z',
    percentual: cupom ? null : 40, valor: cupom ? null : 40, valorPedido: 100, moeda: 'EUR', cupom: cupom ? 'KEEP35' : null,
    produtos: ['Polo Premium (Schwarz / L)'], endereco: null,
    historicoFases: ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40'],
    mensagemConfirmacaoId: `atendo-ev-${id}`, status: 'aguardando_cadencia',
    ...(aprovado ? { aprovadoEm: '2026-09-01T15:00:00.000Z', aprovadoPor: 'Dono da Loja' } : {}),
  }
  const t = {
    id, nome: 'Cliente ' + id, de: `${id}@web.de`,
    assunto: `Bestellung ${pedidoDe(id).numero}`,
    corpo: 'Ok, 40%.', data: '2026-09-01T10:00:00.000Z',
    lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId, historico: [],
    motor: 'novo', motorAtendimento: 'novo', primeiroEmailEm: '2026-09-01T10:00:00.000Z',
    rascunho: texto, geradoPorIA: true,
    ...(agendado ? { enviaEm: Date.now() - 1000 } : {}),
    cicloAuditoria: ciclo,
    auditoriaIA: [
      evento('cliente_recebido', { resumo: 'Mensagem do cliente (Ok, 40%.)' }),
      evento('cliente_aceitou', { situacao: 'ok', resumo: 'Cliente aceitou', dados: { fase: faseAceita } }),
      evento('rascunho_gerado', { dados: { tentativaId: tentativa, fase: faseConf } }),
    ],
    atendimentoNovo: {
      versao: 1, fluxo: 'qualidade', etapa: faseAceita, produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true,
      motivo: 'qualidade', historicoEtapas: hist(cupom ? ['qual_troca', 'qual_cupom_35'] : ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40']),
      transicaoPendente: { para: faseConf, mensagem: 'ok', faltando: [] }, aguardando: 'envio', acaoAceita: faseAceita,
      idioma: 'de', rascunhoGerado: texto, rascunhoIdioma: 'de', tentativaAtual: tentativa,
      conclusaoPendente: cp,
    },
  }
  salvo.tickets = [t, ...(salvo.tickets ?? []).filter(x => x.id !== id)]
  writeFileSync(arquivo, JSON.stringify(salvo))
  return { ciclo, tentativa, mensagemId: cp.mensagemConfirmacaoId, faseConf, faseAceita }
}

/** Mexe no estado SALVO entre a queda e o reinício (o mundo mudou enquanto o servidor estava fora). */
function mexerNoEstadoSalvo(fn) {
  const salvo = estadoSalvo()
  fn(salvo)
  writeFileSync(arquivo, JSON.stringify(salvo))
  return salvo
}
/** O evento de envio reconstruído desta conversa. */
const eventoDeEnvio = c => c.eventos.filter(e => e.tipo === 'email_enviado').at(-1)

/** Sobe o servidor programado para cair depois do canal e antes da gravação final. */
async function cairDepoisDoCanal(extra = {}) {
  const primeiro = await subir({ ATENDO_TESTE_QUEDA: 'antes', ...extra })
  // registrado para limpeza: se a queda NÃO acontecer, este servidor não pode
  // ficar órfão segurando a porta e pendurando a bateria inteira
  filho = primeiro.processo
  const fim = await Promise.race([morreu(primeiro.processo), esperar(25_000).then(() => null)])
  assert.ok(fim, 'o servidor deveria cair no ponto de teste')
  assert.equal(fim.code, 7, 'queda proposital depois do envio e antes da gravação')
  return primeiro
}

/** Confere a prova completa de um envio reconstruído pela reconciliação. */
function conferirProva(c, { ciclo, tentativa, mensagemId, origemEnvio, autorizado }) {
  assert.equal(c.selo, 'tudo_certo', 'selo final: ' + c.selo + ' — ' + c.passos)
  const enviados = c.eventos.filter(e => e.tipo === 'email_enviado')
  assert.equal(enviados.length, 1, 'exatamente um email_enviado')
  const e = enviados[0]
  assert.equal(e.dados.canalConfirmou, true)
  assert.equal(e.dados.enviado, true)
  assert.equal(e.dados.mensagemId, mensagemId)
  assert.equal(e.dados.cicloId, ciclo, 'mesmo ciclo do contexto gravado')
  assert.equal(e.dados.tentativaId, tentativa, 'mesma tentativa do contexto gravado')
  assert.equal(e.dados.origemEnvio, origemEnvio)
  assert.equal(e.dados.reconciliado, true, 'o evento diz que foi reconstruído')
  assert.ok(e.dados.checklist?.itens?.length, 'o checklist da tentativa está completo')
  assert.equal(e.dados.checklist.geral, 'tudo_certo', JSON.stringify(e.dados.checklist.itens.filter(i => i.estado !== 'verde' && i.estado !== 'cinza')))
  if (autorizado) {
    assert.ok(e.dados.autorizacao?.aprovadoEm, 'a autorização humana ficou preservada')
    assert.equal(e.dados.autorizacao.aprovadoPor, 'Dono da Loja')
    assert.ok(e.dados.autorizacao.aceiteId)
  } else {
    assert.equal(e.dados.autorizacao ?? null, null, 'não houve autorização humana')
  }
  // vínculo EXATO na linha do tempo
  const enviada = c.mensagens.filter(m => m.situacao === 'enviada')
  assert.equal(enviada.length, 1, 'uma mensagem enviada na linha do tempo: ' + JSON.stringify(c.mensagens.map(m => [m.chave, m.situacao, m.mensagemId])))
  assert.equal(enviada[0].mensagemId, mensagemId)
  assert.equal(enviada[0].vinculo, 'exato')
  assert.equal(enviada[0].tentativaId, tentativa)
  assert.equal(enviada[0].envioReal, e.em)
  // fase confirmada e encerramento, uma vez cada
  assert.equal(c.eventos.filter(x => x.tipo === 'fase_confirmada').length, 1, 'uma fase confirmada')
  assert.equal(c.eventos.filter(x => x.tipo === 'caso_encerrado').length, 1, 'um encerramento')
  assert.equal(c.origemEnvio, origemEnvio)
}

/* =================================================================== */

test('aprovação do dono + queda depois do canal: a prova é reconstruída com origem "aprovado_pelo_dono"', async () => {
  const ctx = preparar('qa1', { lojaId: 'loja1', modo: 'manual', aprovado: true })
  const antes = envios().length
  const primeiro = await cairDepoisDoCanal()
  assert.match(primeiro.saida(), /queda proposital depois do envio, antes da gravação/)
  assert.equal(envios().length, antes + 1, 'o canal enviou exatamente um e-mail')
  // o estado salvo ficou em "enviando", com o CONTEXTO da tentativa já persistido
  const salvo = estadoSalvo().tickets.find(t => t.id === 'qa1')
  assert.equal(salvo.atendimentoNovo.conclusaoPendente.status, 'enviando', 'gravado ANTES do envio')
  assert.equal(salvo.envioPendente.mensagemId, ctx.mensagemId)
  assert.equal(salvo.envioPendente.origemEnvio, 'aprovado_pelo_dono', 'a origem foi decidida ANTES de chamar o canal')
  assert.equal(salvo.envioPendente.cicloId, ctx.ciclo)
  assert.equal(salvo.envioPendente.tentativaId, ctx.tentativa)
  assert.equal(salvo.envioPendente.fase, 'conf_reembolso')
  assert.equal(salvo.envioPendente.idioma, 'de')
  assert.equal(salvo.envioPendente.disparo, 'agendador')
  assert.equal(salvo.envioPendente.autorizacao.aprovadoPor, 'Dono da Loja')
  assert.ok(salvo.envioPendente.hashTexto, 'a identificação do texto enviado ficou gravada')
  assert.equal(salvo.auditoriaIA.some(e => e.tipo === 'email_enviado'), false, 'a queda impediu o email_enviado')

  // reinício: encontra o Message-ID na caixa de enviados e reconstrói a prova
  const segundo = await subir({})
  filho = segundo.processo
  await esperar(2500)
  assert.equal(envios().length, antes + 1, 'nenhum segundo e-mail')
  assert.match(segundo.saida(), /confirmação já estava na caixa de enviados — fechada sem reenviar/)
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa1')
  conferirProva(c, { ...ctx, origemEnvio: 'aprovado_pelo_dono', autorizado: true })

  const st = await verEstado(cookie)
  const t = st.tickets.find(x => x.id === 'qa1')
  assert.equal(t.status, 'enviado')
  assert.equal(t.respostaMensagemId, ctx.mensagemId)
  assert.equal(t.respostaFase, 'conf_reembolso')
  assert.equal(t.respostaIdioma, 'de')
  assert.equal(t.respostaTentativaId, ctx.tentativa)
  assert.equal(t.respostaOrigem, 'ia')
  assert.equal(t.atendimentoNovo.etapa, 'conf_reembolso')
  assert.equal(t.atendimentoNovo.conclusaoPendente.status, 'concluida')
  assert.equal(t.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1, 'uma única transição')
  // conclusão APROVADA pelo dono é manual: as regras atuais não criam linha automática
  assert.equal(t.relatorioAuto, undefined, 'conclusão manual não vira linha automática no relatório')
  assert.equal(st.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-qa1').length, 0)
  // o contexto só foi limpo depois da gravação final; a evidência ficou nos eventos
  assert.equal(estadoSalvo().tickets.find(x => x.id === 'qa1').envioPendente, undefined, 'contexto pendente limpo depois da gravação final')
  assert.equal(t.envioPendente, undefined, '/api/state não expõe o contexto interno')

  // /api/state continua sem expor a auditoria
  assert.equal(t.auditoriaIA, undefined, '/api/state nunca traz auditoriaIA')
  assert.equal(JSON.stringify(st).includes('"auditoriaIA"'), false)
})

test('conversa assumida pelo dono continua dela depois de reiniciar o servidor', async () => {
  // A migração de arranque é o risco real: casoSemProvaDeProduto/gerarColetasDeProduto
  // rodam a CADA boot e já devolviam casos para a fila da IA, reescrevendo status
  // e motivoEscalada. O teste existe para isso.
  preparar('qa13', { lojaId: 'loja2', modo: 'automatico', aprovado: false, agendado: true })
  await matar()
  filho = (await subir({})).processo
  await esperar(2500)
  let cookie = await entrar()

  // o dono assume a conversa
  const r = await fetch(base + '/api/tickets/qa13/atendimento-humano', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ confirmar: true, motivo: 'assumo eu, reinício de teste' }),
  })
  assert.equal(r.status, 200, 'mover para humano: ' + (await r.text()).slice(0, 200))
  const enviosAntes = envios().length

  let st = await verEstado(cookie)
  let t = st.tickets.find(x => x.id === 'qa13')
  assert.equal(t.status, 'humano')
  assert.equal(t.atendimentoHumano.ativo, true)
  const marcaAntes = JSON.stringify(t.atendimentoHumano)

  // DOIS reinícios seguidos
  for (const volta of [1, 2]) {
    await matar()
    filho = (await subir({})).processo
    await esperar(2500)
    cookie = await entrar()
    st = await verEstado(cookie)
    t = st.tickets.find(x => x.id === 'qa13')
    assert.equal(t.status, 'humano', `volta ${volta}: continua em Atendimento humano`)
    assert.equal(t.atendimentoHumano?.ativo, true, `volta ${volta}: a marca sobreviveu`)
    assert.equal(JSON.stringify(t.atendimentoHumano), marcaAntes, `volta ${volta}: quem, quando e por quê intactos`)
    assert.equal(t.iaPausada, true, `volta ${volta}: a IA continua parada`)
    assert.equal(t.rascunho ?? null, null, `volta ${volta}: nenhum rascunho foi gerado no arranque`)
    assert.equal(t.enviaEm ?? null, null, `volta ${volta}: nada reagendado`)
    assert.equal(t.atendimentoNovo.aguardando, 'humano', `volta ${volta}: aguardando humano`)
    assert.equal(t.atendimentoNovo.transicaoPendente ?? null, null, `volta ${volta}: sem fase pendente`)
    assert.equal(envios().length, enviosAntes, `volta ${volta}: nenhum e-mail saiu`)
  }

  // e o agendador segue rodando sem tocar nela
  await esperar(6500)
  st = await verEstado(cookie)
  t = st.tickets.find(x => x.id === 'qa13')
  assert.equal(t.status, 'humano', 'o agendador não devolveu a conversa para a IA')
  assert.equal(envios().length, enviosAntes, 'o agendador não enviou nada')
  assert.equal(t.relatorioAuto ?? null, null, 'nenhuma linha de relatório')
})

test('estado legado incompatível (assumida com a IA ligada e rascunho antigo) é corrigido no arranque', async () => {
  // Estado que só existe em banco antigo ou em queda no meio da gravação: a
  // conversa está marcada como assumida, mas com a IA ligada, um rascunho da IA
  // ainda ativo e um envio agendado JÁ VENCIDO.
  //
  // O rascunho é o ponto perigoso: a recusa da rota manual compara o texto com
  // atendimentoHumano.rascunhoInvalidado, que no estado legado não existe — sem
  // esta reconciliação, o texto da IA podia sair como se o dono o tivesse
  // escrito.
  preparar('qa14', { lojaId: 'loja2', modo: 'automatico', aprovado: false, agendado: true })
  const salvo = estadoSalvo()
  const alvo = salvo.tickets.find(x => x.id === 'qa14')
  const RASCUNHO_LEGADO = 'Hallo! Wir bieten Ihnen eine Rückerstattung von 40% (40,00 €) an. Das Geld ist in 3 bis 14 Tagen wieder da.'
  alvo.atendimentoHumano = { ativo: true, por: 'Allan', em: '2026-09-18T10:00:00.000Z', motivo: 'legado', faseNoMomento: null }
  alvo.iaPausada = false            // incoerente de propósito
  alvo.status = 'aprovacao'         // idem
  alvo.enviaEm = Date.now() - 1000  // já vencido: o agendador pegaria na hora
  alvo.rascunho = RASCUNHO_LEGADO   // e o texto da IA ainda ativo
  alvo.rascunhoTraducao = 'tradução antiga'
  alvo.geradoPorIA = true
  if (alvo.atendimentoNovo) { alvo.atendimentoNovo.aguardando = 'cliente'; alvo.atendimentoNovo.rascunhoGerado = RASCUNHO_LEGADO; alvo.atendimentoNovo.proximoEnvioMinimo = new Date().toISOString() }
  // o que tem de sobreviver intacto
  const faseAntes = alvo.atendimentoNovo?.etapa ?? null
  const motorAntes = alvo.motorAtendimento
  const aceitaAntes = alvo.atendimentoNovo?.acaoAceita ?? null
  const conclusaoAntes = alvo.atendimentoNovo?.conclusaoPendente?.id ?? null
  writeFileSync(arquivo, JSON.stringify(salvo))
  const enviosAntes = envios().length

  await matar()
  filho = (await subir({})).processo
  await esperar(2500)
  let cookie = await entrar()
  let st = await verEstado(cookie)
  let t = st.tickets.find(x => x.id === 'qa14')

  // a invariável foi restaurada
  assert.equal(t.atendimentoHumano?.ativo, true, 'continua sendo do dono')
  assert.equal(t.iaPausada, true, 'a IA foi parada: assumida implica IA parada')
  assert.equal(t.status, 'humano', 'voltou para a fila do dono')
  assert.equal(t.enviaEm ?? null, null, 'o agendamento vencido foi cancelado')
  assert.equal(t.atendimentoNovo.aguardando, 'humano')

  // o rascunho legado saiu do estado ativo, inteiro, para onde nada se perde
  assert.equal(t.rascunho ?? null, null, 'o rascunho antigo não está mais ativo')
  assert.equal(t.rascunhoTraducao ?? null, null, 'nem a tradução dele')
  assert.equal(t.geradoPorIA ?? null, null, 'nem a marca de geração')
  assert.equal(t.atendimentoNovo.rascunhoGerado ?? null, null)
  assert.equal(t.atendimentoNovo.proximoEnvioMinimo ?? null, null)
  assert.equal(t.atendimentoHumano.rascunhoInvalidado, RASCUNHO_LEGADO, 'o texto completo ficou guardado')

  let c = await verAuditoria(cookie, 'qa14')
  const legado = c.eventos.filter(e => e.dados?.origem === 'atendimento_humano_legado')
  assert.equal(legado.length, 1, 'um evento de recuperação')
  assert.equal(legado[0].dados.recuperadoDeEstadoLegado, true)
  assert.equal(legado[0].dados.texto, RASCUNHO_LEGADO, 'o texto completo está na Auditoria')
  assert.ok(legado[0].dados.agendamentoCancelado, 'o agendamento que existia ficou registrado')

  // o texto da IA NÃO sai, nem passando por manual
  const tentar = await fetch(base + '/api/tickets/qa14/aprovar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ texto: RASCUNHO_LEGADO, origem: 'manual' }),
  })
  assert.equal(tentar.status, 409, 'o rascunho legado não sai como manual')
  assert.equal(envios().length, enviosAntes, 'e nada foi enviado na tentativa')

  // DOIS reinícios: nada duplica e nada é sobrescrito
  for (const volta of [1, 2]) {
    await matar()
    filho = (await subir({})).processo
    await esperar(2500)
    cookie = await entrar()
    c = await verAuditoria(cookie, 'qa14')
    assert.equal(c.eventos.filter(e => e.dados?.origem === 'atendimento_humano_legado').length, 1, `volta ${volta}: o evento não duplica`)
    st = await verEstado(cookie)
    t = st.tickets.find(x => x.id === 'qa14')
    assert.equal(t.atendimentoHumano.rascunhoInvalidado, RASCUNHO_LEGADO, `volta ${volta}: o texto guardado não é sobrescrito`)
    assert.equal(t.rascunho ?? null, null, `volta ${volta}: nenhum rascunho voltou`)
    assert.equal(t.status, 'humano')
    assert.equal(envios().length, enviosAntes, `volta ${volta}: nenhum e-mail`)
  }

  // o que é do dono, o dono manda
  const meuTexto = 'Guten Tag, ich schreibe Ihnen persönlich: ich kümmere mich heute noch darum.'
  const envio = await fetch(base + '/api/tickets/qa14/aprovar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ texto: meuTexto, origem: 'manual' }),
  })
  assert.equal(envio.status, 200, 'o texto NOVO do dono sai: ' + (await envio.text()).slice(0, 200))
  assert.equal(envios().length, enviosAntes + 1, 'exatamente um e-mail, o do dono')

  st = await verEstado(cookie)
  t = st.tickets.find(x => x.id === 'qa14')
  assert.equal(t.resposta, meuTexto)
  assert.equal(t.status, 'humano', 'a conversa continua do dono depois da resposta dele')
  // fase, motor, solução aceita e relatório intactos
  assert.equal(t.atendimentoNovo.etapa ?? null, faseAntes, 'a fase não mudou')
  assert.equal(t.motorAtendimento, motorAntes, 'o motor não mudou')
  assert.equal(t.atendimentoNovo.acaoAceita ?? null, aceitaAntes, 'a solução aceita ficou')
  assert.equal(t.atendimentoNovo.conclusaoPendente?.id ?? null, conclusaoAntes, 'a conclusão ficou')
  assert.equal(t.relatorioAuto ?? null, null, 'nenhuma linha de relatório')
  assert.equal(t.relatorioDia ?? null, null)

  c = await verAuditoria(cookie, 'qa14')
  assert.equal(c.eventos.filter(e => e.tipo === 'fase_confirmada' && e.dados?.tentativaId).length >= 0, true)
  const enviado = c.eventos.filter(e => e.tipo === 'email_enviado').at(-1)
  assert.equal(enviado.dados.origem, 'manual', 'origemEnvio manual')
  assert.equal(enviado.dados.loja, 'loja2', 'pela conta da própria loja')
  assert.ok(enviado.dados.mensagemId)
})

test('dois reinícios consecutivos depois da reconciliação: nada duplica', async () => {
  const antes = envios().length
  for (const volta of [1, 2]) {
    await matar()
    const servidor = await subir({})
    filho = servidor.processo
    await esperar(2500)
    const cookie = await entrar()
    const c = await verAuditoria(cookie, 'qa1')
    assert.equal(c.eventos.filter(e => e.tipo === 'email_enviado').length, 1, `volta ${volta}: um email_enviado`)
    assert.equal(c.eventos.filter(e => e.tipo === 'fase_confirmada').length, 1, `volta ${volta}: uma fase confirmada`)
    assert.equal(c.eventos.filter(e => e.tipo === 'caso_encerrado').length, 1, `volta ${volta}: um encerramento`)
    assert.equal(c.selo, 'tudo_certo', `volta ${volta}: selo`)
    const st = await verEstado(cookie)
    const t = st.tickets.find(x => x.id === 'qa1')
    assert.equal(t.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1, `volta ${volta}: uma transição`)
    assert.equal(st.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-qa1').length, 0, `volta ${volta}: nenhuma linha`)
    assert.equal(envios().length, antes, `volta ${volta}: nenhum e-mail novo`)
  }
  // e o agendador continua rodando sem reenviar
  await esperar(6500)
  assert.equal(envios().length, antes, 'o agendador não reenviou')
})

test('envio realmente automático + queda: origem "automatico" e o filtro dos automáticos o encontra', async () => {
  await matar()
  const ctx = preparar('qa2', { lojaId: 'loja2', modo: 'automatico', aprovado: false })
  const antes = envios().length
  await cairDepoisDoCanal()
  assert.equal(envios().length, antes + 1, 'um e-mail')
  const salvo = estadoSalvo().tickets.find(t => t.id === 'qa2')
  assert.equal(salvo.envioPendente.origemEnvio, 'automatico', 'sem autorização humana nenhuma')
  assert.equal(salvo.envioPendente.autorizacao ?? null, null)

  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.equal(envios().length, antes + 1, 'nenhum segundo e-mail')
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa2')
  conferirProva(c, { ...ctx, origemEnvio: 'automatico', autorizado: false })
  // conclusão automática de verdade: a linha do relatório existe, uma só
  const st = await verEstado(cookie)
  assert.equal(st.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-qa2').length, 1, 'exatamente uma linha no relatório')
  // e o filtro "somente enviados automaticamente" acha pela evidência gravada
  const lista = await fetch(base + '/api/auditoria?dias=90&soAutomaticos=true&porPagina=100', { headers: { cookie } }).then(r => r.json())
  const ids = lista.conversas.map(x => x.ticketId)
  assert.ok(ids.includes('qa2'), 'o caso automático entra no filtro')
  assert.ok(!ids.includes('qa1'), 'a confirmação aprovada pelo dono continua fora do filtro')
})

test('resposta escrita pelo dono + queda: origem "manual", nunca automática', async () => {
  await matar()
  const ctx = preparar('qa3', { lojaId: 'loja1', modo: 'manual', aprovado: true, agendado: false })
  const antes = envios().length
  // o dono envia à mão: o processo morre no meio do pedido, depois de o canal confirmar
  const primeiro = await subir({ ATENDO_TESTE_QUEDA: 'antes' })
  const cookie = await entrar()
  const fimProcesso = morreu(primeiro.processo)
  await fetch(base + '/api/tickets/qa3/aprovar', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ texto: CONF, origem: 'manual' }),
  }).catch(() => null) // a conexão cai junto com o processo
  const fim = await Promise.race([fimProcesso, esperar(25_000).then(() => null)])
  assert.ok(fim, 'o servidor deveria cair'); assert.equal(fim.code, 7)
  assert.equal(envios().length, antes + 1, 'um e-mail')
  const salvo = estadoSalvo().tickets.find(t => t.id === 'qa3')
  assert.equal(salvo.envioPendente.origem, 'manual')
  assert.equal(salvo.envioPendente.origemEnvio, 'manual', 'texto do dono vence qualquer outra origem')
  assert.equal(salvo.envioPendente.disparo, 'dono')

  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.equal(envios().length, antes + 1, 'nenhum segundo e-mail')
  const cookie2 = await entrar()
  const c = await verAuditoria(cookie2, 'qa3')
  conferirProva(c, { ...ctx, origemEnvio: 'manual', autorizado: true })
  assert.ok(c.eventos.some(e => e.tipo === 'respondido_manualmente'), 'ficou registrado como resposta sua')
  const st = await verEstado(cookie2)
  assert.equal(st.tickets.find(x => x.id === 'qa3').respostaOrigem, 'manual')
  const lista = await fetch(base + '/api/auditoria?dias=90&soAutomaticos=true&porPagina=100', { headers: { cookie: cookie2 } }).then(r => r.json())
  assert.ok(!lista.conversas.map(x => x.ticketId).includes('qa3'), 'resposta manual nunca aparece como automática')
})

test('Message-ID que NÃO está na caixa de enviados: nada de envio, nada de fase, nada de relatório — falha e caso com você', async () => {
  await matar()
  const ctx = preparar('qa4', { lojaId: 'loja1', modo: 'manual', aprovado: true })
  await cairDepoisDoCanal()
  // a caixa de enviados NÃO tem a mensagem (o canal aceitou, mas ela não saiu)
  const restantes = linhasDeEnvio().filter(l => l.split('\t')[0] !== ctx.mensagemId)
  writeFileSync(ENVIOS, restantes.map(l => l + '\n').join(''))
  const antes = envios().length
  const salvoAntes = estadoSalvo().tickets.find(t => t.id === 'qa4')
  assert.equal(salvoAntes.envioPendente.mensagemId, ctx.mensagemId, 'o contexto ficou gravado antes do envio')

  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.match(servidor.saida(), /envio interrompido — com o dono \(não saiu\)/)
  assert.equal(envios().length, antes, 'zero reenvios')
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa4')
  assert.equal(c.eventos.filter(e => e.tipo === 'email_enviado').length, 0, 'nenhum email_enviado')
  assert.equal(c.eventos.filter(e => e.tipo === 'fase_confirmada').length, 0, 'nenhuma fase confirmada')
  assert.equal(c.eventos.filter(e => e.tipo === 'caso_encerrado').length, 0, 'nenhum encerramento')
  const falha = c.eventos.filter(e => e.tipo === 'envio_falhou')
  assert.equal(falha.length, 1, 'a falha ficou registrada')
  assert.equal(falha[0].dados.cicloId, ctx.ciclo, 'no ciclo atual')
  assert.equal(falha[0].dados.mensagemId, ctx.mensagemId, 'o Message-ID fica preservado para conferência manual')
  assert.equal(falha[0].dados.conferencia, 'nao_encontrado_na_caixa')
  const humano = c.eventos.filter(e => e.tipo === 'caso_para_humano')
  assert.equal(humano.length, 1)
  assert.equal(humano[0].dados.origem, 'envio_interrompido')
  assert.match(humano[0].dados.motivo, /não está na caixa de enviados/)
  assert.equal(c.selo, 'aguardando_voce', 'selo: ' + c.selo)
  assert.match(c.motivoChecklist, /não está na caixa de enviados/)
  const st = await verEstado(cookie)
  const t = st.tickets.find(x => x.id === 'qa4')
  assert.equal(t.status, 'humano')
  assert.equal(t.atendimentoNovo.etapa, 'reemb_40', 'a fase não avançou')
  assert.equal(t.relatorioAuto, undefined, 'nenhum relatório')
  assert.equal(t.enviaEm, undefined, 'sem reenvio automático')
  assert.equal(t.atendimentoNovo.conclusaoPendente.mensagemConfirmacaoId, ctx.mensagemId, 'Message-ID preservado')
  // a fotografia é PRIVADA: /api/state nunca a expõe; ela fica no estado salvo
  assert.equal(t.envioPendente, undefined, '/api/state não expõe o contexto interno')
  assert.equal(estadoSalvo().tickets.find(x => x.id === 'qa4').envioPendente.mensagemId, ctx.mensagemId, 'contexto preservado para a conferência manual')
  await esperar(6500)
  assert.equal(envios().length, antes, 'nem o agendador reenviou')
})

test('caixa de enviados indisponível (resultado inconclusivo): mesmo comportamento seguro', async () => {
  await matar()
  const ctx = preparar('qa5', { lojaId: 'loja1', modo: 'manual', aprovado: true })
  await cairDepoisDoCanal()
  const antes = envios().length
  // sem o registro durável de envios, a conferência não tem como concluir nada
  const servidor = await subir({ ATENDO_TESTE_ENVIOS: '' })
  filho = servidor.processo
  await esperar(2500)
  assert.match(servidor.saida(), /envio interrompido — com o dono \(não foi possível conferir\)/)
  assert.equal(envios().length, antes, 'zero reenvios')
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa5')
  assert.equal(c.eventos.filter(e => e.tipo === 'email_enviado').length, 0)
  assert.equal(c.eventos.filter(e => e.tipo === 'fase_confirmada').length, 0)
  const falha = c.eventos.filter(e => e.tipo === 'envio_falhou')
  assert.equal(falha.length, 1)
  assert.equal(falha[0].dados.conferencia, 'nao_foi_possivel_conferir')
  assert.equal(falha[0].dados.mensagemId, ctx.mensagemId)
  assert.equal(c.selo, 'aguardando_voce')
  assert.match(c.motivoChecklist, /Verifique a caixa de enviados/)
  const st = await verEstado(cookie)
  const t = st.tickets.find(x => x.id === 'qa5')
  assert.equal(t.status, 'humano')
  assert.equal(t.relatorioAuto, undefined)
  assert.equal(t.atendimentoNovo.etapa, 'reemb_40')
})

test('cupom válido no envio e VENCIDO antes do reinício: a fotografia verde é preservada', async () => {
  await matar()
  const ctx = preparar('qa7', { tipo: 'cupom' })
  await cairDepoisDoCanal()
  const salvo = estadoSalvo().tickets.find(t => t.id === 'qa7')
  assert.equal(salvo.envioPendente.checklist.geral, 'tudo_certo', 'a fotografia nasceu verde: ' + JSON.stringify(salvo.envioPendente.checklist.itens.filter(i => i.estado !== 'verde' && i.estado !== 'cinza')))
  assert.equal(salvo.envioPendente.checklist.itens.find(i => i.id === 'cupom').estado, 'verde')
  assert.ok(salvo.envioPendente.fatos, 'os fatos usados no checklist também ficaram gravados')

  // o servidor ficou fora do ar por mais de 24 h: a conferência do cupom venceu
  mexerNoEstadoSalvo(st => {
    st.lojas.find(l => l.id === 'loja1').verificacaoCupons.em = new Date(Date.now() - 48 * 3600_000).toISOString()
  })
  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa7')
  const e = eventoDeEnvio(c)
  assert.equal(e.dados.checklist.geral, 'tudo_certo', 'o checklist do envio continua verde')
  assert.equal(e.dados.checklist.itens.find(i => i.id === 'cupom').estado, 'verde', 'o cupom estava válido QUANDO a mensagem saiu')
  assert.equal(e.dados.checklistHistoricoAusente ?? false, false)
  assert.equal(c.selo, 'tudo_certo', 'reinício depois de 24 h não transforma envio correto em incorreto')
})

test('código do cupom trocado e pedido revalorizado antes do reinício: a fotografia não muda', async () => {
  await matar()
  const ctxC = preparar('qa8', { tipo: 'cupom' })
  await cairDepoisDoCanal()
  const fotoC = estadoSalvo().tickets.find(t => t.id === 'qa8').envioPendente.checklist
  mexerNoEstadoSalvo(st => {
    const l = st.lojas.find(x => x.id === 'loja1')
    l.cupons['35'] = 'OUTRO35' // o dono trocou o código depois do envio
    l.verificacaoCupons.itens = l.verificacaoCupons.itens.map(i => (i.pct === 35 ? { ...i, codigo: 'OUTRO35' } : i))
  })
  const s1 = await subir({})
  filho = s1.processo
  await esperar(2500)
  let cookie = await entrar()
  let c = await verAuditoria(cookie, 'qa8')
  assert.deepEqual(eventoDeEnvio(c).dados.checklist, fotoC, 'trocar o código não reescreve o checklist do envio')
  assert.equal(c.selo, 'tudo_certo')

  // pedido ressincronizado com outro valor: percentual e valor históricos ficam
  await matar()
  const ctxR = preparar('qa9')
  await cairDepoisDoCanal()
  const fotoR = estadoSalvo().tickets.find(t => t.id === 'qa9').envioPendente.checklist
  assert.equal(fotoR.itens.find(i => i.id === 'valor').estado, 'verde')
  mexerNoEstadoSalvo(st => {
    const p = st.pedidos.find(x => x.id === 'p-qa9')
    p.valor = 250 // 40% viraria 100,00 € — o texto enviado fala em 40,00 €
  })
  const s2 = await subir({})
  filho = s2.processo
  await esperar(2500)
  cookie = await entrar()
  c = await verAuditoria(cookie, 'qa9')
  const e = eventoDeEnvio(c)
  assert.equal(e.dados.checklist.itens.find(i => i.id === 'valor').estado, 'verde', 'o valor verificado no envio permanece')
  assert.equal(e.dados.checklist.itens.find(i => i.id === 'percentual').estado, 'verde')
  assert.deepEqual(e.dados.checklist, fotoR, 'a fotografia inteira é a mesma')
  assert.equal(c.selo, 'tudo_certo')
})

test('horário do envio: data do provedor quando existe, início do envio quando não — nunca o do reinício', async () => {
  // com data do provedor
  await matar()
  const ctx = preparar('qa10')
  await cairDepoisDoCanal()
  const dataProvedor = linhasDeEnvio().find(l => l.split(String.fromCharCode(9))[0] === ctx.mensagemId).split(String.fromCharCode(9))[1]
  assert.ok(Date.parse(dataProvedor), 'o registro guardou a data da mensagem')
  const s1 = await subir({})
  filho = s1.processo
  await esperar(2500)
  let cookie = await entrar()
  let c = await verAuditoria(cookie, 'qa10')
  let e = eventoDeEnvio(c)
  assert.equal(e.em, dataProvedor, 'o evento usa a data REAL da mensagem')
  assert.equal(e.dados.enviadoEm, dataProvedor)
  assert.equal(e.dados.horarioInferido, false)
  assert.ok(Date.parse(e.dados.reconciliadoEm) > Date.parse(dataProvedor), 'reconciliadoEm é outro horário, posterior')
  const enviada = c.mensagens.find(m => m.situacao === 'enviada')
  assert.equal(enviada.envioReal, dataProvedor, 'a linha do tempo usa a data real')

  // sem data do provedor
  await matar()
  const ctx2 = preparar('qa11')
  await cairDepoisDoCanal()
  const iniciado = estadoSalvo().tickets.find(t => t.id === 'qa11').envioPendente.iniciadoEm
  // o provedor devolve a mensagem, mas sem data
  writeFileSync(ENVIOS, linhasDeEnvio().map(l => (l.split(String.fromCharCode(9))[0] === ctx2.mensagemId ? ctx2.mensagemId : l)).map(l => l + NL).join(''))
  const s2 = await subir({})
  filho = s2.processo
  await esperar(2500)
  cookie = await entrar()
  c = await verAuditoria(cookie, 'qa11')
  e = eventoDeEnvio(c)
  assert.equal(e.dados.horarioInferido, true, 'o horário é aproximado e está declarado')
  assert.equal(e.dados.enviadoEm, iniciado, 'usa o início do envio, não o reinício')
  assert.equal(e.em, iniciado)
  assert.notEqual(e.dados.reconciliadoEm, e.dados.enviadoEm)
  assert.equal(c.selo, 'tudo_certo')
})

test('estado legado SEM fotografia: o envio continua comprovado, o checklist aparece como histórico indisponível', async () => {
  await matar()
  const ctx = preparar('qa12')
  // estado gravado por uma versão anterior: "enviando", sem envioPendente, com o
  // e-mail realmente na caixa de enviados
  mexerNoEstadoSalvo(st => {
    const t = st.tickets.find(x => x.id === 'qa12')
    t.atendimentoNovo.conclusaoPendente.status = 'enviando'
    t.atendimentoNovo.conclusaoPendente.envioIniciadoEm = new Date(Date.now() - 3600_000).toISOString()
    delete t.envioPendente
    delete t.enviaEm
  })
  appendFileSync(ENVIOS, ctx.mensagemId + NL) // registro antigo: sem data
  const antes = envios().length

  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.equal(envios().length, antes, 'não reenvia')
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa12')
  const e = eventoDeEnvio(c)
  assert.equal(e.dados.enviado, true, 'a prova de que o canal enviou continua')
  assert.equal(e.dados.canalConfirmou, true)
  assert.equal(e.dados.mensagemId, ctx.mensagemId)
  assert.equal(e.dados.checklist ?? null, null, 'nenhum checklist inventado')
  assert.equal(e.dados.checklistHistoricoAusente, true)
  assert.equal(e.dados.horarioInferido, true)
  assert.equal(c.selo, 'revisar_historico', 'selo: ' + c.selo)
  assert.equal(c.checklist, null)
  assert.equal(c.checklistConcluido, false)
  assert.match(c.motivoChecklist, /não foi guardado/)
  // e a fase e o relatório comprovados não são desfeitos
  const st = await verEstado(cookie)
  const t = st.tickets.find(x => x.id === 'qa12')
  assert.equal(t.status, 'enviado')
  assert.equal(t.atendimentoNovo.etapa, 'conf_reembolso')
  assert.equal(t.atendimentoNovo.conclusaoPendente.status, 'concluida')
  assert.equal(c.eventos.filter(x => x.tipo === 'fase_confirmada').length, 1)
})

test('dois reinícios seguidos não duplicam eventos nem alteram a fotografia', async () => {
  await matar()
  const inicial = await subir({})
  filho = inicial.processo
  await esperar(2500)
  const cookie0 = await entrar()
  const antesC = await verAuditoria(cookie0, 'qa7')
  const foto = eventoDeEnvio(antesC).dados.checklist
  const enviadoEm = eventoDeEnvio(antesC).dados.enviadoEm
  for (const volta of [1, 2]) {
    await matar()
    const servidor = await subir({})
    filho = servidor.processo
    await esperar(2500)
    const cookie = await entrar()
    const c = await verAuditoria(cookie, 'qa7')
    assert.equal(c.eventos.filter(e => e.tipo === 'email_enviado').length, 1, `volta ${volta}: um email_enviado`)
    assert.equal(c.eventos.filter(e => e.tipo === 'fase_confirmada').length, 1, `volta ${volta}: uma fase confirmada`)
    assert.deepEqual(eventoDeEnvio(c).dados.checklist, foto, `volta ${volta}: a fotografia não muda`)
    assert.equal(eventoDeEnvio(c).dados.enviadoEm, enviadoEm, `volta ${volta}: o horário do envio não muda`)
    assert.equal(c.selo, 'tudo_certo')
    // e nada interno vaza no estado geral
    const st = await verEstado(cookie)
    assert.equal(JSON.stringify(st).includes('"auditoriaIA"'), false, `volta ${volta}: sem auditoria no estado`)
    assert.equal(JSON.stringify(st).includes('"envioPendente"'), false, `volta ${volta}: sem contexto interno no estado`)
    assert.equal(JSON.stringify(st).includes('"checklist"'), false, `volta ${volta}: sem checklist no estado`)
  }
})

test('queda DEPOIS da gravação final: o reinício não altera nem duplica o ciclo já concluído', async () => {
  await matar()
  const ctx = preparar('qa6', { lojaId: 'loja2', modo: 'automatico', aprovado: false })
  const antes = envios().length
  const primeiro = await subir({ ATENDO_TESTE_QUEDA: 'depois' })
  const fim = await Promise.race([morreu(primeiro.processo), esperar(25_000).then(() => null)])
  assert.ok(fim, 'o servidor deveria cair'); assert.equal(fim.code, 9, 'queda depois da gravação final')
  assert.equal(envios().length, antes + 1, 'um único e-mail')
  const salvo = estadoSalvo().tickets.find(x => x.id === 'qa6')
  assert.equal(salvo.atendimentoNovo.conclusaoPendente.status, 'concluida', 'o estado final já estava gravado')
  const eventosAntes = salvo.auditoriaIA.map(e => e.tipo + ':' + (e.chave ?? ''))
  assert.ok(eventosAntes.some(x => x.startsWith('email_enviado')), 'o email_enviado já estava gravado')

  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.equal(envios().length, antes + 1, 'nenhum reenvio')
  const cookie = await entrar()
  const c = await verAuditoria(cookie, 'qa6')
  assert.deepEqual(c.eventos.map(e => e.tipo + ':' + (e.chave ?? '')), eventosAntes, 'o reinício não mexeu em nada')
  assert.equal(c.eventos.filter(e => e.tipo === 'email_enviado').length, 1)
  assert.equal(c.eventos.filter(e => e.tipo === 'fase_confirmada').length, 1)
  assert.equal(c.selo, 'tudo_certo', 'selo: ' + c.selo)
  const enviado = c.eventos.find(e => e.tipo === 'email_enviado')
  assert.equal(enviado.dados.origemEnvio, 'automatico')
  assert.equal(enviado.dados.reconciliado ?? false, false, 'o envio normal não é marcado como reconciliado')
  assert.equal(enviado.dados.tentativaId, ctx.tentativa)
  const st = await verEstado(cookie)
  const t = st.tickets.find(x => x.id === 'qa6')
  assert.equal(t.status, 'enviado'); assert.equal(t.enviaEm, undefined)
  assert.equal(t.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1, 'uma transição')
  assert.equal(st.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-qa6').length, 1, 'uma linha')
  assert.equal(t.respostaMensagemId, ctx.mensagemId)
  await esperar(6500)
  assert.equal(envios().length, antes + 1, 'o agendador não reenviou')
})
