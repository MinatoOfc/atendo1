import { useState } from 'react'
import { AlertTriangle, Bot, Check, Clock, Languages, Mail, RefreshCw, Send, Users, X } from 'lucide-react'
import type { ConversaAuditoria } from '../../shared/auditoria.js'
import { useStore } from '../store'
import { Modal } from './Shared'

/**
 * "Revisar e enviar" — o primeiro clique NÃO envia: abre esta revisão.
 *
 * Duas regras que este arquivo existe para cumprir:
 *
 *  1. ENVIO: o botão "Confirmar envio" chama `aprovarEnviar`, o MESMO caminho
 *     da página Aprovações e da conversa. Não há fetch de envio aqui.
 *
 *  2. TRADUÇÃO: é só para você ler. Vai para um estado local, nunca para o
 *     campo editável, nunca para a conversa e nunca para o servidor de envio.
 *     Usa `traduzirTexto`, que bate na rota gratuita do Google e não grava nada.
 *
 * `base` é uma FOTOGRAFIA da conversa tirada quando você abriu a revisão. A
 * Auditoria se atualiza sozinha a cada 10 s; o que você está revisando, não.
 * É essa fotografia que volta ao servidor para ele conferir que nada mudou.
 */
export default function RevisarEnviar({ base, aoFechar, aoConcluir }: {
  base: ConversaAuditoria
  aoFechar: () => void
  aoConcluir: () => void
}) {
  const s = useStore()
  const e = base.envio
  const original = e.rascunho ?? ''
  // o campo editável começa SEMPRE com o texto original, no idioma do cliente
  const [texto, setTexto] = useState(original)
  const [editando, setEditando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [travado, setTravado] = useState(false) // a revisão venceu: só dá para fechar
  // tradução guardada POR TEXTO: o mesmo texto nunca é pedido duas vezes ao
  // Google, e um texto diferente nunca reaproveita tradução velha
  const [traducoes, setTraducoes] = useState<Record<string, { texto?: string; erro?: string }>>({})
  const [traduzindo, setTraduzindo] = useState<string | null>(null)

  // a mensagem atual do cliente; nas conversas com várias voltas ela já migrou
  // para o histórico, então cai para a última mensagem recebida
  const mensagemCliente = e.mensagemAtual
    ?? [...base.mensagens].reverse().find(m => m.situacao === 'recebida')?.corpo
    ?? ''
  const alterado = texto.trim() !== original.trim()
  const hora = (v?: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—')

  const traduzir = async (fonte: string) => {
    const chave = fonte.trim()
    if (!chave || traducoes[chave] || traduzindo) return
    setTraduzindo(chave)
    const r = await s.traduzirTexto(fonte)
    // falha do Google não bloqueia nada: avisa e mantém o original
    setTraducoes(t => ({ ...t, [chave]: r.traducao ? { texto: r.traducao } : { erro: 'Não foi possível traduzir' } }))
    setTraduzindo(null)
  }
  const traduzirTudo = async () => { await traduzir(mensagemCliente); await traduzir(original) }

  const Traducao = ({ fonte }: { fonte: string }) => {
    const t = traducoes[fonte.trim()]
    if (!t) return null
    return (
      <div className="muted-sm bloco-traducao">
        <b>Tradução — só para você conferir. O envio usa o texto original acima.</b>
        {t.erro ? <span style={{ color: 'var(--amber, #d29922)' }}>{t.erro}</span> : <span>{t.texto}</span>}
      </div>
    )
  }
  const BotaoTraduzir = ({ fonte, rotulo }: { fonte: string; rotulo: string }) => (
    <button className="btn-ghost btn-sm" disabled={!fonte.trim() || !!traducoes[fonte.trim()] || traduzindo === fonte.trim()}
      onClick={() => traduzir(fonte)}>
      <Languages size={12} /> {traduzindo === fonte.trim() ? 'traduzindo…' : rotulo}
    </button>
  )

  // a fotografia vem PRONTA do servidor e volta inteira: quem decide o que é
  // conferido é ele, não esta tela
  const esperado = e.esperado

  const confirmar = async () => {
    if (enviando || travado) return
    setEnviando(true); setAviso(null)
    // MESMO caminho oficial da página Aprovações — nada é duplicado aqui
    const r = await s.aprovarEnviar(base.ticketId, texto, false, 'ia', false, esperado)
    if (r.erro) {
      setAviso(r.erro)
      setTravado(!!r.desatualizado)
      setEnviando(false)
      return
    }
    aoConcluir()
  }

  const paraHumano = async () => {
    if (!confirm('Mover esta conversa para atendimento humano?' + String.fromCharCode(10, 10) + 'A IA para de classificar, escrever e enviar aqui. O rascunho atual deixa de valer (fica guardado nesta Auditoria) e qualquer envio agendado é cancelado. Nada é enviado ao cliente agora.')) return
    if (await s.moverParaHumano(base.ticketId, 'Movido por você pela revisão da Auditoria')) aoConcluir()
  }
  const gerarDeNovo = async () => {
    const instrucao = window.prompt('Gerar novamente. O que a IA deve corrigir? (opcional)')
    if (instrucao === null) return
    setEnviando(true)
    const erro = await s.regenerarRascunho(base.ticketId, instrucao.trim())
    setEnviando(false)
    if (erro) { setAviso(erro); return }
    // a resposta mudou: esta revisão não vale mais
    aoConcluir()
  }

  const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
    <div className="linha-revisao"><span className="muted-sm">{rotulo}</span><b>{valor}</b></div>
  )

  return (
    <Modal title="Revisar e enviar" onClose={aoFechar} fecharFora={false} classe="modal-revisao">
      <div className="grid-revisao">
        <section className="bloco-revisao">
          <Linha rotulo="cliente" valor={`${base.cliente} · ${base.email}`} />
          <Linha rotulo="pedido" valor={base.pedido ? `#${base.pedido}` : '—'} />
          <Linha rotulo="loja remetente" valor={`${base.loja}${e.canal.endereco ? ' · ' + e.canal.endereco : ''}`} />
          <Linha rotulo="fase" valor={base.faseTitulo ?? base.proximaPermitida ?? '—'} />
          <Linha rotulo="idioma" valor={base.idioma ?? '—'} />
          {(e.percentual != null || e.valor != null || e.cupom) && (
            <Linha rotulo="oferta" valor={[
              e.percentual != null ? `${e.percentual}%` : null,
              e.valor != null ? `${e.valor} ${base.moeda ?? ''}`.trim() : null,
              e.cupom ? `cupom ${e.cupom}` : null,
            ].filter(Boolean).join(' · ')} />
          )}
        </section>

        <section className="bloco-revisao">
          <div className="row spread gap-8" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12.5 }}>Mensagem atual do cliente</b>
            <BotaoTraduzir fonte={mensagemCliente} rotulo="Traduzir mensagem do cliente" />
          </div>
          <p className="corpo-auditoria">{mensagemCliente || '—'}</p>
          <Traducao fonte={mensagemCliente} />
        </section>

        <section className="bloco-revisao">
          <div className="row spread gap-8" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12.5 }}><Bot size={12} /> Texto que será enviado — original, no idioma do cliente</b>
            <div className="row gap-8">
              <BotaoTraduzir fonte={original} rotulo="Traduzir resposta da IA" />
              <button className="btn-ghost btn-sm" disabled={!!traduzindo} onClick={traduzirTudo}>
                <Languages size={12} /> Traduzir tudo
              </button>
            </div>
          </div>
          {editando ? (
            <textarea className="texto-revisao" value={texto} rows={9} onChange={ev => setTexto(ev.target.value)} />
          ) : (
            <p className="corpo-auditoria">{texto}</p>
          )}
          {alterado && (
            <div className="muted-sm" style={{ color: 'var(--amber, #d29922)' }}>
              <AlertTriangle size={11} /> Texto alterado por você — o servidor valida a etapa de novo antes de enviar.
            </div>
          )}
          {/* a tradução mostra SEMPRE o texto original: ela não segue a edição
              e nunca preenche o campo acima */}
          <Traducao fonte={original} />
        </section>

        {base.checklist && (
          <section className="bloco-revisao">
            <b style={{ fontSize: 12.5 }}>Checklist da resposta</b>
            <ul className="lista-revisao">
              {base.checklist.itens.map(i => (
                <li key={i.id} data-estado={i.estado}>{i.rotulo}{i.detalhe ? ` — ${i.detalhe}` : ''}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="bloco-revisao">
          <Linha rotulo="horário mínimo da cadência" valor={hora(e.minimoEnvio)} />
          <div className="linha-revisao">
            <span className="muted-sm"><Mail size={11} /> canal de e-mail</span>
            <b style={{ color: e.canal.configurado ? 'var(--green, #3fb950)' : 'var(--red, #f85149)' }}>
              {e.canal.configurado ? 'configurado na própria loja' : 'não configurado — o envio será recusado'}
            </b>
          </div>
        </section>

        {aviso && (
          <div className="banner" style={{ borderColor: 'var(--red, #f85149)', alignItems: 'flex-start' }}>
            <AlertTriangle size={14} color="var(--red, #f85149)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 200 }}>{aviso}</span>
          </div>
        )}

        <div className="row gap-8 acoes-revisao">
          {travado ? (
            <button className="btn btn-primary btn-sm" onClick={aoConcluir}><RefreshCw size={13} /> Fechar e atualizar</button>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" disabled={enviando || !texto.trim()} onClick={confirmar}>
                <Send size={13} /> {enviando ? 'Enviando…' : 'Confirmar envio'}
              </button>
              <button className="btn btn-sm" disabled={enviando || editando} onClick={() => setEditando(true)}>
                <Check size={13} /> Editar antes de enviar
              </button>
              <button className="btn btn-sm" disabled={enviando} onClick={gerarDeNovo}>
                <RefreshCw size={13} /> Gerar novamente
              </button>
              <button className="btn btn-sm" disabled={enviando} onClick={paraHumano}>
                <Users size={13} /> Mover para atendimento humano
              </button>
              <button className="btn-ghost btn-sm" disabled={enviando} onClick={aoFechar}><X size={13} /> Cancelar</button>
            </>
          )}
        </div>
        <p className="muted-sm" style={{ lineHeight: 1.45 }}>
          <Clock size={11} /> Nada sai agora por conta própria: o servidor confere de novo o rascunho, o ciclo,
          a tentativa e a mensagem do cliente no instante do envio. A tradução é só leitura e nunca é enviada.
        </p>
      </div>
    </Modal>
  )
}
