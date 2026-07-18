import { useNavigate } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { useStore } from '../store'
import { EmptyState, TipCard } from '../components/Shared'

const statusPedido: Record<string, { label: string; cls: string }> = {
  aguardando: { label: 'Aguardando envio', cls: 'tag-amber' },
  transito: { label: 'Em trânsito', cls: 'tag-rastreio' },
  entregue: { label: 'Entregue', cls: 'tag-green' },
  problema: { label: 'Com problema', cls: 'tag-reembolso' },
}

export default function Pedidos() {
  const { config, pedidos, conectarShopify } = useStore()
  const nav = useNavigate()

  if (!config.shopifyConectada) {
    return (
      <>
        <EmptyState icon={<ShoppingBag />} title="Shopify não conectada">
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => nav('/configuracoes')}>
            Configurar em Ajustes →
          </button>
        </EmptyState>
        <TipCard
          id="tip-pedidos"
          title="Controle pedidos sem abrir a Shopify"
          text="Veja pedidos aguardando envio, em trânsito e com problemas. O atendo usa esses dados para responder clientes com mais precisão."
          items={['Conecte a Shopify', 'Sincronize os pedidos', 'Confira pedidos com problemas', 'Use o status de envio nas respostas']}
          action={{ label: 'Sincronizar Shopify', onClick: conectarShopify }}
        />
      </>
    )
  }

  return (
    <div className="content-narrow">
      <div className="row spread mb-16">
        <div>
          <h1 className="h2">Pedidos</h1>
          <p className="muted" style={{ marginTop: 4 }}>{pedidos.length} pedidos sincronizados da Shopify.</p>
        </div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr><th>Pedido</th><th>Cliente</th><th>País</th><th>Valor</th><th>Status</th><th>Rastreio</th><th>Data</th></tr>
          </thead>
          <tbody>
            {pedidos.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.numero}</td>
                <td>{p.cliente}<div className="muted-sm">{p.email}</div></td>
                <td>{p.pais}</td>
                <td>US$ {p.valor.toFixed(2)}</td>
                <td><span className={`tag ${statusPedido[p.status].cls}`}>{statusPedido[p.status].label}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.rastreio}</td>
                <td className="muted-sm">{new Date(p.criadoEm + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
