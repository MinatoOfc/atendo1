import { useState } from 'react'
import { Send, Sparkles, Languages } from 'lucide-react'
import { useStore } from '../store'
import { Modal } from './Shared'

export interface ComposeInicial {
  para?: string
  assunto?: string
  corpo?: string
  lojaId?: string
  /** código ISO do idioma em que a IA deve escrever (loja ou país do pedido) */
  idioma?: string
}

const nomeIdioma: Record<string, string> = {
  pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', nl: 'holandês',
}

export default function ComposeModal({ onClose, inicial }: { onClose: () => void; inicial?: ComposeInicial }) {
  const { enviarNovoEmail, gerarEmail, traduzirTexto, config, lojas, lojaAtiva } = useStore()
  const [para, setPara] = useState(inicial?.para ?? '')
  const [assunto, setAssunto] = useState(inicial?.assunto ?? '')
  const [corpo, setCorpo] = useState(inicial?.corpo ?? '')
  const [instrucao, setInstrucao] = useState('')
  const [gerando, setGerando] = useState(false)
  const [erroIA, setErroIA] = useState<string | null>(null)
  const [traducao, setTraducao] = useState<string | null>(null)
  const [traduzindo, setTraduzindo] = useState(false)
  const ativas = lojas.filter(l => l.ativa)
  const [lojaId, setLojaId] = useState(
    inicial?.lojaId ?? (lojaAtiva !== 'todas' ? lojaAtiva : ativas[0]?.id ?? 'loja1'),
  )
  const lojaSel = lojas.find(l => l.id === lojaId)
  // idioma em que a IA escreve: o do pedido (país), senão o idioma fixo da loja
  const idioma = inicial?.idioma || (lojaSel?.idioma && lojaSel.idioma !== 'auto' ? lojaSel.idioma : undefined)

  const enviar = () => {
    if (!para.trim() || !assunto.trim()) return
    enviarNovoEmail(para.trim(), assunto.trim(), corpo, lojaId)
    onClose()
  }

  const gerar = async () => {
    if (!para.trim() || gerando) return
    setGerando(true)
    setErroIA(null)
    const r = await gerarEmail({ lojaId, para: para.trim(), assunto: assunto.trim(), instrucao: instrucao.trim(), idioma })
    setGerando(false)
    if (r.erro) { setErroIA(r.erro); return }
    setCorpo(r.texto ?? '')
    setTraducao(null)
  }

  const verPt = async () => {
    if (!corpo.trim() || traduzindo) return
    setTraduzindo(true)
    const r = await traduzirTexto(corpo)
    setTraduzindo(false)
    if (r.erro) { setErroIA(r.erro); return }
    setTraducao(r.traducao ?? null)
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
        <label>Gerar com IA{idioma ? ` — escreve em ${nomeIdioma[idioma] ?? idioma}` : ''}</label>
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <input value={instrucao} onChange={e => setInstrucao(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); gerar() } }}
            placeholder='O que dizer? Ex.: "avise que o endereço parece incompleto"'
            style={{ flex: 1, minWidth: 180 }} />
          <button className="btn" onClick={gerar} disabled={gerando || !para.trim()}
            style={gerando || !para.trim() ? { opacity: 0.6 } : undefined}>
            <Sparkles size={14} /> {gerando ? 'Gerando…' : 'Gerar com IA'}
          </button>
        </div>
        {erroIA && <div style={{ color: 'var(--red, #e5484d)', fontSize: 12.5, marginTop: 6 }}>{erroIA}</div>}
      </div>
      <div className="field">
        <label>Mensagem</label>
        <textarea value={corpo} onChange={e => { setCorpo(e.target.value); setTraducao(null) }} placeholder="Escreva sua mensagem ou gere com a IA acima…" style={{ minHeight: 160 }} autoFocus={!!inicial?.para} />
        {corpo.trim() !== '' && (
          traducao === null ? (
            <div style={{ marginTop: 6 }}>
              <button className="btn btn-sm" onClick={verPt} disabled={traduzindo}>
                <Languages size={13} /> {traduzindo ? 'Traduzindo…' : 'Ver em português'}
              </button>
            </div>
          ) : (
            <div className="card-soft" style={{ padding: '8px 10px', fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 6 }}>
              <div className="muted-sm" style={{ marginBottom: 4 }}>Tradução (não é enviada):</div>
              {traducao}
            </div>
          )
        )}
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
