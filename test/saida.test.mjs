// Uma falha REAL com o servidor no ar tem de terminar o processo com código
// diferente de zero — sem process.exit e sem travar (o servidor e os intervalos
// são encerrados por encerrar()). Roda test/_falha-proposital.mjs num processo filho.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

/* ------------------------------------------------------------------ */
/* A conversa assumida tem UM caminho de volta só                       */
/* ------------------------------------------------------------------ */

// A tela da conversa (src/components/Tickets.tsx) não tem cobertura de
// navegador hoje, então esta é uma trava de regressão sobre a condição de
// render: se alguém tirar o `!t.atendimentoHumano?.ativo` do cartão antigo,
// voltam a existir dois caminhos de retomada — e o antigo religa a IA sem
// encerrar o atendimento humano, sem escolha e sem auditoria.
test('a conversa em atendimento humano não renderiza o cartão antigo "Retomar IA"', () => {
  const src = readFileSync(new URL('../src/components/Tickets.tsx', import.meta.url), 'utf8')

  const marca = '{/* Pausar / retomar a IA nesta conversa'
  const i = src.indexOf(marca)
  assert.ok(i > 0, 'o cartão antigo continua existindo no arquivo')
  const bloco = src.slice(i, i + 1400)
  assert.match(bloco, /Retomar IA/, 'é mesmo o cartão antigo')
  assert.match(bloco, /!t\.atendimentoHumano\?\.ativo/, 'e ele só aparece quando a conversa NÃO foi assumida')

  // o banner do atendimento humano oferece as duas retomadas seguras
  const j = src.indexOf('{t.atendimentoHumano?.ativo && (')
  assert.ok(j > 0, 'o banner do atendimento humano existe')
  const banner = src.slice(j, j + 2200)
  assert.match(banner, /Retomar e reler a mensagem/)
  assert.match(banner, /Retomar e aguardar o cliente/)
  assert.match(banner, /retomarIA\(t\.id, 'reclassificar'\)/)
  assert.match(banner, /retomarIA\(t\.id, 'aguardar'\)/)
  assert.doesNotMatch(banner, /pausarIA/, 'o banner nunca chama o atalho antigo')

  // e o texto do cartão antigo explica que pausar não é assumir
  assert.match(bloco, /só interrompe a leitura automática/)
  assert.match(bloco, /Mover para atendimento humano/)
})
