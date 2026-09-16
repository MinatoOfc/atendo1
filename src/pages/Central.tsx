import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Workflow, Search, X, ExternalLink, Pencil, ArrowLeft } from 'lucide-react'
import { useStore } from '../store'
import type { Ticket } from '../store'
import { TicketDetail } from '../components/Tickets'
import { Modal } from '../components/Shared'
import { calcularCentral, relacaoComFase, ORDEM_JORNADAS, FILTROS_PADRAO } from '../../shared/central.js'
import type { Registro, Filtros, MetricaFase } from '../../shared/central.js'

const NOME_DESFECHO: Record<string, string> = {
  em_aberto: 'Em aberto', reembolso: 'Reembolso', troca: 'Troca', reenvio: 'Reenvio', cupom: 'Cupom', cancelamento: 'Cancelamento', encerrado: 'Encerrado',
}
const NOME_ORIGEM: Record<string, string> = { confirmada: 'confirmada', inferida: 'inferida', manual: 'manual', 'sem atendimento': 'sem atendimento' }
const fmtData = (ms: number) => new Date(ms).toLocaleDateString('pt-BR')
const fmtQuando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Central() {
  const s = useStore()
  const [params, setParams] = useSearchParams()
  const fases = s.fasesNovo ?? {}
  const jornadas = s.jornadasNovo ?? {}
  const [visao, setVisao] = useState<'mapa' | 'pedidos'>('mapa')
  const [filtros, setFiltros] = useState<Filtros>({ ...FILTROS_PADRAO })
  const [faseAberta, setFaseAberta] = useState<string | null>(null)
  const [abaFase, setAbaFase] = useState<'passaram' | 'pararam' | 'avancaram'>('passaram')
  const [buscaFase, setBuscaFase] = useState('')
  const [conversa, setConversa] = useState<string | null>(null)
  const [corrigindo, setCorrigindo] = useState<Registro | null>(null)

  // vindo do card da conversa: ?caso=<ticketId> abre a fase daquele caso —
  // mesmo se a Central já estiver aberta com outra conversa ou fase na tela
  const casoAlvo = params.get('caso')
  useEffect(() => { setConversa(null); setFaseAberta(null); setVisao('mapa') }, [casoAlvo])

  // cálculo único (shared/central.js) — o mesmo que o servidor devolve em GET /api/central
  const tudo = useMemo(() => calcularCentral({ tickets: s.todosTickets, pedidos: s.todosPedidos, lojas: s.lojas, fases }), [s.todosTickets, s.todosPedidos, s.lojas, fases])
  const filtrosEfetivos: Filtros = useMemo(() => {
    if (!casoAlvo) return filtros
    const c = tudo.casos.find(x => x.ticketId === casoAlvo)
    return c?.pedidoNumero ? { ...filtros, busca: c.pedidoNumero } : filtros
  }, [filtros, casoAlvo, tudo])
  const r = useMemo(() => calcularCentral({ tickets: s.todosTickets, pedidos: s.todosPedidos, lojas: s.lojas, fases, filtros: filtrosEfetivos }), [s.todosTickets, s.todosPedidos, s.lojas, fases, filtrosEfetivos])
  const { registros, linhas, metricas, indicadores: kpis } = r
  const dinheiro = (v: number, moeda: string) => s.fmtMoeda(v, moeda)
  const porMoeda = (m: MetricaFase) => {
    const pares = Object.entries(m.valorPorMoeda)
    return pares.length ? pares.map(([moeda, v]) => dinheiro(v, moeda)).join(' · ') : '—'
  }

  // caso vindo da conversa: abre a fase dele uma vez
  const faseDoAlvo = casoAlvo ? tudo.casos.find(x => x.ticketId === casoAlvo)?.faseAtual ?? null : null
  const faseSelecionada = faseAberta ?? faseDoAlvo
  const limparAlvo = () => { if (casoAlvo) setParams({}) }
  const setF = (patch: Partial<Filtros>) => { limparAlvo(); setFiltros(f => ({ ...f, ...patch })) }

  /* ---------- conversa aberta a partir da Central ---------- */
  const ticketAberto: Ticket | undefined = conversa ? s.todosTickets.find(t => t.id === conversa) : undefined
  if (ticketAberto) {
    return (
      <div>
        <button className="btn btn-sm mb-12" onClick={() => setConversa(null)}><ArrowLeft size={13} /> Voltar à Central</button>
        <TicketDetail t={ticketAberto} onBack={() => setConversa(null)} />
      </div>
    )
  }

  const registrosDaFase = faseSelecionada
    ? registros.filter(c => {
      const rel = relacaoComFase(c, faseSelecionada)
      if (!rel) return false
      if (abaFase === 'passaram') return true
      return rel === abaFase
    }).filter(c => !buscaFase.trim() || [c.pedidoNumero, c.produto, c.motivo, c.lojaNome, c.cliente].filter(Boolean).join(' ').toLowerCase().includes(buscaFase.toLowerCase()))
    : []

  const chipsPeriodo: Filtros['periodo'][] = ['7', '30', '90', 'todas']
  const fasesPorJornada = (j: string) => Object.keys(fases).filter(id => fases[id].jornada === j)

  return (
    <div className="content-wide" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="row spread mb-12" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="h2"><Workflow size={18} style={{ verticalAlign: -3, marginRight: 8, color: 'var(--purple)' }} />Central operacional</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Jornadas, fases e resultado dos casos de devolução, reembolso e entrega — de todas as lojas. As métricas das fases contam
            <b> só fases enviadas</b> (uma vez por pedido). Fase <b>inferida</b> (casos antigos) e <b>manual</b> (correção sua) aparecem
            na tabela e em contadores separados.
          </p>
        </div>
        <div className="row gap-8">
          <button className={'chip' + (visao === 'mapa' ? ' active' : '')} onClick={() => setVisao('mapa')}>Mapa do fluxo</button>
          <button className={'chip' + (visao === 'pedidos' ? ' active' : '')} onClick={() => setVisao('pedidos')}>Todos os pedidos ({linhas.length})</button>
        </div>
      </div>

      {/* filtros: agem ao mesmo tempo sobre cartões, jornadas, fases, painel e lista */}
      <div className="card mb-16" style={{ padding: '10px 14px' }}>
        <div className="row gap-8 central-filtros" style={{ flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={15} />
            <input value={filtrosEfetivos.busca} onChange={e => setF({ busca: e.target.value })} placeholder="Pedido, cliente, produto, motivo ou loja" />
          </div>
          <select className="chip" value={filtros.lojaId} onChange={e => setF({ lojaId: e.target.value })} style={{ cursor: 'pointer' }}>
            <option value="todas">Todas as lojas</option>
            {s.lojas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <div className="row gap-4">
            {chipsPeriodo.map(p => (
              <button key={p} className={'chip' + (filtros.periodo === p ? ' active' : '')} onClick={() => setF({ periodo: p })}>
                {p === 'todas' ? 'Todas as datas' : `${p} dias`}
              </button>
            ))}
          </div>
          <select className="chip" value={filtros.desfecho} onChange={e => setF({ desfecho: e.target.value })} style={{ cursor: 'pointer' }}>
            <option value="todos">Todos os desfechos</option>
            {Object.entries(NOME_DESFECHO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {[20, 25, 35, 40, 50, 60, 70, 100].map(p => <option key={p} value={String(p)}>{p}% reembolsado</option>)}
          </select>
          <select className="chip" value={filtros.jornada} onChange={e => setF({ jornada: e.target.value, fase: 'todas' })} style={{ cursor: 'pointer' }} title="Jornada">
            <option value="todas">Todas as jornadas</option>
            {ORDEM_JORNADAS.map(j => <option key={j} value={j}>{jornadas[j] ?? j}</option>)}
          </select>
          <select className="chip" value={filtros.fase} onChange={e => setF({ fase: e.target.value })} style={{ cursor: 'pointer' }} title="Fase atual">
            <option value="todas">Todas as fases</option>
            <option value="sem_fase">Sem fase</option>
            {(filtros.jornada === 'todas' ? ORDEM_JORNADAS : [filtros.jornada]).flatMap(j => fasesPorJornada(j).map(id => (
              <option key={id} value={id}>{fases[id].titulo}</option>
            )))}
          </select>
        </div>
        {casoAlvo && <p className="muted-sm" style={{ marginTop: 6 }}>Mostrando o caso aberto a partir da conversa. <button className="btn btn-sm" onClick={limparAlvo}>Ver tudo</button></p>}
      </div>

      {/* indicadores gerais, por moeda */}
      {kpis.length > 1 && <p className="muted-sm mb-8">Lojas em moedas diferentes não se somam — os indicadores aparecem por moeda. Para um total único, filtre uma loja.</p>}
      {kpis.map(k => (
        <div key={k.moeda} className="mb-16">
          {kpis.length > 1 && <div className="muted-sm mb-8"><b>{k.moeda}</b></div>}
          <div className="central-kpis">
            <Kpi rotulo="Pedidos totais" valor={String(k.pedidosTotais)} pe="da loja / período" />
            <Kpi rotulo="Pedidos com ticket" valor={String(k.pedidosComTicket)} pe={dinheiro(k.valorComTicket, k.moeda) + ' em pedidos'} />
            <Kpi rotulo="Casos" valor={String(k.casos)} pe={`${k.pctProdutoIdentificado}% com produto identificado`} />
            <Kpi rotulo="Envolvidos em reembolso" valor={String(k.pedidosEmReembolso)} pe={`${k.reembolsosParciais} parciais · ${k.reembolsosConfirmados} confirmados pelo motor`} />
            <Kpi rotulo="Valor total dos pedidos" valor={dinheiro(k.valorTotalPedidos, k.moeda)} pe="pago na Shopify" />
            <Kpi rotulo="Valor dos pedidos reembolsados" valor={dinheiro(k.valorPedidosReembolsados, k.moeda)} pe="valor pago dos casos com reembolso" />
            <Kpi rotulo="Reembolsado de fato" valor={dinheiro(k.reembolsadoEfetivo, k.moeda)} pe="percentual concedido × valor pago" destaque />
            {k.historicoSuficiente ? (
              <Kpi rotulo="Cenário hipotético sem retenção" valor={dinheiro(k.hipoteticoSemRetencao, k.moeda)}
                pe={`hipótese: todos com 100% — diferença de ${dinheiro(k.hipoteticoSemRetencao - k.reembolsadoEfetivo, k.moeda)} (não é economia comprovada)`} />
            ) : (
              <Kpi rotulo="Cenário hipotético sem retenção" valor="—" pe="dados históricos insuficientes: nenhum reembolso confirmado pelo motor" />
            )}
          </div>
          <div className="central-jornadas">
            {k.porJornada.map(j => (
              <div key={j.chave} className="card" style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{jornadas[j.chave] ?? j.chave}</div>
                <div style={{ fontSize: 18, marginTop: 2 }}>{j.pedidos} <span className="muted-sm">· {j.pct}%</span></div>
                <div className="muted-sm">{dinheiro(j.valor, k.moeda)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {visao === 'mapa' ? (
        ORDEM_JORNADAS.map(j => {
          const ids = fasesPorJornada(j)
          if (!ids.length) return null
          return (
            <div key={j} className="mb-16">
              <div className="row gap-8 mb-8"><b style={{ fontSize: 14 }}>{jornadas[j] ?? j}</b><span className="muted-sm">{ids.length} fases</span></div>
              <div className="central-fases">
                {ids.map(id => {
                  const m = metricas[id]
                  return (
                    <button key={id} className={'fase-card' + (faseSelecionada === id ? ' on' : '')} onClick={() => { limparAlvo(); setFaseAberta(id); setAbaFase('passaram'); setBuscaFase('') }}>
                      <div className="fase-titulo">{fases[id].titulo}</div>
                      <div className="fase-nums">
                        <span title="Pedidos que receberam esta fase (enviada)"><b>{m.passaram}</b> passaram</span>
                        <span title="Aceitaram ou foram concluídos aqui"><b>{m.pararam}</b> pararam</span>
                        <span title="Recusaram e seguiram para a próxima"><b>{m.avancaram}</b> avançaram</span>
                        {m.emAberto > 0 && <span className="muted-sm">{m.emAberto} em aberto</span>}
                      </div>
                      <div className="muted-sm">{porMoeda(m)}</div>
                      {(m.inferidos > 0 || m.manuais > 0) && (
                        <div className="muted-sm" style={{ fontSize: 11 }} title="Não contam nas métricas: não foram enviadas pelo motor">
                          {[m.inferidos ? `${m.inferidos} inferido${m.inferidos > 1 ? 's' : ''}` : '', m.manuais ? `${m.manuais} manual${m.manuais > 1 ? 'is' : ''}` : ''].filter(Boolean).join(' · ')} (fora das métricas)
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Pedido</th><th>Produto</th><th>Loja</th><th>Data</th><th>Valor</th><th>% reemb.</th><th>Motivo</th><th>Atendimento</th><th>Fase atual</th><th></th></tr></thead>
              <tbody>
                {linhas.length === 0 && <tr><td colSpan={10} className="muted-sm" style={{ textAlign: 'center', padding: '22px 0' }}>Nenhum pedido nestes filtros.</td></tr>}
                {linhas.slice(0, 300).map(l => {
                  const c = l.registro
                  return (
                    <tr key={l.chave}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.pedidoNumero ? `#${l.pedidoNumero}` : <span className="muted-sm">sem pedido</span>}<div className="muted-sm" style={{ fontWeight: 400 }}>{l.cliente}</div></td>
                      <td style={{ maxWidth: 220 }}>{l.produto ?? <span className="muted-sm">—</span>}</td>
                      <td><span className="tag tag-outro">{l.lojaNome}</span></td>
                      <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtData(l.dataMs)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{l.valor != null ? dinheiro(l.valor, l.moeda) : '—'}</td>
                      <td>{!c ? <span className="muted-sm">—</span> : c.percentual != null ? `${c.percentual}%` : c.desfecho === 'em_aberto' ? <span className="muted-sm">em aberto</span> : NOME_DESFECHO[c.desfecho]}</td>
                      <td style={{ maxWidth: 200 }}>{c?.motivo ?? <span className="muted-sm">—</span>}</td>
                      <td>
                        <span className={'tag ' + (l.atendimento === 'confirmada' ? 'tag-green' : l.atendimento === 'manual' ? 'tag-amber' : 'tag-outro')} title="Origem da classificação">{NOME_ORIGEM[l.atendimento]}</span>
                        {c?.comVoce && <span className="tag tag-reembolso" style={{ marginLeft: 4 }}>com você</span>}
                        {c && c.tickets.length > 1 && <span className="muted-sm" style={{ marginLeft: 4 }} title="Conversas do mesmo pedido, contadas uma vez">{c.tickets.length} conversas</span>}
                      </td>
                      <td>{c ? l.faseTitulo : <span className="muted-sm">sem fase</span>}{c?.pendente && <div className="muted-sm" style={{ fontSize: 11 }}>rascunho pendente: {fases[c.pendente]?.titulo ?? c.pendente} (não conta)</div>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {c ? (
                          <>
                            <button className="btn btn-sm" title="Abrir a conversa" onClick={() => setConversa(c.ticketId)}><ExternalLink size={12} /></button>{' '}
                            <button className="btn btn-sm" title="Corrigir classificação" onClick={() => setCorrigindo(c)}><Pencil size={12} /></button>
                          </>
                        ) : <span className="muted-sm">sem conversa</span>}
                      </td>
                    </tr>
                  )
                })}
                {linhas.length > 300 && <tr><td colSpan={10} className="muted-sm" style={{ textAlign: 'center' }}>Mostrando 300 de {linhas.length} — refine os filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* painel lateral da fase */}
      {faseSelecionada && fases[faseSelecionada] && (
        <aside className="central-drawer">
          <div className="row spread mb-8">
            <b style={{ fontSize: 14 }}>{fases[faseSelecionada].titulo}</b>
            <button onClick={() => { setFaseAberta(null); limparAlvo() }} style={{ color: 'var(--text-3)' }}><X size={16} /></button>
          </div>
          <p className="muted-sm" style={{ lineHeight: 1.5 }}>{fases[faseSelecionada].instrucao ?? 'Fase de decisão do dono — não há texto automático.'}</p>
          {(() => { const m = metricas[faseSelecionada]; return (
            <div style={{ marginTop: 10, fontSize: 12.5 }}>
              <div className="row gap-10 mb-4" style={{ flexWrap: 'wrap' }}>
                <span><b>{m.passaram}</b> passaram</span><span><b>{m.pararam}</b> pararam</span><span><b>{m.avancaram}</b> avançaram</span>
                {m.emAberto > 0 && <span className="muted-sm">{m.emAberto} em aberto</span>}
              </div>
              <div className="muted-sm">Valor dos pedidos, por moeda: {porMoeda(m)}</div>
              {(m.inferidos > 0 || m.manuais > 0) && <div className="muted-sm">{m.inferidos} inferidos · {m.manuais} manuais — fora das métricas (não foram enviadas)</div>}
            </div>
          ) })()}
          <div className="row gap-4 mb-8" style={{ marginTop: 8 }}>
            {(['passaram', 'pararam', 'avancaram'] as const).map(a => (
              <button key={a} className={'chip' + (abaFase === a ? ' active' : '')} onClick={() => setAbaFase(a)}>{a}</button>
            ))}
          </div>
          <div className="search-box mb-8"><Search size={14} /><input value={buscaFase} onChange={e => setBuscaFase(e.target.value)} placeholder="Buscar nesta fase" /></div>
          <div style={{ display: 'grid', gap: 6, overflowY: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            {registrosDaFase.length === 0 && <span className="muted-sm">Nenhum pedido.</span>}
            {registrosDaFase.map(c => (
              <div key={c.chave} className="card-soft" style={{ padding: '8px 10px', fontSize: 12.5 }}>
                <div className="row spread">
                  <b>{c.pedidoNumero ? `#${c.pedidoNumero}` : c.cliente}</b>
                  <span className="muted-sm">{c.pedidoValor != null ? dinheiro(c.pedidoValor, c.moeda) : ''}</span>
                </div>
                <div className="muted-sm">{[c.produto, c.lojaNome].filter(Boolean).join(' · ')}</div>
                <div className="muted-sm">{c.motivo ?? 'motivo não informado'} · estágio: {c.faseTitulo}{c.concluido ? ` · ${NOME_DESFECHO[c.desfecho]}${c.percentual != null ? ` ${c.percentual}%` : ''}` : ''}</div>
                <div className="row gap-6" style={{ marginTop: 4 }}>
                  <button className="btn btn-sm" onClick={() => setConversa(c.ticketId)}><ExternalLink size={12} /> Abrir conversa</button>
                  <button className="btn btn-sm" onClick={() => setCorrigindo(c)}><Pencil size={12} /> Corrigir</button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {corrigindo && <ModalCorrecao caso={corrigindo} onClose={() => setCorrigindo(null)} />}
    </div>
  )
}

function Kpi({ rotulo, valor, pe, destaque }: { rotulo: string; valor: string; pe?: string; destaque?: boolean }) {
  return (
    <div className="card" style={{ padding: '10px 12px', borderColor: destaque ? 'var(--purple-border)' : undefined }}>
      <div className="muted-sm" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10.5 }}>{rotulo}</div>
      <div style={{ fontSize: 18, marginTop: 2 }}>{valor}</div>
      {pe && <div className="muted-sm">{pe}</div>}
    </div>
  )
}

/** Correção manual da classificação (13.7): cada alteração fica no histórico de auditoria
 *  (fase anterior, nova fase, jornada, usuário, data, justificativa, remoção).
 *  Não mexe no motor — o envio automático continua preso às ligações do mapa. */
function ModalCorrecao({ caso, onClose }: { caso: Registro; onClose: () => void }) {
  const s = useStore()
  const fases = s.fasesNovo ?? {}
  const jornadas = s.jornadasNovo ?? {}
  const [jornada, setJornada] = useState(caso.jornada)
  const [fase, setFase] = useState(caso.faseAtual ?? '')
  const [justificativa, setJustificativa] = useState('')
  const historico = [...(caso.historicoAjustes ?? [])].reverse()
  const nome = (id: string | null | undefined) => (id ? fases[id]?.titulo ?? id : 'sem fase')
  return (
    <Modal title={`Corrigir classificação — ${caso.pedidoNumero ? `#${caso.pedidoNumero}` : caso.cliente}`} onClose={onClose}>
      <p className="muted-sm mb-12" style={{ lineHeight: 1.5 }}>
        Classificação atual: <b>{jornadas[caso.jornada] ?? caso.jornada}</b> · <b>{caso.faseTitulo}</b> ({NOME_ORIGEM[caso.origem]}).
        A correção vale para a Central e fica no histórico; ela <b>não</b> muda a etapa do motor, o rascunho pendente nem a próxima oferta.
      </p>
      <div className="field"><label>Jornada</label>
        <select value={jornada} onChange={e => setJornada(e.target.value)}>{Object.entries(jornadas).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="field"><label>Fase</label>
        <select value={fase} onChange={e => setFase(e.target.value)}>
          <option value="">Triagem / sem fase</option>
          {Object.entries(fases).map(([id, f]) => <option key={id} value={id}>{f.titulo}</option>)}
        </select>
      </div>
      <div className="field"><label>Justificativa (opcional)</label>
        <input value={justificativa} onChange={e => setJustificativa(e.target.value)} placeholder="Por que a classificação estava errada" />
      </div>
      <div className="row spread">
        {caso.ajuste ? (
          <button className="btn btn-sm" onClick={() => { s.corrigirFaseCentral(caso.ticketId, { remover: true, justificativa }); onClose() }}>Remover correção</button>
        ) : <span className="muted-sm">Sem correção manual ativa</span>}
        <button className="btn btn-primary" onClick={() => { s.corrigirFaseCentral(caso.ticketId, { fase: fase || null, jornada, justificativa }); onClose() }}>Salvar correção</button>
      </div>
      {historico.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="muted-sm mb-4"><b>Histórico de correções</b> ({historico.length})</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {historico.map((h, i) => (
              <li key={i}>
                {h.removido ? <>Correção <b>removida</b> (voltou de {nome(h.anterior)})</> : <>{nome(h.anterior)} → <b>{nome(h.fase)}</b>{h.jornada ? ` · ${jornadas[h.jornada] ?? h.jornada}` : ''}</>}
                <span className="muted-sm"> · {h.por} · {fmtQuando(h.em)}</span>
                {h.justificativa && <div className="muted-sm" style={{ fontSize: 11.5 }}>“{h.justificativa}”</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  )
}
