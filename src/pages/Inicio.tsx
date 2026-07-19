import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plug, Wand2, Zap, X, Mail, CheckSquare, Users, Package, Tag,
  ArrowRight, RefreshCw, Info, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useStore, saudacaoDia } from '../store'

export default function Inicio() {
  const s = useStore()
  const nav = useNavigate()
  const [resumoAberto, setResumoAberto] = useState(true)

  const passo1 = !!s.config.emailConectado || s.config.shopifyConectada
  const passo2 = s.config.tomDetectado
  const passo3 = s.config.automacaoAtiva
  const feitos = [passo1, passo2, passo3].filter(Boolean).length
  const onboardingFechado = s.tipsFechados.includes('onboarding')

  const naoRespondidos = s.tickets.filter(t => t.status === 'inbox' || t.status === 'aprovacao' || t.status === 'humano').length
  const aguardandoEnvio = s.pedidos.filter(p => p.status === 'aguardando').length

  const precisam = [
    { icon: <Mail size={15} />, label: 'E-mails não respondidos', n: naoRespondidos, to: '/caixa' },
    { icon: <CheckSquare size={15} />, label: 'Respostas aguardando aprovação', n: s.aguardandoAprovacao.length, to: '/aprovacoes' },
    { icon: <Users size={15} />, label: 'Casos que pedem você', n: s.casosHumanos.length, to: '/humano' },
    { icon: <Package size={15} />, label: 'Pedidos aguardando envio', n: aguardandoEnvio, to: '/pedidos' },
    { icon: <Tag size={15} />, label: 'Produtos esgotados no catálogo', n: s.produtos.filter(p => p.ativo && p.estoque <= 0).length, to: '/produtos' },
  ]
  const total = precisam.reduce((a, p) => a + p.n, 0)

  return (
    <div className="content-narrow">
      {!onboardingFechado && (
        <div className="card-purple mb-24" style={{ padding: '18px 20px' }}>
          <div className="row spread mb-12">
            <div>
              <div className="h3">Sua primeira resposta automática em 3 passos</div>
              <div className="muted-sm" style={{ marginTop: 3 }}>{feitos} de 3 concluídos — leva poucos minutos.</div>
            </div>
            <div className="row gap-10">
              <div className="progressbar"><div style={{ width: `${(feitos / 3) * 100}%` }} /></div>
              <button onClick={() => s.fecharTip('onboarding')} style={{ color: 'var(--text-3)' }}><X size={16} /></button>
            </div>
          </div>
          <div className="grid-3">
            <div className="card" style={{ padding: 16 }}>
              <div className="row gap-8 mb-8">
                <span className={'step-num' + (passo1 ? ' done' : '')}>{passo1 ? '✓' : '1'}</span>
                <Plug size={14} /><b style={{ fontSize: 13.5 }}>Conecte a loja</b>
              </div>
              <p className="muted-sm mb-12" style={{ lineHeight: 1.5 }}>Ligue o e-mail de atendimento e a Shopify.</p>
              <button className="btn btn-primary btn-sm" onClick={() => nav('/configuracoes')}>Conectar →</button>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="row gap-8 mb-8">
                <span className={'step-num' + (passo2 ? ' done' : '')}>{passo2 ? '✓' : '2'}</span>
                <Wand2 size={14} /><b style={{ fontSize: 13.5 }}>Tom da marca</b>
              </div>
              <p className="muted-sm mb-12" style={{ lineHeight: 1.5 }}>O atendo lê suas respostas antigas e escreve do mesmo jeito.</p>
              <button className="btn btn-primary btn-sm" onClick={() => s.setConfig({ tomDetectado: true })}>
                {passo2 ? 'Tom detectado ✓' : 'Detectar meu tom'}
              </button>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="row gap-8 mb-8">
                <span className={'step-num' + (passo3 ? ' done' : '')}>{passo3 ? '✓' : '3'}</span>
                <Zap size={14} /><b style={{ fontSize: 13.5 }}>Ligue a automação</b>
              </div>
              <p className="muted-sm mb-12" style={{ lineHeight: 1.5 }}>Cada e-mail novo chega com a resposta pronta para você aprovar.</p>
              <div className="row gap-8">
                <button className="btn btn-primary btn-sm" onClick={() => s.setConfig({ automacaoAtiva: !passo3 })}>
                  {passo3 ? 'Rascunhos ativos ✓' : 'Ativar rascunhos'}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => nav('/configuracoes')}>ajustar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <h1 className="h1">{saudacaoDia()}, {s.config.nomeLoja}</h1>
      <p className="muted mb-20" style={{ marginTop: 6 }}>Aqui está o que mudou desde ontem.</p>

      {!s.config.shopifyConectada && (
        <div className="banner mb-16">
          Conecte a Shopify para ver faturamento, lucro e pedidos de hoje.{' '}
          <span className="link" onClick={() => nav('/configuracoes')}>Conectar</span>
        </div>
      )}

      <div className="card-purple mb-16" style={{ padding: '16px 18px' }}>
        <div className="row spread mb-12">
          <div className="row gap-10">
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Info size={15} />
            </div>
            <div>
              <b style={{ fontSize: 14 }}>O que aconteceu ontem?</b>
              <div className="muted-sm">Resumo inteligente com base nos seus dados</div>
            </div>
          </div>
          <div className="row gap-8" style={{ color: 'var(--text-3)' }}>
            <RefreshCw size={14} style={{ cursor: 'pointer' }} />
            <button onClick={() => setResumoAberto(a => !a)}>{resumoAberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
          </div>
        </div>
        {resumoAberto && (
          <div className="card" style={{ padding: 16 }}>
            {s.config.shopifyConectada && s.config.emailConectado ? (
              <div className="muted" style={{ lineHeight: 1.6 }}>
                <b style={{ color: 'var(--text)' }}>Resumo:</b> {s.tickets.filter(t => t.status === 'enviado').length} resposta(s) enviadas,{' '}
                {s.aguardandoAprovacao.length} aguardando sua aprovação e {s.casosHumanos.length} caso(s) escalados para você.{' '}
                {s.pedidos.length} pedidos sincronizados da Shopify.
              </div>
            ) : (
              <>
                <div className="row gap-8 mb-12"><Plug size={15} /><b style={{ fontSize: 13.5 }}>Falta conectar sua loja</b></div>
                <ul style={{ listStyle: 'none', marginBottom: 14 }}>
                  {!s.config.shopifyConectada && <li className="muted" style={{ padding: '3px 0' }}>• Conectar Shopify</li>}
                  {!s.config.emailConectado && <li className="muted" style={{ padding: '3px 0' }}>• Conectar e-mail de atendimento</li>}
                </ul>
                <button className="btn btn-primary btn-sm" onClick={() => nav('/configuracoes')}>Conectar integrações</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="row spread mb-8">
          <b style={{ fontSize: 14.5 }}>Precisam de você</b>
          {total === 0 && <span className="muted-sm" style={{ color: 'var(--green)', fontWeight: 600 }}>Tudo certo por aqui</span>}
        </div>
        {precisam.map(p => (
          <button key={p.label} className="need-row" onClick={() => nav(p.to)}>
            <span className={'status-dot' + (p.n > 0 ? ' warn' : '')} />
            <span className="label">{p.icon} {p.label}</span>
            <span className={'count' + (p.n === 0 ? ' zero' : '')}>{p.n}</span>
            <ArrowRight size={14} color="var(--text-3)" />
          </button>
        ))}
      </div>
    </div>
  )
}
