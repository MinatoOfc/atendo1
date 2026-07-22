import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingBag, Search, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { EmptyState, TipCard, MiniFoto } from '../components/Shared'

const statusPedido: Record<string, { label: string; cls: string }> = {
  aguardando: { label: 'Aguardando envio', cls: 'tag-amber' },
  transito: { label: 'Em trânsito', cls: 'tag-rastreio' },
  entregue: { label: 'Entregue', cls: 'tag-green' },
  problema: { label: 'Com problema', cls: 'tag-reembolso' },
}

// busca sem diferenciar maiúsculas nem acentos (van dijk acha Van Dijk)
const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function Pedidos() {
  const { config, pedidos, conectarShopify, fmtMoeda, produtos } = useStore()
  // foto da variante escolhida (a cor comprada); sem ela, a foto principal do produto
  const fotoDe = (i: { produtoId?: string | null; varianteId?: string | null }) => {
    const pr = i.produtoId ? produtos.find(x => x.id === i.produtoId) : null
    return (i.varianteId && pr?.imagemPorVariante?.[i.varianteId]) || pr?.imagem || null
  }
  const fmt = (v: number) => fmtMoeda(v)
  const nav = useNavigate()
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)

  const q = normalizar(busca.trim())
  const filtrados = q
    ? pedidos.filter(p => [p.numero, p.cliente, p.email].some(v => v && normalizar(v).includes(q)))
    : pedidos

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
      <div className="row spread mb-16" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="h2">Pedidos</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {q ? `${filtrados.length} de ${pedidos.length} pedidos` : `${pedidos.length} pedidos sincronizados da Shopify.`}
          </p>
        </div>
        <div className="search-box">
          <Search size={15} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail ou nº do pedido" />
        </div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr><th>Pedido</th><th>Cliente</th><th>País</th><th>Valor</th><th>Status</th><th>Rastreio</th><th>Data</th></tr>
          </thead>
          <tbody>
            {q !== '' && filtrados.length === 0 && (
              <tr><td colSpan={7} className="muted-sm" style={{ textAlign: 'center', padding: '26px 0' }}>
                Nenhum pedido encontrado para “{busca.trim()}”.
              </td></tr>
            )}
            {filtrados.map(p => {
              const aberto = expandido === p.id
              const nItens = p.itens?.reduce((s, i) => s + i.quantidade, 0) ?? 0
              return (
                <Fragment key={p.id}>
                  <tr onClick={() => setExpandido(aberto ? null : p.id)} style={{ cursor: 'pointer' }} title={aberto ? 'Ocultar itens' : 'Ver itens do pedido'}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <ChevronRight size={13} style={{ verticalAlign: -2, marginRight: 4, color: 'var(--text-3)', transform: aberto ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      {p.numero}
                      {nItens > 0 && <div className="muted-sm" style={{ fontWeight: 400, marginLeft: 21 }}>{nItens} {nItens === 1 ? 'item' : 'itens'}</div>}
                    </td>
                    <td>{p.cliente}<div className="muted-sm">{p.email}</div></td>
                    <td>{p.pais}</td>
                    <td>{fmt(p.valor)}</td>
                    <td><span className={`tag ${statusPedido[p.status].cls}`}>{statusPedido[p.status].label}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.rastreio}</td>
                    <td className="muted-sm">{new Date(p.criadoEm + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                  </tr>
                  {aberto && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--panel-soft)', padding: '10px 14px 12px 34px' }}>
                        {p.itens?.length ? (
                          p.itens.map((i, idx) => (
                            <div key={idx} className="row gap-8" style={{ padding: '4px 0', fontSize: 13 }}>
                              <MiniFoto src={fotoDe(i)} alt={i.titulo} tamanho={32} />
                              <span className="tag tag-outro">{i.quantidade}×</span>
                              <b>{i.titulo}</b>
                              {i.variante && <span className="muted-sm">{i.variante}</span>}
                              {i.preco ? <span className="muted-sm" style={{ marginLeft: 'auto' }}>{fmt(i.preco)} cada</span> : null}
                            </div>
                          ))
                        ) : (
                          <span className="muted-sm">Itens ainda não sincronizados — clique em Sincronizar no topo para carregar os itens deste pedido.</span>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
