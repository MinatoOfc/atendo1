import { useState } from 'react'
import { Contact, Search, ArrowLeft, Mail, Package as PackageIcon } from 'lucide-react'
import { useStore, tempoRelativo } from '../store'
import type { Ticket } from '../store'
import { TicketRow, TicketDetail } from '../components/Tickets'
import { EmptyState } from '../components/Shared'

// busca sem diferenciar maiúsculas nem acentos
const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Cliente {
  email: string
  nome: string
  conversas: Ticket[]
  ultima: string
  naoLidos: number
  custoIA: number
}

export default function Clientes() {
  const { tickets, pedidos, fmtMoeda } = useStore()
  const [busca, setBusca] = useState('')
  const [clienteSel, setClienteSel] = useState<string | null>(null)
  const [ticketAberto, setTicketAberto] = useState<string | null>(null)

  // agrupa por e-mail tudo que veio de cliente real (spam e lixeira ficam fora)
  const porEmail = new Map<string, Cliente>()
  for (const t of tickets) {
    if (t.status === 'spam' || t.status === 'lixeira') continue
    const email = t.de.trim().toLowerCase()
    const c = porEmail.get(email) ?? { email, nome: t.nome, conversas: [], ultima: t.data, naoLidos: 0, custoIA: 0 }
    c.conversas.push(t)
    if (t.data > c.ultima) c.ultima = t.data
    if (t.nome && t.nome !== email.split('@')[0]) c.nome = t.nome
    if (!t.lido) c.naoLidos++
    c.custoIA += t.custoIA ?? 0
    porEmail.set(email, c)
  }

  // números de pedido por e-mail: buscar "1042" acha o cliente dono do pedido #1042
  const pedidosPorEmail = new Map<string, string[]>()
  for (const p of pedidos) {
    if (!p.email) continue
    const k = p.email.trim().toLowerCase()
    pedidosPorEmail.set(k, [...(pedidosPorEmail.get(k) ?? []), p.numero])
  }

  const q = normalizar(busca.trim())
  const clientes = [...porEmail.values()]
    .filter(c => !q
      || normalizar(c.nome).includes(q)
      || normalizar(c.email).includes(q)
      || (pedidosPorEmail.get(c.email) ?? []).some(n => normalizar(n).includes(q)))
    .sort((a, b) => b.ultima.localeCompare(a.ultima))

  /* ---- detalhe de um ticket dentro do cliente ---- */
  const cliente = clienteSel ? porEmail.get(clienteSel) : null
  const ticket = cliente?.conversas.find(t => t.id === ticketAberto)
  if (cliente && ticket) {
    return <TicketDetail t={ticket} onBack={() => setTicketAberto(null)} />
  }

  /* ---- página de um cliente: todas as conversas dele ---- */
  if (cliente) {
    const pedidosDele = pedidos.filter(p => p.email && p.email.trim().toLowerCase() === cliente.email)
    const totalGasto = pedidosDele.reduce((s, p) => s + (p.valor || 0), 0)
    const conversas = [...cliente.conversas].sort((a, b) => b.data.localeCompare(a.data))
    return (
      <div className="content-narrow">
        <button className="btn btn-sm mb-16" onClick={() => setClienteSel(null)}><ArrowLeft size={13} /> Todos os clientes</button>
        <div className="card mb-16" style={{ padding: '18px 20px' }}>
          <div className="row gap-12" style={{ flexWrap: 'wrap' }}>
            <div className="avatar-sm" style={{ width: 42, height: 42, fontSize: 16, borderRadius: 10 }}>
              {(cliente.nome[0] ?? '?').toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="h2">{cliente.nome}</div>
              <div className="muted-sm row gap-8" style={{ marginTop: 3 }}><Mail size={12} /> {cliente.email}</div>
            </div>
            <div className="row gap-12" style={{ flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="h2">{conversas.length}</div>
                <div className="muted-sm">conversa{conversas.length !== 1 ? 's' : ''}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="h2">{pedidosDele.length}</div>
                <div className="muted-sm">pedido{pedidosDele.length !== 1 ? 's' : ''}</div>
              </div>
              {pedidosDele.length > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div className="h2">{fmtMoeda(totalGasto)}</div>
                  <div className="muted-sm">em compras</div>
                </div>
              )}
              {cliente.custoIA > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div className="h2">US$ {cliente.custoIA.toFixed(4)}</div>
                  <div className="muted-sm">custo de IA</div>
                </div>
              )}
            </div>
          </div>
          {pedidosDele.length > 0 && (
            <div className="row gap-8 muted-sm" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <PackageIcon size={12} />
              {pedidosDele.slice(0, 6).map(p => <span key={p.id} className="tag tag-outro">{p.numero} · {p.status}</span>)}
            </div>
          )}
        </div>
        <p className="muted-sm mb-8">Todas as conversas deste cliente, da mais recente à mais antiga — clique para ver mensagens e respostas.</p>
        <div className="card" style={{ overflow: 'hidden' }}>
          {conversas.map(t => <TicketRow key={t.id} t={t} onOpen={x => setTicketAberto(x.id)} tagStatus />)}
        </div>
      </div>
    )
  }

  /* ---- lista de clientes ---- */
  return (
    <div className="content-narrow">
      <div className="row spread mb-16" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="h2">Clientes</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {q ? `${clientes.length} de ${porEmail.size}` : porEmail.size} cliente{(q ? clientes.length : porEmail.size) !== 1 ? 's' : ''} que já chamaram o suporte.
          </p>
        </div>
        <div className="search-box">
          <Search size={15} />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, e-mail ou nº do pedido" />
        </div>
      </div>
      {clientes.length === 0 ? (
        <EmptyState icon={<Contact />} title={q ? `Nenhum cliente para “${busca.trim()}”.` : 'Nenhum cliente ainda.'}>
          {q ? 'Tente outro nome ou e-mail.' : 'Quando os primeiros e-mails de clientes chegarem, eles aparecem agrupados aqui.'}
        </EmptyState>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {clientes.map(c => (
            <button key={c.email} className="ticket-row" onClick={() => setClienteSel(c.email)}>
              <div className="avatar-sm" style={{ flexShrink: 0 }}>{(c.nome[0] ?? '?').toUpperCase()}</div>
              <span className="from" style={{ width: 210 }}>
                {c.nome}
                <div className="email">{c.email}</div>
              </span>
              <span className="subject">
                <span className="preview">{c.conversas[0] && `— ${c.conversas.slice().sort((a, b) => b.data.localeCompare(a.data))[0].assunto}`}</span>
              </span>
              {c.naoLidos > 0 && <span className="tag tag-purple">{c.naoLidos} não lido{c.naoLidos > 1 ? 's' : ''}</span>}
              <span className="tag tag-outro">{c.conversas.length} conversa{c.conversas.length !== 1 ? 's' : ''}</span>
              <span className="when">{tempoRelativo(c.ultima)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
