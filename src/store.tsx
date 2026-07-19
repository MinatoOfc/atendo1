import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
  enviaEm?: number
  geradoPorIA?: boolean
}

export interface Politica { id: string; titulo: string; conteudo: string; ativa: boolean }
export interface Faq { id: string; pergunta: string; resposta: string; ativa: boolean }

export interface Produto {
  id: string; titulo: string; tipo: string; marca: string; tags: string[]
  precoMin: number; precoMax: number; estoque: number; ativo: boolean
  variantes: string[]; url: string; descricao: string
}

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
  escalarSensiveis: boolean
  confiancaMinima: number
  assinatura: string
}

export interface StatusEmail { ok: boolean | null; erro: string | null; verificadoEm: string | null }

export interface MensagemCaixa {
  de: string; assunto: string; data: string | null
  lido: boolean; virouTicket: boolean; respostaDoAtendo: boolean
}
export interface Diagnostico {
  ok: boolean; erro?: string; caixa?: string
  totalNaCaixa?: number; janelaDias?: number; encontradosNaJanela?: number
  mensagens?: MensagemCaixa[]
}
export interface StatusIA { ok: boolean | null; erro: string | null; verificadoEm: string | null; modelo?: string }
export interface StatusShopify {
  ok: boolean | null; erro: string | null; verificadoEm: string | null
  loja?: string | null; pedidos?: number; modo?: 'token' | 'oauth' | null
}
export interface Integracoes {
  email: boolean; shopify: boolean; ia: boolean
  shopifyOauth: boolean
  emailStatus: StatusEmail
  iaStatus: StatusIA
  shopifyStatus: StatusShopify
}

interface ServerState {
  tickets: Ticket[]
  politicas: Politica[]
  faqs: Faq[]
  pedidos: Pedido[]
  produtos: Produto[]
  config: Config
  integracoes: Integracoes
}

const configPadrao: Config = {
  nomeLoja: 'minha loja', emailConectado: null, shopifyConectada: false,
  tomDetectado: false, automacaoAtiva: false, atrasoMinutos: 3,
  escalarSensiveis: true, confiancaMinima: 0.55,
  assinatura: 'Equipe de atendimento',
}

const estadoVazio: ServerState = {
  tickets: [], politicas: [], faqs: [], pedidos: [], produtos: [],
  config: configPadrao,
  integracoes: {
    email: false, shopify: false, ia: false, shopifyOauth: false,
    emailStatus: { ok: null, erro: null, verificadoEm: null },
    iaStatus: { ok: null, erro: null, verificadoEm: null },
    shopifyStatus: { ok: null, erro: null, verificadoEm: null },
  },
}

/* ---------------- API ---------------- */

async function api(caminho: string, metodo = 'POST', body?: unknown): Promise<{ state?: ServerState; novos?: number; erro?: string }> {
  const resp = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return resp.json()
}

/* ---------------- Contexto ---------------- */

interface Store extends ServerState {
  carregado: boolean
  tipsFechados: string[]
  naoLidos: number
  aguardandoAprovacao: Ticket[]
  casosHumanos: Ticket[]
  setConfig: (patch: Partial<Config>) => void
  fecharTip: (id: string) => void
  sincronizar: () => Promise<number>
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
  testarEmail: () => Promise<StatusEmail>
  diagnosticarEmail: () => Promise<Diagnostico>
  testarIA: () => Promise<StatusIA>
  testarShopify: () => Promise<StatusShopify>
  desconectarShopify: () => void
}

const Ctx = createContext<Store>(null as unknown as Store)
export const useStore = () => useContext(Ctx)

const TIPS_KEY = 'atendo-tips-fechados'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState>(estadoVazio)
  const [carregado, setCarregado] = useState(false)
  const [tipsFechados, setTipsFechados] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(TIPS_KEY) ?? '[]') } catch { return [] }
  })
  const debounces = useRef<Record<string, number>>({})

  useEffect(() => { localStorage.setItem(TIPS_KEY, JSON.stringify(tipsFechados)) }, [tipsFechados])

  const aplicar = (r: { state?: ServerState }) => { if (r.state) setState(r.state) }

  // carga inicial + polling (pega envios automáticos e e-mails novos do servidor)
  useEffect(() => {
    let ativo = true
    const buscar = () => api('/state', 'GET').then(r => { if (ativo) { aplicar(r); setCarregado(true) } }).catch(() => {})
    buscar()
    const i = setInterval(buscar, 10_000)
    return () => { ativo = false; clearInterval(i) }
  }, [])

  const store = useMemo<Store>(() => ({
    ...state,
    carregado,
    tipsFechados,
    naoLidos: state.tickets.filter(t => ['inbox', 'aprovacao', 'humano'].includes(t.status) && !t.lido).length,
    aguardandoAprovacao: state.tickets.filter(t => t.status === 'aprovacao'),
    casosHumanos: state.tickets.filter(t => t.status === 'humano'),

    fecharTip: id => setTipsFechados(x => [...x, id]),

    setConfig: patch => {
      setState(s => ({ ...s, config: { ...s.config, ...patch } }))
      api('/config', 'POST', patch).then(aplicar)
    },

    sincronizar: async () => {
      const r = await api('/sync')
      aplicar(r)
      return r.novos ?? 0
    },

    enviarNovoEmail: (para, assunto, corpo) => api('/compose', 'POST', { para, assunto, corpo }).then(aplicar),

    marcarLido: id => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, lido: true } : t)) }))
      api(`/tickets/${id}/lido`).then(aplicar)
    },

    editarRascunho: (id, texto) => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, rascunho: texto } : t)) }))
      clearTimeout(debounces.current[id])
      debounces.current[id] = window.setTimeout(() => { api(`/tickets/${id}/rascunho`, 'POST', { texto }) }, 800)
    },

    aprovarEnviar: (id, texto) => {
      clearTimeout(debounces.current[id])
      setState(s => ({
        ...s,
        tickets: s.tickets.map(t => (t.id === id ? { ...t, status: 'enviado', resposta: texto, respondidoEm: new Date().toISOString(), enviaEm: undefined } : t)),
      }))
      api(`/tickets/${id}/aprovar`, 'POST', { texto }).then(r => {
        if (r.erro) alert(r.erro)
        aplicar(r)
      })
    },

    moverPara: (id, status, motivo) => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, statusAnterior: t.status, status, enviaEm: undefined } : t)) }))
      api(`/tickets/${id}/mover`, 'POST', { status, motivo }).then(aplicar)
    },

    restaurar: id => api(`/tickets/${id}/restaurar`).then(aplicar),
    excluirDefinitivo: id => api(`/tickets/${id}`, 'DELETE').then(aplicar),

    addPolitica: (titulo, conteudo) => api('/politicas', 'POST', { titulo, conteudo }).then(aplicar),
    togglePolitica: id => api(`/politicas/${id}/toggle`).then(aplicar),
    removerPolitica: id => api(`/politicas/${id}`, 'DELETE').then(aplicar),
    addFaq: (pergunta, resposta) => api('/faqs', 'POST', { pergunta, resposta }).then(aplicar),
    toggleFaq: id => api(`/faqs/${id}/toggle`).then(aplicar),
    removerFaq: id => api(`/faqs/${id}`, 'DELETE').then(aplicar),
    instalarBiblioteca: () => api('/faqs/biblioteca').then(aplicar),
    preencherPoliticas: () => api('/politicas/sugeridas').then(aplicar),

    conectarShopify: () => api('/shopify/demo').then(aplicar),
    limparTudo: () => api('/reset').then(aplicar),

    testarEmail: async () => {
      const r = (await api('/email/testar')) as { state?: ServerState; status: StatusEmail }
      aplicar(r)
      return r.status
    },

    diagnosticarEmail: async () => {
      const r = (await api('/email/diagnostico')) as { state?: ServerState; diagnostico: Diagnostico }
      aplicar(r)
      return r.diagnostico
    },

    testarIA: async () => {
      const r = (await api('/ia/testar')) as { state?: ServerState; status: StatusIA }
      aplicar(r)
      return r.status
    },

    testarShopify: async () => {
      const r = (await api('/shopify/testar')) as { state?: ServerState; status: StatusShopify }
      aplicar(r)
      return r.status
    },

    desconectarShopify: () => api('/shopify/desconectar').then(aplicar),
  }), [state, carregado, tipsFechados])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
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
