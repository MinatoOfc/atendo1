// Auxiliar de saida.test.mjs (não entra no npm test diretamente): sobe o servidor
// de verdade, como o pipeline, e falha de propósito. Serve para provar que a falha
// termina o processo com código != 0 e que encerrar() solta servidor e intervalos.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIR = mkdtempSync(path.join(tmpdir(), 'atendo-falha-'))
process.env.DATA_DIR = DIR
process.env.PORT = '8798'
process.env.ATENDO_SIMULAR = '1'
delete process.env.DATABASE_URL
const { novoEstado } = await import('../server/db.js')
writeFileSync(path.join(DIR, 'ws-teste.json'), JSON.stringify(novoEstado()))
const servidor = await import('../server/index.js')
await new Promise(r => setTimeout(r, 1500))

test('falha proposital com o servidor no ar', () => {
  assert.equal(1, 2, 'falha proposital')
})

after(async () => {
  await servidor.encerrar()
  try { rmSync(DIR, { recursive: true, force: true }) } catch {}
})

