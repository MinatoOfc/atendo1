// Janela crítica do envio da confirmação automática: o canal confirma o envio e o
// servidor CAI antes de gravar "concluida" e a linha do relatório. No reinício, a
// confirmação nunca pode sair de novo. Cada servidor roda num PROCESSO FILHO de
// verdade (o primeiro morre com process.exit no ponto exato), os dois usam o mesmo
// DATA_DIR e o mesmo registro durável de envios, e o Message-ID é estável.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-queda-'))
const ENVIOS = path.join(DIR, 'envios.log')
const PORTA = 8795
const base = `http://localhost:${PORTA}`

/* ---------- estado salvo: aceite de 40% com conclusão AUTOMÁTICA pronta para sair ---------- */
const { hashSenha } = await import('../server/auth.js')
const { novoEstado } = await import('../server/db.js')
const estado = novoEstado()
estado.config.automacaoAtiva = true
estado.config.atrasoMinutos = 0.05
const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
estado.lojas = [{
  id: 'loja1', nome: 'Loja Queda', ativa: true, moeda: 'EUR', idioma: 'de',
  modoAtendimento: 'novo', novoAtivadoEm: '2026-07-01T00:00:00.000Z', novoEnvioAutomatico: true,
  exigirAprovacaoAceiteNovo: false, cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 },
}]
estado.pedidos = [{ id: 'p1', numero: '#1', cliente: 'Cliente 1', email: 'c1@web.de', pais: 'Germany', valor: 100, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId: 'loja1', itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }] }]
const hist = ids => ids.map((para, i) => ({ de: ids[i - 1] ?? null, para, mensagem: 'x', em: new Date(Date.parse('2026-09-01T10:00:00Z') + i * 3600e3).toISOString() }))
const CONF = 'Hallo! Wir haben die Rückerstattung von 40% (40,00 €) veranlasst. Das Geld ist in 3 bis 14 Tagen wieder da.'
estado.tickets = [{
  id: 'q1', nome: 'C1', de: 'c1@web.de', assunto: 'Bestellung #1', corpo: 'Ok, 40%.', data: '2026-09-01T10:00:00.000Z',
  lido: true, origem: 'cliente', categoria: 'reembolso', status: 'aprovacao', idioma: 'de', lojaId: 'loja1', historico: [],
  motor: 'novo', motorAtendimento: 'novo', primeiroEmailEm: '2026-09-01T10:00:00.000Z',
  rascunho: CONF, geradoPorIA: true, enviaEm: Date.now() - 1000, // vencido: o agendador pega na primeira volta
  atendimentoNovo: {
    versao: 1, fluxo: 'qualidade', etapa: 'reemb_40', produtosAfetados: ['Polo Premium (Schwarz / L)'], produtosInformados: true,
    motivo: 'qualidade', historicoEtapas: hist(['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40']),
    transicaoPendente: { para: 'conf_reembolso', mensagem: 'ok', faltando: [] }, aguardando: 'envio', acaoAceita: 'reemb_40',
    idioma: 'de', rascunhoGerado: CONF, rascunhoIdioma: 'de',
    conclusaoPendente: {
      id: 'ev-q1', ticketId: 'q1', faseAceita: 'reemb_40', tipo: 'reembolso', jornada: 'qualidade', modo: 'automatico',
      aceitaEm: '2026-09-01T10:00:00.000Z', percentual: 40, valor: 40, valorPedido: 100, moeda: 'EUR', cupom: null,
      produtos: ['Polo Premium (Schwarz / L)'], endereco: null, historicoFases: ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40'],
      status: 'aguardando_cadencia',
    },
  },
}]
writeFileSync(path.join(DIR, 'ws-queda.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-queda-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'queda@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-queda-1234'), workspaceId: 'queda' }],
  sessoes: [],
}))

const ambiente = extra => ({
  ...process.env, DATA_DIR: DIR, PORT: String(PORTA), ANTHROPIC_API_KEY: 'sk-ant-teste',
  ATENDO_SIMULAR: '1', ATENDO_SMTP_FAKE: 'ok', ATENDO_TESTE_ENVIOS: ENVIOS,
  DATABASE_URL: '', ATENDO_LIBERAR_AUTOENVIO: '1',
  EMAIL_USER: 'loja1@teste.local', EMAIL_PASS: 'senha-falsa', EMAIL_IMAP_HOST: 'imap.invalido.test', EMAIL_SMTP_HOST: 'smtp.invalido.test',
  ...extra,
})
const estadoSalvo = () => JSON.parse(readFileSync(path.join(DIR, 'ws-queda.json'), 'utf8'))
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
after(() => { try { filho?.kill() } catch {} ; try { rmSync(DIR, { recursive: true, force: true }) } catch {} })

const entrar = async () => {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'queda@teste.local', senha: 'senha-queda-1234' }) })
  assert.equal(login.status, 200)
  return login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}
const verTicket = async (cookie, id = 'q1') => {
  const st = await fetch(base + '/api/state', { headers: { cookie } }).then(r => r.json())
  return { st: st.state, t: st.state.tickets.find(x => x.id === id) }
}
/** Reinicia o estado salvo com uma conclusão automática pronta para a confirmação sair. */
const prepararAceitePendente = (id, extras = {}) => {
  const salvo = estadoSalvo()
  const t0 = salvo.tickets.find(x => x.id === 'q1')
  const cp = t0.atendimentoNovo.conclusaoPendente
  cp.id = id; cp.mensagemConfirmacaoId = `atendo-${id}`; cp.status = 'aguardando_cadencia'; cp.modo = 'automatico'
  delete cp.confirmadaEm; delete cp.faseConfirmada; delete cp.relatorioAutomaticoProibido; delete cp.modoOriginal; delete cp.interrompidaEm; delete cp.motivoInterrupcao; delete cp.envioIniciadoEm
  t0.atendimentoNovo.etapa = 'reemb_40'
  t0.atendimentoNovo.historicoEtapas = t0.atendimentoNovo.historicoEtapas.filter(h => h.para !== 'conf_reembolso' && !h.evento)
  t0.atendimentoNovo.transicaoPendente = { para: 'conf_reembolso', mensagem: 'ok', faltando: [] }
  t0.atendimentoNovo.aguardando = 'envio'
  t0.status = 'aprovacao'; t0.rascunho = CONF; t0.enviaEm = Date.now() - 1000
  delete t0.relatorioAuto; delete t0.relatorioDia; delete t0.relatorioTexto; delete t0.resposta; delete t0.respondidoEm; delete t0.motivoEscalada
  Object.assign(salvo, extras.estado ?? {})
  writeFileSync(path.join(DIR, 'ws-queda.json'), JSON.stringify(salvo))
  return salvo
}

test('queda no meio do envio da confirmação: o e-mail sai uma vez só, nenhuma segunda confirmação, nenhuma segunda linha e o caso é reconciliado no reinício', async () => {
  // 1) servidor sobe programado para MORRER logo depois de o canal confirmar o envio, antes de gravar
  const primeiro = await subir({ ATENDO_TESTE_QUEDA: 'antes' })
  const fim = await Promise.race([morreu(primeiro.processo), esperar(25_000).then(() => null)])
  assert.ok(fim, 'o servidor deveria cair no ponto de teste'); assert.equal(fim.code, 7, 'queda proposital no ponto exato')
  assert.match(primeiro.saida(), /queda proposital depois do envio, antes da gravação/)
  // o e-mail SAIU (o canal confirmou) e o estado salvo ficou em "enviando", com o Message-ID estável
  assert.deepEqual(envios(), ['atendo-ev-q1'], 'exatamente um e-mail enviado, com Message-ID estável')
  const salvo = estadoSalvo().tickets.find(t => t.id === 'q1')
  assert.equal(salvo.atendimentoNovo.conclusaoPendente.status, 'enviando', 'gravado ANTES do envio')
  assert.equal(salvo.atendimentoNovo.conclusaoPendente.mensagemConfirmacaoId, 'atendo-ev-q1')
  assert.equal(salvo.atendimentoNovo.etapa, 'reemb_40', 'a fase não avançou'); assert.equal(salvo.relatorioAuto, undefined, 'nenhuma linha no relatório ainda')

  // 2) reinício: a conclusão em "enviando" NUNCA é reenviada cegamente — o Message-ID é conferido
  const segundo = await subir({})
  filho = segundo.processo
  await esperar(2500)
  assert.deepEqual(envios(), ['atendo-ev-q1'], 'nenhum segundo e-mail')
  assert.match(segundo.saida(), /confirmação já estava na caixa de enviados — fechada sem reenviar/)
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'queda@teste.local', senha: 'senha-queda-1234' }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const st = await fetch(base + '/api/state', { headers: { cookie } }).then(r => r.json())
  const t = st.state.tickets.find(x => x.id === 'q1')
  // reconciliado sem reenviar: uma confirmação, uma linha, tudo preservado
  assert.equal(t.atendimentoNovo.conclusaoPendente.status, 'concluida')
  assert.equal(t.atendimentoNovo.etapa, 'conf_reembolso')
  assert.equal(t.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1, 'uma única transição de confirmação')
  assert.equal(t.status, 'enviado'); assert.equal(t.enviaEm, undefined)
  assert.equal(t.relatorioAuto.eventoId, 'ev-q1'); assert.equal(t.relatorioAuto.mensagemConfirmacaoId, 'atendo-ev-q1')
  assert.equal(t.relatorioAuto.percentual, 40); assert.equal(t.relatorioAuto.valor, 40); assert.equal(t.relatorioAuto.moeda, 'EUR')
  assert.equal(st.state.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-q1').length, 1, 'exatamente uma linha no relatório')
  // o agendador continua rodando: nada duplica depois
  await esperar(6500)
  const st2 = await fetch(base + '/api/state', { headers: { cookie } }).then(r => r.json())
  const t2 = st2.state.tickets.find(x => x.id === 'q1')
  assert.deepEqual(envios(), ['atendo-ev-q1'], 'o agendador não reenviou')
  assert.equal(t2.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1)
  assert.equal(st2.state.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-q1').length, 1)
})

test('queda no envio SEM comprovação (a mensagem não está na caixa de enviados): vai ao dono, sem reenviar e sem relatório', async () => {
  // mata o servidor do teste anterior e prepara um novo aceite, já em "enviando", cujo e-mail nunca saiu
  try { filho?.kill() } catch {}
  await esperar(1500)
  const salvo = estadoSalvo()
  const t = salvo.tickets.find(x => x.id === 'q1')
  const cp = t.atendimentoNovo.conclusaoPendente
  cp.id = 'ev-q2'; cp.mensagemConfirmacaoId = 'atendo-ev-q2'; cp.status = 'enviando'; delete cp.confirmadaEm; delete cp.faseConfirmada
  t.atendimentoNovo.etapa = 'reemb_40'
  t.atendimentoNovo.historicoEtapas = t.atendimentoNovo.historicoEtapas.filter(h => h.para !== 'conf_reembolso')
  t.atendimentoNovo.transicaoPendente = { para: 'conf_reembolso', mensagem: 'ok', faltando: [] }
  t.atendimentoNovo.aguardando = 'envio'
  t.status = 'aprovacao'; t.rascunho = CONF; delete t.relatorioAuto; delete t.relatorioDia; delete t.relatorioTexto; delete t.resposta
  writeFileSync(path.join(DIR, 'ws-queda.json'), JSON.stringify(salvo))
  const antes = envios().length

  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.match(servidor.saida(), /envio interrompido — com o dono \(não saiu\)/)
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'queda@teste.local', senha: 'senha-queda-1234' }) })
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const st = await fetch(base + '/api/state', { headers: { cookie } }).then(r => r.json())
  const q = st.state.tickets.find(x => x.id === 'q1')
  assert.equal(q.status, 'humano', 'vai para o dono')
  assert.match(q.motivoEscalada, /servidor foi interrompido durante o envio da confirmação/i)
  assert.equal(q.atendimentoNovo.conclusaoPendente.status, 'interrompida')
  assert.equal(q.atendimentoNovo.etapa, 'reemb_40', 'a fase não avançou')
  assert.equal(q.relatorioAuto, undefined, 'nenhum relatório sem comprovação do envio')
  assert.equal(q.enviaEm, undefined, 'sem reenvio automático')
  assert.deepEqual(q.atendimentoNovo.conclusaoPendente.faseAceita, 'reemb_40'); assert.equal(q.atendimentoNovo.conclusaoPendente.valor, 40, 'dados da solução preservados')
  await esperar(6500)
  assert.equal(envios().length, antes, 'nenhum e-mail novo, nem pelo agendador')
})

test('falha da gravação crítica ANTES do envio: nenhum e-mail, fase intacta, nenhum relatório e o motivo do erro visível', async () => {
  try { filho?.kill() } catch {}
  await esperar(1200)
  prepararAceitePendente('ev-q3')
  const antes = envios().length
  // DATA_DIR só de leitura para o servidor: a gravação crítica falha e o envio precisa abortar
  const servidor = await subir({ ATENDO_TESTE_FALHA_GRAVACAO: '1' })
  filho = servidor.processo
  await esperar(7000)
  assert.equal(envios().length, antes, 'nenhum e-mail com a persistência falhando')
  const cookie = await entrar()
  const { t: q } = await verTicket(cookie)
  assert.equal(q.atendimentoNovo.etapa, 'reemb_40', 'a fase não avançou')
  assert.equal(q.relatorioAuto, undefined, 'nenhum relatório'); assert.equal(q.relatorioDia, undefined)
  assert.equal(q.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 0, 'nenhuma transição de confirmação')
  assert.match(servidor.saida(), /gravação crítica falhou|Confirmação não enviada/, 'o motivo do erro de persistência aparece')
})

test('queda DEPOIS da gravação final e antes do retorno: o ticket já nasce enviado no reinício, sem reenviar e sem nada em Aprovações', async () => {
  try { filho?.kill() } catch {}
  await esperar(1200)
  prepararAceitePendente('ev-q4')
  const antes = envios().length
  const primeiro = await subir({ ATENDO_TESTE_QUEDA: 'depois' })
  const fim = await Promise.race([morreu(primeiro.processo), esperar(25_000).then(() => null)])
  assert.ok(fim, 'o servidor deveria cair'); assert.equal(fim.code, 9, 'queda depois da gravação final')
  assert.equal(envios().length, antes + 1, 'um único e-mail')
  // o estado final completo já estava persistido: enviado, sem agendamento, com a linha do relatório
  const salvo = estadoSalvo().tickets.find(x => x.id === 'q1')
  assert.equal(salvo.status, 'enviado'); assert.equal(salvo.enviaEm, undefined)
  assert.equal(salvo.atendimentoNovo.etapa, 'conf_reembolso'); assert.equal(salvo.atendimentoNovo.conclusaoPendente.status, 'concluida')
  assert.equal(salvo.relatorioAuto.eventoId, 'ev-q4')
  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  const cookie = await entrar()
  const { st, t: q } = await verTicket(cookie)
  assert.equal(q.status, 'enviado', 'nada em Aprovações'); assert.equal(q.enviaEm, undefined)
  assert.equal(q.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1, 'uma transição')
  assert.equal(st.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-q4').length, 1, 'uma linha')
  await esperar(6500)
  assert.equal(envios().length, antes + 1, 'nenhum reenvio pelo agendador')
})

test('estado legado (conclusão concluída mas ticket ainda em aprovação com agendamento): o arranque fecha sem reenviar, sem segunda transição e sem segunda linha', async () => {
  try { filho?.kill() } catch {}
  await esperar(1200)
  const salvo = estadoSalvo()
  const t0 = salvo.tickets.find(x => x.id === 'q1')
  // simula a gravação meio feita da versão antiga: conclusão e relatório gravados, ticket não
  t0.status = 'aprovacao'; t0.enviaEm = Date.now() - 1000; t0.rascunho = CONF; delete t0.resposta; delete t0.respondidoEm
  t0.atendimentoNovo.transicaoPendente = { para: 'conf_reembolso', mensagem: 'ok', faltando: [] }
  writeFileSync(path.join(DIR, 'ws-queda.json'), JSON.stringify(salvo))
  const antes = envios().length
  const servidor = await subir({})
  filho = servidor.processo
  await esperar(2500)
  assert.match(servidor.saida(), /confirmação\(ões\) meio gravada\(s\) fechada\(s\) sem reenviar/)
  assert.equal(envios().length, antes, 'nenhum reenvio')
  const cookie = await entrar()
  const { st, t: q } = await verTicket(cookie)
  assert.equal(q.status, 'enviado'); assert.equal(q.enviaEm, undefined); assert.equal(q.atendimentoNovo.transicaoPendente, null)
  assert.equal(q.atendimentoNovo.historicoEtapas.filter(h => h.para === 'conf_reembolso').length, 1, 'nenhuma segunda transição')
  assert.equal(st.tickets.filter(x => x.relatorioAuto?.eventoId === 'ev-q4').length, 1, 'nenhuma segunda linha')
  await esperar(6500)
  assert.equal(envios().length, antes, 'o agendador também não reenviou')
})
