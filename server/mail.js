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

// Envio por API HTTP (porta 443), alternativa quando a hospedagem bloqueia SMTP
const resendKey = (process.env.RESEND_API_KEY || '').trim()
export const envioPorApi = !!resendKey

const diasJanela = Number(process.env.EMAIL_DIAS || 3)
const MAX_POR_SYNC = 20

// Marca as respostas que o próprio atendo envia, para nunca reprocessá-las
const HEADER_AUTO = 'x-atendo-auto'

export const presetsDisponiveis = Object.keys(presets)

/**
 * Configuração vinda das variáveis de ambiente (modo antigo, ainda suportado):
 * loja 1 usa EMAIL_USER/EMAIL_PASS/..., loja 2 usa EMAIL2_USER/EMAIL2_PASS/...
 */
export function lerConfigEnv(sufixo) {
  const env = k => (process.env[`EMAIL${sufixo}_${k}`] || '').trim()
  const provider = env('PROVIDER').toLowerCase()
  return {
    provider,
    user: env('USER'),
    // Senhas de app do Google vêm em blocos com espaços; o IMAP as rejeita assim
    pass: (process.env[`EMAIL${sufixo}_PASS`] || '').replace(/\s+/g, ''),
    imapHost: env('IMAP_HOST') || presets[provider]?.imap || '',
    smtpHost: env('SMTP_HOST') || presets[provider]?.smtp || '',
    imapPort: Number(env('IMAP_PORT') || 993),
    smtpPort: Number(env('SMTP_PORT') || 465),
    from: env('FROM'), // remetente na Resend (domínio verificado)
  }
}

/**
 * Normaliza uma configuração vinda do banco (formulário do site).
 */
export function montarConfig({ provider = '', user = '', pass = '', imapHost = '', smtpHost = '', imapPort, smtpPort, from = '', remetenteNome = '' }) {
  const p = String(provider).trim().toLowerCase()
  return {
    provider: p,
    user: String(user).trim(),
    pass: String(pass).replace(/\s+/g, ''),
    imapHost: String(imapHost).trim() || presets[p]?.imap || '',
    smtpHost: String(smtpHost).trim() || presets[p]?.smtp || '',
    imapPort: Number(imapPort || 993),
    smtpPort: Number(smtpPort || 465),
    from: String(from).trim(),
    remetenteNome: String(remetenteNome).trim(),
  }
}

export function criarConta(id, cfg, sufixo = '') {
  const configurado = !!(cfg.user && cfg.pass && cfg.imapHost && cfg.smtpHost)
  const status = { ok: null, erro: null, verificadoEm: null, envio: null }
  const desde = () => new Date(Date.now() - diasJanela * 24 * 3600_000)

  function traduzirErro(err) {
    const m = String(err?.responseText || err?.message || err)
    if (/AUTHENTICATION\s*FAILED|Invalid credentials|Username and Password not accepted|LOGIN\s*failed|AUTHENTICATE\s*failed|535|\bEAUTH\b/i.test(m)) {
      if (cfg.provider === 'gmail' || /gmail|google/i.test(cfg.imapHost)) {
        return `O Gmail recusou o login de ${cfg.user}. Use uma SENHA DE APP de 16 letras (não a senha normal da conta) e confirme que o IMAP está ligado.`
      }
      if (/hostinger|titan/i.test(cfg.provider) || /hostinger|titan/i.test(cfg.imapHost)) {
        return `O servidor recusou o login de ${cfg.user}. Use a senha da CAIXA DE E-MAIL (definida no hPanel), não a senha do painel da Hostinger.`
      }
      return `Usuário ou senha recusados pelo servidor de e-mail (${cfg.user}).`
    }
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return `Servidor não encontrado (${cfg.imapHost}). Verifique EMAIL${sufixo}_PROVIDER ou EMAIL${sufixo}_IMAP_HOST.`
    if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(m)) return `Sem conexão com ${cfg.imapHost}:${cfg.imapPort}.`
    if (/certificate|self.signed/i.test(m)) return 'Certificado TLS do servidor não pôde ser validado.'
    return m.slice(0, 300)
  }

  function traduzirErroEnvio(err) {
    const m = String(err?.message || err)
    const code = err?.code
    if (/AUTHENTICATION\s*FAILED|Invalid login|535|\bEAUTH\b/i.test(m) || code === 'EAUTH') {
      return `O servidor de envio recusou o login de ${cfg.user}. Confirme a senha da caixa de e-mail.`
    }
    if (code === 'ENOTFOUND' || code === 'EDNS') {
      return `Servidor de envio ${cfg.smtpHost} não encontrado. Confira o endereço do servidor SMTP.`
    }
    if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || /timeout/i.test(m)) {
      return `Não foi possível conectar em ${cfg.smtpHost} (portas 465 e 587 testadas). `
        + `Se as duas portas falham, a hospedagem está bloqueando a saída SMTP — nos planos pagos do Railway a saída SMTP é liberada.`
    }
    if (code === 'EENVELOPE' || /recipient|sender|relay/i.test(m)) {
      return `O servidor recusou o destinatário ou remetente: ${m.slice(0, 160)}`
    }
    return m.slice(0, 250)
  }

  const novoClienteImap = () => new ImapFlow({
    host: cfg.imapHost, port: cfg.imapPort, secure: true,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false,
  })

  // O envio principal é SMTP direto, como qualquer cliente de e-mail.
  // Se a porta configurada não responder, a alternativa (465 ↔ 587) é testada
  // sozinha, e a que funcionar fica memorizada para os próximos envios.
  const transportes = new Map() // porta → transporter
  let portaAtiva = cfg.smtpPort

  function getTransporte(porta = portaAtiva) {
    if (!transportes.has(porta)) {
      transportes.set(porta, nodemailer.createTransport({
        host: cfg.smtpHost, port: porta,
        secure: porta === 465, // 465 = TLS implícito; 587 = STARTTLS
        auth: { user: cfg.user, pass: cfg.pass },
        // Sem estes limites, uma porta bloqueada deixa o envio pendurado para sempre
        connectionTimeout: 20_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }))
    }
    return transportes.get(porta)
  }

  const portasParaTentar = () => [portaAtiva, ...[465, 587].filter(p => p !== portaAtiva)]
  const erroDeConexao = err => ['ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET'].includes(err?.code)

  async function comFallbackDePorta(operacao) {
    let ultimoErro
    for (const porta of portasParaTentar()) {
      try {
        const resultado = await operacao(getTransporte(porta), porta)
        portaAtiva = porta
        return resultado
      } catch (err) {
        ultimoErro = err
        // porta bloqueada → tenta a outra; erro de senha não muda com a porta
        if (!erroDeConexao(err)) break
      }
    }
    throw ultimoErro
  }

  async function verificarConexao() {
    if (!configurado) {
      Object.assign(status, { ok: null, erro: null, verificadoEm: null })
      return status
    }
    const client = novoClienteImap()
    try {
      await client.connect()
      await client.logout().catch(() => {})
      Object.assign(status, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
    } catch (err) {
      Object.assign(status, { ok: false, erro: traduzirErro(err), verificadoEm: new Date().toISOString() })
    }
    return status
  }

  async function verificarResend() {
    try {
      const resp = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
      if ([400, 401, 403].includes(resp.status)) {
        return { ok: false, erro: 'A Resend recusou a chave de API. Confira RESEND_API_KEY.' }
      }
      if (!resp.ok) return { ok: false, erro: `A Resend respondeu ${resp.status} ao validar a chave.` }
      return { ok: true, erro: null, via: 'resend' }
    } catch (err) {
      return { ok: false, erro: `Não foi possível alcançar a Resend: ${err.message}` }
    }
  }

  async function verificarEnvio() {
    // SMTP direto é o canal principal — como qualquer cliente de e-mail.
    if (configurado) {
      try {
        const porta = await comFallbackDePorta(async (tr, p) => { await tr.verify(); return p })
        return { ok: true, erro: null, via: 'smtp', porta }
      } catch (err) {
        // SMTP não deu: se houver Resend configurada, ela cobre como reserva
        if (envioPorApi && (cfg.from || cfg.user)) {
          const r = await verificarResend()
          if (r.ok) return { ok: true, erro: null, via: 'resend', aviso: `SMTP indisponível (${traduzirErroEnvio(err)}) — enviando pela Resend.` }
          return { ok: false, erro: `SMTP: ${traduzirErroEnvio(err)} · Resend: ${r.erro}` }
        }
        return { ok: false, erro: traduzirErroEnvio(err) }
      }
    }
    if (envioPorApi && cfg.from) return verificarResend()
    return { ok: null, erro: null }
  }

  async function diagnosticar(jaProcessados = []) {
    if (!configurado) return { ok: false, erro: 'E-mail não configurado para esta loja.' }
    const client = novoClienteImap()
    try {
      await client.connect()
    } catch (err) {
      const erro = traduzirErro(err)
      Object.assign(status, { ok: false, erro, verificadoEm: new Date().toISOString() })
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
        const idMsg = msg.envelope.messageId
        const auto = String(msg.headers ?? '').toLowerCase().includes(HEADER_AUTO)
        mensagens.push({
          de: de?.address ?? '(sem remetente)',
          assunto: msg.envelope.subject || '(sem assunto)',
          data: msg.envelope.date?.toISOString?.() ?? null,
          lido: !!msg.flags?.has?.('\\Seen'),
          virouTicket: idMsg ? jaProcessados.includes(idMsg) : false,
          respostaDoAtendo: auto,
        })
      }
      Object.assign(status, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
      return {
        ok: true,
        caixa: cfg.user,
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

  async function buscarNovos(jaProcessados) {
    if (!configurado) return []
    const client = novoClienteImap()
    const novos = []
    try {
      await client.connect()
    } catch (err) {
      Object.assign(status, { ok: false, erro: traduzirErro(err), verificadoEm: new Date().toISOString() })
      throw new Error(status.erro)
    }
    const lock = await client.getMailboxLock('INBOX')
    try {
      // Busca por data, não pelo flag de lido: um e-mail aberto no webmail
      // continua sendo um e-mail de cliente que precisa de resposta.
      const uids = await client.search({ since: desde() }, { uid: true })
      const recentes = (uids || []).slice(-MAX_POR_SYNC * 3).reverse()
      for (const uid of recentes) {
        if (novos.length >= MAX_POR_SYNC) break
        const msg = await client.fetchOne(uid, { source: true }, { uid: true })
        if (!msg?.source) continue
        const parsed = await simpleParser(msg.source)
        const idMsg = parsed.messageId || `uid-${uid}-${parsed.date?.getTime()}`
        if (jaProcessados.includes(idMsg)) continue
        if (parsed.headers?.get?.(HEADER_AUTO)) continue // resposta do próprio atendo
        const remetente = parsed.from?.value?.[0]
        if (!remetente?.address) continue
        novos.push({
          messageId: idMsg,
          nome: remetente.name || remetente.address.split('@')[0],
          de: remetente.address,
          assunto: parsed.subject || '(sem assunto)',
          corpo: (parsed.text || '').trim().slice(0, 8000),
          data: (parsed.date || new Date()).toISOString(),
        })
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {})
      }
      Object.assign(status, { ok: true, erro: null, verificadoEm: new Date().toISOString() })
    } finally {
      lock.release()
      await client.logout().catch(() => {})
    }
    return novos
  }

  const comNome = endereco => (cfg.remetenteNome ? `${cfg.remetenteNome} <${endereco}>` : endereco)

  async function enviarPorApiResend({ para, assunto, corpo }) {
    const remetente = comNome(cfg.from || cfg.user)
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: remetente,
        to: [para],
        subject: assunto,
        text: corpo,
        reply_to: cfg.user || remetente,
        headers: { 'X-Atendo-Auto': '1' },
      }),
    })
    if (!resp.ok) {
      const corpoErro = await resp.text().catch(() => '')
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('A Resend recusou a chave de API. Confira RESEND_API_KEY.')
      }
      if (resp.status === 422 || /domain|from/i.test(corpoErro)) {
        throw new Error(`A Resend recusou o remetente "${remetente}". O domínio precisa estar verificado na Resend — ou use EMAIL${sufixo}_FROM com um endereço verificado. Detalhe: ${corpoErro.slice(0, 160)}`)
      }
      throw new Error(`A Resend respondeu ${resp.status}: ${corpoErro.slice(0, 180)}`)
    }
    return true
  }

  async function enviar({ para, assunto, corpo }) {
    const podeApi = envioPorApi && (cfg.from || cfg.user)
    if (!configurado && !podeApi) return false
    const titulo = assunto.startsWith('Re:') ? assunto : `Re: ${assunto}`
    const mensagem = {
      from: comNome(cfg.user),
      to: para,
      subject: titulo,
      text: corpo,
      headers: { 'X-Atendo-Auto': '1' },
    }

    // 1º SMTP direto (testando 465/587 sozinho); Resend só como reserva
    if (configurado) {
      try {
        await comFallbackDePorta(tr => tr.sendMail(mensagem))
        return true
      } catch (err) {
        if (podeApi) {
          try {
            return await enviarPorApiResend({ para, assunto: titulo, corpo })
          } catch (err2) {
            throw new Error(`SMTP: ${traduzirErroEnvio(err)} · Resend: ${err2.message}`)
          }
        }
        throw new Error(traduzirErroEnvio(err))
      }
    }
    return enviarPorApiResend({ para, assunto: titulo, corpo })
  }

  return {
    id,
    configurado,
    endereco: configurado ? cfg.user : null,
    remetente: cfg.from || cfg.user || null,
    status,
    verificarConexao,
    verificarEnvio,
    diagnosticar,
    buscarNovos,
    enviar,
  }
}

/**
 * Testa uma configuração sem salvar nada — usado pelo botão "Testar conexão"
 * do formulário antes de o usuário confirmar.
 */
export async function testarConfig(cfgBruta) {
  const cfg = montarConfig(cfgBruta)
  const conta = criarConta('teste', cfg)
  if (!conta.configurado) return { ok: false, erro: 'Preencha endereço, senha e provedor (ou os servidores IMAP/SMTP).' }
  const leitura = await conta.verificarConexao()
  const envio = await conta.verificarEnvio()
  return { ok: !!leitura.ok && envio.ok !== false, leitura: { ok: leitura.ok, erro: leitura.erro }, envio }
}
