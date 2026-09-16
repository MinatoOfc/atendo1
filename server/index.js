import express from 'express'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { carregar, uid, estadoInicial, lojaPadrao } from './store.js'
import {
  demoEmails, demoSpam, demoPedidos, bibliotecaEcommerce, politicasSugeridas,
  classificarLocal, detectarIdiomaLocal, pareceSpam, confirmacaoIndevida, textoProprio,
} from './logic.js'
import { processarEmail, processarEmailIA, iaConfigurada, testarIA, statusIA, extrairMotivosReembolso, CATEGORIAS_REEMBOLSO, classificarNovo, escreverNovo, inferirFasesHistoricas } from './ai.js'
import {
  modoDaLoja, novoEstado, decidir, confirmarTransicao, validarProposta, cupomDaFase,
  horarioMinimoEnvio, promptClassificar, promptEscrever, FASES, JORNADAS, PERCENTUAIS_CUPOM,
  faltaPara, conferirTextoDaFase, diferencaDeOferta, instrucaoAlteraOferta, faseDeConfirmacao, FASES_HUMANAS,
  definirIdioma, normalizarIdioma, conferirIdioma, IDIOMAS_VALIDADOS,
} from './atendimento.js'
import { traduzirGratis } from './traducao.js'
import { calcularCentral, ehCandidatoMigracao, statusMigracao, normalizarInferencia, FASES_MIGRAVEIS } from '../shared/central.js'
import { paginaPipeline, dadosPipeline, filtrosDaConsulta } from './pipeline-externo.js'
import { numerosDePedido, emailsCitados } from './refs.js'
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

/* ---------------- Ciclo de vida (intervalos e encerramento) ---------------- */
const intervalos = []
const tarefasUnicas = []
let encerrado = false
const agendar = (fn, ms) => { const h = setInterval(fn, ms); intervalos.push(h); return h }
// tarefa única de arranque (faxina, relatório semanal): não segura o processo vivo
const agendarUmaVez = (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); tarefasUnicas.push(h); return h }
let servidorHttp = null
/** Para intervalos e tarefas, descarrega gravações pendentes e fecha o servidor HTTP — os testes encerram sem process.exit. */
export async function encerrar() {
  encerrado = true
  for (const h of intervalos) clearInterval(h)
  for (const h of tarefasUnicas) clearTimeout(h)
  intervalos.length = 0; tarefasUnicas.length = 0
  for (const wsId of [...salvarPendentes.keys()]) await gravarAgora(wsId)
  if (servidorHttp) {
    const srv = servidorHttp; servidorHttp = null
    srv.closeAllConnections?.()
    await new Promise(r => srv.close(() => r()))
  }
}
app.set('trust proxy', 1) // Railway fica atrás de proxy
app.use(express.json({ limit: '1mb' }))

/* ---------------- Estado por workspace ---------------- */

let segredo = null
const workspaces = new Map() // id → estado

/* Gravação com coalescência: várias mudanças em ~1,5s viram UMA escrita no
   Postgres. O estado é um JSONB grande regravado inteiro — sem isso, cada
   clique/sync gerava WAL enorme (foi o que encheu o disco em produção). */
const salvarPendentes = new Map() // wsId → timer

const salvar = wsId => {
  if (salvarPendentes.has(wsId)) return
  salvarPendentes.set(wsId, setTimeout(() => gravarAgora(wsId), 1500))
}

// Falha de gravação NUNCA pode ser silenciosa: o disco cheio em produção fez o
// lojista trabalhar horas sem persistir nada. Registra o erro (vai para a visao
// e vira banner vermelho no app) e retenta sozinho a cada 30s.
let erroBanco = null // string | null

function gravarAgora(wsId) {
  const timer = salvarPendentes.get(wsId)
  if (timer) clearTimeout(timer)
  salvarPendentes.delete(wsId)
  const estado = workspaces.get(wsId)
  if (!estado) return Promise.resolve()
  return db.salvarWorkspace(wsId, estado)
    .then(() => { erroBanco = null })
    .catch(err => {
      erroBanco = err.message
      console.error('[db] salvar falhou:', err.message)
      if (!encerrado) setTimeout(() => salvar(wsId), 30_000) // retenta até conseguir
    })
}

// deploy/restart (SIGTERM): descarrega as gravações pendentes antes de morrer
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, async () => {
    try {
      await Promise.all([...salvarPendentes.keys()].map(id => gravarAgora(id)))
    } finally {
      process.exit(0)
    }
  })
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
  // conta removida pelo lojista no site: as variáveis de ambiente não voltam sozinhas
  if (loja?.emailEnvIgnorado) return { cfg: montarConfig({}), origem: null }
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

/** Catálogo das fases para a página e para a Central (mesmo formato nos dois). */
const catalogoFases = () => Object.fromEntries(Object.entries(FASES).map(([id, f]) => [id, { titulo: f.titulo, jornada: f.jornada, aoAceitar: f.aoAceitar, aoRecusar: f.aoRecusar, oferta: f.oferta, instrucao: f.instrucao, confirmacao: !!f.confirmacao, decisaoDono: FASES_HUMANAS.has(id) }]))

/**
 * Motor de UMA conversa: fica gravado em ticket.motor no momento em que ela
 * nasce (pelo modo da loja naquele dia) e não muda quando a loja troca de modo.
 * Conversas antigas sem o campo: novo se já têm estado do motor, senão clássico.
 */
const motorDaConversa = t => (t?.motor === 'novo' || t?.motor === 'classico') ? t.motor : (t?.atendimentoNovo ? 'novo' : 'classico')

/** Cupons que o mapa usa (percentuais das fases com cupom). */
const CUPONS_NECESSARIOS = [...new Set(Object.values(FASES).map(f => f.oferta?.cupom).filter(Boolean))].sort((a, b) => a - b)

/** Durante o piloto o envio automático fica bloqueado; só libera com ATENDO_LIBERAR_AUTOENVIO=1. */
const envioAutomaticoLiberado = () => process.env.ATENDO_LIBERAR_AUTOENVIO === '1'

/**
 * Arranque sem ATENDO_LIBERAR_AUTOENVIO=1: toda loja fica com envio automático
 * desligado (mesmo se o estado salvo dizia true) e os agendamentos automáticos
 * do MOTOR NOVO são cancelados — o rascunho continua em Aprovações. O clássico
 * não é tocado.
 */
function neutralizarAutoEnvioNoPiloto() {
  if (envioAutomaticoLiberado()) return
  for (const [wsId, estado] of workspaces) {
    let mudou = false
    for (const l of estado.lojas ?? []) if (l.novoEnvioAutomatico === true) { l.novoEnvioAutomatico = false; mudou = true }
    for (const t of estado.tickets ?? []) {
      if (t.atendimentoNovo?.transicaoPendente?.para && t.enviaEm) {
        t.enviaEm = undefined
        t.atendimentoNovo.envioBloqueado = 'envio automático bloqueado durante o piloto'
        mudou = true
      }
    }
    if (mudou) { console.log(`[piloto] ${wsId}: envio automático do modo novo neutralizado`); salvar(wsId) }
  }
}

/** O que falta para uma loja poder ativar o modo novo — conferido no servidor. */
function prontidaoModoNovo(wsId, loja) {
  const faltando = []
  const propria = contasDe(wsId).find(c => c.id === loja.id) ?? null
  if (!propria || !(propria.configurado || envioPorApi)) faltando.push({ chave: 'email', texto: 'conta de e-mail própria da loja (Configurações → E-mail)' })
  const p = loja.prazoEntrega
  if (!p || !(Number(p.min) > 0) || !(Number(p.max) >= Number(p.min))) faltando.push({ chave: 'prazo', texto: 'prazo de entrega em dias úteis (mínimo e máximo)' })
  const semCupom = CUPONS_NECESSARIOS.filter(pct => !String(loja.cupons?.[String(pct)] ?? '').trim())
  if (semCupom.length) faltando.push({ chave: 'cupons', texto: `cupom de ${semCupom.map(p => p + '%').join(', ')}` })
  return { pronto: faltando.length === 0, faltando }
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
      iaModelo: l.iaModelo || 'claude',
      modoAtendimento: l.modoAtendimento === 'novo' ? 'novo' : 'classico',
      modoDesde: l.modoDesde ?? null,
      modoHistorico: l.modoHistorico ?? [],
      prontidaoNovo: prontidaoModoNovo(wsId, l),
      novoEnvioAutomatico: l.novoEnvioAutomatico === true,
      prazoEntrega: l.prazoEntrega ?? null,
      cupons: l.cupons ?? {},
      assinatura: l.assinatura ?? null,
      email: {
        configurado: conta?.configurado ?? false,
        endereco: conta?.endereco ?? null,
        provider: conta?.provider ?? null,
        remetenteNome: conta?.remetenteNome ?? null,
        origem: conta?.origem ?? null,
        status: conta ? { ...conta.status, envioPorApi, remetente: conta.remetente } : null,
        importacao: importacoes.get(`${wsId}:${l.id}`) ?? null,
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
    resumosDiarios: estado.resumosDiarios ?? [],
    geminiDisponivel: !!process.env.GEMINI_API_KEY,
    // catálogo do modo novo: a conversa mostra fase, oferta e próximos passos por ele
    fasesNovo: catalogoFases(),
    jornadasNovo: JORNADAS,
    gastosIA: estado.gastosIA ?? {},
    envioAutomaticoLiberado: envioAutomaticoLiberado(),
    opcoesRelatorio: estado.opcoesRelatorio ?? [],
    opcoesInstrucao: estado.opcoesInstrucao ?? [],
    relatorioLink: estado.tokenRelatorio ? `/r/${wsId}/${estado.tokenRelatorio}` : null,
    pipelineLink: estado.tokenPipeline ? `/p/${wsId}/${estado.tokenPipeline}` : null,
    linkMostraHoje: estado.linkMostraHoje !== false,
    reembolsosLink: estado.tokenRelatorio && estado.relatorioReembolsos ? `/r/${wsId}/${estado.tokenRelatorio}/reembolsos` : null,
    reembolsosEm: estado.relatorioReembolsos?.geradoEm ?? null,
    bancoErro: erroBanco,
    hojeChave: diaLocal(Date.now()),
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

/** Registra um gasto de IA no livro-caixa do dia (fuso do lojista), por loja. */
function registrarGasto(estado, lojaId, valor) {
  if (!valor) return
  estado.gastosIA ??= {}
  const dia = diaLocal(Date.now())
  const doDia = (estado.gastosIA[dia] ??= {})
  const chave = lojaId ?? 'loja1'
  doDia[chave] = Math.round(((doDia[chave] || 0) + valor) * 1e6) / 1e6
}

function aplicarResultado(estado, t, r) {
  t.categoria = r.categoria
  t.idioma = r.idioma
  t.rascunho = r.resposta
  t.rascunhoTraducao = undefined // rascunho novo — a tradução antiga era de outro texto
  t.confianca = r.confianca
  t.geradoPorIA = r.geradoPorIA
  if (r.situacao) { t.resumoSituacao = r.situacao; t.situacaoTraducao = undefined }
  if (r.resolucao) t.resolucao = r.resolucao
  if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
  registrarGasto(estado, t.lojaId, r.custo)

  const minima = estado.config.confiancaMinima ?? 0.55
  const sensivel = estado.config.escalarSensiveis !== false && r.escalarHumano
  const incerto = r.confianca < minima
  // Regra fixa do código, não da IA: APROVAR reembolso e CONFIRMAR troca
  // esperam decisão humana. O resto do fluxo de devolução (perguntar motivo,
  // oferecer troca/60/100%) roda no automático.
  // Rede de segurança: mesmo que a IA desobedeça e ESCREVA uma confirmação de
  // reembolso/cancelamento/troca (sem levantar as flags), a mensagem nunca sai
  // no automático — é tratada como a decisão que ela tentou tomar
  const confirmouIndevido = confirmacaoIndevida(r.resposta)
  const reembolso = r.aprovaReembolso === true || confirmouIndevido === 'reembolso'
  const troca = r.confirmaTroca === true || confirmouIndevido === 'troca'
  // Resposta vazia nunca pode cair no envio automático — vira caso humano
  const semResposta = !String(r.resposta || '').trim()
  // Resposta igual à última que a loja já mandou também não: repetir a mesma
  // mensagem para um cliente que insistiu é ignorá-lo — vira caso humano
  const normalizar = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const ultimaDaLoja = [...(t.historico ?? [])].reverse().find(m => m.autor === 'atendo')
  const repetida = !semResposta && !!ultimaDaLoja && normalizar(r.resposta) === normalizar(ultimaDaLoja.corpo)

  t.motivoTraducao = undefined // motivo muda junto com o resultado — tradução antiga não vale

  // Mensagem sem nada a responder (agradecimento, "tudo certo"): encerra a
  // conversa como resolvida — nada para um humano fazer, nada a enviar.
  // As travas de decisão (reembolso/troca/sensível) sempre ganham do encerrar.
  if (r.encerrar === true && !sensivel && !reembolso && !troca && !incerto) {
    t.status = 'enviado'
    t.lido = true
    t.decisaoPendente = undefined
    t.rascunho = undefined
    t.rascunhoTraducao = undefined
    t.enviaEm = undefined
    t.motivoEscalada = undefined
    t.respondidoEm = new Date().toISOString()
    t.resolucao = r.resolucao || t.resolucao || 'Encerrada — cliente confirmou que está tudo certo'
    return
  }

  if (sensivel || incerto || reembolso || troca || semResposta || repetida) {
    t.status = 'humano'
    // marca o tipo de decisão: ao responder, o caso entra sozinho no relatório
    t.decisaoPendente = reembolso ? 'reembolso' : troca ? 'troca' : undefined
    // Caso escalado é do lojista: sem mensagem pré-gerada — ele escreve na
    // conversa ou pede à IA na hora ("Gerar com IA"), sem gastar tokens à toa
    t.rascunho = undefined
    t.rascunhoTraducao = undefined
    t.motivoEscalada = confirmouIndevido
      ? `A IA escreveu uma confirmação de ${confirmouIndevido} por conta própria — a aprovação é sua`
      : reembolso
        ? (r.motivo || 'Cliente escolheu reembolso — aprovação é sua')
        : troca
          ? (r.motivo || 'Cliente aceitou a troca — confirme e despache')
          : repetida
            ? 'A IA ia repetir a resposta anterior — o cliente insistiu e continua sem solução'
            : r.motivo || (incerto ? 'Confiança abaixo do mínimo configurado' : 'Caso sensível')
  } else {
    t.status = 'aprovacao'
    t.decisaoPendente = undefined
    t.motivoEscalada = undefined
    if (estado.config.automacaoAtiva) {
      t.enviaEm = Date.now() + Math.max(0, estado.config.atrasoMinutos) * 60_000
    }
  }
}


/* ---------------- Atendimento novo: o motor no pipeline ----------------
   A IA só classifica; a fase gravada no ticket escolhe a única ação permitida;
   a resposta é escrita para essa ação e conferida antes de virar rascunho.
   A transição de fase só é gravada quando o e-mail sai (enviarResposta). */

/** Pedido do cliente desta conversa: pelo número citado, senão o mais recente pelo e-mail. */
function pedidoDoTicket(estado, t) {
  const so = n => String(n ?? '').replace(/\D/g, '')
  const lojaId = t.lojaId ?? 'loja1'
  const numero = numeroDoTicketRelatorio(estado, t)
  if (numero) {
    const p = (estado.pedidos ?? []).find(p => (p.lojaId ?? 'loja1') === lojaId && so(p.numero) === so(numero))
    if (p) return p
  }
  const email = String(t.de || '').trim().toLowerCase()
  return (estado.pedidos ?? [])
    .filter(p => (p.lojaId ?? 'loja1') === lojaId && p.email && p.email.trim().toLowerCase() === email)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0] ?? null
}

const CATEGORIA_DO_FLUXO = {
  tamanho: 'troca', errado: 'troca', defeito: 'troca', qualidade: 'reembolso',
  nao_recebido_status: 'rastreio', nao_recebido_reembolso: 'rastreio', entregue_nao_recebido: 'rastreio',
  cancelamento: 'reembolso',
}
const decisaoDaOferta = o => !o ? undefined
  : /reembolso|cancelamento/.test(o.tipo) ? 'reembolso'
    : /troca|reenvio/.test(o.tipo) ? 'troca' : undefined

const somarCusto = (t, custo) => { if (custo) t.custoIA = Math.round(((t.custoIA || 0) + custo) * 1e6) / 1e6 }

function mandarParaHumanoNovo(t, motivo) {
  const an = t.atendimentoNovo
  t.status = 'humano'
  t.motivoEscalada = motivo
  t.motivoTraducao = undefined
  t.rascunho = undefined
  t.rascunhoTraducao = undefined
  t.enviaEm = undefined
  if (an) { an.aguardando = 'humano'; an.transicaoPendente = null; an.rascunhoGerado = undefined }
}

/**
 * Escreve o rascunho de UMA fase, confere contra ela e agenda o envio. É o
 * único caminho que cria rascunho no modo novo — usado ao chegar mensagem, ao
 * regenerar e depois de o lojista validar a foto. Devolve { ok, motivo }.
 * aoFalhar: 'humano' manda o caso para o lojista; 'manter' não mexe no ticket.
 */
async function prepararRascunhoNovo(estado, t, { faseId, faltando = [], resumo = '', instrucaoEstilo = null, aoFalhar = 'humano' }) {
  const loja = estado.lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
  const pedido = pedidoDoTicket(estado, t)
  const an = t.atendimentoNovo
  const falhar = motivo => { if (aoFalhar === 'humano') mandarParaHumanoNovo(t, motivo); return { ok: false, motivo } }

  const cup = cupomDaFase(faseId, loja, an)
  if (cup.precisa && !cup.codigo) {
    return falhar(`A etapa "${FASES[faseId].titulo}" usa o cupom de ${cup.pct}%, que não está cadastrado nesta loja (Configurações → Loja)`)
  }

  // idioma-alvo da conversa (última mensagem completa do cliente) — a configuração fixa da loja não vale aqui
  const idiomaAlvo = an.idioma ?? normalizarIdioma(t.idioma) ?? null
  const p2 = promptEscrever({ loja, config: estado.config, faseId, faltando, an, pedido, ticket: t, instrucaoEstilo, idiomaAlvo })
  let e = await escreverNovo(p2.system, p2.user)
  if (e.erro) return falhar(`A IA não conseguiu escrever a resposta (${e.erro})`)
  somarCusto(t, e.custo); registrarGasto(estado, t.lojaId, e.custo)

  // idioma: o código declarado no JSON e a detecção local têm de bater com o alvo;
  // uma regeneração com instrução explícita, depois fila humana
  let vi = conferirIdioma(e.r.resposta, idiomaAlvo, e.r.idioma)
  if (!vi.ok) {
    const p3 = promptEscrever({ loja, config: estado.config, faseId, faltando, an, pedido, ticket: t, instrucaoEstilo, idiomaAlvo, instrucaoIdioma: `a resposta anterior saiu no idioma errado (${vi.motivo})` })
    const e2 = await escreverNovo(p3.system, p3.user)
    if (e2.erro) return falhar(`A IA não conseguiu reescrever a resposta no idioma do cliente (${e2.erro})`)
    somarCusto(t, e2.custo); registrarGasto(estado, t.lojaId, e2.custo)
    e = e2
    vi = conferirIdioma(e.r.resposta, idiomaAlvo, e.r.idioma)
    if (!vi.ok) return falhar(`Resposta gerada no idioma errado (${vi.motivo})`)
  }

  // bloqueios: ação proposta, percentuais, cupons e linguagem de confirmação
  if (e.r.acao_proposta && e.r.acao_proposta !== faseId) {
    return falhar(`A IA saiu da etapa permitida: propôs "${e.r.acao_proposta}" em vez de "${faseId}"`)
  }
  const v = conferirTextoDaFase(faseId, e.r.resposta, loja, an, pedido, { faltando, idioma: idiomaAlvo })
  if (!v.ok) return falhar(`A IA saiu da etapa permitida: ${v.motivo}`)
  an.rascunhoIdioma = normalizarIdioma(e.r.idioma) ?? idiomaAlvo

  t.rascunho = String(e.r.resposta || '').trim()
  t.rascunhoTraducao = undefined
  t.geradoPorIA = true
  t.confianca = 1
  t.motivoEscalada = undefined
  t.motivoTraducao = undefined
  t.decisaoPendente = undefined
  t.resolucao = FASES[faseId].titulo
  an.rascunhoGerado = t.rascunho // referência para detectar edição humana que mude a oferta
  an.transicaoPendente = { para: faseId, mensagem: resumo, faltando }
  an.aguardando = 'envio'
  const minimo = horarioMinimoEnvio(t, estado.config.atrasoMinutos)
  an.proximoEnvioMinimo = new Date(minimo).toISOString()
  t.status = 'aprovacao'
  // agenda só com a loja ligada, a automação geral ligada E o envio automático liberado (fora do piloto)
  t.enviaEm = loja?.novoEnvioAutomatico && estado.config.automacaoAtiva && envioAutomaticoLiberado() ? minimo : undefined
  if (loja?.novoEnvioAutomatico && !envioAutomaticoLiberado()) an.envioBloqueado = 'envio automático bloqueado durante o piloto'
  else an.envioBloqueado = undefined
  // idioma que o validador local não lê: gera no idioma do cliente, mas NUNCA sai sozinho
  if (idiomaAlvo && !IDIOMAS_VALIDADOS.has(idiomaAlvo)) {
    an.aprovacaoObrigatoria = v.aviso || `idioma "${idiomaAlvo}" não é validado localmente — aprovação humana obrigatória`
    t.enviaEm = undefined
  } else an.aprovacaoObrigatoria = undefined
  return { ok: true, motivo: null }
}

async function processarNovo(estado, t, { agora = Date.now() } = {}) {
  const loja = estado.lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
  const pedido = pedidoDoTicket(estado, t)
  t.atendimentoNovo ??= novoEstado()
  const an = t.atendimentoNovo
  const identificado = clienteComPedido(estado, t.de, t.lojaId, textoDaConversa(t))

  // 1. classificar (a IA não vê a escada, só o que foi oferecido por último)
  const p1 = promptClassificar({ loja, an, pedido, ticket: t })
  const c = await classificarNovo(p1.system, p1.user)
  if (c.erro) { mandarParaHumanoNovo(t, `A IA não conseguiu classificar a mensagem (${c.erro})`); return { spam: false } }
  somarCusto(t, c.custo); registrarGasto(estado, t.lojaId, c.custo)
  const cls = c.r
  if (cls.spam && !identificado) return { spam: true }
  // idioma-alvo: só uma mensagem completa troca; "ok"/endereço/foto preservam o último confiável
  const idiomaAlvo = definirIdioma(an, cls, t.corpo)
  if (idiomaAlvo) t.idioma = idiomaAlvo
  if (cls.resumo) { t.resumoSituacao = cls.resumo; t.situacaoTraducao = undefined }

  // 2. o servidor decide a única ação permitida
  const d = decidir({ an, cls, pedido, loja, temFoto: !!t.anexos?.length, agora })
  Object.assign(an, d.an)
  if (an.fluxo && CATEGORIA_DO_FLUXO[an.fluxo]) t.categoria = CATEGORIA_DO_FLUXO[an.fluxo]

  if (d.encerrar) {
    t.status = 'enviado'; t.lido = true
    t.rascunho = undefined; t.rascunhoTraducao = undefined; t.enviaEm = undefined
    t.motivoEscalada = undefined; t.decisaoPendente = undefined
    t.respondidoEm = new Date().toISOString()
    t.resolucao = 'Encerrada — cliente confirmou que está tudo certo'
    an.aguardando = null
    return { spam: false }
  }
  if (d.humano) {
    mandarParaHumanoNovo(t, d.humano)
    if (d.aceite) {
      t.decisaoPendente = decisaoDaOferta(d.aceite.oferta)
      t.resolucao = `Aceite pendente: ${FASES[d.aceite.fase]?.titulo ?? d.aceite.fase}${an.produtosAfetados.length ? ' — ' + an.produtosAfetados.join('; ') : ''}`
    }
    return { spam: false }
  }

  // 3. escrever, conferir e agendar — a fase só muda quando o e-mail sair
  await prepararRascunhoNovo(estado, t, { faseId: d.fase, faltando: d.faltando, resumo: cls.resumo || '' })
  return { spam: false }
}

/** Cliente identificado: o remetente tem pedido na loja (pelo e-mail) ou o
 *  texto cita um número de pedido que existe — nunca pode cair no spam. */
function clienteComPedido(estado, de, lojaId, texto) {
  const email = String(de || '').trim().toLowerCase()
  const numeros = numerosDePedido(texto)
  return (estado.pedidos ?? []).some(p =>
    (p.lojaId ?? 'loja1') === (lojaId ?? 'loja1')
    && ((p.email && p.email.trim().toLowerCase() === email)
      || (numeros.size > 0 && p.numero && numeros.has(String(p.numero).replace(/\D/g, '')))))
}

/**
 * Resgata do spam conversas de clientes identificados (marcadas errado por
 * regra antiga ou pela IA). Roda a cada sincronização; respeita o spam que o
 * LOJISTA marcou à mão (spamManual).
 */
function resgatarSpamComPedido(estado) {
  let resgatados = 0
  for (const t of estado.tickets) {
    if (t.status !== 'spam' || t.spamManual) continue
    if (!clienteComPedido(estado, t.de, t.lojaId, textoDaConversa(t))) continue
    t.status = 'inbox'
    t.lido = false
    resgatados++
  }
  return resgatados
}

async function criarTicket(estado, { nome, de, assunto, corpo, data, messageId, anexos }, lojaId = 'loja1', wsId = null) {
  const base = {
    id: uid(), nome, de, assunto, corpo, lojaId,
    data: data || new Date().toISOString(),
    lido: false, origem: 'cliente',
    categoria: classificarLocal(assunto + ' ' + corpo),
    idioma: detectarIdiomaLocal(assunto + ' ' + corpo),
    status: 'inbox',
  }
  if (messageId) estado.emailsProcessados.push(messageId)

  // cliente com pedido na loja NUNCA cai no spam (nem local, nem pela IA)
  const identificado = clienteComPedido(estado, de, lojaId, `${assunto} ${corpo}`)

  if (!identificado && pareceSpam(assunto, corpo, de)) {
    base.status = 'spam'
    return base // spam local: as imagens nem chegam ao banco
  }

  // e-mail passou no filtro local: guarda as imagens (a faxina limpa órfãs)
  if (wsId && anexos?.length) base.anexos = await guardarAnexos(wsId, anexos)

  // o motor da conversa nasce com ela (modo da loja HOJE) e não muda depois
  base.motor = modoDaLoja(estado.lojas.find(l => l.id === lojaId))
  // loja no modo novo: o motor de etapas cuida de tudo (classificar, decidir, escrever)
  if (base.motor === 'novo') {
    const rn = await processarNovo(estado, base)
    if (rn.spam) { base.status = 'spam'; base.anexos = undefined }
    return base
  }

  const r = await processarEmail(estado, base)
  if (r.spam && !identificado) {
    base.status = 'spam'
    base.anexos = undefined // sem referência, a faxina apaga os bytes
    registrarGasto(estado, base.lojaId, r.custo)
    return base
  }
  if (r.spam) {
    // a IA marcou spam (resposta vazia), mas o cliente tem pedido: vai para o lojista
    registrarGasto(estado, base.lojaId, r.custo)
    base.status = 'humano'
    base.motivoEscalada = 'A IA marcou como spam, mas o cliente tem pedido na loja — confira'
    return base
  }
  aplicarResultado(estado, base, r)
  return base
}

/* ---------------- Conversas (threading) ---------------- */

// remove prefixos de resposta/encaminhamento, inclusive numerados: "Re[4]:", "AW:", "WG:"…
export const normalizarAssunto = s =>
  String(s || '').replace(/^\s*((re|fwd?|enc|aw|wg|sv)(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase()

/** Números de pedido citados num texto: "#1784", "Bestellung 1784", "pedido nº 1784"… */
export { numerosDePedido }

export function acharConversa(estado, de, assunto, lojaId, corpo = '') {
  const candidatos = estado.tickets.filter(t =>
    (t.lojaId ?? 'loja1') === lojaId &&
    t.de.toLowerCase() === de.toLowerCase() &&
    !['spam', 'lixeira'].includes(t.status))

  const alvo = normalizarAssunto(assunto)
  const porAssunto = candidatos.find(t => normalizarAssunto(t.assunto) === alvo)
  if (porAssunto) return porAssunto

  // E-mails avulsos do mesmo cliente sobre o MESMO pedido viram uma conversa só,
  // mesmo com assuntos diferentes.
  const numeros = numerosDePedido(`${assunto} ${corpo}`)
  if (!numeros.size) return null
  return candidatos.find(t => {
    const textoConversa = [t.assunto, t.corpo, ...(t.historico ?? []).slice(-6).map(m => m.corpo)].join(' ')
    for (const n of numerosDePedido(textoConversa)) if (numeros.has(n)) return true
    return false
  })
}

const textoDaConversa = t =>
  [t.assunto, t.corpo, ...(t.historico ?? []).slice(-6).map(m => m.corpo)].join(' ')

/** Grava os bytes das imagens no armazenamento e devolve só as referências
 *  {id, nome, tipo} que ficam no ticket. */
async function guardarAnexos(wsId, anexos) {
  const meta = []
  for (const a of anexos ?? []) {
    try {
      const id = crypto.randomUUID()
      await db.salvarAnexo(wsId, { id, tipo: a.tipo, nome: a.nome, dados: a.dados })
      meta.push({ id, nome: a.nome, tipo: a.tipo })
    } catch (err) {
      console.error(`[anexos ${wsId}] falha ao salvar imagem:`, err.message)
    }
  }
  return meta
}

/** O mais novo absorve o mais antigo: mensagens viram histórico ordenado, custo soma. */
function fundirTickets(estado, x, y) {
  const [novo, velho] = (x.data || '') >= (y.data || '') ? [x, y] : [y, x]
  const doVelho = [
    ...(velho.historico ?? []),
    ...(velho.corpo ? [{ autor: 'cliente', corpo: velho.corpo, data: velho.data, traducao: velho.traducao, anexos: velho.anexos }] : []),
    ...(velho.resposta ? [{ autor: 'atendo', corpo: velho.resposta, data: velho.respondidoEm || velho.data, origem: velho.respostaOrigem }] : []),
  ]
  novo.historico = [...doVelho, ...(novo.historico ?? [])]
    .sort((a, b) => (a.data || '').localeCompare(b.data || ''))
  novo.custoIA = Math.round(((novo.custoIA || 0) + (velho.custoIA || 0)) * 1e6) / 1e6
  estado.tickets = estado.tickets.filter(t => t.id !== velho.id)
}

// nome comparável: minúsculas, sem acentos, espaços normalizados
const nomePessoa = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Junta conversas que nasceram separadas mas são a mesma coisa.
 * - Mesmo remetente e mesma loja: junta com assunto equivalente OU mesmo pedido citado.
 * - Remetentes DIFERENTES (a pessoa usou dois e-mails): junta só com o mesmo
 *   pedido citado E evidência de que é a mesma pessoa — um e-mail citado no
 *   texto do outro, ou o mesmo nome completo. Sem isso, não junta (uma
 *   transportadora citando o mesmo pedido NÃO entra na conversa do cliente).
 * Roda a cada sincronização — cobre inclusive tickets antigos.
 */
export { motorDaConversa }
export function fundirConversasDuplicadas(estado) {
  let mudou = false
  let denovo = true
  while (denovo) {
    denovo = false
    const ts = estado.tickets.filter(t => !['spam', 'lixeira'].includes(t.status))
    const info = ts.map(t => {
      const texto = textoDaConversa(t)
      return {
        t,
        loja: t.lojaId ?? 'loja1',
        de: t.de.toLowerCase(),
        assunto: normalizarAssunto(t.assunto),
        numeros: numerosDePedido(texto),
        emails: emailsCitados(texto),
        nome: nomePessoa(t.nome),
      }
    })
    externo:
    for (let i = 0; i < info.length; i++) {
      for (let j = i + 1; j < info.length; j++) {
        const a = info[i], b = info[j]
        if (a.loja !== b.loja) continue
        // conversas de motores diferentes NUNCA se fundem (só a migração manual muda o motor)
        if (motorDaConversa(a.t) !== motorDaConversa(b.t)) continue
        let numeroComum = false
        for (const n of a.numeros) if (b.numeros.has(n)) { numeroComum = true; break }
        let mesma = false
        if (a.de === b.de) {
          mesma = a.assunto === b.assunto || numeroComum
        } else if (numeroComum) {
          // dois e-mails, mesmo pedido: precisa de prova de mesma pessoa
          mesma = a.emails.has(b.de) || b.emails.has(a.de)
            || (!!a.nome && a.nome.includes(' ') && a.nome === b.nome)
        }
        if (!mesma) continue
        fundirTickets(estado, a.t, b.t)
        mudou = true
        denovo = true
        break externo
      }
    }
  }
  return mudou
}

async function anexarNaConversa(estado, t, { corpo, data, messageId, anexos, agora }, wsId = null) {
  if (messageId) estado.emailsProcessados.push(messageId)

  // decide o spam ANTES de guardar imagem: mensagem que vira spam não salva bytes
  const viraSpam = !clienteComPedido(estado, t.de, t.lojaId, `${textoDaConversa(t)} ${corpo}`)
    && pareceSpam(t.assunto, corpo, t.de)

  t.historico = t.historico || []
  if (t.corpo) t.historico.push({ autor: 'cliente', corpo: t.corpo, data: t.data, traducao: t.traducao, anexos: t.anexos })
  if (t.resposta) t.historico.push({ autor: 'atendo', corpo: t.resposta, data: t.respondidoEm || t.data, traducao: t.respostaTraducao, origem: t.respostaOrigem })

  t.anexos = !viraSpam && wsId && anexos?.length ? await guardarAnexos(wsId, anexos) : undefined
  t.corpo = corpo
  t.data = data || new Date().toISOString()
  t.lido = false
  t.resposta = undefined
  t.respostaOrigem = undefined
  t.marcadoRespondido = undefined // cliente falou de novo: a conversa volta a ser pendente
  t.respostaTraducao = undefined
  t.respondidoEm = undefined
  t.enviaEm = undefined
  t.erroEnvio = undefined
  t.tentativasEnvio = undefined
  t.traducao = undefined

  if (viraSpam) {
    // a conversa se revelou spam (ex.: abriu como cliente e virou oferta comercial)
    t.status = 'spam'
    t.enviaEm = undefined
  } else if (t.iaPausada) {
    t.status = 'humano'
    t.motivoEscalada = 'IA pausada nesta conversa — responda manualmente ou retome a IA'
    t.motivoTraducao = undefined
  } else if (motorDaConversa(t) === 'novo') {
    // a conversa segue no motor em que começou, mesmo que a loja tenha trocado de modo
    // mensagem nova reinicia a cadência e recalcula o rascunho (regra 8)
    const rn = await processarNovo(estado, t, { agora })
    if (rn.spam) { t.status = 'spam'; t.rascunho = undefined; t.rascunhoTraducao = undefined; t.enviaEm = undefined }
  } else {
    const r = await processarEmail(estado, t)
    if (r.spam) {
      t.status = 'spam'
      t.rascunho = undefined
      t.rascunhoTraducao = undefined
      t.enviaEm = undefined
      if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
      registrarGasto(estado, t.lojaId, r.custo)
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

    if (process.env.ATENDO_SIMULAR === '1') {
      // testes e ensaio: nada entra pela rede nem pela demonstração — só /api/simular-email
    } else if (algumEmail(wsId)) {
      for (const conta of contasDe(wsId)) {
        if (!conta.configurado) continue
        const emails = await conta.buscarNovos(estado.emailsProcessados)
        for (const e of emails) {
          // as imagens (bytes crus) só são guardadas se o e-mail não for spam
          const conversa = acharConversa(estado, e.de, e.assunto, conta.id, e.corpo)
          if (conversa) {
            await anexarNaConversa(estado, conversa, e, wsId)
          } else {
            estado.tickets.unshift(await criarTicket(estado, e, conta.id, wsId))
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

    // junta conversas duplicadas do mesmo cliente/pedido (inclusive antigas)
    const fundiu = fundirConversasDuplicadas(estado)
    // devolve ao lojista clientes identificados que caíram no spam por engano
    const resgatados = resgatarSpamComPedido(estado)
    if (novos > 0 || fundiu || resgatados > 0) salvar(wsId)
    return novos + resgatados
  } finally {
    sincronizando.delete(wsId)
  }
}

/* ---------------- Envio ---------------- */

async function enviarResposta(wsId, ticket, texto, origem = 'manual') {
  const lojaId = ticket.lojaId ?? 'loja1'
  const contas = contasDe(wsId)
  const an = ticket.atendimentoNovo
  const modoNovo = !!an?.transicaoPendente?.para
  // modo novo: SÓ a conta da própria loja — nunca a de outra loja como reserva
  const propria = contas.find(c => c.id === lojaId) ?? null
  const conta = modoNovo ? propria : (propria ?? contas[0])
  const canal = conta && (conta.configurado || envioPorApi) ? conta : (modoNovo ? null : contas.find(c => c.configurado))
  if (modoNovo && !canal) {
    throw new Error(`A loja desta conversa (${lojaId}) não tem caixa de e-mail configurada — no modo novo a resposta só sai pela conta da própria loja, nunca pela de outra`)
  }
  // canal simulado só nos testes (ATENDO_SIMULAR=1): 'ok' envia, 'falha' quebra
  const simulado = process.env.ATENDO_SIMULAR === '1' ? process.env.ATENDO_SMTP_FAKE : null
  let enviou = false
  if (simulado === 'ok') enviou = true
  else if (simulado === 'falha') throw new Error('Envio simulado falhou')
  else if (canal) { await canal.enviar({ para: ticket.de, assunto: ticket.assunto, corpo: texto }); enviou = true }
  // modo novo: a fase só muda depois de um canal real enviar com sucesso — sem
  // canal, nem envia (nada abaixo é executado, então nada muda no ticket)
  if (modoNovo && !enviou) {
    throw new Error('Nenhuma caixa de e-mail configurada nesta loja — no modo novo a resposta só conta depois de enviada de verdade')
  }
  if (modoNovo) {
    confirmarTransicao(an, { para: an.transicaoPendente.para, mensagem: an.transicaoPendente.mensagem, observacao: an.transicaoPendente.observacao })
    an.proximoEnvioMinimo = undefined
    an.rascunhoGerado = undefined
  }
  // Nova resposta numa conversa que já tem resposta enviada (respondida ou
  // mantida em atendimento humano): arquiva a troca anterior no histórico
  // antes de sobrescrever, para nada se perder na tela.
  if (ticket.resposta) {
    ticket.historico = ticket.historico || []
    if (ticket.corpo) {
      ticket.historico.push({ autor: 'cliente', corpo: ticket.corpo, data: ticket.data, traducao: ticket.traducao, anexos: ticket.anexos })
      ticket.corpo = ''
      ticket.traducao = undefined
      ticket.anexos = undefined
    }
    ticket.historico.push({ autor: 'atendo', corpo: ticket.resposta, data: ticket.respondidoEm || ticket.data, traducao: ticket.respostaTraducao, origem: ticket.respostaOrigem })
    ticket.respostaTraducao = undefined
  }
  ticket.status = 'enviado'
  ticket.resposta = texto
  ticket.respostaOrigem = origem // quem escreveu: 'ia' ou 'manual'
  ticket.rascunho = texto
  ticket.rascunhoTraducao = undefined
  ticket.respondidoEm = new Date().toISOString()
  ticket.enviaEm = undefined
  ticket.lido = true
}

const enviando = new Set()
const MAX_TENTATIVAS = 3

agendar(async () => {
  const agora = Date.now()
  for (const [wsId, estado] of workspaces) {
    const vencidos = estado.tickets.filter(t =>
      t.status === 'aprovacao' && t.enviaEm && t.enviaEm <= agora && !t.iaPausada && !enviando.has(t.id))
    if (!vencidos.length) continue
    for (const t of vencidos) {
      enviando.add(t.id)
      try {
        // modo novo: o rascunho pode ter sido editado depois de gerado — reconfere
        const anL = t.atendimentoNovo
        if (anL?.transicaoPendente?.para) {
          const lojaL = estado.lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
          if (anL.aprovacaoObrigatoria) { t.enviaEm = undefined; continue }
          // reconfere a liberação no momento do envio: bloqueado → fica em Aprovações, sem enviar
          if (!envioAutomaticoLiberado()) { t.enviaEm = undefined; anL.envioBloqueado = 'envio automático bloqueado durante o piloto'; continue }
          const v = conferirTextoDaFase(anL.transicaoPendente.para, t.rascunho || '', lojaL, anL, pedidoDoTicket(estado, t), { faltando: anL.transicaoPendente.faltando ?? [], idioma: anL.idioma ?? null })
          const vi = v.ok ? conferirIdioma(t.rascunho || '', anL.idioma ?? null, anL.rascunhoIdioma ?? null) : { ok: true }
          const dif = v.ok && vi.ok ? diferencaDeOferta(anL.rascunhoGerado ?? t.rascunho, t.rascunho, lojaL) : null
          if (!v.ok || !vi.ok || dif) {
            t.status = 'humano'
            t.enviaEm = undefined
            t.motivoEscalada = !v.ok
              ? `Rascunho não pertence mais à etapa: ${v.motivo} — confira e envie você`
              : !vi.ok ? `Resposta no idioma errado (${vi.motivo}) — confira e envie você`
                : `Rascunho editado mudou a oferta (${dif}) — confira e envie você`
            continue
          }
        }
        await enviarResposta(wsId, t, t.rascunho || '', 'ia')
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
agendar(() => {
  for (const wsId of workspaces.keys()) {
    if (algumEmail(wsId)) sincronizar(wsId).catch(err => console.error(`[sync ${wsId}]`, err.message))
  }
}, 60_000)

/* ---------------- Resumo diário ---------------- */

// Fuso do lojista para a "meia-noite" (horas em relação ao UTC; padrão Brasília)
const FUSO_RESUMO = Number(process.env.ATENDO_FUSO ?? -3)
const diaLocal = ts => new Date(new Date(ts).getTime() + FUSO_RESUMO * 3600_000).toISOString().slice(0, 10)

/** Fecha um dia: quem foi atendido, pedidos, casos e a distribuição por categoria. Sem IA — só contas. */
function gerarResumoDoDia(estado, dia) {
  const doDia = data => data && diaLocal(data) === dia
  const atendidos = estado.tickets.filter(t =>
    doDia(t.respondidoEm) || (t.historico ?? []).some(m => m.autor === 'atendo' && doDia(m.data)))
  const recebidosLista = estado.tickets.filter(t =>
    t.status !== 'spam' && (doDia(t.data) || (t.historico ?? []).some(m => m.autor === 'cliente' && doDia(m.data))))
  const spamLista = estado.tickets.filter(t => t.status === 'spam' && doDia(t.data))

  const categorias = {}
  for (const t of atendidos) categorias[t.categoria] = (categorias[t.categoria] || 0) + 1

  // recorte por loja, para o resumo respeitar o seletor da barra lateral
  const porLoja = {}
  const balde = t => (porLoja[t.lojaId ?? 'loja1'] ??= { atendimentos: 0, recebidos: 0, spam: 0, categorias: {} })
  for (const t of atendidos) {
    const b = balde(t)
    b.atendimentos++
    b.categorias[t.categoria] = (b.categorias[t.categoria] || 0) + 1
  }
  for (const t of recebidosLista) balde(t).recebidos++
  for (const t of spamLista) balde(t).spam++

  const clientes = atendidos.map(t => ({
    nome: t.nome,
    email: t.de,
    categoria: t.categoria,
    lojaId: t.lojaId ?? 'loja1',
    situacao: t.resumoSituacao ?? null,
    resolucao: t.resolucao ?? null,
    pedidos: estado.pedidos
      .filter(p => (p.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1') && p.email && p.email.trim().toLowerCase() === t.de.trim().toLowerCase())
      .map(p => p.numero).slice(0, 5),
  }))

  return { id: uid(), dia, geradoEm: new Date().toISOString(), atendimentos: atendidos.length, recebidos: recebidosLista.length, spam: spamLista.length, categorias, clientes, porLoja }
}

/** Gera os resumos que faltam (ontem sempre; até 7 dias para trás cobre quedas na virada). */
function atualizarResumos(wsId) {
  const estado = workspaces.get(wsId)
  estado.resumosDiarios ??= []
  let mudou = false
  // resumos gerados antes do recorte por loja ganham o formato novo (mesmos tickets, mesmas contas)
  for (const [i, r] of estado.resumosDiarios.entries()) {
    if (!r.porLoja) {
      estado.resumosDiarios[i] = { ...gerarResumoDoDia(estado, r.dia), id: r.id, geradoEm: r.geradoEm }
      mudou = true
    }
  }
  for (let i = 1; i <= 7; i++) {
    const dia = diaLocal(Date.now() - i * 24 * 3600_000)
    if (estado.resumosDiarios.some(r => r.dia === dia)) continue
    const r = gerarResumoDoDia(estado, dia)
    if (i === 1 || r.atendimentos > 0 || r.recebidos > 0 || r.spam > 0) {
      estado.resumosDiarios.push(r)
      mudou = true
    }
  }
  if (mudou) {
    // histórico permanente: os fechamentos ficam salvos para sempre, do mais recente ao mais antigo
    estado.resumosDiarios.sort((a, b) => b.dia.localeCompare(a.dia))
    salvar(wsId)
  }
}

/* ---- Faxina de anexos: espaço no Postgres é caro ---- */

// Fotos com mais de N dias saem da conversa e do banco; órfãs (spam, conversas
// apagadas, fusões) também. Roda a cada 6h e logo depois de subir.
const DIAS_ANEXOS = Number(process.env.ATENDO_ANEXOS_DIAS ?? 60)

async function faxinaAnexos() {
  for (const [wsId, estado] of workspaces) {
    try {
      const corte = Date.now() - DIAS_ANEXOS * 864e5
      const emUso = []
      let mudou = false
      const varrer = (obj, dataRef) => {
        if (!obj.anexos?.length) return
        if (new Date(dataRef || 0).getTime() < corte) { obj.anexos = undefined; mudou = true }
        else emUso.push(...obj.anexos.map(a => a.id))
      }
      for (const t of estado.tickets) {
        varrer(t, t.data)
        for (const m of t.historico ?? []) varrer(m, m.data)
      }
      const removidos = await db.limparAnexos(wsId, emUso)
      if (mudou) salvar(wsId)
      if (removidos > 0) console.log(`[anexos ${wsId}] faxina removeu ${removidos} imagem(ns)`)
    } catch (err) {
      console.error(`[anexos ${wsId}] faxina falhou:`, err.message)
    }
  }
}
agendar(faxinaAnexos, 6 * 3600_000)
agendarUmaVez(faxinaAnexos, 90_000)

// Checagem periódica: logo depois da meia-noite (no fuso do lojista) o dia anterior é fechado
agendar(() => {
  for (const wsId of workspaces.keys()) {
    try { atualizarResumos(wsId) } catch (err) { console.error(`[resumo ${wsId}]`, err.message) }
  }
}, 10 * 60_000)

/* ---------------- Link público do relatório manual ----------------
   O lojista cria um link secreto e manda para o chefe: a página mostra os
   relatórios manuais por dia, sempre atualizados, sem login. Revogável. */

/* ---------------- Link externo do pipeline (somente leitura) ----------------
   Token longo (32 bytes) e revogável; a página e os dados saem sanitizados
   (sem nome, e-mail, endereço ou texto de conversa). Nada de escrita. */

app.post('/api/pipeline-link', (req, res) => {
  const { acao } = req.body ?? {}
  if (acao === 'revogar') req.estado.tokenPipeline = undefined
  else if (acao === 'novo') req.estado.tokenPipeline = crypto.randomBytes(32).toString('hex')
  else req.estado.tokenPipeline = req.estado.tokenPipeline || crypto.randomBytes(32).toString('hex')
  salvar(req.wsId); ok(req, res)
})

async function workspaceDoLinkPipeline(wsId, token) {
  let estado = workspaces.get(wsId)
  if (!estado) {
    try { const c = await db.carregarWorkspace(wsId); if (c) { workspaces.set(wsId, c); estado = c } } catch { /* cai no 404 */ }
  }
  const a = Buffer.from(String(token || ''))
  const b = Buffer.from(String(estado?.tokenPipeline || ''))
  if (!estado || !b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return estado
}

app.get('/p/:wsId/:token', async (req, res) => {
  const estado = await workspaceDoLinkPipeline(req.params.wsId, req.params.token)
  res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex')
  if (!estado) return res.status(404).send('Link inválido ou revogado.')
  const lojas = estado.lojas.map(l => ({ id: l.id, nome: l.nome, moeda: l.moeda || 'EUR' }))
  res.type('html').send(paginaPipeline({ catalogo: { ordem: ['entrada', 'tamanho', 'qualidade', 'defeito_errado', 'nao_recebido', 'cancelamento'], jornadas: JORNADAS, fases: catalogoFases() }, lojas }))
})

app.get('/p/:wsId/:token/dados', async (req, res) => {
  const estado = await workspaceDoLinkPipeline(req.params.wsId, req.params.token)
  res.set('Cache-Control', 'no-store')
  if (!estado) return res.status(404).json({ erro: 'Link inválido ou revogado.' })
  res.json(dadosPipeline({ estado, fases: catalogoFases(), jornadas: JORNADAS, filtros: filtrosDaConsulta(req.query) }))
})

app.post('/api/relatorio-link', (req, res) => {
  const { acao } = req.body ?? {}
  if (acao === 'revogar') req.estado.tokenRelatorio = undefined
  else if (acao === 'mostrar-hoje') req.estado.linkMostraHoje = !!req.body.valor
  else req.estado.tokenRelatorio = req.estado.tokenRelatorio || crypto.randomBytes(16).toString('hex')
  salvar(req.wsId); ok(req, res)
})

const escaparHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const categoriaRelatorio = { reembolso: 'Reembolso', troca: 'Troca', rastreio: 'Rastreio', entrega: 'Entrega', produto: 'Produto', outro: 'Atendido' }

// mesmo critério do painel do ticket: remetente + e-mails/números citados na conversa
function numeroDoTicketRelatorio(estado, t) {
  const texto = [t.assunto, t.corpo, t.resposta, ...(t.historico ?? []).map(m => m.corpo)].join('\n')
  const emails = emailsCitados(texto)
  emails.add(String(t.de || '').trim().toLowerCase())
  const numeros = numerosDePedido(texto)
  const numeroCitado = numeros.size ? [...numeros][0] : null
  const doCliente = (estado.pedidos ?? []).find(p =>
    (p.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1')
    && ((p.email && emails.has(p.email.trim().toLowerCase()))
      || (numeroCitado !== null && String(p.numero).replace(/\D/g, '') === numeroCitado)))
  if (doCliente) return String(doCliente.numero).replace('#', '')
  return numeroCitado
}

app.get('/r/:wsId/:token', async (req, res) => {
  try {
  const { wsId, token } = req.params
  let estado = workspaces.get(wsId)
  if (!estado) {
    // no modo arquivo carregarWorkspace é síncrono; await cobre os dois casos
    try {
      const carregado = await db.carregarWorkspace(wsId)
      if (carregado) { workspaces.set(wsId, carregado); estado = carregado }
    } catch { /* workspace ilegível: cai no 404 abaixo */ }
  }
  const a = Buffer.from(String(token || ''))
  const b = Buffer.from(String(estado?.tokenRelatorio || ''))
  if (!estado || !b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(404).send('Link inválido ou revogado.')
  }

  const porDia = new Map()
  for (const t of estado.tickets) {
    if (!t.relatorioDia) continue
    if (!porDia.has(t.relatorioDia)) porDia.set(t.relatorioDia, [])
    porDia.get(t.relatorioDia).push(t)
  }
  // com "mostrar hoje" desligado, o dia atual só entra no link depois da
  // meia-noite — dá tempo de o lojista revisar as linhas antes do chefe ver
  const hoje = diaLocal(Date.now())
  const dias = [...porDia.keys()].filter(d => estado.linkMostraHoje !== false || d !== hoje)
    .sort().reverse().slice(0, 60)
  const nomeLoja = id => estado.lojas.find(l => l.id === (id ?? 'loja1'))?.nome ?? 'Loja'

  const blocos = dias.map(dia => {
    const [ano, mes, d] = dia.split('-')
    const porLoja = new Map()
    for (const t of porDia.get(dia)) {
      const nome = nomeLoja(t.lojaId)
      if (!porLoja.has(nome)) porLoja.set(nome, [])
      porLoja.get(nome).push(t)
    }
    const grupos = [...porLoja.entries()].map(([loja, ts]) => {
      const linhas = ts.map(t => {
        // linha editada à mão pelo lojista tem a palavra final
        let texto = t.relatorioLinha
        if (!texto) {
          const numero = numeroDoTicketRelatorio(estado, t)
          const quem = numero ? `PEDIDO ${numero}` : String(t.nome || '').toUpperCase()
          const oque = t.relatorioTexto || t.resolucao || t.resumoSituacao || categoriaRelatorio[t.categoria] || 'atendido'
          texto = `${quem} - ${oque}`
        }
        // checkbox de processado: o dono marca conforme executa cada caso
        return `<label class="linha${t.relatorioProcessado ? ' feito' : ''}">`
          + `<input type="checkbox" data-id="${escaparHtml(t.id)}"${t.relatorioProcessado ? ' checked' : ''}>`
          + `<span>${escaparHtml(texto)}</span></label>`
      }).join('')
      return `<div class="loja">Loja: ${escaparHtml(loja)}</div>${linhas}`
    }).join('')
    return `<section class="dia"><h2>RELATÓRIO ${d}/${mes}/${ano}</h2>${grupos}</section>`
  }).join('')

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Relatórios diários</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #101010; color: #d7d7d7; font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; padding: 32px 18px 60px; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 19px; margin-bottom: 4px; }
  .sub { color: #8a8a8a; font-size: 12.5px; margin-bottom: 26px; }
  .dia { background: #191919; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  .dia h2 { font-size: 14.5px; margin-bottom: 10px; letter-spacing: 0.02em; }
  .loja { color: #9b9b9b; font-size: 12.5px; margin: 10px 0 6px; }
  .linha { font-size: 13.5px; line-height: 1.7; display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
  .linha input { margin-top: 5px; accent-color: #58a6ff; cursor: pointer; }
  .linha.feito span { opacity: 0.45; text-decoration: line-through; }
  .vazio { color: #8a8a8a; font-size: 13.5px; }
</style></head>
<body><main>
<h1>Relatórios diários</h1>
<p class="sub">Atualizado automaticamente — recarregue a página para ver o dia atual. Marque a caixinha de cada caso conforme for processando: o andamento fica salvo e visível para a equipe.</p>
${blocos || '<p class="vazio">Nenhum caso marcado ainda.</p>'}
</main>
<script>
document.addEventListener('change', function (e) {
  var cb = e.target
  if (!cb.matches || !cb.matches('.linha input')) return
  var linha = cb.closest('.linha')
  cb.disabled = true
  fetch(location.pathname + '/processar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId: cb.getAttribute('data-id'), processado: cb.checked }),
  }).then(function (r) {
    if (!r.ok) throw new Error('falhou')
    linha.classList.toggle('feito', cb.checked)
  }).catch(function () { cb.checked = !cb.checked })
    .finally(function () { cb.disabled = false })
})
</script>
</body></html>`)
  } catch (err) {
    console.error('[relatorio-link]', err)
    res.status(500).send('Erro ao montar a página. Tente de novo.')
  }
})

/* Página pública do relatório de reembolsos: o mesmo link do chefe, com
   /reembolsos no fim. Os motivos são os que a IA já leu (guardados em cada
   conversa, atualizados sozinhos toda semana); valores, porcentagens e gráficos
   são recalculados na hora — abrir a página não custa IA nenhuma.
   ?p=hoje | 7 | 30 | tudo escolhe o período. */
app.get('/r/:wsId/:token/reembolsos', async (req, res) => {
  try {
    const { wsId, token } = req.params
    let estado = workspaces.get(wsId)
    if (!estado) {
      try {
        const carregado = await db.carregarWorkspace(wsId)
        if (carregado) { workspaces.set(wsId, carregado); estado = carregado }
      } catch { /* cai no 404 abaixo */ }
    }
    const a = Buffer.from(String(token || ''))
    const b = Buffer.from(String(estado?.tokenRelatorio || ''))
    if (!estado || !b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(404).send('Link inválido ou revogado.')
    }

    const todos = casosDeReembolso(estado)
    const porId = new Map(estado.tickets.map(t => [t.id, t]))
    for (const item of todos) {
      const guardado = porId.get(item.ticketId)?.motivoReembolso
      item.motivo = guardado?.motivo ?? 'Motivo ainda não lido'
      item.categoria = guardado
        ? (guardado.categoria || categoriaDaFrase(guardado.motivo))
        : 'nao_informado'
    }

    // período: o corte é pelo dia em que o caso entrou no relatório manual
    const RECUOS = { hoje: 0, 7: 6, 30: 29 }
    const periodo = Object.prototype.hasOwnProperty.call(RECUOS, req.query.p) ? String(req.query.p) : 'tudo'
    const corteDe = chave => (chave === 'tudo' ? null : diaLocal(Date.now() - RECUOS[chave] * 864e5))
    const noPeriodo = (lista, chave) => {
      const corte = corteDe(chave)
      return corte ? lista.filter(i => (i.dia ?? '') >= corte) : lista
    }
    const itens = noPeriodo(todos, periodo)

    const r = resumoDeReembolsos(estado, itens)
    const dinheiro = v => escaparHtml(valorFormatado(v, r.moeda))
    const pct = n => (r.total ? Math.round((n / r.total) * 1000) / 10 : 0)
    const quando = estado.relatorioReembolsos?.geradoEm
      ? new Date(estado.relatorioReembolsos.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : null

    const abas = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['tudo', 'Tudo']]
      .map(([chave, rotulo]) => `<a class="aba${periodo === chave ? ' on' : ''}" href="?p=${chave}">`
        + `${rotulo} <span>${noPeriodo(todos, chave).length}</span></a>`).join('')

    const maiorCat = Math.max(1, ...r.porCategoria.map(c => c.quantidade))
    const barrasMotivo = r.porCategoria.map(c => `
      <div class="barra">
        <div class="rot">${escaparHtml(c.rotulo)}</div>
        <div class="trilho"><div class="preench" style="width:${Math.round((c.quantidade / maiorCat) * 100)}%"></div></div>
        <div class="num"><b>${c.quantidade}</b> <span>${pct(c.quantidade)}%</span></div>
        <div class="val">${dinheiro(c.reembolsado)}</div>
      </div>`).join('')

    const maiorLoja = Math.max(1, ...r.grupos.map(g => g.itens.length))
    const barrasLoja = r.grupos.map(g => `
      <div class="barra">
        <div class="rot">${escaparHtml(g.nome)}</div>
        <div class="trilho"><div class="preench loja" style="width:${Math.round((g.itens.length / maiorLoja) * 100)}%"></div></div>
        <div class="num"><b>${g.itens.length}</b> <span>${pct(g.itens.length)}%</span></div>
        <div class="val">${dinheiro(g.reembolsado)}</div>
      </div>`).join('')

    const listas = r.grupos.map(g => {
      const linhas = g.itens.map(i => {
        const quem = i.numero ? `#${i.numero}` : String(i.cliente || '').toUpperCase()
        return `<div class="linha"><b>${escaparHtml(quem)}</b>`
          + `<span class="valor">${escaparHtml(i.valorTexto)}${i.percentual ? ` · ${i.percentual}%` : ''}</span>`
          + `<span class="motivo">${escaparHtml(i.motivo)}</span></div>`
      }).join('')
      return `<section class="grupo"><h2>Loja ${escaparHtml(g.nome)} <span class="cnt">${g.itens.length}</span>`
        + `<span class="dinheiro">${dinheiro(g.reembolsado)}</span></h2>${linhas}</section>`
    }).join('')

    const media = r.total ? r.reembolsado / r.total : 0
    const rotuloPeriodo = { hoje: 'hoje', 7: 'nos últimos 7 dias', 30: 'nos últimos 30 dias', tudo: 'no total' }[periodo]
    const rodape = [
      r.semPercentual ? `${r.semPercentual} caso${r.semPercentual === 1 ? '' : 's'} sem a porcentagem escrita na linha do relatório` : '',
      r.semValor ? `${r.semValor} sem o pedido localizado` : '',
    ].filter(Boolean).join(' · ')

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Relatório de reembolsos</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #101010; color: #d7d7d7; font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; padding: 32px 18px 60px; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 19px; margin-bottom: 4px; }
  .sub { color: #8a8a8a; font-size: 12.5px; margin-bottom: 16px; }
  .abas { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
  .aba { color: #b7b7b7; background: #191919; border: 1px solid #2a2a2a; border-radius: 20px;
         padding: 6px 13px; font-size: 12.5px; text-decoration: none; display: inline-flex; gap: 6px; align-items: center; }
  .aba span { color: #7a7a7a; font-size: 11.5px; }
  .aba.on { background: #2b2c55; border-color: #4a4ca8; color: #fff; }
  .aba.on span { color: #b9baf0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .kpi { background: #191919; border: 1px solid #2a2a2a; border-radius: 12px; padding: 14px 16px; }
  .kpi .rotulo { color: #8a8a8a; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi .valor { font-size: 20px; margin-top: 4px; color: #fff; }
  .kpi .pe { color: #8a8a8a; font-size: 11.5px; margin-top: 3px; }
  .grupo { background: #191919; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  .grupo h2 { font-size: 14.5px; margin-bottom: 12px; letter-spacing: 0.02em; display: flex; align-items: center; gap: 8px; }
  .cnt { background: #262626; color: #9b9b9b; font-size: 11.5px; border-radius: 20px; padding: 1px 8px; font-weight: 400; }
  .dinheiro { margin-left: auto; color: #6ec08a; font-size: 12.5px; font-weight: 400; }
  .barra { display: grid; grid-template-columns: 168px 1fr 84px 92px; gap: 10px; align-items: center; padding: 5px 0; font-size: 12.5px; }
  .barra .rot { color: #c9c9c9; }
  .trilho { background: #232323; border-radius: 6px; height: 14px; overflow: hidden; }
  .preench { background: linear-gradient(90deg, #6b6ff5, #8d7bf0); height: 100%; border-radius: 6px; }
  .preench.loja { background: linear-gradient(90deg, #3f8f6a, #5bb98b); }
  .barra .num b { color: #fff; }
  .barra .num span { color: #8a8a8a; }
  .barra .val { color: #8a8a8a; text-align: right; }
  .linha { font-size: 13.5px; line-height: 1.7; display: flex; gap: 8px; flex-wrap: wrap; padding: 2px 0; }
  .linha b { min-width: 62px; }
  .valor { color: #9b9b9b; min-width: 118px; }
  .motivo { flex: 1; min-width: 200px; }
  .vazio { color: #8a8a8a; font-size: 13.5px; }
  .nota { color: #7a7a7a; font-size: 11.5px; margin-top: 10px; }
  @media (max-width: 560px) {
    .barra { grid-template-columns: 1fr 70px; grid-template-areas: "rot num" "trilho trilho" "val val"; }
    .barra .rot { grid-area: rot } .barra .num { grid-area: num; text-align: right }
    .trilho { grid-area: trilho } .barra .val { grid-area: val; text-align: left }
  }
</style></head>
<body><main>
<h1>Relatório de reembolsos</h1>
<p class="sub">${r.total} caso${r.total === 1 ? '' : 's'} ${escaparHtml(rotuloPeriodo)}${quando ? ` · motivos atualizados em ${escaparHtml(quando)}` : ''}</p>
<nav class="abas">${abas}</nav>
${r.total ? `
<div class="cards">
  <div class="kpi"><div class="rotulo">Total reembolsado</div><div class="valor">${dinheiro(r.reembolsado)}</div><div class="pe">média de ${dinheiro(media)} por caso</div></div>
  <div class="kpi"><div class="rotulo">Reembolsos</div><div class="valor">${r.total}</div><div class="pe">${r.cem} de 100% · ${r.sessenta} de 60%</div></div>
  <div class="kpi"><div class="rotulo">Maior motivo</div><div class="valor" style="font-size:15px">${escaparHtml(r.porCategoria[0]?.rotulo ?? '—')}</div><div class="pe">${r.porCategoria[0] ? `${r.porCategoria[0].quantidade} casos · ${pct(r.porCategoria[0].quantidade)}%` : ''}</div></div>
</div>

<section class="grupo"><h2>Por que pediram reembolso</h2>${barrasMotivo}</section>
<section class="grupo"><h2>Por loja</h2>${barrasLoja}</section>
${listas}
${rodape ? `<p class="nota">${escaparHtml(rodape)} — esses casos entram na contagem, mas não no valor reembolsado.</p>` : ''}
` : '<p class="vazio">Nenhum reembolso neste período.</p>'}
</main></body></html>`)
  } catch (err) {
    console.error('[relatorio-reembolsos-link]', err)
    res.status(500).send('Erro ao montar a página. Tente de novo.')
  }
})

// O dono marca um caso do relatório como processado (mesmo token da página)
app.post('/r/:wsId/:token/processar', async (req, res) => {
  try {
    const { wsId, token } = req.params
    let estado = workspaces.get(wsId)
    if (!estado) {
      try {
        const carregado = await db.carregarWorkspace(wsId)
        if (carregado) { workspaces.set(wsId, carregado); estado = carregado }
      } catch { /* cai no 404 abaixo */ }
    }
    const a = Buffer.from(String(token || ''))
    const b = Buffer.from(String(estado?.tokenRelatorio || ''))
    if (!estado || !b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(404).end()
    }
    const t = estado.tickets.find(x => x.id === req.body?.ticketId && x.relatorioDia)
    if (!t) return res.status(404).end()
    t.relatorioProcessado = req.body.processado ? new Date().toISOString() : undefined
    salvar(wsId)
    res.json({ ok: true })
  } catch (err) {
    console.error('[relatorio-processar]', err)
    res.status(500).end()
  }
})

/* ---------------- Rotas ---------------- */

// Imagem anexada por um cliente (só do próprio workspace)
app.get('/api/anexos/:id', async (req, res) => {
  try {
    const a = await db.lerAnexo(req.wsId, req.params.id)
    if (!a) return res.status(404).end()
    res.setHeader('Content-Type', a.tipo || 'application/octet-stream')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(a.dados)
  } catch (err) {
    console.error('[anexos]', err.message)
    res.status(500).end()
  }
})

/* Backup: baixa o workspace inteiro num arquivo JSON. Credenciais ficam de
   fora (só funcionam com o segredo deste servidor, então não servem em outro
   lugar e não devem viajar). Imagens anexadas continuam no banco — para elas,
   use o snapshot do Postgres no Railway. */
app.get('/api/exportar', (req, res) => {
  const copia = JSON.parse(JSON.stringify(req.estado))
  for (const l of copia.lojas ?? []) {
    if (l.emailCfg) l.emailCfg = { ...l.emailCfg, passCifrada: '(removida do backup)' }
    if (l.shopify?.token) l.shopify = { ...l.shopify, token: '(removido do backup)' }
  }
  const anexos = copia.tickets.reduce((n, t) => n + (t.anexos?.length ?? 0)
    + (t.historico ?? []).reduce((m, h) => m + (h.anexos?.length ?? 0), 0), 0)
  const arquivo = {
    atendo: 'backup-workspace',
    versao: 1,
    wsId: req.wsId,
    geradoEm: new Date().toISOString(),
    resumo: {
      tickets: copia.tickets.length,
      pedidos: (copia.pedidos ?? []).length,
      produtos: (copia.produtos ?? []).length,
      lojas: (copia.lojas ?? []).length,
      politicas: (copia.politicas ?? []).length,
      faqs: (copia.faqs ?? []).length,
      comportamentos: (copia.comportamentos ?? []).length,
      resumosDiarios: (copia.resumosDiarios ?? []).length,
      linhasNoRelatorio: copia.tickets.filter(t => t.relatorioDia).length,
      imagensReferenciadas: anexos,
    },
    aviso: 'Senhas de e-mail e tokens da Shopify não vão no backup — reconecte as integrações ao restaurar. As imagens anexadas ficam na tabela de anexos do banco.',
    estado: copia,
  }
  const dia = diaLocal(Date.now())
  res.setHeader('Content-Disposition', `attachment; filename="atendo-backup-${req.wsId}-${dia}.json"`)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.send(JSON.stringify(arquivo, null, 2))
})


// Simula um e-mail recebido, passando pelo MESMO pipeline da caixa de entrada.
// Só existe com ATENDO_SIMULAR=1 — para testes e para ensaiar o modo novo.
if (process.env.ATENDO_SIMULAR === '1') {
  app.post('/api/simular-email', async (req, res) => {
    const { de, nome, assunto, corpo, lojaId, ticketId, comImagem } = req.body ?? {}
    const anexos = comImagem ? [{ nome: 'foto.jpg', tipo: 'image/jpeg', dados: Buffer.from('fake') }] : []
    try {
      if (ticketId) {
        const t = req.estado.tickets.find(x => x.id === ticketId)
        if (!t) return res.status(404).json({ erro: 'ticket não encontrado' })
        // relógio simulado (só nesta rota de ensaio, que só existe com ATENDO_SIMULAR=1): permite testar prazos reais como as 48 h de "aguardar 2 dias"
        const agora = req.body.agora ? Date.parse(String(req.body.agora)) : NaN
        await anexarNaConversa(req.estado, t, { corpo: String(corpo || ''), data: new Date(Number.isFinite(agora) ? agora : Date.now()).toISOString(), anexos, agora: Number.isFinite(agora) ? agora : undefined }, req.wsId)
        salvar(req.wsId)
        return res.json({ ok: true, ticket: t, state: visao(req.wsId) })
      }
      const t = await criarTicket(req.estado, { nome: nome || 'Cliente', de: String(de || ''), assunto: String(assunto || ''), corpo: String(corpo || ''), data: new Date().toISOString(), anexos }, lojaId || 'loja1', req.wsId)
      req.estado.tickets = [t, ...req.estado.tickets]
      salvar(req.wsId)
      res.json({ ok: true, ticket: t, state: visao(req.wsId) })
    } catch (err) {
      res.status(500).json({ erro: err.message })
    }
  })
}

app.get('/api/state', (req, res) => ok(req, res))

// Força a checagem dos resumos (a automática roda a cada 10 min de qualquer forma)
app.post('/api/resumos/atualizar', (req, res) => {
  atualizarResumos(req.wsId)
  ok(req, res)
})

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

/* ---- Importação completa da caixa (histórico, sem IA) ---- */

const importacoes = new Map() // `${wsId}:${lojaId}` → { rodando, importados, erro, concluidoEm }

async function importarHistorico(wsId, lojaId, prog) {
  const estado = workspaces.get(wsId)
  const conta = contaDaLoja(wsId, lojaId)
  const LIMITE = Number(process.env.EMAIL_IMPORT_MAX ?? 2000)
  const emails = await conta.buscarTodos(estado.emailsProcessados, LIMITE)
  for (const e of emails) {
    // Histórico entra SEM IA: nada de rascunho, custo zero e nenhuma resposta
    // automática para e-mail antigo. Tudo chega como lido.
    estado.emailsProcessados.push(e.messageId)
    const texto = `${e.assunto} ${e.corpo}`
    if (!clienteComPedido(estado, e.de, lojaId, texto) && pareceSpam(e.assunto, e.corpo, e.de)) {
      estado.tickets.push({
        id: uid(), nome: e.nome, de: e.de, assunto: e.assunto, corpo: e.corpo, lojaId,
        data: e.data, lido: true, origem: 'cliente',
        categoria: 'outro', idioma: detectarIdiomaLocal(texto), status: 'spam',
      })
    } else {
      const conversa = acharConversa(estado, e.de, e.assunto, lojaId, e.corpo)
      if (conversa && conversa.data && e.data < conversa.data) {
        // mensagem mais antiga que a atual da conversa: entra no histórico, na ordem certa
        conversa.historico = conversa.historico || []
        conversa.historico.push({ autor: 'cliente', corpo: e.corpo, data: e.data })
        conversa.historico.sort((a, b) => (a.data || '').localeCompare(b.data || ''))
      } else if (conversa) {
        conversa.historico = conversa.historico || []
        if (conversa.corpo) conversa.historico.push({ autor: 'cliente', corpo: conversa.corpo, data: conversa.data, traducao: conversa.traducao })
        if (conversa.resposta) conversa.historico.push({ autor: 'atendo', corpo: conversa.resposta, data: conversa.respondidoEm || conversa.data })
        conversa.corpo = e.corpo
        conversa.data = e.data
        conversa.lido = true
        conversa.resposta = undefined
        conversa.respondidoEm = undefined
        conversa.traducao = undefined
      } else {
        estado.tickets.push({
          id: uid(), nome: e.nome, de: e.de, assunto: e.assunto, corpo: e.corpo, lojaId,
          data: e.data, lido: true, origem: 'cliente',
          categoria: classificarLocal(texto), idioma: detectarIdiomaLocal(texto), status: 'inbox',
        })
      }
    }
    prog.importados++
    if (prog.importados % 50 === 0) salvar(wsId)
  }
  estado.tickets.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  salvar(wsId)
  prog.rodando = false
  prog.concluidoEm = new Date().toISOString()
}

app.post('/api/lojas/:id/importar', (req, res) => {
  const lojaId = req.params.id
  const chave = `${req.wsId}:${lojaId}`
  if (importacoes.get(chave)?.rodando) {
    return res.status(400).json({ erro: 'A importação desta loja já está em andamento.', state: visao(req.wsId) })
  }
  const conta = contaDaLoja(req.wsId, lojaId)
  if (!conta?.configurado || conta.id !== lojaId) {
    return res.status(400).json({ erro: 'Conecte o e-mail desta loja antes de importar.', state: visao(req.wsId) })
  }
  const prog = { rodando: true, importados: 0, erro: null, concluidoEm: null }
  importacoes.set(chave, prog)
  importarHistorico(req.wsId, lojaId, prog).catch(err => {
    prog.rodando = false
    prog.erro = err.message
    console.error(`[importar ${chave}]`, err.message)
  })
  ok(req, res)
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
  delete loja.emailEnvIgnorado // conta nova cadastrada: fim do estado "removida"
  cacheContas.delete(req.wsId)
  salvar(req.wsId)
  sincronizar(req.wsId).catch(() => {})
  ok(req, res)
})

app.delete('/api/lojas/:id/email', (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (loja) {
    delete loja.emailCfg
    // vale também para contas vindas das variáveis de ambiente do Railway
    loja.emailEnvIgnorado = true
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

/* ---------------- Modo de atendimento por loja (antigo × novo) ----------------
   Individual por loja; o clássico nunca some; envio automático do novo continua
   desligado por padrão; ativar o novo exige e-mail próprio, prazo e cupons, e
   confirmação explícita; cada troca fica na auditoria da loja. Conversas em
   andamento continuam no motor em que nasceram. */

app.get('/api/lojas/:id/modo', (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada' })
  res.json({ modo: modoDaLoja(loja), desde: loja.modoDesde ?? null, prontidao: prontidaoModoNovo(req.wsId, loja), historico: loja.modoHistorico ?? [], cuponsNecessarios: CUPONS_NECESSARIOS })
})

app.post('/api/lojas/:id/modo', (req, res) => {
  const loja = req.estado.lojas.find(l => l.id === req.params.id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  const { modo, confirmar } = req.body ?? {}
  if (modo !== 'novo' && modo !== 'classico') return res.status(400).json({ erro: 'Modo inválido.', state: visao(req.wsId) })
  const atual = modoDaLoja(loja)
  if (modo === atual) return ok(req, res)
  if (modo === 'novo') {
    const pr = prontidaoModoNovo(req.wsId, loja)
    if (!pr.pronto) return res.status(400).json({ erro: `Esta loja ainda não pode ativar o modo novo. Falta: ${pr.faltando.map(f => f.texto).join('; ')}.`, faltando: pr.faltando, state: visao(req.wsId) })
  }
  if (confirmar !== true) return res.status(400).json({ erro: 'A mudança de modo precisa de confirmação.', precisaConfirmar: true, state: visao(req.wsId) })
  const em = new Date().toISOString()
  loja.modoAtendimento = modo
  loja.modoDesde = em
  loja.modoHistorico = [...(loja.modoHistorico ?? []), { de: atual, para: modo, por: req.usuario?.nome || req.usuario?.email || 'lojista', lojaId: loja.id, em }].slice(-100)
  // toda ativação do novo começa com o envio automático DESLIGADO, sem exceção
  if (modo === 'novo') loja.novoEnvioAutomatico = false
  salvar(req.wsId); ok(req, res)
})

/* Migração MANUAL de uma conversa aberta do clássico para o novo: individual,
   confirmada, começa pela triagem. Nunca automática; nunca ao contrário. */
app.post('/api/tickets/:id/migrar-motor', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const loja = req.estado.lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
  if (modoDaLoja(loja) !== 'novo') return res.status(400).json({ erro: 'A loja desta conversa está no clássico — só dá para migrar conversas de uma loja no modo novo.', state: visao(req.wsId) })
  if (motorDaConversa(t) === 'novo') return res.status(400).json({ erro: 'Esta conversa já está no motor novo.', state: visao(req.wsId) })
  if (!['inbox', 'aprovacao', 'humano'].includes(t.status)) return res.status(400).json({ erro: 'Só conversas abertas (caixa, aprovação ou com você) podem ser migradas.', state: visao(req.wsId) })
  if (req.body?.confirmar !== true) return res.status(400).json({ erro: 'A migração desta conversa precisa de confirmação.', precisaConfirmar: true, state: visao(req.wsId) })
  const em = new Date().toISOString()
  t.motorHistorico = [...(t.motorHistorico ?? []), { de: 'classico', para: 'novo', por: req.usuario?.nome || req.usuario?.email || 'lojista', em }]
  t.motor = 'novo'
  t.atendimentoNovo = novoEstado() // começa pela triagem
  t.rascunho = undefined; t.rascunhoTraducao = undefined; t.enviaEm = undefined; t.decisaoPendente = undefined; t.motivoEscalada = undefined
  await processarNovo(req.estado, t)
  salvar(req.wsId); ok(req, res)
})

app.post('/api/lojas', (req, res) => {
  const { id, nome, ativa, idioma, assinatura, iaModelo, modoAtendimento, novoEnvioAutomatico, prazoEntrega, cupons } = req.body ?? {}
  const loja = req.estado.lojas.find(l => l.id === id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  if (typeof nome === 'string' && nome.trim()) loja.nome = nome.trim()
  if (typeof ativa === 'boolean' && loja.id !== 'loja1') loja.ativa = ativa
  if (typeof idioma === 'string' && IDIOMAS_RESPOSTA.includes(idioma)) loja.idioma = idioma
  if (typeof iaModelo === 'string' && ['claude', 'gemini'].includes(iaModelo)) loja.iaModelo = iaModelo
  // o modo de atendimento só muda pela rota própria (validação, confirmação e auditoria)
  if (modoAtendimento !== undefined) return res.status(400).json({ erro: 'O modo de atendimento muda em Configurações → Loja → "Mudar modo", com confirmação.', state: visao(req.wsId) })
  // modo novo: envio automático (desligado por padrão no piloto), prazo em dias úteis e cupons por percentual
  if (typeof novoEnvioAutomatico === 'boolean') {
    if (novoEnvioAutomatico) {
      if (modoDaLoja(loja) !== 'novo') return res.status(400).json({ erro: 'O envio automático só existe no atendimento novo — esta loja está no clássico.', state: visao(req.wsId) })
      if (!envioAutomaticoLiberado()) return res.status(400).json({ erro: 'Envio automático bloqueado durante o piloto: cada resposta passa pela sua aprovação.', bloqueadoPiloto: true, state: visao(req.wsId) })
      if (req.body?.confirmar !== true) return res.status(400).json({ erro: 'Ligar o envio automático precisa de confirmação.', precisaConfirmar: true, state: visao(req.wsId) })
    }
    loja.novoEnvioAutomatico = novoEnvioAutomatico
  }
  if (prazoEntrega && typeof prazoEntrega === 'object') {
    const n = (v, padrao) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x <= 90 ? x : padrao }
    loja.prazoEntrega = { min: n(prazoEntrega.min, 5), max: n(prazoEntrega.max, 12), processamento: n(prazoEntrega.processamento, 3) }
    if (loja.prazoEntrega.max < loja.prazoEntrega.min) loja.prazoEntrega.max = loja.prazoEntrega.min
  }
  if (cupons && typeof cupons === 'object') {
    loja.cupons = Object.fromEntries(PERCENTUAIS_CUPOM
      .map(p => [String(p), String(cupons[p] ?? cupons[String(p)] ?? '').trim().slice(0, 40)])
      .filter(([, v]) => v))
  }
  // assinatura própria da loja; vazia volta ao padrão do workspace
  if (typeof assinatura === 'string') loja.assinatura = assinatura.trim() || null
  salvar(req.wsId); ok(req, res)
})

app.post('/api/lojas/nova', (req, res) => {
  const lojas = req.estado.lojas
  // primeiro id livre no padrão lojaN, para os sufixos de env continuarem alinhados
  let n = 1
  while (lojas.some(l => l.id === `loja${n}`)) n++
  const nome = String(req.body?.nome || '').trim() || `loja ${lojas.length + 1}`
  const loja = { ...lojaPadrao(`loja${n}`, nome), ativa: true }
  lojas.push(loja)
  salvar(req.wsId)
  res.json({ lojaId: loja.id, state: visao(req.wsId) })
})

// Remove a loja e TUDO que é dela (conversas, pedidos, produtos, integrações).
// Exige a palavra "confirmar" digitada — conferida também aqui no servidor.
app.delete('/api/lojas/:id', (req, res) => {
  const { id } = req.params
  const loja = req.estado.lojas.find(l => l.id === id)
  if (!loja) return res.status(404).json({ erro: 'loja não encontrada', state: visao(req.wsId) })
  if (req.estado.lojas.length <= 1) {
    return res.status(400).json({ erro: 'Não dá para remover a única loja da conta.', state: visao(req.wsId) })
  }
  const confirmacao = String(req.body?.confirmacao || '').trim().toLowerCase()
  if (confirmacao !== 'confirmar') {
    return res.status(400).json({ erro: 'Digite "confirmar" para remover a loja.', state: visao(req.wsId) })
  }
  req.estado.lojas = req.estado.lojas.filter(l => l.id !== id)
  req.estado.tickets = req.estado.tickets.filter(t => (t.lojaId ?? 'loja1') !== id)
  req.estado.pedidos = req.estado.pedidos.filter(p => (p.lojaId ?? 'loja1') !== id)
  req.estado.produtos = (req.estado.produtos ?? []).filter(p => (p.lojaId ?? 'loja1') !== id)
  statusShopifyPorLoja.delete(`${req.wsId}:${id}`)
  cacheContas.delete(req.wsId) // os índices das contas de e-mail mudaram
  salvar(req.wsId); ok(req, res)
})

/* ---- Tickets ---- */

const acharTicket = (req, res) => {
  const t = req.estado.tickets.find(x => x.id === req.params.id)
  if (!t) res.status(404).json({ erro: 'ticket não encontrado', state: visao(req.wsId) })
  return t
}

// Marca/desmarca a conversa para o relatório manual do dia
app.post('/api/tickets/:id/relatorio', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  if (req.body?.adicionar) {
    // já marcado: mantém o dia original (trocar o texto não move o caso de dia)
    t.relatorioDia = t.relatorioDia || diaLocal(Date.now())
    // texto escolhido no popup; vazio = usa a resolução automática da conversa
    const texto = String(req.body.texto || '').trim()
    t.relatorioTexto = texto || undefined
    t.relatorioLinha = undefined // texto novo invalida a linha editada à mão
  } else {
    t.relatorioDia = undefined
    t.relatorioTexto = undefined
    t.relatorioLinha = undefined
  }
  salvar(req.wsId); ok(req, res)
})

// Edição da linha final do relatório (o que o chefe vê), ex.: corrigir o nº do pedido
app.post('/api/tickets/:id/relatorio-linha', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.relatorioLinha = String(req.body?.linha || '').trim() || undefined
  salvar(req.wsId); ok(req, res)
})

// Move todos os casos marcados de um dia do relatório para outro dia —
// atendeu depois da meia-noite e o relatório "quebrou" em dois? Junta de volta.
app.post('/api/relatorio-mover', (req, res) => {
  const de = String(req.body?.de || '')
  const para = String(req.body?.para || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(para) || de === para) {
    return res.status(400).json({ erro: 'Datas inválidas.', state: visao(req.wsId) })
  }
  for (const t of req.estado.tickets) {
    if (t.relatorioDia === de) t.relatorioDia = para
  }
  salvar(req.wsId); ok(req, res)
})

// Instruções salvas do "Gerar com IA" (configurável pelo lojista)
app.post('/api/instrucao-opcoes', (req, res) => {
  const opcoes = Array.isArray(req.body?.opcoes)
    ? [...new Set(req.body.opcoes.map(o => String(o).trim()).filter(Boolean))].slice(0, 50)
    : null
  if (!opcoes) return res.status(400).json({ erro: 'opcoes deve ser uma lista de textos', state: visao(req.wsId) })
  req.estado.opcoesInstrucao = opcoes
  salvar(req.wsId); ok(req, res)
})

// Lista de opções pré-definidas do relatório manual (configurável pelo lojista)
app.post('/api/relatorio-opcoes', (req, res) => {
  const opcoes = Array.isArray(req.body?.opcoes)
    ? [...new Set(req.body.opcoes.map(o => String(o).trim()).filter(Boolean))].slice(0, 50)
    : null
  if (!opcoes) return res.status(400).json({ erro: 'opcoes deve ser uma lista de textos', state: visao(req.wsId) })
  req.estado.opcoesRelatorio = opcoes
  salvar(req.wsId); ok(req, res)
})

/* ---- Relatório de reembolsos (todas as lojas) ----
   Junta o que o lojista marcou à mão no relatório manual e cujo texto fala em
   reembolso, com o valor pago do pedido, a porcentagem devolvida e o motivo que
   o CLIENTE alegou. O motivo fica guardado na própria conversa (t.motivoReembolso):
   gerar de novo só relê quem ainda não tem motivo ou recebeu mensagem nova. */

const EH_REEMBOLSO = /reembols|estorno|refund|r[üu]ckerstattung|erstattung|rimborso|remboursement|terugbetaling|devoluci[oó]n/i
const SIMBOLOS_MOEDA = { EUR: '€', BRL: 'R$', USD: 'US$', GBP: '£' }

// só as palavras do cliente (sem a citação do e-mail anterior) — é onde está o motivo
function textoDoCliente(t) {
  const partes = [t.assunto, textoProprio(t.corpo)]
  for (const m of t.historico ?? []) {
    if (m.autor !== 'atendo') partes.push(textoProprio(m.corpo))
  }
  return partes.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2500)
}

// reserva para quando a IA não estiver disponível — do mais específico ao mais genérico
const MOTIVOS_LOCAIS = [
  [/al[ée]rg|allerg/i, 'alergia', 'Cliente teve reação alérgica ao material'],
  [/n[ãa]o (?:recebi|chegou|foi entregue)|nunca chegou|nicht (?:erhalten|angekommen)|nie angekommen|never (?:arrived|received)|not (?:received|arrived)|non (?:ho )?ricevut|non [èe] (?:mai )?arrivat|mai arrivat|jamais (?:re[çc]u|arriv[ée])|pas re[çc]u|niet ontvangen|nooit aangekomen|no (?:he )?recibid|nunca lleg/i, 'nao_recebeu', 'Cliente não recebeu o pedido'],
  [/danific|defeito|defeituos|defekt|besch[äa]digt|damaged|difett|d[ée]faut|kapot|rasgad|furo|loch|mancha/i, 'defeito', 'Produto chegou com defeito'],
  [/errad|falsch|wrong (?:item|product|size)|sbagliat|erron|verkeerd/i, 'errado', 'Cliente recebeu o produto errado'],
  [/tamanho|size|gr[öo]ße|taille|taglia|maat|ficou pequen|ficou grand|muito pequen|muito grand|zu klein|zu gro[ßs]|too small|too (?:big|large)|n[ãa]o serviu|passt nicht|doesn'?t fit/i, 'tamanho', 'Cliente disse que o tamanho não serviu'],
  [/qualidade|material|qualit[äa]t|qualit[ée]|qualit[àa]|kwaliteit|tecido|stoff|fabric/i, 'qualidade', 'Cliente não gostou da qualidade do material'],
  [/demor|atras|sp[äa]t|versp[äa]t|delay|ritardo|retard|te laat/i, 'atraso', 'Cliente reclamou da demora na entrega'],
  [/n[ãa]o gost|gef[äa]llt (?:mir )?nicht|don'?t like|didn'?t like|non mi piace|n'?aime pas|bevalt (?:me )?niet/i, 'nao_gostou', 'Cliente não gostou do produto'],
]
function motivoLocal(texto) {
  const achado = MOTIVOS_LOCAIS.find(([re]) => re.test(String(texto || '')))
  return achado ? { motivo: achado[2], categoria: achado[1] } : null
}

// motivo já guardado sem categoria (formato antigo): encaixa pela própria frase
const categoriaDaFrase = frase => motivoLocal(frase)?.categoria ?? 'outro'

const valorFormatado = (valor, moeda) => valor == null
  ? 'valor não encontrado'
  : `${Number(valor).toFixed(2).replace('.', ',')} ${SIMBOLOS_MOEDA[moeda] ?? moeda ?? ''}`.trim()

/** Data da última mensagem do cliente — para saber se o motivo guardado envelheceu. */
function ultimaMensagemDoCliente(t) {
  const datas = [t.data, ...(t.historico ?? []).filter(m => m.autor !== 'atendo').map(m => m.data)]
  return datas.filter(Boolean).sort().pop() ?? null
}

/** Os casos de reembolso do relatório manual, com pedido, valor e % devolvida. */
function casosDeReembolso(estado) {
  const so = n => String(n ?? '').replace(/\D/g, '')
  const itens = []
  for (const t of estado.tickets) {
    if (!t.relatorioDia) continue
    // mesma precedência que o lojista vê na linha do relatório
    const linha = t.relatorioLinha || t.relatorioTexto || t.resolucao || t.resumoSituacao || ''
    if (!EH_REEMBOLSO.test(linha)) continue
    const numero = numeroDoTicketRelatorio(estado, t)
    const pedido = numero
      ? (estado.pedidos ?? []).find(p => (p.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1') && so(p.numero) === so(numero))
      : null
    // quanto foi devolvido: a porcentagem sai da própria linha do relatório
    const pct = /100\s*%/.test(linha) ? 100 : /60\s*%/.test(linha) ? 60 : null
    itens.push({
      ticketId: t.id,
      lojaId: t.lojaId ?? 'loja1',
      dia: t.relatorioDia,
      numero: numero ? String(numero).replace('#', '') : null,
      cliente: t.nome || t.de,
      valor: pedido ? pedido.valor : null,
      percentual: pct,
      reembolsado: pedido && pct ? Math.round(pedido.valor * pct) / 100 : null,
      linha,
    })
  }
  return itens.sort((a, b) => a.lojaId.localeCompare(b.lojaId) || (b.dia || '').localeCompare(a.dia || ''))
}

/** Agrupa por loja e devolve também os totais que alimentam os gráficos. */
function resumoDeReembolsos(estado, itens) {
  const grupos = []
  for (const item of itens) {
    const loja = estado.lojas.find(l => l.id === item.lojaId)
    let g = grupos.find(x => x.lojaId === item.lojaId)
    if (!g) {
      g = { lojaId: item.lojaId, nome: loja?.nome ?? item.lojaId, moeda: loja?.moeda ?? 'EUR', itens: [], reembolsado: 0 }
      grupos.push(g)
    }
    item.valorTexto = valorFormatado(item.valor, g.moeda)
    item.reembolsadoTexto = valorFormatado(item.reembolsado, g.moeda)
    g.reembolsado += item.reembolsado ?? 0
    g.itens.push(item)
  }
  grupos.sort((a, b) => b.itens.length - a.itens.length)

  const moeda = grupos[0]?.moeda ?? 'EUR'
  const porCategoria = []
  for (const [chave, rotulo] of Object.entries(CATEGORIAS_REEMBOLSO)) {
    const doGrupo = itens.filter(i => (i.categoria ?? 'nao_informado') === chave)
    if (!doGrupo.length) continue
    porCategoria.push({
      chave, rotulo,
      quantidade: doGrupo.length,
      reembolsado: doGrupo.reduce((soma, i) => soma + (i.reembolsado ?? 0), 0),
    })
  }
  porCategoria.sort((a, b) => b.quantidade - a.quantidade)

  return {
    grupos,
    moeda,
    total: itens.length,
    reembolsado: Math.round(itens.reduce((s, i) => s + (i.reembolsado ?? 0), 0) * 100) / 100,
    cem: itens.filter(i => i.percentual === 100).length,
    sessenta: itens.filter(i => i.percentual === 60).length,
    semPercentual: itens.filter(i => !i.percentual).length,
    semValor: itens.filter(i => i.valor == null).length,
    porCategoria,
  }
}

/** Texto para copiar, no formato de anotação do lojista. */
function textoDeReembolsos(resumo) {
  const [ano, mes, dia] = diaLocal(Date.now()).split('-')
  const linhas = [`RELATÓRIO DE REEMBOLSOS — ${dia}/${mes}/${ano}`,
    `${resumo.total} caso${resumo.total === 1 ? '' : 's'} · ${valorFormatado(resumo.reembolsado, resumo.moeda)} reembolsados`]
  for (const g of resumo.grupos) {
    linhas.push('', `Loja ${g.nome}`)
    for (const item of g.itens) {
      const quem = item.numero ? `#${item.numero}` : String(item.cliente || '').toUpperCase()
      linhas.push(`${quem} (${item.valorTexto}) - ${item.motivo}`)
    }
  }
  return linhas.join('\n')
}

/** Lê pela IA os motivos que ainda não estão guardados na conversa e grava em
 *  cada uma. Reaproveita o que já foi lido: só paga pelos casos novos, pelos
 *  que receberam mensagem nova do cliente e pelos motivos provisórios. */
async function lerMotivosFaltantes(estado, itens, limite = Infinity) {
  const porId = new Map(estado.tickets.map(t => [t.id, t]))
  const pendentes = []
  for (const item of itens) {
    const t = porId.get(item.ticketId)
    const guardado = t?.motivoReembolso
    const novaMensagem = guardado?.em && (ultimaMensagemDoCliente(t) ?? '') > guardado.em
    // motivo deduzido por palavra-chave (guardado.local) é provisório: quando a
    // IA voltar, ela relê esse caso e substitui pela leitura de verdade
    if (guardado?.motivo && !guardado.local && !novaMensagem) {
      item.motivo = guardado.motivo
      item.categoria = guardado.categoria || categoriaDaFrase(guardado.motivo)
    } else {
      pendentes.push(item)
    }
  }

  const aLer = pendentes.slice(0, limite)
  let custoIA = 0
  let aviso = null
  for (let i = 0; i < aLer.length; i += 8) {
    const lote = aLer.slice(i, i + 8)
    const textos = lote.map(x => textoDoCliente(porId.get(x.ticketId) ?? {}) || '(o cliente não escreveu nada)')
    const r = await extrairMotivosReembolso(textos)
    if (r.erro) { aviso = `Os motivos que faltavam vieram das palavras-chave das conversas — a IA não respondeu (${r.erro})`; break }
    custoIA += r.custo || 0
    const porCaso = (r.custo || 0) / lote.length
    for (const [j, item] of lote.entries()) {
      registrarGasto(estado, item.lojaId, porCaso)
      const bruto = r.motivos[j] ?? {}
      const semMotivo = !bruto.motivo || /^n[ãa]o informado\.?$/i.test(bruto.motivo)
      item.motivo = semMotivo ? 'Cliente não informou o motivo' : bruto.motivo
      item.categoria = semMotivo ? 'nao_informado' : (bruto.categoria || 'outro')
    }
  }

  for (const item of itens) {
    if (!item.motivo) {
      // a regra local só entra quando a IA não leu o caso — se ela leu e disse
      // que não há motivo, palavra-chave solta não pode inventar um
      const local = motivoLocal(textoDoCliente(porId.get(item.ticketId) ?? {}))
      item.motivo = local?.motivo ?? 'Cliente não informou o motivo'
      item.categoria = local?.categoria ?? 'nao_informado'
      item.provisorio = true
    }
    // guarda na conversa: a próxima geração não paga por este caso de novo
    const t = porId.get(item.ticketId)
    if (t) {
      t.motivoReembolso = {
        motivo: item.motivo, categoria: item.categoria, em: new Date().toISOString(),
        ...(item.provisorio ? { local: true } : {}),
      }
    }
    delete item.provisorio
  }

  return { lidos: aLer.length, custoIA: Math.round(custoIA * 1e6) / 1e6, aviso }
}

app.post('/api/relatorio-reembolsos', async (req, res) => {
  const estado = req.estado
  const itens = casosDeReembolso(estado)
  const leitura = await lerMotivosFaltantes(estado, itens)
  const resumo = resumoDeReembolsos(estado, itens)

  // Guarda só a marca de geração — a página pública recalcula com os dados de
  // agora, então valores e motivos nunca ficam desencontrados.
  estado.relatorioReembolsos = { geradoEm: new Date().toISOString(), total: itens.length }
  estado.tokenRelatorio = estado.tokenRelatorio || crypto.randomBytes(16).toString('hex')
  salvar(req.wsId)

  res.json({
    ok: true,
    total: resumo.total,
    grupos: resumo.grupos,
    resumo: { reembolsado: resumo.reembolsado, moeda: resumo.moeda, porCategoria: resumo.porCategoria, cem: resumo.cem, sessenta: resumo.sessenta },
    lidosAgora: leitura.lidos,
    link: `/r/${req.wsId}/${estado.tokenRelatorio}/reembolsos`,
    aviso: leitura.aviso,
    custoIA: leitura.custoIA,
    texto: textoDeReembolsos(resumo),
    state: visao(req.wsId),
  })
})

/* Atualização automática semanal: uma vez por semana o atendo lê sozinho os
   motivos dos reembolsos novos, para o link de acompanhamento nunca ficar
   desatualizado. Só roda em quem já gerou o relatório ao menos uma vez, e o
   teto por rodada evita surpresa de custo. */
const SEMANA_MS = 7 * 864e5
const TETO_LEITURA_AUTO = 300

async function atualizarReembolsosSemanal() {
  if (!iaConfigurada) return
  for (const [wsId, estado] of workspaces) {
    // quem nunca gerou o relatório não paga leitura nenhuma
    if (!estado.relatorioReembolsos) continue
    const ultima = estado.reembolsosAutoEm ? new Date(estado.reembolsosAutoEm).getTime() : 0
    if (Date.now() - ultima < SEMANA_MS) continue
    try {
      const itens = casosDeReembolso(estado)
      const leitura = await lerMotivosFaltantes(estado, itens, TETO_LEITURA_AUTO)
      estado.reembolsosAutoEm = new Date().toISOString()
      estado.relatorioReembolsos = { geradoEm: new Date().toISOString(), total: itens.length }
      salvar(wsId)
      if (leitura.lidos) {
        console.log(`[reembolsos ${wsId}] atualização semanal: ${leitura.lidos} motivo(s) lido(s), US$ ${leitura.custoIA.toFixed(4)}`)
      }
    } catch (err) {
      console.error(`[reembolsos ${wsId}] atualização semanal falhou:`, err.message)
    }
  }
}
agendar(atualizarReembolsosSemanal, 6 * 3600_000)
agendarUmaVez(atualizarReembolsosSemanal, 120_000)

// Fecha o caso SEM enviar e-mail: sai do atendimento humano/aprovações como resolvido
app.post('/api/tickets/:id/resolver', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.status = 'enviado'
  t.respondidoEm = new Date().toISOString()
  t.lido = true
  t.enviaEm = undefined
  t.erroEnvio = undefined
  t.tentativasEnvio = undefined
  t.motivoEscalada = undefined
  t.resolucao = t.resolucao || (t.resposta ? 'Resolvido' : 'Resolvido sem resposta por e-mail')
  t.decisaoPendente = undefined // fechou sem conceder nada: não entra sozinho no relatório
  salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/lido', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.lido = true; salvar(req.wsId); ok(req, res)
})

// Imagem nunca é prova por si só: o lojista confirma na conversa se ela mostra
// o defeito. Só então a troca é oferecida; se não mostrar, pede outra foto.
app.post('/api/tickets/:id/novo/foto', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const an = t.atendimentoNovo
  if (!an || an.fluxo !== 'defeito' || !an.aguardandoComprovacao || !an.fotoRecebida || an.aguardando !== 'humano' || an.fotoValidada === true) {
    return res.status(400).json({ erro: 'A validação de foto só existe no fluxo de defeito, com uma imagem aguardando a sua comprovação.', state: visao(req.wsId) })
  }
  const alvo = an.proximaAposColeta
  if (!alvo || !FASES[alvo]) {
    return res.status(400).json({ erro: 'Esta conversa não tem uma próxima etapa esperando a comprovação da imagem.', state: visao(req.wsId) })
  }
  const agora = new Date().toISOString()
  an.aguardandoComprovacao = false
  if (req.body?.valida === true) {
    an.fotoValidada = true
    an.historicoEtapas.push({ de: an.etapa, para: an.etapa, mensagem: 'Foto validada pelo lojista: comprova o defeito', em: agora, evento: 'foto_validada' })
    an.aguardando = null
    const faltando = faltaPara(alvo, an)
    await prepararRascunhoNovo(req.estado, t, faltando.length
      ? { faseId: 'coleta', faltando, resumo: 'foto validada' }
      : { faseId: alvo, resumo: 'foto validada pelo lojista' })
  } else {
    an.fotoValidada = false
    an.fotoRecebida = false
    an.fotoSolicitada = true
    an.historicoEtapas.push({ de: an.etapa, para: an.etapa, mensagem: 'Foto recusada pelo lojista: não comprova o defeito', em: agora, evento: 'foto_recusada' })
    an.aguardando = null
    await prepararRascunhoNovo(req.estado, t, { faseId: 'def_foto', faltando: ['foto_melhor'], resumo: 'foto recusada pelo lojista' })
  }
  salvar(req.wsId); ok(req, res)
})

// Aceite aprovado pelo lojista: gera a CONFIRMAÇÃO ao cliente (mapa, seção 9):
// troca/reenvio com prazo e endereço; reembolso/cancelamento com 3 a 14 dias
// para o dinheiro voltar; cupom com o código. É a única fase em que a IA pode
// falar de fato consumado — e só depois deste clique. O rascunho passa pela
// Aprovações e pelos mesmos bloqueios (só os números da opção aceita).
app.post('/api/tickets/:id/novo/confirmar', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const an = t.atendimentoNovo
  if (!an || an.aguardando !== 'humano' || !an.acaoAceita) {
    return res.status(400).json({ erro: 'Esta conversa não tem aceite aguardando a sua aprovação.', state: visao(req.wsId) })
  }
  const faseId = faseDeConfirmacao(an.acaoAceita)
  if (!faseId) {
    return res.status(400).json({ erro: `Não há confirmação prevista para "${FASES[an.acaoAceita]?.titulo ?? an.acaoAceita}".`, state: visao(req.wsId) })
  }
  an.historicoEtapas.push({ de: an.etapa, para: an.etapa, mensagem: `Aceite aprovado pelo lojista: ${FASES[an.acaoAceita]?.titulo ?? an.acaoAceita}`, em: new Date().toISOString(), evento: 'aceite_aprovado' })
  an.aguardando = null
  const r = await prepararRascunhoNovo(req.estado, t, { faseId, resumo: 'aceite aprovado pelo lojista' })
  salvar(req.wsId)
  if (!r.ok) return res.status(400).json({ erro: r.motivo, state: visao(req.wsId) })
  ok(req, res)
})

// Central operacional: correção manual da classificação (jornada/fase). Fica
// registrada com quem, quando, a anterior e a justificativa. NÃO mexe no estado
// do motor: o envio automático continua preso às ligações do mapa.
app.post('/api/tickets/:id/central/fase', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const { fase, jornada, justificativa, remover } = req.body ?? {}
  const por = req.usuario?.nome || req.usuario?.email || 'lojista'
  const em = new Date().toISOString()
  const just = String(justificativa || '').trim().slice(0, 300) || null
  const registrar = entrada => { t.centralHistorico = [...(t.centralHistorico ?? []), entrada].slice(-100) }
  if (remover === true) {
    if (!t.centralAjuste) return res.status(400).json({ erro: 'Esta conversa não tem correção manual para remover.', state: visao(req.wsId) })
    registrar({ removido: true, fase: null, jornada: null, anterior: t.centralAjuste.fase ?? null, anteriorJornada: t.centralAjuste.jornada ?? null, por, em, justificativa: just })
    t.centralAjuste = undefined
    salvar(req.wsId); return ok(req, res)
  }
  if (fase !== null && fase !== undefined && fase !== '' && !FASES[fase]) {
    return res.status(400).json({ erro: 'Fase desconhecida.', state: visao(req.wsId) })
  }
  if (jornada && !JORNADAS[jornada]) return res.status(400).json({ erro: 'Jornada desconhecida.', state: visao(req.wsId) })
  const anterior = t.centralAjuste?.fase ?? t.atendimentoNovo?.etapa ?? null
  const anteriorJornada = t.centralAjuste?.jornada ?? null
  // NÃO toca em atendimentoNovo.etapa, transicaoPendente nem na próxima oferta
  t.centralAjuste = { fase: fase || null, jornada: jornada || null, por, em, anterior, justificativa: just }
  registrar({ removido: false, fase: fase || null, jornada: jornada || null, anterior, anteriorJornada, por, em, justificativa: just })
  salvar(req.wsId); ok(req, res)
})

// Central operacional consolidada: os mesmos números que a página calcula, saídos
// da mesma função (shared/central.js) sobre os dados do servidor.
app.get('/api/central', (req, res) => {
  const q = req.query ?? {}
  const filtros = {
    busca: String(q.busca ?? ''), lojaId: String(q.loja ?? 'todas'),
    periodo: ['7', '30', '90'].includes(String(q.periodo)) ? String(q.periodo) : 'todas',
    desfecho: String(q.desfecho ?? 'todos'), jornada: String(q.jornada ?? 'todas'), fase: String(q.fase ?? 'todas'),
  }
  const r = calcularCentral({ tickets: req.estado.tickets, pedidos: req.estado.pedidos ?? [], lojas: req.estado.lojas, fases: catalogoFases(), filtros })
  res.json({ filtros: r.filtros, registros: r.registros, linhas: r.linhas, metricas: r.metricas, indicadores: r.indicadores })
})

/* ---------------- Parte 8: migração dos casos históricos como "fase inferida" ----------------
   A IA lê as conversas antigas (cliente e loja) e o resultado vai para
   ticket.inferenciaCentral — campo só da Central. Nada mais no ticket muda:
   status, categoria, relatório e motor ficam como estão. Só roda por clique
   do dono, em lotes, e nunca sozinha. */

// Conversa em ordem cronológica (os dois lados), porque a fase depende do que a
// LOJA ofereceu por último. Em conversa longa, mantém o INÍCIO (assunto e primeiras
// mensagens, para contexto) e o FIM (últimas mensagens do cliente e da loja — a
// última oferta e o encerramento), nunca só os primeiros caracteres.
export const LIMITE_INFERENCIA = 3500 // tamanho máximo do texto FINAL de um caso, já com marcadores e quebras
const LIMITE_INICIO = 900               // orçamento do início (assunto + primeiras mensagens)
const MARCA_FINAL = '[FINAL DA CONVERSA — as últimas mensagens são as que valem para a fase e o desfecho]'
const marcaOmissao = n => `[... ${n} mensagem(ns) intermediária(s) omitida(s) ...]`
export function textoParaInferencia(t) {
  const blocos = [`Assunto: ${t.assunto ?? ''}`]
  for (const m of t.historico ?? []) blocos.push(`${m.autor === 'atendo' ? 'Loja' : 'Cliente'}: ${m.autor === 'atendo' ? String(m.corpo || '') : textoProprio(m.corpo)}`)
  blocos.push(`Cliente (mensagem atual): ${textoProprio(t.corpo) || ''}`)
  if (t.resposta) blocos.push(`Loja (última resposta): ${t.resposta}`)
  const limpos = blocos.map(b => b.replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean)
  const inteiro = limpos.join('\n')
  if (inteiro.length <= LIMITE_INFERENCIA) return inteiro
  // orçamento do FIM = limite − início − marcadores (com folga para o número) − quebras de linha
  const reservaMarcadores = marcaOmissao(9999).length + MARCA_FINAL.length + 4
  const orcamentoFim = LIMITE_INFERENCIA - LIMITE_INICIO - reservaMarcadores
  // fim primeiro (prioridade): última resposta da loja, mensagem atual, última oferta… blocos inteiros do fim para trás
  const fim = []
  let tam = 0
  for (let i = limpos.length - 1; i >= 1; i--) {
    const b = limpos[i]
    if (tam + b.length + 1 > orcamentoFim) {
      // só se nem o último bloco couber inteiro: fica com o final dele (nunca o começo)
      if (!fim.length) fim.unshift('…' + b.slice(-(orcamentoFim - 2)))
      break
    }
    fim.unshift(b); tam += b.length + 1
  }
  // início: o assunto sempre (cortado se for absurdo) e as primeiras mensagens que couberem
  const primeiroDoFim = limpos.length - fim.length
  const assunto = limpos[0].length > LIMITE_INICIO ? limpos[0].slice(0, LIMITE_INICIO - 1) + '…' : limpos[0]
  const inicio = [assunto]
  let tamIni = assunto.length
  for (let i = 1; i < primeiroDoFim; i++) {
    const b = limpos[i]
    if (tamIni + b.length + 1 > LIMITE_INICIO) break
    inicio.push(b); tamIni += b.length + 1
  }
  const montar = () => [...inicio, marcaOmissao(primeiroDoFim - inicio.length), MARCA_FINAL, ...fim].join('\n')
  let texto = montar()
  // garantia final: o texto entregue nunca passa do limite — se passar, cai o início, nunca o fim
  while (texto.length > LIMITE_INFERENCIA && inicio.length > 1) { inicio.pop(); texto = montar() }
  if (texto.length > LIMITE_INFERENCIA) texto = texto.slice(texto.length - LIMITE_INFERENCIA)
  return texto
}

app.get('/api/central/migracao', (req, res) => {
  res.json({ ...statusMigracao(req.estado.tickets), iaConfigurada, ultima: req.estado.migracaoCentral ?? null })
})

app.post('/api/central/migrar', async (req, res) => {
  const { limite, forcar, ticketId, remover } = req.body ?? {}
  if (ticketId && remover === true) {
    const t = req.estado.tickets.find(x => x.id === ticketId)
    if (!t) return res.status(404).json({ erro: 'Conversa não encontrada.', state: visao(req.wsId) })
    t.inferenciaCentral = undefined
    salvar(req.wsId); return ok(req, res)
  }
  if (!iaConfigurada) return res.status(400).json({ erro: 'A inferência dos casos antigos usa o Claude — configure a ANTHROPIC_API_KEY primeiro.', state: visao(req.wsId) })
  const max = Math.max(1, Math.min(200, Number(limite) || 40))
  const alvo = ticketId
    ? req.estado.tickets.filter(t => t.id === ticketId && ehCandidatoMigracao(t))
    : req.estado.tickets.filter(t => ehCandidatoMigracao(t) && (forcar === true || !t.inferenciaCentral)).slice(0, max)
  if (ticketId && !alvo.length) return res.status(400).json({ erro: 'Esta conversa não é um caso histórico do modo clássico.', state: visao(req.wsId) })
  const catalogo = FASES_MIGRAVEIS.filter(id => FASES[id] && !FASES[id].confirmacao).map(id => ({ id, titulo: FASES[id].titulo, jornada: FASES[id].jornada }))
  const fases = catalogoFases()
  let lidos = 0; let custoIA = 0; let aviso = null
  for (let i = 0; i < alvo.length; i += 8) {
    const lote = alvo.slice(i, i + 8)
    const r = await inferirFasesHistoricas(lote.map(textoParaInferencia), catalogo)
    if (r.erro) { aviso = `A IA não respondeu (${r.erro}); ${lidos} caso(s) inferido(s) antes disso.`; break }
    custoIA += r.custo || 0
    const porCaso = (r.custo || 0) / lote.length
    for (const [j, t] of lote.entries()) {
      const n = normalizarInferencia(r.inferencias[j], fases)
      if (!n) continue
      t.inferenciaCentral = { ...n, em: new Date().toISOString(), origem: 'ia' }
      registrarGasto(req.estado, t.lojaId, porCaso)
      lidos++
    }
  }
  const st = statusMigracao(req.estado.tickets)
  req.estado.migracaoCentral = { em: new Date().toISOString(), lidos, custoIA: Math.round(custoIA * 1e6) / 1e6, por: req.usuario?.nome || req.usuario?.email || 'lojista' }
  salvar(req.wsId)
  res.json({ ok: true, lidos, restantes: st.pendentes, custoIA: Math.round(custoIA * 1e6) / 1e6, aviso, ...st, state: visao(req.wsId) })
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

  // Modo novo: nunca o pipeline clássico. Reescreve SOMENTE a ação da fase
  // pendente; a instrução só pode mexer em tom/tamanho; passa pelos mesmos bloqueios.
  const lojaR = req.estado.lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
  if (motorDaConversa(t) === 'novo') {
    const anR = t.atendimentoNovo
    const faseId = anR?.transicaoPendente?.para
    if (!faseId) {
      return res.status(400).json({ erro: 'No modo novo esta conversa não tem ação automática agora (está com você) — escreva a resposta.', state: visao(req.wsId) })
    }
    const bloqueio = instrucaoAlteraOferta(instrucao, lojaR)
    if (bloqueio) return res.status(400).json({ erro: `Instrução recusada: ${bloqueio}.`, state: visao(req.wsId) })
    if (req.body.somenteTexto) {
      // escreve a MESMA ação para a caixa manual, sem mexer no rascunho nem no estado
      const p = promptEscrever({ loja: lojaR, config: req.estado.config, faseId, faltando: anR.transicaoPendente.faltando ?? [], an: anR, pedido: pedidoDoTicket(req.estado, t), ticket: t, instrucaoEstilo: instrucao || null, idiomaAlvo: anR.idioma ?? null })
      const e = await escreverNovo(p.system, p.user)
      if (e.erro) return res.status(400).json({ erro: e.erro, state: visao(req.wsId) })
      somarCusto(t, e.custo); registrarGasto(req.estado, t.lojaId, e.custo)
      const v = conferirTextoDaFase(faseId, e.r.resposta, lojaR, anR, pedidoDoTicket(req.estado, t), { faltando: anR.transicaoPendente.faltando ?? [], idioma: anR.idioma ?? null })
      if (!v.ok || (e.r.acao_proposta && e.r.acao_proposta !== faseId)) {
        return res.status(400).json({ erro: `A IA saiu da etapa permitida: ${v.motivo || 'ação diferente da permitida'}. Tente de novo.`, state: visao(req.wsId) })
      }
      const vi = conferirIdioma(e.r.resposta, anR.idioma ?? null, e.r.idioma)
      if (!vi.ok) return res.status(400).json({ erro: `Resposta gerada no idioma errado: ${vi.motivo}. Tente de novo.`, state: visao(req.wsId) })
      salvar(req.wsId)
      return res.json({ ok: true, texto: e.r.resposta, state: visao(req.wsId) })
    }
    const r = await prepararRascunhoNovo(req.estado, t, { faseId, faltando: anR.transicaoPendente.faltando ?? [], resumo: anR.transicaoPendente.mensagem, instrucaoEstilo: instrucao || null, aoFalhar: 'manter' })
    salvar(req.wsId)
    if (!r.ok) return res.status(400).json({ erro: `${r.motivo}. O rascunho anterior foi mantido.`, state: visao(req.wsId) })
    return ok(req, res)
  }

  const r = await processarEmailIA(req.estado, t, instrucao || 'Reescreva a resposta da melhor forma possível.')
  if (!r || !r.resposta) {
    return res.status(400).json({ erro: statusIA.erro || 'A IA não devolveu uma resposta. Tente de novo.', state: visao(req.wsId) })
  }
  // Modo "só o texto": usado pelas caixas de resposta manual/nova mensagem —
  // devolve o texto gerado sem virar rascunho nem mexer no status da conversa
  if (req.body.somenteTexto) {
    if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
    registrarGasto(req.estado, t.lojaId, r.custo)
    salvar(req.wsId)
    return res.json({ ok: true, texto: r.resposta, state: visao(req.wsId) })
  }
  t.rascunho = r.resposta
  t.rascunhoTraducao = undefined
  t.confianca = r.confianca
  t.geradoPorIA = true
  if (r.situacao) t.resumoSituacao = r.situacao
  if (r.custo) t.custoIA = Math.round(((t.custoIA || 0) + r.custo) * 1e6) / 1e6
  registrarGasto(req.estado, t.lojaId, r.custo)
  salvar(req.wsId); ok(req, res)
})

// Traduz o rascunho para o lojista ler — Google, gratuito; o envio usa o original
app.post('/api/tickets/:id/traduzir-rascunho', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  if (!t.rascunho) return res.status(400).json({ erro: 'Este ticket não tem rascunho para traduzir.', state: visao(req.wsId) })
  // retraduz sempre que o rascunho mudou desde a última tradução — nunca
  // mostra tradução de um texto antigo (cobre inclusive tickets já salvos)
  if (!t.rascunhoTraducao || t.rascunhoTraduzidoDe !== t.rascunho) {
    const r = await traduzirGratis([t.rascunho])
    if (r.erro) return res.status(400).json({ erro: r.erro, state: visao(req.wsId) })
    t.rascunhoTraducao = r.textos[0]
    t.rascunhoTraduzidoDe = t.rascunho
    if (r.custoIA) { // fallback pelo Gemini quando o Google recusa
      t.custoIA = Math.round(((t.custoIA || 0) + r.custoIA) * 1e6) / 1e6
      registrarGasto(req.estado, t.lojaId, r.custoIA)
    }
    salvar(req.wsId)
  }
  ok(req, res)
})

// Traduz um texto avulso (o que o lojista escreveu/gerou na caixa manual) — Google, gratuito
app.post('/api/traduzir-texto', async (req, res) => {
  const texto = String(req.body?.texto || '').trim()
  if (!texto) return res.status(400).json({ erro: 'Nada para traduzir.' })
  const r = await traduzirGratis([texto])
  if (r.erro) return res.status(400).json({ erro: r.erro })
  res.json({ ok: true, traducao: r.textos[0] })
})

// E-mail novo (painel Pedidos / Novo email): a IA escreve a mensagem no idioma
// da loja, com o contexto dos pedidos do destinatário — sem precisar de ticket
app.post('/api/gerar-email', async (req, res) => {
  if (!iaConfigurada) {
    return res.status(400).json({ erro: 'Gerar com IA usa o Claude — configure a ANTHROPIC_API_KEY primeiro.' })
  }
  const para = String(req.body.para || '').trim()
  if (!para) return res.status(400).json({ erro: 'Informe o destinatário primeiro.' })
  const instrucao = String(req.body.instrucao || '').trim()
  const idioma = String(req.body.idioma || '').trim().slice(0, 8)
  const pseudo = {
    de: para,
    nome: para.split('@')[0],
    assunto: String(req.body.assunto || ''),
    corpo: '(O cliente ainda não escreveu nada — a loja está INICIANDO o contato. Escreva o e-mail pedido na instrução do lojista.)',
    historico: [],
    lojaId: req.body.lojaId,
  }
  const r = await processarEmailIA(req.estado, pseudo, [
    'Escreva um NOVO e-mail da loja para este cliente (não é resposta a uma mensagem dele).',
    idioma ? `Escreva a mensagem no idioma de código ISO "${idioma}".` : '',
    instrucao || 'Escreva uma atualização cordial sobre o pedido do cliente (status e rastreio, se houver).',
  ].filter(Boolean).join(' '))
  if (!r || !r.resposta) {
    return res.status(400).json({ erro: statusIA.erro || 'A IA não devolveu uma resposta. Tente de novo.' })
  }
  registrarGasto(req.estado, pseudo.lojaId, r.custo)
  salvar(req.wsId)
  res.json({ ok: true, texto: r.resposta })
})

app.post('/api/tickets/:id/aprovar', async (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  try {
    const motivo = t.motivoEscalada
    const motivoTrad = t.motivoTraducao
    // fotografado ANTES do envio (enviarResposta sobrescreve o rascunho)
    const tinhaRascunho = t.rascunho !== undefined
    const rascunhoIA = tinhaRascunho && t.geradoPorIA ? t.rascunho : null
    const decisao = t.decisaoPendente
    // origem vem do frontend (caixa da IA ou caixa manual); sem ela, deduz pelo rascunho
    const origem = req.body.origem === 'ia' || req.body.origem === 'manual'
      ? req.body.origem
      : (t.geradoPorIA && String(req.body.texto ?? '') === (t.rascunho ?? '') ? 'ia' : 'manual')
    const textoFinal = String(req.body.texto ?? t.rascunho ?? '')

    // modo novo: o texto FINAL (regenerado ou editado à mão) tem de pertencer à
    // fase pendente; edição que mude a oferta exige confirmação explícita
    const anA = t.atendimentoNovo
    if (anA?.transicaoPendente?.para) {
      const faseId = anA.transicaoPendente.para
      const lojaA = req.estado.lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
      const v = conferirTextoDaFase(faseId, textoFinal, lojaA, anA, pedidoDoTicket(req.estado, t), { faltando: anA.transicaoPendente.faltando ?? [], idioma: anA.idioma ?? null })
      if (!v.ok) {
        return res.status(400).json({ erro: `Não enviado — o texto não pertence à etapa "${FASES[faseId].titulo}": ${v.motivo}.`, state: visao(req.wsId) })
      }
      const vi = conferirIdioma(textoFinal, anA.idioma ?? null, textoFinal === (t.rascunho ?? '') ? (anA.rascunhoIdioma ?? null) : null)
      if (!vi.ok) {
        return res.status(400).json({ erro: `Não enviado — resposta no idioma errado: ${vi.motivo}.`, state: visao(req.wsId) })
      }
      const dif = diferencaDeOferta(anA.rascunhoGerado ?? t.rascunho, textoFinal, lojaA)
      if (dif && req.body.confirmarAlteracao !== true) {
        return res.status(409).json({ precisaConfirmar: true, erro: `Sua edição muda a oferta desta etapa (${dif}).`, state: visao(req.wsId) })
      }
      if (dif) anA.transicaoPendente.observacao = `Edição manual confirmada pelo lojista: ${dif}`
    }

    await enviarResposta(req.wsId, t, textoFinal, origem)
    // "Enviar e manter comigo": a mensagem sai, mas a conversa continua em
    // atendimento humano até o lojista aprovar (fechar) de verdade
    if (req.body.manterAberto) {
      t.status = 'humano'
      t.motivoEscalada = motivo
      t.motivoTraducao = motivoTrad
      t.rascunho = undefined
      t.rascunhoTraducao = undefined
    }

    // Aprendizado de estilo: guarda como o lojista REALMENTE respondeu — a IA
    // imita nos próximos rascunhos desta loja. Aprende só com texto do lojista:
    // rascunho da IA editado por ele, ou resposta manual do zero.
    const textoEnviado = String(req.body.texto ?? '').trim()
    if (textoEnviado.length >= 60) {
      const par = rascunhoIA
        ? (textoEnviado !== rascunhoIA.trim() ? { de: rascunhoIA, para: textoEnviado } : null)
        : (!tinhaRascunho ? { para: textoEnviado } : null)
      if (par) {
        req.estado.estiloExemplos ??= {}
        const lista = (req.estado.estiloExemplos[t.lojaId ?? 'loja1'] ??= [])
        lista.push({ ...par, em: new Date().toISOString() })
        if (lista.length > 5) lista.splice(0, lista.length - 5)
      }
    }

    // O relatório manual é 100% do lojista: nada entra sozinho — ele usa o
    // botão "Adicionar ao relatório" quando quiser (pedido dele, 07/09/2026)
    if (decisao) t.decisaoPendente = undefined

    salvar(req.wsId); ok(req, res)
  } catch (err) {
    console.error('[enviar]', err)
    res.status(500).json({ erro: 'Falha ao enviar: ' + err.message, state: visao(req.wsId) })
  }
})

// Marca à mão que a conversa já foi respondida (sem enviar nada nem fechar) —
// para quando a resposta saiu por outro caminho e a lista não mostra
app.post('/api/tickets/:id/respondido', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.marcadoRespondido = !!req.body?.marcar || undefined
  salvar(req.wsId); ok(req, res)
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
  // o assunto também entra na tradução (título da conversa)
  if (t.assunto && !t.assuntoTraducao) alvos.push({ corpo: t.assunto, aplicar: tx => { t.assuntoTraducao = tx } })
  for (const m of t.historico ?? []) {
    if (m.corpo && !m.traducao) alvos.push({ corpo: m.corpo, aplicar: tx => { m.traducao = tx } })
  }
  if (t.corpo && !t.traducao) alvos.push({ corpo: t.corpo, aplicar: tx => { t.traducao = tx } })
  if (t.resposta && !t.respostaTraducao) alvos.push({ corpo: t.resposta, aplicar: tx => { t.respostaTraducao = tx } })
  // situação e motivo podem ter vindo no idioma da loja em tickets antigos
  if (t.resumoSituacao && !t.situacaoTraducao) alvos.push({ corpo: t.resumoSituacao, aplicar: tx => { t.situacaoTraducao = tx } })
  if (t.motivoEscalada && !t.motivoTraducao) alvos.push({ corpo: t.motivoEscalada, aplicar: tx => { t.motivoTraducao = tx } })
  if (!alvos.length) return ok(req, res)
  // tradução pelo Google (gratuita) — não gasta créditos da Claude
  const r = await traduzirGratis(alvos.map(a => a.corpo))
  if (r.erro) return res.status(400).json({ erro: r.erro, state: visao(req.wsId) })
  r.textos.forEach((texto, i) => alvos[i].aplicar(texto))
  if (r.custoIA) { // fallback pelo Gemini quando o Google recusa
    t.custoIA = Math.round(((t.custoIA || 0) + r.custoIA) * 1e6) / 1e6
    registrarGasto(req.estado, t.lojaId, r.custoIA)
  }
  salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/mover', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  const destinos = ['inbox', 'aprovacao', 'humano', 'spam', 'lixeira']
  if (!destinos.includes(req.body.status)) return res.status(400).json({ erro: 'status inválido', state: visao(req.wsId) })
  t.statusAnterior = t.status
  t.status = req.body.status
  // spam marcado à mão pelo lojista não é resgatado pelo automático
  if (req.body.status === 'spam') t.spamManual = true
  if (req.body.motivo) t.motivoEscalada = req.body.motivo
  t.enviaEm = undefined
  salvar(req.wsId); ok(req, res)
})

app.post('/api/tickets/:id/restaurar', (req, res) => {
  const t = acharTicket(req, res); if (!t) return
  t.status = t.statusAnterior && t.statusAnterior !== 'lixeira' ? t.statusAnterior : 'inbox'
  t.spamManual = undefined // restaurou: volta a valer a classificação automática
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
      resposta: corpo || '', respostaOrigem: 'manual', respondidoEm: new Date().toISOString(),
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
app.post('/api/comportamentos/:id/editar', (req, res) => {
  const situacao = String(req.body.situacao || '').trim()
  const instrucao = String(req.body.instrucao || '').trim()
  if (!situacao || !instrucao) return res.status(400).json({ erro: 'Descreva a situação e como a IA deve agir.', state: visao(req.wsId) })
  req.estado.comportamentos = (req.estado.comportamentos ?? []).map(c =>
    (c.id === req.params.id ? { ...c, situacao, instrucao } : c))
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
  neutralizarAutoEnvioNoPiloto()

  servidorHttp = app.listen(PORT, async () => {
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
