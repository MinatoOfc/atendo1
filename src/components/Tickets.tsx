import { useEffect, useState } from 'react'
import {
  ArrowLeft, Check, Users, Shield, Trash2, RotateCcw, Clock, Sparkles, Send, AlertTriangle,
} from 'lucide-react'
import { useStore, nomeCategoria, nomeIdioma, tempoRelativo } from '../store'
import type { Ticket } from '../store'

export function TicketRow({ t, onOpen }: { t: Ticket; onOpen: (t: Ticket) => void }) {
  return (
    <button className="ticket-row" onClick={() => onOpen(t)}>
      <span className={'dot' + (t.lido ? ' read' : '')} />
      <span className="from">
        {t.nome}
        <div className="email">{t.de}</div>
      </span>
      <span className="subject">
        <b>{t.assunto}</b>{' '}
        <span className="preview">— {(t.resposta ?? t.corpo).slice(0, 90)}</span>
      </span>
      {t.enviaEm && <CountdownPill ate={t.enviaEm} />}
      <span className={`tag tag-${t.categoria}`}>{nomeCategoria[t.categoria]}</span>
      <span className="when">{tempoRelativo(t.data)}</span>
    </button>
  )
}

export function CountdownPill({ ate }: { ate: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const i = setInterval(() => force(x => x + 1), 1000)
    return () => clearInterval(i)
  }, [])
  const resta = Math.max(0, Math.floor((ate - Date.now()) / 1000))
  if (resta === 0) return <span className="timer-pill"><Send size={11} /> enviando…</span>
  const mm = String(Math.floor(resta / 60)).padStart(2, '0')
  const ss = String(resta % 60).padStart(2, '0')
  return <span className="timer-pill"><Clock size={12} /> envia em {mm}:{ss}</span>
}

export function TicketDetail({ t, onBack }: { t: Ticket; onBack: () => void }) {
  const { aprovarEnviar, editarRascunho, moverPara, restaurar, excluirDefinitivo, marcarLido, config } = useStore()
  const [texto, setTexto] = useState(t.rascunho ?? '')

  useEffect(() => { if (!t.lido) marcarLido(t.id) }, [t.id])

  const emFluxo = t.status === 'inbox' || t.status === 'aprovacao' || t.status === 'humano'

  return (
    <div className="content-narrow">
      <button className="btn btn-sm mb-16" onClick={onBack}><ArrowLeft size={14} /> Voltar</button>

      <div className="row gap-10 mb-12" style={{ flexWrap: 'wrap' }}>
        <h1 className="h2">{t.assunto}</h1>
        <span className={`tag tag-${t.categoria}`}>{nomeCategoria[t.categoria]}</span>
        <span className="tag tag-outro">{nomeIdioma[t.idioma] ?? t.idioma}</span>
        {t.confianca !== undefined && (
          <span className={'tag ' + (t.confianca >= 0.8 ? 'tag-green' : t.confianca >= 0.55 ? 'tag-amber' : 'tag-reembolso')}>
            confiança {Math.round(t.confianca * 100)}%
          </span>
        )}
        {t.enviaEm && <CountdownPill ate={t.enviaEm} />}
      </div>

      {t.motivoEscalada && t.status === 'humano' && (
        <div className="banner card-purple mb-12"><Users size={15} color="var(--purple)" /> <b>Sinalizado para você:</b> {t.motivoEscalada}</div>
      )}

      {t.erroEnvio && (
        <div className="banner mb-12" style={{ borderColor: '#fecaca', background: '#fef7f7', alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="var(--red)" style={{ marginTop: 2 }} />
          <span>
            <b>O envio falhou{t.tentativasEnvio ? ` (tentativa ${t.tentativasEnvio})` : ''}:</b> {t.erroEnvio}
          </span>
        </div>
      )}

      {t.corpo && (
        <div className="detail-msg">
          <div className="head">
            <span><b style={{ color: 'var(--text)' }}>{t.nome}</b> &lt;{t.de}&gt;</span>
            <span>{new Date(t.data).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{t.corpo}</div>
        </div>
      )}

      {t.status === 'enviado' && t.resposta && (
        <div className="detail-msg" style={{ background: '#fbf9f5' }}>
          <div className="head">
            <span><Send size={12} style={{ marginRight: 6 }} /><b style={{ color: 'var(--text)' }}>Você respondeu</b></span>
            <span>{t.respondidoEm && new Date(t.respondidoEm).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{t.resposta}</div>
        </div>
      )}

      {emFluxo && t.rascunho !== undefined && (
        <div className="draft-box">
          <div className="row gap-8 mb-12">
            <Sparkles size={15} color="var(--purple)" />
            <span className="h3" style={{ color: 'var(--purple)' }}>Resposta sugerida</span>
            <span className="muted-sm">
              {t.geradoPorIA ? 'gerada pelo Claude a partir das suas políticas e do pedido' : 'gerada por regras — conecte a IA nas Configurações'}
            </span>
          </div>
          <textarea value={texto} onChange={e => { setTexto(e.target.value); editarRascunho(t.id, e.target.value) }} />
          <div className="row gap-8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { aprovarEnviar(t.id, texto); onBack() }}>
              <Check size={14} /> Aprovar e enviar
            </button>
            {t.status !== 'humano' && (
              <button className="btn" onClick={() => { moverPara(t.id, 'humano', 'Escalado manualmente por você'); onBack() }}>
                <Users size={14} /> Escalar para mim
              </button>
            )}
            <button className="btn" onClick={() => { moverPara(t.id, 'spam'); onBack() }}><Shield size={14} /> Spam</button>
            <button className="btn btn-danger" onClick={() => { moverPara(t.id, 'lixeira'); onBack() }}><Trash2 size={14} /> Excluir</button>
          </div>
        </div>
      )}

      {(t.status === 'spam' || t.status === 'lixeira') && (
        <div className="row gap-8">
          <button className="btn" onClick={() => { restaurar(t.id); onBack() }}><RotateCcw size={14} /> Restaurar</button>
          {t.status === 'lixeira' && (
            <button className="btn btn-danger" onClick={() => { excluirDefinitivo(t.id); onBack() }}><Trash2 size={14} /> Excluir definitivamente</button>
          )}
          {t.status === 'spam' && (
            <button className="btn btn-danger" onClick={() => { moverPara(t.id, 'lixeira'); onBack() }}><Trash2 size={14} /> Mover para a lixeira</button>
          )}
        </div>
      )}
    </div>
  )
}

export function TicketListPage({ tickets, empty, header }: {
  tickets: Ticket[]
  empty: React.ReactNode
  header?: React.ReactNode
}) {
  const [aberto, setAberto] = useState<string | null>(null)
  const atual = tickets.find(t => t.id === aberto)

  if (atual) return <TicketDetail t={atual} onBack={() => setAberto(null)} />

  return (
    <div>
      {header}
      {tickets.length === 0 ? empty : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {tickets.map(t => <TicketRow key={t.id} t={t} onOpen={x => setAberto(x.id)} />)}
        </div>
      )}
    </div>
  )
}
