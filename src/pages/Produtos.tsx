import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ShoppingBag, RefreshCw, Search, ExternalLink, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { EmptyState, MiniFoto } from '../components/Shared'

export default function Produtos() {
  const s = useStore()
  const moeda = (v: number) => s.fmtMoeda(v)
  const nav = useNavigate()
  const [busca, setBusca] = useState('')
  const [sincronizando, setSincronizando] = useState(false)

  const sincronizar = async () => {
    setSincronizando(true)
    try { await s.testarShopify() } finally { setSincronizando(false) }
  }

  if (!s.config.shopifyConectada) {
    return (
      <EmptyState icon={<ShoppingBag />} title="Shopify não conectada">
        Os produtos da sua loja aparecem aqui assim que você conectar a Shopify — e o atendo passa a usá-los
        para responder o que a loja vende, com preço e link reais.
        <br />
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => nav('/configuracoes')}>
          Conectar Shopify →
        </button>
      </EmptyState>
    )
  }

  const lista = s.produtos.filter(p => {
    if (!busca.trim()) return true
    const t = busca.toLowerCase()
    return p.titulo.toLowerCase().includes(t) || p.tipo.toLowerCase().includes(t) || p.tags.some(x => x.toLowerCase().includes(t))
  })

  const ativos = s.produtos.filter(p => p.ativo).length
  const semEstoque = s.produtos.filter(p => p.ativo && p.estoque != null && p.estoque <= 0).length

  return (
    <div className="content-narrow">
      <div className="row spread mb-16" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="h2">Produtos</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            O catálogo que o atendo usa nas respostas — sincronizado da sua Shopify.
          </p>
        </div>
        {s.integracoes.shopify && (
          <button className="btn" onClick={sincronizar} disabled={sincronizando}>
            <RefreshCw size={14} style={sincronizando ? { animation: 'spin 0.9s linear infinite' } : undefined} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar catálogo'}
          </button>
        )}
      </div>

      <div className="banner card-purple mb-16">
        <Sparkles size={15} color="var(--purple)" />
        <span>
          <b>{ativos} produto{ativos !== 1 ? 's' : ''} ativo{ativos !== 1 ? 's' : ''}</b> no contexto da IA.
          Quando um cliente perguntar o que vocês vendem, ela responde com estes produtos, preços e links — nunca inventa.
          {semEstoque > 0 && <> {semEstoque} está{semEstoque !== 1 ? 'o' : ''} sem estoque e ela avisa isso ao cliente.</>}
        </span>
      </div>

      {s.produtos.length > 8 && (
        <div className="row gap-8 mb-12" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-3)' }} />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, categoria ou tag…"
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px 9px 34px', outline: 'none', fontSize: 13.5 }}
          />
        </div>
      )}

      {s.produtos.length === 0 ? (
        <EmptyState icon={<Package />} title="Nenhum produto sincronizado ainda.">
          Clique em "Sincronizar catálogo" acima. Se der erro de permissão, o app da Shopify precisa do escopo
          <code> read_products</code> — veja as instruções em Configurações.
        </EmptyState>
      ) : lista.length === 0 ? (
        <EmptyState icon={<Search />} title="Nenhum produto com esse termo.">
          Tente outra busca.
        </EmptyState>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {lista.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="row gap-10">
                      <MiniFoto src={p.imagem} alt={p.titulo} tamanho={34} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.titulo}</div>
                        {p.variantes.length > 0 && (
                          <div className="muted-sm">{p.variantes.slice(0, 5).join(' · ')}{p.variantes.length > 5 && ` +${p.variantes.length - 5}`}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="muted">{p.tipo || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.precoMin === p.precoMax ? moeda(p.precoMin) : `${moeda(p.precoMin)} – ${moeda(p.precoMax)}`}
                  </td>
                  <td>
                    {p.estoque == null ? (
                      <span className="tag tag-outro" title="A Shopify não informou o estoque — reconecte a loja com o escopo read_inventory">—</span>
                    ) : (
                      <span className={'tag ' + (p.estoque > 0 ? 'tag-green' : 'tag-amber')}>
                        {p.estoque > 0 ? p.estoque : 'esgotado'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={'tag ' + (p.ativo ? 'tag-purple' : 'tag-outro')}>{p.ativo ? 'ativo' : 'rascunho'}</span>
                  </td>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer" title="Ver na loja" style={{ color: 'var(--text-3)' }}>
                      <ExternalLink size={14} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
