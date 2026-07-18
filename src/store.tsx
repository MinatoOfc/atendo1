import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/* ---------------- Tipos ---------------- */

export type Categoria = 'rastreio' | 'reembolso' | 'troca' | 'produto' | 'entrega' | 'outro'
export type StatusTicket = 'inbox' | 'aprovacao' | 'humano' | 'enviado' | 'spam' | 'lixeira'

export interface Ticket {
  id: string
  nome: string
  de: string
  assunto: string
  corpo: string
  data: string
  lido: boolean
  origem: 'cliente' | 'shopify'
  categoria: Categoria
  status: StatusTicket
  statusAnterior?: StatusTicket
  idioma: string
  rascunho?: string
  confianca?: number
  motivoEscalada?: string
  resposta?: string
  respondidoEm?: string
  enviaEm?: number // epoch ms — envio automático agendado
}

export interface Politica { id: string; titulo: string; conteudo: string; ativa: boolean }
export interface Faq { id: string; pergunta: string; resposta: string; ativa: boolean }

export interface Pedido {
  id: string; numero: string; cliente: string; email: string; pais: string
  valor: number; status: 'aguardando' | 'transito' | 'entregue' | 'problema'
  rastreio: string; criadoEm: string
}

export interface Config {
  nomeLoja: string
  emailConectado: string | null
  shopifyConectada: boolean
  tomDetectado: boolean
  automacaoAtiva: boolean
  atrasoMinutos: number
  assinatura: string
}

interface State {
  tickets: Ticket[]
  politicas: Politica[]
  faqs: Faq[]
  pedidos: Pedido[]
  config: Config
  tipsFechados: string[]
}

/* ---------------- Persistência ---------------- */

const KEY = 'atendo-state-v1'

const configPadrao: Config = {
  nomeLoja: 'minha loja',
  emailConectado: null,
  shopifyConectada: false,
  tomDetectado: false,
  automacaoAtiva: false,
  atrasoMinutos: 3,
  assinatura: 'Equipe de atendimento',
}

const estadoInicial: State = {
  tickets: [], politicas: [], faqs: [], pedidos: [],
  config: configPadrao, tipsFechados: [],
}

function carregar(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return estadoInicial
    const s = JSON.parse(raw)
    return { ...estadoInicial, ...s, config: { ...configPadrao, ...s.config } }
  } catch {
    return estadoInicial
  }
}

let seq = Date.now()
export const uid = () => (seq++).toString(36)

/* ---------------- "IA" simulada ---------------- */

const saudacoes: Record<string, { oi: string; obrigado: string; abraco: string }> = {
  pt: { oi: 'Olá', obrigado: 'Obrigado por entrar em contato', abraco: 'Qualquer coisa, é só responder este e-mail' },
  en: { oi: 'Hi', obrigado: 'Thanks for reaching out', abraco: 'If you need anything else, just reply to this email' },
  es: { oi: 'Hola', obrigado: 'Gracias por escribirnos', abraco: 'Cualquier cosa, responde a este correo' },
  it: { oi: 'Ciao', obrigado: 'Grazie per averci contattato', abraco: 'Per qualsiasi cosa, rispondi a questa email' },
  de: { oi: 'Hallo', obrigado: 'Danke für deine Nachricht', abraco: 'Bei Fragen antworte einfach auf diese E-Mail' },
  fr: { oi: 'Bonjour', obrigado: 'Merci de nous avoir contactés', abraco: "Pour toute question, répondez simplement à cet e-mail" },
}

export function gerarRascunho(t: Ticket, politicas: Politica[], faqs: Faq[], pedidos: Pedido[], assinatura: string): { rascunho: string; confianca: number; motivo?: string } {
  const s = saudacoes[t.idioma] ?? saudacoes.pt
  const pedido = pedidos.find(p => p.email.toLowerCase() === t.de.toLowerCase())
  const politicasAtivas = politicas.filter(p => p.ativa)
  const linhas: string[] = [`${s.oi} ${t.nome.split(' ')[0]},`, '', `${s.obrigado}!`]
  let confianca = 0.55
  let motivo: string | undefined

  if (t.categoria === 'rastreio' || t.categoria === 'entrega') {
    if (pedido) {
      const st = pedido.status === 'entregue' ? 'consta como entregue' : pedido.status === 'transito' ? 'está em trânsito' : 'está em preparação'
      linhas.push('', `Seu pedido ${pedido.numero} ${st}. O código de rastreio é ${pedido.rastreio} — você pode acompanhar em tempo real pelo link da transportadora.`)
      confianca = 0.95
    } else {
      linhas.push('', 'Localizei sua solicitação e estou verificando o status do seu pedido. Assim que houver movimentação no rastreio, você recebe a atualização por aqui.')
      confianca = 0.6
    }
    const prazo = politicasAtivas.find(p => /prazo|entrega|envio/i.test(p.titulo))
    if (prazo) { linhas.push('', prazo.conteudo); confianca = Math.min(0.97, confianca + 0.05) }
  } else if (t.categoria === 'reembolso') {
    const pol = politicasAtivas.find(p => /reembolso|devolu/i.test(p.titulo))
    if (pol) linhas.push('', pol.conteudo)
    linhas.push('', 'Encaminhei sua solicitação para análise e retorno em breve com a confirmação.')
    confianca = pol ? 0.7 : 0.4
    motivo = 'Reembolso — precisa da sua aprovação antes do envio'
  } else if (t.categoria === 'troca') {
    const pol = politicasAtivas.find(p => /troca/i.test(p.titulo))
    if (pol) linhas.push('', pol.conteudo)
    else linhas.push('', 'Vamos verificar a disponibilidade para troca e retornamos em seguida com o passo a passo.')
    confianca = pol ? 0.75 : 0.45
    motivo = pol ? undefined : 'Sem política de troca cadastrada'
  } else {
    const faq = faqs.find(f => f.ativa && f.pergunta.toLowerCase().split(' ').filter(w => w.length > 4).some(w => (t.assunto + ' ' + t.corpo).toLowerCase().includes(w)))
    if (faq) { linhas.push('', faq.resposta); confianca = 0.85 }
    else { linhas.push('', 'Recebemos sua mensagem e já estamos verificando. Retornamos em breve com todos os detalhes.'); confianca = 0.5; motivo = 'Nenhuma FAQ ou política cobre esta dúvida' }
  }

  linhas.push('', `${s.abraco}.`, '', assinatura)
  return { rascunho: linhas.join('\n'), confianca, motivo }
}

/* ---------------- Dados de demonstração ---------------- */

const demoPedidos: Pedido[] = [
  { id: 'p1', numero: '#1042', cliente: 'Marina Rossi', email: 'marina.rossi@gmail.com', pais: 'Itália', valor: 89.9, status: 'transito', rastreio: 'RR284650121IT', criadoEm: '2026-07-14' },
  { id: 'p2', numero: '#1041', cliente: 'Lukas Weber', email: 'lukas.weber@web.de', pais: 'Alemanha', valor: 129.0, status: 'aguardando', rastreio: '—', criadoEm: '2026-07-16' },
  { id: 'p3', numero: '#1039', cliente: 'Ana Souza', email: 'ana.souza@hotmail.com', pais: 'Brasil', valor: 59.5, status: 'entregue', rastreio: 'BR776120345BR', criadoEm: '2026-07-08' },
  { id: 'p4', numero: '#1038', cliente: 'Claire Dubois', email: 'claire.dubois@orange.fr', pais: 'França', valor: 74.0, status: 'problema', rastreio: 'LP004512278FR', criadoEm: '2026-07-05' },
  { id: 'p5', numero: '#1036', cliente: 'John Miller', email: 'john.miller@yahoo.com', pais: 'Estados Unidos', valor: 210.0, status: 'transito', rastreio: 'US51290871US', criadoEm: '2026-07-11' },
]

const demoEmails: Array<Omit<Ticket, 'id' | 'data' | 'lido' | 'status' | 'origem'>> = [
  { nome: 'Marina Rossi', de: 'marina.rossi@gmail.com', assunto: "Dov'è il mio ordine?", corpo: "Ciao, ho ordinato la settimana scorsa e non ho ancora ricevuto nulla. Potete dirmi dove si trova il mio pacco?", categoria: 'rastreio', idioma: 'it' },
  { nome: 'Lukas Weber', de: 'lukas.weber@web.de', assunto: 'Wann wird meine Bestellung versendet?', corpo: 'Hallo, ich habe vor zwei Tagen bestellt. Wann wird das Paket verschickt?', categoria: 'entrega', idioma: 'de' },
  { nome: 'Ana Souza', de: 'ana.souza@hotmail.com', assunto: 'Quero trocar o tamanho', corpo: 'Oi! Recebi o produto mas ficou pequeno. Como faço para trocar pelo tamanho M?', categoria: 'troca', idioma: 'pt' },
  { nome: 'Claire Dubois', de: 'claire.dubois@orange.fr', assunto: 'Remboursement — colis endommagé', corpo: "Bonjour, mon colis est arrivé endommagé. Je souhaite un remboursement complet. C'est inacceptable.", categoria: 'reembolso', idioma: 'fr' },
  { nome: 'John Miller', de: 'john.miller@yahoo.com', assunto: 'Does it work with 110V?', corpo: 'Hey, quick question before it arrives — does the device support 110V outlets in the US?', categoria: 'produto', idioma: 'en' },
  { nome: 'Carlos Mendes', de: 'carlos.mendes@gmail.com', assunto: 'Cadê meu pedido?', corpo: 'Comprei há 5 dias e nada de código de rastreio. Podem verificar por favor?', categoria: 'rastreio', idioma: 'pt' },
]

const demoSpam: Array<Omit<Ticket, 'id' | 'data' | 'lido' | 'status' | 'origem'>> = [
  { nome: 'Growth Agency Pro', de: 'contact@growthagencypro.io', assunto: 'Escale sua loja para 7 dígitos 🚀', corpo: 'Somos especialistas em escalar e-commerces. Agende uma call gratuita hoje!', categoria: 'outro', idioma: 'pt' },
  { nome: 'SEO Masters', de: 'hello@seomasters.agency', assunto: 'Sua loja está perdendo tráfego', corpo: 'Auditamos seu site e encontramos 47 erros críticos de SEO. Responda para receber o relatório.', categoria: 'outro', idioma: 'pt' },
]

export const bibliotecaEcommerce: Array<Omit<Faq, 'id' | 'ativa'>> = [
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

export const politicasSugeridas: Array<Omit<Politica, 'id' | 'ativa'>> = [
  { titulo: 'Prazo de envio e entrega', conteudo: 'Processamos pedidos em 1–2 dias úteis. A entrega leva de 7 a 12 dias úteis dependendo do destino, com código de rastreio enviado por e-mail no despacho.' },
  { titulo: 'Política de trocas', conteudo: 'Trocas em até 30 dias após o recebimento, com produto sem uso e na embalagem original. O frete da primeira troca é por nossa conta.' },
  { titulo: 'Política de reembolso', conteudo: 'Reembolso integral em até 7 dias úteis após aprovação, no método de pagamento original. Produtos danificados no transporte têm reembolso ou reenvio prioritário.' },
  { titulo: 'Alfândega e taxas', conteudo: 'Eventuais taxas alfandegárias são raras; quando ocorrem, oferecemos suporte para minimizar o custo ao cliente.' },
]

/* ---------------- Contexto ---------------- */

interface Store extends State {
  naoLidos: number
  aguardandoAprovacao: Ticket[]
  casosHumanos: Ticket[]
  setConfig: (patch: Partial<Config>) => void
  fecharTip: (id: string) => void
  sincronizar: () => number
  enviarNovoEmail: (para: string, assunto: string, corpo: string) => void
  marcarLido: (id: string) => void
  aprovarEnviar: (id: string, texto: string) => void
  editarRascunho: (id: string, texto: string) => void
  moverPara: (id: string, status: StatusTicket, motivo?: string) => void
  restaurar: (id: string) => void
  excluirDefinitivo: (id: string) => void
  addPolitica: (titulo: string, conteudo: string) => void
  togglePolitica: (id: string) => void
  removerPolitica: (id: string) => void
  addFaq: (pergunta: string, resposta: string) => void
  toggleFaq: (id: string) => void
  removerFaq: (id: string) => void
  instalarBiblioteca: () => void
  preencherPoliticas: () => void
  conectarShopify: () => void
  limparTudo: () => void
}

const Ctx = createContext<Store>(null as unknown as Store)
export const useStore = () => useContext(Ctx)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(carregar)

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(state)) }, [state])

  // Timer de envio automático: verifica a cada segundo se algum rascunho aprovado venceu
  useEffect(() => {
    const t = setInterval(() => {
      setState(s => {
        const agora = Date.now()
        if (!s.tickets.some(tk => tk.enviaEm && tk.enviaEm <= agora)) return s
        return {
          ...s,
          tickets: s.tickets.map(tk =>
            tk.enviaEm && tk.enviaEm <= agora
              ? { ...tk, status: 'enviado', resposta: tk.rascunho, respondidoEm: new Date().toISOString(), enviaEm: undefined }
              : tk,
          ),
        }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const api = useMemo<Store>(() => {
    const patch = (fn: (s: State) => Partial<State>) => setState(s => ({ ...s, ...fn(s) }))
    const mudarTicket = (id: string, fn: (t: Ticket) => Ticket) =>
      patch(s => ({ tickets: s.tickets.map(t => (t.id === id ? fn(t) : t)) }))

    return {
      ...state,
      naoLidos: state.tickets.filter(t => ['inbox', 'aprovacao', 'humano'].includes(t.status) && !t.lido).length,
      aguardandoAprovacao: state.tickets.filter(t => t.status === 'aprovacao'),
      casosHumanos: state.tickets.filter(t => t.status === 'humano'),

      setConfig: p => patch(s => ({ config: { ...s.config, ...p } })),
      fecharTip: id => patch(s => ({ tipsFechados: [...s.tipsFechados, id] })),

      sincronizar: () => {
        let novos = 0
        setState(s => {
          const existentes = new Set(s.tickets.map(t => t.de + '|' + t.assunto))
          const agora = Date.now()
          const criados: Ticket[] = []
          demoEmails.forEach((e, i) => {
            if (existentes.has(e.de + '|' + e.assunto)) return
            const base: Ticket = {
              ...e, id: uid(), origem: 'cliente', lido: false,
              data: new Date(agora - (i + 1) * 3600_000 * 3).toISOString(),
              status: 'inbox',
            }
            const g = gerarRascunho(base, s.politicas, s.faqs, s.pedidos, s.config.assinatura)
            base.rascunho = g.rascunho
            base.confianca = g.confianca
            if (e.categoria === 'reembolso') { base.status = 'humano'; base.motivoEscalada = g.motivo ?? 'Caso sensível: reembolso' }
            else if (g.confianca < 0.55) { base.status = 'humano'; base.motivoEscalada = g.motivo ?? 'Baixa confiança na resposta' }
            else {
              base.status = 'aprovacao'
              if (s.config.automacaoAtiva) base.enviaEm = agora + s.config.atrasoMinutos * 60_000
            }
            criados.push(base)
          })
          demoSpam.forEach((e, i) => {
            if (existentes.has(e.de + '|' + e.assunto)) return
            criados.push({ ...e, id: uid(), origem: 'cliente', lido: false, data: new Date(agora - (i + 2) * 3600_000 * 5).toISOString(), status: 'spam' })
          })
          novos = criados.length
          return { ...s, tickets: [...criados, ...s.tickets] }
        })
        return novos
      },

      enviarNovoEmail: (para, assunto, corpo) =>
        patch(s => ({
          tickets: [{
            id: uid(), nome: para.split('@')[0], de: para, assunto, corpo: '',
            data: new Date().toISOString(), lido: true, origem: 'cliente' as const,
            categoria: 'outro' as const, status: 'enviado' as const, idioma: 'pt',
            resposta: corpo, respondidoEm: new Date().toISOString(),
          }, ...s.tickets],
        })),

      marcarLido: id => mudarTicket(id, t => ({ ...t, lido: true })),
      editarRascunho: (id, texto) => mudarTicket(id, t => ({ ...t, rascunho: texto })),
      aprovarEnviar: (id, texto) => mudarTicket(id, t => ({ ...t, status: 'enviado', rascunho: texto, resposta: texto, respondidoEm: new Date().toISOString(), enviaEm: undefined, lido: true })),
      moverPara: (id, status, motivo) => mudarTicket(id, t => ({ ...t, statusAnterior: t.status, status, motivoEscalada: motivo ?? t.motivoEscalada, enviaEm: undefined })),
      restaurar: id => mudarTicket(id, t => ({ ...t, status: t.statusAnterior && t.statusAnterior !== 'lixeira' ? t.statusAnterior : 'inbox' })),
      excluirDefinitivo: id => patch(s => ({ tickets: s.tickets.filter(t => t.id !== id) })),

      addPolitica: (titulo, conteudo) => patch(s => ({ politicas: [...s.politicas, { id: uid(), titulo, conteudo, ativa: true }] })),
      togglePolitica: id => patch(s => ({ politicas: s.politicas.map(p => (p.id === id ? { ...p, ativa: !p.ativa } : p)) })),
      removerPolitica: id => patch(s => ({ politicas: s.politicas.filter(p => p.id !== id) })),
      addFaq: (pergunta, resposta) => patch(s => ({ faqs: [...s.faqs, { id: uid(), pergunta, resposta, ativa: true }] })),
      toggleFaq: id => patch(s => ({ faqs: s.faqs.map(f => (f.id === id ? { ...f, ativa: !f.ativa } : f)) })),
      removerFaq: id => patch(s => ({ faqs: s.faqs.filter(f => f.id !== id) })),
      instalarBiblioteca: () =>
        patch(s => ({
          faqs: [...s.faqs, ...bibliotecaEcommerce.filter(b => !s.faqs.some(f => f.pergunta === b.pergunta)).map(b => ({ ...b, id: uid(), ativa: true }))],
        })),
      preencherPoliticas: () =>
        patch(s => ({
          politicas: [...s.politicas, ...politicasSugeridas.filter(p => !s.politicas.some(x => x.titulo === p.titulo)).map(p => ({ ...p, id: uid(), ativa: true }))],
        })),

      conectarShopify: () => patch(() => ({ config: { ...state.config, shopifyConectada: true }, pedidos: demoPedidos })),
      limparTudo: () => setState({ ...estadoInicial, tipsFechados: state.tipsFechados }),
    }
  }, [state])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/* ---------------- Helpers ---------------- */

export const nomeCategoria: Record<Categoria, string> = {
  rastreio: 'Rastreio', reembolso: 'Reembolso', troca: 'Troca',
  produto: 'Produto', entrega: 'Entrega', outro: 'Outro',
}

export const nomeIdioma: Record<string, string> = {
  pt: 'Português', en: 'Inglês', es: 'Espanhol', it: 'Italiano', de: 'Alemão', fr: 'Francês',
}

export function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return `${d} d`
}

export function saudacaoDia(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}
