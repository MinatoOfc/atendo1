/**
 * Modos de atendimento.
 *
 * "classico" é o atendimento que roda hoje: fluxo de devolução em 5 etapas
 * (perguntar o motivo → oferecer troca → oferecer 60%/100% → escalar a decisão),
 * com as travas que impedem a IA de confirmar reembolso ou troca sozinha.
 *
 * "novo" é a reformulação em desenho. Enquanto REGRAS_NOVO estiver vazio, o
 * modo novo se comporta EXATAMENTE como o clássico — a troca no painel não
 * muda nada até as regras novas existirem. Nada do clássico é apagado: os dois
 * convivem, e cada loja escolhe o seu.
 */

export const MODOS_ATENDIMENTO = {
  classico: 'Clássico — o atendimento atual',
  novo: 'Novo — em construção',
}

/** Modo de uma loja, com o clássico como padrão para quem nunca escolheu. */
export const modoDaLoja = loja => (loja?.modoAtendimento === 'novo' ? 'novo' : 'classico')

/**
 * Regras do atendimento NOVO — substituem o fluxo de devolução do clássico
 * dentro do prompt. Cada item vira uma linha das instruções da IA.
 * Vazio de propósito: é aqui que a reformulação vai ser escrita.
 */
export const REGRAS_NOVO = []

/** true quando o modo novo já tem regras próprias para valer. */
export const novoEmVigor = () => REGRAS_NOVO.length > 0
