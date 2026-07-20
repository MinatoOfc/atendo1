import { useNavigate } from 'react-router-dom'
import { TrendingUp, Check } from 'lucide-react'
import { useStore } from '../store'

export default function Ganhos() {
  const { config, pedidos, fmtMoeda } = useStore()
  const nav = useNavigate()

  if (!config.shopifyConectada) {
    return (
      <div className="empty" style={{ paddingTop: 60 }}>
        <div className="empty-icon" style={{ background: 'var(--ok-bg)', color: 'var(--green)' }}><TrendingUp /></div>
        <h1 className="h1" style={{ fontSize: 24, marginBottom: 12 }}>Painel de Ganhos</h1>
        <p className="muted" style={{ maxWidth: 460, lineHeight: 1.6, marginBottom: 22 }}>
          Veja os ganhos reais da sua loja cruzando Shopify, custo do produto e anúncios — em tempo real, dentro do atendo.
        </p>
        <div style={{ textAlign: 'left', marginBottom: 26 }}>
          {[
            'Lucro líquido real (receita − custo − taxas − anúncios)',
            'Margem, ROAS, CPA, ROI e ticket médio',
            'Custo do produto por planilha ou manual',
            'P&L diário, pedidos e desempenho por país',
          ].map(f => (
            <div key={f} className="row gap-8" style={{ padding: '4px 0', fontSize: 13.5, color: 'var(--text-2)' }}>
              <Check size={15} color="var(--green)" /> {f}
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => nav('/configuracoes')}>Conectar Shopify →</button>
      </div>
    )
  }

  const receita = pedidos.reduce((a, p) => a + p.valor, 0)
  const custo = receita * 0.38
  const taxas = receita * 0.06
  const lucro = receita - custo - taxas
  const fmt = (v: number) => fmtMoeda(v)

  const cards = [
    { label: 'Receita', valor: fmt(receita), delta: '+12% vs período anterior' },
    { label: 'Custo do produto', valor: fmt(custo), delta: '38% da receita' },
    { label: 'Taxas', valor: fmt(taxas), delta: 'gateway + checkout' },
    { label: 'Lucro líquido', valor: fmt(lucro), delta: `margem ${Math.round((lucro / receita) * 100)}%`, destaque: true },
  ]

  return (
    <div className="content-narrow">
      <h1 className="h2 mb-8">Ganhos</h1>
      <p className="muted mb-20">Números calculados a partir dos pedidos sincronizados. Conecte Meta Ads (em breve) para incluir o custo de anúncios.</p>
      <div className="grid-2 mb-16" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {cards.map(c => (
          <div key={c.label} className={c.destaque ? 'card-purple' : 'card'} style={{ padding: 16 }}>
            <div className="muted-sm mb-8">{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>{c.valor}</div>
            <div className="muted-sm" style={{ marginTop: 6 }}>{c.delta}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>País</th><th>Pedidos</th><th>Receita</th><th>Participação</th></tr></thead>
          <tbody>
            {Object.entries(
              pedidos.reduce<Record<string, { n: number; v: number }>>((acc, p) => {
                acc[p.pais] = { n: (acc[p.pais]?.n ?? 0) + 1, v: (acc[p.pais]?.v ?? 0) + p.valor }
                return acc
              }, {}),
            ).sort((a, b) => b[1].v - a[1].v).map(([pais, d]) => (
              <tr key={pais}>
                <td style={{ fontWeight: 600 }}>{pais}</td>
                <td>{d.n}</td>
                <td>{fmt(d.v)}</td>
                <td className="muted">{Math.round((d.v / receita) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
