// Camada de dados: PostgreSQL quando DATABASE_URL existe (Railway),
// arquivos em DATA_DIR quando não (desenvolvimento local).
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import pg from 'pg'
import { normalizarEstado, estadoInicial } from './store.js'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const url = (process.env.DATABASE_URL || '').trim()
export const usandoPostgres = !!url

let pool = null

/* ---------------- Modo arquivo (desenvolvimento) ---------------- */

const arqAuth = path.join(DATA_DIR, 'auth.json')
const arqWs = id => path.join(DATA_DIR, `ws-${id}.json`)

function lerJson(caminho, padrao) {
  try { return JSON.parse(fs.readFileSync(caminho, 'utf8').replace(/^﻿/, '')) } catch { return padrao }
}
function gravarJson(caminho, valor) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(caminho, JSON.stringify(valor, null, 2))
}

/* ---------------- Inicialização ---------------- */

export async function iniciarDb() {
  if (!usandoPostgres) return
  // Railway interno não exige TLS; URLs externas costumam exigir
  const precisaSsl = /sslmode=require/.test(url) || /\.proxy\.rlwy\.net|\.railway\.app/.test(url)
  pool = new pg.Pool({ connectionString: url, ssl: precisaSsl ? { rejectUnauthorized: false } : undefined, max: 5 })
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      nome TEXT,
      senha_hash TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      expira_em TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      nome TEXT,
      estado JSONB NOT NULL DEFAULT '{}',
      atualizado_em TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `)
}

/* ---------------- Segredo do app (cookies + criptografia) ---------------- */

export async function obterSegredo() {
  const env = (process.env.ATENDO_SECRET || '').trim()
  if (env) return env
  if (usandoPostgres) {
    const r = await pool.query(`SELECT valor FROM app_config WHERE chave='segredo'`)
    if (r.rows[0]) return r.rows[0].valor
    const novo = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO app_config (chave, valor) VALUES ('segredo', $1) ON CONFLICT (chave) DO NOTHING`, [novo])
    const r2 = await pool.query(`SELECT valor FROM app_config WHERE chave='segredo'`)
    return r2.rows[0].valor
  }
  const auth = lerJson(arqAuth, {})
  if (auth.segredo) return auth.segredo
  auth.segredo = crypto.randomBytes(32).toString('hex')
  auth.usuarios = auth.usuarios ?? []
  auth.sessoes = auth.sessoes ?? []
  gravarJson(arqAuth, auth)
  return auth.segredo
}

/* ---------------- Usuários ---------------- */

export async function contarUsuarios() {
  if (usandoPostgres) {
    const r = await pool.query('SELECT count(*)::int AS n FROM usuarios')
    return r.rows[0].n
  }
  return (lerJson(arqAuth, {}).usuarios ?? []).length
}

export async function criarUsuario({ id, email, nome, senhaHash, workspaceId }) {
  if (usandoPostgres) {
    await pool.query(
      'INSERT INTO usuarios (id, email, nome, senha_hash, workspace_id) VALUES ($1,$2,$3,$4,$5)',
      [id, email, nome, senhaHash, workspaceId])
    return
  }
  const auth = lerJson(arqAuth, { usuarios: [], sessoes: [] })
  auth.usuarios = auth.usuarios ?? []
  if (auth.usuarios.some(u => u.email === email)) throw Object.assign(new Error('duplicado'), { code: '23505' })
  auth.usuarios.push({ id, email, nome, senhaHash, workspaceId, criadoEm: new Date().toISOString() })
  gravarJson(arqAuth, auth)
}

export async function usuarioPorEmail(email) {
  if (usandoPostgres) {
    const r = await pool.query('SELECT * FROM usuarios WHERE email=$1', [email])
    const u = r.rows[0]
    return u ? { id: u.id, email: u.email, nome: u.nome, senhaHash: u.senha_hash, workspaceId: u.workspace_id } : null
  }
  return (lerJson(arqAuth, {}).usuarios ?? []).find(u => u.email === email) ?? null
}

export async function usuarioPorId(id) {
  if (usandoPostgres) {
    const r = await pool.query('SELECT * FROM usuarios WHERE id=$1', [id])
    const u = r.rows[0]
    return u ? { id: u.id, email: u.email, nome: u.nome, senhaHash: u.senha_hash, workspaceId: u.workspace_id } : null
  }
  return (lerJson(arqAuth, {}).usuarios ?? []).find(u => u.id === id) ?? null
}

export async function atualizarUsuario(id, { nome, senhaHash }) {
  if (usandoPostgres) {
    if (nome !== undefined) await pool.query('UPDATE usuarios SET nome=$2 WHERE id=$1', [id, nome])
    if (senhaHash !== undefined) await pool.query('UPDATE usuarios SET senha_hash=$2 WHERE id=$1', [id, senhaHash])
    return
  }
  const auth = lerJson(arqAuth, { usuarios: [], sessoes: [] })
  const u = (auth.usuarios ?? []).find(x => x.id === id)
  if (u) {
    if (nome !== undefined) u.nome = nome
    if (senhaHash !== undefined) u.senhaHash = senhaHash
    gravarJson(arqAuth, auth)
  }
}

/* ---------------- Sessões ---------------- */

const DIAS_SESSAO = 30

export async function criarSessao(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expira = new Date(Date.now() + DIAS_SESSAO * 24 * 3600_000)
  if (usandoPostgres) {
    await pool.query('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES ($1,$2,$3)', [token, usuarioId, expira])
    // higiene: remove sessões vencidas
    pool.query('DELETE FROM sessoes WHERE expira_em < now()').catch(() => {})
  } else {
    const auth = lerJson(arqAuth, { usuarios: [], sessoes: [] })
    auth.sessoes = (auth.sessoes ?? []).filter(s => new Date(s.expiraEm) > new Date())
    auth.sessoes.push({ token, usuarioId, expiraEm: expira.toISOString() })
    gravarJson(arqAuth, auth)
  }
  return token
}

export async function sessaoPorToken(token) {
  if (!token) return null
  if (usandoPostgres) {
    const r = await pool.query('SELECT * FROM sessoes WHERE token=$1 AND expira_em > now()', [token])
    return r.rows[0] ? { usuarioId: r.rows[0].usuario_id } : null
  }
  const s = (lerJson(arqAuth, {}).sessoes ?? []).find(x => x.token === token)
  return s && new Date(s.expiraEm) > new Date() ? { usuarioId: s.usuarioId } : null
}

export async function apagarSessao(token) {
  if (usandoPostgres) {
    await pool.query('DELETE FROM sessoes WHERE token=$1', [token])
    return
  }
  const auth = lerJson(arqAuth, { usuarios: [], sessoes: [] })
  auth.sessoes = (auth.sessoes ?? []).filter(s => s.token !== token)
  gravarJson(arqAuth, auth)
}

/* ---------------- Workspaces ---------------- */

export async function listarWorkspaces() {
  if (usandoPostgres) {
    const r = await pool.query('SELECT id FROM workspaces')
    return r.rows.map(x => x.id)
  }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('ws-') && f.endsWith('.json'))
    .map(f => f.slice(3, -5))
}

export async function carregarWorkspace(id) {
  if (usandoPostgres) {
    const r = await pool.query('SELECT estado FROM workspaces WHERE id=$1', [id])
    return r.rows[0] ? normalizarEstado(r.rows[0].estado) : null
  }
  const raw = lerJson(arqWs(id), null)
  return raw ? normalizarEstado(raw) : null
}

export async function salvarWorkspace(id, estado) {
  if (usandoPostgres) {
    await pool.query(
      `INSERT INTO workspaces (id, estado, atualizado_em) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET estado=$2, atualizado_em=now()`,
      [id, JSON.stringify(estado)])
    return
  }
  gravarJson(arqWs(id), estado)
}

export function novoEstado() {
  return structuredClone(estadoInicial)
}
