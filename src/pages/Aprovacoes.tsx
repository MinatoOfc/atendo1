import { CheckCircle2, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState, TipCard } from '../components/Shared'

export default function Aprovacoes() {
  const { aguardandoAprovacao, config, setConfig } = useStore()
  const nav = useNavigate()

  const banner = !config.automacaoAtiva ? (
    <div className="banner card-purple mb-16" style={{ flexWrap: 'wrap' }}>
      <Zap size={15} color="var(--purple)" />
      <span style={{ flex: 1, minWidth: 260 }}>
        <b>Modo automático desligado.</b> Estas respostas ficam aqui esperando você aprovar uma a uma.
      </span>
      <button className="btn btn-primary btn-sm" onClick={() => setConfig({ automacaoAtiva: true })}>
        Deixar o atendo enviar sozinho
      </button>
      <button className="btn-ghost btn-sm" onClick={() => nav('/configuracoes')}>ajustar regras</button>
    </div>
  ) : (
    <div className="banner card-soft mb-16">
      <Zap size={15} color="var(--green)" />
      <span>
        <b>Modo automático ligado.</b> No atendimento clássico, cada resposta sai sozinha{' '}
        {config.atrasoMinutos > 0 ? `${config.atrasoMinutos} min depois de chegar` : 'assim que chega'} — o contador mostra quando.
        {' '}No modo novo a cadência é fixa: primeira resposta automática após 3 minutos; depois que o cliente responder, próxima
        resposta automática após 5 horas; uma nova mensagem reinicia o relógio.
      </span>
    </div>
  )

  return (
    <>
      <TicketListPage
        tickets={aguardandoAprovacao}
        header={banner}
        empty={
          <>
            {banner}
            <EmptyState icon={<CheckCircle2 />} title="Nenhum rascunho aguardando aprovação.">
              Quando o atendo gerar uma resposta que precise da sua aprovação, ela aparece aqui para você revisar e enviar.
            </EmptyState>
          </>
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
