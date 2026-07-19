import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import Layout from './components/Layout'
import Login from './pages/Login'
import Inicio from './pages/Inicio'
import CaixaEntrada from './pages/CaixaEntrada'
import Enviados from './pages/Enviados'
import Aprovacoes from './pages/Aprovacoes'
import AtendimentoHumano from './pages/AtendimentoHumano'
import Conhecimento from './pages/Conhecimento'
import Spam from './pages/Spam'
import Lixeira from './pages/Lixeira'
import Pedidos from './pages/Pedidos'
import Prazos from './pages/Prazos'
import Produtos from './pages/Produtos'
import Ganhos from './pages/Ganhos'
import Configuracoes from './pages/Configuracoes'

export default function App() {
  const { usuario, autenticando } = useStore()

  if (autenticando) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div className="topbar-logo" style={{ fontSize: 26, opacity: 0.5 }}>atendo</div>
      </div>
    )
  }

  if (!usuario) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Inicio />} />
        <Route path="/caixa" element={<CaixaEntrada />} />
        <Route path="/enviados" element={<Enviados />} />
        <Route path="/aprovacoes" element={<Aprovacoes />} />
        <Route path="/humano" element={<AtendimentoHumano />} />
        <Route path="/conhecimento" element={<Conhecimento />} />
        <Route path="/spam" element={<Spam />} />
        <Route path="/lixeira" element={<Lixeira />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/prazos" element={<Prazos />} />
        <Route path="/produtos" element={<Produtos />} />
        {/* rota antiga da UGC, agora substituída por Produtos */}
        <Route path="/ugc" element={<Navigate to="/produtos" replace />} />
        <Route path="/ganhos" element={<Ganhos />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
