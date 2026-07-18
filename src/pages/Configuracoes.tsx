import { useState } from 'react'
import { Mail, ShoppingBag, Zap, PenLine, Database, Check, Unplug } from 'lucide-react'
import { useStore } from '../store'

export default function Configuracoes() {
  const s = useStore()
  const [email, setEmail] = useState(s.config.emailConectado ?? '')

  const Section = ({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) => (
    <div className="card mb-16" style={{ padding: '18px 20px' }}>
      <div className="row gap-10 mb-8">
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--purple-soft)', color: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
        <div>
          <b style={{ fontSize: 14.5 }}>{title}</b>
          <div className="muted-sm">{desc}</div>
        </div>
      </div>
      <div style={{ paddingLeft: 42 }}>{children}</div>
    </div>
  )

  return (
    <div className="content-narrow" style={{ maxWidth: 720 }}>
      <h1 className="h1 mb-8" style={{ fontSize: 22 }}>Configurações</h1>
      <p className="muted mb-24">Conexões, automação e preferências da sua conta.</p>

      <Section icon={<Mail size={15} />} title="E-mail de atendimento" desc="A caixa que o atendo lê e pela qual responde. Gmail, Outlook, Yahoo, iCloud ou domínio próprio.">
        {s.config.emailConectado ? (
          <div className="row gap-10">
            <span className="tag tag-green"><Check size={11} style={{ marginRight: 4 }} /> Conectado</span>
            <span className="muted">{s.config.emailConectado}</span>
            <button className="btn btn-sm" onClick={() => { s.setConfig({ emailConectado: null }); setEmail('') }}><Unplug size={13} /> Desconectar</button>
          </div>
        ) : (
          <div className="row gap-8">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="suporte@sualoja.com"
              style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', outline: 'none' }} />
            <button className="btn btn-primary" disabled={!email.includes('@')} style={!email.includes('@') ? { opacity: 0.5 } : undefined}
              onClick={() => s.setConfig({ emailConectado: email.trim() })}>Conectar</button>
          </div>
        )}
        <p className="muted-sm" style={{ marginTop: 10 }}>
          Nesta versão pessoal a conexão é simulada — nenhuma senha é pedida e nenhum e-mail real é enviado. Use o botão Sincronizar para receber e-mails de demonstração.
        </p>
      </Section>

      <Section icon={<ShoppingBag size={15} />} title="Shopify" desc="Pedidos, rastreio e clientes entram sozinhos — o atendo usa esses dados nas respostas.">
        {s.config.shopifyConectada ? (
          <div className="row gap-10">
            <span className="tag tag-green"><Check size={11} style={{ marginRight: 4 }} /> Conectada</span>
            <span className="muted">{s.pedidos.length} pedidos sincronizados</span>
            <button className="btn btn-sm" onClick={() => s.setConfig({ shopifyConectada: false })}><Unplug size={13} /> Desconectar</button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={s.conectarShopify}>Conectar Shopify (demonstração)</button>
        )}
      </Section>

      <Section icon={<Zap size={15} />} title="Automação" desc="Como o atendo trata cada e-mail novo que chega.">
        <div className="row spread mb-12">
          <div>
            <b style={{ fontSize: 13.5 }}>Rascunhos automáticos com envio agendado</b>
            <div className="muted-sm">Respostas confiáveis são enviadas sozinhas após o atraso abaixo. Reembolsos e casos sensíveis sempre esperam você.</div>
          </div>
          <button className={'switch' + (s.config.automacaoAtiva ? ' on' : '')} onClick={() => s.setConfig({ automacaoAtiva: !s.config.automacaoAtiva })} />
        </div>
        <div className="row gap-10">
          <span className="muted" style={{ fontSize: 13 }}>Atraso humano antes do envio:</span>
          <select value={s.config.atrasoMinutos} onChange={e => s.setConfig({ atrasoMinutos: Number(e.target.value) })}
            className="chip" style={{ cursor: 'pointer' }}>
            {[1, 3, 5, 10, 20, 45].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          <span className="muted-sm">um contador ao vivo mostra quando cada resposta sai</span>
        </div>
      </Section>

      <Section icon={<PenLine size={15} />} title="Identidade" desc="Nome da loja e assinatura usada no fim de cada resposta.">
        <div className="grid-2">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nome da loja</label>
            <input value={s.config.nomeLoja} onChange={e => s.setConfig({ nomeLoja: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Assinatura</label>
            <input value={s.config.assinatura} onChange={e => s.setConfig({ assinatura: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section icon={<Database size={15} />} title="Dados" desc="Tudo fica salvo localmente no seu navegador — nada sai da sua máquina.">
        <button className="btn btn-danger" onClick={() => { if (confirm('Apagar todos os tickets, políticas, FAQs e conexões?')) s.limparTudo() }}>
          Apagar todos os dados
        </button>
      </Section>
    </div>
  )
}
