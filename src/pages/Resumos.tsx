import { useState } from 'react'
import { CalendarDays, Inbox as InboxIcon, Send, Shield, Package, Sparkles, Copy, Check, ClipboardList, X } from 'lucide-react'
import { useStore, nomeCategoria } from '../store'
import type { ResumoDiario, Ticket } from '../store'
import { EmptyState } from '../components/Shared'

const formatarDia = (dia: string) => {
  const texto = new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return texto[0].toUpperCase() + texto.slice(1)
}

export default function Resumos() {
  const s = useStore()
  const multiLoja = s.lojasVisiveis.length > 1
  const nomeLoja = (id?: string) => s.lojas.find(l => l.id === (id ?? 'loja1'))?.nome
  const [copiado, setCopiado] = useState<string | null>(null)

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

  /* ---- Relatório manual: só os casos que o lojista marcou nas conversas ---- */
  const numeroDoTicket = (t: Ticket) => {
    // mesma busca do painel do ticket: remetente + e-mails e números citados na conversa
    const texto = [t.assunto, t.corpo, t.resposta, ...(t.historico?.map(m => m.corpo) ?? [])].join('\n').toLowerCase()
    const emails = new Set([t.de.trim().toLowerCase(), ...(texto.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [])])
    const numeroCitado = texto.match(/(?:#\s?|\b(?:pedido|encomenda|order|bestell(?:ung|ing)?|bestelling|commande|ordine)\s*(?:nr\.?|n[º°o]\.?|#)?\s*)(\d{3,7})\b/i)?.[1] ?? null
    const doCliente = s.pedidos.find(p =>
      (p.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1')
      && ((p.email && emails.has(p.email.trim().toLowerCase()))
        || (numeroCitado !== null && p.numero.replace(/\D/g, '') === numeroCitado)))
    if (doCliente) return doCliente.numero.replace('#', '')
    return numeroCitado
  }
  const linhaDoTicket = (t: Ticket) => {
    const numero = numeroDoTicket(t)
    const quem = numero ? `PEDIDO ${numero}` : t.nome.toUpperCase()
    // texto escolhido no popup vem primeiro; sem ele, cai na resolução automática
    return `${quem} - ${t.relatorioTexto || t.resolucao || t.resumoSituacao || nomeCategoria[t.categoria] || 'atendido'}`
  }
  // s.tickets já vem filtrado pela loja ativa da seta lateral
  const manuaisDe = (dia: string) => s.tickets.filter(t => t.relatorioDia === dia)
  const manuaisHoje = s.hojeChave ? manuaisDe(s.hojeChave) : []

  const copiarManual = (dia: string) => {
    const itens = manuaisDe(dia)
    const [ano, mes, d] = dia.split('-')
    const linhas = [`RELATÓRIO ${d}/${mes}/${ano}`]
    const porLoja = new Map<string, Ticket[]>()
    for (const t of itens) {
      const chave = t.lojaId ?? 'loja1'
      porLoja.set(chave, [...(porLoja.get(chave) ?? []), t])
    }
    for (const [lojaId, ts] of porLoja) {
      linhas.push('', `Loja: ${nomeLoja(lojaId) ?? lojaId}`)
      for (const t of ts) linhas.push(linhaDoTicket(t))
    }
    navigator.clipboard.writeText(linhas.join('\n'))
    setCopiado(`manual-${dia}`)
    window.setTimeout(() => setCopiado(x => (x === `manual-${dia}` ? null : x)), 2500)
  }

  // Relatório do dia em texto, no formato de anotação do lojista:
  // RELATÓRIO 29/07 / Loja: X / PEDIDO 1419 - Reembolso 100% aprovado ...
  const copiarRelatorio = (r: ResumoDiario) => {
    const clientesDoDia = lojaFiltro ? r.clientes.filter(c => (c.lojaId ?? 'loja1') === lojaFiltro) : r.clientes
    const [ano, mes, dia] = r.dia.split('-')
    const linhas = [`RELATÓRIO ${dia}/${mes}/${ano}`]
    const porLoja = new Map<string, typeof clientesDoDia>()
    for (const c of clientesDoDia) {
      const chave = c.lojaId ?? 'loja1'
      porLoja.set(chave, [...(porLoja.get(chave) ?? []), c])
    }
    for (const [lojaId, clientes] of porLoja) {
      linhas.push('', `Loja: ${nomeLoja(lojaId) ?? lojaId}`)
      for (const c of clientes) {
        const quem = c.pedidos[0] ? `PEDIDO ${c.pedidos[0].replace('#', '')}` : c.nome.toUpperCase()
        const oque = c.resolucao || c.situacao || nomeCategoria[c.categoria] || 'atendido'
        linhas.push(`${quem} - ${oque}`)
      }
    }
    navigator.clipboard.writeText(linhas.join('\n'))
    setCopiado(r.id)
    window.setTimeout(() => setCopiado(x => (x === r.id ? null : x)), 2500)
  }

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

      {/* Relatório manual: casos marcados à mão nas conversas */}
      <div className="card mb-16" style={{ padding: '14px 18px' }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row gap-8">
            <ClipboardList size={15} color="var(--purple)" />
            <b style={{ fontSize: 14 }}>Relatório manual de hoje</b>
            <span className="muted-sm">{manuaisHoje.length} caso{manuaisHoje.length !== 1 ? 's' : ''}</span>
          </div>
          {manuaisHoje.length > 0 && s.hojeChave && (
            <button className="btn btn-sm" onClick={() => copiarManual(s.hojeChave!)}>
              {copiado === `manual-${s.hojeChave}` ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar relatório</>}
            </button>
          )}
        </div>
        {manuaisHoje.length === 0 ? (
          <p className="muted-sm" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Abra uma conversa e clique em "Adicionar ao relatório" — só os casos que você marcar entram aqui.
          </p>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
            {manuaisHoje.map(t => (
              <div key={t.id} className="row gap-8" style={{ fontSize: 13, padding: '3px 0' }}>
                <span style={{ flex: 1 }}>{linhaDoTicket(t)}</span>
                <span className="muted-sm">{nomeLoja(t.lojaId)}</span>
                <button title="Remover do relatório" style={{ color: 'var(--text-3)' }}
                  onClick={() => s.alternarRelatorio(t.id, false)}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
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
                  {stats.atendimentos > 0 && (
                    <button className="btn btn-sm" onClick={() => copiarRelatorio(r)} title="Copiar o relatório do dia em texto (todos os atendidos)">
                      {copiado === r.id ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar relatório</>}
                    </button>
                  )}
                  {manuaisDe(r.dia).length > 0 && (
                    <button className="btn btn-sm" onClick={() => copiarManual(r.dia)} title="Copiar só os casos marcados à mão neste dia">
                      {copiado === `manual-${r.dia}` ? <><Check size={13} /> Copiado</> : <><ClipboardList size={13} /> Manual ({manuaisDe(r.dia).length})</>}
                    </button>
                  )}
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
                        <span style={{ flex: 1, minWidth: 160, lineHeight: 1.45 }}>
                          {c.resolucao && <span style={{ fontSize: 12.5, display: 'block' }}><Check size={11} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--green)' }} />{c.resolucao}</span>}
                          {c.situacao && <span className="muted-sm">{c.situacao}</span>}
                        </span>
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
