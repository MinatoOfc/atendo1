import { Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState, TipCard } from '../components/Shared'

export default function Lixeira() {
  const { tickets } = useStore()
  const lista = tickets.filter(t => t.status === 'lixeira')

  return (
    <>
      <TicketListPage
        tickets={lista}
        header={
          <div className="banner card-soft mb-16">
            <Trash2 size={15} /> <b>Lixeira</b> · Emails excluídos da caixa de entrada. Restaure ou exclua definitivamente.
          </div>
        }
        empty={
          <EmptyState icon={<Trash2 />} title="A lixeira está vazia.">
            E-mails que você excluir ficam aqui até esvaziar a lixeira.
          </EmptyState>
        }
      />
      <TipCard
        id="tip-lixeira"
        title="Lixeira"
        text="Conversas removidas ficam aqui antes de sumirem. Você pode restaurar se precisar."
        items={['Restaure o que foi removido por engano']}
      />
    </>
  )
}
