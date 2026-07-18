import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'

const presets = {
  gmail: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  outlook: { imap: 'outlook.office365.com', smtp: 'smtp-mail.outlook.com' },
  yahoo: { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  icloud: { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
}

const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase()
const user = process.env.EMAIL_USER
const pass = process.env.EMAIL_PASS
const imapHost = process.env.EMAIL_IMAP_HOST || presets[provider]?.imap
const smtpHost = process.env.EMAIL_SMTP_HOST || presets[provider]?.smtp
const imapPort = Number(process.env.EMAIL_IMAP_PORT || 993)
const smtpPort = Number(process.env.EMAIL_SMTP_PORT || 465)

export const emailConfigurado = !!(user && pass && imapHost && smtpHost)
export const enderecoEmail = emailConfigurado ? user : null

export async function buscarNovosEmails(jaProcessados) {
  if (!emailConfigurado) return []
  const client = new ImapFlow({
    host: imapHost, port: imapPort, secure: true,
    auth: { user, pass }, logger: false,
  })
  const novos = []
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const uids = await client.search({ seen: false })
    for (const seq of uids || []) {
      const msg = await client.fetchOne(seq, { source: true })
      if (!msg?.source) continue
      const parsed = await simpleParser(msg.source)
      const id = parsed.messageId || `${seq}-${parsed.date?.getTime()}`
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
      await client.messageFlagsAdd(seq, ['\\Seen'])
    }
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
  await getTransporte().sendMail({
    from: user,
    to: para,
    subject: assunto.startsWith('Re:') ? assunto : `Re: ${assunto}`,
    text: corpo,
  })
  return true
}
