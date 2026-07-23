import express from 'express'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { carregar, uid, estadoInicial, lojaPadrao, MAX_LOJAS } from './store.js'
import {
  demoEmails, demoSpam, demoPedidos, bibliotecaEcommerce, politicasSugeridas,
  classificarLocal, detectarIdiomaLocal, pareceSpam,
} from './logic.js'
import { processarEmail, processarEmailIA, iaConfigurada, testarIA, statusIA } from './ai.js'
import { traduzirGratis } from './traducao.js'
import { criarConta, lerConfigEnv, montarConfig, testarConfig, envioPorApi, presetsDisponiveis } from './mail.js'
import {
  buscarPedidosShopify, buscarProdutosShopify, testarShopify,
  oauthDisponivel, credenciaisEnv, conexaoDaLoja, urlInstalacao, hmacValido,
  trocarCodigoPorToken, normalizarDominio, escoposNecessarios,
} from './shopify.js'
import * as db from './db.js'
import {
  hashSenha, senhaConfere, cifrar, decifrar,
  lerCookie, gravarCookie, limparCookie,
  podeTentarLogin, registrarFalhaLogin, limparFalhasLogin,
} from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1) // Railway fica atrás de proxy
app.use(express.json({ limit: '1mb' }))

/* ---------------- Estado por workspace ---------------- */

let segredo = null
const workspaces = new Map() // id → estado

const salvar = wsId => {
  const estado = workspaces.get(wsId)
  if (estado) db.salvarWorkspace(wsId, estado).catch(err => console.error('[db] salvar falhou:', err.message))
}

async function carregarWorkspaces() {
  const ids = await db.listarWorkspaces()
  for (const id of ids) {
    const estado = await db.carregarWorkspace(id)
    if (estado) workspaces.set(id, estado)
  }
  // Migração da instalação de usuário único: o antigo data/atendo.json vira o
  // workspace "principal", reivindicado pelo primeiro usuário que se registrar.
  if (!workspaces.has('principal')) {
    const arqAntigo = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'atendo.json')
    if (fs.existsSync(arqAntigo)) {
      const antigo = carregar()
      workspaces.set('principal', antigo)
      await db.salvarWorkspace('principal', antigo)
      console.log('[migração] data/atendo.json importado como workspace "principal"')
    }
  }
}

/* ---------------- Contas de e-mail por workspace ---------------- */

// As credenciais preenchidas no site ficam cifradas no estado (loja.emailCfg);
// as variáveis de ambiente continuam valendo como reserva para instalações antigas.
const cacheContas = new Map() // wsId → { chave, contas }

function configDaLoja(estado, indice) {
  const loja = estado.lojas[indice]
  if (loja?.emailCfg?.user) {
    const cfg = { ...loja.emailCfg }
    cfg.pass = decifrar(cfg.passCifrada, segredo) ?? ''
    delete cfg.passCifrada
    return { cfg: montarConfig(cfg), origem: 'site' }
  }
  const env = lerConfigEnv(indice === 0 ? '' : String(indice + 1))
  if (env.user && env.pass) return { cfg: env, origem: 'env' }
  return { cfg: montarConfig({}), origem: null }
}

function contasDe(wsId) {
  const estado = workspaces.get(wsId)
  if (!estado) return []
  const configs = estado.lojas.map((_, i) => configDaLoja(estado, i))
  const chave = JSON.stringify(configs.map(c => [c.cfg.user, c.cfg.imapHost, c.cfg.smtpHost, c.cfg.pass?.length, c.origem]))
  const emCache = cacheContas.get(wsId)
  if (emCache?.chave === chave) return emCache.contas
  const contas = configs.map((c, i) => {
    const conta = criarConta(estado.lojas[i].id, c.cfg, i === 0 ? '' : String(i + 1))
    conta.origem = c.origem
    conta.remetenteNome = c.cfg.remetenteNome || null
    conta.provider = c.cfg.provider || null
    return conta
  })
  cacheContas.set(wsId, { chave, contas })
  return contas
}

const contaDaLoja = (wsId, lojaId) => {
  const contas = contasDe(wsId)
  return contas.find(c => c.id === lojaId) ?? contas[0]
}

const algumEmail = wsId => contasDe(wsId).some(c => c.configurado)

/* ---------------- Shopify por loja ---------------- */

const statusShopifyPorLoja = new Map() // `${wsId}:${lojaId}` → status

const conexaoLoja = (estado, lojaId) => {
  const i = estado.lojas.findIndex(l => l.id === lojaId)
  return i < 0 ? null : conexaoDaLoja(estado.lojas[i], i)
}

const algumaShopify = estado => estado.lojas.some((l, i) => conexaoDaLoja(l, i))

/**
 * Credenciais do app da Shopify a usar para uma loja: o app próprio dela
 * (cadastrado pelo site, com secret cifrado) tem precedência; sem ele, vale o
 * app do servidor (env). Necessário porque apps do Dev Dashboard só instalam
 * em lojas da mesma organização — cada amigo usa o app da organização dele.
 */
function appDaLoja(estado, lojaId) {
  const loja = estado.lojas.find(l => l.id === lojaId)
  if (loja?.shopifyApp?.clientId && loja.shopifyApp.secretCifrado) {
    const secret = decifrar(loja.shopifyApp.secretCifrado, segredo)
    if (secret) return { clientId: loja.shopifyApp.clientId, clientSecret: secret, proprio: true }
  }
  return credenciaisEnv ? { ...credenciaisEnv, proprio: false } : null
}

/* ---------------- Cotações (moeda de exibição) ---------------- */

// Taxas do BCE via frankfurter.app, base EUR, renovadas 1x por dia.
// Servem só para a preferência visual de moeda — os dados ficam na moeda da loja.
let cotacoes = { em: 0, taxas: null }

async function atualizarCotacoes() {
  try {
    const resp = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD,BRL,GBP')
    if (resp.ok) {
      const d = await resp.json()
      cotacoes = { em: Date.now(), taxas: { EUR: 1, ...d.rates } }
    }
  } catch { /* sem internet ou API fora — a preferência fica desativada */ }
}

function taxasAtuais() {
  if (Date.now() - cotacoes.em > 24 * 3600_000) atualizarCotacoes()
  return cotacoes.taxas
}

/* ---------------- Visão para o frontend ---------------- */

function visaoLojas(wsId, estado) {
  const contas = contasDe(wsId)
  return estado.lojas.map((l, i) => {
    const conta = contas[i]
    const cx = conexaoDaLoja(l, i)
    return {
      id: l.id,
      nome: l.nome,
      ativa: l.ativa !== false,
      moeda: l.moeda || 'EUR',
      idioma: l.idioma || 'auto',
      email: {
        configurado: conta?.configurado ?? false,
        endereco: conta?.endereco ?? null,
        provider: conta?.provider ?? null,
        remetenteNome: conta?.remetenteNome ?? null,
        origem: conta?.origem ?? null,
        status: conta ? { ...conta.status, envioPorApi, remetente: conta.remetente } : null,
      },
      shopify: {
        conectada: !!cx,
        dominio: cx?.loja ?? null,
        modo: cx?.modo ?? null,
        status: statusShopifyPorLoja.get(`${wsId}:${l.id}`) ?? null,
        oauthDisponivel: !!appDaLoja(estado, l.id),
        appProprio: !!l.shopifyApp?.clientId,
        appClientId: l.shopifyApp?.clientId ?? null,
      },
    }
  })
}

function visao(wsId) {
  const estado = workspaces.get(wsId)
  const contas = contasDe(wsId)
  const conta1 = contas[0]
  const loja1 = estado.lojas[0]
  return {
    tickets: estado.tickets,
    politicas: estado.politicas,
    faqs: estado.faqs,
    comportamentos: estado.comportamentos ?? [],
    pedidos: estado.pedidos,
    produtos: estado.produtos ?? [],
    moeda: loja1?.moeda || 'EUR',
    lojas: visaoLojas(wsId, estado),
    provedoresEmail: presetsDisponiveis,
    cotacoes: taxasAtuais(),
    escoposShopify: escoposNecessarios,
    config: {
      ...estado.config,
      nomeLoja: loja1?.nome ?? estado.config.nomeLoja,
      emailConectado: conta1?.endereco ?? estado.config.emailConectado,
      shopifyConectada: algumaShopify(estado) || estado.config.shopifyConectada,
    },
    integracoes: {
      email: algumEmail(wsId),
      shopify: algumaShopify(estado),
      shopifyOauth: oauthDisponivel,
      ia: iaConfigurada,
      emailStatus: conta1 ? { ...conta1.status, envioPorApi, remetente: conta1.remetente } : null,
      iaStatus: { ...statusIA },
      shopifyStatus: statusShopifyPorLoja.get(`${wsId}:loja1`) ?? { ok: null, erro: null, verificadoEm: null },
    },
  }
}

/* ---------------- Autenticação ---------------- */

const visaoUsuario = u => ({ id: u.id, nome: u.nome, email: u.email })

async function resolverSessao(req) {
  const token = lerCookie(req)
  if (!token) return null
  const sessao = await db.sessaoPorToken(token)
  if (!sessao) return null
  const usuario = await db.usuarioPorId(sessao.usuarioId)
  if (!usuario) return null
  if (!workspaces.has(usuario.workspaceId)) {
    const estado = await db.carregarWorkspace(usuario.workspaceId)
    workspaces.set(usuario.workspaceId, estado ?? db.novoEstado())
  }
  return { usuario, token }
}

const ROTAS_PUBLICAS = ['/api/registrar', '/api/login', '/api/shopify/callback']

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api') || ROTAS_PUBLICAS.includes(req.path)) return next()
  const sessao = await resolverSessao(req)
  if (!sessao) return res.status(401).json({ erro: 'não autenticado' })
  req.usuario = sessao.usuario
  req.wsId = sessao.usuario.workspaceId
  req.estado = workspaces.get(req.wsId)
  next()
})

app.post('/api/registrar', async (req, res) => {
  const { nome, email, senha } = req.body ?? {}
  const emailLimpo = String(email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLimpo)) return res.status(400).json({ erro: 'E-mail inválido.' })
  if (String(senha || '').length < 8) return res.status(400).json({ erro: 'A senha precisa de pelo menos 8 caracteres.' })

  // O primeiro usuário reivindica o workspace "principal" (dados migrados da
  // instalação de usuário único); os demais começam do zero.
  const primeiro = (await db.contarUsuarios()) === 0
  const wsId = primeiro && workspaces.has('principal') ? 'principal' : `ws-${uid()}`
  if (!workspaces.has(wsId)) {
    workspaces.set(wsId, db.novoEstado())
    await db.salvarWorkspace(wsId, workspaces.get(wsId))
  }

  const usuario = {
    id: `u-${uid()}`,
    email: emailLimpo,
    nome: String(nome || '').trim() || emailLimpo.split('@')[0],
    senhaHash: await hashSenha(senha),
    workspaceId: wsId,
  }
  try {
    await db.criarUsuario(usuario)
  } catch (err) {
    if (String(err.code) === '23505' || /duplicad|unique/i.test(err.message)) {
      return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' })
    }
    throw err
  }
  const token = await db.criarSessao(usuario.id)
  gravarCookie(req, res, token)
  res.json({ usuario: visaoUsuario(usuario), state: visao(wsId) })
})

app.post('/api/login', async (req, res) => {
  const emailLimpo = String(req.body?.email || '').trim().toLowerCase()
  const chave = `${req.ip}|${emailLimpo}`
  if (!podeTentarLogin(chave)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' })
  }
  const usuario = await db.usuarioPorEmail(emailLimpo)
  if (!usuario || !(await senhaConfere(req.body?.senha, usuario.senhaHash))) {
    registrarFalhaLogin(chave)
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' })
  }
  limparFalhasLogin(chave)
  if (!workspaces.has(usuario.workspaceId)) {
    const estado = await db.carregarWorkspace(usuario.workspaceId)
    workspaces.set(usuario.workspaceId, estado ?? db.novoEstado())
  }
  const token = await db.criarSessao(usuario.id)
  gravarCookie(req, res, token)
  res.json({ usuario: visaoUsuario(usuario), state: visao(usuario.workspaceId) })
})

app.post('/api/logout', async (req, res) => {
  const token = lerCookie(req)
  if (token) await db.apagarSessao(token)
  limparCookie(req, res)
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  res.json({ usuario: visaoUsuario(req.usuario), state: visao(req.wsId) })
})

app.post('/api/conta', async (req, res) => {
  const { nome, senhaAtual, novaSenha } = req.body ?? {}
  if (typeof nome === 'string' && nome.trim()) {
    await db.atualizarUsuario(req.usuario.id, { nome: nome.trim() })
    req.usuario.nome = nome.trim()
  }
  if (novaSenha) {
    if (!(await senhaConfere(senhaAtual, req.usuario.senhaHash))) {
      return res.status(400).json({ erro: 'A senha atual não confere.' })
    }
    if (String(novaSenha).length < 8) return res.status(400).json({ erro: 'A nova senha precisa de pelo menos 8 caracteres.' })
    await db.atualizarUsuario(req.usuario.id, { senhaHash: await hashSenha(novaSenha) })
  }
  res.json({ usuario: visaoUsuario(req.usuario), state: visao(req.wsId) })
})

const ok = (req, res) => res.json({ state: visao(req.wsId) })

/* ---------------- Pipeline de um e-mail novo ---------------- */

function aplicarResultado(estado, t, r) {
  t.categoria = r.categoria
  t.idioma = r.idioma
  t.rascunho = r.resposta
  t.confianca = r.confianca
  t.geradoPorIA = r.geradoPorIA
  if (r.situacao) t.resumoSituacao = r.situacao
  if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6

  const minima = estado.config.confiancaMinima ?? 0.55
  const sensivel = estado.config.escalarSensiveis !== false && r.escalarHumano
  const incerto = r.confianca < minima
  // Regra fixa do código, não da IA: reembolso SEMPRE espera decisão humana,
  // mesmo que o modelo devolva escalar_humano=false ou confiança alta.
  const reembolso = r.categoria === 'reembolso'

  if (sensivel || incerto || reembolso) {
    t.status = 'humano'
    t.motivoEscalada = reembolso
      ? (r.motivo || 'Reembolso — sempre passa pela sua aprovação')
      : r.motivo || (incerto ? 'Confiança abaixo do mínimo configurado' : 'Caso sensível')
  } else {
    t.status = 'aprovacao'
    t.motivoEscalada = undefined
    if (estado.config.automacaoAtiva) {
      t.enviaEm = Date.now() + Math.max(0, estado.config.atrasoMinutos) * 60_000
    }
  }
}

async function criarTicket(estado, { nome, de, assunto, corpo, data, messageId }, lojaId = 'loja1') {
  const base = {
    id: uid(), nome, de, assunto, corpo, lojaId,
    data: data || new Date().toISOString(),
    lido: false, origem: 'cliente',
    categoria: classificarLocal(assunto + ' ' + corpo),
    idioma: detectarIdiomaLocal(assunto + ' ' + corpo),
    status: 'inbox',
  }
  if (messageId) estado.emailsProcessados.push(messageId)

  if (pareceSpam(assunto, corpo, de)) {
    base.status = 'spam'
    return base
  }

  const r = await processarEmail(estado, base)
  if (r.spam) {
    base.status = 'spam'
    return base
  }
  aplicarResultado(estado, base, r)
  return base
}

/* ---------------- Conversas (threading) ---------------- */

const normalizarAssunto = s =>
  String(s || '').replace(/^\s*((re|fwd?|enc|aw|sv)\s*:\s*)+/i, '').trim().toLowerCase()

function acharConversa(estado, de, assunto, lojaId) {
  const alvo = normalizarAssunto(assunto)
  return estado.tickets.find(t =>
    (t.lojaId ?? 'loja1') === lojaId &&
    t.de.toLowerCase() === de.toLowerCase() &&
    normalizarAssunto(t.assunto) === alvo &&
    !['spam', 'lixeira'].includes(t.status))
}

async function anexarNaConversa(estado, t, { corpo, data, messageId }) {
  if (messageId) estado.emailsProcessados.push(messageId)

  t.historico = t.historico || []
  if (t.corpo) t.historico.push({ autor: 'cliente', corpo: t.corpo, data: t.data, traducao: t.traducao })
  if (t.resposta) t.historico.push({ autor: 'atendo', corpo: t.resposta, data: t.respondidoEm || t.data })

  t.corpo = corpo
  t.data = data || new Date().toISOString()
  t.lido = false
  t.resposta = undefined
  t.respondidoEm = undefined
  t.enviaEm = undefined
  t.erroEnvio = undefined
  t.tentativasEnvio = undefined
  t.traducao = undefined

  if (pareceSpam(t.assunto, corpo, t.de)) {
    // a conversa se revelou spam (ex.: abriu como cliente e virou oferta comercial)
    t.status = 'spam'
    t.enviaEm = undefined
  } else if (t.iaPausada) {
    t.status = 'humano'
    t.motivoEscalada = 'IA pausada nesta conversa — responda manualmente ou retome a IA'
  } else {
    const r = await processarEmail(estado, t)
    if (r.spam) {
      t.status = 'spam'
      t.rascunho = undefined
      t.enviaEm = undefined
      if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
    } else {
      aplicarResultado(estado, t, r)
    }
  }

  estado.tickets = [t, ...estado.tickets.filter(x => x.id !== t.id)]
}

/* ---------------- Sincronização ---------------- */

const sincronizando = new Set()

async function sincronizar(wsId) {
  if (sincronizando.has(wsId)) return 0
  sincronizando.add(wsId)
  const estado = workspaces.get(wsId)
  try {
    let novos = 0

    for (const [i, loja] of estado.lojas.entries()) {
      const cx = conexaoDaLoja(loja, i)
      if (!cx) continue
      const [rp, rprod] = await Promise.all([buscarPedidosShopify(cx), buscarProdutosShopify(cx)])
      if (rp.pedidos) {
        estado.pedidos = [...estado.pedidos.filter(p => (p.lojaId ?? 'loja1') !== loja.id), ...rp.pedidos.map(p => ({ ...p, lojaId: loja.id }))]
      }
      if (rprod.produtos) {
        estado.produtos = [...(estado.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== loja.id), ...rprod.produtos.map(p => ({ ...p, lojaId: loja.id }))]
      }
    }

    if (algumEmail(wsId)) {
      for (const conta of contasDe(wsId)) {
        if (!conta.configurado) continue
        const emails = await conta.buscarNovos(estado.emailsProcessados)
        for (const e of emails) {
          const conversa = acharConversa(estado, e.de, e.assunto, conta.id)
          if (conversa) {
            await anexarNaConversa(estado, conversa, e)
          } else {
            estado.tickets.unshift(await criarTicket(estado, e, conta.id))
          }
          novos++
        }
      }
    } else {
      // Modo demonstração
      const existentes = new Set(estado.tickets.map(t => t.de + '|' + t.assunto))
      const agora = Date.now()
      let i = 0
      for (const e of demoEmails) {
        if (existentes.has(e.de + '|' + e.assunto)) continue
        const t = await criarTicket(estado, { ...e, data: new Date(agora - ++i * 3600_000 * 3).toISOString() })
        estado.tickets.unshift(t)
        novos++
      }
      for (const e of demoSpam) {
        if (existentes.has(e.de + '|' + e.assunto)) continue
        estado.tickets.unshift({
          id: uid(), ...e, lojaId: 'loja1', data: new Date(agora - ++i * 3600_000 * 4).toISOString(),
          lido: false, origem: 'cliente', categoria: 'outro', idioma: 'pt', status: 'spam',
        })
        novos++
      }
    }

    if (novos > 0) salvar(wsId)
    return novos
  } finally {
    sincronizando.delete(wsId)
  }
}

/* ---------------- Envio ---------------- */

async function enviarResposta(wsId, ticket, texto) {
  const conta = contaDaLoja(wsId, ticket.lojaId ?? 'loja1')
  const contas = contasDe(wsId)
  const canal = conta?.configurado || envioPorApi ? conta : contas.find(c => c.configurado)
  if (canal) {
    await canal.enviar({ para: ticket.de, assunto: ticket.assunto, corpo: texto })
  }
  // Nova resposta numa conversa já respondida: arquiva a troca anterior no
  // histórico antes de sobrescrever, para nada se perder na tela.
  if (ticket.status === 'enviado' && ticket.resposta) {
    ticket.historico = ticket.historico || []
    if (ticket.corpo) {
      ticket.historico.push({ autor: 'cliente', corpo: ticket.corpo, data: ticket.data, traducao: ticket.traducao })
      ticket.corpo = ''
      ticket.traducao = undefined
    }
    ticket.historico.push({ autor: 'atendo', corpo: ticket.resposta, data: ticket.respondidoEm || ticket.data })
    ticket.respostaTraducao = undefined
  }
  ticket.status = 'enviado'
  ticket.resposta = texto
  ticket.rascunho = texto
  ticket.respondidoEm = new Date().toISOString()
  ticket.enviaEm = undefined
  ticket.lido = true
}

const enviando = new Set()
const MAX_TENTATIVAS = 3

setInterval(async () => {
  const agora = Date.now()
  for (const [wsId, estado] of workspaces) {
    const vencidos = estado.tickets.filter(t =>
      t.status === 'aprovacao' && t.enviaEm && t.enviaEm <= agora && !t.iaPausada && !enviando.has(t.id))
    if (!vencidos.length) continue
    for (const t of vencidos) {
      enviando.add(t.id)
      try {
        await enviarResposta(wsId, t, t.rascunho || '')
        t.erroEnvio = undefined
        t.tentativasEnvio = undefined
      } catch (err) {
        t.tentativasEnvio = (t.tentativasEnvio || 0) + 1
        t.erroEnvio = err.message
        console.error(`[auto-envio ${wsId}] tentativa ${t.tentativasEnvio}/${MAX_TENTATIVAS} falhou para ${t.de}: ${err.message}`)
        if (t.tentativasEnvio >= MAX_TENTATIVAS) {
          t.status = 'humano'
          t.enviaEm = undefined
          t.motivoEscalada = `Não foi possível enviar após ${MAX_TENTATIVAS} tentativas: ${err.message}`
        } else {
          t.enviaEm = agora + t.tentativasEnvio * 60_000
        }
      } finally {
        enviando.delete(t.id)
      }
    }
    salvar(wsId)
  }
}, 5000)

// Leitura periódica das caixas de todos os workspaces
setInterval(() => {
  for (const wsId of workspaces.keys()) {
    if (algumEmail(wsId)) sincronizar(wsId).catch(err => console.error(`[sync ${wsId}]`, err.message))
  }
}, 60_000)

/* ---------------- Rotas ---------------- */

app.get('/api/state', (req, res) => ok(req, res))

app.post('/api/sync', async (req, res) => {
  try {
    const novos = await sincronizar(req.wsId)
    res.json({ novos, state: visao(req.wsId) })
  } catch (err) {
    console.error('[sync]', err.message)
    res.status(500).json({ erro: err.message, state: visao(req.wsId) })
  }
})

/* ---- E-mail por loja (formulário do site) ---- */

app.post('/api/email/testar-config', async (req, res) => {
  const r = await testarConfig(req.body ?? {})
  res.json({ resultado: r })
})

app.post('/api/lojas/:id/email', async (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  const { provider, user, pass, from, remetenteNome, imapHost, smtpHost, imapPort, smtpPort } = req.body ?? {}
  if (!user || !pass) return res.status(400).json({ erro: 'Endereço e senha são obrigatórios.', state: visao(req.wsId) })

  const cfg = montarConfig({ provider, user, pass, from, remetenteNome, imapHost, smtpHost, imapPort, smtpPort })
  if (!cfg.imapHost || !cfg.smtpHost) {
    return res.status(400).json({ erro: 'Escolha um provedor ou informe os servidores IMAP e SMTP.', state: visao(req.wsId) })
  }
  // valida antes de salvar — ninguém quer guardar credencial que não conecta
  const teste = await testarConfig({ provider, user, pass, from, remetenteNome, imapHost, smtpHost, imapPort, smtpPort })
  if (!teste.leitura?.ok) {
    return res.status(400).json({ erro: teste.leitura?.erro || 'Não foi possível conectar com essas credenciais.', state: visao(req.wsId) })
  }

  loja.emailCfg = {
    provider: cfg.provider,
    user: cfg.user,
    passCifrada: cifrar(cfg.pass, segredo),
    from: cfg.from,
    remetenteNome: cfg.remetenteNome,
    imapHost: cfg.imapHost,
    smtpHost: cfg.smtpHost,
    imapPort: cfg.imapPort,
    smtpPort: cfg.smtpPort,
  }
  loja.ativa = true
  cacheContas.delete(req.wsId)
  salvar(req.wsId)
  sincronizar(req.wsId).catch(() => {})
  ok(req, res)
})

app.delete('/api/lojas/:id/email', (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (loja) {
    delete loja.emailCfg
    cacheContas.delete(req.wsId)
    salvar(req.wsId)
  }
  ok(req, res)
})

app.post('/api/email/testar', async (req, res) => {
  const alvo = req.query.loja
  const contas = contasDe(req.wsId)
  for (const conta of contas) {
    if (alvo && conta.id !== alvo) continue
    if (!conta.configurado && !envioPorApi) continue
    await conta.verificarConexao()
    conta.status.envio = await conta.verificarEnvio()
  }
  const conta1 = contas.find(c => c.id === (alvo || 'loja1')) ?? contas[0]
  res.json({ status: { ...conta1.status, envioPorApi, remetente: conta1.remetente }, state: visao(req.wsId) })
})

app.post('/api/email/diagnostico', async (req, res) => {
  try {
    const conta = contaDaLoja(req.wsId, req.query.loja ?? 'loja1')
    const d = await conta.diagnosticar(req.estado.emailsProcessados)
    res.json({ diagnostico: d, state: visao(req.wsId) })
  } catch (err) {
    res.json({ diagnostico: { ok: false, erro: err.message }, state: visao(req.wsId) })
  }
})

app.post('/api/ia/testar', async (req, res) => {
  const s = await testarIA()
  res.json({ status: s, state: visao(req.wsId) })
})

/* ---- OAuth da Shopify ---- */

const noncesOAuth = new Map()
const baseUrl = req => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

async function sincronizarLoja(wsId, lojaId) {
  const estado = workspaces.get(wsId)
  const loja = estado?.lojas.find(l => l.id === lojaId)
  const cx = estado ? conexaoLoja(estado, lojaId) : null
  if (!loja || !cx) return { ok: false, erro: 'Shopify não conectada para esta loja.' }
  const chave = `${wsId}:${lojaId}`
  const t = await testarShopify(cx)
  statusShopifyPorLoja.set(chave, { ok: t.ok, erro: t.erro, verificadoEm: t.verificadoEm, loja: cx.loja, modo: cx.modo })
  if (!t.ok) return t
  if (t.moeda) loja.moeda = t.moeda
  const [rp, rprod] = await Promise.all([buscarPedidosShopify(cx), buscarProdutosShopify(cx)])
  if (rp.pedidos) {
    estado.pedidos = [...estado.pedidos.filter(p => (p.lojaId ?? 'loja1') !== lojaId), ...rp.pedidos.map(p => ({ ...p, lojaId }))]
  }
  if (rprod.produtos) {
    estado.produtos = [...(estado.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== lojaId), ...rprod.produtos.map(p => ({ ...p, lojaId }))]
  }
  statusShopifyPorLoja.get(chave).pedidos = estado.pedidos.filter(p => p.lojaId === lojaId).length
  salvar(wsId)
  return t
}

app.get('/api/shopify/instalar', (req, res) => {
  try {
    const lojaId = req.estado.lojas.some(l => l.id === req.query.lojaId) ? req.query.lojaId : 'loja1'
    const cred = appDaLoja(req.estado, lojaId)
    const nonce = crypto.randomBytes(16).toString('hex')
    const redirectUri = `${baseUrl(req)}/api/shopify/callback`
    const { url } = urlInstalacao(cred, req.query.loja, redirectUri, nonce)
    noncesOAuth.set(nonce, { wsId: req.wsId, lojaId, criadoEm: Date.now() })
    for (const [k, v] of noncesOAuth) if (Date.now() - v.criadoEm > 600_000) noncesOAuth.delete(k)
    res.redirect(url)
  } catch (err) {
    res.status(400).send(`Não foi possível iniciar a instalação: ${err.message}`)
  }
})

/** App próprio da Shopify por loja (cada organização usa o seu). */
app.post('/api/lojas/:id/shopify-app', (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  const clientId = String(req.body?.clientId || '').trim()
  const clientSecret = String(req.body?.clientSecret || '').trim()
  if (!clientId || !clientSecret) {
    return res.status(400).json({ erro: 'Preencha o Client ID e o Client secret do app.', state: visao(req.wsId) })
  }
  loja.shopifyApp = { clientId, secretCifrado: cifrar(clientSecret, segredo) }
  salvar(req.wsId); ok(req, res)
})

app.delete('/api/lojas/:id/shopify-app', (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (loja) { delete loja.shopifyApp; salvar(req.wsId) }
  ok(req, res)
})

/** Conexão direta com um Admin API access token colado (lojas com app personalizado antigo). */
app.post('/api/lojas/:id/shopify-token', async (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  const dominio = normalizarDominio(req.body?.dominio || '')
  const token = String(req.body?.token || '').trim()
  if (!dominio || !token) {
    return res.status(400).json({ erro: 'Preencha o endereço da loja e o token de acesso.', state: visao(req.wsId) })
  }
  // valida antes de salvar
  const teste = await testarShopify({ loja: dominio, token })
  if (!teste.ok) {
    return res.status(400).json({ erro: teste.erro || 'A Shopify recusou o token.', state: visao(req.wsId) })
  }
  loja.shopify = { loja: dominio, token, instaladoEm: new Date().toISOString() }
  loja.ativa = true
  salvar(req.wsId)
  await sincronizarLoja(req.wsId, loja.id)
  ok(req, res)
})

app.get('/api/shopify/callback', async (req, res) => {
  const { shop, code, state: nonce } = req.query
  const pendente = noncesOAuth.get(nonce)
  const falhar = msg => res.status(400).send(`${msg} <a href="/#/configuracoes">Voltar ao atendo</a>`)

  if (!pendente) return falhar('Pedido de instalação expirado ou desconhecido. Tente conectar novamente.')
  noncesOAuth.delete(nonce)
  const estadoWs = workspaces.get(pendente.wsId)
  if (!estadoWs) return falhar('Sessão não encontrada. Entre no atendo e tente de novo.')
  const cred = appDaLoja(estadoWs, pendente.lojaId)
  if (!hmacValido(req.query, cred?.clientSecret)) return falhar('Assinatura inválida no retorno da Shopify. A instalação foi cancelada por segurança.')
  if (!shop || !code) return falhar('A Shopify não devolveu os dados esperados.')

  try {
    const { loja, token } = await trocarCodigoPorToken(cred, shop, code)
    const estado = estadoWs
    const alvo = estado.lojas.find(l => l.id === pendente.lojaId) ?? estado.lojas[0]
    alvo.shopify = { loja, token, instaladoEm: new Date().toISOString() }
    alvo.ativa = true
    salvar(pendente.wsId)
    await sincronizarLoja(pendente.wsId, alvo.id)
    console.log(`[shopify] ${pendente.wsId}/${alvo.id} conectada via OAuth: ${loja}`)
    res.redirect('/#/configuracoes')
  } catch (err) {
    console.error('[shopify] OAuth falhou:', err.message)
    falhar(err.message)
  }
})

app.post('/api/shopify/desconectar', (req, res) => {
  const lojaId = req.body?.lojaId ?? 'loja1'
  const loja = req.estado.lojas.find(l => l.id === lojaId)
  if (loja) {
    loja.shopify = { loja: null, token: null, instaladoEm: null }
    req.estado.pedidos = req.estado.pedidos.filter(p => (p.lojaId ?? 'loja1') !== lojaId)
    req.estado.produtos = (req.estado.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== lojaId)
    statusShopifyPorLoja.delete(`${req.wsId}:${lojaId}`)
    salvar(req.wsId)
  }
  ok(req, res)
})

app.post('/api/shopify/testar', async (req, res) => {
  const lojaId = req.query.lojaId ?? req.body?.lojaId ?? 'loja1'
  const s = await sincronizarLoja(req.wsId, lojaId)
  res.json({ status: statusShopifyPorLoja.get(`${req.wsId}:${lojaId}`) ?? s, state: visao(req.wsId) })
})

const IDIOMAS_RESPOSTA = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'it', 'nl']

app.post('/api/lojas', (req, res) => {
  const { id, nome, ativa, idioma } = req.body ?? {}
  const loja = req.estado.lojas.find(l => l.id === id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  if (typeof nome === 'string' && nome.trim()) loja.nome = nome.trim()
  if (typeof ativa === 'boolean' && loja.id !== 'loja1') loja.ativa = ativa
  if (typeof idioma === 'string' && IDIOMAS_RESPOSTA.includes(idioma)) loja.idioma = idioma
  salvar(req.wsId); ok(req, res)
})

app.post('/api/lojas/nova', (req, res) => {
  const lojas = req.estado.lojas
  if (lojas.length >= MAX_LOJAS) {
    return res.status(400).json({ erro: `Limite de ${MAX_LOJAS} lojas por conta.`, state: visao(req.wsId) })
  }
  // primeiro id livre no padrão lojaN, para os sufixos de env continuarem alinhados
  let n = 1
  while (lojas.some(l => l.id === `loja${n}`)) n++
  const nome = String(req.body?.nome || '').trim() || `loja ${lojas.length + 1}`
  const loja = { ...lojaPadrao(`loja${n}`, nome), ativa: true }
  lojas.push(loja)
  salvar(req.wsId)
  res.json({ lojaId: loja.id, state: visao(req.wsId) })
})

/* ---- Tickets ---- */

const acharTicket = (req, res) => {
  const t = req.estado.tickets.find(x => x.id === req.params.id)
  if (!t) res.status(404).json({ erro: 'ticket não encontrado', state: visao(req.wsId) })
  return t
}

app.post('/api/tickets/:id/lido', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.lido = true; salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/rascunho', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.rascunho = String(req.body.texto ?? '')
  t.rascunhoTraducao = undefined // texto mudou — tradução antiga não vale mais
  salvar(req.wsId); ok(req, res)
})

// Refaz o rascunho com uma instrução do lojista ("ofereça 10% de desconto", "seja mais curto"…)
app.post('/api/tickets/:id/regenerar', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  if (!iaConfigurada) {
    return res.status(400).json({ erro: 'Gerar nova resposta usa o Claude — configure a ANTHROPIC_API_KEY primeiro.', state: visao(req.wsId) })
  }
  const instrucao = String(req.body.instrucao || '').trim()
  const r = await processarEmailIA(req.estado, t, instrucao || 'Reescreva a resposta da melhor forma possível.')
  if (!r || !r.resposta) {
    return res.status(400).json({ erro: statusIA.erro || 'A IA não devolveu uma resposta. Tente de novo.', state: visao(req.wsId) })
  }
  t.rascunho = r.resposta
  t.rascunhoTraducao = undefined
  t.confianca = r.confianca
  t.geradoPorIA = true
  if (r.situacao) t.resumoSituacao = r.situacao
  if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
  salvar(req.wsId); ok(req, res)
})

// Traduz o rascunho para o lojista ler — Google, gratuito; o envio usa o original
app.post('/api/tickets/:id/traduzir-rascunho', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  if (!t.rascunho) return res.status(400).json({ erro: 'Este ticket não tem rascunho para traduzir.', state: visao(req.wsId) })
  if (!t.rascunhoTraducao) {
    const r = await traduzirGratis([t.rascunho])
    if (r.erro) return res.status(400).json({ erro: r.erro, state: visao(req.wsId) })
    t.rascunhoTraducao = r.textos[0]
    salvar(req.wsId)
  }
  ok(req, res)
})

app.post('/api/tickets/:id/aprovar', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  try {
    await enviarResposta(req.wsId, t, String(req.body.texto ?? t.rascunho ?? ''))
    salvar(req.wsId); ok(req, res)
  } catch (err) {
    console.error('[enviar]', err)
    res.status(500).json({ erro: 'Falha ao enviar: ' + err.message, state: visao(req.wsId) })
  }
})

app.post('/api/tickets/:id/pausar-ia', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.iaPausada = !!req.body.pausar
  if (t.iaPausada) t.enviaEm = undefined
  salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/traduzir', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  // conversa inteira: mensagens do cliente E as respostas da loja
  const alvos = []
  for (const m of t.historico ?? []) {
    if (m.corpo && !m.traducao) alvos.push({ corpo: m.corpo, aplicar: tx => { m.traducao = tx } })
  }
  if (t.corpo && !t.traducao) alvos.push({ corpo: t.corpo, aplicar: tx => { t.traducao = tx } })
  if (t.resposta && !t.respostaTraducao) alvos.push({ corpo: t.resposta, aplicar: tx => { t.respostaTraducao = tx } })
  if (!alvos.length) return ok(req, res)
  // tradução pelo Google (gratuita) — não gasta créditos da Claude
  const r = await traduzirGratis(alvos.map(a => a.corpo))
  if (r.erro) return res.status(400).json({ erro: r.erro, state: visao(req.wsId) })
  r.textos.forEach((texto, i) => alvos[i].aplicar(texto))
  salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/mover', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const destinos = ['inbox', 'aprovacao', 'humano', 'spam', 'lixeira']
  if (!destinos.includes(req.body.status)) return res.status(400).json({ erro: 'status inválido', state: visao(req.wsId) })
  t.statusAnterior = t.status
  t.status = req.body.status
  if (req.body.motivo) t.motivoEscalada = req.body.motivo
  t.enviaEm = undefined
  salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/restaurar', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.status = t.statusAnterior && t.statusAnterior !== 'lixeira' ? t.statusAnterior : 'inbox'
  salvar(req.wsId); ok(req, res)
})

app.delete('/api/tickets/:id', (req, res) => {
  req.estado.tickets = req.estado.tickets.filter(x => x.id !== req.params.id)
  salvar(req.wsId); ok(req, res)
})

app.post('/api/compose', async (req, res) => {
  const { para, assunto, corpo } = req.body
  if (!para || !assunto) return res.status(400).json({ erro: 'para e assunto são obrigatórios', state: visao(req.wsId) })
  try {
    const lojaId = req.estado.lojas.some(l => l.id === req.body.lojaId) ? req.body.lojaId : 'loja1'
    const conta = contaDaLoja(req.wsId, lojaId)
    if (conta.configurado || envioPorApi) {
      await conta.enviar({ para, assunto: assunto.replace(/^Re: /, ''), corpo: corpo || '' })
    }
    req.estado.tickets.unshift({
      id: uid(), nome: para.split('@')[0], de: para, assunto, corpo: '', lojaId,
      data: new Date().toISOString(), lido: true, origem: 'cliente',
      categoria: 'outro', idioma: 'pt', status: 'enviado',
      resposta: corpo || '', respondidoEm: new Date().toISOString(),
    })
    salvar(req.wsId); ok(req, res)
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao enviar: ' + err.message, state: visao(req.wsId) })
  }
})

/* ---- Conhecimento ---- */

app.post('/api/politicas', (req, res) => {
  req.estado.politicas.push({ id: uid(), titulo: req.body.titulo, conteudo: req.body.conteudo, ativa: true })
  salvar(req.wsId); ok(req, res)
})
app.post('/api/politicas/:id/toggle', (req, res) => {
  req.estado.politicas = req.estado.politicas.map(p => (p.id === req.params.id ? { ...p, ativa: !p.ativa } : p))
  salvar(req.wsId); ok(req, res)
})
app.delete('/api/politicas/:id', (req, res) => {
  req.estado.politicas = req.estado.politicas.filter(p => p.id !== req.params.id)
  salvar(req.wsId); ok(req, res)
})
app.post('/api/politicas/sugeridas', (req, res) => {
  for (const p of politicasSugeridas) {
    if (!req.estado.politicas.some(x => x.titulo === p.titulo)) req.estado.politicas.push({ ...p, id: uid(), ativa: true })
  }
  salvar(req.wsId); ok(req, res)
})

app.post('/api/comportamentos', (req, res) => {
  const situacao = String(req.body.situacao || '').trim()
  const instrucao = String(req.body.instrucao || '').trim()
  if (!situacao || !instrucao) return res.status(400).json({ erro: 'Descreva a situação e como a IA deve agir.', state: visao(req.wsId) })
  req.estado.comportamentos ??= []
  req.estado.comportamentos.push({ id: uid(), situacao, instrucao, ativa: true })
  salvar(req.wsId); ok(req, res)
})
app.post('/api/comportamentos/:id/toggle', (req, res) => {
  req.estado.comportamentos = (req.estado.comportamentos ?? []).map(c => (c.id === req.params.id ? { ...c, ativa: !c.ativa } : c))
  salvar(req.wsId); ok(req, res)
})
app.delete('/api/comportamentos/:id', (req, res) => {
  req.estado.comportamentos = (req.estado.comportamentos ?? []).filter(c => c.id !== req.params.id)
  salvar(req.wsId); ok(req, res)
})

app.post('/api/faqs', (req, res) => {
  req.estado.faqs.push({ id: uid(), pergunta: req.body.pergunta, resposta: req.body.resposta, ativa: true })
  salvar(req.wsId); ok(req, res)
})
app.post('/api/faqs/:id/toggle', (req, res) => {
  req.estado.faqs = req.estado.faqs.map(f => (f.id === req.params.id ? { ...f, ativa: !f.ativa } : f))
  salvar(req.wsId); ok(req, res)
})
app.delete('/api/faqs/:id', (req, res) => {
  req.estado.faqs = req.estado.faqs.filter(f => f.id !== req.params.id)
  salvar(req.wsId); ok(req, res)
})
app.post('/api/faqs/biblioteca', (req, res) => {
  for (const b of bibliotecaEcommerce) {
    if (!req.estado.faqs.some(f => f.pergunta === b.pergunta)) req.estado.faqs.push({ ...b, id: uid(), ativa: true })
  }
  salvar(req.wsId); ok(req, res)
})

/* ---- Config ---- */

app.post('/api/config', (req, res) => {
  const permitidos = ['assinatura', 'atrasoMinutos', 'automacaoAtiva', 'tomDetectado', 'emailConectado', 'shopifyConectada', 'escalarSensiveis', 'confiancaMinima']
  for (const k of permitidos) {
    if (k in req.body) req.estado.config[k] = req.body[k]
  }
  if (typeof req.body.nomeLoja === 'string' && req.body.nomeLoja.trim()) {
    req.estado.lojas[0].nome = req.body.nomeLoja.trim()
  }
  salvar(req.wsId); ok(req, res)
})

app.post('/api/shopify/demo', (req, res) => {
  if (!algumaShopify(req.estado)) {
    req.estado.config.shopifyConectada = true
    req.estado.pedidos = demoPedidos.map(p => ({ ...p, lojaId: 'loja1' }))
  }
  salvar(req.wsId); ok(req, res)
})

app.post('/api/reset', (req, res) => {
  workspaces.set(req.wsId, structuredClone(estadoInicial))
  req.estado = workspaces.get(req.wsId)
  cacheContas.delete(req.wsId)
  salvar(req.wsId); ok(req, res)
})

/* ---------------- Estáticos ---------------- */

const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist))
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))

/* ---------------- Boot ---------------- */

const PORT = Number(process.env.PORT || 8787)

async function iniciar() {
  await db.iniciarDb()
  segredo = await db.obterSegredo()
  await carregarWorkspaces()

  app.listen(PORT, async () => {
    console.log(`atendo servidor na porta ${PORT}`)
    console.log(`  banco:   ${db.usandoPostgres ? 'PostgreSQL' : 'arquivos locais (defina DATABASE_URL para usar o Postgres)'}`)
    console.log(`  workspaces: ${workspaces.size}`)
    console.log(`  oauth shopify: ${oauthDisponivel ? 'pronto' : 'não configurado'}`)
    console.log(`  ia:      ${iaConfigurada ? 'Claude conectado' : 'não configurada (respostas por regras)'}`)
    if (iaConfigurada) {
      const t = await testarIA()
      console.log(t.ok ? `  IA OK — usando ${t.modelo}` : `  IA FALHOU: ${t.erro}`)
    }
    for (const wsId of workspaces.keys()) {
      if (algumEmail(wsId)) sincronizar(wsId).catch(err => console.error(`[sync ${wsId}]`, err.message))
    }
  })
}

iniciar().catch(err => {
  console.error('Falha ao iniciar:', err)
  process.exit(1)
})
