import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'

/** Miniatura de produto: foto quando existe, inicial do nome quando não. */
export function MiniFoto({ src, alt, tamanho = 26 }: { src?: string | null; alt: string; tamanho?: number }) {
  if (src) {
    return <img src={src} alt={alt} loading="lazy" style={{ width: tamanho, height: tamanho, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
  }
  return (
    <span style={{
      width: tamanho, height: tamanho, borderRadius: 6, background: 'var(--hover)', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-3)', fontSize: Math.round(tamanho * 0.42), fontWeight: 700,
    }}>
      {(alt[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

export function TipCard({ id, title, text, items, action }: {
  id: string; title: string; text: string; items: string[]
  action?: { label: string; onClick: () => void }
}) {
  const { tipsFechados, fecharTip } = useStore()
  if (tipsFechados.includes(id)) return null
  return (
    <div className="tipcard">
      <div className="tipcard-body">
        <div className="tipcard-head">
          <div className="info">i</div>
          <h4>{title}</h4>
          <button className="close" onClick={() => fecharTip(id)}><X size={15} /></button>
        </div>
        <p>{text}</p>
        <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
        <div className="actions">
          {action && <button className="btn btn-primary" onClick={action.onClick}>{action.label} →</button>}
          <button className="btn" onClick={() => fecharTip(id)}>Entendi</button>
        </div>
      </div>
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2 className="h2">{title}</h2>
          <button onClick={onClose} style={{ color: 'var(--text-3)' }}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
