// Classificação e rascunho por regras — usados como fallback quando a
// ANTHROPIC_API_KEY não está configurada, e como fonte dos dados de demonstração.

export function classificarLocal(texto) {
  const t = texto.toLowerCase()
  if (/rastrei|track|dov'?è|où est|wo ist|cadê|onde est|not received|não recebi|non ho .*ricevuto/.test(t)) return 'rastreio'
  if (/reembols|refund|remborse|remboursement|rückerstattung|rimborso|devolu|money back/.test(t)) return 'reembolso'
  if (/troca|exchange|trocar|échanger|umtausch|cambio|tamanho|size/.test(t)) return 'troca'
  if (/quando.*(chega|envia|ship)|when.*(arrive|ship)|wann|prazo|deadline|entrega|delivery|versand/.test(t)) return 'entrega'
  if (/produto|product|funciona|work|voltage|110v|220v|material|misura|dimens/.test(t)) return 'produto'
  return 'outro'
}

export function detectarIdiomaLocal(texto) {
  const t = texto.toLowerCase()
  if (/\b(the|my|is|where|when|order|please)\b/.test(t) && !/\b(meu|não|pedido)\b/.test(t)) return 'en'
  if (/\b(dov'?è|il mio|ordine|grazie|ciao)\b/.test(t)) return 'it'
  if (/\b(wo|meine|bestellung|hallo|wann)\b/.test(t)) return 'de'
  if (/\b(où|ma commande|bonjour|remboursement|colis)\b/.test(t)) return 'fr'
  if (/\b(dónde|mi pedido|hola|gracias|cuándo)\b/.test(t)) return 'es'
  return 'pt'
}

const saudacoes = {
  pt: { oi: 'Olá', obrigado: 'Obrigado por entrar em contato', abraco: 'Qualquer coisa, é só responder este e-mail' },
  en: { oi: 'Hi', obrigado: 'Thanks for reaching out', abraco: 'If you need anything else, just reply to this email' },
  es: { oi: 'Hola', obrigado: 'Gracias por escribirnos', abraco: 'Cualquier cosa, responde a este correo' },
  it: { oi: 'Ciao', obrigado: 'Grazie per averci contattato', abraco: 'Per qualsiasi cosa, rispondi a questa email' },
  de: { oi: 'Hallo', obrigado: 'Danke für deine Nachricht', abraco: 'Bei Fragen antworte einfach auf diese E-Mail' },
  fr: { oi: 'Bonjour', obrigado: 'Merci de nous avoir contactés', abraco: "Pour toute question, répondez simplement à cet e-mail" },
}

export function gerarRascunhoLocal(ticket, politicas, faqs, pedidos, assinatura) {
  const s = saudacoes[ticket.idioma] ?? saudacoes.pt
  const pedido = pedidos.find(p => p.email?.toLowerCase() === ticket.de.toLowerCase())
  const ativas = politicas.filter(p => p.ativa)
  const linhas = [`${s.oi} ${ticket.nome.split(' ')[0]},`, '', `${s.obrigado}!`]
  let confianca = 0.55
  let motivo

  if (ticket.categoria === 'rastreio' || ticket.categoria === 'entrega') {
    if (pedido) {
      const st = pedido.status === 'entregue' ? 'consta como entregue' : pedido.status === 'transito' ? 'está em trânsito' : 'está em preparação'
      linhas.push('', `Seu pedido ${pedido.numero} ${st}. O código de rastreio é ${pedido.rastreio} — você pode acompanhar em tempo real pelo site da transportadora.`)
      confianca = 0.95
    } else {
      linhas.push('', 'Localizei sua solicitação e estou verificando o status do seu pedido. Assim que houver movimentação no rastreio, você recebe a atualização por aqui.')
      confianca = 0.6
    }
    const prazo = ativas.find(p => /prazo|entrega|envio/i.test(p.titulo))
    if (prazo) { linhas.push('', prazo.conteudo); confianca = Math.min(0.97, confianca + 0.05) }
  } else if (ticket.categoria === 'reembolso') {
    const pol = ativas.find(p => /reembolso|devolu/i.test(p.titulo))
    if (pol) linhas.push('', pol.conteudo)
    linhas.push('', 'Encaminhei sua solicitação para análise e retorno em breve com a confirmação.')
    confianca = pol ? 0.7 : 0.4
    motivo = 'Reembolso — precisa da sua aprovação antes do envio'
  } else if (ticket.categoria === 'troca') {
    const pol = ativas.find(p => /troca/i.test(p.titulo))
    if (pol) linhas.push('', pol.conteudo)
    else linhas.push('', 'Vamos verificar a disponibilidade para troca e retornamos em seguida com o passo a passo.')
    confianca = pol ? 0.75 : 0.45
    motivo = pol ? undefined : 'Sem política de troca cadastrada'
  } else {
    const faq = faqs.find(f => f.ativa && f.pergunta.toLowerCase().split(' ').filter(w => w.length > 4).some(w => (ticket.assunto + ' ' + ticket.corpo).toLowerCase().includes(w)))
    if (faq) { linhas.push('', faq.resposta); confianca = 0.85 }
    else { linhas.push('', 'Recebemos sua mensagem e já estamos verificando. Retornamos em breve com todos os detalhes.'); confianca = 0.5; motivo = 'Nenhuma FAQ ou política cobre esta dúvida' }
  }

  linhas.push('', `${s.abraco}.`, '', assinatura)
  return { resposta: linhas.join('\n'), confianca, motivo: motivo ?? null, categoria: ticket.categoria, idioma: ticket.idioma, escalarHumano: ticket.categoria === 'reembolso' || confianca < 0.55 }
}

export function pareceSpam(assunto, corpo, de) {
  const t = (assunto + ' ' + corpo).toLowerCase()
  return /escale sua loja|seo|backlink|agency|agência de marketing|cold outreach|aumentar suas vendas|guest post|link building|grow your (store|business)|book a call|agende uma call/.test(t)
    || /@(.*\.)?(agency|marketing|seo)\./.test(de)
}

/* ---------------- Dados de demonstração ---------------- */

export const demoPedidos = [
  { id: 'p1', numero: '#1042', cliente: 'Marina Rossi', email: 'marina.rossi@gmail.com', pais: 'Itália', valor: 89.9, status: 'transito', rastreio: 'RR284650121IT', criadoEm: '2026-07-14' },
  { id: 'p2', numero: '#1041', cliente: 'Lukas Weber', email: 'lukas.weber@web.de', pais: 'Alemanha', valor: 129.0, status: 'aguardando', rastreio: '—', criadoEm: '2026-07-16' },
  { id: 'p3', numero: '#1039', cliente: 'Ana Souza', email: 'ana.souza@hotmail.com', pais: 'Brasil', valor: 59.5, status: 'entregue', rastreio: 'BR776120345BR', criadoEm: '2026-07-08' },
  { id: 'p4', numero: '#1038', cliente: 'Claire Dubois', email: 'claire.dubois@orange.fr', pais: 'França', valor: 74.0, status: 'problema', rastreio: 'LP004512278FR', criadoEm: '2026-07-05' },
  { id: 'p5', numero: '#1036', cliente: 'John Miller', email: 'john.miller@yahoo.com', pais: 'Estados Unidos', valor: 210.0, status: 'transito', rastreio: 'US51290871US', criadoEm: '2026-07-11' },
]

export const demoEmails = [
  { nome: 'Marina Rossi', de: 'marina.rossi@gmail.com', assunto: "Dov'è il mio ordine?", corpo: "Ciao, ho ordinato la settimana scorsa e non ho ancora ricevuto nulla. Potete dirmi dove si trova il mio pacco?" },
  { nome: 'Lukas Weber', de: 'lukas.weber@web.de', assunto: 'Wann wird meine Bestellung versendet?', corpo: 'Hallo, ich habe vor zwei Tagen bestellt. Wann wird das Paket verschickt?' },
  { nome: 'Ana Souza', de: 'ana.souza@hotmail.com', assunto: 'Quero trocar o tamanho', corpo: 'Oi! Recebi o produto mas ficou pequeno. Como faço para trocar pelo tamanho M?' },
  { nome: 'Claire Dubois', de: 'claire.dubois@orange.fr', assunto: 'Remboursement — colis endommagé', corpo: "Bonjour, mon colis est arrivé endommagé. Je souhaite un remboursement complet. C'est inacceptable." },
  { nome: 'John Miller', de: 'john.miller@yahoo.com', assunto: 'Does it work with 110V?', corpo: 'Hey, quick question before it arrives — does the device support 110V outlets in the US?' },
  { nome: 'Carlos Mendes', de: 'carlos.mendes@gmail.com', assunto: 'Cadê meu pedido?', corpo: 'Comprei há 5 dias e nada de código de rastreio. Podem verificar por favor?' },
]

export const demoSpam = [
  { nome: 'Growth Agency Pro', de: 'contact@growthagencypro.io', assunto: 'Escale sua loja para 7 dígitos 🚀', corpo: 'Somos especialistas em escalar e-commerces. Agende uma call gratuita hoje!' },
  { nome: 'SEO Masters', de: 'hello@seomasters.agency', assunto: 'Sua loja está perdendo tráfego', corpo: 'Auditamos seu site e encontramos 47 erros críticos de SEO. Responda para receber o relatório.' },
]

export const bibliotecaEcommerce = [
  { pergunta: 'Qual o prazo de entrega?', resposta: 'O prazo de processamento é de 1 a 2 dias úteis e a entrega leva em média 7 a 12 dias úteis, dependendo do país. Assim que o pedido é despachado, você recebe o código de rastreio por e-mail.' },
  { pergunta: 'Como acompanho meu pedido?', resposta: 'Assim que o pedido é despachado, enviamos o código de rastreio por e-mail. Com ele, você acompanha cada etapa da entrega no site da transportadora.' },
  { pergunta: 'Como funciona a troca?', resposta: 'Você tem até 30 dias após o recebimento para solicitar a troca. O produto deve estar sem uso e na embalagem original. É só responder este e-mail com o número do pedido.' },
  { pergunta: 'Como funciona o reembolso?', resposta: 'Reembolsos são processados em até 7 dias úteis após a aprovação, no mesmo método de pagamento da compra.' },
  { pergunta: 'Vocês enviam para o meu país?', resposta: 'Enviamos para a maioria dos países. Se o checkout aceitou seu endereço, seu país está coberto.' },
  { pergunta: 'O pagamento é seguro?', resposta: 'Sim — o checkout usa criptografia e processadores certificados. Não armazenamos dados do seu cartão.' },
  { pergunta: 'Posso alterar o endereço depois da compra?', resposta: 'Se o pedido ainda não foi despachado, sim. Responda este e-mail o quanto antes com o endereço correto.' },
  { pergunta: 'Meu pedido chegou danificado, e agora?', resposta: 'Sentimos muito! Envie uma foto do produto e da embalagem respondendo este e-mail e resolveremos com prioridade — troca ou reembolso, como preferir.' },
  { pergunta: 'Recebi um produto errado', resposta: 'Pedimos desculpas pelo transtorno. Responda com uma foto do item recebido e o número do pedido, e enviaremos o item correto sem custo.' },
  { pergunta: 'Como cancelo meu pedido?', resposta: 'Pedidos podem ser cancelados sem custo antes do despacho. Depois do envio, é possível recusar a entrega ou solicitar devolução ao receber.' },
  { pergunta: 'Vocês têm loja física?', resposta: 'Atuamos 100% online, o que nos permite oferecer preços melhores e entrega em todo o território atendido.' },
  { pergunta: 'Preciso pagar taxa de alfândega?', resposta: 'Na maioria dos casos, não. Caso alguma taxa seja aplicada no seu país, entre em contato conosco que ajudamos a resolver.' },
]

export const politicasSugeridas = [
  { titulo: 'Prazo de envio e entrega', conteudo: 'Processamos pedidos em 1–2 dias úteis. A entrega leva de 7 a 12 dias úteis dependendo do destino, com código de rastreio enviado por e-mail no despacho.' },
  { titulo: 'Política de trocas', conteudo: 'Trocas em até 30 dias após o recebimento, com produto sem uso e na embalagem original. O frete da primeira troca é por nossa conta.' },
  { titulo: 'Política de reembolso', conteudo: 'Reembolso integral em até 7 dias úteis após aprovação, no método de pagamento original. Produtos danificados no transporte têm reembolso ou reenvio prioritário.' },
  { titulo: 'Alfândega e taxas', conteudo: 'Eventuais taxas alfandegárias são raras; quando ocorrem, oferecemos suporte para minimizar o custo ao cliente.' },
]
