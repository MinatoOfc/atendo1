import { useState } from 'react'
import { CalendarDays, Inbox as InboxIcon, Send, Shield, Package, Sparkles, Copy, Check, ClipboardList, X, Link2, Pencil, CornerUpLeft, Wallet } from 'lucide-react'
import { useStore, nomeCategoria } from '../store'
import type { ResumoDiario, Ticket, RelatorioReembolsos } from '../store'
import { EmptyState, Modal } from '../components/Shared'

const formatarDia = (dia: string) => {
  const texto = new Date(dia + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return texto[0].toUpperCase() + texto.slice(1)
}

// dia anterior no formato AAAA-MM-DD (meio-dia evita surpresa de fuso)
const diaAnterior = (dia: string) => new Date(new Date(dia + 'T12:00:00').getTime() - 86400_000).toISOString().slice(0, 10)
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/* Mesmos dados principais do link externo, só que compactos: ação, percentual,
   valor, cliente e produtos. Tudo sai de relatorioDetalhes/relatorioAuto — o que
   não estiver provado simplesmente não aparece (nunca vira zero). */
const ROTULO_TIPO_REL: Record<string, string> = {
  reembolso: 'Reembolso', troca: 'Troca', reenvio: 'Reenvio', cancelamento: 'Cancelamento', cupom: 'Cupom', outro: 'Atendido',
}
const SIMBOLO_REL: Record<string, string> = { EUR: '€', BRL: 'R$', USD: 'US$', GBP: '£' }
const dinheiroRel = (valor: number | null | undefined, moeda: string | null | undefined) =>
  valor == null ? null : `${SIMBOLO_REL[moeda ?? ''] ?? moeda ?? ''} ${valor.toFixed(2).replace('.', ',')}`.trim()

function dadosCompactos(t: Ticket) {
  const d = t.relatorioDetalhes?.versao === 1 ? t.relatorioDetalhes : null
  const auto = t.relatorioAuto ?? null
  const tipo = d?.tipo ?? (auto ? 'reembolso' : null)
  const percentual = auto?.percentual ?? d?.percentual ?? null
  const valor = tipo === 'cupom' ? null : (auto?.valor ?? d?.valor ?? null)
  const moeda = auto?.moeda ?? d?.moeda ?? null
  const acao = tipo ? `${ROTULO_TIPO_REL[tipo] ?? tipo}${percentual != null ? ` ${percentual}%` : ''}` : null
  return {
    cliente: d?.clienteNome ?? null,
    email: d?.clienteEmail ?? null,
    produtos: (d?.produtos ?? []).map(p => p.titulo + (p.variante ? ` (${p.variante})` : '')),
    acao,
    valorTexto: valor != null ? dinheiroRel(valor, moeda) : (tipo && tipo !== 'cupom' && tipo !== 'outro' ? 'Valor não registrado' : null),
    cupom: auto?.cupom ?? null,
  }
}

export default function Resumos() {
  const s = useStore()
  const multiLoja = s.lojasVisiveis.length > 1
  const nomeLoja = (id?: string) => s.lojas.find(l => l.id === (id ?? 'loja1'))?.nome
  const [copiado, setCopiado] = useState<string | null>(null)
  // edição inline da linha do relatório manual (o que o chefe vê no link)
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null)
  // relatório de reembolsos (todas as lojas), gerado sob demanda
  const [reembolsos, setReembolsos] = useState<RelatorioReembolsos | null>(null)
  const [gerandoReembolsos, setGerandoReembolsos] = useState(false)

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
    if (t.relatorioLinha) return t.relatorioLinha // linha editada à mão tem a palavra final
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
      for (const t of ts) {
        linhas.push(linhaDoTicket(t))
        // o chefe precisa ver pedido, cliente, produto, ação, percentual e valor
        const c = dadosCompactos(t)
        const extras = [
          c.cliente ? `Cliente: ${c.cliente}${c.email ? ` <${c.email}>` : ''}` : null,
          c.produtos.length ? `Produto: ${c.produtos.join(', ')}` : null,
          c.acao, c.valorTexto, c.cupom ? `Cupom: ${c.cupom}` : null,
        ].filter(Boolean)
        if (extras.length) linhas.push('   ' + extras.join(' · '))
      }
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
            <div className="row gap-8">
              <button className="btn btn-sm"
                title="Atendeu depois da meia-noite? Junta os casos de hoje no relatório de ontem"
                onClick={() => {
                  if (window.confirm(`Mover os ${manuaisHoje.length} casos de hoje para o relatório de ${ddmm(diaAnterior(s.hojeChave!))}?`)) {
                    s.moverRelatorio(s.hojeChave!, diaAnterior(s.hojeChave!))
                  }
                }}>
                <CornerUpLeft size={13} /> Mover para ontem
              </button>
              <button className="btn btn-sm" onClick={() => copiarManual(s.hojeChave!)}>
                {copiado === `manual-${s.hojeChave}` ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar relatório</>}
              </button>
            </div>
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
                {editando?.id === t.id ? (
                  <>
                    <input value={editando.texto} autoFocus
                      onChange={e => setEditando({ id: t.id, texto: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { s.editarLinhaRelatorio(t.id, editando.texto.trim()); setEditando(null) }
                        if (e.key === 'Escape') setEditando(null)
                      }}
                      style={{ flex: 1, border: '1px solid var(--purple-border)', borderRadius: 6, padding: '4px 9px', fontSize: 13, outline: 'none', background: 'var(--panel)' }} />
                    <button title="Salvar linha" style={{ color: 'var(--green)' }}
                      onClick={() => { s.editarLinhaRelatorio(t.id, editando.texto.trim()); setEditando(null) }}><Check size={14} /></button>
                    <button title="Cancelar" style={{ color: 'var(--text-3)' }} onClick={() => setEditando(null)}><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {linhaDoTicket(t)}{t.relatorioLinha && <span className="muted-sm" style={{ marginLeft: 6 }}>(editada)</span>}
                      {(() => {
                        const c = dadosCompactos(t)
                        const partes = [c.acao, c.valorTexto, c.cliente, c.produtos.join(', ') || null].filter(Boolean)
                        if (!partes.length) return null
                        return <span className="muted-sm" style={{ display: 'block', marginTop: 1 }}>{partes.join(' · ')}</span>
                      })()}
                    </span>
                    {t.relatorioProcessado && (
                      <span className="tag tag-green" title={'Processado pelo dono em ' + new Date(t.relatorioProcessado).toLocaleString('pt-BR')}>✓ processado</span>
                    )}
                    <span className="muted-sm">{nomeLoja(t.lojaId)}</span>
                    <button title="Editar a linha (o que aparece no link e no copiar)" style={{ color: 'var(--text-3)' }}
                      onClick={() => setEditando({ id: t.id, texto: linhaDoTicket(t) })}><Pencil size={13} /></button>
                    <button title="Remover do relatório" style={{ color: 'var(--text-3)' }}
                      onClick={() => s.alternarRelatorio(t.id, false)}><X size={14} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Relatório de reembolsos: todas as lojas, com valor e motivo do cliente */}
      <div className="card mb-16" style={{ padding: '14px 18px' }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row gap-8">
            <Wallet size={15} color="var(--purple)" />
            <b style={{ fontSize: 14 }}>Relatório de reembolsos</b>
          </div>
          <button className="btn btn-sm" disabled={gerandoReembolsos}
            onClick={async () => {
              setGerandoReembolsos(true)
              const r = await s.relatorioReembolsos()
              setGerandoReembolsos(false)
              setReembolsos(r)
              // abre o link de acompanhamento assim que o relatório fica pronto
              if (r.link) window.open(r.link, '_blank', 'noopener')
            }}>
            <Wallet size={13} /> {gerandoReembolsos ? 'Lendo as conversas…' : 'Gerar relatório'}
          </button>
        </div>
        <p className="muted-sm" style={{ marginTop: 6, lineHeight: 1.5 }}>
          Junta todos os reembolsos que você marcou no relatório manual, de <b>todas as lojas</b>, com o valor pago do
          pedido e o motivo que o cliente alegou. Ao gerar, abre um link de acompanhamento com gráficos e filtro de
          período (hoje, 7 dias, 30 dias, tudo) — sem login, e <b>atualizado sozinho toda semana</b>. A IA só lê os
          reembolsos novos: os motivos já lidos ficam guardados e não são cobrados de novo.
        </p>
        {s.reembolsosLink && (
          <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <input readOnly value={window.location.origin + s.reembolsosLink}
              onFocus={e => e.currentTarget.select()}
              style={{ flex: 1, minWidth: 220, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, background: 'var(--panel-soft)', color: 'var(--text-2)' }} />
            <button className="btn btn-sm" onClick={() => {
              navigator.clipboard.writeText(window.location.origin + s.reembolsosLink!)
              setCopiado('link-reembolsos')
              window.setTimeout(() => setCopiado(x => (x === 'link-reembolsos' ? null : x)), 2500)
            }}>
              {copiado === 'link-reembolsos' ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar link</>}
            </button>
            <button className="btn btn-sm" onClick={() => window.open(s.reembolsosLink!, '_blank', 'noopener')}>
              <Link2 size={13} /> Abrir
            </button>
          </div>
        )}
        {s.reembolsosEm && (
          <p className="muted-sm" style={{ marginTop: 6 }}>
            Último relatório gerado em {new Date(s.reembolsosEm).toLocaleString('pt-BR')} — o link mostra esse resultado
            até você gerar de novo. Revogar o link de acompanhamento abaixo também derruba este.
          </p>
        )}
      </div>

      {/* Link público para o chefe acompanhar os relatórios manuais sem login */}
      <div className="card mb-16" style={{ padding: '14px 18px' }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row gap-8">
            <Link2 size={15} color="var(--purple)" />
            <b style={{ fontSize: 14 }}>Link para acompanhamento</b>
          </div>
          {!s.relatorioLink && (
            <button className="btn btn-sm btn-primary" onClick={() => s.configurarRelatorioLink('criar')}>
              <Link2 size={13} /> Criar link
            </button>
          )}
        </div>
        {s.relatorioLink ? (
          <>
            <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <input readOnly value={window.location.origin + s.relatorioLink}
                onFocus={e => e.currentTarget.select()}
                style={{ flex: 1, minWidth: 220, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, background: 'var(--panel-soft)', color: 'var(--text-2)' }} />
              <button className="btn btn-sm" onClick={() => {
                navigator.clipboard.writeText(window.location.origin + s.relatorioLink!)
                setCopiado('link-relatorio')
                window.setTimeout(() => setCopiado(x => (x === 'link-relatorio' ? null : x)), 2500)
              }}>
                {copiado === 'link-relatorio' ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar link</>}
              </button>
              <button className="btn btn-sm btn-danger" title="O link atual para de funcionar na hora"
                onClick={() => s.configurarRelatorioLink('revogar')}>
                <X size={13} /> Revogar
              </button>
            </div>
            <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <span className="muted-sm">O dia de hoje aparece no link:</span>
              <button className={'chip' + (s.linkMostraHoje !== false ? ' active-purple' : '')}
                onClick={() => s.configurarRelatorioLink('mostrar-hoje', true)}>Em tempo real</button>
              <button className={'chip' + (s.linkMostraHoje === false ? ' active-purple' : '')}
                title="Você edita as linhas com calma; o dia entra no link depois da meia-noite"
                onClick={() => s.configurarRelatorioLink('mostrar-hoje', false)}>Só depois da meia-noite</button>
            </div>
            <p className="muted-sm" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Mande este link uma vez para quem precisa acompanhar (ex.: seu chefe): a página mostra os relatórios manuais de todos os dias, sempre atualizados, sem precisar de login. Use o lápis na lista acima para ajustar qualquer linha antes de ele ver. Se revogar, o link morre na hora.
            </p>
          </>
        ) : (
          <p className="muted-sm" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Crie um link secreto para alguém acompanhar os relatórios manuais direto no navegador, sem login e sem você precisar copiar e colar todo dia.
          </p>
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
                    <>
                      <button className="btn btn-sm" onClick={() => copiarManual(r.dia)}
                        title={`Copiar só os casos marcados à mão neste dia · ${manuaisDe(r.dia).filter(t => t.relatorioProcessado).length} de ${manuaisDe(r.dia).length} processados pelo dono`}>
                        {copiado === `manual-${r.dia}` ? <><Check size={13} /> Copiado</> : (
                          <><ClipboardList size={13} /> Manual ({manuaisDe(r.dia).filter(t => t.relatorioProcessado).length}/{manuaisDe(r.dia).length} ✓)</>
                        )}
                      </button>
                      <button className="btn btn-sm" title={`Mover os casos manuais deste dia para ${ddmm(diaAnterior(r.dia))} (virada de meia-noite)`}
                        onClick={() => {
                          if (window.confirm(`Mover os ${manuaisDe(r.dia).length} casos de ${ddmm(r.dia)} para o relatório de ${ddmm(diaAnterior(r.dia))}?`)) {
                            s.moverRelatorio(r.dia, diaAnterior(r.dia))
                          }
                        }}>
                        <CornerUpLeft size={13} /> {ddmm(diaAnterior(r.dia))}
                      </button>
                    </>
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
      {reembolsos && (
        <Modal title="Relatório de reembolsos" onClose={() => setReembolsos(null)} fecharFora={false}>
          {reembolsos.erro ? (
            <p className="muted-sm" style={{ color: 'var(--red)', lineHeight: 1.6 }}>{reembolsos.erro}</p>
          ) : !reembolsos.total ? (
            <p className="muted-sm" style={{ lineHeight: 1.6 }}>
              Nenhum reembolso no relatório manual ainda. Abra a conversa, clique em "Adicionar ao relatório" e escolha
              REEMBOLSO 100% ou REEMBOLSO 60% — esses casos passam a aparecer aqui.
            </p>
          ) : (
            <>
              <div className="row spread mb-12" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="muted-sm">
                  {reembolsos.total} reembolso{reembolsos.total !== 1 ? 's' : ''} em {reembolsos.grupos?.length} loja{reembolsos.grupos?.length !== 1 ? 's' : ''}
                  {reembolsos.resumo ? ` · ${reembolsos.resumo.reembolsado.toFixed(2).replace('.', ',')} ${reembolsos.resumo.moeda === 'EUR' ? '€' : reembolsos.resumo.moeda} reembolsados` : ''}
                  {reembolsos.lidosAgora ? ` · ${reembolsos.lidosAgora} motivo${reembolsos.lidosAgora !== 1 ? 's' : ''} lido${reembolsos.lidosAgora !== 1 ? 's' : ''} agora` : ' · nenhuma leitura nova'}
                  {reembolsos.custoIA ? ` (US$ ${reembolsos.custoIA.toFixed(4)})` : ''}
                </span>
                <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                  {reembolsos.link && (
                    <button className="btn btn-sm" onClick={() => {
                      navigator.clipboard.writeText(window.location.origin + reembolsos.link)
                      setCopiado('link-modal')
                      window.setTimeout(() => setCopiado(x => (x === 'link-modal' ? null : x)), 2500)
                    }}>
                      {copiado === 'link-modal' ? <><Check size={13} /> Link copiado</> : <><Link2 size={13} /> Copiar link</>}
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => {
                    navigator.clipboard.writeText(reembolsos.texto ?? '')
                    setCopiado('reembolsos')
                    window.setTimeout(() => setCopiado(x => (x === 'reembolsos' ? null : x)), 2500)
                  }}>
                    {copiado === 'reembolsos' ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar tudo</>}
                  </button>
                </div>
              </div>
              {reembolsos.aviso && (
                <div className="banner card-soft mb-12" style={{ fontSize: 12.5 }}>{reembolsos.aviso}</div>
              )}
              <div style={{ display: 'grid', gap: 14 }}>
                {reembolsos.grupos?.map(g => (
                  <div key={g.lojaId}>
                    <b style={{ fontSize: 13.5 }}>Loja {g.nome}</b>
                    <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
                      {g.itens.map(item => (
                        <div key={item.ticketId} style={{ fontSize: 13, lineHeight: 1.5 }}>
                          <b>{item.numero ? `#${item.numero}` : item.cliente}</b>
                          <span className="muted-sm"> ({item.valorTexto})</span> — {item.motivo}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
