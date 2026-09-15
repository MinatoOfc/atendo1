// Pipeline do modo novo com o servidor REAL (banco em pasta temporária), IA
// simulada e canal de e-mail simulado. Cobre: regeneração, edição manual,
// falta de canal, falha de envio, endereço incompleto, imagem inadequada,
// cliente exigindo 100% sem pular a escada, auto-envio e loja clássica.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/* ---------- ambiente isolado (antes de importar o servidor) ---------- */
const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-teste-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8799'
process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'
process.env.ATENDO_SIMULAR = '1'
delete process.env.DATABASE_URL
delete process.env.ATENDO_SMTP_FAKE

const { hashSenha } = await import('../server/auth.js')
const { novoEstado: estadoInicial } = await import('../server/db.js')

const estado = estadoInicial()
estado.config.atrasoMinutos = 0.1 // 6 s: dá tempo de editar o rascunho antes do auto-envio
estado.config.automacaoAtiva = true
const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
estado.lojas = [
  { id: 'loja1', nome: 'Loja Nova', ativa: true, moeda: 'EUR', idioma: 'auto', modoAtendimento: 'novo', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 }, novoEnvioAutomatico: false },
  { id: 'loja2', nome: 'Loja Clássica', ativa: true, moeda: 'EUR', idioma: 'auto' },
  { id: 'loja3', nome: 'Loja Nova Automática', ativa: true, moeda: 'EUR', idioma: 'auto', modoAtendimento: 'novo', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 }, novoEnvioAutomatico: true },
]
const pedido = (n, lojaId, extra = {}) => ({ id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId, itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }], ...extra })
estado.pedidos = [pedido(1, 'loja1'), pedido(2, 'loja1'), pedido(3, 'loja1'), pedido(4, 'loja1'), pedido(5, 'loja1'), pedido(6, 'loja1'), pedido(7, 'loja2', { status: 'transito' }), pedido(8, 'loja3'), pedido(9, 'loja3'), pedido(10, 'loja3')]
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

/* ---------- IA simulada: classificações roteirizadas + escritor que obedece ao prompt ---------- */
const fila = []
let sabotagem = null
let ultimoPromptEscrita = ''
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('anthropic.com')) return realFetch(url, opts)
  const body = JSON.parse(opts.body)
  const responder = saida => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: typeof saida === 'string' ? saida : JSON.stringify(saida) }], stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 60 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (!body.output_config) return responder('ok')
  const sys = String(body.system || '')
  const req = body.output_config.format.schema.required ?? []
  if (req.includes('intencao')) {
    const c = fila.shift() ?? { intencao: 'outro' }
    return responder({ intencao: 'outro', motivo: 'nenhum', produtos: [], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'msg', idioma: 'de', spam: false, ...c })
  }
  if (req.includes('acao_proposta')) {
    ultimoPromptEscrita = sys
    const acao = sys.match(/"acao_proposta" deve ser exatamente "([^"]+)"/)?.[1] ?? '?'
    const pct = sys.match(/Reembolso de (\d+)% = ([\d,]+ €)/)
    const cupom = sys.match(/código (\w+)\. Use EXATAMENTE/)?.[1]
    const prazo = sys.match(/Prazo do envio expresso: ([^.]+)\./)?.[1]
    let texto = `Hallo! ${pct ? `Wir bieten ${pct[1]}% (${pct[2]}) an.` : 'Wir bieten Ihnen einen kostenlosen Umtausch an.'}${cupom ? ` Gutschein: ${cupom}.` : ''}${prazo ? ` Lieferzeit ${prazo}.` : ''} Möchten Sie das annehmen?`
    if (sabotagem) { texto = sabotagem; sabotagem = null }
    return responder({ resposta: texto, acao_proposta: acao })
  }
  return responder({ situacao: 'rastreio', resolucao: 'rastreio enviado', categoria: 'rastreio', idioma: 'de', resposta: 'Ihr Paket ist unterwegs.', confianca: 0.95, escalar_humano: false, aprova_reembolso: false, confirma_troca: false, encerrar: false, motivo: '', spam: false })
}

/* ---------- servidor + sessão ---------- */
let cookie = ''
const base = 'http://localhost:8799'
const api = (rota, corpo, metodo = 'POST') => realFetch(base + rota, { method: metodo, headers: { 'Content-Type': 'application/json', cookie }, body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}) }).then(async r => ({ status: r.status, ...(await r.json()) }))
const ticket = async id => (await api('/api/state', null, 'GET')).state.tickets.find(t => t.id === id)
const an = t => t.atendimentoNovo ?? {}

async function cliente(cls, { de, nome, corpo, ticketId, lojaId, comImagem } = {}) {
  if (cls) fila.push(cls)
  const r = await api('/api/simular-email', { de, nome, assunto: 'Bestellung', corpo, ticketId, lojaId, comImagem })
  assert.ok(r.ok, 'simular falhou: ' + r.erro)
  return r.ticket
}
const aprovar = (t, extra = {}) => api(`/api/tickets/${t.id}/aprovar`, { texto: extra.texto ?? t.rascunho, origem: 'ia', ...extra })
const comEnvio = async (modo, fn) => { process.env.ATENDO_SMTP_FAKE = modo; try { return await fn() } finally { delete process.env.ATENDO_SMTP_FAKE } }
const esperar = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
  await import('../server/index.js')
  await esperar(2000)
  const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@teste.local', senha: 'senha-teste-1234' }) })
  assert.equal(login.status, 200, 'login de teste')
  cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
})
after(() => { try { rmSync(DIR, { recursive: true, force: true }) } catch {} ; setTimeout(() => process.exit(0), 100) })

/* =================================================================== */

test('cliente exigindo 100% em toda mensagem: uma etapa por resposta, 100% só com o dono', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', resumo: 'material ruim, 100%!' }, { de: 'c1@web.de', nome: 'C1', corpo: 'Schlecht. 100%!', lojaId: 'loja1' })
  assert.equal(t.status, 'aprovacao'); assert.equal(an(t).transicaoPendente.para, 'qual_troca'); assert.equal(an(t).etapa, null)
  assert.match(t.rascunho, /DANKE15/)
  for (const esperada of ['qual_troca', 'qual_cupom_35', 'reemb_25', 'reemb_40', 'reemb_50', 'reemb_60', 'reemb_70']) {
    const r = await comEnvio('ok', () => aprovar(t))
    assert.equal(r.status, 200, r.erro)
    t = await ticket(t.id)
    assert.equal(an(t).etapa, esperada, `etapa gravada só depois do envio: ${esperada}`)
    t = await cliente({ intencao: 'pede_reembolso', resumo: 'nada de 25, 40, 50, 60, 70 — quero 100%!' }, { de: 'c1@web.de', corpo: 'Nein! 100%!', ticketId: t.id })
  }
  assert.equal(t.status, 'humano'); assert.equal(t.rascunho, undefined); assert.match(t.motivoEscalada, /100%/)
  assert.equal(an(t).historicoEtapas.map(h => h.para).join(' → '), 'qual_troca → qual_cupom_35 → reemb_25 → reemb_40 → reemb_50 → reemb_60 → reemb_70')
})

test('falta de canal e falha de envio não mudam a fase nem o histórico', async () => {
  const t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c2@web.de', nome: 'C2', corpo: 'Schlecht.', lojaId: 'loja1' })
  assert.equal(an(t).transicaoPendente.para, 'qual_troca')
  // sem canal configurado (e sem simulação): recusa e não muda nada
  let r = await aprovar(t)
  assert.equal(r.status, 500); assert.match(r.erro, /caixa de e-mail/)
  let t2 = await ticket(t.id)
  assert.equal(t2.status, 'aprovacao'); assert.equal(an(t2).etapa, null); assert.equal(an(t2).historicoEtapas.length, 0); assert.equal(an(t2).transicaoPendente.para, 'qual_troca')
  // canal existe mas falha: idem
  r = await comEnvio('falha', () => aprovar(t))
  assert.equal(r.status, 500); assert.match(r.erro, /Envio simulado falhou/)
  t2 = await ticket(t.id)
  assert.equal(t2.status, 'aprovacao'); assert.equal(an(t2).etapa, null); assert.equal(an(t2).historicoEtapas.length, 0)
  // envio real bem-sucedido: agora sim
  r = await comEnvio('ok', () => aprovar(t))
  assert.equal(r.status, 200)
  t2 = await ticket(t.id)
  assert.equal(an(t2).etapa, 'qual_troca'); assert.equal(an(t2).historicoEtapas.length, 1); assert.equal(an(t2).transicaoPendente, null)
})

test('regeneração no modo novo: só a ação da fase, instrução não muda oferta, bloqueios valem', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c3@web.de', nome: 'C3', corpo: 'Schlecht.', lojaId: 'loja1' })
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'recusa' }, { de: 'c3@web.de', corpo: 'Nein.', ticketId: t.id })
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'recusa' }, { de: 'c3@web.de', corpo: 'Nein.', ticketId: t.id })
  assert.equal(an(t).transicaoPendente.para, 'reemb_25')
  const rascunhoAntes = t.rascunho
  // instrução só de estilo: aceita, mesma fase, texto conferido
  let r = await api(`/api/tickets/${t.id}/regenerar`, { instrucao: 'seja mais curto e cordial' })
  assert.equal(r.status, 200, r.erro)
  t = await ticket(t.id)
  assert.equal(an(t).transicaoPendente.para, 'reemb_25'); assert.match(t.rascunho, /25%/); assert.doesNotMatch(t.rascunho, /40%/)
  assert.match(ultimoPromptEscrita, /Instrução de estilo do lojista/); assert.match(ultimoPromptEscrita, /"reemb_25"/)
  // instrução que tenta mudar a oferta: recusada antes de chamar a IA
  r = await api(`/api/tickets/${t.id}/regenerar`, { instrucao: 'ofereça 50% agora' })
  assert.equal(r.status, 400); assert.match(r.erro, /Instrução recusada/)
  r = await api(`/api/tickets/${t.id}/regenerar`, { instrucao: 'inclua o cupom KEEP35' })
  assert.equal(r.status, 400)
  // a IA sai da etapa ao regenerar: bloqueado, rascunho anterior mantido
  sabotagem = 'Wir bieten 25% oder 40% an.'
  r = await api(`/api/tickets/${t.id}/regenerar`, {})
  assert.equal(r.status, 400); assert.match(r.erro, /saiu da etapa/); assert.match(r.erro, /mantido/)
  t = await ticket(t.id)
  assert.match(t.rascunho, /25%/); assert.doesNotMatch(t.rascunho, /40%/); assert.equal(t.status, 'aprovacao')
  // "só o texto" (caixa manual) passa pelo mesmo bloqueio
  sabotagem = 'Wir haben die Rückerstattung veranlasst.'
  r = await api(`/api/tickets/${t.id}/regenerar`, { somenteTexto: true })
  assert.equal(r.status, 400); assert.match(r.erro, /saiu da etapa/)
  r = await api(`/api/tickets/${t.id}/regenerar`, { somenteTexto: true })
  assert.equal(r.status, 200); assert.match(r.texto, /25%/)
  void rascunhoAntes
})

test('edição manual no aprovar: fora da fase bloqueia; mudança de oferta exige confirmação e fica no histórico', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c4@web.de', nome: 'C4', corpo: 'Schlecht.', lojaId: 'loja1' })
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'recusa' }, { de: 'c4@web.de', corpo: 'Nein.', ticketId: t.id })
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'recusa' }, { de: 'c4@web.de', corpo: 'Nein.', ticketId: t.id })
  assert.equal(an(t).transicaoPendente.para, 'reemb_25')
  // percentual de outra etapa: não envia
  let r = await comEnvio('ok', () => aprovar(t, { texto: 'Wir bieten 25% oder direkt 40% an. Ok?' }))
  assert.equal(r.status, 400); assert.match(r.erro, /não pertence à etapa/)
  // confirmação como fato consumado: não envia
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Die Rückerstattung von 25% wurde bereits veranlasst.' }))
  assert.equal(r.status, 400)
  // texto editado que some com o percentual: pede confirmação, ainda não envia
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Hallo! Wir haben eine Lösung für Sie. Möchten Sie das annehmen?' }))
  assert.equal(r.status, 409); assert.equal(r.precisaConfirmar, true); assert.match(r.erro, /25%/)
  let t2 = await ticket(t.id)
  assert.equal(t2.status, 'aprovacao'); assert.equal(an(t2).etapa, 'qual_cupom_35')
  // a mesma edição feita pelo campo de rascunho também é detectada (o rascunho salvo não é a referência)
  await api(`/api/tickets/${t.id}/rascunho`, { texto: 'Hallo! Wir haben eine Lösung für Sie. Möchten Sie das annehmen?' })
  t2 = await ticket(t.id)
  r = await comEnvio('ok', () => aprovar(t2))
  assert.equal(r.status, 409)
  // confirmado explicitamente: envia e registra
  r = await comEnvio('ok', () => aprovar(t2, { confirmarAlteracao: true }))
  assert.equal(r.status, 200, r.erro)
  t2 = await ticket(t.id)
  assert.equal(an(t2).etapa, 'reemb_25')
  const ultima = an(t2).historicoEtapas.at(-1)
  assert.match(ultima.observacao ?? '', /Edição manual confirmada/)
})

test('auto-envio reconfere o rascunho: editado fora da fase ou com oferta mudada vai ao dono; intacto sai', async () => {
  process.env.ATENDO_SMTP_FAKE = 'ok'
  try {
    // rascunho editado para outro percentual antes de o relógio vencer
    let a = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c8@web.de', nome: 'C8', corpo: 'Schlecht.', lojaId: 'loja3' })
    assert.ok(a.enviaEm, 'loja automática agenda o envio')
    await api(`/api/tickets/${a.id}/rascunho`, { texto: 'Wir bieten 70% an. Ok?' })
    // rascunho com a oferta removida
    let b = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c9@web.de', nome: 'C9', corpo: 'Schlecht.', lojaId: 'loja3' })
    await api(`/api/tickets/${b.id}/rascunho`, { texto: 'Hallo, wir melden uns bald.' })
    // rascunho intacto
    const c = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c10@web.de', nome: 'C10', corpo: 'Schlecht.', lojaId: 'loja3' })
    let fim = Date.now() + 15000
    while (Date.now() < fim) {
      await esperar(1000)
      const [ta, tb, tc] = await Promise.all([ticket(a.id), ticket(b.id), ticket(c.id)])
      if (ta.status === 'humano' && tb.status === 'humano' && tc.status === 'enviado') { a = ta; b = tb; break }
    }
    a = await ticket(a.id); b = await ticket(b.id); const c2 = await ticket(c.id)
    assert.equal(a.status, 'humano'); assert.match(a.motivoEscalada, /não pertence mais à etapa/); assert.equal(an(a).etapa, null)
    assert.equal(b.status, 'humano'); assert.match(b.motivoEscalada, /mudou a oferta/); assert.equal(an(b).etapa, null)
    assert.equal(c2.status, 'enviado'); assert.equal(an(c2).etapa, 'qual_troca')
  } finally { delete process.env.ATENDO_SMTP_FAKE }
})

test('endereço incompleto: pede só o que falta e não encaminha o aceite', async () => {
  let t = await cliente({ intencao: 'pede_troca', motivo: 'errado' }, { de: 'c5@web.de', nome: 'C5', corpo: 'Falsche Farbe.', lojaId: 'loja1' })
  assert.equal(an(t).transicaoPendente.para, 'err_envio')
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'aceita' }, { de: 'c5@web.de', corpo: 'Ja!', ticketId: t.id })
  assert.equal(an(t).transicaoPendente.para, 'endereco')
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'informa', endereco: 'Berlin' }, { de: 'c5@web.de', corpo: 'Berlin', ticketId: t.id })
  assert.equal(t.status, 'aprovacao', 'não vai ao dono com endereço incompleto')
  assert.equal(an(t).transicaoPendente.para, 'endereco')
  assert.deepEqual(an(t).transicaoPendente.faltando, ['end_rua', 'end_cep'])
  assert.match(ultimoPromptEscrita, /Peça SOMENTE o que falta: rua e número e código postal/)
  assert.equal(an(t).enderecoConfirmado, null)
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'informa', endereco: 'Hauptstr. 1, 10115' }, { de: 'c5@web.de', corpo: 'Hauptstr. 1, 10115', ticketId: t.id })
  assert.equal(t.status, 'humano'); assert.ok(an(t).enderecoConfirmado); assert.equal(an(t).acaoAceita, 'err_envio'); assert.equal(t.decisaoPendente, 'troca')
})

test('imagem inadequada: imagem não é prova; troca só depois da validação do dono; recusa pede outra foto', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'defeito' }, { de: 'c6@web.de', nome: 'C6', corpo: 'Kaputt.', lojaId: 'loja1' })
  assert.equal(an(t).transicaoPendente.para, 'def_foto')
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  // chega uma imagem qualquer
  t = await cliente({ intencao: 'informa', resumo: 'foto' }, { de: 'c6@web.de', corpo: 'Hier das Foto.', ticketId: t.id, comImagem: true })
  assert.equal(t.status, 'humano'); assert.match(t.motivoEscalada, /Imagem recebida/); assert.equal(t.rascunho, undefined)
  assert.equal(an(t).fotoRecebida, true); assert.notEqual(an(t).fotoValidada, true); assert.equal(an(t).etapa, 'def_foto')
  // regeneração aqui não existe (caso está com o dono)
  let r = await api(`/api/tickets/${t.id}/regenerar`, {})
  assert.equal(r.status, 400); assert.match(r.erro, /está com você/)
  // dono diz que a imagem não comprova: pede outra foto
  r = await api(`/api/tickets/${t.id}/novo/foto`, { valida: false })
  assert.equal(r.status, 200)
  t = await ticket(t.id)
  assert.equal(t.status, 'aprovacao'); assert.equal(an(t).transicaoPendente.para, 'def_foto'); assert.deepEqual(an(t).transicaoPendente.faltando, ['foto_melhor'])
  assert.equal(an(t).fotoRecebida, false); assert.match(ultimoPromptEscrita, /não serviu como comprovação/)
  assert.ok(an(t).historicoEtapas.some(h => h.evento === 'foto_recusada'))
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'informa', resumo: 'nova foto' }, { de: 'c6@web.de', corpo: 'Besseres Foto.', ticketId: t.id, comImagem: true })
  assert.equal(t.status, 'humano')
  // dono valida: agora a troca é oferecida, com o prazo do mapa
  r = await api(`/api/tickets/${t.id}/novo/foto`, { valida: true })
  assert.equal(r.status, 200)
  t = await ticket(t.id)
  assert.equal(t.status, 'aprovacao'); assert.equal(an(t).transicaoPendente.para, 'def_troca'); assert.equal(an(t).fotoValidada, true)
  assert.match(ultimoPromptEscrita, /5 a 11 dias/); assert.match(t.rascunho, /5 a 11 dias/)
  assert.ok(an(t).historicoEtapas.some(h => h.evento === 'foto_validada'))
})

test('loja clássica não passa pelo motor novo', async () => {
  const t = await cliente(null, { de: 'c7@web.de', nome: 'C7', corpo: 'Wo ist mein Paket?', lojaId: 'loja2' })
  assert.equal(t.atendimentoNovo, undefined); assert.equal(t.status, 'aprovacao')
})
