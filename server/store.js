import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const FILE = path.join(DATA_DIR, 'atendo.json')

export const configPadrao = {
  nomeLoja: 'minha loja',
  emailConectado: null, // conexão de demonstração; a real vem por env var
  shopifyConectada: false, // demonstração; a real vem por env var
  tomDetectado: false,
  automacaoAtiva: false,
  atrasoMinutos: 3,
  assinatura: 'Equipe de atendimento',
}

export const estadoInicial = {
  tickets: [],
  politicas: [],
  faqs: [],
  pedidos: [],
  config: { ...configPadrao },
  emailsProcessados: [], // message-ids já transformados em ticket
}

export function carregar() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8')
    const s = JSON.parse(raw)
    return { ...estadoInicial, ...s, config: { ...configPadrao, ...s.config } }
  } catch {
    return structuredClone(estadoInicial)
  }
}

export function salvar(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2))
}

let seq = Date.now()
export const uid = () => (seq++).toString(36)
