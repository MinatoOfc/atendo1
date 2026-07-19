import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'

const presets = {
  gmail: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  outlook: { imap: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com' },
  yahoo: { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  icloud: { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
  hostinger: { imap: 'imap.hostinger.com', smtp: 'smtp.hostinger.com' },
  titan: { imap: 'imap.titan.email', smtp: 'smtp.titan.email' },
  zoho: { imap: 'imap.zoho.com', smtp: 'smtp.zoho.com' },
}

const provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase()
const user = (process.env.EMAIL_USER || '').trim()
// Senhas de app do Google são exibidas em blocos ("abcd efgh ijkl mnop") e quase
// sempre chegam aqui com espaços; o servidor IMAP as rejeita nesse formato.
const pass = (process.env.EMAIL_PASS || '').replace(/\s+/g, '')
const imapHost = (process.env.EMAIL_IMAP_HOST || presets[provider]?.imap || '').trim()
const smtpHost = (process.env.EMAIL_SMTP_HOST || presets[provider]?.smtp || '').trim()
const imapPort = Number(process.env.EMAIL_IMAP_PORT || 993)
const smtpPort = Number(process.env.EMAIL_SMTP_PORT || 465)
// Janela de busca: e-mails mais antigos que isso são ignorados
const diasJanela = Number(process.env.EMAIL_DIAS || 3)
// Envio por API HTTP (porta 443), alternativa quando a hospedagem bloqueia SMTP
const resendKey = (process.env.RESEND_API_KEY || '').trim()
const remetente = (process.env.EMAIL_FROM || '').trim()
const MAX_POR_SYNC = 20

// Marca as respostas que o próprio atendo envia, para nunca reprocessá-las
const HEADER_AUTO = 'x-atendo-auto'

export const emailConfigurado = !!(user && pass && imapHost && smtpHost)
export const enderecoEmail = emailConfigurado ? user : null
export const envioPorApi = !!resendKey
export const enderecoRemetente = remetente || user

// Estado da conexão, exposto na interface para não depender dos logs do servidor
export const statusEmail = { ok: null, erro: null, verificadoEm: null }

function traduzirErro(err) {
  const m = String(err?.responseText || err?.message || err)
  if (/AUTHENTICATION\s*FAILED|Invalid credentials|Username and Password not accepted|LOGIN\s*failed|AUTHENTICATE\s*failed|535|\bEAUTH\b/i.test(m)) {
    if (provider === 'gmail' || /gmail|google/i.test(imapHost)) {
      return 'O Gmail recusou o login. Use uma SENHA DE APP de 16 letras (não a senha normal da conta) — exige verificação em duas etapas ativa — e confirme que o IMAP está ligado em Gmail → Configurações → Encaminhamento e POP/IMAP.'
    }
    if (/hostinger|titan/i.test(provider) || /hostinger|titan/i.test(imapHost)) {
      return `O servidor recusou o login de ${user}. Use a senha da CAIXA DE E-MAIL (a que você definiu ao criar a conta no hPanel), não a senha do painel da Hostinger. Se esqueceu, redefina em hPanel → E-mails → Contas de e-mail → Alterar senha. Confirme também que o endereço existe exatamente assim.`
    }
    return `Usuário ou senha recusados pelo servidor de e-mail (${user}). Confirme as credenciais e se o provedor exige senha de aplicativo.`
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return `Servidor não encontrado (${imapHost}). Verifique EMAIL_PROVIDER ou EMAIL_IMAP_HOST.`
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(m)) return `Sem conexão com ${imapHost}:${imapPort}. Verifique host e porta.`
  if (/certificate|self.signed/i.test(m)) return 'Certificado TLS do servidor não pôde ser validado.'
  return m.slice(0, 300)
}

function novoClienteImap() {
  return new ImapFlow({
    host: imapHost, port: imapPort, secure: true,
    auth: { user, pass }, logger: false,
  })
}

const desde = () => new Date(Date.now() - diasJanela * 24 * 3600_000)

export async function verificarConexao() {
  if (!emailConfigurado) {
    Object.assign(statusEmail, { ok: null, erro: null, verificadoEm: null })
    return statusEmail
  }
  const client = novoClienteImap()
  try {
    await client.connect()
    await client.logout().catch(() => {})
    Object.assign(statusEmail, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
  } catch (err) {
    Object.assign(statusEmail, { ok: false, erro: traduzirErro(err), verificadoEm: new Date().toISOString() })
  }
  return statusEmail
}

/**
 * Diagnóstico: mostra o que o app realmente enxerga na caixa de entrada,
 * e por que cada mensagem recente virou ou não virou ticket.
 */
export async function diagnosticar(jaProcessados = []) {
  if (!emailConfigurado) return { ok: false, erro: 'E-mail não configurado.' }
  const client = novoClienteImap()
  try {
    await client.connect()
  } catch (err) {
    const erro = traduzirErro(err)
    Object.assign(statusEmail, { ok: false, erro, verificadoEm: new Date().toISOString() })
    return { ok: false, erro }
  }

  const lock = await client.getMailboxLock('INBOX')
  try {
    const caixa = client.mailbox
    const uids = await client.search({ since: desde() }, { uid: true })
    const recentes = (uids || []).slice(-15).reverse()
    const mensagens = []
    for (const uid of recentes) {
      const msg = await client.fetchOne(uid, { envelope: true, flags: true, headers: [HEADER_AUTO] }, { uid: true })
      if (!msg?.envelope) continue
      const de = msg.envelope.from?.[0]
      const id = msg.envelope.messageId
      const auto = String(msg.headers ?? '').toLowerCase().includes(HEADER_AUTO)
      mensagens.push({
        de: de?.address ?? '(sem remetente)',
        assunto: msg.envelope.subject || '(sem assunto)',
        data: msg.envelope.date?.toISOString?.() ?? null,
        lido: !!msg.flags?.has?.('\\Seen'),
        virouTicket: id ? jaProcessados.includes(id) : false,
        respostaDoAtendo: auto,
      })
    }
    Object.assign(statusEmail, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
    return {
      ok: true,
      caixa: enderecoEmail,
      totalNaCaixa: caixa?.exists ?? 0,
      janelaDias: diasJanela,
      encontradosNaJanela: (uids || []).length,
      mensagens,
    }
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
}

export async function buscarNovosEmails(jaProcessados) {
  if (!emailConfigurado) return []
  const client = novoClienteImap()
  const novos = []
  try {
    await client.connect()
  } catch (err) {
    Object.assign(statusEmail, { ok: false, erro: traduzirErro(err), verificadoEm: new Date().toISOString() })
    throw new Error(statusEmail.erro)
  }

  const lock = await client.getMailboxLock('INBOX')
  try {
    // Busca por data, não pelo flag de lido: um e-mail que você abriu no Gmail
    // continua sendo um e-mail de cliente que precisa de resposta.
    const uids = await client.search({ since: desde() }, { uid: true })
    const recentes = (uids || []).slice(-MAX_POR_SYNC * 3).reverse()

    for (const uid of recentes) {
      if (novos.length >= MAX_POR_SYNC) break
      const msg = await client.fetchOne(uid, { source: true }, { uid: true })
      if (!msg?.source) continue
      const parsed = await simpleParser(msg.source)
      const id = parsed.messageId || `uid-${uid}-${parsed.date?.getTime()}`
      if (jaProcessados.includes(id)) continue
      // nunca reprocessa uma resposta enviada pelo próprio atendo
      if (parsed.headers?.get?.(HEADER_AUTO)) continue
      const remetente = parsed.from?.value?.[0]
      if (!remetente?.address) continue

      novos.push({
        messageId: id,
        nome: remetente.name || remetente.address.split('@')[0],
        de: remetente.address,
        assunto: parsed.subject || '(sem assunto)',
        corpo: (parsed.text || '').trim().slice(0, 8000),
        data: (parsed.date || new Date()).toISOString(),
      })
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {})
    }
    Object.assign(statusEmail, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
  return novos
}

let transporte = null
function getTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: smtpHost, port: smtpPort, secure: smtpPort === 465,
      auth: { user, pass },
      // Sem estes limites, uma porta bloqueada deixa o envio pendurado para sempre
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    })
  }
  return transporte
}

/** Valida o envio (SMTP) separadamente da leitura (IMAP). */
export async function verificarEnvio() {
  if (envioPorApi) {
    try {
      const resp = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
      if ([400, 401, 403].includes(resp.status)) {
        return { ok: false, erro: 'A Resend recusou a chave de API. Confira RESEND_API_KEY — ela começa com "re_" e é gerada em resend.com → API Keys.' }
      }
      if (!resp.ok) return { ok: false, erro: `A Resend respondeu ${resp.status} ao validar a chave.` }
      return { ok: true, erro: null, via: 'resend' }
    } catch (err) {
      return { ok: false, erro: `Não foi possível alcançar a Resend: ${err.message}` }
    }
  }
  if (!emailConfigurado) return { ok: null, erro: null }
  try {
    await getTransporte().verify()
    return { ok: true, erro: null, via: 'smtp' }
  } catch (err) {
    return { ok: false, erro: traduzirErroEnvio(err) }
  }
}

function traduzirErroEnvio(err) {
  const m = String(err?.message || err)
  const code = err?.code
  if (/AUTHENTICATION\s*FAILED|Invalid login|535|\bEAUTH\b/i.test(m) || code === 'EAUTH') {
    return `O servidor de envio recusou o login de ${user}. Confirme a senha da caixa de e-mail.`
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNREFUSED' || /timeout/i.test(m)) {
    const alternativa = smtpPort === 465 ? 587 : 465
    return `Não foi possível conectar em ${smtpHost}:${smtpPort}. `
      + `Muitas hospedagens (Railway inclusive) bloqueiam a saída SMTP — se a porta ${alternativa} também falhar, o bloqueio é da hospedagem, não do seu e-mail. `
      + `Nesse caso, configure o envio por API definindo RESEND_API_KEY (veja as Configurações).`
  }
  if (code === 'EENVELOPE' || /recipient|sender|relay/i.test(m)) {
    return `O servidor recusou o destinatário ou remetente: ${m.slice(0, 160)}`
  }
  return m.slice(0, 250)
}

async function enviarPorApi({ para, assunto, corpo }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: enderecoRemetente,
      to: [para],
      subject: assunto,
      text: corpo,
      reply_to: user,
      headers: { 'X-Atendo-Auto': '1' },
    }),
  })
  if (!resp.ok) {
    const corpoErro = await resp.text().catch(() => '')
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('A Resend recusou a chave de API. Confira RESEND_API_KEY.')
    }
    if (resp.status === 422 || /domain|from/i.test(corpoErro)) {
      throw new Error(`A Resend recusou o remetente "${enderecoRemetente}". O domínio precisa estar verificado na Resend — ou use EMAIL_FROM com um endereço já verificado. Detalhe: ${corpoErro.slice(0, 160)}`)
    }
    throw new Error(`A Resend respondeu ${resp.status}: ${corpoErro.slice(0, 180)}`)
  }
  return true
}

export async function enviarEmailReal({ para, assunto, corpo }) {
  if (!emailConfigurado && !envioPorApi) return false
  const titulo = assunto.startsWith('Re:') ? assunto : `Re: ${assunto}`

  if (envioPorApi) return enviarPorApi({ para, assunto: titulo, corpo })

  try {
    await getTransporte().sendMail({
      from: user,
      to: para,
      subject: titulo,
      text: corpo,
      headers: { 'X-Atendo-Auto': '1' },
    })
    return true
  } catch (err) {
    throw new Error(traduzirErroEnvio(err))
  }
}
