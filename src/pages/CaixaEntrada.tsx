import { useState } from 'react'
import { Inbox, ChevronDown } from 'lucide-react'
import { useStore, nomeCategoria } from '../store'
import type { Categoria } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState } from '../components/Shared'

export default function CaixaEntrada() {
  const { tickets } = useStore()
  const [origem, setOrigem] = useState<'clientes' | 'shopify' | 'todos'>('clientes')
  const [leitura, setLeitura] = useState<'todos' | 'nao' | 'lidos'>('todos')
  const [categoria, setCategoria] = useState<Categoria | 'todas'>('todas')

  const lista = tickets.filter(t => {
    if (t.status !== 'inbox' && t.status !== 'aprovacao' && t.status !== 'humano') return false
    if (origem === 'clientes' && t.origem !== 'cliente') return false
    if (origem === 'shopify' && t.origem !== 'shopify') return false
    if (leitura === 'nao' && t.lido) return false
    if (leitura === 'lidos' && !t.lido) return false
    if (categoria !== 'todas' && t.categoria !== categoria) return false
    return true
  })

  const header = (
    <div className="row spread mb-16" style={{ flexWrap: 'wrap', gap: 10 }}>
      <div className="row gap-8">
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
      empty={
        <EmptyState icon={<Inbox />} title="Nenhum ticket nestes filtros.">
          Tudo respondido por aqui. Novos e-mails de clientes aparecem nesta lista — use o botão Sincronizar acima para buscar.
        </EmptyState>
      }
    />
  )
}
