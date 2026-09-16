// globalTeardown do Playwright: encerra o servidor de ensaio de forma determinística
// (POST /encerrar na porta de controle) e só devolve quando a porta 8798 parou de
// responder. Assim `npm run test:visual` termina sozinho, sem processo pendurado.
import { connect } from 'node:net'

const CONTROLE = Number(process.env.PORT_VISUAL_CONTROLE || 8796)
const PORTA = Number(process.env.PORT_VISUAL || 8798)
const portaAberta = porta => new Promise(resolve => {
  const s = connect({ port: porta, host: '127.0.0.1' })
  s.once('connect', () => { s.destroy(); resolve(true) })
  s.once('error', () => resolve(false))
  s.setTimeout(500, () => { s.destroy(); resolve(false) })
})

export default async function encerrarServidorDeEnsaio() {
  try { await fetch(`http://127.0.0.1:${CONTROLE}/encerrar`, { method: 'POST', signal: AbortSignal.timeout(3000) }) } catch { /* já encerrado */ }
  for (let i = 0; i < 40; i++) { if (!(await portaAberta(PORTA)) && !(await portaAberta(CONTROLE))) return; await new Promise(r => setTimeout(r, 250)) }
  const estados = await Promise.all([PORTA, CONTROLE].map(p => portaAberta(p)))
  const abertas = [PORTA, CONTROLE].filter((_, i) => estados[i])
  throw new Error(`[visual] o servidor de ensaio continua escutando (${PORTA}/${CONTROLE}) depois do encerramento — portas ainda abertas: ${abertas.join(', ')}`)
}
