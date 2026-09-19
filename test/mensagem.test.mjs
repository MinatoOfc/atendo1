// Só o texto NOVO do cliente conta. O assunto automático, o status da Shopify e
// a mensagem citada abaixo da resposta nunca podem, sozinhos, jogar a conversa
// numa jornada de entrega. Lógica pura — nenhuma rede, nenhum servidor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { separarTexto, separarAssinatura, validarSituacaoEntrega, validarIntencao, produtosDoTextoAtual } from '../shared/mensagem.js'

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

test('aceite parcial de oferta COMBINADA vai para o dono, nunca para o automático', () => {
  // as combinações que existem no mapa de verdade
  const TROCA_CUPOM = { tipo: 'troca', pct: null, cupom: 15 }        // qual_troca, err_envio, nr_reenvio_30…
  const REENVIO_CUPOM = { tipo: 'reenvio', pct: null, cupom: 30 }
  const TROCA_REEMB = { tipo: 'troca_reembolso', pct: 20, cupom: null } // troca_20
  const REENVIO_REEMB = { tipo: 'reenvio_reembolso', pct: 20, cupom: null } // nr_reenvio_20
  const SO_CUPOM = { tipo: 'cupom', pct: null, cupom: 35 }           // qual_cupom_35, nc_cupom_40
  const ler = (t, oferta) => validarIntencao({ intencao: 'aceita', evidencia: t, textoAtual: t, oferta })
  const aceita = (t, oferta, nota) => {
    const r = ler(t, oferta)
    assert.equal(r.intencao, 'aceita', `${nota}: "${t}" tinha de aceitar — ${r.motivo ?? ''}`)
    assert.equal(r.ambigua, false)
  }
  const ambiguo = (t, oferta, nota) => {
    const r = ler(t, oferta)
    assert.equal(r.intencao, 'outro', `${nota}: "${t}" não pode virar aceite`)
    assert.equal(r.ambigua, true, `${nota}: "${t}" tinha de ser marcado ambíguo — ${r.motivo}`)
    assert.equal(r.descartada, 'aceita')
    assert.ok(r.motivo && r.motivo.length > 20, 'o motivo exato acompanha o descarte')
  }

  // 1) "sim" genérico, sem ressalva: aceita a proposta COMPLETA
  aceita('Ok.', TROCA_CUPOM, 'genérico')
  aceita('Ok.', TROCA_REEMB, 'genérico')
  aceita('Ja, gerne.', REENVIO_CUPOM, 'genérico')

  // 2) troca/reenvio + cupom: aceitar a ENTREGA leva o pacote junto
  aceita('Ja, den Umtausch nehme ich.', TROCA_CUPOM, 'troca nomeada')
  aceita('Ja, ich nehme die Ersatzlieferung.', REENVIO_CUPOM, 'reenvio nomeado')
  //    aceitar SÓ o cupom nunca aciona troca nem reenvio
  ambiguo('Sim, aceito somente o cupom.', TROCA_CUPOM, 'só o cupom')
  ambiguo('Ja, nur den Gutschein.', REENVIO_CUPOM, 'só o cupom (de)')
  //    e qualquer limitação explícita é respeitada, mesmo sobre a entrega
  ambiguo('Ja, nur den Umtausch.', TROCA_CUPOM, 'limitador sobre a troca')

  // 3) troca/reenvio + reembolso parcial: uma ação só é ambíguo
  ambiguo('Sim, aceito a troca.', TROCA_REEMB, 'só a troca')
  ambiguo('Sim, aceito o reembolso.', TROCA_REEMB, 'só o reembolso')
  ambiguo('Ja, die Ersatzlieferung nehme ich.', REENVIO_REEMB, 'só o reenvio')
  //    confirmar os DOIS componentes aceita
  aceita('Sim, aceito a troca e o reembolso de 20%.', TROCA_REEMB, 'dois componentes')
  aceita('Ja, ich nehme die Ersatzlieferung und die 20% Rückerstattung.', REENVIO_REEMB, 'dois componentes (de)')

  // 4) oferta só de cupom: aceita normalmente
  aceita('Ok.', SO_CUPOM, 'só cupom')
  aceita('Sim, aceito o cupom.', SO_CUPOM, 'só cupom nomeado')

  // 5) limitadores reconhecidos nos idiomas atendidos
  for (const [idioma, frase] of Object.entries({
    português: 'Sim, aceito apenas o cupom.',
    alemão: 'Ja, nur den Gutschein.',
    holandês: 'Ja, alleen de kortingsbon.',
    francês: 'Oui, seulement le coupon.',
    italiano: 'Sì, soltanto il coupon.',
    espanhol: 'Sí, solo el cupón.',
    inglês: 'Yes, only the coupon.',
  })) ambiguo(frase, TROCA_CUPOM, 'limitador em ' + idioma)
})

test('"Ersatz" pede troca; "Ersatzlieferung" pede reenvio — palavras que se contêm não se confundem', () => {
  const so = (t, esperado) => {
    const r = validarIntencao({ intencao: esperado, evidencia: t, textoAtual: t })
    assert.equal(r.intencao, esperado, `"${t}" é ${esperado}`)
  }
  so('Ich möchte Ersatz für das Polo.', 'pede_troca')
  // e a Ersatzlieferung, dentro de uma oferta de reenvio, não conta como troca
  const r = validarIntencao({ intencao: 'aceita', evidencia: 'Ja, ich nehme die Ersatzlieferung.', textoAtual: 'Ja, ich nehme die Ersatzlieferung.', oferta: { tipo: 'reenvio', pct: null, cupom: 30 } })
  assert.equal(r.intencao, 'aceita', 'Ersatzlieferung é o reenvio da própria oferta, não uma troca de fora')
})

test('aceite e recusa nos SETE idiomas — e negativa logística nunca vira recusa', () => {
  const oferta = { tipo: 'reembolso', pct: 40, cupom: null }
  const lido = (intencao, t) => validarIntencao({ intencao, evidencia: t, textoAtual: t, oferta }).intencao

  const ACEITES = {
    alemão: ['Ja.', 'Ja, gerne.', 'Okay, einverstanden.', 'Perfekt, abgemacht.'],
    holandês: ['Ja.', 'Ja, graag.', 'Akkoord.', 'Prima, oké.'],
    francês: ['Oui.', "Oui, d'accord.", 'Parfait.'],
    italiano: ['Sì.', 'Sì, va bene.', 'Perfetto, accetto.'],
    espanhol: ['Sí.', 'Sí, de acuerdo.', 'Perfecto, acepto.'],
    inglês: ['Yes.', 'Yes, perfect.', 'Ok, deal.'],
    português: ['Sim.', 'Sim, aceito.', 'Certo, perfeito.'],
  }
  const RECUSAS = {
    alemão: ['Nein.', 'Nein, ich will das nicht.', 'Das reicht nicht.'],
    holandês: ['Nee.', 'Nee, dat wil ik niet.', 'Niet akkoord.'],
    francês: ['Non.', 'Non, je ne veux pas.', 'Pas assez.'],
    italiano: ['No.', 'No, non voglio.', 'Non basta.'],
    espanhol: ['No.', 'No, no quiero.', 'No es suficiente.'],
    inglês: ['No.', "No, I don't want that.", 'Not enough.'],
    português: ['Não.', 'Não quero.', 'Não é suficiente.'],
  }
  // a armadilha: toda frase abaixo TEM uma negativa, e nenhuma delas recusa nada
  const LOGISTICAS = {
    alemão: 'Das Paket ist noch nicht da.',
    holandês: 'Ik heb het pakket niet ontvangen.',
    francês: "Je n'ai pas reçu le colis.",
    italiano: 'Non ho ricevuto il pacco.',
    espanhol: 'No llegó el pedido.',
    inglês: "I haven't received my order.",
    português: 'Não recebi meu pedido.',
  }

  assert.equal(Object.keys(ACEITES).length, 7)
  for (const [idioma, frases] of Object.entries(ACEITES)) {
    for (const f of frases) assert.equal(lido('aceita', f), 'aceita', `${idioma}: "${f}" é aceite`)
  }
  for (const [idioma, frases] of Object.entries(RECUSAS)) {
    for (const f of frases) assert.equal(lido('recusa', f), 'recusa', `${idioma}: "${f}" é recusa`)
  }
  for (const [idioma, f] of Object.entries(LOGISTICAS)) {
    assert.equal(lido('recusa', f), 'outro', `${idioma}: "${f}" NÃO pode virar recusa`)
    assert.equal(lido('aceita', f), 'outro', `${idioma}: "${f}" NÃO pode virar aceite`)
  }
})

test('"ok" não aceita oferta contraditória: ressalva, pergunta, outro percentual ou outra solução', () => {
  const troca20 = { tipo: 'troca_reembolso', pct: 20, cupom: null }
  const trocaCupom15 = { tipo: 'troca', pct: null, cupom: 15 }
  const r = (t, oferta = troca20) => validarIntencao({ intencao: 'aceita', evidencia: t, textoAtual: t, oferta })

  assert.equal(r('Ok.').intencao, 'aceita', 'resposta curta e sem contradição aceita')
  assert.equal(r('Ja, gerne.').intencao, 'aceita')

  const ressalva = r('Ok, mas quero 50%.')
  assert.equal(ressalva.intencao, 'outro', '"ok, mas…" não é aceite')
  assert.equal(ressalva.descartada, 'aceita')
  assert.match(ressalva.motivo, /ressalva/)

  const outraSolucao = r('Okay, aber ich möchte eine Rückerstattung.', trocaCupom15)
  assert.equal(outraSolucao.intencao, 'outro', 'pedir reembolso não aceita a troca')
  assert.match(outraSolucao.motivo, /ressalva|não é a solução/)

  const pergunta = r('Ok, qual é o prazo?')
  assert.equal(pergunta.intencao, 'outro', 'pergunta não conclui aceite')
  assert.match(pergunta.motivo, /pergunta/)

  // corresponde à oferta aberta → aceita; não corresponde → nunca.
  // troca_20 é oferta COMBINADA (troca + reembolso parcial), então o cliente
  // precisa confirmar os dois componentes — ver o teste do aceite parcial.
  assert.equal(r('Sim, aceito a troca e o reembolso de 20%.', troca20).intencao, 'aceita')
  assert.equal(r('Sim, aceito a troca de 20%.', trocaCupom15).intencao, 'outro', '20% não está na oferta de 15%')
  const pctDiferente = r('Ok, ich will 50%.', { tipo: 'reembolso', pct: 40, cupom: null })
  assert.equal(pctDiferente.intencao, 'outro')
  assert.match(pctDiferente.motivo, /não é o que está na oferta/)
  // o percentual da própria oferta continua valendo
  assert.equal(r('Ok, 40%.', { tipo: 'reembolso', pct: 40, cupom: null }).intencao, 'aceita')
  // ação diferente da oferta: nunca aceita
  assert.equal(r('Ok, dann bitte stornieren.', trocaCupom15).intencao, 'outro')
})

test('devolução NÃO é troca: pedir o produto de volta não rotula pedido de troca', () => {
  const r = t => validarIntencao({ intencao: 'pede_troca', evidencia: t, textoAtual: t })
  for (const t of ['Ich möchte das zurückschicken.', 'Ich will es zurückgeben.', 'I want to return it.', 'I will send it back.', 'Quero fazer a devolução.']) {
    assert.equal(r(t).intencao, 'outro', `"${t}" não é pedido de troca`)
    assert.equal(r(t).descartada, 'pede_troca')
  }
  // troca de verdade continua passando
  for (const t of ['Ich möchte einen Umtausch.', 'Ik wil graag een omruil.', 'Je voudrais un échange.', 'Quero uma troca.']) {
    assert.equal(r(t).intencao, 'pede_troca', `"${t}" é pedido de troca`)
  }
})

test('intenção de AÇÃO só passa com a frase do cliente: reclamar não é pedir', () => {
  const declaracao = separarTexto(KURT).declaracao
  // o caso real: o cliente xinga a qualidade e NÃO pede troca nem reembolso
  for (const intencao of ['pede_troca', 'pede_reembolso', 'pede_cancelamento']) {
    const r = validarIntencao({ intencao, evidencia: 'Das kann doch kein Mensch anziehen', textoAtual: declaracao })
    assert.equal(r.intencao, 'outro', `${intencao} sem pedido vira "outro"`)
    assert.equal(r.descartada, intencao)
    assert.match(r.motivo, /reclamar do produto ou pedir devolução não é isso/)
    assert.equal(r.evidenciaNoTextoAtual, false)
  }
  // prova que NÃO está no texto novo (veio do citado, do assunto ou inventada)
  const inventada = validarIntencao({ intencao: 'pede_reembolso', evidencia: 'ich will eine Rueckerstattung', textoAtual: declaracao })
  assert.equal(inventada.intencao, 'outro')
  assert.match(inventada.motivo, /não está na mensagem nova/)
  // sem trecho nenhum
  const vazia = validarIntencao({ intencao: 'pede_troca', evidencia: '', textoAtual: declaracao })
  assert.equal(vazia.intencao, 'outro')
  assert.match(vazia.motivo, /não apontou trecho/)

  // PEDIDO DE VERDADE continua passando, nos idiomas atendidos
  const passa = (intencao, evidencia, textoAtual = evidencia) => {
    const r = validarIntencao({ intencao, evidencia, textoAtual })
    assert.equal(r.intencao, intencao, `${intencao}: "${evidencia}" tinha de passar`)
    assert.equal(r.descartada, null)
    assert.equal(r.evidenciaNoTextoAtual, true)
  }
  passa('pede_troca', 'ich möchte einen Umtausch', 'Die Qualität ist schlecht, ich möchte einen Umtausch.')
  passa('pede_troca', 'ik wil graag een omruil')
  passa('pede_reembolso', 'ich will mein Geld zurück', 'Ich will mein Geld zurück!')
  passa('pede_reembolso', 'je veux un remboursement')
  passa('pede_cancelamento', 'bitte stornieren Sie die Bestellung')
  passa('aceita', 'Ja, gerne.')
  passa('aceita', 'Okay, einverstanden.')
  passa('recusa', 'Nein, das reicht nicht.')
  passa('recusa', 'Niet akkoord.')

  // intenções que NÃO afirmam um ato passam sem prova nenhuma
  for (const intencao of ['informa', 'pergunta_status', 'agradece', 'outro']) {
    const r = validarIntencao({ intencao, evidencia: '', textoAtual: declaracao })
    assert.equal(r.intencao, intencao)
    assert.equal(r.descartada, null)
  }
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
