import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Home, Inbox, Send, CheckSquare, Users, BookOpen, Shield, Trash2,
  Package, Truck, Tag, TrendingUp, HelpCircle, MessageSquare, Settings,
  PenSquare, RefreshCw, Globe, Bell, ChevronDown, Facebook, Megaphone,
} from 'lucide-react'
import { useStore } from '../store'
import ComposeModal from './ComposeModal'

const titulos: Record<string, string> = {
  '/': 'Início', '/caixa': 'Caixa de Entrada', '/enviados': 'Enviados',
  '/aprovacoes': 'Aprovações', '/humano': 'Atendimento humano', '/conhecimento': 'Conhecimento',
  '/spam': 'Spam', '/lixeira': 'Lixeira', '/pedidos': 'Pedidos', '/prazos': 'Prazos de entrega',
  '/produtos': 'Produtos', '/ganhos': 'Ganhos', '/configuracoes': 'Configurações',
}

export default function Layout() {
  const { config, naoLidos, aguardandoAprovacao, casosHumanos, sincronizar } = useStore()
  const loc = useLocation()
  const [compor, setCompor] = useState(false)
  const [girando, setGirando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const onSync = async () => {
    setGirando(true)
    try {
      const n = await sincronizar()
      setAviso(n > 0 ? `${n} novo${n > 1 ? 's' : ''} e-mail${n > 1 ? 's' : ''} sincronizado${n > 1 ? 's' : ''}` : 'Tudo em dia — nenhum e-mail novo')
    } catch {
      setAviso('Falha ao sincronizar — o servidor está no ar?')
    } finally {
      setGirando(false)
      setTimeout(() => setAviso(null), 3500)
    }
  }

  const item = (to: string, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <NavLink to={to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} end={to === '/'}>
      {icon}<span>{label}</span>{extra}
    </NavLink>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-account">
          <div className="avatar">A</div>
          <span style={{ flex: 1 }}>{config.nomeLoja}</span>
          <ChevronDown size={14} color="var(--text-3)" />
        </div>

        <div className="sidebar-label">Atendimento</div>
        {item('/', <Home />, 'Início')}
        <button className="btn-new-email" onClick={() => setCompor(true)}>
          <PenSquare size={15} /> Novo email
        </button>
        {item('/caixa', <Inbox />, 'Caixa de Entrada', naoLidos > 0 && <span className="badge-count">{naoLidos}</span>)}
        {item('/enviados', <Send />, 'Enviados')}
        {item('/aprovacoes', <CheckSquare />, 'Aprovações', aguardandoAprovacao.length > 0 && <span className="badge-count">{aguardandoAprovacao.length}</span>)}
        {item('/humano', <Users />, 'Atendimento humano', casosHumanos.length > 0 && <span className="badge-count">{casosHumanos.length}</span>)}
        {item('/conhecimento', <BookOpen />, 'Conhecimento')}
        {item('/spam', <Shield />, 'Spam')}
        {item('/lixeira', <Trash2 />, 'Lixeira')}

        <div className="sidebar-label">Loja</div>
        {item('/pedidos', <Package />, 'Pedidos')}
        {item('/prazos', <Truck />, 'Prazos de entrega')}
        {item('/produtos', <Tag />, 'Produtos')}

        <div className="sidebar-label">Crescimento</div>
        {item('/ganhos', <TrendingUp />, 'Ganhos')}
        <div className="nav-item" style={{ cursor: 'default' }}><Facebook /><span>Meta Ads</span><span className="badge-soon">EM BREVE</span></div>
        <div className="nav-item" style={{ cursor: 'default' }}><Megaphone /><span>Google Ads</span><span className="badge-soon">EM BREVE</span></div>

        <div className="sidebar-footer">
          <div className="nav-item" style={{ cursor: 'default' }}><HelpCircle /><span>Ajuda</span></div>
          <div className="nav-item" style={{ cursor: 'default' }}><MessageSquare /><span>Atualizações</span></div>
          {item('/configuracoes', <Settings />, 'Configurações')}
          <div className="sidebar-plan">
            <span className="pill-plan">Uso pessoal</span>
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{titulos[loc.pathname] ?? 'atendo'}</div>
          <div className="topbar-logo">atendo</div>
          <div className="topbar-right">
            <button className="icon-btn" onClick={onSync} title="Sincronizar e-mails">
              <RefreshCw style={girando ? { animation: 'spin 0.9s linear infinite' } : undefined} />
              <span>Sincronizar</span>
            </button>
            <button className="icon-btn"><Globe /> PT <ChevronDown size={12} /></button>
            <button className="icon-btn"><Bell /></button>
            <div className="row gap-8">
              <div className="avatar-sm">A</div>
              <span style={{ fontWeight: 600 }}>allan</span>
              <ChevronDown size={13} color="var(--text-3)" />
            </div>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>

      {aviso && (
        <div style={{
          position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
          background: '#17151f', color: '#fff', padding: '9px 18px', borderRadius: 99,
          fontSize: 13, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
        }}>{aviso}</div>
      )}

      {compor && <ComposeModal onClose={() => setCompor(false)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
