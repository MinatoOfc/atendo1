import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { carregar, salvar, uid, estadoInicial } from './store.js'
import {
  demoEmails, demoSpam, demoPedidos, bibliotecaEcommerce, politicasSugeridas,
  classificarLocal, detectarIdiomaLocal, pareceSpam,
} from './logic.js'
import { processarEmail, iaConfigurada, testarIA, statusIA } from './ai.js'
import { emailConfigurado, enderecoEmail, buscarNovosEmails, enviarEmailReal, verificarConexao, diagnosticar, statusEmail } from './mail.js'
import crypto from 'crypto'
import {
  buscarPedidosShopify, buscarProdutosShopify, testarShopify, statusShopify,
  oauthDisponivel, shopifyPronta, carregarSessao,
  urlInstalacao, hmacValido, trocarCodigoPorToken,
} from './shopify.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1) // Railway fica atrás de proxy; sem isso o redirect_uri sai como http
app.use(express.json({ limit: '1mb' }))

let state = carregar()
const persistir = () => salvar(state)
carregarSessao(state.shopify)

// Nonces de OAuth em memória (curta duração, uso único)
const noncesOAuth = new Map()
const baseUrl = req => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

/* ---------------- Visão para o frontend ---------------- */

function visao() {
  return {
    tickets: state.tickets,
    politicas: state.politicas,
    faqs: state.faqs,
    pedidos: state.pedidos,
    produtos: state.produtos ?? [],
    config: {
      ...state.config,
      // integrações reais têm precedência sobre as conexões de demonstração
      emailConectado: enderecoEmail ?? state.config.emailConectado,
      shopifyConectada: shopifyPronta() || state.config.shopifyConectada,
    },
    integracoes: {
      email: emailConfigurado,
      shopify: shopifyPronta(),
      shopifyOauth: oauthDisponivel,
      ia: iaConfigurada,
      emailStatus: { ...statusEmail },
      iaStatus: { ...statusIA },
      shopifyStatus: { ...statusShopify },
    },
  }
}

const ok = res => res.json({ state: visao() })

/* ---------------- Pipeline de um e-mail novo ---------------- */

async function criarTicket({ nome, de, assunto, corpo, data, messageId }) {
  const base = {
    id: uid(), nome, de, assunto, corpo,
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
  base.categoria = r.categoria
  base.idioma = r.idioma
  base.rascunho = r.resposta
  base.confianca = r.confianca
  base.geradoPorIA = r.geradoPorIA

  const minima = state.config.confiancaMinima ?? 0.55
  const sensivel = state.config.escalarSensiveis !== false && r.escalarHumano
  const incerto = r.confianca < minima

  if (sensivel || incerto) {
    base.status = 'humano'
    base.motivoEscalada = r.motivo || (incerto ? 'Confiança abaixo do mínimo configurado' : 'Caso sensível')
  } else {
    base.status = 'aprovacao'
    if (state.config.automacaoAtiva) {
      base.enviaEm = Date.now() + Math.max(0, state.config.atrasoMinutos) * 60_000
    }
  }
  return base
}

/* ---------------- Sincronização ---------------- */

let sincronizando = false

async function sincronizar() {
  if (sincronizando) return 0
  sincronizando = true
  try {
    let novos = 0

    // Pedidos e catálogo reais da Shopify
    if (shopifyPronta()) {
      const [pedidos, produtos] = await Promise.all([buscarPedidosShopify(), buscarProdutosShopify()])
      if (pedidos) state.pedidos = pedidos
      if (produtos) state.produtos = produtos
    }

    if (emailConfigurado) {
      // E-mails reais via IMAP
      const emails = await buscarNovosEmails(state.emailsProcessados)
      for (const e of emails) {
        state.tickets.unshift(await criarTicket(e))
        novos++
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
  // só envia e-mail de verdade quando a caixa real está conectada
  if (emailConfigurado) {
    await enviarEmailReal({ para: ticket.de, assunto: ticket.assunto, corpo: texto })
  }
  ticket.status = 'enviado'
  ticket.resposta = texto
  ticket.rascunho = texto
  ticket.respondidoEm = new Date().toISOString()
  ticket.enviaEm = undefined
  ticket.lido = true
}

// Timer do envio automático agendado
setInterval(async () => {
  const agora = Date.now()
  const vencidos = state.tickets.filter(t => t.status === 'aprovacao' && t.enviaEm && t.enviaEm <= agora)
  for (const t of vencidos) {
    try {
      await enviarResposta(t, t.rascunho || '')
    } catch (err) {
      console.error('[auto-envio] falhou para', t.de, err.message)
      t.enviaEm = agora + 5 * 60_000 // tenta de novo em 5 min
    }
  }
  if (vencidos.length) persistir()
}, 5000)

// Sincronização periódica quando há caixa real conectada
if (emailConfigurado) {
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
  const s = await verificarConexao()
  res.json({ status: s, state: visao() })
})

app.post('/api/ia/testar', async (req, res) => {
  const s = await testarIA()
  res.json({ status: s, state: visao() })
})

/* ---- OAuth da Shopify ---- */

app.get('/api/shopify/instalar', (req, res) => {
  try {
    const nonce = crypto.randomBytes(16).toString('hex')
    const redirectUri = `${baseUrl(req)}/api/shopify/callback`
    const { url, loja } = urlInstalacao(req.query.loja, redirectUri, nonce)
    noncesOAuth.set(nonce, { loja, criadoEm: Date.now() })
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
    state.shopify = { loja, token, instaladoEm: new Date().toISOString() }
    const [pedidos, produtos] = await Promise.all([buscarPedidosShopify(), buscarProdutosShopify()])
    if (pedidos) state.pedidos = pedidos
    if (produtos) state.produtos = produtos
    persistir()
    console.log(`[shopify] conectada via OAuth: ${loja} (${state.pedidos.length} pedidos, ${state.produtos.length} produtos)`)
    res.redirect('/#/configuracoes')
  } catch (err) {
    console.error('[shopify] OAuth falhou:', err.message)
    falhar(err.message)
  }
})

app.post('/api/shopify/desconectar', (req, res) => {
  state.shopify = { loja: null, token: null, instaladoEm: null }
  carregarSessao(null)
  state.pedidos = []
  persistir(); ok(res)
})

app.post('/api/shopify/testar', async (req, res) => {
  const s = await testarShopify()
  if (s.ok) {
    const [pedidos, produtos] = await Promise.all([buscarPedidosShopify(), buscarProdutosShopify()])
    if (pedidos) state.pedidos = pedidos
    if (produtos) state.produtos = produtos
    persistir()
  }
  res.json({ status: { ...statusShopify }, state: visao() })
})

app.post('/api/email/diagnostico', async (req, res) => {
  try {
    const d = await diagnosticar(state.emailsProcessados)
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
    if (emailConfigurado) await enviarEmailReal({ para, assunto: assunto.replace(/^Re: /, ''), corpo: corpo || '' })
    state.tickets.unshift({
      id: uid(), nome: para.split('@')[0], de: para, assunto, corpo: '',
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
  const permitidos = ['nomeLoja', 'assinatura', 'atrasoMinutos', 'automacaoAtiva', 'tomDetectado', 'emailConectado', 'shopifyConectada', 'escalarSensiveis', 'confiancaMinima']
  for (const k of permitidos) {
    if (k in req.body) state.config[k] = req.body[k]
  }
  persistir(); ok(res)
})

app.post('/api/shopify/demo', (req, res) => {
  // conexão de demonstração — só quando a Shopify real não está configurada
  if (!shopifyPronta()) {
    state.config.shopifyConectada = true
    state.pedidos = demoPedidos
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
  console.log(`  e-mail:  ${emailConfigurado ? enderecoEmail : 'não configurado (modo demo)'}`)
  console.log(`  shopify: ${shopifyPronta() ? `${statusShopify.loja}` : oauthDisponivel ? 'aguardando instalação (OAuth pronto)' : 'não configurada (modo demo)'}`)
  console.log(`  ia:      ${iaConfigurada ? 'Claude conectado' : 'não configurada (respostas por regras)'}`)

  if (iaConfigurada) {
    const t = await testarIA()
    console.log(t.ok ? `  IA OK — usando ${t.modelo}` : `  IA FALHOU: ${t.erro}`)
  }

  if (shopifyPronta()) {
    const t = await testarShopify()
    if (t.ok) {
      const [pedidos, produtos] = await Promise.all([buscarPedidosShopify(), buscarProdutosShopify()])
      if (pedidos) state.pedidos = pedidos
      if (produtos) state.produtos = produtos
      persistir()
      console.log(`  Shopify OK — ${state.pedidos.length} pedidos e ${state.produtos.length} produtos de ${t.loja}`)
    } else {
      console.error(`  SHOPIFY FALHOU: ${t.erro}`)
    }
  }

  if (emailConfigurado) {
    const s = await verificarConexao()
    if (s.ok) {
      console.log(`  login IMAP OK — lendo ${enderecoEmail} a cada 60 s`)
      sincronizar().catch(err => console.error('[sync]', err.message))
    } else {
      console.error(`  LOGIN IMAP FALHOU: ${s.erro}`)
    }
  }
})
