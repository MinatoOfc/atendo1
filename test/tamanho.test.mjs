// Pequeno/grande e coerência de tamanho — provas PURAS, sem servidor.
//
// Caso real, pedido #2749 (loja alemã). O cliente escreveu:
//   "Bitte senden Sie mir einen Retourenschein, da das Hemd in hellblau nicht passt."
// A IA respondeu "Da das Hemd Ihnen zu groß ist … Größe 2XL" sobre um 3XL
// comprado, e o checklist ficou verde. Nada aqui pode deixar isso passar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { direcaoAfirmada, tamanhoAmbiguo, validarTamanho } from '../shared/mensagem.js'
import {
  normalizarTamanho, tamanhoDaVariante, compararTamanhos, tamanhosCitados,
  contradicaoDeTamanho, conferirOfertaDeTamanho,
} from '../shared/tamanho.js'
import { conferirTamanhoDoTexto } from '../server/atendimento.js'

const TEXTO_2749 = 'Bitte senden Sie mir einen Retourenschein, da das Hemd in hellblau nicht passt.'

/* ============ 1. direção só com evidência literal ============ */

test('#2749: "nicht passt" não vira pequeno nem grande, e o ajuste inventado é descartado', () => {
  assert.equal(direcaoAfirmada(TEXTO_2749, 'pequeno'), false)
  assert.equal(direcaoAfirmada(TEXTO_2749, 'grande'), false)
  assert.equal(tamanhoAmbiguo(TEXTO_2749), true, '"nicht passt" é ambíguo')

  const r = validarTamanho({
    ajustes: [{ produto: 'Hemd Classic (Hellblau / 3XL)', ajuste: 'grande' }],
    evidencia: 'da das Hemd in hellblau nicht passt',
    textoAtual: TEXTO_2749,
  })
  assert.equal(r.ajustes.length, 0, 'nenhum ajuste sobrevive')
  assert.equal(r.descartados.length, 1)
  assert.equal(r.ambigua, true)
  assert.match(r.motivo, /não disse se ficou pequeno ou grande/)
})

test('pequeno e grande nos sete idiomas, pela frase do cliente', () => {
  const PEQ = [
    ['de', 'Das Hemd ist zu klein.'], ['de', 'Es ist mir zu eng.'],
    ['nl', 'Het shirt is te klein.'], ['fr', 'La chemise est trop petite.'],
    ['it', 'La camicia è troppo piccola.'], ['es', 'Me queda demasiado pequeña.'],
    ['en', 'The shirt is too small.'], ['pt', 'A camisa ficou pequena.'],
    ['pt', 'Ficou apertada demais.'],
  ]
  const GRA = [
    ['de', 'Das Hemd ist zu groß.'], ['de', 'Es ist zu weit.'],
    ['nl', 'Het shirt is te groot.'], ['fr', 'La chemise est trop grande.'],
    ['it', 'La camicia è troppo grande.'], ['es', 'Me queda demasiado grande.'],
    ['en', 'The shirt is too big.'], ['pt', 'A camisa ficou grande.'],
    ['pt', 'Ficou larga demais.'],
  ]
  for (const [l, t] of PEQ) {
    assert.equal(direcaoAfirmada(t, 'pequeno'), true, `[${l}] pequeno: ${t}`)
    assert.equal(direcaoAfirmada(t, 'grande'), false, `[${l}] não é grande: ${t}`)
  }
  for (const [l, t] of GRA) {
    assert.equal(direcaoAfirmada(t, 'grande'), true, `[${l}] grande: ${t}`)
    assert.equal(direcaoAfirmada(t, 'pequeno'), false, `[${l}] não é pequeno: ${t}`)
  }
})

test('"não serve" e equivalentes continuam ambíguos nos sete idiomas', () => {
  const AMB = [
    ['de', 'Das Hemd passt mir nicht.'], ['nl', 'Het shirt past niet.'],
    ['en', "The shirt doesn't fit."], ['fr', 'La chemise ne me va pas.'],
    ['it', 'La camicia non mi va bene.'], ['es', 'La camisa no me queda bien.'],
    ['pt', 'A camisa não serve.'], ['pt', 'Não ficou bom.'],
  ]
  for (const [l, t] of AMB) {
    assert.equal(tamanhoAmbiguo(t), true, `[${l}] ambíguo: ${t}`)
    assert.equal(direcaoAfirmada(t, 'pequeno'), false, `[${l}] não é pequeno: ${t}`)
    assert.equal(direcaoAfirmada(t, 'grande'), false, `[${l}] não é grande: ${t}`)
  }
})

test('negação vence a afirmação: "não ficou pequeno" não vira pequeno', () => {
  const NEG = [
    ['pt', 'Não ficou pequena.', 'pequeno'], ['pt', 'Não ficou grande.', 'grande'],
    ['de', 'Es ist nicht zu klein.', 'pequeno'], ['de', 'Es ist nicht zu groß.', 'grande'],
    ['it', 'Non è troppo piccola.', 'pequeno'], ['es', 'No es demasiado grande.', 'grande'],
    ['en', 'It is not too small.', 'pequeno'], ['nl', 'Het is niet te groot.', 'grande'],
  ]
  for (const [l, t, d] of NEG) assert.equal(direcaoAfirmada(t, d), false, `[${l}] ${d}: ${t}`)
  // a negação não atravessa a vírgula: aqui a segunda oração afirma mesmo
  assert.equal(direcaoAfirmada('Não quero trocar, está muito grande.', 'grande'), true)
})

test('comparativo é PEDIDO de outro tamanho, e diz a direção pelo avesso', () => {
  const PEDE_MAIOR = [
    ['de', 'Ich brauche eine Nummer größer.'], ['en', 'I need one size bigger.'],
    ['pt', 'Queria um tamanho maior.'], ['nl', 'Ik wil graag een maat groter.'],
    ['fr', 'Je voudrais une taille plus grande.'], ['es', 'Necesito una talla más grande.'],
  ]
  const PEDE_MENOR = [
    ['de', 'Bitte schicken Sie mir eine Nummer kleiner.'], ['en', 'Could I get a smaller size?'],
    ['pt', 'Preciso de um tamanho menor.'], ['it', 'Vorrei una taglia più piccola.'],
  ]
  // pedir um MAIOR é dizer que o atual ficou pequeno
  for (const [l, t] of PEDE_MAIOR) assert.equal(direcaoAfirmada(t, 'pequeno'), true, `[${l}] ${t}`)
  for (const [l, t] of PEDE_MENOR) assert.equal(direcaoAfirmada(t, 'grande'), true, `[${l}] ${t}`)
  // a palavra sozinha NÃO basta: comparação complexa continua ambígua
  const VAGO = [
    ['pt', 'O meu irmão usa um tamanho maior que o meu.', 'pequeno'],
    ['de', 'Das Hemd ist größer als das andere.', 'pequeno'],
    ['en', 'The blue one is bigger than the black one.', 'pequeno'],
  ]
  for (const [l, t, d] of VAGO) assert.equal(direcaoAfirmada(t, d), false, `[${l}] vago: ${t}`)
})

test('a prova tem de estar na mensagem NOVA — citação e assinatura não valem', () => {
  const r = validarTamanho({
    ajustes: [{ produto: 'Polo', ajuste: 'pequeno' }],
    evidencia: 'zu klein', textoAtual: 'Gibt es Neuigkeiten?',
  })
  assert.equal(r.ajustes.length, 0)
  assert.match(r.motivo, /não está na mensagem nova/)
})

test('tamanho desejado só vale se o cliente escreveu o rótulo', () => {
  assert.equal(validarTamanho({ ajustes: [], evidencia: '', textoAtual: 'Ich hätte gerne 4XL.', desejado: '4XL' }).desejado, '4XL')
  assert.equal(validarTamanho({ ajustes: [], evidencia: '', textoAtual: 'Bitte tauschen Sie um.', desejado: '4XL' }).desejado, null)
})

/* ============ 2. ordem, equivalências e catálogo ============ */

test('equivalências e o que NÃO se ordena sem tabela da loja', () => {
  assert.equal(normalizarTamanho('XXL'), '2xl')
  assert.equal(normalizarTamanho('XXXL'), '3xl')
  assert.equal(normalizarTamanho('XXXXL'), '4xl')
  assert.equal(normalizarTamanho('3XL'), '3xl')
  assert.equal(compararTamanhos('XXXL', 'XXL'), 1, '3XL é maior que 2XL')
  assert.equal(compararTamanhos('3XL', '4XL'), -1)
  // numérico e desconhecido: null, e null é proibição
  assert.equal(normalizarTamanho('38'), null)
  assert.equal(normalizarTamanho('W32/L34'), null)
  assert.equal(compararTamanhos('38', '40'), null)
  assert.equal(tamanhoDaVariante('Hellblau / 3XL'), '3xl')
  assert.equal(tamanhoDaVariante('Schwarz / L'), 'l')
  assert.equal(tamanhoDaVariante('Beige / 32'), null)
})

test('tamanhos citados: só com X ou depois da palavra "tamanho"', () => {
  assert.deepEqual(tamanhosCitados('Wir senden Ihnen Größe 2XL.'), ['2xl'])
  assert.deepEqual(tamanhosCitados('We will send size M.'), ['m'])
  assert.deepEqual(tamanhosCitados('Ist es zu klein oder zu groß?'), [], 'a pergunta não cita tamanho')
})

test('coerência: pequeno nunca recebe menor, grande nunca recebe maior', () => {
  const cat = ['2xl', '3xl', '4xl']
  const p = o => conferirOfertaDeTamanho({ original: '3XL', catalogo: cat, ...o })
  assert.equal(p({ direcao: 'pequeno', oferecidos: ['2xl'] }).codigo, 'ordem')
  assert.equal(p({ direcao: 'grande', oferecidos: ['4xl'] }).codigo, 'ordem')
  assert.equal(p({ direcao: 'pequeno', oferecidos: ['4xl'] }).ok, true)
  assert.equal(p({ direcao: 'grande', oferecidos: ['2xl'] }).ok, true)
  // direção desconhecida: nenhum tamanho sai
  assert.equal(p({ direcao: null, oferecidos: ['2xl'] }).codigo, 'sem_direcao')
  // variante inventada ou fora do catálogo
  assert.equal(p({ direcao: 'pequeno', oferecidos: ['5xl'] }).codigo, 'catalogo')
  assert.equal(conferirOfertaDeTamanho({ original: '3XL', direcao: 'pequeno', oferecidos: ['4xl'], catalogo: null }).codigo, 'catalogo')
  // sem tamanho no texto não há nada a conferir
  assert.equal(p({ direcao: null, oferecidos: [] }).ok, true)
})

test('contradição entre a direção e o tamanho pedido pelo cliente', () => {
  const c = o => contradicaoDeTamanho({ original: '3XL', ...o })
  assert.equal(c({ direcao: null, desejado: '2XL' }), null, '"não serve, quero 2XL" é permitido')
  assert.equal(c({ direcao: 'grande', desejado: '2XL' }), null, '"ficou grande, quero 2XL" é permitido')
  assert.match(c({ direcao: 'pequeno', desejado: '2XL' }), /ficou pequeno e pede 2XL/)
  assert.match(c({ direcao: 'grande', desejado: '4XL' }), /ficou grande e pede 4XL/)
  assert.match(c({ direcao: 'pequeno', desejado: '3XL' }), /MESMO tamanho/)
  // e o resultado tem nome próprio
  const r = conferirOfertaDeTamanho({ original: '3XL', direcao: 'pequeno', desejado: '2XL', oferecidos: ['2xl'], catalogo: ['2xl'] })
  assert.equal(r.codigo, 'contradicao_tamanho')
  assert.equal(r.ok, false)
})

/* ============ 3. no caminho do servidor ============ */

const PRODUTOS = [{ lojaId: 'loja1', titulo: 'Hemd Classic', variantes: ['Hellblau / 2XL', 'Hellblau / 3XL', 'Hellblau / 4XL'] }]
const PEDIDO = { lojaId: 'loja1', itens: [{ titulo: 'Hemd Classic', variante: 'Hellblau / 3XL' }] }
const AN = extra => ({ produtosAfetados: ['Hemd Classic (Hellblau / 3XL)'], ...extra })
const conferir = (txt, extra = {}) => conferirTamanhoDoTexto(txt, AN(extra), PEDIDO, PRODUTOS)

test('o texto que a IA escreveu no #2749 é recusado pelo validador', () => {
  const r = conferir('Da das Hemd Ihnen zu groß ist, senden wir Ihnen Größe 2XL.')
  assert.equal(r.ok, false)
  assert.equal(r.codigo, 'sem_direcao')
  assert.match(r.motivo, /2XL/)
})

test('no caminho do servidor: direção, catálogo, contradição e pergunta sem tamanho', () => {
  const peq = { ajusteTamanho: { 'Hemd Classic (Hellblau / 3XL)': 'pequeno' } }
  const gra = { ajusteTamanho: { 'Hemd Classic (Hellblau / 3XL)': 'grande' } }
  assert.equal(conferir('Wir senden Ihnen Größe 4XL.', peq).ok, true)
  assert.equal(conferir('Wir senden Ihnen Größe 2XL.', peq).codigo, 'ordem')
  assert.equal(conferir('Wir senden Ihnen Größe 4XL.', gra).codigo, 'ordem')
  assert.equal(conferir('Wir senden Ihnen Größe 5XL.', peq).codigo, 'catalogo')
  assert.equal(conferir('Wir senden Ihnen Größe 4XL.', { tamanhoDesejado: '4XL' }).ok, true)
  assert.equal(conferir('Wir senden Ihnen Größe 2XL.', { ...peq, tamanhoDesejado: '2XL' }).codigo, 'contradicao_tamanho')
  // a pergunta da coleta não cita tamanho: passa
  assert.equal(conferir('Ist das Hemd zu klein oder zu groß?').ok, true)
})

test('peças compradas em tamanhos diferentes não recebem um tamanho só', () => {
  const pedido = { lojaId: 'loja1', itens: [
    { titulo: 'Hemd Classic', variante: 'Hellblau / 3XL' },
    { titulo: 'Hemd Classic', variante: 'Hellblau / 2XL' },
  ] }
  const an = {
    produtosAfetados: ['Hemd Classic (Hellblau / 3XL)', 'Hemd Classic (Hellblau / 2XL)'],
    ajusteTamanho: { 'Hemd Classic (Hellblau / 3XL)': 'pequeno', 'Hemd Classic (Hellblau / 2XL)': 'pequeno' },
  }
  const r = conferirTamanhoDoTexto('Wir senden Ihnen Größe 4XL.', an, pedido, PRODUTOS)
  assert.equal(r.ok, false)
  assert.equal(r.codigo, 'varios_tamanhos')
  assert.match(r.motivo, /tamanhos diferentes/)
  // com o cliente dizendo qual quer, cada peça é conferida pelo tamanho dela
  const comDesejo = conferirTamanhoDoTexto('Wir senden Ihnen Größe 4XL.', { ...an, tamanhoDesejado: '4XL' }, pedido, PRODUTOS)
  assert.equal(comDesejo.ok, true)
})
