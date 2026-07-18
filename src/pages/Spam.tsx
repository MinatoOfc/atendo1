import { Shield } from 'lucide-react'
import { useStore } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState, TipCard } from '../components/Shared'

export default function Spam() {
  const { tickets } = useStore()
  const lista = tickets.filter(t => t.status === 'spam')

  return (
    <>
      <TicketListPage
        tickets={lista}
        header={
          <div className="banner card-soft mb-16">
            <Shield size={15} /> <b>Spam</b> · Ofertas, vendas, consultoria e cold-outreach caem aqui automaticamente.
          </div>
        }
        empty={
          <EmptyState icon={<Shield />} title="Nenhum email em spam.">
            Ofertas e cold-outreach que chegarem aparecem aqui — fora da sua caixa de entrada.
          </EmptyState>
        }
      />
      <TipCard
        id="tip-spam"
        title="O que não é cliente, fora do caminho"
        text="Ofertas e prospecção fria são separadas automaticamente. Marque para o filtro ficar mais afiado."
        items={['Revise o que caiu como spam', 'Marque erros para o filtro aprender']}
      />
    </>
  )
}
