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

export const lojaPadrao = (id, nome) => ({
  id,
  nome,
  ativa: id === 'loja1',
  moeda: 'EUR',
  // Credencial obtida via OAuth da Shopify. NUNCA é enviada ao frontend.
  shopify: { loja: null, token: null, instaladoEm: null },
})

export const estadoInicial = {
  tickets: [],
  politicas: [],
  faqs: [],
  pedidos: [],
  produtos: [],
  config: { ...configPadrao },
  emailsProcessados: [], // message-ids já transformados em ticket
  lojas: [lojaPadrao('loja1', 'minha loja'), lojaPadrao('loja2', 'segunda loja')],
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
    const estado = { ...estadoInicial, ...s, config: { ...configPadrao, ...s.config } }

    // Migração do formato de loja única para multi-loja: os dados antigos
    // (shopify, moeda, nome) passam a pertencer à loja 1.
    if (!Array.isArray(s.lojas) || !s.lojas.length) {
      estado.lojas = [lojaPadrao('loja1', s.config?.nomeLoja || 'minha loja'), lojaPadrao('loja2', 'segunda loja')]
      if (s.shopify?.token) estado.lojas[0].shopify = s.shopify
      if (s.moedaLoja) estado.lojas[0].moeda = s.moedaLoja
    } else {
      estado.lojas = s.lojas.map((l, i) => ({ ...lojaPadrao(`loja${i + 1}`, l.nome || `loja ${i + 1}`), ...l }))
      while (estado.lojas.length < 2) estado.lojas.push(lojaPadrao(`loja${estado.lojas.length + 1}`, 'segunda loja'))
    }
    delete estado.shopify
    delete estado.moedaLoja
    // todo ticket/pedido/produto antigo pertence à loja 1
    for (const t of estado.tickets) if (!t.lojaId) t.lojaId = 'loja1'
    for (const p of estado.pedidos) if (!p.lojaId) p.lojaId = 'loja1'
    for (const p of estado.produtos ?? []) if (!p.lojaId) p.lojaId = 'loja1'
    return estado
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
