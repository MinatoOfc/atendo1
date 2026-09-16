// Uma falha REAL com o servidor no ar tem de terminar o processo com código
// diferente de zero — sem process.exit e sem travar (o servidor e os intervalos
// são encerrados por encerrar()). Roda test/_falha-proposital.mjs num processo filho.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))

test('falha real com o servidor no ar: código de saída diferente de zero, processo termina sozinho', () => {
  const ambiente = { ...process.env }; delete ambiente.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--test', path.join(aqui, '_falha-proposital.mjs')], { encoding: 'utf8', timeout: 90_000, env: ambiente })
  assert.equal(r.error, undefined, 'o processo travou (timeout): ' + (r.error?.message ?? ''))
  assert.notEqual(r.status, 0, 'a falha tem de sair com código != 0')
  assert.match(r.stdout + r.stderr, /falha proposital/)
  assert.doesNotMatch(r.stdout + r.stderr, /process\.exit/)
})
