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
  erroEnvio?: string
  tentativasEnvio?: number
  lojaId?: string
  historico?: { autor: 'cliente' | 'atendo'; corpo: string; data: string; traducao?: string }[]
  resumoSituacao?: string
  custoIA?: number
  iaPausada?: boolean
  traducao?: string
}

export interface Politica { id: string; titulo: string; conteudo: string; ativa: boolean }
export interface Comportamento { id: string; situacao: string; instrucao: string; ativa: boolean }
export interface Faq { id: string; pergunta: string; resposta: string; ativa: boolean }

export interface Produto {
  id: string; titulo: string; tipo: string; marca: string; tags: string[]
  precoMin: number; precoMax: number; estoque: number; ativo: boolean
  variantes: string[]; url: string; descricao: string; lojaId?: string
}

export interface Pedido {
  id: string; numero: string; cliente: string; email: string; pais: string
  valor: number; status: 'aguardando' | 'transito' | 'entregue' | 'problema'
  rastreio: string; criadoEm: string; lojaId?: string
  urlRastreio?: string | null; transportadora?: string | null
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

export interface StatusEmail {
  ok: boolean | null; erro: string | null; verificadoEm: string | null
  envioPorApi?: boolean; remetente?: string | null
  envio?: { ok: boolean | null; erro: string | null; via?: string; porta?: number; aviso?: string }
}

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

export interface Loja {
  id: string
  nome: string
  ativa: boolean
  moeda: string
  email: {
    configurado: boolean; endereco: string | null; status: StatusEmail | null
    provider?: string | null; remetenteNome?: string | null; origem?: 'site' | 'env' | null
  }
  shopify: {
    conectada: boolean; dominio: string | null; modo: 'token' | 'oauth' | null; status: StatusShopify | null
    oauthDisponivel?: boolean; appProprio?: boolean; appClientId?: string | null
  }
}

export interface Usuario { id: string; nome: string; email: string }

/** Preferências deste dispositivo (ficam no navegador, não no servidor). */
export interface Prefs {
  tema: 'claro' | 'escuro'
  densidade: 'confortavel' | 'compacto'
  mostrarPreview: boolean
  moedaExibicao: 'loja' | 'USD' | 'EUR' | 'BRL'
  tamanhoFonte: 'pequeno' | 'padrao' | 'grande'
}

const prefsPadrao: Prefs = {
  tema: 'claro', densidade: 'confortavel', mostrarPreview: true,
  moedaExibicao: 'loja', tamanhoFonte: 'padrao',
}

export interface ConfigEmail {
  provider?: string; user: string; pass: string
  from?: string; remetenteNome?: string
  imapHost?: string; smtpHost?: string; imapPort?: number; smtpPort?: number
}

export interface ResultadoTesteEmail {
  ok: boolean
  leitura?: { ok: boolean | null; erro: string | null }
  envio?: { ok: boolean | null; erro: string | null; via?: string }
  erro?: string
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
  comportamentos?: Comportamento[]
  faqs: Faq[]
  pedidos: Pedido[]
  produtos: Produto[]
  moeda: string
  lojas: Loja[]
  provedoresEmail?: string[]
  cotacoes?: Record<string, number> | null
  escoposShopify?: string
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
  tickets: [], politicas: [], faqs: [], pedidos: [], produtos: [], moeda: 'EUR', lojas: [],
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
  usuario: Usuario | null
  autenticando: boolean
  entrar: (email: string, senha: string) => Promise<string | null>
  registrar: (nome: string, email: string, senha: string) => Promise<string | null>
  sair: () => void
  atualizarConta: (dados: { nome?: string; senhaAtual?: string; novaSenha?: string }) => Promise<string | null>
  salvarEmailLoja: (lojaId: string, cfg: ConfigEmail) => Promise<string | null>
  removerEmailLoja: (lojaId: string) => void
  testarEmailConfig: (cfg: ConfigEmail) => Promise<ResultadoTesteEmail>
  salvarShopifyApp: (lojaId: string, clientId: string, clientSecret: string) => Promise<string | null>
  removerShopifyApp: (lojaId: string) => void
  conectarShopifyToken: (lojaId: string, dominio: string, token: string) => Promise<string | null>
  prefs: Prefs
  setPref: (patch: Partial<Prefs>) => void
  /** Formata um valor na moeda de exibição preferida (converte pela cotação do dia). */
  fmtMoeda: (v: number, moedaOrigem?: string) => string
  /** 'todas' ou o id da loja selecionada na seta do topo da barra lateral */
  lojaAtiva: string
  setLojaAtiva: (id: string) => void
  lojasVisiveis: Loja[]
  atualizarLoja: (id: string, patch: { nome?: string; ativa?: boolean }) => void
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
  addComportamento: (situacao: string, instrucao: string) => void
  toggleComportamento: (id: string) => void
  removerComportamento: (id: string) => void
  addFaq: (pergunta: string, resposta: string) => void
  toggleFaq: (id: string) => void
  removerFaq: (id: string) => void
  instalarBiblioteca: () => void
  preencherPoliticas: () => void
  conectarShopify: () => void
  limparTudo: () => void
  testarEmail: (lojaId?: string) => Promise<StatusEmail>
  diagnosticarEmail: (lojaId?: string) => Promise<Diagnostico>
  testarIA: () => Promise<StatusIA>
  testarShopify: (lojaId?: string) => Promise<StatusShopify>
  desconectarShopify: (lojaId?: string) => void
  pausarIA: (id: string, pausar: boolean) => void
  traduzirTicket: (id: string) => Promise<boolean>
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
  const [lojaAtiva, setLojaAtivaState] = useState<string>(() => localStorage.getItem('atendo-loja-ativa') ?? 'todas')
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [autenticando, setAutenticando] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...prefsPadrao, ...JSON.parse(localStorage.getItem('atendo-prefs') ?? '{}') } } catch { return prefsPadrao }
  })
  const debounces = useRef<Record<string, number>>({})

  // aplica tema e tamanho da fonte no documento
  useEffect(() => {
    localStorage.setItem('atendo-prefs', JSON.stringify(prefs))
    document.documentElement.dataset.theme = prefs.tema === 'escuro' ? 'dark' : ''
    const zoom = { pequeno: '0.92', padrao: '1', grande: '1.08' }[prefs.tamanhoFonte]
    ;(document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = zoom
  }, [prefs])

  useEffect(() => { localStorage.setItem(TIPS_KEY, JSON.stringify(tipsFechados)) }, [tipsFechados])

  const aplicar = (r: { state?: ServerState; usuario?: Usuario }) => {
    if (r.state) setState(r.state)
    if (r.usuario) setUsuario(r.usuario)
  }

  // sessão inicial + polling (pega envios automáticos e e-mails novos do servidor)
  useEffect(() => {
    let ativo = true
    const buscar = async () => {
      try {
        const resp = await fetch('/api/me')
        if (resp.status === 401) { if (ativo) { setUsuario(null); setAutenticando(false) } return }
        const r = await resp.json()
        if (ativo) { aplicar(r); setCarregado(true); setAutenticando(false) }
      } catch { /* servidor fora do ar — tenta de novo no próximo tique */ }
    }
    buscar()
    const i = setInterval(buscar, 10_000)
    return () => { ativo = false; clearInterval(i) }
  }, [])

  const autenticar = async (rota: string, corpo: unknown): Promise<string | null> => {
    try {
      const resp = await fetch(`/api${rota}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      })
      const r = await resp.json()
      if (!resp.ok) return r.erro ?? 'Não foi possível entrar.'
      aplicar(r)
      setCarregado(true)
      return null
    } catch {
      return 'Servidor fora do ar. Tente novamente.'
    }
  }

  const store = useMemo<Store>(() => {
    const lojasVisiveis = state.lojas.filter(l => l.ativa)
    // Com uma loja específica selecionada, todas as listas do app são filtradas;
    // em "todas as lojas" a caixa é unificada.
    const daLoja = <T extends { lojaId?: string }>(x: T) =>
      lojaAtiva === 'todas' || (x.lojaId ?? 'loja1') === lojaAtiva
    const tickets = state.tickets.filter(daLoja)
    const pedidos = state.pedidos.filter(daLoja)
    const produtos = state.produtos.filter(daLoja)
    const lojaSel = state.lojas.find(l => l.id === lojaAtiva)
    const moedaLoja = lojaSel?.moeda ?? state.moeda

    // Moeda de exibição: converte pela cotação do dia (BCE); sem cotação
    // disponível, mostra na moeda da loja mesmo.
    const fmtMoeda = (v: number, origem: string = moedaLoja) => {
      const alvo = prefs.moedaExibicao
      const taxas = state.cotacoes
      if (alvo === 'loja' || alvo === origem || !taxas || !taxas[alvo] || !taxas[origem]) {
        return formatarMoeda(origem)(v)
      }
      return formatarMoeda(alvo)((v / taxas[origem]) * taxas[alvo])
    }

    return {
    ...state,
    tickets,
    pedidos,
    produtos,
    moeda: moedaLoja,
    carregado,
    tipsFechados,
    usuario,
    autenticando,
    prefs,
    setPref: patch => setPrefs(p => ({ ...p, ...patch })),
    fmtMoeda,
    entrar: (email, senha) => autenticar('/login', { email, senha }),
    registrar: (nome, email, senha) => autenticar('/registrar', { nome, email, senha }),
    sair: () => {
      fetch('/api/logout', { method: 'POST' }).finally(() => {
        setUsuario(null)
        setState(estadoVazio)
      })
    },
    atualizarConta: async dados => {
      const resp = await fetch('/api/conta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
      })
      const r = await resp.json()
      if (!resp.ok) return r.erro ?? 'Não foi possível salvar.'
      aplicar(r)
      return null
    },
    salvarEmailLoja: async (lojaId, cfg) => {
      const r = await api(`/lojas/${lojaId}/email`, 'POST', cfg)
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    removerEmailLoja: lojaId => api(`/lojas/${lojaId}/email`, 'DELETE').then(aplicar),
    salvarShopifyApp: async (lojaId, clientId, clientSecret) => {
      const r = await api(`/lojas/${lojaId}/shopify-app`, 'POST', { clientId, clientSecret })
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    removerShopifyApp: lojaId => api(`/lojas/${lojaId}/shopify-app`, 'DELETE').then(aplicar),
    conectarShopifyToken: async (lojaId, dominio, token) => {
      const r = await api(`/lojas/${lojaId}/shopify-token`, 'POST', { dominio, token })
      if (r.erro) return r.erro
      aplicar(r)
      return null
    },
    testarEmailConfig: async cfg => {
      const r = (await api('/email/testar-config', 'POST', cfg)) as unknown as { resultado: ResultadoTesteEmail }
      return r.resultado ?? { ok: false, erro: 'Sem resposta do servidor.' }
    },
    lojaAtiva,
    lojasVisiveis,
    setLojaAtiva: id => { setLojaAtivaState(id); localStorage.setItem('atendo-loja-ativa', id) },
    atualizarLoja: (id, patch) => {
      setState(s => ({ ...s, lojas: s.lojas.map(l => (l.id === id ? { ...l, ...patch } : l)) }))
      api('/lojas', 'POST', { id, ...patch }).then(aplicar)
    },
    naoLidos: tickets.filter(t => ['inbox', 'aprovacao', 'humano'].includes(t.status) && !t.lido).length,
    aguardandoAprovacao: tickets.filter(t => t.status === 'aprovacao'),
    casosHumanos: tickets.filter(t => t.status === 'humano'),

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
    addComportamento: (situacao, instrucao) => api('/comportamentos', 'POST', { situacao, instrucao }).then(aplicar),
    toggleComportamento: id => api(`/comportamentos/${id}/toggle`).then(aplicar),
    removerComportamento: id => api(`/comportamentos/${id}`, 'DELETE').then(aplicar),
    addFaq: (pergunta, resposta) => api('/faqs', 'POST', { pergunta, resposta }).then(aplicar),
    toggleFaq: id => api(`/faqs/${id}/toggle`).then(aplicar),
    removerFaq: id => api(`/faqs/${id}`, 'DELETE').then(aplicar),
    instalarBiblioteca: () => api('/faqs/biblioteca').then(aplicar),
    preencherPoliticas: () => api('/politicas/sugeridas').then(aplicar),

    conectarShopify: () => api('/shopify/demo').then(aplicar),
    limparTudo: () => api('/reset').then(aplicar),

    testarEmail: async (lojaId = 'loja1') => {
      const r = (await api(`/email/testar?loja=${lojaId}`)) as { state?: ServerState; status: StatusEmail }
      aplicar(r)
      return r.status
    },

    diagnosticarEmail: async (lojaId = 'loja1') => {
      const r = (await api(`/email/diagnostico?loja=${lojaId}`)) as { state?: ServerState; diagnostico: Diagnostico }
      aplicar(r)
      return r.diagnostico
    },

    testarIA: async () => {
      const r = (await api('/ia/testar')) as { state?: ServerState; status: StatusIA }
      aplicar(r)
      return r.status
    },

    testarShopify: async (lojaId = 'loja1') => {
      const r = (await api(`/shopify/testar?lojaId=${lojaId}`)) as { state?: ServerState; status: StatusShopify }
      aplicar(r)
      return r.status
    },

    desconectarShopify: (lojaId = 'loja1') => api('/shopify/desconectar', 'POST', { lojaId }).then(aplicar),

    pausarIA: (id, pausar) => {
      setState(s => ({ ...s, tickets: s.tickets.map(t => (t.id === id ? { ...t, iaPausada: pausar, enviaEm: pausar ? undefined : t.enviaEm } : t)) }))
      api(`/tickets/${id}/pausar-ia`, 'POST', { pausar }).then(aplicar)
    },

    traduzirTicket: async id => {
      const r = await api(`/tickets/${id}/traduzir`)
      if (r.erro) { alert(r.erro); return false }
      aplicar(r)
      return true
    },
    }
  }, [state, carregado, tipsFechados, lojaAtiva, usuario, autenticando, prefs])

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

export function formatarMoeda(moeda: string): (v: number) => string {
  try {
    const f = new Intl.NumberFormat('de-DE', { style: 'currency', currency: moeda || 'EUR' })
    return v => f.format(v)
  } catch {
    return v => `${moeda} ${v.toFixed(2)}`
  }
}

export function saudacaoDia(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}
