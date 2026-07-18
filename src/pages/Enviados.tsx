import { Send } from 'lucide-react'
import { useStore } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState } from '../components/Shared'

export default function Enviados() {
  const { tickets } = useStore()
  const lista = tickets
    .filter(t => t.status === 'enviado')
    .sort((a, b) => (b.respondidoEm ?? b.data).localeCompare(a.respondidoEm ?? a.data))

  return (
    <TicketListPage
      tickets={lista}
      empty={
        <EmptyState icon={<Send />} title="Nada enviado ainda.">
          Respostas aprovadas e e-mails que você escrever aparecem aqui, com o histórico completo da conversa.
        </EmptyState>
      }
    />
  )
}
