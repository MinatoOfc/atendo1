import { useState } from 'react'
import { Send } from 'lucide-react'
import { useStore } from '../store'
import { Modal } from './Shared'

export interface ComposeInicial {
  para?: string
  assunto?: string
  corpo?: string
  lojaId?: string
}

export default function ComposeModal({ onClose, inicial }: { onClose: () => void; inicial?: ComposeInicial }) {
  const { enviarNovoEmail, config, lojas, lojaAtiva } = useStore()
  const [para, setPara] = useState(inicial?.para ?? '')
  const [assunto, setAssunto] = useState(inicial?.assunto ?? '')
  const [corpo, setCorpo] = useState(inicial?.corpo ?? '')
  const ativas = lojas.filter(l => l.ativa)
  const [lojaId, setLojaId] = useState(
    inicial?.lojaId ?? (lojaAtiva !== 'todas' ? lojaAtiva : ativas[0]?.id ?? 'loja1'),
  )
  const lojaSel = lojas.find(l => l.id === lojaId)

  const enviar = () => {
    if (!para.trim() || !assunto.trim()) return
    enviarNovoEmail(para.trim(), assunto.trim(), corpo, lojaId)
    onClose()
  }

  return (
    <Modal title="Novo email" onClose={onClose}>
      {!config.emailConectado && (
        <div className="banner card-soft mb-12" style={{ fontSize: 12.5 }}>
          Nenhuma caixa de e-mail conectada — este envio fica registrado apenas aqui no atendo.
        </div>
      )}
      {ativas.length > 1 && (
        <div className="field">
          <label>Enviar pela loja</label>
          <select value={lojaId} onChange={e => setLojaId(e.target.value)}>
            {ativas.map(l => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label>Para</label>
        <input value={para} onChange={e => setPara(e.target.value)} placeholder="cliente@email.com" autoFocus={!inicial?.para} />
      </div>
      <div className="field">
        <label>Assunto</label>
        <input value={assunto} onChange={e => setAssunto(e.target.value)} placeholder="Assunto do e-mail" />
      </div>
      <div className="field">
        <label>Mensagem</label>
        <textarea value={corpo} onChange={e => setCorpo(e.target.value)} placeholder="Escreva sua mensagem…" style={{ minHeight: 160 }} autoFocus={!!inicial?.para} />
      </div>
      <div className="row spread">
        <span className="muted-sm">Assinatura: {lojaSel?.assinatura?.trim() ? lojaSel.assinatura.split('\n')[0] : config.assinatura}</span>
        <button className="btn btn-primary" onClick={enviar} disabled={!para.trim() || !assunto.trim()} style={!para.trim() || !assunto.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          <Send size={14} /> Enviar
        </button>
      </div>
    </Modal>
  )
}
