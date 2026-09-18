import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RefreshCw, Search, MessageSquare, Bot, User, AlertTriangle, Check, Clock, ExternalLink, ShieldCheck,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ROTULO_GERAL, ROTULO_SELO, ROTULO_SELO_CURTO, ROTULO_ORIGEM_ENVIO } from '../../shared/auditoria.js'
import type { ConversaAuditoria, ResumoConversaAuditoria, MensagemAuditoria, ItemChecklist } from '../../shared/auditoria.js'
import { useStore } from '../store'

/* A auditoria só OBSERVA: nenhuma ação daqui muda fase, oferta, envio ou relatório.
   O único dado que ela escreve é a marcação de revisão (metadados). */

const CORES_SELO: Record<string, string> = {
  tudo_certo: 'var(--green, #3fb950)', revisar: 'var(--amber, #d29922)',
  aguardando: 'var(--amber, #d29922)', agendada: 'var(--blue, #388bfd)',
  bloqueado: 'var(--red, #f85149)', revisar_historico: 'var(--amber, #d29922)',
  aguardando_voce: 'var(--amber, #d29922)',
  encerrado: 'var(--text-2)', sem_dados: 'var(--text-3)',
}
const CORES_ITEM: Record<string, string> = {
  verde: 'var(--green, #3fb950)', amarelo: 'var(--amber, #d29922)',
  vermelho: 'var(--red, #f85149)', cinza: 'var(--text-3)',
}
const SITUACAO_MENSAGEM: Record<string, { rotulo: string; cor: string }> = {
  recebida: { rotulo: 'Recebida', cor: 'var(--text-3)' },
  enviada: { rotulo: 'Enviada', cor: 'var(--green, #3fb950)' },
  agendada: { rotulo: 'Agendada', cor: 'var(--blue, #388bfd)' },
  rascunho: { rotulo: 'Rascunho — não enviado', cor: 'var(--amber, #d29922)' },
  bloqueada: { rotulo: 'Bloqueada — não enviada ao cliente', cor: 'var(--red, #f85149)' },
  falha: { rotulo: 'Falha no envio — não chegou ao cliente', cor: 'var(--red, #f85149)' },
}

const hora = (v?: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—')
const duracao = (ms: number | null) => {
  if (ms == null) return null
  const min = Math.round(Math.abs(ms) / 60000)
  const texto = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
  return ms >= 0 ? `${texto} depois do mínimo` : `${texto} antes do mínimo`
}

export default function Auditoria() {
  const s = useStore()
  const navegar = useNavigate()
  const [filtros, setFiltros] = useState({
    busca: '', loja: 'todas', dias: 7, jornada: 'todas', fase: 'todas', idioma: 'todos',
    situacao: 'todas', soErro: false, soAprovacao: false, soAutomaticos: false, classico: false,
  })
  const [lista, setLista] = useState<ResumoConversaAuditoria[]>([])
  const [opcoes, setOpcoes] = useState<{ lojas: { id: string; nome: string }[]; jornadas: string[]; fases: string[]; idiomas: string[] }>({ lojas: [], jornadas: [], fases: [], idiomas: [] })
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [conversa, setConversa] = useState<ConversaAuditoria | null>(null)
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [aba, setAba] = useState<'lista' | 'conversa' | 'painel'>('lista')
  const [observacao, setObservacao] = useState('')
  const selecionadaRef = useRef<string | null>(null)
  selecionadaRef.current = selecionada

  const query = useMemo(() => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filtros, pagina })) {
      if (v === '' || v === false) continue
      p.set(k, String(v))
    }
    return p.toString()
  }, [filtros, pagina])

  const carregar = useCallback(async (mostrarCarregando = false) => {
    if (mostrarCarregando) setCarregando(true)
    try {
      const r = await fetch(`/api/auditoria?${query}`).then(x => x.json())
      if (!r?.ok) return
      setLista(r.conversas ?? [])
      setTotal(r.total ?? 0)
      setOpcoes({ lojas: r.lojas ?? [], jornadas: r.jornadas ?? [], fases: r.fases ?? [], idiomas: r.idiomas ?? [] })
      setAtualizadoEm(r.atualizadoEm ?? null)
      const id = selecionadaRef.current ?? r.conversas?.[0]?.ticketId ?? null
      if (id) {
        const d = await fetch(`/api/auditoria/${id}`).then(x => x.json())
        if (d?.ok) { setConversa(d.conversa); setSelecionada(id) }
      } else { setConversa(null) }
    } finally { if (mostrarCarregando) setCarregando(false) }
  }, [query])

  useEffect(() => { carregar(true) }, [carregar])
  // atualização automática a cada 10 s, sem recarregar a página
  useEffect(() => {
    const h = window.setInterval(() => carregar(false), 10_000)
    return () => window.clearInterval(h)
  }, [carregar])

  const abrirConversa = async (id: string) => {
    setSelecionada(id); setAba('conversa'); setObservacao('')
    const d = await fetch(`/api/auditoria/${id}`).then(x => x.json())
    if (d?.ok) setConversa(d.conversa)
  }
  const revisar = async (resultado: 'correta' | 'problema' | 'limpar') => {
    if (!selecionada) return
    await fetch(`/api/auditoria/${selecionada}/revisao`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultado, observacao }),
    })
    setObservacao('')
    carregar(false)
  }

  const campo = (rotulo: string, filho: React.ReactNode) => (
    <label className="muted-sm" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{rotulo}{filho}</label>
  )

  return (
    <div className="page auditoria">
      <div className="row spread mb-12" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h1 className="h1">Auditoria da IA</h1>
          <p className="muted-sm" style={{ lineHeight: 1.5, maxWidth: 640 }}>
            Acompanhe o que o cliente escreveu, o que a IA entendeu e o que realmente foi enviado.
          </p>
        </div>
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <span className="muted-sm">{atualizadoEm ? `Atualizado ${hora(atualizadoEm)}` : 'Carregando…'}</span>
          <button className="btn btn-sm" disabled={carregando} onClick={() => carregar(true)}>
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      <div className="card mb-12" style={{ padding: 10, display: 'grid', gap: 8 }}>
        <div className="row gap-8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {campo('Buscar', (
            <span className="row gap-8" style={{ alignItems: 'center' }}>
              <Search size={13} />
              <input value={filtros.busca} placeholder="pedido, cliente ou e-mail" style={{ minWidth: 190 }}
                onChange={e => { setPagina(1); setFiltros(f => ({ ...f, busca: e.target.value })) }} />
            </span>
          ))}
          {campo('Loja', (
            <select value={filtros.loja} onChange={e => { setPagina(1); setFiltros(f => ({ ...f, loja: e.target.value })) }}>
              <option value="todas">Todas</option>
              {opcoes.lojas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          ))}
          {campo('Período', (
            <select value={filtros.dias} onChange={e => { setPagina(1); setFiltros(f => ({ ...f, dias: Number(e.target.value) })) }}>
              <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
            </select>
          ))}
          {campo('Jornada', (
            <select value={filtros.jornada} onChange={e => { setPagina(1); setFiltros(f => ({ ...f, jornada: e.target.value })) }}>
              <option value="todas">Todas</option>
              {opcoes.jornadas.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          ))}
          {campo('Fase', (
            <select value={filtros.fase} onChange={e => { setPagina(1); setFiltros(f => ({ ...f, fase: e.target.value })) }}>
              <option value="todas">Todas</option>
              {opcoes.fases.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          ))}
          {campo('Idioma', (
            <select value={filtros.idioma} onChange={e => { setPagina(1); setFiltros(f => ({ ...f, idioma: e.target.value })) }}>
              <option value="todos">Todos</option>
              {opcoes.idiomas.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          ))}
          {campo('Situação', (
            <select value={filtros.situacao} onChange={e => { setPagina(1); setFiltros(f => ({ ...f, situacao: e.target.value })) }}>
              <option value="todas">Todas</option>
              <option value="tudo_certo">Tudo certo</option>
              <option value="revisar">Revisar</option>
              <option value="revisar_historico">Revisar — checklist histórico indisponível</option>
              <option value="aguardando">Aguardando aprovação</option>
              <option value="agendada">Agendada — ainda não enviada</option>
              <option value="aguardando_voce">Aguardando você</option>
              <option value="encerrado">Encerrado — sem resposta necessária</option>
              <option value="bloqueado">Bloqueado</option>
            </select>
          ))}
        </div>
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          {([['soErro', 'Somente com erro'], ['soAprovacao', 'Somente aguardando aprovação'], ['soAutomaticos', 'Somente enviados automaticamente'], ['classico', 'Incluir clássico']] as const).map(([chave, rotulo]) => (
            <label key={chave} className="muted-sm row gap-8" style={{ alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={filtros[chave] as boolean}
                onChange={e => { setPagina(1); setFiltros(f => ({ ...f, [chave]: e.target.checked })) }} />
              {rotulo}
            </label>
          ))}
        </div>
      </div>

      <div className="abas-auditoria row gap-8 mb-10">
        {([['lista', 'Conversas'], ['conversa', 'Conversa'], ['painel', 'Análise']] as const).map(([id, rotulo]) => (
          <button key={id} className={'btn btn-sm' + (aba === id ? ' btn-primary' : '')} onClick={() => setAba(id)}>{rotulo}</button>
        ))}
      </div>

      <div className="auditoria-grade">
        {/* lista lateral */}
        <aside className={'card coluna-auditoria' + (aba === 'lista' ? ' ativa' : '')} data-coluna="lista">
          <div className="muted-sm" style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            {total} conversa(s) · página {pagina}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {lista.length === 0 && <p className="muted-sm" style={{ padding: 12 }}>Nenhuma conversa no período e nos filtros escolhidos.</p>}
            {lista.map(c => (
              <button key={c.ticketId} className={'item-auditoria' + (c.ticketId === selecionada ? ' ativo' : '')}
                onClick={() => abrirConversa(c.ticketId)}>
                <span className="row spread gap-8">
                  <b style={{ fontSize: 13 }}>{c.cliente}</b>
                  <span className="tag" style={{ color: CORES_SELO[c.selo], borderColor: CORES_SELO[c.selo] }} title={ROTULO_SELO[c.selo] ?? c.selo}>{ROTULO_SELO_CURTO[c.selo] ?? c.selo}</span>
                </span>
                <span className="muted-sm" style={{ display: 'block' }}>
                  {c.pedido ? `Pedido #${c.pedido}` : 'sem pedido'} · {c.loja}
                </span>
                <span className="muted-sm" style={{ display: 'block' }}>
                  {c.faseTitulo ?? c.fase ?? (c.motor === 'classico' ? 'clássico' : 'sem fase')} · {hora(c.ultimaAtividade)}
                </span>
              </button>
            ))}
          </div>
          {total > lista.length && (
            <div className="row gap-8" style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
              <button className="btn btn-sm" disabled={pagina * 20 >= total} onClick={() => setPagina(p => p + 1)}>Próxima</button>
            </div>
          )}
        </aside>

        {/* conversa */}
        <section className={'card coluna-auditoria' + (aba === 'conversa' ? ' ativa' : '')} data-coluna="conversa">
          {!conversa && <p className="muted-sm" style={{ padding: 12 }}>Escolha uma conversa à esquerda.</p>}
          {conversa && (
            <div style={{ overflowY: 'auto', padding: 12, display: 'grid', gap: 10 }}>
              {conversa.aviso && (
                <div className="row gap-8" style={{ color: 'var(--amber, #d29922)', alignItems: 'flex-start' }}>
                  <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span className="muted-sm" style={{ color: 'inherit' }}>{conversa.aviso}</span>
                </div>
              )}
              {conversa.passos && <div className="muted-sm passos-auditoria">{conversa.passos}</div>}
              <div className="muted-sm" style={{ color: CORES_SELO[conversa.selo], fontWeight: 700 }}>
                {ROTULO_SELO[conversa.selo] ?? conversa.selo}
              </div>
              {conversa.retencao && conversa.retencao.omitidos > 0 && (
                <div className="muted-sm" style={{ color: 'var(--amber, #d29922)' }}>
                  Histórico anterior omitido por retenção: {conversa.retencao.omitidos} evento(s) até
                  {' '}{hora(conversa.retencao.ultimoOmitidoEm)} — a lista abaixo começa em {hora(conversa.retencao.primeiroDisponivelEm)}.
                </div>
              )}
              {conversa.mensagens.map((m: MensagemAuditoria) => {
                const sit = SITUACAO_MENSAGEM[m.situacao] ?? SITUACAO_MENSAGEM.recebida
                return (
                  <article key={m.chave} className={`msg-auditoria ${m.lado} sit-${m.situacao}`} data-situacao={m.situacao}>
                    <div className="row spread gap-8" style={{ flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 12.5 }}>
                        {m.origem === 'cliente' ? <MessageSquare size={12} /> : m.origem === 'manual' ? <User size={12} /> : <Bot size={12} />} {m.rotuloOrigem}
                      </b>
                      <span className="muted-sm" style={{ color: sit.cor }}>{sit.rotulo}</span>
                    </div>
                    {/* texto do cliente entra como TEXTO: o React escapa, nada de HTML executado */}
                    <p className="corpo-auditoria">{m.corpo}</p>
                    <div className="muted-sm" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{hora(m.em ?? m.minimoEnvio)}</span>
                      {m.idioma && <span>idioma: {m.idioma}</span>}
                      {m.fase && <span>fase: {m.fase}</span>}
                      {m.minimoEnvio && <span>mínimo: {hora(m.minimoEnvio)}</span>}
                      {m.envioReal && <span>enviado: {hora(m.envioReal)}</span>}
                      {duracao(m.atrasoMs) && <span>{duracao(m.atrasoMs)}</span>}
                      {m.vinculo === 'inferido' && <span title="registro antigo, sem Message-ID">associação inferida</span>}
                    </div>
                    {m.motivo && <div className="muted-sm" style={{ color: sit.cor }}>{m.motivo}</div>}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* painel direito */}
        <aside className={'card coluna-auditoria' + (aba === 'painel' ? ' ativa' : '')} data-coluna="painel">
          {!conversa && <p className="muted-sm" style={{ padding: 12 }}>Sem conversa selecionada.</p>}
          {conversa && (
            <div style={{ overflowY: 'auto', padding: 12, display: 'grid', gap: 12 }}>
              <div>
                <b style={{ fontSize: 13 }}>Interpretação da última mensagem</b>
                {conversa.classificacao ? (
                  <ul className="muted-sm lista-dados">
                    <li>intenção: {String(conversa.classificacao.intencao ?? '—')}</li>
                    <li>motivo: {String(conversa.classificacao.motivo ?? '—')}</li>
                    <li>produtos: {(conversa.classificacao.produtos as string[] ?? []).join('; ') || '—'}</li>
                    <li>pequeno/grande: {String(conversa.classificacao.ajuste ?? '—')}</li>
                    <li>entrega: {String(conversa.classificacao.entrega ?? '—')}</li>
                    <li>idioma: {String(conversa.classificacao.idioma ?? '—')}</li>
                    <li>endereço: {String(conversa.classificacao.endereco ?? '—')}</li>
                    <li>confiança: {String(conversa.classificacao.confianca ?? '—')}</li>
                    <li>somente dado: {conversa.classificacao.somenteDado ? 'sim' : 'não'}</li>
                    <li>resumo: {String(conversa.classificacao.resumo ?? '—')}</li>
                    <li>lida da mensagem de {hora(String(conversa.classificacao.mensagemEm ?? ''))} (ciclo {String(conversa.classificacao.ciclo ?? '—')}) · registrada {hora(String(conversa.classificacao.em ?? ''))}</li>
                  </ul>
                ) : <p className="muted-sm">Sem classificação registrada para esta conversa.</p>}
              </div>

              <div>
                <b style={{ fontSize: 13 }}>Decisão do servidor</b>
                {conversa.decisao ? (
                  <ul className="muted-sm lista-dados">
                    <li>jornada: {String(conversa.decisao.jornada ?? '—')}</li>
                    <li>fase anterior: {String(conversa.decisao.faseAnterior ?? '—')}</li>
                    <li>única fase permitida: {String(conversa.decisao.faseUnicaPermitida ?? '—')}</li>
                    <li>ação permitida: {String(conversa.decisao.acaoPermitida ?? '—')}</li>
                    <li>se aceitar: {String(conversa.decisao.aoAceitar ?? '—')}</li>
                    <li>se recusar: {String(conversa.decisao.aoRecusar ?? '—')}</li>
                    <li>faltando: {(conversa.decisao.faltando as string[] ?? []).join('; ') || '—'}</li>
                    <li><b>{String(conversa.decisao.explicacao ?? '')}</b></li>
                    <li>decidida sobre a mensagem de {hora(String(conversa.decisao.mensagemEm ?? ''))} (ciclo {String(conversa.decisao.ciclo ?? '—')}) · registrada {hora(String(conversa.decisao.em ?? ''))}</li>
                  </ul>
                ) : <p className="muted-sm">Sem decisão registrada para esta conversa.</p>}
              </div>

              <div>
                <b style={{ fontSize: 13 }}>Comprovação da resposta</b>
                {conversa.checklist ? (
                  <>
                    <div className="muted-sm" style={{ color: CORES_SELO[conversa.checklist.geral], fontWeight: 700, margin: '4px 0 6px' }}>
                      {ROTULO_GERAL[conversa.checklist.geral]}
                    </div>
                    <ul className="lista-checklist">
                      {conversa.checklist.itens.map((i: ItemChecklist) => (
                        <li key={i.id} className="muted-sm" title={i.detalhe ?? undefined}>
                          <span className="ponto" style={{ background: CORES_ITEM[i.estado] }} /> {i.rotulo}
                          {i.detalhe && <span style={{ display: 'block', marginLeft: 16, color: CORES_ITEM[i.estado] }}>{i.detalhe}</span>}
                        </li>
                      ))}
                    </ul>
                    {conversa.checklistTentativa && (
                      <div className="muted-sm" style={{ marginTop: 4 }}>tentativa {conversa.checklistTentativa}</div>
                    )}
                  </>
                ) : conversa.checklistConcluido === false && conversa.motivoChecklist ? (
                  <>
                    <div className="muted-sm" style={{ color: CORES_SELO.bloqueado, fontWeight: 700, margin: '4px 0 6px' }}>
                      Checklist não concluído nesta tentativa
                    </div>
                    <p className="muted-sm">{conversa.motivoChecklist}</p>
                  </>
                ) : <p className="muted-sm">{conversa.motor === 'classico' ? 'Atendimento clássico — não usa o motor de etapas.' : 'Nenhuma resposta validada ainda.'}</p>}
              </div>

              <div>
                <b style={{ fontSize: 13 }}>Situação</b>
                <ul className="muted-sm lista-dados">
                  <li>fase anterior: {conversa.faseAnterior ?? '—'}</li>
                  <li>fase atual: {conversa.faseAtual ?? '—'}</li>
                  <li>próxima permitida: {conversa.proximaPermitida ?? '—'}</li>
                  <li>produto: {conversa.produtos.join('; ') || '—'}</li>
                  <li>pedido: {conversa.pedido ? `#${conversa.pedido}` : '—'}{conversa.pedidoValor != null && ` · ${conversa.pedidoValor} ${conversa.moeda ?? ''}`}</li>
                  <li>percentual: {conversa.percentual ?? '—'}{conversa.valor != null && ` · valor ${conversa.valor} ${conversa.moeda ?? ''}`}</li>
                  <li>cupom: {conversa.cupom ?? '—'}</li>
                  <li>idioma: {conversa.idioma ?? '—'}</li>
                  <li>envio: {conversa.origemEnvio ? ROTULO_ORIGEM_ENVIO[conversa.origemEnvio] : 'ainda não enviada'}</li>
                  <li><Clock size={11} /> cadência: mínimo {hora(conversa.cadencia.minimo)}{conversa.cadencia.agendado && ` · agendado ${hora(conversa.cadencia.agendado)}`}</li>
                </ul>
              </div>

              <div>
                <b style={{ fontSize: 13 }}>Revisão</b>
                {conversa.revisao && (
                  <p className="muted-sm">
                    {conversa.revisao.resultado === 'correta' ? '✓ revisada — correta' : '⚠ revisada — encontrei problema'} ·
                    {' '}{conversa.revisao.por} · {hora(conversa.revisao.em)}
                    {conversa.revisao.observacao && <span style={{ display: 'block' }}>{conversa.revisao.observacao}</span>}
                  </p>
                )}
                <input value={observacao} placeholder="observação (opcional)" onChange={e => setObservacao(e.target.value)} />
                <div className="row gap-8" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={() => revisar('correta')}><Check size={13} /> Revisada — correta</button>
                  <button className="btn btn-sm" onClick={() => revisar('problema')}><AlertTriangle size={13} /> Encontrei problema</button>
                  {conversa.revisao && <button className="btn-ghost btn-sm" onClick={() => revisar('limpar')}>limpar</button>}
                </div>
                <p className="muted-sm" style={{ marginTop: 6, lineHeight: 1.45 }}>
                  <ShieldCheck size={11} /> A revisão muda só os metadados da auditoria — nunca fase, mensagem, envio ou relatório.
                </p>
              </div>

              <button className="btn btn-sm" onClick={() => navegar(`/caixa?ticket=${conversa.ticketId}`)}>
                <ExternalLink size={13} /> Abrir conversa
              </button>
            </div>
          )}
        </aside>
      </div>
      <p className="muted-sm" style={{ marginTop: 10 }}>
        Esta página só observa o atendimento: nada aqui muda fase, oferta, envio, aprovação ou relatório.
        {s.lojasVisiveis.length > 1 && ' Cada conversa aparece com a loja dela.'}
      </p>
    </div>
  )
}
