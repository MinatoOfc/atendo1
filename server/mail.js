import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'

const presets = {
  gmail: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  outlook: { imap: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com' },
  yahoo: { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  icloud: { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
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

export const emailConfigurado = !!(user && pass && imapHost && smtpHost)
export const enderecoEmail = emailConfigurado ? user : null

// Estado da conexão, exposto na interface para não depender dos logs do servidor
export const statusEmail = { ok: null, erro: null, verificadoEm: null }

function traduzirErro(err) {
  const m = String(err?.responseText || err?.message || err)
  if (/AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|535/i.test(m)) {
    return provider === 'gmail' || /gmail|google/i.test(imapHost)
      ? 'O Gmail recusou o login. Use uma SENHA DE APP de 16 letras (não a senha normal da conta) — exige verificação em duas etapas ativa — e confirme que o IMAP está ligado em Gmail → Configurações → Encaminhamento e POP/IMAP.'
      : 'Usuário ou senha recusados pelo servidor de e-mail. Confirme as credenciais e se o provedor exige senha de aplicativo.'
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
    const uids = await client.search({ seen: false }, { uid: true })
    for (const uid of uids || []) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true })
      if (!msg?.source) continue
      const parsed = await simpleParser(msg.source)
      const id = parsed.messageId || `uid-${uid}-${parsed.date?.getTime()}`
      if (jaProcessados.includes(id)) continue
      const remetente = parsed.from?.value?.[0]
      if (!remetente?.address) continue
      // não processa e-mails enviados por nós mesmos
      if (remetente.address.toLowerCase() === user.toLowerCase()) continue
      novos.push({
        messageId: id,
        nome: remetente.name || remetente.address.split('@')[0],
        de: remetente.address,
        assunto: parsed.subject || '(sem assunto)',
        corpo: (parsed.text || '').trim().slice(0, 8000),
        data: (parsed.date || new Date()).toISOString(),
      })
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
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
    })
  }
  return transporte
}

export async function enviarEmailReal({ para, assunto, corpo }) {
  if (!emailConfigurado) return false
  try {
    await getTransporte().sendMail({
      from: user,
      to: para,
      subject: assunto.startsWith('Re:') ? assunto : `Re: ${assunto}`,
      text: corpo,
    })
    return true
  } catch (err) {
    throw new Error(traduzirErro(err))
  }
}
