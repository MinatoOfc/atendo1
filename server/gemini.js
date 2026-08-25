/**
 * Integração com o Google Gemini (Flash) para teste A/B por loja: a loja com
 * iaModelo="gemini" responde por aqui, as demais seguem no Claude. Usa o MESMO
 * prompt do Claude (montarSystem + contexto do ticket) e devolve o mesmo JSON,
 * então a comparação de qualidade e custo é justa.
 */

// trim: um espaço acidental no valor da env não pode quebrar a autenticação
const CHAVE = (process.env.GEMINI_API_KEY || '').trim()
export const geminiConfigurado = !!CHAVE
const MODELO = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim()

// Preço por milhão de tokens (entrada, saída) — para o contador de custo por conversa
const PRECOS = {
  'gemini-2.5-flash': [0.3, 2.5],
}

// Mesmo formato do SCHEMA do Claude, na sintaxe de schema do Gemini
const SCHEMA_GEMINI = {
  type: 'OBJECT',
  properties: {
    situacao: { type: 'STRING', description: 'Resumo de UMA frase, em português, do que o cliente quer nesta conversa' },
    resolucao: { type: 'STRING', description: 'UMA frase curta, em português, do que esta resposta resolve (ex.: "Reembolso de 100% aprovado"); vazia se spam' },
    categoria: { type: 'STRING', enum: ['rastreio', 'reembolso', 'troca', 'produto', 'entrega', 'outro'] },
    idioma: { type: 'STRING', description: 'Código ISO 639-1 do idioma do cliente, ex.: pt, en, it, de, fr, es, nl' },
    resposta: { type: 'STRING', description: 'Resposta completa ao cliente; vazia se spam=true' },
    confianca: { type: 'NUMBER' },
    escalar_humano: { type: 'BOOLEAN' },
    aprova_reembolso: { type: 'BOOLEAN', description: 'true só quando o próximo passo é aprovar/confirmar um reembolso (cliente já escolheu ou exige); oferecer opções é false' },
    confirma_troca: { type: 'BOOLEAN', description: 'true só quando o cliente já aceitou a troca (informou tamanho/cor); oferecer a troca é false' },
    encerrar: { type: 'BOOLEAN', description: 'true quando a mensagem nao pede resposta nem acao (agradecimento, "tudo certo"); com qualquer pergunta ou pendencia, false' },
    motivo: { type: 'STRING', description: 'Sempre em português; vazio se nada a sinalizar' },
    spam: { type: 'BOOLEAN' },
  },
  required: ['situacao', 'resolucao', 'categoria', 'idioma', 'resposta', 'confianca', 'escalar_humano', 'aprova_reembolso', 'confirma_troca', 'encerrar', 'motivo', 'spam'],
}

/** Gera a resposta estruturada pelo Gemini. Retorna { r, custo } ou lança erro. */
export async function gerarComGemini(system, user) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${CHAVE}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA_GEMINI,
          maxOutputTokens: 2048,
          // desliga o "pensamento" do 2.5 Flash — mais barato e suficiente aqui
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  )
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '')
    throw new Error(`O Gemini respondeu ${resp.status}: ${corpo.slice(0, 200)}`)
  }
  const dados = await resp.json()
  const texto = (dados.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!texto) throw new Error('O Gemini respondeu sem conteúdo (possível bloqueio de segurança).')
  const r = JSON.parse(texto)
  const uso = dados.usageMetadata ?? {}
  const [entrada, saida] = PRECOS[MODELO] ?? [0.3, 2.5]
  const custo = ((uso.promptTokenCount || 0) * entrada
    + ((uso.candidatesTokenCount || 0) + (uso.thoughtsTokenCount || 0)) * saida) / 1e6
  return { r, custo }
}
