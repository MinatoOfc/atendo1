import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { carregar, salvar, uid, estadoInicial } from './store.js'
import {
  demoEmails, demoSpam, demoPedidos, bibliotecaEcommerce, politicasSugeridas,
  classificarLocal, detectarIdiomaLocal, pareceSpam,
} from './logic.js'
import { processarEmail, iaConfigurada, testarIA, statusIA, traduzirMensagens } from './ai.js'
import { contas, contaDaLoja, algumEmailConfigurado, envioPorApi } from './mail.js'
import crypto from 'crypto'
import {
  buscarPedidosShopify, buscarProdutosShopify, testarShopify,
  oauthDisponivel, conexaoDaLoja, urlInstalacao, hmacValido, trocarCodigoPorToken,
} from './shopify.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1) // Railway fica atrás de proxy; sem isso o redirect_uri sai como http
app.use(express.json({ limit: '1mb' }))

let state = carregar()
const persistir = () => salvar(state)

// Nonces de OAuth em memória (curta duração, uso único)
const noncesOAuth = new Map()
const baseUrl = req => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

/* ---------------- Lojas ---------------- */

// Status da Shopify por loja, em memória (nunca contém o token)
const statusShopifyPorLoja = {}

const conexaoLoja = lojaId => {
  const i = state.lojas.findIndex(l => l.id === lojaId)
  return i < 0 ? null : conexaoDaLoja(state.lojas[i], i)
}

function algumaShopify() {
  return state.lojas.some((l, i) => conexaoDaLoja(l, i))
}

/* ---------------- Visão para o frontend ---------------- */

function visaoLojas() {
  return state.lojas.map((l, i) => {
    const conta = contas[i]
    const cx = conexaoDaLoja(l, i)
    return {
      id: l.id,
      nome: l.nome,
      ativa: l.ativa !== false,
      moeda: l.moeda || 'EUR',
      email: {
        configurado: conta?.configurado ?? false,
        endereco: conta?.endereco ?? null,
        status: conta ? { ...conta.status, envioPorApi, remetente: conta.remetente } : null,
      },
      shopify: {
        conectada: !!cx,
        dominio: cx?.loja ?? null,
        modo: cx?.modo ?? null,
        status: statusShopifyPorLoja[l.id] ?? null,
      },
    }
  })
}

function visao() {
  const conta1 = contas[0]
  const loja1 = state.lojas[0]
  return {
    tickets: state.tickets,
    politicas: state.politicas,
    faqs: state.faqs,
    pedidos: state.pedidos,
    produtos: state.produtos ?? [],
    moeda: loja1?.moeda || 'EUR',
    lojas: visaoLojas(),
    config: {
      ...state.config,
      nomeLoja: loja1?.nome ?? state.config.nomeLoja,
      // integrações reais têm precedência sobre as conexões de demonstração
      emailConectado: conta1?.endereco ?? state.config.emailConectado,
      shopifyConectada: algumaShopify() || state.config.shopifyConectada,
    },
    integracoes: {
      email: algumEmailConfigurado,
      shopify: algumaShopify(),
      shopifyOauth: oauthDisponivel,
      ia: iaConfigurada,
      emailStatus: conta1 ? { ...conta1.status, envioPorApi, remetente: conta1.remetente } : null,
      iaStatus: { ...statusIA },
      shopifyStatus: statusShopifyPorLoja.loja1 ?? { ok: null, erro: null, verificadoEm: null },
    },
  }
}

const ok = res => res.json({ state: visao() })

/* ---------------- Pipeline de um e-mail novo ---------------- */

function aplicarResultado(t, r) {
  t.categoria = r.categoria
  t.idioma = r.idioma
  t.rascunho = r.resposta
  t.confianca = r.confianca
  t.geradoPorIA = r.geradoPorIA
  if (r.situacao) t.resumoSituacao = r.situacao
  if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6

  const minima = state.config.confiancaMinima ?? 0.55
  const sensivel = state.config.escalarSensiveis !== false && r.escalarHumano
  const incerto = r.confianca < minima

  if (sensivel || incerto) {
    t.status = 'humano'
    t.motivoEscalada = r.motivo || (incerto ? 'Confiança abaixo do mínimo configurado' : 'Caso sensível')
  } else {
    t.status = 'aprovacao'
    t.motivoEscalada = undefined
    if (state.config.automacaoAtiva) {
      t.enviaEm = Date.now() + Math.max(0, state.config.atrasoMinutos) * 60_000
    }
  }
}

async function criarTicket({ nome, de, assunto, corpo, data, messageId }, lojaId = 'loja1') {
  const base = {
    id: uid(), nome, de, assunto, corpo, lojaId,
    data: data || new Date().toISOString(),
    lido: false, origem: 'cliente',
    categoria: classificarLocal(assunto + ' ' + corpo),
    idioma: detectarIdiomaLocal(assunto + ' ' + corpo),
    status: 'inbox',
  }
  if (messageId) state.emailsProcessados.push(messageId)

  if (pareceSpam(assunto, corpo, de)) {
    base.status = 'spam'
    return base
  }

  const r = await processarEmail(state, base)
  if (r.spam) {
    base.status = 'spam'
    return base
  }
  aplicarResultado(base, r)
  return base
}

/* ---------------- Conversas (threading) ---------------- */

// "Re: Re: Fwd: Pedido" e "Pedido" são a mesma conversa
const normalizarAssunto = s =>
  String(s || '').replace(/^\s*((re|fwd?|enc|aw|sv)\s*:\s*)+/i, '').trim().toLowerCase()

function acharConversa(de, assunto, lojaId) {
  const alvo = normalizarAssunto(assunto)
  return state.tickets.find(t =>
    (t.lojaId ?? 'loja1') === lojaId &&
    t.de.toLowerCase() === de.toLowerCase() &&
    normalizarAssunto(t.assunto) === alvo &&
    !['spam', 'lixeira'].includes(t.status))
}

async function anexarNaConversa(t, { corpo, data, messageId }) {
  if (messageId) state.emailsProcessados.push(messageId)

  // move a troca anterior para o histórico
  t.historico = t.historico || []
  if (t.corpo) t.historico.push({ autor: 'cliente', corpo: t.corpo, data: t.data, traducao: t.traducao })
  if (t.resposta) t.historico.push({ autor: 'atendo', corpo: t.resposta, data: t.respondidoEm || t.data })

  // a mensagem nova vira a atual, e o ticket volta para o fluxo
  t.corpo = corpo
  t.data = data || new Date().toISOString()
  t.lido = false
  t.resposta = undefined
  t.respondidoEm = undefined
  t.enviaEm = undefined
  t.erroEnvio = undefined
  t.tentativasEnvio = undefined
  t.traducao = undefined // a tradução era da mensagem anterior

  if (t.iaPausada) {
    // IA pausada nesta conversa: nada de rascunho nem envio automático
    t.status = 'humano'
    t.motivoEscalada = 'IA pausada nesta conversa — responda manualmente ou retome a IA'
  } else {
    const r = await processarEmail(state, t)
    aplicarResultado(t, r)
  }

  // conversa atualizada sobe para o topo da lista
  state.tickets = [t, ...state.tickets.filter(x => x.id !== t.id)]
}

/* ---------------- Sincronização ---------------- */

let sincronizando = false

async function sincronizar() {
  if (sincronizando) return 0
  sincronizando = true
  try {
    let novos = 0

    // Pedidos e catálogo reais da Shopify, loja a loja
    for (const [i, loja] of state.lojas.entries()) {
      const cx = conexaoDaLoja(loja, i)
      if (!cx) continue
      const [rp, rprod] = await Promise.all([buscarPedidosShopify(cx), buscarProdutosShopify(cx)])
      if (rp.pedidos) {
        const meus = rp.pedidos.map(p => ({ ...p, lojaId: loja.id }))
        state.pedidos = [...state.pedidos.filter(p => (p.lojaId ?? 'loja1') !== loja.id), ...meus]
      }
      if (rprod.produtos) {
        const meus = rprod.produtos.map(p => ({ ...p, lojaId: loja.id }))
        state.produtos = [...(state.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== loja.id), ...meus]
      }
    }

    if (algumEmailConfigurado) {
      // E-mails reais via IMAP — cada conta alimenta a caixa unificada com a sua loja
      for (const conta of contas) {
        if (!conta.configurado) continue
        const emails = await conta.buscarNovos(state.emailsProcessados)
        for (const e of emails) {
          // resposta de uma conversa existente entra no mesmo ticket
          const conversa = acharConversa(e.de, e.assunto, conta.id)
          if (conversa) {
            await anexarNaConversa(conversa, e)
          } else {
            state.tickets.unshift(await criarTicket(e, conta.id))
          }
          novos++
        }
      }
    } else {
      // Modo demonstração
      const existentes = new Set(state.tickets.map(t => t.de + '|' + t.assunto))
      const agora = Date.now()
      let i = 0
      for (const e of demoEmails) {
        if (existentes.has(e.de + '|' + e.assunto)) continue
        const t = await criarTicket({ ...e, data: new Date(agora - ++i * 3600_000 * 3).toISOString() })
        state.tickets.unshift(t)
        novos++
      }
      for (const e of demoSpam) {
        if (existentes.has(e.de + '|' + e.assunto)) continue
        state.tickets.unshift({
          id: uid(), ...e, data: new Date(agora - ++i * 3600_000 * 4).toISOString(),
          lido: false, origem: 'cliente', categoria: 'outro', idioma: 'pt', status: 'spam',
        })
        novos++
      }
    }

    if (novos > 0) persistir()
    return novos
  } finally {
    sincronizando = false
  }
}

/* ---------------- Envio ---------------- */

async function enviarResposta(ticket, texto) {
  // envia pela conta da loja dona do ticket (ou pela primeira configurada)
  const conta = contaDaLoja(ticket.lojaId ?? 'loja1')
  const canal = conta.configurado || envioPorApi ? conta : contas.find(c => c.configurado)
  if (canal) {
    await canal.enviar({ para: ticket.de, assunto: ticket.assunto, corpo: texto })
  }
  ticket.status = 'enviado'
  ticket.resposta = texto
  ticket.rascunho = texto
  ticket.respondidoEm = new Date().toISOString()
  ticket.enviaEm = undefined
  ticket.lido = true
}

// Timer do envio automático agendado.
// A trava evita que um envio lento seja disparado de novo a cada tique,
// o que reenviaria o mesmo e-mail várias vezes em paralelo.
const enviando = new Set()
const MAX_TENTATIVAS = 3

setInterval(async () => {
  const agora = Date.now()
  const vencidos = state.tickets.filter(t =>
    t.status === 'aprovacao' && t.enviaEm && t.enviaEm <= agora && !t.iaPausada && !enviando.has(t.id))
  if (!vencidos.length) return

  for (const t of vencidos) {
    enviando.add(t.id)
    try {
      await enviarResposta(t, t.rascunho || '')
      t.erroEnvio = undefined
      t.tentativasEnvio = undefined
    } catch (err) {
      t.tentativasEnvio = (t.tentativasEnvio || 0) + 1
      t.erroEnvio = err.message
      console.error(`[auto-envio] tentativa ${t.tentativasEnvio}/${MAX_TENTATIVAS} falhou para ${t.de}: ${err.message}`)

      if (t.tentativasEnvio >= MAX_TENTATIVAS) {
        // Para de tentar em silêncio: manda para você decidir, com o motivo à vista
        t.status = 'humano'
        t.enviaEm = undefined
        t.motivoEscalada = `Não foi possível enviar após ${MAX_TENTATIVAS} tentativas: ${err.message}`
      } else {
        t.enviaEm = agora + t.tentativasEnvio * 60_000 // 1 min, depois 2 min
      }
    } finally {
      enviando.delete(t.id)
    }
  }
  persistir()
}, 5000)

// Sincronização periódica quando há caixa real conectada
if (algumEmailConfigurado) {
  setInterval(() => sincronizar().catch(err => console.error('[sync]', err.message)), 60_000)
}

/* ---------------- Rotas ---------------- */

app.get('/api/state', (req, res) => ok(res))

app.post('/api/sync', async (req, res) => {
  try {
    const novos = await sincronizar()
    res.json({ novos, state: visao() })
  } catch (err) {
    console.error('[sync]', err.message)
    res.status(500).json({ erro: err.message, state: visao() })
  }
})

app.post('/api/email/testar', async (req, res) => {
  // Leitura e envio são canais separados: um pode funcionar sem o outro.
  // Testa a conta pedida (?loja=loja2) ou todas as configuradas.
  const alvo = req.query.loja
  for (const conta of contas) {
    if (alvo && conta.id !== alvo) continue
    if (!conta.configurado && !envioPorApi) continue
    await conta.verificarConexao()
    conta.status.envio = await conta.verificarEnvio()
  }
  const conta1 = contas.find(c => c.id === (alvo || 'loja1')) ?? contas[0]
  res.json({ status: { ...conta1.status, envioPorApi, remetente: conta1.remetente }, state: visao() })
})

app.post('/api/ia/testar', async (req, res) => {
  const s = await testarIA()
  res.json({ status: s, state: visao() })
})

/* ---- OAuth da Shopify ---- */

// Sincroniza pedidos, produtos e moeda de uma loja específica
async function sincronizarLoja(lojaId) {
  const loja = state.lojas.find(l => l.id === lojaId)
  const cx = conexaoLoja(lojaId)
  if (!loja || !cx) return { ok: false, erro: 'Shopify não conectada para esta loja.' }
  const t = await testarShopify(cx)
  statusShopifyPorLoja[lojaId] = { ok: t.ok, erro: t.erro, verificadoEm: t.verificadoEm, loja: cx.loja, modo: cx.modo }
  if (!t.ok) return t
  if (t.moeda) loja.moeda = t.moeda
  const [rp, rprod] = await Promise.all([buscarPedidosShopify(cx), buscarProdutosShopify(cx)])
  if (rp.pedidos) {
    state.pedidos = [...state.pedidos.filter(p => (p.lojaId ?? 'loja1') !== lojaId), ...rp.pedidos.map(p => ({ ...p, lojaId }))]
  }
  if (rprod.produtos) {
    state.produtos = [...(state.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== lojaId), ...rprod.produtos.map(p => ({ ...p, lojaId }))]
  }
  statusShopifyPorLoja[lojaId].pedidos = state.pedidos.filter(p => p.lojaId === lojaId).length
  persistir()
  return t
}

app.get('/api/shopify/instalar', (req, res) => {
  try {
    const lojaId = state.lojas.some(l => l.id === req.query.lojaId) ? req.query.lojaId : 'loja1'
    const nonce = crypto.randomBytes(16).toString('hex')
    const redirectUri = `${baseUrl(req)}/api/shopify/callback`
    const { url, loja } = urlInstalacao(req.query.loja, redirectUri, nonce)
    noncesOAuth.set(nonce, { loja, lojaId, criadoEm: Date.now() })
    // limpa nonces com mais de 10 minutos
    for (const [k, v] of noncesOAuth) if (Date.now() - v.criadoEm > 600_000) noncesOAuth.delete(k)
    res.redirect(url)
  } catch (err) {
    res.status(400).send(`Não foi possível iniciar a instalação: ${err.message}`)
  }
})

app.get('/api/shopify/callback', async (req, res) => {
  const { shop, code, state: nonce } = req.query
  const pendente = noncesOAuth.get(nonce)
  const falhar = msg => res.status(400).send(`${msg} <a href="/#/configuracoes">Voltar ao atendo</a>`)

  if (!pendente) return falhar('Pedido de instalação expirado ou desconhecido. Tente conectar novamente.')
  noncesOAuth.delete(nonce)
  if (!hmacValido(req.query)) return falhar('Assinatura inválida no retorno da Shopify. A instalação foi cancelada por segurança.')
  if (!shop || !code) return falhar('A Shopify não devolveu os dados esperados.')

  try {
    const { loja, token } = await trocarCodigoPorToken(shop, code)
    const alvo = state.lojas.find(l => l.id === pendente.lojaId) ?? state.lojas[0]
    alvo.shopify = { loja, token, instaladoEm: new Date().toISOString() }
    alvo.ativa = true
    persistir()
    await sincronizarLoja(alvo.id)
    console.log(`[shopify] ${alvo.id} conectada via OAuth: ${loja}`)
    res.redirect('/#/configuracoes')
  } catch (err) {
    console.error('[shopify] OAuth falhou:', err.message)
    falhar(err.message)
  }
})

app.post('/api/shopify/desconectar', (req, res) => {
  const lojaId = req.body?.lojaId ?? 'loja1'
  const loja = state.lojas.find(l => l.id === lojaId)
  if (loja) {
    loja.shopify = { loja: null, token: null, instaladoEm: null }
    state.pedidos = state.pedidos.filter(p => (p.lojaId ?? 'loja1') !== lojaId)
    state.produtos = (state.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== lojaId)
    delete statusShopifyPorLoja[lojaId]
  }
  persistir(); ok(res)
})

app.post('/api/shopify/testar', async (req, res) => {
  const lojaId = req.query.lojaId ?? req.body?.lojaId ?? 'loja1'
  const s = await sincronizarLoja(lojaId)
  res.json({ status: statusShopifyPorLoja[lojaId] ?? s, state: visao() })
})

app.post('/api/lojas', (req, res) => {
  const { id, nome, ativa } = req.body ?? {}
  const loja = state.lojas.find(l => l.id === id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao() })
  if (typeof nome === 'string' && nome.trim()) loja.nome = nome.trim()
  if (typeof ativa === 'boolean' && loja.id !== 'loja1') loja.ativa = ativa
  persistir(); ok(res)
})

app.post('/api/email/diagnostico', async (req, res) => {
  try {
    const conta = contaDaLoja(req.query.loja ?? 'loja1')
    const d = await conta.diagnosticar(state.emailsProcessados)
    res.json({ diagnostico: d, state: visao() })
  } catch (err) {
    res.json({ diagnostico: { ok: false, erro: err.message }, state: visao() })
  }
})

const acharTicket = (req, res) => {
  const t = state.tickets.find(x => x.id === req.params.id)
  if (!t) res.status(404).json({ erro: 'ticket não encontrado', state: visao() })
  return t
}

app.post('/api/tickets/:id/lido', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.lido = true; persistir(); ok(res)
})

app.post('/api/tickets/:id/rascunho', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.rascunho = String(req.body.texto ?? ''); persistir(); ok(res)
})

app.post('/api/tickets/:id/aprovar', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  try {
    await enviarResposta(t, String(req.body.texto ?? t.rascunho ?? ''))
    persistir(); ok(res)
  } catch (err) {
    console.error('[enviar]', err)
    res.status(500).json({ erro: 'Falha ao enviar: ' + err.message, state: visao() })
  }
})

app.post('/api/tickets/:id/pausar-ia', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.iaPausada = !!req.body.pausar
  if (t.iaPausada) t.enviaEm = undefined // cancela envio automático pendente
  persistir(); ok(res)
})

app.post('/api/tickets/:id/traduzir', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return

  // traduz TODAS as mensagens do cliente na conversa que ainda não têm tradução
  const alvos = []
  for (const m of t.historico ?? []) {
    if (m.autor === 'cliente' && m.corpo && !m.traducao) alvos.push(m)
  }
  if (t.corpo && !t.traducao) alvos.push(t)
  if (!alvos.length) return ok(res) // tudo já traduzido — não paga de novo

  const r = await traduzirMensagens(alvos.map(a => a.corpo))
  if (r.erro) return res.status(400).json({ erro: r.erro, state: visao() })
  r.textos.forEach((texto, i) => { alvos[i].traducao = texto })
  if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
  persistir(); ok(res)
})

app.post('/api/tickets/:id/mover', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const destinos = ['inbox', 'aprovacao', 'humano', 'spam', 'lixeira']
  if (!destinos.includes(req.body.status)) return res.status(400).json({ erro: 'status inválido', state: visao() })
  t.statusAnterior = t.status
  t.status = req.body.status
  if (req.body.motivo) t.motivoEscalada = req.body.motivo
  t.enviaEm = undefined
  persistir(); ok(res)
})

app.post('/api/tickets/:id/restaurar', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.status = t.statusAnterior && t.statusAnterior !== 'lixeira' ? t.statusAnterior : 'inbox'
  persistir(); ok(res)
})

app.delete('/api/tickets/:id', (req, res) => {
  state.tickets = state.tickets.filter(x => x.id !== req.params.id)
  persistir(); ok(res)
})

app.post('/api/compose', async (req, res) => {
  const { para, assunto, corpo } = req.body
  if (!para || !assunto) return res.status(400).json({ erro: 'para e assunto são obrigatórios', state: visao() })
  try {
    const lojaId = state.lojas.some(l => l.id === req.body.lojaId) ? req.body.lojaId : 'loja1'
    const conta = contaDaLoja(lojaId)
    if (conta.configurado || envioPorApi) {
      await conta.enviar({ para, assunto: assunto.replace(/^Re: /, ''), corpo: corpo || '' })
    }
    state.tickets.unshift({
      id: uid(), nome: para.split('@')[0], de: para, assunto, corpo: '', lojaId,
      data: new Date().toISOString(), lido: true, origem: 'cliente',
      categoria: 'outro', idioma: 'pt', status: 'enviado',
      resposta: corpo || '', respondidoEm: new Date().toISOString(),
    })
    persistir(); ok(res)
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao enviar: ' + err.message, state: visao() })
  }
})

/* ---- Conhecimento ---- */

app.post('/api/politicas', (req, res) => {
  state.politicas.push({ id: uid(), titulo: req.body.titulo, conteudo: req.body.conteudo, ativa: true })
  persistir(); ok(res)
})
app.post('/api/politicas/:id/toggle', (req, res) => {
  state.politicas = state.politicas.map(p => (p.id === req.params.id ? { ...p, ativa: !p.ativa } : p))
  persistir(); ok(res)
})
app.delete('/api/politicas/:id', (req, res) => {
  state.politicas = state.politicas.filter(p => p.id !== req.params.id)
  persistir(); ok(res)
})
app.post('/api/politicas/sugeridas', (req, res) => {
  for (const p of politicasSugeridas) {
    if (!state.politicas.some(x => x.titulo === p.titulo)) state.politicas.push({ ...p, id: uid(), ativa: true })
  }
  persistir(); ok(res)
})

app.post('/api/faqs', (req, res) => {
  state.faqs.push({ id: uid(), pergunta: req.body.pergunta, resposta: req.body.resposta, ativa: true })
  persistir(); ok(res)
})
app.post('/api/faqs/:id/toggle', (req, res) => {
  state.faqs = state.faqs.map(f => (f.id === req.params.id ? { ...f, ativa: !f.ativa } : f))
  persistir(); ok(res)
})
app.delete('/api/faqs/:id', (req, res) => {
  state.faqs = state.faqs.filter(f => f.id !== req.params.id)
  persistir(); ok(res)
})
app.post('/api/faqs/biblioteca', (req, res) => {
  for (const b of bibliotecaEcommerce) {
    if (!state.faqs.some(f => f.pergunta === b.pergunta)) state.faqs.push({ ...b, id: uid(), ativa: true })
  }
  persistir(); ok(res)
})

/* ---- Config ---- */

app.post('/api/config', (req, res) => {
  const permitidos = ['assinatura', 'atrasoMinutos', 'automacaoAtiva', 'tomDetectado', 'emailConectado', 'shopifyConectada', 'escalarSensiveis', 'confiancaMinima']
  for (const k of permitidos) {
    if (k in req.body) state.config[k] = req.body[k]
  }
  // o nome da loja agora vive na loja 1 (compatibilidade com a tela antiga)
  if (typeof req.body.nomeLoja === 'string' && req.body.nomeLoja.trim()) {
    state.lojas[0].nome = req.body.nomeLoja.trim()
  }
  persistir(); ok(res)
})

app.post('/api/shopify/demo', (req, res) => {
  // conexão de demonstração — só quando a Shopify real não está configurada
  if (!algumaShopify()) {
    state.config.shopifyConectada = true
    state.pedidos = demoPedidos.map(p => ({ ...p, lojaId: 'loja1' }))
  }
  persistir(); ok(res)
})

app.post('/api/reset', (req, res) => {
  state = structuredClone(estadoInicial)
  persistir(); ok(res)
})

/* ---------------- Estáticos ---------------- */

const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist))
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, async () => {
  console.log(`atendo servidor na porta ${PORT}`)
  for (const [i, conta] of contas.entries()) {
    console.log(`  e-mail ${conta.id}: ${conta.configurado ? conta.endereco : i === 0 ? 'não configurado (modo demo)' : 'não configurado'}`)
  }
  console.log(`  oauth shopify: ${oauthDisponivel ? 'pronto' : 'não configurado'}`)
  console.log(`  ia:      ${iaConfigurada ? 'Claude conectado' : 'não configurada (respostas por regras)'}`)

  if (iaConfigurada) {
    const t = await testarIA()
    console.log(t.ok ? `  IA OK — usando ${t.modelo}` : `  IA FALHOU: ${t.erro}`)
  }

  for (const loja of state.lojas) {
    if (!conexaoLoja(loja.id)) continue
    const t = await sincronizarLoja(loja.id)
    if (t.ok) {
      console.log(`  Shopify OK (${loja.id}) — ${state.pedidos.filter(p => p.lojaId === loja.id).length} pedidos de ${statusShopifyPorLoja[loja.id]?.loja}`)
    } else {
      console.error(`  SHOPIFY FALHOU (${loja.id}): ${t.erro}`)
    }
  }

  for (const conta of contas) {
    if (!conta.configurado) continue
    const s = await conta.verificarConexao()
    if (s.ok) {
      console.log(`  login IMAP OK (${conta.id}) — lendo ${conta.endereco} a cada 60 s`)
    } else {
      console.error(`  LOGIN IMAP FALHOU (${conta.id}): ${s.erro}`)
    }
  }
  if (algumEmailConfigurado) sincronizar().catch(err => console.error('[sync]', err.message))
})
