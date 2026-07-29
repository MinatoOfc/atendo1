import { CalendarDays, Inbox as InboxIcon, Send, Shield, Package, Sparkles } from 'lucide-react'
import { useStore, nomeCategoria } from '../store'
import { EmptyState } from '../components/Shared'

const formatarDia = (dia: string) => {
  const texto = new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return texto[0].toUpperCase() + texto.slice(1)
}

export default function Resumos() {
  const s = useStore()
  const multiLoja = s.lojasVisiveis.length > 1
  const nomeLoja = (id?: string) => s.lojas.find(l => l.id === (id ?? 'loja1'))?.nome

  // loja selecionada na seta lateral: mostra só o recorte dela; "todas" = consolidado
  const lojaFiltro = s.lojaAtiva !== 'todas' ? s.lojaAtiva : null
  const zerado = { atendimentos: 0, recebidos: 0, spam: 0, categorias: {} as Record<string, number> }
  const statsDe = (r: NonNullable<typeof s.resumosDiarios>[number]) =>
    lojaFiltro ? (r.porLoja?.[lojaFiltro] ?? zerado) : r
  const resumos = (s.resumosDiarios ?? []).filter(r => {
    if (!lojaFiltro) return true
    const st = statsDe(r)
    return st.atendimentos + st.recebidos + st.spam > 0
  })

  // livro-caixa da IA: gasto do dia, respeitando a loja selecionada
  const gastoDoDia = (dia: string) => {
    const d = (s.gastosIA ?? {})[dia]
    if (!d) return 0
    return lojaFiltro ? (d[lojaFiltro] ?? 0) : Object.values(d).reduce((a, b) => a + b, 0)
  }
  const fmtGasto = (v: number) => `US$ ${v.toFixed(v > 0 && v < 0.1 ? 4 : 2)}`
  const gastoHoje = s.hojeChave ? gastoDoDia(s.hojeChave) : 0

  return (
    <div className="content-narrow">
      <div className="mb-16">
        <h1 className="h2">Resumo diário{lojaFiltro ? ` — ${nomeLoja(lojaFiltro) ?? lojaFiltro}` : ''}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Todo dia à meia-noite o atendo fecha o dia anterior: quem foi atendido, os pedidos envolvidos e a divisão dos casos. Gerado sem gastar IA.
          {lojaFiltro
            ? ' Mostrando só esta loja — para o consolidado, escolha "Todas as lojas" na seta lateral.'
            : multiLoja ? ' Para ver uma loja específica, selecione-a na seta lateral.' : ''}
        </p>
      </div>

      {/* Gasto de IA de hoje, ainda em andamento */}
      <div className="card mb-16" style={{ padding: '14px 18px' }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row gap-8">
            <Sparkles size={15} color="var(--purple)" />
            <b style={{ fontSize: 14 }}>Gasto de IA hoje{lojaFiltro ? ` — ${nomeLoja(lojaFiltro) ?? ''}` : ''}</b>
          </div>
          <b style={{ fontSize: 15 }}>{fmtGasto(gastoHoje)}</b>
        </div>
        <p className="muted-sm" style={{ marginTop: 4 }}>Parcial do dia em andamento — fecha à meia-noite junto com o resumo.</p>
      </div>

      {resumos.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={lojaFiltro ? 'Nenhum resumo para esta loja ainda.' : 'Nenhum resumo ainda.'}>
          O primeiro fechamento aparece logo depois da próxima meia-noite. Cada dia vira um cartão aqui, do mais recente ao mais antigo.
        </EmptyState>
      ) : (
        resumos.map(r => {
          const stats = statsDe(r)
          const clientes = lojaFiltro ? r.clientes.filter(c => (c.lojaId ?? 'loja1') === lojaFiltro) : r.clientes
          const totalCat = Object.values(stats.categorias).reduce((a, b) => a + b, 0)
          const categorias = Object.entries(stats.categorias).sort((a, b) => b[1] - a[1])
          return (
            <div key={r.id} className="card mb-16" style={{ padding: '18px 20px' }}>
              <div className="row spread mb-12" style={{ flexWrap: 'wrap', gap: 10 }}>
                <b style={{ fontSize: 15 }}>{formatarDia(r.dia)}</b>
                <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                  <span className="tag tag-green"><Send size={11} style={{ marginRight: 4 }} />{stats.atendimentos} atendido{stats.atendimentos !== 1 ? 's' : ''}</span>
                  <span className="tag tag-outro"><InboxIcon size={11} style={{ marginRight: 4 }} />{stats.recebidos} recebido{stats.recebidos !== 1 ? 's' : ''}</span>
                  {stats.spam > 0 && <span className="tag tag-amber"><Shield size={11} style={{ marginRight: 4 }} />{stats.spam} spam</span>}
                  {gastoDoDia(r.dia) > 0 && <span className="tag tag-purple" title="Gasto de IA no dia"><Sparkles size={11} style={{ marginRight: 4 }} />{fmtGasto(gastoDoDia(r.dia))}</span>}
                </div>
              </div>

              {stats.atendimentos === 0 ? (
                <p className="muted-sm">Nenhum atendimento neste dia.</p>
              ) : (
                <>
                  {/* Divisão dos casos: "60% reembolso, 20% entrega…" */}
                  <div className="mb-12" style={{ display: 'grid', gap: 6 }}>
                    {categorias.map(([cat, n]) => {
                      const pct = Math.round((n / totalCat) * 100)
                      return (
                        <div key={cat} className="row gap-10">
                          <span style={{ width: 150, fontSize: 13 }}>
                            <b>{pct}%</b> {nomeCategoria[cat as keyof typeof nomeCategoria] ?? cat}
                          </span>
                          <div className="progressbar" style={{ flex: 1, width: 'auto' }}>
                            <div style={{ width: `${pct}%` }} />
                          </div>
                          <span className="muted-sm" style={{ width: 24, textAlign: 'right' }}>{n}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Quem foi atendido */}
                  <div style={{ display: 'grid', gap: 6 }}>
                    {clientes.map((c, i) => (
                      <div key={i} className="row gap-10" style={{ padding: '7px 0', borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap' }}>
                        <div className="avatar-sm" style={{ flexShrink: 0 }}>{(c.nome[0] ?? '?').toUpperCase()}</div>
                        <div style={{ minWidth: 170 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.nome}</div>
                          <div className="muted-sm">{c.email}</div>
                        </div>
                        {c.situacao && <span className="muted-sm" style={{ flex: 1, minWidth: 160, lineHeight: 1.45 }}>{c.situacao}</span>}
                        <div className="row gap-8" style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
                          {c.pedidos.map(p => <span key={p} className="tag tag-rastreio"><Package size={10} style={{ marginRight: 3 }} />{p}</span>)}
                          {multiLoja && nomeLoja(c.lojaId) && <span className="tag tag-purple">{nomeLoja(c.lojaId)}</span>}
                          <span className={`tag tag-${c.categoria}`}>{nomeCategoria[c.categoria] ?? c.categoria}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
