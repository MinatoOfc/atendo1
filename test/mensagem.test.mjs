// Só o texto NOVO do cliente conta. O assunto automático, o status da Shopify e
// a mensagem citada abaixo da resposta nunca podem, sozinhos, jogar a conversa
// numa jornada de entrega. Lógica pura — nenhuma rede, nenhum servidor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { separarTexto, separarAssinatura, validarSituacaoEntrega, produtosDoTextoAtual } from '../shared/mensagem.js'

/* O caso real que originou esta trava: o cliente respondeu ao aviso de entrega
   da Shopify reclamando da roupa, e o motor ofereceu "aguarde 2 dias". */
const KURT = `Bitte was ist das für ein Schrott ! Das kann doch kein Mensch anziehen !

Das ist ein Witz !

Fa. Karasek, Karasek Kurt, Litschauer Str. 38, A-3950 Gmünd, AUSTRIA
Tel.:06641335337

Gesendet: Freitag, 18. September 2026 um 14:29
Von: "Von Alder" <store+71907508326@t.shopifyemail.com>
An: kurt.karasek@gmx.at
Betreff: Eine Lieferung aus der Bestellung #2766 wurde zugestellt
Ihre Sendung wurde zugestellt. Sie haben das Paket erhalten.`

test('caso real: a notificação citada fica fora do texto do cliente', () => {
  const r = separarTexto(KURT)
  assert.match(r.atual, /Schrott/)
  assert.match(r.atual, /kein Mensch anziehen/)
  assert.doesNotMatch(r.atual, /zugestellt/, 'nada da notificação entra no texto novo')
  assert.doesNotMatch(r.atual, /shopifyemail/)
  assert.match(r.citado, /Gesendet:/)
  assert.match(r.citado, /wurde zugestellt/)
  assert.equal(r.completo, KURT, 'o texto completo é preservado para exibição e auditoria')

  // a situação de entrega proposta pela IA é DESCARTADA: a prova veio do citado
  const e = validarSituacaoEntrega({ situacao: 'entregue_nao_recebido', evidencia: 'wurde zugestellt', textoAtual: r.atual })
  assert.equal(e.situacao, null)
  assert.equal(e.descartada, true)
  assert.equal(e.evidenciaNoTextoAtual, false)
  assert.match(e.motivo, /não está na mensagem nova/)

  // e nenhum dos dois produtos conta como informado pelo cliente
  assert.deepEqual(produtosDoTextoAtual(['Polohemd mit langen Ärmeln (Grün / XL)', 'Polohemd mit langen Ärmeln (Hellblau / XL)'], r.atual), [])
})

test('assinatura e rodapé ficam fora da declaração — e o endereço deles não conta', () => {
  const r = separarTexto(KURT)
  // a declaração é só a reclamação; empresa, rua, telefone e site ficam separados
  assert.match(r.declaracao, /Schrott/)
  assert.match(r.declaracao, /Witz/)
  assert.doesNotMatch(r.declaracao, /Litschauer/, 'a rua da assinatura não é declaração')
  assert.doesNotMatch(r.declaracao, /Tel\.:/)
  assert.doesNotMatch(r.declaracao, /hanf-shop/)
  // a assinatura continua PRESERVADA (some da decisão, não da conversa)
  assert.match(r.assinatura, /Litschauer Str\. 38/)
  assert.match(r.assinatura, /06641335337/)
  assert.equal(r.completo, KURT)

  // nenhum produto e nenhuma entrega saem da assinatura
  assert.deepEqual(produtosDoTextoAtual(['Polohemd mit langen Ärmeln (Grün / XL)'], r.declaracao), [])

  // o cliente RESPONDENDO com o endereço não perde a mensagem
  const so = separarAssinatura('Hauptstrasse 12, 10115 Berlin, Deutschland')
  assert.equal(so.declaracao, 'Hauptstrasse 12, 10115 Berlin, Deutschland')
  assert.equal(so.assinatura, '')
  // endereço + telefone: o telefone sai, o endereço fica
  const misto = separarAssinatura('Hauptstrasse 12, 10115 Berlin\nTel.: 123456')
  assert.equal(misto.declaracao, 'Hauptstrasse 12, 10115 Berlin')
  assert.match(misto.assinatura, /Tel/)
  // mensagem sem assinatura nenhuma continua inteira
  assert.equal(separarAssinatura('Der Stoff ist schlecht.').declaracao, 'Der Stoff ist schlecht.')
  assert.equal(separarAssinatura('Der Stoff ist schlecht.').assinatura, '')
})

test('delimitadores de citação nos sete idiomas, e também em HTML', () => {
  const casos = [
    ['de', 'Das ist Schrott!\nGesendet: Freitag\nVon: Loja\nBetreff: entregue'],
    ['en', 'This is junk!\nSent: Friday\nFrom: Store\nSubject: delivered'],
    ['pt', 'Isso é lixo!\nEnviado: sexta\nDe: Loja\nAssunto: entregue'],
    ['nl', 'Dit is rommel!\nVerzonden: vrijdag\nVan: Winkel\nOnderwerp: bezorgd'],
    ['fr', "C'est nul !\nEnvoyé: vendredi\nDe: Boutique\nObjet: livré"],
    ['it', 'Che schifo!\nInviato: venerdì\nDa: Negozio\nOggetto: consegnato'],
    ['es', 'Es basura!\nEnviado: viernes\nDe: Tienda\nAsunto: entregado'],
  ]
  for (const [idioma, corpo] of casos) {
    const r = separarTexto(corpo)
    assert.equal(r.atual.split('\n').length, 1, idioma + ': só a primeira linha é do cliente')
    assert.ok(r.citado.length > 0, idioma + ': o resto virou citação')
    assert.doesNotMatch(r.atual, /entregue|delivered|bezorgd|livré|consegnato|entregado/i, idioma)
  }
  // "-----Original Message-----" e "Em ... escreveu:"
  assert.equal(separarTexto('Ruim demais.\n-----Original Message-----\nSua entrega foi entregue').atual, 'Ruim demais.')
  assert.equal(separarTexto('Ruim demais.\nEm 18/09/2026, Von Alder escreveu:\nSua entrega foi entregue').atual, 'Ruim demais.')
  assert.equal(separarTexto('Awful.\nOn Sep 18, 2026, Von Alder wrote:\nYour delivery was delivered').atual, 'Awful.')
  // linhas com ">"
  assert.equal(separarTexto('Que porcaria.\n> Sua entrega foi entregue').atual, 'Que porcaria.')
  // HTML: blockquote e gmail_quote
  assert.equal(separarTexto('<p>Que porcaria.</p><blockquote>Sua entrega foi entregue</blockquote>').atual, '<p>Que porcaria.</p>')
  assert.match(separarTexto('<p>Que porcaria.</p><div class="gmail_quote">entregue</div>').atual, /porcaria/)
  assert.doesNotMatch(separarTexto('<p>Que porcaria.</p><div class="gmail_quote">entregue</div>').atual, /entregue/)
  // mensagem sem citação nenhuma continua inteira
  const limpa = separarTexto('Wo ist meine Bestellung?')
  assert.equal(limpa.atual, 'Wo ist meine Bestellung?')
  assert.equal(limpa.citado, '')
})

test('a jornada de entrega só abre com pergunta logística ou não recebimento explícito', () => {
  // 1) pergunta explícita: abre
  for (const texto of ['Wo ist meine Bestellung?', 'Wann kommt mein Paket?', 'Wie viele Tage dauert die Lieferung?', 'Where is my order?', 'Onde está meu pedido?', 'Waar is mijn bestelling?']) {
    const e = validarSituacaoEntrega({ situacao: 'nao_chegou', evidencia: texto, textoAtual: texto })
    assert.equal(e.situacao, 'nao_chegou', texto)
    assert.equal(e.evidenciaNoTextoAtual, true)
  }
  // 2) não recebi: abre
  const naoRecebi = 'Ich habe das Paket noch nicht erhalten.'
  assert.equal(validarSituacaoEntrega({ situacao: 'nao_chegou', evidencia: naoRecebi, textoAtual: naoRecebi }).situacao, 'nao_chegou')
  // 3) consta entregue + não recebi: abre entregue_nao_recebido
  const dois = 'Die Sendung wird als zugestellt angezeigt, aber ich habe nichts erhalten.'
  assert.equal(validarSituacaoEntrega({ situacao: 'entregue_nao_recebido', evidencia: dois, textoAtual: dois }).situacao, 'entregue_nao_recebido')
  // só uma das metades NÃO basta
  const soEntregue = 'Die Sendung wird als zugestellt angezeigt.'
  const meia = validarSituacaoEntrega({ situacao: 'entregue_nao_recebido', evidencia: soEntregue, textoAtual: soEntregue })
  assert.equal(meia.situacao, null)
  assert.match(meia.motivo, /as duas coisas/)
})

test('reclamação de qualidade, tamanho, defeito ou produto errado nunca vira entrega', () => {
  const reclamacoes = [
    'Der Stoff ist sehr dünn und billig.',
    'Das Poloshirt ist zu klein.',
    'Das Hemd kam kaputt an.',
    'Ich habe den falschen Artikel erhalten.',
    'The fabric is terrible.',
    'O tecido é péssimo.',
  ]
  for (const texto of reclamacoes) {
    // mesmo que a IA proponha entrega, sem prova logística no texto ela cai
    const e = validarSituacaoEntrega({ situacao: 'entregue_nao_recebido', evidencia: texto, textoAtual: texto })
    assert.equal(e.situacao, null, texto)
    assert.equal(e.descartada, true)
  }
})

test('posse física + "não recebi" é conflito: vai para o dono, não para o chute', () => {
  const texto = 'Die Sendung wird als zugestellt angezeigt, aber ich habe nichts erhalten. Der Stoff ist außerdem sehr dünn.'
  const e = validarSituacaoEntrega({ situacao: 'entregue_nao_recebido', evidencia: 'als zugestellt angezeigt, aber ich habe nichts erhalten', textoAtual: texto })
  assert.equal(e.situacao, null)
  assert.equal(e.conflito, true, 'declarações conflitantes')
  assert.match(e.motivo, /conflitantes/)
})

test('prova inventada ou vinda do texto citado é descartada', () => {
  const atual = 'Das ist Schrott!'
  const inventada = validarSituacaoEntrega({ situacao: 'nao_chegou', evidencia: 'ich habe nichts erhalten', textoAtual: atual })
  assert.equal(inventada.situacao, null)
  assert.match(inventada.motivo, /não está na mensagem nova/)
  const semProva = validarSituacaoEntrega({ situacao: 'nao_chegou', evidencia: '', textoAtual: atual })
  assert.equal(semProva.situacao, null)
  assert.match(semProva.motivo, /não apontou trecho/)
  // "nenhuma" nunca é situação
  assert.equal(validarSituacaoEntrega({ situacao: 'nenhuma', evidencia: '', textoAtual: atual }).situacao, null)
})

test('texto citado com "não recebi" não contamina uma reclamação de qualidade', () => {
  const corpo = `Der Stoff ist wirklich schlecht.

Gesendet: Freitag
Von: Kunde
Betreff: Re: Bestellung
Ich habe das Paket noch nicht erhalten.`
  const r = separarTexto(corpo)
  assert.match(r.citado, /noch nicht erhalten/)
  assert.doesNotMatch(r.atual, /erhalten/)
  const e = validarSituacaoEntrega({ situacao: 'nao_chegou', evidencia: 'Ich habe das Paket noch nicht erhalten.', textoAtual: r.atual })
  assert.equal(e.situacao, null, 'o "não recebi" do texto citado não vale')
})

test('produto só conta quando o cliente o cita no texto novo', () => {
  const catalogo = ['Polohemd mit langen Ärmeln (Grün / XL)', 'Polohemd mit langen Ärmeln (Hellblau / XL)']
  // citado só na notificação: não conta
  const r = separarTexto('Das ist Schrott!\nGesendet: Freitag\nBetreff: Polohemd mit langen Ärmeln (Grün / XL)')
  assert.deepEqual(produtosDoTextoAtual(catalogo, r.atual), [])
  // o cliente diz a cor: conta só o dele
  assert.deepEqual(produtosDoTextoAtual(catalogo, 'Das grüne Polohemd ist schlecht.'), ['Polohemd mit langen Ärmeln (Grün / XL)'])
  // o cliente diz o tamanho e a cor do outro
  assert.deepEqual(produtosDoTextoAtual(catalogo, 'Das hellblaue Hemd in XL ist zu klein.'), ['Polohemd mit langen Ärmeln (Hellblau / XL)'])
  // texto vazio nunca informa produto
  assert.deepEqual(produtosDoTextoAtual(catalogo, ''), [])
})
