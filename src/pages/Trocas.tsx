import { useState } from 'react'
import { ArrowLeftRight, Check, Pencil, RotateCcw, Send, X } from 'lucide-react'
import { useStore } from '../store'
import { EmptyState } from '../components/Shared'

/**
 * Caderno de trocas aceitas: cada troca confirmada pelo cliente entra aqui
 * como pendente; o lojista despacha e marca "enviada". Registro automático
 * (quando a IA detecta a aceitação) ou manual, de dentro da conversa.
 */
export default function Trocas() {
  const s = useStore()
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null)
  // caixa de mensagem da troca: responde ao cliente dali mesmo
  const [respondendo, setRespondendo] = useState<{ id: string; texto: string } | null>(null)

  const lojaFiltro = s.lojaAtiva !== 'todas' ? s.lojaAtiva : null
  const nomeLoja = (id?: string) => s.lojas.find(l => l.id === (id ?? 'loja1'))?.nome ?? 'Loja'
  const todas = (s.trocas ?? []).filter(t => !lojaFiltro || (t.lojaId ?? 'loja1') === lojaFiltro)
  const pendentes = todas.filter(t => t.status === 'pendente')
  const enviadas = todas.filter(t => t.status === 'enviada')
  const multiLoja = s.lojasVisiveis.length > 1

  const linha = (t: (typeof todas)[number]) => (
    <div key={t.id} className="card-soft mb-8" style={{ padding: '11px 14px' }}>
      <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13 }}>{t.nome}</b>
            <span className="muted-sm" style={{ overflowWrap: 'anywhere' }}>{t.de}</span>
            {multiLoja && lojaFiltro === null && <span className="tag tag-purple">{nomeLoja(t.lojaId)}</span>}
            {t.status === 'enviada' && <span className="tag tag-green">enviada ✓</span>}
          </div>
          {editando?.id === t.id ? (
            <div className="row gap-8" style={{ marginTop: 6 }}>
              <input value={editando.texto} autoFocus
                onChange={e => setEditando({ id: t.id, texto: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter' && editando.texto.trim()) { s.atualizarTroca(t.id, { detalhes: editando.texto.trim() }); setEditando(null) }
                  if (e.key === 'Escape') setEditando(null)
                }}
                style={{ flex: 1, border: '1px solid var(--purple-border)', borderRadius: 6, padding: '4px 9px', fontSize: 13, outline: 'none', background: 'var(--panel)' }} />
              <button title="Salvar" style={{ color: 'var(--green)' }}
                onClick={() => { if (editando.texto.trim()) s.atualizarTroca(t.id, { detalhes: editando.texto.trim() }); setEditando(null) }}><Check size={14} /></button>
            </div>
          ) : (
            <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>{t.detalhes}</div>
          )}
          <div className="muted-sm" style={{ marginTop: 4 }}>
            aceita em {new Date(t.criadoEm).toLocaleDateString('pt-BR')}
            {t.enviadaEm && ` · enviada em ${new Date(t.enviadaEm).toLocaleDateString('pt-BR')}`}
          </div>
        </div>
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <button className={'btn btn-sm' + (respondendo?.id === t.id ? ' btn-primary' : '')} title="Responder ao cliente daqui mesmo"
            onClick={() => setRespondendo(respondendo?.id === t.id ? null : { id: t.id, texto: '' })}>
            <Send size={13} /> Responder
          </button>
          {t.status === 'pendente' ? (
            <button className="btn btn-sm btn-primary" title="Despachei a troca — marcar como enviada"
              onClick={() => s.atualizarTroca(t.id, { status: 'enviada' })}>
              <Check size={13} /> Marcar enviada
            </button>
          ) : (
            <button className="btn btn-sm" title="Voltar para pendente"
              onClick={() => s.atualizarTroca(t.id, { status: 'pendente' })}>
              <RotateCcw size={13} /> Pendente
            </button>
          )}
          <button className="btn btn-sm" title="Editar o que trocar"
            onClick={() => setEditando({ id: t.id, texto: t.detalhes })}><Pencil size={13} /></button>
          <button className="btn btn-sm btn-danger" title="Remover do caderno"
            onClick={() => { if (window.confirm('Remover esta troca do caderno?')) s.removerTroca(t.id) }}><X size={13} /></button>
        </div>
      </div>
      {respondendo?.id === t.id && (
        <div style={{ marginTop: 10 }}>
          <textarea value={respondendo.texto} autoFocus
            onChange={e => setRespondendo({ id: t.id, texto: e.target.value })}
            placeholder={`Escreva a mensagem para ${t.nome}…`}
            style={{ width: '100%', minHeight: 90, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, lineHeight: 1.5, background: 'var(--panel)', resize: 'vertical', outline: 'none' }} />
          <div className="row gap-8" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" disabled={!respondendo.texto.trim()}
              style={!respondendo.texto.trim() ? { opacity: 0.5 } : undefined}
              onClick={() => { s.aprovarEnviar(t.ticketId, respondendo.texto.trim(), false, 'manual'); setRespondendo(null) }}>
              <Send size={13} /> Enviar
            </button>
            <button className="btn btn-sm" onClick={() => setRespondendo(null)}>Cancelar</button>
            <span className="muted-sm">vai por e-mail para {t.de} e fecha o caso na caixa</span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="content-narrow">
      <div className="mb-16">
        <h1 className="h2">Trocas{lojaFiltro ? ` — ${nomeLoja(lojaFiltro)}` : ''}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Toda troca aceita pelo cliente entra aqui como pendente — despache e marque como enviada.
          Também dá para registrar à mão pelo botão "Registrar troca" dentro da conversa.
        </p>
      </div>

      {todas.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight />} title="Nenhuma troca registrada.">
          Quando um cliente aceitar uma troca, ela aparece aqui automaticamente para você despachar.
        </EmptyState>
      ) : (
        <>
          <div className="row gap-8 mb-12">
            <b style={{ fontSize: 14 }}>Pendentes</b>
            <span className="muted-sm">{pendentes.length}</span>
          </div>
          {pendentes.length === 0
            ? <p className="muted-sm mb-16">Nada para despachar agora.</p>
            : pendentes.map(linha)}

          {enviadas.length > 0 && (
            <>
              <div className="row gap-8 mb-12" style={{ marginTop: 20 }}>
                <b style={{ fontSize: 14 }}>Enviadas</b>
                <span className="muted-sm">{enviadas.length}</span>
              </div>
              {enviadas.map(linha)}
            </>
          )}
        </>
      )}
    </div>
  )
}
