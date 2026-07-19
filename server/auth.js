// Senhas com scrypt (nativo do Node) e criptografia AES-256-GCM para as
// credenciais de e-mail guardadas no banco.
import crypto from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(crypto.scrypt)

/* ---------------- Senhas de usuário ---------------- */

export async function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex')
  const hash = await scrypt(String(senha), sal, 64)
  return `${sal}:${hash.toString('hex')}`
}

export async function senhaConfere(senha, guardado) {
  const [sal, hashHex] = String(guardado || '').split(':')
  if (!sal || !hashHex) return false
  const hash = await scrypt(String(senha), sal, 64)
  const a = Buffer.from(hashHex, 'hex')
  return a.length === hash.length && crypto.timingSafeEqual(a, hash)
}

/* ---------------- Criptografia das credenciais ---------------- */

const chaveDe = segredo => crypto.createHash('sha256').update(String(segredo)).digest()

export function cifrar(texto, segredo) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveDe(segredo), iv)
  const enc = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()])
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${enc.toString('hex')}`
}

export function decifrar(cifrado, segredo) {
  try {
    const [ivHex, tagHex, encHex] = String(cifrado || '').split('.')
    const decipher = crypto.createDecipheriv('aes-256-gcm', chaveDe(segredo), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/* ---------------- Cookies de sessão ---------------- */

export const NOME_COOKIE = 'atendo_sessao'

export function lerCookie(req) {
  const linha = req.headers.cookie || ''
  for (const par of linha.split(';')) {
    const [k, ...v] = par.trim().split('=')
    if (k === NOME_COOKIE) return decodeURIComponent(v.join('='))
  }
  return null
}

export function gravarCookie(req, res, token) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie',
    `${NOME_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${seguro ? '; Secure' : ''}`)
}

export function limparCookie(req, res) {
  res.setHeader('Set-Cookie', `${NOME_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

/* ---------------- Limite de tentativas de login ---------------- */

const tentativas = new Map()

export function podeTentarLogin(chave) {
  const agora = Date.now()
  const t = tentativas.get(chave) ?? { falhas: 0, desde: agora }
  if (agora - t.desde > 15 * 60_000) { tentativas.delete(chave); return true }
  return t.falhas < 10
}

export function registrarFalhaLogin(chave) {
  const agora = Date.now()
  const t = tentativas.get(chave) ?? { falhas: 0, desde: agora }
  if (agora - t.desde > 15 * 60_000) { t.falhas = 0; t.desde = agora }
  t.falhas++
  tentativas.set(chave, t)
}

export function limparFalhasLogin(chave) {
  tentativas.delete(chave)
}
