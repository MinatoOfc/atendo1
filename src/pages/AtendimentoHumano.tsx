import { ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState, TipCard } from '../components/Shared'

export default function AtendimentoHumano() {
  const { casosHumanos } = useStore()

  return (
    <>
      <TicketListPage
        tickets={casosHumanos}
        header={
          <div className="mb-16">
            <h1 className="h2">Atendimento humano</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              Emails que precisam de uma decisão ou consulta sua — o atendo sinalizou que não deve responder sozinho.
            </p>
          </div>
        }
        empty={
          <EmptyState icon={<ShieldCheck />} title="Nada precisa de você agora.">
            Casos sensíveis ou críticos (fraude, jurídico, reembolso, urgência) caem aqui para você decidir. Nenhum no momento.
          </EmptyState>
        }
      />
      <TipCard
        id="tip-humano"
        title="Casos que pedem você"
        text="Mensagens sensíveis ou incertas que o atendo preferiu não responder sozinho. Você decide."
        items={['Entenda por que foi sinalizado', 'Responda ou escale']}
      />
    </>
  )
}
