import { CheckCircle2 } from 'lucide-react'
import { useStore } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState, TipCard } from '../components/Shared'

export default function Aprovacoes() {
  const { aguardandoAprovacao } = useStore()

  return (
    <>
      <TicketListPage
        tickets={aguardandoAprovacao}
        empty={
          <EmptyState icon={<CheckCircle2 />} title="Nenhum rascunho aguardando aprovação.">
            Quando o atendo gerar uma resposta que precise da sua aprovação, ela aparece aqui para você revisar e enviar.
          </EmptyState>
        }
      />
      <TipCard
        id="tip-aprovacoes"
        title="Aprove antes de enviar"
        text="Respostas prontas que precisam do seu ok. Revise, edite e envie com um clique."
        items={['Revise a resposta e a confiança', 'Edite se precisar', 'Aprove e envie']}
      />
    </>
  )
}
