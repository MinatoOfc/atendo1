import { useState } from 'react'
import { Truck, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { EmptyState, TipCard } from '../components/Shared'

const prazosDemo = [
  { pais: 'Brasil', processamento: '1,4 dias', entrega: '9,2 dias', pedidos: 14 },
  { pais: 'Itália', processamento: '1,1 dias', entrega: '11,8 dias', pedidos: 9 },
  { pais: 'Alemanha', processamento: '1,3 dias', entrega: '10,5 dias', pedidos: 7 },
  { pais: 'França', processamento: '1,6 dias', entrega: '12,1 dias', pedidos: 5 },
  { pais: 'Estados Unidos', processamento: '1,2 dias', entrega: '8,7 dias', pedidos: 11 },
]

export default function Prazos() {
  const { config } = useStore()
  const [periodo, setPeriodo] = useState('Tudo')

  return (
    <div className="content-narrow">
      <div className="row spread mb-16" style={{ alignItems: 'flex-start' }}>
        <div className="row gap-12">
          <div className="empty-icon" style={{ width: 42, height: 42, margin: 0, borderRadius: 12 }}><Truck /></div>
          <div>
            <h1 className="h2">Tempos de entrega</h1>
            <p className="muted" style={{ marginTop: 4, maxWidth: 640 }}>
              Processamento (pedido → código de rastreio) e entrega (despacho → entrega), por país. O atendo usa estes prazos nas dúvidas de tempo.
            </p>
          </div>
        </div>
        <button className="btn" disabled={!config.shopifyConectada} style={!config.shopifyConectada ? { opacity: 0.5 } : undefined}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      <div className="row gap-8 mb-20" style={{ flexWrap: 'wrap' }}>
        {['Tudo', '60 dias', '30 dias', '15 dias', '7 dias'].map(p => (
          <button key={p} className={'chip' + (periodo === p ? ' active-purple' : '')} onClick={() => setPeriodo(p)}>{p}</button>
        ))}
        <input type="date" className="chip" style={{ cursor: 'pointer' }} />
        <span className="muted-sm" style={{ alignSelf: 'center' }}>até</span>
        <input type="date" className="chip" style={{ cursor: 'pointer' }} />
        <button className="chip">Aplicar</button>
      </div>

      {!config.shopifyConectada ? (
        <EmptyState icon={<Truck />} title="Sem dados nesse período">
          Conecte a Shopify nas Configurações para calcular os tempos a partir dos pedidos.
        </EmptyState>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>País</th><th>Processamento médio</th><th>Entrega média</th><th>Pedidos no período</th></tr></thead>
            <tbody>
              {prazosDemo.map(p => (
                <tr key={p.pais}>
                  <td style={{ fontWeight: 600 }}>{p.pais}</td>
                  <td>{p.processamento}</td>
                  <td>{p.entrega}</td>
                  <td className="muted">{p.pedidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TipCard
        id="tip-prazos"
        title="Use prazos reais nas respostas"
        text="O atendo calcula tempos médios de processamento e entrega por país, com base no histórico real dos seus pedidos."
        items={['Sincronize os pedidos', 'Escolha o período', 'Revise os prazos por país', 'Use esses dados nas respostas']}
      />
    </div>
  )
}
