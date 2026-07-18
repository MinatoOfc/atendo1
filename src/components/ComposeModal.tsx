import { useState } from 'react'
import { Send } from 'lucide-react'
import { useStore } from '../store'
import { Modal } from './Shared'

export default function ComposeModal({ onClose }: { onClose: () => void }) {
  const { enviarNovoEmail, config } = useStore()
  const [para, setPara] = useState('')
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')

  const enviar = () => {
    if (!para.trim() || !assunto.trim()) return
    enviarNovoEmail(para.trim(), assunto.trim(), corpo)
    onClose()
  }

  return (
    <Modal title="Novo email" onClose={onClose}>
      {!config.emailConectado && (
        <div className="banner card-soft mb-12" style={{ fontSize: 12.5 }}>
          Nenhuma caixa de e-mail conectada — este envio fica registrado apenas aqui no atendo.
        </div>
      )}
      <div className="field">
        <label>Para</label>
        <input value={para} onChange={e => setPara(e.target.value)} placeholder="cliente@email.com" autoFocus />
      </div>
      <div className="field">
        <label>Assunto</label>
        <input value={assunto} onChange={e => setAssunto(e.target.value)} placeholder="Assunto do e-mail" />
      </div>
      <div className="field">
        <label>Mensagem</label>
        <textarea value={corpo} onChange={e => setCorpo(e.target.value)} placeholder="Escreva sua mensagem…" style={{ minHeight: 160 }} />
      </div>
      <div className="row spread">
        <span className="muted-sm">Assinatura: {config.assinatura}</span>
        <button className="btn btn-primary" onClick={enviar} disabled={!para.trim() || !assunto.trim()} style={!para.trim() || !assunto.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          <Send size={14} /> Enviar
        </button>
      </div>
    </Modal>
  )
}
