import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Workflow, Search, X, ExternalLink, Pencil, ArrowLeft } from 'lucide-react'
import { useStore } from '../store'
import type { Ticket } from '../store'
import { TicketDetail } from '../components/Tickets'
import { Modal } from '../components/Shared'
import {
  montarCasos, filtrarCasos, metricasPorFase, indicadores, pedidosComConversa, relacaoComFase, ORDEM_JORNADAS,
  type Caso, type Filtros,
} from '../lib/central'

const NOME_DESFECHO: Record<string, string> = {
  em_aberto: 'Em aberto', reembolso: 'Reembolso', troca: 'Troca', reenvio: 'Reenvio', cupom: 'Cupom', cancelamento: 'Cancelamento', encerrado: 'Encerrado',
}
const NOME_ORIGEM: Record<string, string> = { confirmada: 'confirmada', inferida: 'inferida', manual: 'manual' }
const fmtData = (ms: number) => new Date(ms).toLocaleDateString('pt-BR')

export default function Central() {
  const s = useStore()
  const [params, setParams] = useSearchParams()
  const fases = s.fasesNovo ?? {}
  const jornadas = s.jornadasNovo ?? {}
  const [visao, setVisao] = useState<'mapa' | 'pedidos'>('mapa')
  const [filtros, setFiltros] = useState<Filtros>({ busca: '', lojaId: 'todas', periodo: 'todas', desfecho: 'todos' })
  const [faseAberta, setFaseAberta] = useState<string | null>(null)
  const [abaFase, setAbaFase] = useState<'passaram' | 'pararam' | 'avancaram'>('passaram')
  const [buscaFase, setBuscaFase] = useState('')
  const [conversa, setConversa] = useState<string | null>(null)
  const [corrigindo, setCorrigindo] = useState<Caso | null>(null)

  // vindo do card da conversa: ?caso=<ticketId> abre a fase daquele caso —
  // mesmo se a Central já estiver aberta com outra conversa ou fase na tela
  const casoAlvo = params.get('caso')
  useEffect(() => { setConversa(null); setFaseAberta(null); setVisao('mapa') }, [casoAlvo])

  const todos = useMemo(() => montarCasos(s.todosTickets, s.todosPedidos, s.lojas, fases), [s.todosTickets, s.todosPedidos, s.lojas, fases])
  const comConversa = useMemo(() => pedidosComConversa(s.todosTickets, s.todosPedidos), [s.todosTickets, s.todosPedidos])

  const filtrosEfetivos: Filtros = useMemo(() => {
    if (!casoAlvo) return filtros
    const c = todos.find(x => x.ticketId === casoAlvo)
    return c?.pedidoNumero ? { ...filtros, busca: c.pedidoNumero } : filtros
  }, [filtros, casoAlvo, todos])

  const casos = useMemo(() => filtrarCasos(todos, filtrosEfetivos), [todos, filtrosEfetivos])
  const pedidosFiltrados = useMemo(() => {
    const corte = filtrosEfetivos.periodo === 'todas' ? 0 : Date.now() - Number(filtrosEfetivos.periodo) * 864e5
    return s.todosPedidos.filter(p => (filtrosEfetivos.lojaId === 'todas' || (p.lojaId ?? 'loja1') === filtrosEfetivos.lojaId)
      && (!corte || new Date(p.criadoEm + 'T12:00:00').getTime() >= corte))
  }, [s.todosPedidos, filtrosEfetivos])
  const kpis = useMemo(() => indicadores(casos, pedidosFiltrados, s.lojas, comConversa), [casos, pedidosFiltrados, s.lojas, comConversa])
  const metricas = useMemo(() => metricasPorFase(casos, fases), [casos, fases])
  const dinheiro = (v: number, moeda: string) => s.fmtMoeda(v, moeda)

  // caso vindo da conversa: abre a fase dele uma vez
  const faseDoAlvo = casoAlvo ? todos.find(x => x.ticketId === casoAlvo)?.faseAtual ?? null : null
  const faseSelecionada = faseAberta ?? faseDoAlvo
  const limparAlvo = () => { if (casoAlvo) setParams({}) }

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

  const casosDaFase = faseSelecionada
    ? casos.filter(c => {
      const rel = relacaoComFase(c, faseSelecionada)
      if (!rel) return false
      if (abaFase === 'passaram') return true
      return rel === abaFase
    }).filter(c => !buscaFase.trim() || [c.pedidoNumero, c.produto, c.motivo, c.lojaNome, c.cliente].filter(Boolean).join(' ').toLowerCase().includes(buscaFase.toLowerCase()))
    : []

  const chipsPeriodo: Filtros['periodo'][] = ['7', '30', '90', 'todas']

  return (
    <div className="content-wide" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="row spread mb-12" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="h2"><Workflow size={18} style={{ verticalAlign: -3, marginRight: 8, color: 'var(--purple)' }} />Central operacional</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Jornadas, fases e resultado dos casos de devolução, reembolso e entrega — de todas as lojas. Fase <b>confirmada</b> vem do motor do modo
            novo; <b>inferida</b> é deduzida do relatório manual dos casos antigos; <b>manual</b> é correção sua.
          </p>
        </div>
        <div className="row gap-8">
          <button className={'chip' + (visao === 'mapa' ? ' active' : '')} onClick={() => setVisao('mapa')}>Mapa do fluxo</button>
          <button className={'chip' + (visao === 'pedidos' ? ' active' : '')} onClick={() => setVisao('pedidos')}>Todos os pedidos ({casos.length})</button>
        </div>
      </div>

      {/* filtros: agem ao mesmo tempo sobre cartões, jornadas, fases e lista */}
      <div className="card mb-16" style={{ padding: '10px 14px' }}>
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={15} />
            <input value={filtrosEfetivos.busca} onChange={e => { limparAlvo(); setFiltros(f => ({ ...f, busca: e.target.value })) }} placeholder="Pedido, produto, motivo ou loja" />
          </div>
          <select className="chip" value={filtros.lojaId} onChange={e => setFiltros(f => ({ ...f, lojaId: e.target.value }))} style={{ cursor: 'pointer' }}>
            <option value="todas">Todas as lojas</option>
            {s.lojas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <div className="row gap-4">
            {chipsPeriodo.map(p => (
              <button key={p} className={'chip' + (filtros.periodo === p ? ' active' : '')} onClick={() => setFiltros(f => ({ ...f, periodo: p }))}>
                {p === 'todas' ? 'Todas as datas' : `${p} dias`}
              </button>
            ))}
          </div>
          <select className="chip" value={filtros.desfecho} onChange={e => setFiltros(f => ({ ...f, desfecho: e.target.value }))} style={{ cursor: 'pointer' }}>
            <option value="todos">Todos os desfechos</option>
            {Object.entries(NOME_DESFECHO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            {[20, 25, 35, 40, 50, 60, 70, 100].map(p => <option key={p} value={String(p)}>{p}% reembolsado</option>)}
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
            <Kpi rotulo="Envolvidos em reembolso" valor={String(k.pedidosEmReembolso)} pe={`${k.reembolsosParciais} parciais`} />
            <Kpi rotulo="Valor total dos pedidos" valor={dinheiro(k.valorTotalPedidos, k.moeda)} pe="pago na Shopify" />
            <Kpi rotulo="Valor dos pedidos reembolsados" valor={dinheiro(k.valorPedidosReembolsados, k.moeda)} pe="valor pago dos casos com reembolso" />
            <Kpi rotulo="Antes do pipeline" valor={dinheiro(k.antesPipeline, k.moeda)} pe="se todos tivessem 100%" />
            <Kpi rotulo="Depois do pipeline" valor={dinheiro(k.depoisPipeline, k.moeda)} pe={`economia de ${dinheiro(k.antesPipeline - k.depoisPipeline, k.moeda)}`} destaque />
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
          const ids = Object.keys(fases).filter(id => fases[id].jornada === j)
          if (!ids.length) return null
          return (
            <div key={j} className="mb-16">
              <div className="row gap-8 mb-8"><b style={{ fontSize: 14 }}>{jornadas[j] ?? j}</b><span className="muted-sm">{ids.length} fases</span></div>
              <div className="central-fases">
                {ids.map(id => {
                  const m = metricas[id]
                  const moeda = casos.find(c => c.trilha.includes(id))?.moeda ?? kpis[0]?.moeda ?? 'EUR'
                  return (
                    <button key={id} className={'fase-card' + (faseSelecionada === id ? ' on' : '')} onClick={() => { limparAlvo(); setFaseAberta(id); setAbaFase('passaram'); setBuscaFase('') }}>
                      <div className="fase-titulo">{fases[id].titulo}</div>
                      <div className="fase-nums">
                        <span title="Pedidos que chegaram à fase"><b>{m.passaram}</b> passaram</span>
                        <span title="Aceitaram ou foram concluídos aqui"><b>{m.pararam}</b> pararam</span>
                        <span title="Recusaram e seguiram para a próxima"><b>{m.avancaram}</b> avançaram</span>
                        {m.emAberto > 0 && <span className="muted-sm">{m.emAberto} em aberto</span>}
                      </div>
                      <div className="muted-sm">{dinheiro(m.valor, moeda)}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Pedido</th><th>Produto</th><th>Loja</th><th>Data</th><th>Valor</th><th>% reemb.</th><th>Motivo</th><th>Fase atual</th><th></th></tr></thead>
            <tbody>
              {casos.length === 0 && <tr><td colSpan={9} className="muted-sm" style={{ textAlign: 'center', padding: '22px 0' }}>Nenhum caso nestes filtros.</td></tr>}
              {casos.slice(0, 300).map(c => (
                <tr key={c.ticketId}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.pedidoNumero ? `#${c.pedidoNumero}` : <span className="muted-sm">sem pedido</span>}<div className="muted-sm" style={{ fontWeight: 400 }}>{c.cliente}</div></td>
                  <td style={{ maxWidth: 220 }}>{c.produto ?? <span className="muted-sm">—</span>}</td>
                  <td><span className="tag tag-outro">{c.lojaNome}</span></td>
                  <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtData(c.dataMs)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.pedidoValor != null ? dinheiro(c.pedidoValor, c.moeda) : '—'}</td>
                  <td>{c.percentual != null ? `${c.percentual}%` : c.desfecho === 'em_aberto' ? <span className="muted-sm">em aberto</span> : NOME_DESFECHO[c.desfecho]}</td>
                  <td style={{ maxWidth: 200 }}>{c.motivo ?? <span className="muted-sm">—</span>}</td>
                  <td>
                    {c.faseTitulo} <span className={'tag ' + (c.origem === 'confirmada' ? 'tag-green' : c.origem === 'manual' ? 'tag-amber' : 'tag-outro')} title="Origem da classificação">{NOME_ORIGEM[c.origem]}</span>
                    {c.comVoce && <span className="tag tag-reembolso" style={{ marginLeft: 4 }}>com você</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" title="Abrir a conversa" onClick={() => setConversa(c.ticketId)}><ExternalLink size={12} /></button>{' '}
                    <button className="btn btn-sm" title="Corrigir classificação" onClick={() => setCorrigindo(c)}><Pencil size={12} /></button>
                  </td>
                </tr>
              ))}
              {casos.length > 300 && <tr><td colSpan={9} className="muted-sm" style={{ textAlign: 'center' }}>Mostrando 300 de {casos.length} — refine os filtros.</td></tr>}
            </tbody>
          </table>
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
            <div className="row gap-10 mb-8" style={{ marginTop: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span><b>{m.passaram}</b> passaram</span><span><b>{m.pararam}</b> pararam</span><span><b>{m.avancaram}</b> avançaram</span>
              <span className="muted-sm">{dinheiro(m.valor, casos.find(c => c.trilha.includes(faseSelecionada))?.moeda ?? 'EUR')}</span>
            </div>
          ) })()}
          <div className="row gap-4 mb-8">
            {(['passaram', 'pararam', 'avancaram'] as const).map(a => (
              <button key={a} className={'chip' + (abaFase === a ? ' active' : '')} onClick={() => setAbaFase(a)}>{a}</button>
            ))}
          </div>
          <div className="search-box mb-8"><Search size={14} /><input value={buscaFase} onChange={e => setBuscaFase(e.target.value)} placeholder="Buscar nesta fase" /></div>
          <div style={{ display: 'grid', gap: 6, overflowY: 'auto', maxHeight: 'calc(100vh - 330px)' }}>
            {casosDaFase.length === 0 && <span className="muted-sm">Nenhum caso.</span>}
            {casosDaFase.map(c => (
              <div key={c.ticketId} className="card-soft" style={{ padding: '8px 10px', fontSize: 12.5 }}>
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

/** Correção manual da classificação (13.7): registra quem, quando, a anterior e a justificativa.
 *  Não mexe no motor — o envio automático continua preso às ligações do mapa. */
function ModalCorrecao({ caso, onClose }: { caso: Caso; onClose: () => void }) {
  const s = useStore()
  const fases = s.fasesNovo ?? {}
  const jornadas = s.jornadasNovo ?? {}
  const [jornada, setJornada] = useState(caso.jornada)
  const [fase, setFase] = useState(caso.faseAtual ?? '')
  const [justificativa, setJustificativa] = useState('')
  return (
    <Modal title={`Corrigir classificação — ${caso.pedidoNumero ? `#${caso.pedidoNumero}` : caso.cliente}`} onClose={onClose}>
      <p className="muted-sm mb-12" style={{ lineHeight: 1.5 }}>
        Classificação atual: <b>{jornadas[caso.jornada] ?? caso.jornada}</b> · <b>{caso.faseTitulo}</b> ({NOME_ORIGEM[caso.origem]}).
        A correção vale para a Central e fica registrada; ela <b>não</b> muda a etapa do motor nem deixa o envio automático pular fases.
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
          <button className="btn btn-sm" onClick={() => { s.corrigirFaseCentral(caso.ticketId, { remover: true }); onClose() }}>Remover correção</button>
        ) : <span className="muted-sm">{caso.ajuste ? '' : 'Sem correção manual ainda'}</span>}
        <button className="btn btn-primary" onClick={() => { s.corrigirFaseCentral(caso.ticketId, { fase: fase || null, jornada, justificativa }); onClose() }}>Salvar correção</button>
      </div>
    </Modal>
  )
}
