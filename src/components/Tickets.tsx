import { useEffect, useState } from 'react'
import {
  ArrowLeft, Check, Users, Shield, Trash2, RotateCcw, Clock, Sparkles, Send, AlertTriangle, Languages,
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
      {t.historico && t.historico.length > 0 && <span className="tag tag-outro">conversa</span>}
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

const rotuloStatus: Record<string, string> = {
  inbox: 'Aguardando primeira resposta',
  aprovacao: 'Aguardando sua aprovação',
  humano: 'Aguardando sua decisão',
  enviado: 'Respondida',
  spam: 'Marcada como spam',
  lixeira: 'Na lixeira',
}

export function TicketDetail({ t, onBack }: { t: Ticket; onBack: () => void }) {
  const { aprovarEnviar, editarRascunho, moverPara, restaurar, excluirDefinitivo, marcarLido, pausarIA, traduzirTicket, config } = useStore()
  const [texto, setTexto] = useState(t.rascunho ?? '')
  const [resumoAberto, setResumoAberto] = useState(true)
  const [verTraducao, setVerTraducao] = useState(false)
  const [traduzindo, setTraduzindo] = useState(false)

  useEffect(() => { if (!t.lido) marcarLido(t.id) }, [t.id])

  const emFluxo = t.status === 'inbox' || t.status === 'aprovacao' || t.status === 'humano'

  const respostasEnviadas = (t.historico?.filter(m => m.autor === 'atendo').length ?? 0) + (t.resposta ? 1 : 0)
  const iaJaFez = respostasEnviadas > 0
    ? `${respostasEnviadas} resposta${respostasEnviadas > 1 ? 's' : ''} enviada${respostasEnviadas > 1 ? 's' : ''}`
    : t.rascunho ? 'Rascunho pronto, aguardando envio' : 'Ainda sem resposta'
  const statusTexto = t.status === 'aprovacao' && t.enviaEm ? 'Envio automático agendado' : (rotuloStatus[t.status] ?? t.status)

  const alternarTraducao = async () => {
    if (!t.traducao) {
      setTraduzindo(true)
      const ok = await traduzirTicket(t.id)
      setTraduzindo(false)
      if (!ok) return
    }
    setVerTraducao(v => !v)
  }

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
        {t.enviaEm && !t.iaPausada && <CountdownPill ate={t.enviaEm} />}
        {t.historico && t.historico.length > 0 && <span className="tag tag-outro">conversa</span>}
      </div>

      {/* Resumo da conversa */}
      <div className="card-soft mb-12" style={{ padding: '14px 16px' }}>
        <div className="row spread">
          <b style={{ fontSize: 13.5 }}>Resumo da conversa</b>
          <button className="btn-ghost btn-sm" onClick={() => setResumoAberto(a => !a)}>{resumoAberto ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        {resumoAberto && (
          <div style={{ marginTop: 8, display: 'grid', gap: 5, fontSize: 13, lineHeight: 1.55 }}>
            <div><b>Situação:</b> <span className="muted">{t.resumoSituacao ?? `${nomeCategoria[t.categoria]} — ${t.assunto}`}</span></div>
            <div><b>IA já fez:</b> <span className="muted">{iaJaFez}</span></div>
            <div><b>Status:</b> <span className="muted">{statusTexto}</span></div>
            <div><b>Custo da IA nesta conversa:</b> <span className="muted">US$ {(t.custoIA ?? 0).toFixed(4)}</span></div>
          </div>
        )}
      </div>

      {/* Pausar / retomar a IA nesta conversa */}
      {t.status !== 'spam' && t.status !== 'lixeira' && (
        <div className="card mb-12" style={{ padding: '12px 16px' }}>
          <div className="row spread">
            <span style={{ fontWeight: 700, fontSize: 13.5, color: t.iaPausada ? 'var(--amber)' : 'var(--green)' }}>
              {t.iaPausada ? 'IA pausada' : 'IA ativa'}
            </span>
            <button className={'btn btn-sm' + (t.iaPausada ? ' btn-primary' : '')} onClick={() => pausarIA(t.id, !t.iaPausada)}>
              {t.iaPausada ? 'Retomar IA' : 'Pausar IA'}
            </button>
          </div>
          <p className="muted-sm" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Quando pausada, a IA não responde esta conversa automaticamente. Ela fica assim até você clicar em "Retomar IA".
          </p>
        </div>
      )}

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

      {t.historico?.map((m, i) => (
        <div key={i} className="detail-msg" style={{ opacity: 0.75, ...(m.autor === 'atendo' ? { background: 'var(--panel-soft)' } : {}) }}>
          <div className="head">
            <span>
              {m.autor === 'atendo' ? <Send size={12} style={{ marginRight: 6 }} /> : null}
              <b style={{ color: 'var(--text)' }}>{m.autor === 'atendo' ? 'Você respondeu' : t.nome}</b>
            </span>
            <span>{new Date(m.data).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{m.corpo}</div>
        </div>
      ))}

      {t.corpo && (
        <div className="detail-msg">
          <div className="head">
            <span><b style={{ color: 'var(--text)' }}>{t.nome}</b> &lt;{t.de}&gt;{t.historico?.length ? <span className="tag tag-purple" style={{ marginLeft: 8 }}>nova resposta</span> : null}</span>
            <span>{new Date(t.data).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{verTraducao && t.traducao ? t.traducao : t.corpo}</div>
          <div className="row spread" style={{ marginTop: 10 }}>
            <span className="muted-sm">
              {verTraducao && t.traducao ? 'Traduzido para português pela IA' : ''}
            </span>
            {t.idioma !== 'pt' && (
              <button className="btn btn-sm" onClick={alternarTraducao} disabled={traduzindo}>
                <Languages size={13} />
                {traduzindo ? 'Traduzindo…' : verTraducao && t.traducao ? 'Ver original' : 'Traduzir'}
              </button>
            )}
          </div>
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
