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
  // Quando true, reembolsos e casos sensíveis sempre esperam aprovação humana
  escalarSensiveis: true,
  // Abaixo desta confiança a resposta espera aprovação em vez de sair sozinha
  confiancaMinima: 0.55,
  assinatura: 'Equipe de atendimento',
}

export const estadoInicial = {
  tickets: [],
  politicas: [],
  faqs: [],
  pedidos: [],
  produtos: [],
  config: { ...configPadrao },
  emailsProcessados: [], // message-ids já transformados em ticket
  // Credencial obtida via OAuth da Shopify. NUNCA é enviada ao frontend.
  shopify: { loja: null, token: null, instaladoEm: null },
}

export function carregar() {
  let raw
  try {
    raw = fs.readFileSync(FILE, 'utf8')
  } catch {
    return structuredClone(estadoInicial) // primeira execução: arquivo ainda não existe
  }
  try {
    // remove BOM, que alguns editores adicionam e faz o JSON.parse falhar
    const s = JSON.parse(raw.replace(/^﻿/, ''))
    return { ...estadoInicial, ...s, config: { ...configPadrao, ...s.config } }
  } catch (err) {
    // Nunca descartar dados em silêncio: preserva o arquivo ilegível para inspeção
    const backup = `${FILE}.corrompido-${Date.now()}`
    try { fs.copyFileSync(FILE, backup) } catch {}
    console.error(`[store] ${FILE} está ilegível (${err.message}). Uma cópia foi salva em ${backup} e o app começou com o estado vazio.`)
    return structuredClone(estadoInicial)
  }
}

export function salvar(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2))
}

let seq = Date.now()
export const uid = () => (seq++).toString(36)
