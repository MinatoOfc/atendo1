// Recuperação de envios interrompidos × Auditoria da IA. O canal envia o e-mail e o
// servidor CAI antes da gravação final e antes de registrar email_enviado. No reinício,
// a reconciliação precisa reconstruir a PROVA completa (evento, fase confirmada,
// encerramento, metadados da resposta, vínculo exato e origem real) usando o CONTEXTO
// gravado antes do envio — nunca a configuração de então. Cada servidor roda num
// PROCESSO FILHO de verdade. Nenhuma loja real é ativada e nenhuma mensagem real sai.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
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
  // loja1 EXIGE aprovação: o dono aprova e o agendador só envia na cadência
  loja({ id: 'loja1', nome: 'Loja Aprovação', novoEnvioAutomatico: false, exigirAprovacaoAceiteNovo: true }),
  // loja2 é a única com envio realmente automático (só no ensaio)
  loja({ id: 'loja2', nome: 'Loja Automática', novoEnvioAutomatico: true, exigirAprovacaoAceiteNovo: false }),
]
// um cliente e um pedido POR cenário: conversas distintas nunca se fundem
const CENARIOS = { qa1: 'loja1', qa2: 'loja2', qa3: 'loja1', qa4: 'loja1', qa5: 'loja1', qa6: 'loja2' }
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
const envios = () => (existsSync(ENVIOS) ? readFileSync(ENVIOS, 'utf8').split('\n').filter(Boolean) : [])
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
function preparar(id, { lojaId = 'loja1', modo = 'manual', aprovado = true, agendado = true } = {}) {
  const salvo = estadoSalvo()
  const ciclo = `ciclo-${id}`
  const tentativa = `tent-${id}`
  const evento = (tipo, extra = {}) => novoEvento({
    tipo, ticketId: id, lojaId, em: '2026-09-01T10:00:00.000Z', resumo: extra.resumo ?? tipo,
    situacao: extra.situacao ?? 'informativo', chave: `${tipo}:${id}:semente`,
    dados: { cicloId: ciclo, ...(extra.dados ?? {}) },
  })
  const cp = {
    id: `ev-${id}`, ticketId: id, faseAceita: 'reemb_40', tipo: 'reembolso', jornada: 'qualidade', modo,
    ofertaAceita: { tipo: 'reembolso', pct: 40, cupom: null, prazo: null, semDevolucao: true },
    aceitaEm: '2026-09-01T10:00:00.000Z', percentual: 40, valor: 40, valorPedido: 100, moeda: 'EUR', cupom: null,
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
    rascunho: CONF, geradoPorIA: true,
    ...(agendado ? { enviaEm: Date.now() - 1000 } : {}),
    cicloAuditoria: ciclo,
    auditoriaIA: [
      evento('cliente_recebido', { resumo: 'Mensagem do cliente (Ok, 40%.)' }),
      evento('cliente_aceitou', { situacao: 'ok', resumo: 'Cliente aceitou: Reembolso de 40%', dados: { fase: 'reemb_40' } }),
      evento('rascunho_gerado', { dados: { tentativaId: tentativa, fase: 'conf_reembolso' } }),
    ],
    atendimentoNovo: {
      versao: 1, fluxo: 'qualidade', etapa: 'reemb_40', produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true,
      motivo: 'qualidade', historicoEtapas: hist(['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40']),
      transicaoPendente: { para: 'conf_reembolso', mensagem: 'ok', faltando: [] }, aguardando: 'envio', acaoAceita: 'reemb_40',
      idioma: 'de', rascunhoGerado: CONF, rascunhoIdioma: 'de', tentativaAtual: tentativa,
      conclusaoPendente: cp,
    },
  }
  salvo.tickets = [t, ...(salvo.tickets ?? []).filter(x => x.id !== id)]
  writeFileSync(arquivo, JSON.stringify(salvo))
  return { ciclo, tentativa, mensagemId: cp.mensagemConfirmacaoId }
}

/** Sobe o servidor programado para cair depois do canal e antes da gravação final. */
async function cairDepoisDoCanal(extra = {}) {
  const primeiro = await subir({ ATENDO_TESTE_QUEDA: 'antes', ...extra })
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
  assert.equal(t.envioPendente, undefined, 'contexto pendente limpo depois da gravação final')

  // /api/state continua sem expor a auditoria
  assert.equal(t.auditoriaIA, undefined, '/api/state nunca traz auditoriaIA')
  assert.equal(JSON.stringify(st).includes('"auditoriaIA"'), false)
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
  const restantes = envios().filter(x => x !== ctx.mensagemId)
  writeFileSync(ENVIOS, restantes.map(x => x + '\n').join(''))
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
  assert.equal(t.envioPendente.mensagemId, ctx.mensagemId, 'contexto preservado para a conferência manual')
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
