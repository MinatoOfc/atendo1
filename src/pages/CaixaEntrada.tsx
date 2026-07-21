import { useState } from 'react'
import { Inbox, ChevronDown, Search } from 'lucide-react'
import { useStore, nomeCategoria } from '../store'
import type { Categoria } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState } from '../components/Shared'

// busca sem diferenciar maiúsculas nem acentos
const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function CaixaEntrada() {
  const { tickets, pedidos } = useStore()
  const [origem, setOrigem] = useState<'clientes' | 'shopify' | 'todos'>('clientes')
  const [leitura, setLeitura] = useState<'todos' | 'nao' | 'lidos'>('todos')
  const [categoria, setCategoria] = useState<Categoria | 'todas'>('todas')
  const [busca, setBusca] = useState('')

  // números de pedido por e-mail do cliente: buscar "1042" acha a conversa do dono do pedido #1042
  const pedidosPorEmail = new Map<string, string[]>()
  for (const p of pedidos) {
    if (!p.email) continue
    const k = p.email.trim().toLowerCase()
    pedidosPorEmail.set(k, [...(pedidosPorEmail.get(k) ?? []), p.numero])
  }

  const q = normalizar(busca.trim())
  const lista = tickets.filter(t => {
    // todos os e-mails recebidos, respondidos ou não — fora só spam e lixeira
    if (t.status === 'spam' || t.status === 'lixeira') return false
    // e-mails compostos do zero (nunca recebidos) ficam só em Enviados
    if (t.status === 'enviado' && !t.corpo && !t.historico?.length) return false
    if (origem === 'clientes' && t.origem !== 'cliente') return false
    if (origem === 'shopify' && t.origem !== 'shopify') return false
    if (leitura === 'nao' && t.lido) return false
    if (leitura === 'lidos' && !t.lido) return false
    if (categoria !== 'todas' && t.categoria !== categoria) return false
    if (q) {
      const numeros = pedidosPorEmail.get(t.de.trim().toLowerCase()) ?? []
      const bate = normalizar(t.nome).includes(q)
        || normalizar(t.de).includes(q)
        || normalizar(t.assunto).includes(q)
        || numeros.some(n => normalizar(n).includes(q))
      if (!bate) return false
    }
    return true
  })

  const header = (
    <div className="row spread mb-16" style={{ flexWrap: 'wrap', gap: 10 }}>
      <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={15} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Nome, e-mail ou nº do pedido" />
        </div>
        <button className={'chip' + (origem === 'clientes' ? ' active-purple' : '')} onClick={() => setOrigem('clientes')}>Clientes</button>
        <button className={'chip' + (origem === 'shopify' ? ' active-purple' : '')} onClick={() => setOrigem('shopify')}>Shopify</button>
        <button className={'chip' + (origem === 'todos' ? ' active-purple' : '')} onClick={() => setOrigem('todos')}>Todos</button>
      </div>
      <div className="row gap-8">
        <button className={'chip' + (leitura === 'todos' ? ' active' : '')} onClick={() => setLeitura('todos')}>Todos</button>
        <button className={'chip' + (leitura === 'nao' ? ' active' : '')} onClick={() => setLeitura('nao')}>Não lidos</button>
        <button className={'chip' + (leitura === 'lidos' ? ' active' : '')} onClick={() => setLeitura('lidos')}>Lidos</button>
        <div style={{ position: 'relative' }}>
          <select
            value={categoria}
            onChange={e => setCategoria(e.target.value as Categoria | 'todas')}
            className="chip"
            style={{ appearance: 'none', paddingRight: 28, cursor: 'pointer' }}
          >
            <option value="todas">Todas as categorias</option>
            {(Object.keys(nomeCategoria) as Categoria[]).map(c => <option key={c} value={c}>{nomeCategoria[c]}</option>)}
          </select>
          <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: 9, pointerEvents: 'none', color: 'var(--text-3)' }} />
        </div>
      </div>
    </div>
  )

  return (
    <TicketListPage
      tickets={lista}
      header={header}
      tagStatus
      empty={
        <EmptyState icon={<Inbox />} title="Nenhum ticket nestes filtros.">
          Todos os e-mails recebidos aparecem nesta lista, respondidos ou não — use o botão Sincronizar acima para buscar novos.
        </EmptyState>
      }
    />
  )
}
