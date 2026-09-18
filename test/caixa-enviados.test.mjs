// Horário de uma mensagem lida da caixa de enviados. É ele que data o e-mail na
// auditoria depois de uma queda, então a fonte importa: internalDate é o que o
// PROVEDOR registrou ao guardar a mensagem; envelope.date é só o cabeçalho Date,
// escrito por quem enviou. Lógica pura — nenhuma conexão IMAP é aberta aqui.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataDaCaixa } from '../server/mail.js'

const INTERNA = '2026-09-18T10:00:00.000Z'
const CABECALHO = '2026-09-17T08:30:00.000Z'

test('internalDate vence envelope.date quando os dois existem', () => {
  const msg = { internalDate: new Date(INTERNA), envelope: { date: new Date(CABECALHO) } }
  assert.equal(dataDaCaixa(msg), INTERNA)
  // string em vez de Date (alguns provedores devolvem assim) dá no mesmo
  assert.equal(dataDaCaixa({ internalDate: INTERNA, envelope: { date: CABECALHO } }), INTERNA)
})

test('sem internalDate, o cabeçalho Date serve de reserva', () => {
  assert.equal(dataDaCaixa({ envelope: { date: new Date(CABECALHO) } }), CABECALHO)
  assert.equal(dataDaCaixa({ internalDate: null, envelope: { date: CABECALHO } }), CABECALHO)
})

test('sem nenhuma das duas datas, não se inventa horário', () => {
  assert.equal(dataDaCaixa({}), null)
  assert.equal(dataDaCaixa({ envelope: {} }), null)
  assert.equal(dataDaCaixa(null), null)
  assert.equal(dataDaCaixa(undefined), null)
  // data ilegível também não vira horário de envio
  assert.equal(dataDaCaixa({ internalDate: 'ontem de manhã' }), null)
})
