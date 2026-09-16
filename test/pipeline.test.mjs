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
// contas de e-mail configuradas (a sincronização é desligada com ATENDO_SIMULAR e o
// envio passa pelo canal simulado — nada toca a rede): loja1, loja2 e loja3 têm; loja4 NÃO
for (const [suf, nome] of [['', 'loja1'], ['2', 'loja2'], ['3', 'loja3'], ['6', 'loja6']]) {
  process.env[`EMAIL${suf}_USER`] = `${nome}@teste.local`; process.env[`EMAIL${suf}_PASS`] = 'senha-falsa'
  process.env[`EMAIL${suf}_IMAP_HOST`] = 'imap.invalido.test'; process.env[`EMAIL${suf}_SMTP_HOST`] = 'smtp.invalido.test'
}
for (const k of Object.keys(process.env)) if (/^EMAIL4_/.test(k)) delete process.env[k]
delete process.env.RESEND_API_KEY

const { hashSenha } = await import('../server/auth.js')
const { novoEstado: estadoInicial } = await import('../server/db.js')

const estado = estadoInicial()
estado.config.atrasoMinutos = 0.1 // 6 s: dá tempo de editar o rascunho antes do auto-envio
estado.config.automacaoAtiva = true
const CUPONS = { 15: 'DANKE15', 25: 'SORRY25', 30: 'BACK30', 35: 'KEEP35', 40: 'WAIT40' }
estado.lojas = [
  { id: 'loja1', nome: 'Loja Nova', ativa: true, moeda: 'EUR', idioma: 'de', modoAtendimento: 'novo', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 }, novoEnvioAutomatico: false },
  { id: 'loja2', nome: 'Loja Clássica', ativa: true, moeda: 'EUR', idioma: 'auto' },
  { id: 'loja3', nome: 'Loja Nova Automática', ativa: true, moeda: 'EUR', idioma: 'auto', modoAtendimento: 'novo', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 }, novoEnvioAutomatico: true },
  { id: 'loja4', nome: 'Loja Nova Sem Email', ativa: true, moeda: 'USD', idioma: 'auto', modoAtendimento: 'novo', cupons: CUPONS, prazoEntrega: { min: 5, max: 12, processamento: 3 }, novoEnvioAutomatico: false },
  { id: 'loja5', nome: 'Loja Só Prazo', ativa: true, moeda: 'EUR', idioma: 'auto', prazoEntrega: { min: 5, max: 12, processamento: 3 } }, // sem e-mail, sem cupons
  { id: 'loja6', nome: 'Loja Alternância', ativa: true, moeda: 'EUR', idioma: 'auto' }, // clássica, com e-mail; prazo e cupons chegam depois
]
const pedido = (n, lojaId, extra = {}) => ({ id: 'p' + n, numero: '#' + n, cliente: 'Cliente ' + n, email: `c${n}@web.de`, pais: 'Germany', valor: 100, status: 'entregue', criadoEm: '2026-08-20', despachadoEm: '2026-08-22', lojaId, itens: [{ titulo: 'Polo Premium', variante: 'Schwarz / L', quantidade: 1, preco: 100 }], ...extra })
estado.pedidos = [pedido(1, 'loja1'), pedido(2, 'loja1'), pedido(3, 'loja1'), pedido(4, 'loja1'), pedido(5, 'loja1'), pedido(6, 'loja1'), pedido(7, 'loja2', { status: 'transito' }), pedido(8, 'loja3'), pedido(9, 'loja3'), pedido(10, 'loja3'), pedido(11, 'loja1'), pedido(12, 'loja1'), pedido(13, 'loja1'), pedido(14, 'loja1'), pedido(15, 'loja4'), pedido(16, 'loja1'), pedido(17, 'loja1', { pais: 'Netherlands' }), pedido(18, 'loja1', { pais: 'Belgium' }), pedido(19, 'loja1', { pais: 'Belgium' }), pedido(20, 'loja1', { pais: 'Austria' }), pedido(21, 'loja1', { pais: 'Austria' }), pedido(22, 'loja1'), pedido(23, 'loja1'), pedido(24, 'loja1', { pais: 'Netherlands' }), pedido(25, 'loja3', { pais: 'Netherlands' }), pedido(26, 'loja1', { pais: 'Netherlands' }), pedido(27, 'loja1', { pais: 'Netherlands' }), pedido(31, 'loja6'), pedido(32, 'loja6'), pedido(33, 'loja6'), pedido(34, 'loja6')]
// blocos da conversa "no limite" (h908): início ≈ 900 caracteres, fim ≈ 2.600, com a oferta final e a última resposta no extremo
const encher = (prefixo, tamanho) => (prefixo + ' ' + 'wort '.repeat(400)).slice(0, tamanho).trim()
const LIMITE = {
  inicio1: encher('Die Qualität ist schlecht, ich will mein Geld zurück.', 380),
  inicio2: encher('Nein, 25% ist zu wenig.', 400),
  penultimoCliente: encher('Ich bin immer noch nicht zufrieden und erwarte ein besseres Angebot.', 500),
  ultimaOferta: 'Als letztes Angebot: 70% Rückerstattung, Sie behalten das Produkt. ' + encher('Begründung:', 1100),
  mensagemAtual: encher('Ja, 70% nehme ich an, bitte veranlassen.', 600),
  ultimaResposta: 'Erledigt: 70% werden in 3 bis 14 Tagen erstattet. Vielen Dank!',
}
const antigo = (id, extra) => ({ id, nome: 'Antigo ' + id, de: `${id}@web.de`, assunto: 'Bestellung #' + id.replace(/\D/g, ''), corpo: 'Hallo', data: '2026-07-01T10:00:00.000Z', lido: true, origem: 'cliente', status: 'enviado', idioma: 'de', lojaId: 'loja2', historico: [], ...extra })
estado.tickets = [
  antigo('h901', { categoria: 'troca', corpo: 'Das Polo ist zu klein, ich möchte umtauschen.', historico: [{ autor: 'atendo', corpo: 'Wir tauschen es gratis gegen Größe L um.', data: '2026-07-01T12:00:00.000Z' }], resposta: 'Wir tauschen es gratis gegen Größe L um.' }),
  antigo('h902', { categoria: 'reembolso', corpo: 'Schlechte Qualität, ich will mein Geld zurück.', historico: [{ autor: 'atendo', corpo: 'Wir bieten 60% Rückerstattung an.', data: '2026-07-02T12:00:00.000Z' }, { autor: 'cliente', corpo: 'Ok, 60%.', data: '2026-07-02T13:00:00.000Z' }], resposta: 'Erledigt.' }),
  antigo('h903', { categoria: 'entrega', corpo: 'Wo ist mein Paket?' }),
  antigo('h904', { categoria: 'rastreio', corpo: 'Tracking bitte.' }), // não é caso
  antigo('h905', { categoria: 'reembolso', relatorioDia: '2026-07-10', relatorioTexto: 'REEMBOLSO 100%', corpo: 'Geld zurück bitte.' }), // já tem relatório: fora do lote
  // conversa NO LIMITE: início ≈ 900, fim ≈ 2.600, última resposta relevante no extremo final
  antigo('h908', { categoria: 'reembolso', corpo: LIMITE.mensagemAtual, historico: [
    { autor: 'cliente', corpo: LIMITE.inicio1, data: '2026-07-06T10:00:00.000Z' },
    { autor: 'atendo', corpo: 'Wir bieten 25% Rückerstattung an.', data: '2026-07-06T11:00:00.000Z' },
    { autor: 'cliente', corpo: LIMITE.inicio2, data: '2026-07-06T12:00:00.000Z' },
    ...Array.from({ length: 6 }, (_, i) => ({ autor: i % 2 ? 'atendo' : 'cliente', corpo: 'Zwischennachricht ' + (i + 1) + ' ' + 'blabla '.repeat(90), data: `2026-07-07T${String(10 + i).padStart(2, '0')}:00:00.000Z` })),
    { autor: 'cliente', corpo: LIMITE.penultimoCliente, data: '2026-07-08T09:00:00.000Z' },
    { autor: 'atendo', corpo: LIMITE.ultimaOferta, data: '2026-07-08T10:00:00.000Z' },
  ], resposta: LIMITE.ultimaResposta }),
  antigo('h906', { categoria: 'reembolso', status: 'aprovacao', atendimentoNovo: { versao: 1, fluxo: null, etapa: null, historicoEtapas: [], produtosAfetados: [] }, corpo: 'Geld zurück.' }), // modo novo em coleta: nunca
  // conversa LONGA (> 3.500 caracteres): 25% no começo, 60% perto do fim
  antigo('h907', { categoria: 'reembolso', corpo: 'Ja, 60% ist ok.', historico: [
    { autor: 'cliente', corpo: 'Die Qualität ist schlecht, ich will mein Geld zurück.', data: '2026-07-03T10:00:00.000Z' },
    { autor: 'atendo', corpo: 'Wir bieten 25% Rückerstattung an.', data: '2026-07-03T11:00:00.000Z' },
    ...Array.from({ length: 12 }, (_, i) => ({ autor: i % 2 ? 'atendo' : 'cliente', corpo: (i % 2 ? 'Wir verstehen Sie. ' : 'Das reicht mir nicht. ') + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.', data: `2026-07-04T${String(10 + i).padStart(2, '0')}:00:00.000Z` })),
    { autor: 'atendo', corpo: 'Als letztes Angebot: 60% Rückerstattung, Sie behalten das Produkt.', data: '2026-07-05T10:00:00.000Z' },
  ], resposta: 'Erledigt, 60% werden erstattet.' }),
]
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(estado))
writeFileSync(path.join(DIR, 'auth.json'), JSON.stringify({
  segredo: 'segredo-de-teste-'.padEnd(64, 'x'),
  usuarios: [{ id: 'u1', email: 'teste@teste.local', nome: 'Teste', senhaHash: await hashSenha('senha-teste-1234'), workspaceId: 'teste' }],
  sessoes: [],
}))

/* ---------- IA simulada: classificações roteirizadas + escritor que obedece ao prompt ---------- */
const fila = []
let sabotagem = null
// sabotagem de idioma: { idioma, vezes } — o escritor responde nesse idioma por N chamadas
let idiomaSabotado = null
let ultimoPromptInferencia = ''
// frases do escritor simulado por idioma (o bloqueio positivo exige a ação nomeada no idioma do cliente)
const FRASES = {
  de: { ola: 'Hallo!', troca: 'Wir bieten Ihnen einen kostenlosen Umtausch an.', reenvio: 'Wir senden das Paket erneut.', reembolso: p => `Wir bieten eine Rückerstattung von ${p[1]}% (${p[2]}) an.`, reembolsoSem: 'Wir bieten eine Rückerstattung an.', cupom: c => `Gutschein: ${c}.`, cupomSem: 'Wir bieten einen Gutschein an.', cancel: 'Die Bestellung wird storniert.', frete: f => `Die Rücksendung würde ca. ${f} kosten.`, dinheiro: 'Das Geld ist in 3 bis 14 Tagen wieder da.', prazo: p => `Lieferzeit ${p}.`, pergunta: 'Möchten Sie das annehmen?' },
  nl: { ola: 'Hallo!', troca: 'Wij bieden u graag een gratis omruil aan.', reenvio: 'Wij verzenden het pakket opnieuw.', reembolso: p => `Wij bieden een terugbetaling van ${p[1]}% (${p[2]}) aan.`, reembolsoSem: 'Wij bieden een terugbetaling aan.', cupom: c => `Kortingscode: ${c}.`, cupomSem: 'Wij bieden een kortingscode aan.', cancel: 'De bestelling wordt geannuleerd.', frete: f => `De retourzending kost ongeveer ${f}.`, dinheiro: 'Het geld is binnen 3 tot 14 dagen terug.', prazo: p => `Levertijd ${p}.`, pergunta: 'Wilt u dit aanvaarden?' },
  fr: { ola: 'Bonjour !', troca: 'Nous vous proposons un échange gratuit.', reenvio: 'Nous renvoyons le colis.', reembolso: p => `Nous vous proposons un remboursement de ${p[1]}% (${p[2]}).`, reembolsoSem: 'Nous vous proposons un remboursement.', cupom: c => `Code coupon : ${c}.`, cupomSem: 'Nous vous proposons un coupon.', cancel: 'La commande est annulée.', frete: f => `Le retour coûterait environ ${f}.`, dinheiro: "L'argent revient sous 3 à 14 jours.", prazo: p => `Délai ${p}.`, pergunta: 'Acceptez-vous ?' },
  en: { ola: 'Hello!', troca: 'We can offer you a free exchange.', reenvio: 'We will resend the parcel.', reembolso: p => `We offer a refund of ${p[1]}% (${p[2]}).`, reembolsoSem: 'We offer a refund.', cupom: c => `Coupon: ${c}.`, cupomSem: 'We offer a coupon.', cancel: 'The order is cancelled.', frete: f => `The return would cost about ${f}.`, dinheiro: 'The money is back within 3 to 14 days.', prazo: p => `Delivery ${p}.`, pergunta: 'Do you accept?' },
}
let ultimoPromptEscrita = ''
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('anthropic.com')) return realFetch(url, opts)
  const body = JSON.parse(opts.body)
  const responder = saida => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: typeof saida === 'string' ? saida : JSON.stringify(saida) }], stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 60 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (!body.output_config) return responder('ok')
  const sys = String(body.system || '')
  const req = body.output_config.format.schema.required ?? []
  if (req.includes('inferencias')) {
    const user = String(body.messages?.[0]?.content || '')
    ultimoPromptInferencia = user
    const casos = user.split(/\[caso \d+\]/).slice(1)
    // a última porcentagem que aparece no trecho enviado é a oferta mais recente
    return responder({ inferencias: casos.map(c => {
      if (/zu klein|umtausch/i.test(c)) return { jornada: 'tamanho', fase: 'tam_troca', desfecho: 'troca', percentual: 0, motivo: 'Cliente disse que ficou pequeno', categoria: 'tamanho', produtos: ['Polo'], confianca: 0.9 }
      const pcts = [...c.matchAll(/(\d{2,3})%/g)].map(m => Number(m[1]))
      if (pcts.length) { const p = pcts.at(-1); return { jornada: 'qualidade', fase: `reemb_${p}`, desfecho: 'reembolso', percentual: p, motivo: 'Cliente não gostou da qualidade', categoria: 'qualidade', produtos: [], confianca: 0.85 } }
      return { jornada: 'nao_recebido', fase: '', desfecho: 'em_aberto', percentual: 0, motivo: 'não informado', categoria: 'nao_recebeu', produtos: [], confianca: 0.4 }
    }) })
  }
  if (req.includes('intencao')) {
    const c = fila.shift() ?? { intencao: 'outro' }
    return responder({ intencao: 'outro', motivo: 'nenhum', produtos: [], ajustes: [], situacaoEntrega: 'nenhuma', endereco: '', resumo: 'msg', idioma: 'de', idiomaConfiavel: true, spam: false, ...c })
  }
  if (req.includes('acao_proposta')) {
    ultimoPromptEscrita = sys
    const acao = sys.match(/"acao_proposta" deve ser exatamente "([^"]+)"/)?.[1] ?? '?'
    const pct = sys.match(/Reembolso de (\d+)% = ([\d,]+ €)/)
    const cup = sys.match(/Cupom de (\d+)%: código (\w+)\. Use EXATAMENTE/)
    const cupom = cup ? `${cup[2]} (${cup[1]}%)` : null
    const frete = sys.match(/Frete de devolução estimado: ([\d,]+ €)/)?.[1]
    const prazoDinheiro = /3 a 14 dias/.test(sys)
    const prazo = sys.match(/Prazo do envio expresso: ([^.]+)\./)?.[1]
    const titulo = sys.match(/AÇÃO DESTA RESPOSTA — ([^\n]+):/)?.[1] ?? ''
    const aceita = sys.match(/Opção aceita pelo cliente e aprovada pelo lojista: ([^\n]+)/)?.[1] ?? ''
    // na confirmação, as ações vêm SÓ da opção aceita (o título genérico diz "troca/reenvio")
    const alvo = (aceita || titulo).toLowerCase()
    // idioma: o alvo vem do prompt ("código \"nl\""); a sabotagem escreve em outro idioma por N chamadas
    const alvoIdioma = sys.match(/OBRIGATORIAMENTE em [^(]+\(código "(\w+)"\)/)?.[1] ?? 'de'
    let idiomaUsado = alvoIdioma
    if (idiomaSabotado && idiomaSabotado.vezes > 0) { idiomaUsado = idiomaSabotado.idioma; idiomaSabotado.vezes-- }
    const F = FRASES[idiomaUsado] ?? FRASES.de
    const frases = []
    if (/troca/.test(alvo)) frases.push(F.troca)
    if (/reenvio|enviar/.test(alvo)) frases.push(F.reenvio)
    if (/reembolso/.test(alvo) || pct) frases.push(pct ? F.reembolso(pct) : F.reembolsoSem)
    if (/cupom/.test(alvo) || cupom) frases.push(cupom ? F.cupom(cupom) : F.cupomSem)
    if (/cancel/.test(alvo)) frases.push(F.cancel)
    if (frete) frases.push(F.frete(frete))
    // fases sem oferta: o escritor simulado diz o que o mapa manda (o bloqueio exige)
    if (/número do pedido/.test(sys)) frases.push('Bitte nennen Sie Ihre Bestellnummer.')
    if (/quais produtos/.test(sys)) frases.push('Welchen Artikel meinen Sie?')
    if (/o motivo da devolução/.test(sys)) frases.push('Was ist der Grund?')
    if (/pequeno ou grande/i.test(sys)) frases.push(idiomaUsado === 'nl' ? 'Was het te klein of te groot?' : 'Ist es zu klein oder zu groß?')
    if (/rua e número/.test(sys)) frases.push('Bitte Straße und Hausnummer.')
    if (/código postal/.test(sys)) frases.push('Bitte die Postleitzahl.')
    if (/: cidade|e cidade/.test(sys)) frases.push('Bitte die Stadt.')
    if (/Pedir foto do defeito|outra foto/.test(sys)) frases.push('Bitte senden Sie ein Foto des Schadens.')
    if (/Confirmar endereço completo/.test(titulo) && !/Peça SOMENTE/.test(sys)) frases.push(idiomaUsado === 'nl' ? 'Stuur alstublieft uw volledige adres (straat, huisnummer, postcode, plaats).' : 'Bitte senden Sie Ihre vollständige Adresse (Straße, Hausnummer, PLZ, Stadt).')
    if (/Diga claramente que o pedido está DENTRO/.test(sys)) frases.push(`Ihre Bestellung ist innerhalb der Lieferzeit, voraussichtlich am ${sys.match(/Data provável de recebimento: (\d{4}-\d{2}-\d{2})/)?.[1]} .`)
    if (/aguarde mais 2 dias/.test(sys)) frases.push('Bitte warten Sie noch 2 Tage und fragen Sie bei Nachbarn oder der Rezeption nach.')
    if (/5 dias úteis/.test(sys)) frases.push('Bitte noch maximal 5 Werktage Geduld.')
    const endConf = sys.match(/Endereço de entrega confirmado: ([^\n]+?)\.\n/)?.[1]
    if (endConf) frases.push(`${idiomaUsado === 'nl' ? 'Bezorgadres' : idiomaUsado === 'fr' ? 'Adresse de livraison' : idiomaUsado === 'en' ? 'Delivery address' : 'Lieferadresse'}: ${endConf}.`)
    if (prazoDinheiro) frases.push(F.dinheiro)
    if (!frases.length) frases.push('Wir melden uns.')
    let texto = `${F.ola} ${frases.join(' ')}${prazo ? ` ${F.prazo(prazo)}` : ''} ${F.pergunta}`
    if (sabotagem) { texto = sabotagem; sabotagem = null }
    return responder({ resposta: texto, acao_proposta: acao, idioma: idiomaUsado })
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
after(async () => {
  const servidor = await import('../server/index.js')
  await servidor.encerrar()
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

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

test('loja sem e-mail não envia pela conta de outra loja; falta de canal e falha de envio não mudam a fase nem o histórico', async () => {
  // loja4 (modo novo) não tem conta; loja1, loja2 e loja3 têm — mesmo assim nada sai
  const t4 = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c15@web.de', nome: 'C15', corpo: 'Bad.', lojaId: 'loja4' })
  assert.equal(an(t4).transicaoPendente.para, 'qual_troca')
  let r = await comEnvio('ok', () => aprovar(t4))
  assert.equal(r.status, 500); assert.match(r.erro, /própria loja/); assert.match(r.erro, /caixa de e-mail/)
  let t2 = await ticket(t4.id)
  assert.equal(t2.status, 'aprovacao'); assert.equal(an(t2).etapa, null); assert.equal(an(t2).historicoEtapas.length, 0); assert.equal(an(t2).transicaoPendente.para, 'qual_troca')
  r = await aprovar(t4)
  assert.equal(r.status, 500, 'sem simulação também não')
  // loja1 tem conta própria: falha de envio não muda nada; sucesso muda
  const t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c2@web.de', nome: 'C2', corpo: 'Schlecht.', lojaId: 'loja1' })
  assert.equal(an(t).transicaoPendente.para, 'qual_troca')
  // canal existe mas falha: nada muda
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
  // texto editado que some com o percentual: bloqueio positivo (percentual obrigatório ausente)
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Hallo! Wir haben eine Lösung für Sie. Möchten Sie das annehmen?' }))
  assert.equal(r.status, 400); assert.match(r.erro, /percentual obrigatório/)
  let t2 = await ticket(t.id)
  assert.equal(t2.status, 'aprovacao'); assert.equal(an(t2).etapa, 'qual_cupom_35')
  // a mesma edição feita pelo campo de rascunho também é barrada no aprovar (o rascunho salvo não é a referência)
  await api(`/api/tickets/${t.id}/rascunho`, { texto: 'Hallo! Wir haben eine Lösung für Sie. Möchten Sie das annehmen?' })
  t2 = await ticket(t.id)
  r = await comEnvio('ok', () => aprovar(t2))
  assert.equal(r.status, 400)
  // valor em dinheiro diferente do cálculo do servidor (25% de 100 = 25,00): não envia
  r = await comEnvio('ok', () => aprovar(t2, { texto: 'Wir bieten eine Rückerstattung von 25% (30,00 €) an. Ok?' }))
  assert.equal(r.status, 400); assert.match(r.erro, /não corresponde ao cálculo/)
  // percentual certo mas SEM o valor em dinheiro: não envia
  r = await comEnvio('ok', () => aprovar(t2, { texto: 'Wir bieten eine Rückerstattung von 25% an. Ok?' }))
  assert.equal(r.status, 400); assert.match(r.erro, /falta o valor em dinheiro/)
  // cupom inventado: não envia
  r = await comEnvio('ok', () => aprovar(t2, { texto: 'Wir bieten eine Rückerstattung von 25% (25,00 €) an, plus Gutschein: FAKE99. Ok?' }))
  assert.equal(r.status, 400); assert.match(r.erro, /não está cadastrado/)
  // edição que mantém tudo da etapa (só o tom muda): envia
  r = await comEnvio('ok', () => aprovar(t2, { texto: 'Hallo! Wir bieten Ihnen eine Rückerstattung von 25% (25,00 €) an — Sie behalten das Produkt. Einverstanden?' }))
  assert.equal(r.status, 200, r.erro)
  t2 = await ticket(t.id)
  assert.equal(an(t2).etapa, 'reemb_25')
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
    // cliente holandês cujo rascunho foi trocado por um texto em alemão (mesma etapa, mesmos números)
    let d = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'nl' }, { de: 'c25@web.de', nome: 'C25', corpo: 'De kwaliteit is slecht, ik wil mijn geld terug.', lojaId: 'loja3' })
    assert.equal(an(d).idioma, 'nl'); assert.match(d.rascunho, /omruil/)
    await api(`/api/tickets/${d.id}/rascunho`, { texto: 'Hallo! Wir bieten Ihnen einen kostenlosen Umtausch an. Gutschein: DANKE15 (15%). Lieferzeit 4 a 11 dias. Möchten Sie das annehmen?' })
    let fim = Date.now() + 15000
    while (Date.now() < fim) {
      await esperar(1000)
      const [ta, tb, tc, td] = await Promise.all([ticket(a.id), ticket(b.id), ticket(c.id), ticket(d.id)])
      if (ta.status === 'humano' && tb.status === 'humano' && tc.status === 'enviado' && td.status === 'humano') { a = ta; b = tb; break }
    }
    a = await ticket(a.id); b = await ticket(b.id); const c2 = await ticket(c.id); d = await ticket(d.id)
    assert.equal(a.status, 'humano'); assert.match(a.motivoEscalada, /não pertence mais à etapa/); assert.equal(an(a).etapa, null)
    assert.equal(b.status, 'humano'); assert.match(b.motivoEscalada, /não pertence mais à etapa|mudou a oferta/); assert.equal(an(b).etapa, null)
    assert.equal(c2.status, 'enviado'); assert.equal(an(c2).etapa, 'qual_troca')
    assert.equal(d.status, 'humano'); assert.match(d.motivoEscalada, /idioma errado/); assert.equal(an(d).etapa, null, 'auto-envio no idioma errado não sai nem avança')
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

test('aceite aprovado pelo dono: a confirmação nasce só do clique, com os números da opção aceita, e encerra o caso', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c11@web.de', nome: 'C11', corpo: 'Schlecht.', lojaId: 'loja1' })
  let r = await api(`/api/tickets/${t.id}/novo/confirmar`)
  assert.equal(r.status, 400, 'sem aceite não há confirmação')
  for (const cls of [null, { intencao: 'recusa' }, { intencao: 'recusa' }]) {
    if (cls) t = await cliente(cls, { de: 'c11@web.de', corpo: 'Nein.', ticketId: t.id })
    r = await comEnvio('ok', () => aprovar(t)); assert.equal(r.status, 200, r.erro); t = await ticket(t.id)
  }
  assert.equal(an(t).etapa, 'reemb_25')
  t = await cliente({ intencao: 'aceita' }, { de: 'c11@web.de', corpo: 'Ok, 25%.', ticketId: t.id })
  assert.equal(t.status, 'humano'); assert.equal(an(t).acaoAceita, 'reemb_25'); assert.equal(t.rascunho, undefined, 'nada é escrito antes do clique do dono')
  r = await api(`/api/tickets/${t.id}/novo/confirmar`)
  assert.equal(r.status, 200, r.erro)
  t = await ticket(t.id)
  assert.equal(t.status, 'aprovacao'); assert.equal(an(t).transicaoPendente.para, 'conf_reembolso'); assert.match(t.rascunho, /25%/)
  assert.match(ultimoPromptEscrita, /CONFIRMAÇÃO/); assert.match(ultimoPromptEscrita, /3 a 14 dias/)
  // outro percentual continua barrado, mesmo na confirmação
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Rückerstattung von 40% veranlasst.' }))
  assert.equal(r.status, 400); assert.match(r.erro, /40%/)
  // confirmação sem o prazo de 3 a 14 dias: não envia
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Ihre Rückerstattung von 25% (25,00 €) wurde veranlasst.' }))
  assert.equal(r.status, 400); assert.match(r.erro, /3 a 14 dias/)
  // antes de a confirmação sair, a Central mostra aceite pendente e NADA reembolsado de fato
  let c = await api('/api/central?busca=C11', null, 'GET')
  assert.equal(c.registros.length, 1); assert.equal(c.registros[0].situacaoReembolso, 'aceite_pendente')
  assert.equal(c.indicadores[0].aceitesPendentes, 1); assert.equal(c.indicadores[0].reembolsadoEfetivo, 0)
  // fato consumado é permitido AQUI
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Ihre Rückerstattung von 25% (25,00 €) wurde veranlasst — 3 bis 14 Tage.' }))
  assert.equal(r.status, 200, r.erro)
  t = await ticket(t.id)
  assert.equal(t.status, 'enviado'); assert.equal(an(t).etapa, 'conf_reembolso'); assert.equal(an(t).aguardando, null)
  assert.ok(an(t).historicoEtapas.some(h => h.evento === 'aceite_aprovado'))
  // a confirmação ENVIADA (fase conf_reembolso no histórico) é o que efetiva o reembolso na Central
  c = await api('/api/central?busca=C11', null, 'GET')
  assert.equal(c.registros[0].situacaoReembolso, 'efetivado'); assert.equal(c.registros[0].confirmacaoEnviada, 'conf_reembolso')
  assert.equal(c.indicadores[0].reembolsadoEfetivo, 25); assert.equal(c.indicadores[0].aceitesPendentes, 0)
  // mensagem nova depois da confirmação vai ao dono, sem reabrir a escada
  t = await cliente({ intencao: 'informa', resumo: 'e agora?' }, { de: 'c11@web.de', corpo: 'Und jetzt?', ticketId: t.id })
  assert.equal(t.status, 'humano'); assert.match(t.motivoEscalada, /confirmad/); assert.equal(an(t).etapa, 'conf_reembolso')
})

test('rota de foto recusada fora do fluxo de defeito (imagem em caso de qualidade não abre validação)', async () => {
  const t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c13@web.de', nome: 'C13', corpo: 'Schlecht, siehe Foto.', lojaId: 'loja1', comImagem: true })
  assert.equal(an(t).fluxo, 'qualidade'); assert.equal(an(t).transicaoPendente.para, 'qual_troca', 'segue a jornada normal')
  assert.notEqual(an(t).aguardandoComprovacao, true)
  for (const valida of [true, false]) {
    const r = await api(`/api/tickets/${t.id}/novo/foto`, { valida })
    assert.equal(r.status, 400); assert.match(r.erro, /fluxo de defeito/)
  }
  const t2 = await ticket(t.id)
  assert.equal(t2.status, 'aprovacao'); assert.equal(an(t2).transicaoPendente.para, 'qual_troca'); assert.equal(an(t2).fotoValidada, null)
})

test('correção manual na Central guarda histórico de auditoria e não toca no motor', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c12@web.de', nome: 'C12', corpo: 'Schlecht.', lojaId: 'loja1' })
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'recusa' }, { de: 'c12@web.de', corpo: 'Nein.', ticketId: t.id })
  const antes = { etapa: an(t).etapa, pendente: an(t).transicaoPendente.para, rascunho: t.rascunho }
  let r = await api(`/api/tickets/${t.id}/central/fase`, { fase: 'reemb_40', jornada: 'qualidade', justificativa: 'cliente já tinha 40% combinado' })
  assert.equal(r.status, 200, r.erro)
  r = await api(`/api/tickets/${t.id}/central/fase`, { fase: 'reemb_50', jornada: 'tamanho', justificativa: 'era 50' })
  assert.equal(r.status, 200)
  r = await api(`/api/tickets/${t.id}/central/fase`, { remover: true, justificativa: 'engano' })
  assert.equal(r.status, 200)
  r = await api(`/api/tickets/${t.id}/central/fase`, { remover: true })
  assert.equal(r.status, 400, 'nada para remover')
  t = await ticket(t.id)
  assert.equal(t.centralAjuste, undefined)
  const h = t.centralHistorico
  assert.equal(h.length, 3)
  assert.deepEqual([h[0].anterior, h[0].fase, h[0].jornada, h[0].removido, h[0].justificativa], ['qual_troca', 'reemb_40', 'qualidade', false, 'cliente já tinha 40% combinado'])
  assert.deepEqual([h[1].anterior, h[1].anteriorJornada, h[1].fase, h[1].jornada], ['reemb_40', 'qualidade', 'reemb_50', 'tamanho'])
  assert.deepEqual([h[2].removido, h[2].anterior, h[2].fase, h[2].justificativa], [true, 'reemb_50', null, 'engano'])
  for (const e of h) { assert.equal(e.por, 'Teste'); assert.ok(e.em) }
  // motor intocado
  assert.equal(an(t).etapa, antes.etapa); assert.equal(an(t).transicaoPendente.para, antes.pendente); assert.equal(t.rascunho, antes.rascunho)
})

test('Central consolidada no servidor: junção com pedidos sem ticket, dedupe, moedas e filtros', async () => {
  let r = await api('/api/central', null, 'GET')
  assert.equal(r.status, 200)
  const sem = r.linhas.find(l => l.pedidoNumero === '14')
  assert.ok(sem, 'pedido sem conversa está na lista'); assert.equal(sem.atendimento, 'sem atendimento'); assert.equal(sem.faseTitulo, 'sem fase'); assert.equal(sem.registro, null)
  assert.equal(r.linhas.length, r.linhas.filter(l => l.pedidoId).length + r.linhas.filter(l => !l.pedidoId).length)
  const porPedido = new Map(); for (const x of r.registros) if (x.pedidoId) { assert.ok(!porPedido.has(x.pedidoId), 'um registro por pedido'); porPedido.set(x.pedidoId, x) }
  // passaram = pedidos distintos com a fase enviada; nunca conta o rascunho pendente
  const esperado = new Set(r.registros.filter(x => x.trilhaUniao.includes('qual_troca')).map(x => x.chave))
  assert.equal(r.metricas.qual_troca.passaram, esperado.size)
  assert.ok(Object.keys(r.metricas.qual_troca.valorPorMoeda).every(m => m === 'EUR'), 'loja4 (USD) nunca enviou nada')
  assert.equal(r.metricas.qual_troca.valorPorMoeda.USD, undefined)
  r = await api('/api/central?loja=loja4', null, 'GET')
  assert.ok(r.linhas.length >= 1); assert.ok(r.linhas.every(l => l.lojaId === 'loja4')); assert.equal(r.indicadores[0].moeda, 'USD')
  r = await api('/api/central?fase=sem_fase', null, 'GET')
  assert.ok(r.linhas.length >= 1); assert.ok(r.linhas.every(l => !l.registro || l.registro.faseAtual === null), 'sem fase = pedido sem conversa ou conversa ainda na triagem')
  assert.ok(r.linhas.some(l => !l.registro), 'inclui pedido sem conversa')
  r = await api('/api/central?jornada=qualidade&fase=reemb_25&desfecho=reembolso', null, 'GET')
  assert.ok(r.registros.every(x => x.jornada === 'qualidade' && x.faseAtual === 'reemb_25' && x.desfecho === 'reembolso'))
})

test('idioma do cliente manda: holandês com loja fixa em alemão, Bélgica (fr/nl), Áustria (de/en)', async () => {
  // loja1 está configurada "Sempre em alemão" — no modo novo isso é ignorado
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'nl' }, { de: 'c17@web.de', nome: 'C17', corpo: 'De kwaliteit valt tegen, ik wil mijn geld terug.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'nl'); assert.equal(an(t).rascunhoIdioma, 'nl'); assert.match(t.rascunho, /omruil/); assert.doesNotMatch(t.rascunho, /Umtausch/)
  assert.match(ultimoPromptEscrita, /OBRIGATORIAMENTE em holandês \(código "nl"\)/); assert.doesNotMatch(ultimoPromptEscrita, /em alemão/)
  // francês da Bélgica
  t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'fr-BE' }, { de: 'c18@web.de', nome: 'C18', corpo: 'La qualité est décevante, je souhaite un remboursement.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'fr'); assert.equal(an(t).idiomaOriginal, 'fr-BE'); assert.match(t.rascunho, /Bonjour/); assert.match(ultimoPromptEscrita, /código "fr"/)
  // holandês da Bélgica
  t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'nl-BE' }, { de: 'c19@web.de', nome: 'C19', corpo: 'De kwaliteit valt tegen, ik wil mijn geld terug.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'nl'); assert.equal(an(t).idiomaOriginal, 'nl-BE'); assert.match(t.rascunho, /omruil/)
  // Áustria em alemão
  t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'de-AT' }, { de: 'c20@web.de', nome: 'C20', corpo: 'Die Qualität ist schlecht, ich will mein Geld zurück.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'de'); assert.equal(an(t).idiomaOriginal, 'de-AT'); assert.match(t.rascunho, /Umtausch/)
  // Áustria em inglês: o país não decide
  t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'en' }, { de: 'c21@web.de', nome: 'C21', corpo: 'The quality is poor, I would like a refund.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'en'); assert.match(t.rascunho, /exchange/); assert.match(ultimoPromptEscrita, /código "en"/)
})

test('mensagem curta preserva o idioma; mensagem completa em outro idioma troca; confirmação fica no idioma da conversa', async () => {
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'de' }, { de: 'c22@web.de', nome: 'C22', corpo: 'Die Qualität ist schlecht, ich will mein Geld zurück.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'de')
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  // "ok" — mesmo que a classificação diga pt e se diga confiável, o servidor não troca
  t = await cliente({ intencao: 'recusa', idioma: 'pt', idiomaConfiavel: true }, { de: 'c22@web.de', corpo: 'ok', ticketId: t.id })
  assert.equal(an(t).idioma, 'de'); assert.match(t.rascunho, /Gutschein/); assert.match(ultimoPromptEscrita, /código "de"/)
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  // mensagem completa em holandês: acompanha
  t = await cliente({ intencao: 'recusa', idioma: 'nl' }, { de: 'c22@web.de', corpo: 'Nee, dat wil ik niet. Ik wil liever een terugbetaling, geen kortingscode.', ticketId: t.id })
  assert.equal(an(t).idioma, 'nl'); assert.equal(an(t).transicaoPendente.para, 'reemb_25'); assert.match(t.rascunho, /terugbetaling/); assert.match(ultimoPromptEscrita, /código "nl"/)
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  // aceite (curto) → confirmação no idioma da conversa (holandês)
  t = await cliente({ intencao: 'aceita', idioma: 'en', idiomaConfiavel: false }, { de: 'c22@web.de', corpo: 'ok', ticketId: t.id })
  assert.equal(t.status, 'humano'); assert.equal(an(t).idioma, 'nl')
  let r = await api(`/api/tickets/${t.id}/novo/confirmar`)
  assert.equal(r.status, 200, r.erro); t = await ticket(t.id)
  assert.equal(an(t).transicaoPendente.para, 'conf_reembolso'); assert.equal(an(t).rascunhoIdioma, 'nl')
  assert.match(t.rascunho, /terugbetaling/); assert.match(t.rascunho, /3 tot 14 dagen/); assert.match(ultimoPromptEscrita, /código "nl"/)
  // aprovar com texto editado em alemão: bloqueia; no idioma certo: sai
  r = await comEnvio('ok', () => aprovar(t, { texto: 'Ihre Rückerstattung von 25% (25,00 €) wurde veranlasst — das Geld ist in 3 bis 14 Tagen wieder da.' }))
  assert.equal(r.status, 400); assert.match(r.erro, /idioma errado/)
  r = await comEnvio('ok', () => aprovar(t))
  assert.equal(r.status, 200, r.erro); t = await ticket(t.id)
  assert.equal(an(t).etapa, 'conf_reembolso'); assert.equal(t.status, 'enviado')
})

test('endereço marcado pela IA como idiomaConfiavel: true não troca o idioma da conversa (o servidor decide)', async () => {
  let t = await cliente({ intencao: 'pede_troca', motivo: 'errado', idioma: 'nl' }, { de: 'c26@web.de', nome: 'C26', corpo: 'Ik heb de verkeerde kleur ontvangen, graag omruilen.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'nl'); assert.equal(an(t).transicaoPendente.para, 'err_envio')
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'aceita', idioma: 'nl' }, { de: 'c26@web.de', corpo: 'Ja, graag, dat is prima zo.', ticketId: t.id })
  assert.equal(an(t).transicaoPendente.para, 'endereco'); assert.match(t.rascunho, /adres/i)
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  // a IA erra: endereço alemão classificado como idioma "de" e confiável
  const endereco = 'Hauptstraße 5, 10115 Berlin, Deutschland'
  t = await cliente({ intencao: 'informa', idioma: 'de', idiomaConfiavel: true, endereco }, { de: 'c26@web.de', corpo: 'Hauptstraße 5,\n10115 Berlin, Deutschland', ticketId: t.id })
  assert.equal(an(t).idioma, 'nl', 'endereço não troca o idioma'); assert.equal(an(t).idiomaOriginal, 'nl'); assert.equal(an(t).idiomaIncerto, false)
  assert.equal(t.status, 'humano'); assert.ok(an(t).enderecoConfirmado)
  // a confirmação sai em holandês
  const r = await api(`/api/tickets/${t.id}/novo/confirmar`)
  assert.equal(r.status, 200, r.erro); t = await ticket(t.id)
  assert.equal(an(t).transicaoPendente.para, 'conf_troca'); assert.equal(an(t).rascunhoIdioma, 'nl'); assert.match(t.rascunho, /opnieuw|Hallo!/); assert.match(ultimoPromptEscrita, /código "nl"/)
})

test('conversa holandesa muda para alemão com "Polo ist zu klein" (curta, mas com significado)', async () => {
  let t = await cliente({ intencao: 'pede_troca', motivo: 'tamanho', idioma: 'nl' }, { de: 'c27@web.de', nome: 'C27', corpo: 'De maat klopt niet, ik wil graag omruilen.', lojaId: 'loja1' })
  assert.equal(an(t).idioma, 'nl'); assert.equal(an(t).transicaoPendente.para, 'tam_ajuste'); assert.match(t.rascunho, /te klein of te groot/)
  await comEnvio('ok', () => aprovar(t)); t = await ticket(t.id)
  t = await cliente({ intencao: 'informa', idioma: 'de', idiomaConfiavel: true, ajustes: [{ produto: 'Polo Premium (Schwarz / L)', ajuste: 'pequeno' }] }, { de: 'c27@web.de', corpo: 'Polo ist zu klein', ticketId: t.id })
  assert.equal(an(t).idioma, 'de', 'ajuste em alemão troca o idioma'); assert.equal(an(t).idiomaIncerto, false)
  assert.equal(an(t).transicaoPendente.para, 'tam_troca'); assert.match(t.rascunho, /Umtausch/); assert.match(ultimoPromptEscrita, /código "de"/)
})

test('escritor no idioma errado: regenera uma vez; se insistir, vai ao dono sem enviar nem avançar — também na regeneração', async () => {
  // duas chamadas em alemão para um cliente holandês: a regeneração automática não basta
  idiomaSabotado = { idioma: 'de', vezes: 2 }
  let t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'nl' }, { de: 'c23@web.de', nome: 'C23', corpo: 'De kwaliteit valt tegen, ik wil mijn geld terug.', lojaId: 'loja1' })
  assert.equal(t.status, 'humano'); assert.match(t.motivoEscalada, /idioma errado/); assert.equal(t.rascunho, undefined); assert.equal(an(t).etapa, null); assert.equal(an(t).transicaoPendente, null)
  assert.equal(idiomaSabotado.vezes, 0, 'houve exatamente uma regeneração')
  assert.match(ultimoPromptEscrita, /ATENÇÃO: a resposta anterior saiu no idioma errado/)
  // uma chamada errada só: a regeneração com instrução explícita resolve
  idiomaSabotado = { idioma: 'de', vezes: 1 }
  t = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade', idioma: 'nl' }, { de: 'c24@web.de', nome: 'C24', corpo: 'De kwaliteit valt tegen, ik wil mijn geld terug.', lojaId: 'loja1' })
  assert.equal(t.status, 'aprovacao'); assert.match(t.rascunho, /omruil/); assert.equal(an(t).rascunhoIdioma, 'nl')
  // regeneração manual: escritor insistindo em alemão → 400 e rascunho holandês mantido
  idiomaSabotado = { idioma: 'de', vezes: 2 }
  let r = await api(`/api/tickets/${t.id}/regenerar`, {})
  assert.equal(r.status, 400); assert.match(r.erro, /idioma errado/); assert.match(r.erro, /mantido/)
  t = await ticket(t.id); assert.match(t.rascunho, /omruil/); assert.equal(t.status, 'aprovacao')
  idiomaSabotado = { idioma: 'de', vezes: 2 }
  r = await api(`/api/tickets/${t.id}/regenerar`, { somenteTexto: true })
  assert.equal(r.status, 400); assert.match(r.erro, /idioma errado/)
  idiomaSabotado = null
})

test('Parte 8: migração dos casos históricos por clique, em lotes, sem alterar os tickets', async () => {
  const foto = t => JSON.stringify({ status: t.status, categoria: t.categoria, relatorioDia: t.relatorioDia, relatorioTexto: t.relatorioTexto, atendimentoNovo: t.atendimentoNovo, resposta: t.resposta, historico: t.historico })
  const antes = Object.fromEntries((await api('/api/state', null, 'GET')).state.tickets.filter(t => /^h90/.test(t.id)).map(t => [t.id, foto(t)]))
  let st = await api('/api/central/migracao', null, 'GET')
  assert.deepEqual([st.candidatos, st.inferidos, st.pendentes], [5, 0, 5], 'rastreio não é caso; quem tem relatório (h905) e quem está no modo novo (h906) ficam fora; nada inferido ainda')
  // nada acontece sozinho: a Central mostra os casos sem fase
  let c = await api('/api/central?loja=loja2', null, 'GET')
  assert.ok(c.registros.filter(x => /^h90[12378]$/.test(x.ticketId)).every(x => x.faseAtual === null && x.inferidaPor === null), 'candidatos sem fase antes do clique')
  assert.equal(c.registros.find(x => x.ticketId === 'h905').inferidaPor, 'relatorio', 'quem tem relatório já aparece pela linha do relatório')
  // lote de 2
  let r = await api('/api/central/migrar', { limite: 2 })
  assert.equal(r.status, 200, r.erro); assert.equal(r.lidos, 2); assert.equal(r.restantes, 3)
  // lote seguinte pega os pendentes; depois, nada
  r = await api('/api/central/migrar', { limite: 10 }); assert.equal(r.lidos, 3); assert.equal(r.restantes, 0)
  r = await api('/api/central/migrar', { limite: 10 }); assert.equal(r.lidos, 0)
  st = await api('/api/central/migracao', null, 'GET'); assert.deepEqual([st.inferidos, st.pendentes], [5, 0]); assert.equal(st.ultima.lidos, 0)
  // conversa no limite: o texto que CHEGA à chamada da IA respeita o limite e traz o fim inteiro
  const h908 = (await api('/api/state', null, 'GET')).state.tickets.find(t => t.id === 'h908')
  assert.deepEqual([h908.inferenciaCentral.desfecho, h908.inferenciaCentral.percentual, h908.inferenciaCentral.fase], ['reembolso', 70, 'reemb_70'], 'escolhe 70% (fim), nunca 25% (início)')
  const trechoLimite = (ultimoPromptInferencia.split(/\[caso \d+\]\n/).find(c => c.includes(LIMITE.ultimaResposta)) ?? '').replace(/\n+$/, '')
  assert.ok(trechoLimite.length > 3000 && trechoLimite.length <= 3500, `dentro do limite (${trechoLimite.length})`)
  assert.ok(trechoLimite.includes('Loja: ' + LIMITE.ultimaOferta), 'última oferta presente por inteiro')
  assert.ok(trechoLimite.includes('Cliente (mensagem atual): ' + LIMITE.mensagemAtual), 'mensagem atual presente')
  assert.ok(trechoLimite.endsWith('Loja (última resposta): ' + LIMITE.ultimaResposta), 'última resposta presente por inteiro, no extremo final')
  assert.match(trechoLimite, /^Assunto: Bestellung #908\nCliente: Die Qualität/); assert.match(trechoLimite, /Wir bieten 25%/)
  assert.match(trechoLimite, /omitida\(s\)/); assert.match(trechoLimite, /FINAL DA CONVERSA/)
  // conversa longa: o trecho enviado preserva assunto, mensagem atual e o FIM (a oferta de 60%), e a inferência escolhe 60%, nunca 25%
  const h907 = (await api('/api/state', null, 'GET')).state.tickets.find(t => t.id === 'h907')
  assert.deepEqual([h907.inferenciaCentral.desfecho, h907.inferenciaCentral.percentual, h907.inferenciaCentral.fase], ['reembolso', 60, 'reemb_60'])
  const trechoLongo = ultimoPromptInferencia.split(/\[caso \d+\]/).find(c => /Ja, 60% ist ok/.test(c)) ?? ''
  assert.ok(trechoLongo.length > 0 && trechoLongo.length <= 3800, 'trecho limitado')
  assert.match(trechoLongo, /^\s*Assunto: Bestellung #907/); assert.match(trechoLongo, /Cliente \(mensagem atual\): Ja, 60% ist ok/); assert.match(trechoLongo, /Als letztes Angebot: 60%/); assert.match(trechoLongo, /Loja \(última resposta\): Erledigt, 60%/)
  assert.match(trechoLongo, /mensagem\(ns\) intermediária\(s\) omitida\(s\)/); assert.match(trechoLongo, /FINAL DA CONVERSA/)
  assert.ok(trechoLongo.indexOf('Als letztes Angebot: 60%') > trechoLongo.indexOf('omitida'), 'a última oferta vem depois do corte, no fim')
  // quem tem relatório ou está no modo novo não foi lido
  const todos = (await api('/api/state', null, 'GET')).state.tickets
  assert.equal(todos.find(t => t.id === 'h905').inferenciaCentral, undefined, 'com relatório: não gasta IA'); assert.equal(todos.find(t => t.id === 'h906').inferenciaCentral, undefined, 'modo novo: nunca')
  r = await api('/api/central/migrar', { ticketId: 'h905' }); assert.equal(r.status, 400, 'nem por clique individual')
  r = await api('/api/central/migrar', { ticketId: 'h906' }); assert.equal(r.status, 400)
  const depois = (await api('/api/state', null, 'GET')).state.tickets.filter(t => /^h90/.test(t.id))
  for (const t of depois) assert.equal(foto(t), antes[t.id], `${t.id}: status, categoria, relatório, motor e mensagens intactos`)
  const h901 = depois.find(t => t.id === 'h901'); const h902 = depois.find(t => t.id === 'h902'); const h904 = depois.find(t => t.id === 'h904')
  assert.deepEqual([h901.inferenciaCentral.jornada, h901.inferenciaCentral.fase, h901.inferenciaCentral.desfecho, h901.inferenciaCentral.origem], ['tamanho', 'tam_troca', 'troca', 'ia'])
  assert.deepEqual([h902.inferenciaCentral.desfecho, h902.inferenciaCentral.percentual], ['reembolso', 60])
  assert.equal(h904.inferenciaCentral, undefined, 'quem não é caso não é lido')
  // a Central usa a inferência: fase, jornada e "só inferido"; nada entra no reembolsado de fato
  c = await api('/api/central?loja=loja2', null, 'GET')
  const reg = id => c.registros.find(x => x.ticketId === id)
  assert.deepEqual([reg('h901').inferidaPor, reg('h901').faseAtual, reg('h901').jornada, reg('h901').desfecho], ['ia', 'tam_troca', 'tamanho', 'troca'])
  assert.deepEqual([reg('h902').situacaoReembolso, reg('h902').percentual], ['inferido', 60])
  assert.equal(c.indicadores.find(k => k.moeda === 'EUR')?.reembolsadoEfetivo ?? 0, 0)
  assert.equal(c.metricas.tam_troca.inferidos, 1); assert.equal(c.metricas.tam_troca.passaram, 0)
  // refazer uma só (forçado) e remover
  r = await api('/api/central/migrar', { ticketId: 'h903', forcar: true }); assert.equal(r.lidos, 1)
  r = await api('/api/central/migrar', { ticketId: 'h903', remover: true }); assert.equal(r.status, 200)
  st = await api('/api/central/migracao', null, 'GET'); assert.deepEqual([st.inferidos, st.pendentes], [4, 1])
  r = await api('/api/central/migrar', { ticketId: 'h904' }); assert.equal(r.status, 400, 'fora dos casos')
})

test('modo por loja: loja sem e-mail, prazo ou cupom não ativa o novo; troca exige confirmação; auditoria; as outras lojas não mudam', async () => {
  // loja4 (sem e-mail), loja5 (sem e-mail e sem cupons), loja6 (sem prazo e sem cupons)
  let r = await api('/api/lojas/loja5/modo', { modo: 'novo', confirmar: true })
  assert.equal(r.status, 400); assert.match(r.erro, /não pode ativar/); assert.deepEqual(r.faltando.map(f => f.chave), ['email', 'cupons'])
  r = await api('/api/lojas/loja6/modo', { modo: 'novo', confirmar: true })
  assert.equal(r.status, 400); assert.deepEqual(r.faltando.map(f => f.chave), ['prazo', 'cupons']); assert.match(r.erro, /15%, 25%, 30%, 35%, 40%/)
  let m = await api('/api/lojas/loja6/modo', null, 'GET')
  assert.equal(m.modo, 'classico'); assert.equal(m.prontidao.pronto, false); assert.deepEqual(m.cuponsNecessarios, [15, 25, 30, 35, 40])
  // a rota genérica de loja NÃO troca o modo
  r = await api('/api/lojas', { id: 'loja6', modoAtendimento: 'novo' })
  assert.equal(r.status, 400); assert.match(r.erro, /Mudar modo/)
  // completa a preparação (prazo + cupons) e confere a prontidão
  await api('/api/lojas', { id: 'loja6', prazoEntrega: { min: 5, max: 12, processamento: 3 }, cupons: CUPONS })
  m = await api('/api/lojas/loja6/modo', null, 'GET'); assert.equal(m.prontidao.pronto, true)
  // sem confirmação não muda
  r = await api('/api/lojas/loja6/modo', { modo: 'novo' })
  assert.equal(r.status, 400); assert.equal(r.precisaConfirmar, true)
  // com confirmação muda — só esta loja, com "desde" e auditoria; envio automático continua desligado
  r = await api('/api/lojas/loja6/modo', { modo: 'novo', confirmar: true })
  assert.equal(r.status, 200, r.erro)
  const lojas = r.state.lojas
  const l6 = lojas.find(l => l.id === 'loja6')
  assert.equal(l6.modoAtendimento, 'novo'); assert.ok(l6.modoDesde); assert.equal(l6.novoEnvioAutomatico, false)
  assert.equal(l6.modoHistorico.length, 1); assert.deepEqual([l6.modoHistorico[0].de, l6.modoHistorico[0].para, l6.modoHistorico[0].por, l6.modoHistorico[0].lojaId], ['classico', 'novo', 'Teste', 'loja6']); assert.ok(l6.modoHistorico[0].em)
  assert.equal(lojas.find(l => l.id === 'loja2').modoAtendimento, 'classico'); assert.equal(lojas.find(l => l.id === 'loja5').modoAtendimento, 'classico'); assert.equal(lojas.find(l => l.id === 'loja1').modoAtendimento, 'novo')
  // volta ao clássico (sempre permitido, com confirmação)
  r = await api('/api/lojas/loja6/modo', { modo: 'classico' }); assert.equal(r.status, 400)
  r = await api('/api/lojas/loja6/modo', { modo: 'classico', confirmar: true }); assert.equal(r.status, 200)
  assert.equal(r.state.lojas.find(l => l.id === 'loja6').modoHistorico.length, 2)
})

test('alternância antigo → novo → antigo: cada conversa fica no motor em que nasceu; migração só manual e confirmada', async () => {
  // loja6 no clássico: conversa A nasce clássica
  let a = await cliente(null, { de: 'c31@web.de', nome: 'C31', corpo: 'Wo ist mein Paket?', lojaId: 'loja6' })
  assert.equal(a.motor, 'classico'); assert.equal(a.atendimentoNovo, undefined); assert.equal(a.status, 'aprovacao')
  // loja6 → novo (já preparada no teste anterior)
  let r = await api('/api/lojas/loja6/modo', { modo: 'novo', confirmar: true }); assert.equal(r.status, 200, r.erro)
  // mensagem nova em A: continua no clássico (sem motor novo, sem fase)
  a = await cliente(null, { de: 'c31@web.de', corpo: 'Immer noch nichts.', ticketId: a.id })
  assert.equal(a.motor, 'classico'); assert.equal(a.atendimentoNovo, undefined); assert.match(a.rascunho ?? '', /Paket/)
  // conversa B nasce no novo
  let b = await cliente({ intencao: 'pede_reembolso', motivo: 'qualidade' }, { de: 'c32@web.de', nome: 'C32', corpo: 'Schlecht.', lojaId: 'loja6' })
  assert.equal(b.motor, 'novo'); assert.equal(an(b).transicaoPendente.para, 'qual_troca')
  await comEnvio('ok', () => aprovar(b)); b = await ticket(b.id); assert.equal(an(b).etapa, 'qual_troca')
  // loja6 volta ao clássico
  r = await api('/api/lojas/loja6/modo', { modo: 'classico', confirmar: true }); assert.equal(r.status, 200)
  // B continua no novo: recusa avança a fase, com histórico preservado
  b = await cliente({ intencao: 'recusa' }, { de: 'c32@web.de', corpo: 'Nein.', ticketId: b.id })
  assert.equal(b.motor, 'novo'); assert.equal(an(b).transicaoPendente.para, 'qual_cupom_35'); assert.equal(an(b).historicoEtapas.length, 1); assert.equal(an(b).etapa, 'qual_troca')
  await comEnvio('ok', () => aprovar(b)); b = await ticket(b.id); assert.equal(an(b).etapa, 'qual_cupom_35')
  // aceite no novo com a loja no clássico: endereço e decisão pendente continuam sendo do novo
  b = await cliente({ intencao: 'aceita' }, { de: 'c32@web.de', corpo: 'Ok, den Gutschein.', ticketId: b.id })
  assert.equal(b.status, 'humano'); assert.equal(an(b).acaoAceita, 'qual_cupom_35'); assert.equal(an(b).aguardando, 'humano')
  // conversa C nasce clássica de novo
  const c = await cliente(null, { de: 'c33@web.de', nome: 'C33', corpo: 'Tracking?', lojaId: 'loja6' })
  assert.equal(c.motor, 'classico'); assert.equal(c.atendimentoNovo, undefined)
  // migração manual: só com a loja no novo, só conversa clássica aberta, só confirmada
  r = await api(`/api/tickets/${c.id}/migrar-motor`, { confirmar: true }); assert.equal(r.status, 400); assert.match(r.erro, /loja .* clássico/)
  r = await api('/api/lojas/loja6/modo', { modo: 'novo', confirmar: true }); assert.equal(r.status, 200)
  r = await api(`/api/tickets/${c.id}/migrar-motor`, {}); assert.equal(r.status, 400); assert.equal(r.precisaConfirmar, true)
  r = await api(`/api/tickets/${b.id}/migrar-motor`, { confirmar: true }); assert.equal(r.status, 400); assert.match(r.erro, /já está no motor novo/)
  fila.push({ intencao: 'pergunta_status', motivo: 'nao_recebido' }) // a triagem do novo classifica a mensagem atual de C
  r = await api(`/api/tickets/${c.id}/migrar-motor`, { confirmar: true }); assert.equal(r.status, 200, r.erro)
  const c2 = await ticket(c.id)
  assert.equal(c2.motor, 'novo'); assert.ok(c2.atendimentoNovo); assert.equal(an(c2).etapa, null, 'começa pela triagem'); assert.equal(an(c2).fluxo, 'entregue_nao_recebido', 'triagem do novo: pedido consta entregue e o cliente pergunta onde está')
  assert.deepEqual([c2.motorHistorico[0].de, c2.motorHistorico[0].para, c2.motorHistorico[0].por], ['classico', 'novo', 'Teste'])
  // A (clássica, aberta) NÃO foi migrada junto: migração nunca é automática
  const a2 = await ticket(a.id); assert.equal(a2.motor, 'classico'); assert.equal(a2.atendimentoNovo, undefined)
  await api('/api/lojas/loja6/modo', { modo: 'classico', confirmar: true })
})

test('link externo do pipeline: somente leitura, mesmos números da Central, todas as jornadas e fases, sem dados pessoais, token revogável', async () => {
  const raw = async (caminho, metodo = 'GET') => { const r = await realFetch(base + caminho, { method: metodo }); return { status: r.status, texto: await r.text(), tipo: r.headers.get('content-type') || '' } }
  // sem link ainda
  let r = await api('/api/state', null, 'GET'); assert.equal(r.state.pipelineLink, null)
  r = await api('/api/pipeline-link', { acao: 'gerar' }); assert.equal(r.status, 200)
  const link = r.state.pipelineLink
  assert.match(link, /^\/p\/teste\/[0-9a-f]{64}$/, 'token longo (32 bytes)')
  // a página: cabeçalho, abas, todas as jornadas e TODAS as fases (renderizadas no servidor)
  let pg = await raw(link)
  assert.equal(pg.status, 200); assert.match(pg.tipo, /text\/html/)
  assert.match(pg.texto, /Pipeline completo/); assert.match(pg.texto, /Mapa do fluxo/); assert.match(pg.texto, /Todos os pedidos/)
  const st = (await api('/api/state', null, 'GET')).state
  for (const nome of Object.values(st.jornadasNovo)) assert.ok(pg.texto.includes(nome), `jornada "${nome}" na página`)
  for (const [id, f] of Object.entries(st.fasesNovo)) { assert.ok(pg.texto.includes(`data-fase="${id}"`), `fase ${id} na página`); assert.ok(pg.texto.includes(f.titulo.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `título de ${id}`) }
  assert.ok(!pg.texto.includes(link.split('/').pop()), 'o token não aparece no HTML')
  // os dados: mesmos números da Central interna para os mesmos filtros
  for (const q of ['', '?loja=loja1', '?loja=loja2&periodo=todas', '?jornada=qualidade&fase=reemb_25&desfecho=reembolso', '?desfecho=25']) {
    const ext = JSON.parse((await raw(link + '/dados' + q)).texto)
    const int = await api('/api/central' + q, null, 'GET')
    const nucleo = ms => Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, { passaram: v.passaram, pararam: v.pararam, avancaram: v.avancaram, emAberto: v.emAberto, valorPorMoeda: v.valorPorMoeda, inferidos: v.inferidos, manuais: v.manuais }]))
    assert.deepEqual(nucleo(ext.metricas), nucleo(int.metricas), `métricas iguais (${q})`)
    assert.deepEqual(ext.indicadores, int.indicadores, `indicadores iguais (${q})`)
    assert.equal(ext.registros.length, int.registros.length); assert.equal(ext.linhas.length, int.linhas.length)
    assert.deepEqual(ext.registros.map(x => x.chave), int.registros.map(x => x.chave))
    // percentuais por fase sobre os casos filtrados; painel por fase coerente com as métricas
    for (const [id, m] of Object.entries(ext.metricas)) { assert.equal(m.pctPassaram, ext.totalCasos ? Math.round((m.passaram / ext.totalCasos) * 1000) / 10 : 0); assert.equal(ext.porFase[id].passaram.length, m.passaram); assert.equal(ext.porFase[id].pararam.length, m.pararam); assert.equal(ext.porFase[id].avancaram.length, m.avancaram) }
  }
  // sem dados pessoais nem texto de conversa — no HTML e no JSON
  const dados = (await raw(link + '/dados')).texto
  for (const proibido of ['@web.de', '@teste.local', 'Hauptstr', 'Schlecht', 'Umtausch', 'Cliente 1', '"cliente"', '"de":', '"corpo"', '"historico"', '"enderecoConfirmado"', '"enderecoInformado"', '"rascunho"', '"resposta"']) {
    assert.ok(!dados.includes(proibido), `JSON externo não pode conter "${proibido}"`); assert.ok(!pg.texto.includes(proibido), `HTML externo não pode conter "${proibido}"`)
  }
  assert.ok(dados.includes('"registros"') && dados.includes('"linhas"') && dados.includes('"metricas"'))
  // nenhuma rota de escrita pelo link
  for (const caminho of [link + '/dados', link]) { const w = await raw(caminho, 'POST'); assert.ok(w.status === 404 || w.status === 405, `POST ${caminho} → ${w.status}`) }
  // token inválido, workspace errado e token de outro workspace: 404
  assert.equal((await raw('/p/teste/' + 'a'.repeat(64))).status, 404)
  assert.equal((await raw('/p/outro-ws/' + link.split('/').pop())).status, 404)
  assert.equal((await raw('/p/outro-ws/' + link.split('/').pop() + '/dados')).status, 404)
  // gerar novo link: o antigo morre na hora
  r = await api('/api/pipeline-link', { acao: 'novo' }); const link2 = r.state.pipelineLink
  assert.notEqual(link2, link); assert.equal((await raw(link)).status, 404); assert.equal((await raw(link2)).status, 200)
  // revogar: o endereço para de funcionar imediatamente
  r = await api('/api/pipeline-link', { acao: 'revogar' }); assert.equal(r.state.pipelineLink, null)
  assert.equal((await raw(link2)).status, 404); assert.equal((await raw(link2 + '/dados')).status, 404)
})

test('loja clássica não passa pelo motor novo', async () => {
  const t = await cliente(null, { de: 'c7@web.de', nome: 'C7', corpo: 'Wo ist mein Paket?', lojaId: 'loja2' })
  assert.equal(t.atendimentoNovo, undefined); assert.equal(t.status, 'aprovacao')
})
