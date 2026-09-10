import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useStore, nomeCategoria } from '../store'
import type { Categoria } from '../store'
import { TicketListPage } from '../components/Tickets'
import { EmptyState, TipCard } from '../components/Shared'

export default function AtendimentoHumano() {
  const { casosHumanos } = useStore()
  const [cat, setCat] = useState<Categoria | 'todas'>('todas')

  // do mais recente para o mais antigo, como o resto do app
  const fila = [...casosHumanos].sort((a, b) => (b.data || '').localeCompare(a.data || ''))

  const porCategoria = new Map<string, number>()
  for (const t of fila) porCategoria.set(t.categoria, (porCategoria.get(t.categoria) ?? 0) + 1)
  // o filtro escolhido pode ficar vazio (último caso da categoria resolvido) — volta para "Todos"
  const catEfetiva = cat !== 'todas' && porCategoria.has(cat) ? cat : 'todas'
  const filtrada = catEfetiva === 'todas' ? fila : fila.filter(t => t.categoria === catEfetiva)

  return (
    <>
      <TicketListPage
        tickets={filtrada}
        header={
          <div className="mb-16">
            <h1 className="h2">Atendimento humano</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              Emails que precisam de uma decisão ou consulta sua — o atendo sinalizou que não deve responder sozinho.
            </p>
            <p className="muted-sm" style={{ marginTop: 8, lineHeight: 1.6 }}>
              Estes <b>nunca</b> saem no automático, mesmo com o modo automático ligado — é a trava de segurança.
              Em <b>Configurações → Automação</b> você escolhe o que cai aqui: reembolsos e casos sensíveis, e respostas
              abaixo da confiança mínima.
            </p>
            {fila.length > 0 && (
              <div className="row gap-8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className={'chip' + (catEfetiva === 'todas' ? ' active' : '')} onClick={() => setCat('todas')}>
                  Todos ({fila.length})
                </button>
                {(Object.keys(nomeCategoria) as Categoria[]).filter(c => porCategoria.has(c)).map(c => (
                  <button key={c} className={'chip' + (catEfetiva === c ? ' active' : '')} onClick={() => setCat(c)}>
                    {nomeCategoria[c]} ({porCategoria.get(c)})
                  </button>
                ))}
              </div>
            )}
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
