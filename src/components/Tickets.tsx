import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Check, CheckCheck, Users, Shield, Trash2, RotateCcw, Clock, Sparkles, Send, AlertTriangle, Languages,
  Package, ExternalLink, PenSquare, ClipboardList, X, Plus, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useStore, nomeCategoria, nomeIdioma, tempoRelativo } from '../store'
import type { Ticket, AnexoImagem } from '../store'
import { MiniFoto, Modal } from './Shared'

/* Quem escreveu a resposta: a IA ou você (manual) */
function TagOrigem({ origem }: { origem?: 'ia' | 'manual' }) {
  if (origem === 'ia') return <span className="tag tag-purple" style={{ marginLeft: 8 }}><Sparkles size={10} style={{ marginRight: 3, verticalAlign: -1 }} />IA</span>
  if (origem === 'manual') return <span className="tag tag-outro" style={{ marginLeft: 8 }}>manual</span>
  return null
}

/* Fotos que o cliente anexou ao e-mail: miniaturas clicáveis (abre em nova aba) */
function ImagensAnexadas({ anexos }: { anexos?: AnexoImagem[] }) {
  if (!anexos?.length) return null
  return (
    <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
      {anexos.map(a => (
        <a key={a.id} href={`/api/anexos/${a.id}`} target="_blank" rel="noreferrer" title={a.nome}>
          <img src={`/api/anexos/${a.id}`} alt={a.nome}
            style={{ maxWidth: 150, maxHeight: 150, borderRadius: 8, border: '1px solid var(--border)', display: 'block', objectFit: 'cover' }} />
        </a>
      ))}
    </div>
  )
}

export function TicketRow({ t, onOpen, tagStatus }: { t: Ticket; onOpen: (t: Ticket) => void; tagStatus?: boolean }) {
  const { lojasVisiveis, lojaAtiva, prefs, pedidos, moverPara } = useStore()
  const nomeLojaDona = lojaAtiva === 'todas' && lojasVisiveis.length > 1
    ? lojasVisiveis.find(l => l.id === (t.lojaId ?? 'loja1'))?.nome
    : null
  const compacto = prefs.densidade === 'compacto'
  // pedidos do cliente na mesma loja, para mostrar o número sem abrir o ticket
  const emailCliente = t.de.trim().toLowerCase()
  const pedidosDele = pedidos
    .filter(p => (p.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1') && p.email && p.email.trim().toLowerCase() === emailCliente)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))
  return (
    <button className="ticket-row linha-caixa" onClick={() => onOpen(t)}
      style={compacto ? { padding: '7px 16px' } : undefined}>
      <span className={'dot' + (t.lido ? ' read' : '')} />
      <span className="from">
        {t.nome}
        {!compacto && <div className="email">{t.de}</div>}
      </span>
      <span className="subject">
        <b>{t.assunto}</b>{' '}
        {prefs.mostrarPreview && <span className="preview">— {(t.resposta ?? t.corpo).slice(0, 90)}</span>}
      </span>
      {nomeLojaDona && <span className="tag tag-purple">{nomeLojaDona}</span>}
      {tagStatus && t.status === 'enviado' && <span className="tag tag-green">respondido</span>}
      {tagStatus && t.status === 'humano' && <span className="tag tag-amber">para você</span>}
      {/* caso em atendimento humano cuja ÚLTIMA palavra foi nossa: resposta enviada
          DEPOIS da última mensagem do cliente, ou marcação manual. Resposta antiga
          com mensagem nova do cliente por cima NÃO conta como respondido. */}
      {t.status === 'humano' && (t.marcadoRespondido
        || (t.resposta && (!t.respondidoEm || !t.data || t.respondidoEm >= t.data)))
        && <span className="tag tag-green">respondido</span>}
      {t.enviaEm && <CountdownPill ate={t.enviaEm} />}
      {t.historico && t.historico.length > 0 && <span className="tag tag-outro">conversa</span>}
      {(t.custoIA ?? 0) > 0 && <span className="tag tag-outro" title="Custo de IA desta conversa">US$ {t.custoIA!.toFixed(4)}</span>}
      {pedidosDele.length > 0 && (
        <span className="tag tag-rastreio" title={pedidosDele.map(p => `${p.numero} · ${p.criadoEm}`).join('\n')}>
          {pedidosDele[0].numero}{pedidosDele.length > 1 ? ` +${pedidosDele.length - 1}` : ''}
        </span>
      )}
      <span className={`tag tag-${t.categoria}`}>{nomeCategoria[t.categoria]}</span>
      {/* atalho: manda a conversa para o atendimento humano sem abrir */}
      {!['humano', 'spam', 'lixeira'].includes(t.status) && (
        <span className="btn btn-sm" role="button" title="Mover para atendimento humano"
          style={{ padding: '3px 8px' }}
          onClick={e => { e.stopPropagation(); moverPara(t.id, 'humano', 'Movido por você da caixa') }}>
          <Users size={13} />
        </span>
      )}
      <span className="when">{tempoRelativo(t.data)}</span>
    </button>
  )
}

export function CountdownPill({ ate }: { ate: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const i = setInterval(() => force(x => x + 1), 1000)
    return () => clearInterval(i)
  }, [])
  const resta = Math.max(0, Math.floor((ate - Date.now()) / 1000))
  if (resta === 0) return <span className="timer-pill"><Send size={11} /> enviando…</span>
  const mm = String(Math.floor(resta / 60)).padStart(2, '0')
  const ss = String(resta % 60).padStart(2, '0')
  return <span className="timer-pill"><Clock size={12} /> envia em {mm}:{ss}</span>
}

const statusPedido: Record<string, { rotulo: string; cls: string }> = {
  aguardando: { rotulo: 'Aguardando envio', cls: 'tag-amber' },
  transito: { rotulo: 'Em trânsito', cls: 'tag-rastreio' },
  entregue: { rotulo: 'Entregue', cls: 'tag-green' },
  problema: { rotulo: 'Com problema', cls: 'tag-reembolso' },
}

/**
 * Painel à direita do ticket: os pedidos do cliente, localizados pelo e-mail,
 * para a equipe responder sem sair da conversa.
 */
function PainelPedidos({ t }: { t: Ticket }) {
  const { pedidos, fmtMoeda, produtos, tickets } = useStore()
  // foto da variante escolhida (a cor comprada); sem ela, a foto principal do produto
  const fotoDe = (i: { produtoId?: string | null; varianteId?: string | null }) => {
    const pr = i.produtoId ? produtos.find(x => x.id === i.produtoId) : null
    return (i.varianteId && pr?.imagemPorVariante?.[i.varianteId]) || pr?.imagem || null
  }
  const emailCliente = t.de.trim().toLowerCase()
  // o cliente às vezes abre o chamado com outro e-mail e só passa o e-mail da
  // compra (ou o nº do pedido) no meio da conversa — procura por tudo isso
  const textoConversa = [t.assunto, t.corpo, t.resposta, ...(t.historico?.map(m => m.corpo) ?? [])].join('\n').toLowerCase()
  const emailsCitados = new Set([emailCliente, ...(textoConversa.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [])])
  const numerosCitados = new Set<string>()
  for (const m of textoConversa.matchAll(/(?:#\s?|\b(?:pedido|encomenda|order|bestell(?:ung|ing)?|bestelling|commande|ordine)\s*(?:nr\.?|n[º°o]\.?|#)?\s*)(\d{3,7})\b/g)) {
    numerosCitados.add(m[1])
  }
  const todosDoCliente = pedidos
    .filter(p => (p.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1'))
    .filter(p => (p.email && emailsCitados.has(p.email.trim().toLowerCase()))
      || (p.numero && numerosCitados.has(p.numero.replace(/\D/g, ''))))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))
  const doCliente = todosDoCliente.slice(0, 5)

  // Ficha do cliente: histórico de casos ANTERIORES deste cliente na mesma
  // loja — reembolsos recorrentes mudam a decisão (e denunciam abuso)
  const gastoTotal = todosDoCliente.reduce((s, p) => s + (p.valor || 0), 0)
  const casosAnteriores = tickets.filter(t2 =>
    t2.id !== t.id && (t2.lojaId ?? 'loja1') === (t.lojaId ?? 'loja1')
    && !['spam', 'lixeira'].includes(t2.status)
    && emailsCitados.has(t2.de.trim().toLowerCase()))
  const nReembolsos = casosAnteriores.filter(t2 => t2.categoria === 'reembolso').length
  const nTrocas = casosAnteriores.filter(t2 => t2.categoria === 'troca').length

  return (
    <aside className="painel-pedidos" style={{ width: 280, flexShrink: 0 }}>
      {(todosDoCliente.length > 0 || casosAnteriores.length > 0) && (
        <div className="card mb-12" style={{ padding: '12px 16px' }}>
          <div className="row gap-8 mb-8">
            <Users size={14} color="var(--purple)" />
            <b style={{ fontSize: 13 }}>Ficha do cliente</b>
          </div>
          <div style={{ display: 'grid', gap: 4, fontSize: 12.5, lineHeight: 1.5 }}>
            <div>Pedidos na loja: <b>{todosDoCliente.length}</b>{gastoTotal > 0 && <> · gastou <b>{fmtMoeda(gastoTotal)}</b></>}</div>
            <div>Conversas anteriores: <b>{casosAnteriores.length}</b> — reembolso <b>{nReembolsos}</b>, troca <b>{nTrocas}</b></div>
          </div>
          {nReembolsos >= 2 && (
            <span className="tag tag-reembolso" style={{ marginTop: 8, display: 'inline-block' }}>
              atenção: reembolsos recorrentes
            </span>
          )}
          {nReembolsos === 1 && t.categoria === 'reembolso' && (
            <span className="tag tag-amber" style={{ marginTop: 8, display: 'inline-block' }}>
              já teve 1 caso de reembolso antes
            </span>
          )}
        </div>
      )}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div className="row gap-8 mb-12">
          <Package size={15} color="var(--purple)" />
          <b style={{ fontSize: 13.5 }}>Pedidos do cliente</b>
        </div>
        {doCliente.length === 0 ? (
          <p className="muted-sm" style={{ lineHeight: 1.6 }}>
            Nenhum pedido localizado para <b>{t.de}</b> nem pelos e-mails e números de pedido citados na conversa.
            <br /><br />
            O cliente pode ter comprado com outro e-mail — peça o número do pedido ou o e-mail da compra na resposta.
          </p>
        ) : (
          doCliente.map(p => (
            <div key={p.id} className="card-soft mb-8" style={{ padding: '10px 12px' }}>
              <div className="row spread mb-8">
                <b style={{ fontSize: 13 }}>{p.numero}</b>
                <span className={`tag ${statusPedido[p.status]?.cls ?? 'tag-outro'}`}>
                  {statusPedido[p.status]?.rotulo ?? p.status}
                </span>
              </div>
              {p.email && p.email.trim().toLowerCase() !== emailCliente && (
                <div className="muted-sm" style={{ marginTop: -4, marginBottom: 8, overflowWrap: 'anywhere' }}>
                  comprado com {p.email}
                </div>
              )}
              {(p.itens?.length ?? 0) > 0 && (
                <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                  {p.itens!.map((i, idx) => (
                    <span key={idx} className="row gap-8" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <MiniFoto src={fotoDe(i)} alt={i.titulo} tamanho={26} />
                      <span>
                        <b>{i.quantidade}×</b> {i.titulo}
                        {i.variante && <span className="muted-sm"> · {i.variante}</span>}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <div className="muted-sm" style={{ display: 'grid', gap: 3 }}>
                <span>{fmtMoeda(p.valor)} · {p.pais}</span>
                <span>{p.criadoEm && new Date(p.criadoEm + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                {p.rastreio && p.rastreio !== '—' && (
                  <span style={{ fontFamily: 'monospace', fontSize: 11.5, wordBreak: 'break-all' }}>
                    {p.rastreio}
                    {p.urlRastreio && (
                      <a href={p.urlRastreio} target="_blank" rel="noreferrer" title="Abrir rastreio"
                        style={{ marginLeft: 6, color: 'var(--purple)', verticalAlign: -2 }}>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </span>
                )}
                {p.transportadora && <span>{p.transportadora}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

/* Popup do "Adicionar ao relatório": o lojista escolhe (e configura) o texto
   pré-definido que vira a linha do caso no relatório manual do dia */
function ModalRelatorio({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const { opcoesRelatorio = [], alternarRelatorio, salvarOpcoesRelatorio } = useStore()
  const [novo, setNovo] = useState('')
  const escolher = (texto?: string) => { alternarRelatorio(t.id, true, texto); onClose() }
  return (
    <Modal title="Adicionar ao relatório de hoje" onClose={onClose}>
      <p className="muted-sm" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        Escolha como este caso aparece no relatório manual — a linha sai como <b>PEDIDO Nº - texto escolhido</b>.
      </p>
      {opcoesRelatorio.map(o => (
        <div key={o} className="row gap-8 mb-8">
          <button className={'btn' + (t.relatorioDia && t.relatorioTexto === o ? ' btn-primary' : '')}
            style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => escolher(o)}>
            {o}
          </button>
          <button className="btn-ghost btn-sm" title="Tirar esta opção da lista"
            onClick={() => salvarOpcoesRelatorio(opcoesRelatorio.filter(x => x !== o))}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button className={'btn mb-12' + (t.relatorioDia && !t.relatorioTexto ? ' btn-primary' : '')}
        style={{ width: '100%', justifyContent: 'flex-start' }}
        title="A linha usa a resolução que a IA anotou para esta conversa"
        onClick={() => escolher(undefined)}>
        <Sparkles size={13} /> Usar a resolução automática{t.resolucao ? ` — “${t.resolucao.length > 46 ? t.resolucao.slice(0, 46) + '…' : t.resolucao}”` : ''}
      </button>
      <div className="field">
        <label>Outro texto</label>
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <input value={novo} onChange={e => setNovo(e.target.value)} placeholder="ex.: REEMBOLSO 50%"
            style={{ flex: 1, minWidth: 160 }}
            onKeyDown={e => { if (e.key === 'Enter' && novo.trim()) escolher(novo.trim()) }} />
          <button className="btn" disabled={!novo.trim()} title="Usa este texto só neste caso"
            onClick={() => escolher(novo.trim())}>Usar</button>
          <button className="btn" disabled={!novo.trim()} title="Adiciona à lista de opções para as próximas vezes"
            onClick={() => { salvarOpcoesRelatorio([...opcoesRelatorio, novo.trim()]); setNovo('') }}>
            <Plus size={13} /> Salvar opção
          </button>
        </div>
      </div>
      {t.relatorioDia && (
        <div className="row spread" style={{ marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <span className="muted-sm">No relatório como: <b>{t.relatorioTexto ?? 'resolução automática'}</b></span>
          <button className="btn btn-danger btn-sm" onClick={() => { alternarRelatorio(t.id, false); onClose() }}>
            <X size={13} /> Remover do relatório
          </button>
        </div>
      )}
    </Modal>
  )
}

const rotuloStatus: Record<string, string> = {
  inbox: 'Aguardando primeira resposta',
  aprovacao: 'Aguardando sua aprovação',
  humano: 'Aguardando sua decisão',
  enviado: 'Respondida',
  spam: 'Marcada como spam',
  lixeira: 'Na lixeira',
}

export function TicketDetail({ t, onBack }: { t: Ticket; onBack: () => void }) {
  const { aprovarEnviar, editarRascunho, moverPara, restaurar, excluirDefinitivo, marcarLido, marcarResolvido, marcarRespondido, pausarIA, traduzirTicket, regenerarRascunho, traduzirRascunho, gerarTexto, traduzirTexto, config, lojas } = useStore()
  // com idioma fixo na loja, as respostas podem estar em outro idioma mesmo que o cliente escreva em pt
  const idiomaDaLoja = lojas.find(l => l.id === (t.lojaId ?? 'loja1'))?.idioma ?? 'auto'
  const respostaEmOutroIdioma = idiomaDaLoja !== 'auto' && idiomaDaLoja !== 'pt'
  const [texto, setTexto] = useState(t.rascunho ?? '')
  const [manual, setManual] = useState('')
  const [novaResposta, setNovaResposta] = useState(false)
  const [instrucao, setInstrucao] = useState('')
  const [gerando, setGerando] = useState(false)
  const [erroGerar, setErroGerar] = useState<string | null>(null)
  const [verTradRascunho, setVerTradRascunho] = useState(false)
  const [traduzindoRasc, setTraduzindoRasc] = useState(false)
  const [traducaoManual, setTraducaoManual] = useState<string | null>(null)
  const [resumoAberto, setResumoAberto] = useState(true)
  const [modalRelatorio, setModalRelatorio] = useState(false)

  // Regeneração e troca de ticket atualizam o texto na tela — mas o eco do
  // salvamento automático (debounce) nunca pode reverter o que você digita.
  const ultimoEditado = useRef(t.rascunho ?? '')
  useEffect(() => {
    if ((t.rascunho ?? '') !== ultimoEditado.current) {
      setTexto(t.rascunho ?? '')
      ultimoEditado.current = t.rascunho ?? ''
    }
  }, [t.rascunho])
  const [verTraducao, setVerTraducao] = useState(false)
  const [traduzindo, setTraduzindo] = useState(false)

  useEffect(() => { if (!t.lido) marcarLido(t.id) }, [t.id])

  const emFluxo = t.status === 'inbox' || t.status === 'aprovacao' || t.status === 'humano'

  const respostasEnviadas = (t.historico?.filter(m => m.autor === 'atendo').length ?? 0) + (t.resposta ? 1 : 0)
  const iaJaFez = respostasEnviadas > 0
    ? `${respostasEnviadas} resposta${respostasEnviadas > 1 ? 's' : ''} enviada${respostasEnviadas > 1 ? 's' : ''}`
    : t.rascunho ? 'Rascunho pronto, aguardando envio' : 'Ainda sem resposta'
  // a última palavra foi nossa: resposta enviada DEPOIS da última mensagem do
  // cliente, ou marcação manual — resposta antiga com mensagem nova não conta
  const jaRespondida = !!(t.marcadoRespondido
    || (t.resposta && (!t.respondidoEm || !t.data || t.respondidoEm >= t.data)))
  const statusTexto = t.status === 'aprovacao' && t.enviaEm
    ? 'Envio automático agendado'
    : t.status === 'humano' && jaRespondida
      ? 'Respondida — aguardando sua decisão para fechar'
      : (rotuloStatus[t.status] ?? t.status)

  const alternarTraducao = async () => {
    const faltaTraduzir = (t.corpo && !t.traducao)
      || (t.resposta && !t.respostaTraducao)
      || (t.resumoSituacao && !t.situacaoTraducao)
      || (t.motivoEscalada && !t.motivoTraducao)
      || t.historico?.some(m => m.corpo && !m.traducao)
    if (faltaTraduzir) {
      setTraduzindo(true)
      const ok = await traduzirTicket(t.id)
      setTraduzindo(false)
      if (!ok) return
      setVerTraducao(true)
      return
    }
    setVerTraducao(v => !v)
  }

  // Barra de IA das caixas manuais (Responder manualmente / Nova mensagem):
  // gera o texto direto na caixa, sem virar rascunho nem mudar o status
  const gerarNaCaixa = async () => {
    setGerando(true); setErroGerar(null)
    const r = await gerarTexto(t.id, instrucao.trim())
    setGerando(false)
    if (r.erro) { setErroGerar(r.erro); return }
    setManual(r.texto ?? '')
    setTraducaoManual(null)
    setInstrucao('')
  }
  const traduzirCaixa = async () => {
    if (traducaoManual) { setTraducaoManual(null); return }
    if (!manual.trim()) return
    setTraduzindoRasc(true); setErroGerar(null)
    const r = await traduzirTexto(manual)
    setTraduzindoRasc(false)
    if (r.erro) { setErroGerar(r.erro); return }
    setTraducaoManual(r.traducao ?? null)
  }
  const barraIAManual = (
    <>
      {traducaoManual && (
        <div className="card-soft" style={{ padding: '10px 12px', marginTop: 10, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          <div className="row gap-8 mb-8">
            <Languages size={13} color="var(--purple)" />
            <b style={{ fontSize: 12.5 }}>Tradução — só para você conferir; o envio usa o texto acima</b>
          </div>
          {traducaoManual}
        </div>
      )}
      <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <input value={instrucao} onChange={e => setInstrucao(e.target.value)}
          placeholder="Instrução para a IA (ex.: avise que houve erro no endereço)…"
          style={{ flex: 1, minWidth: 220, border: '1px solid var(--purple-border)', borderRadius: 8, padding: '7px 11px', fontSize: 13, outline: 'none', background: 'var(--panel)' }}
          onKeyDown={e => { if (e.key === 'Enter' && !gerando) gerarNaCaixa() }} />
        <button className="btn btn-sm" disabled={gerando} onClick={gerarNaCaixa}>
          <Sparkles size={13} /> {gerando ? 'Gerando…' : 'Gerar com IA'}
        </button>
        <button className="btn btn-sm" disabled={traduzindoRasc || (!manual.trim() && !traducaoManual)} onClick={traduzirCaixa}>
          <Languages size={13} /> {traduzindoRasc ? 'Traduzindo…' : traducaoManual ? 'Ocultar tradução' : 'Ver em português'}
        </button>
      </div>
      {erroGerar && <p className="muted-sm" style={{ color: 'var(--red)', marginTop: 6 }}>{erroGerar}</p>}
    </>
  )

  return (
    <div className="detail-wrap" style={{ display: 'flex', gap: 20, alignItems: 'flex-start', maxWidth: 1180, margin: '0 auto' }}>
    <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
      <button className="btn btn-sm mb-16" onClick={onBack}><ArrowLeft size={14} /> Voltar</button>

      <div className="row gap-10 mb-12" style={{ flexWrap: 'wrap' }}>
        <h1 className="h2">{t.assunto}</h1>
        <span className={`tag tag-${t.categoria}`}>{nomeCategoria[t.categoria]}</span>
        <span className="tag tag-outro">{nomeIdioma[t.idioma] ?? t.idioma}</span>
        {t.confianca !== undefined && (
          <span className={'tag ' + (t.confianca >= 0.8 ? 'tag-green' : t.confianca >= 0.55 ? 'tag-amber' : 'tag-reembolso')}>
            confiança {Math.round(t.confianca * 100)}%
          </span>
        )}
        {t.enviaEm && !t.iaPausada && <CountdownPill ate={t.enviaEm} />}
        {t.historico && t.historico.length > 0 && <span className="tag tag-outro">conversa</span>}
        {t.status === 'humano' && jaRespondida && <span className="tag tag-green">respondida</span>}
      </div>

      {/* Resumo da conversa */}
      <div className="card-soft mb-12" style={{ padding: '14px 16px' }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
          <b style={{ fontSize: 13.5 }}>Resumo da conversa</b>
          <div className="row gap-8">
            {t.status === 'humano' && !t.resposta && (
              <button className={'btn btn-sm' + (t.marcadoRespondido ? ' btn-primary' : '')}
                title={t.marcadoRespondido ? 'Desmarcar "respondida"' : 'A resposta já saiu por outro caminho? Marca a conversa como respondida (sem enviar nada)'}
                onClick={() => marcarRespondido(t.id, !t.marcadoRespondido)}>
                <CheckCheck size={13} /> {t.marcadoRespondido ? 'Respondida ✓' : 'Marcar respondida'}
              </button>
            )}
            <button className={'btn btn-sm' + (t.relatorioDia ? ' btn-primary' : '')}
              title={t.relatorioDia ? 'Trocar o texto ou remover do relatório' : 'Marcar este caso para o relatório manual de hoje (página Resumo diário)'}
              onClick={() => setModalRelatorio(true)}>
              <ClipboardList size={13} /> {t.relatorioDia ? 'No relatório ✓' : 'Adicionar ao relatório'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setResumoAberto(a => !a)}>{resumoAberto ? 'Ocultar' : 'Mostrar'}</button>
          </div>
        </div>
        {resumoAberto && (
          <div style={{ marginTop: 8, display: 'grid', gap: 5, fontSize: 13, lineHeight: 1.55 }}>
            <div><b>Situação:</b> <span className="muted">{(verTraducao && t.situacaoTraducao) || t.resumoSituacao || `${nomeCategoria[t.categoria]} — ${t.assunto}`}</span></div>
            {t.resolucao && <div><b>Resolução:</b> <span className="muted">{t.resolucao}</span></div>}
            <div><b>IA já fez:</b> <span className="muted">{iaJaFez}</span></div>
            <div><b>Status:</b> <span className="muted">{statusTexto}</span></div>
            <div><b>Custo da IA nesta conversa:</b> <span className="muted">US$ {(t.custoIA ?? 0).toFixed(4)}</span></div>
          </div>
        )}
      </div>

      {/* Pausar / retomar a IA nesta conversa */}
      {t.status !== 'spam' && t.status !== 'lixeira' && (
        <div className="card mb-12" style={{ padding: '12px 16px' }}>
          <div className="row spread">
            <span style={{ fontWeight: 700, fontSize: 13.5, color: t.iaPausada ? 'var(--amber)' : 'var(--green)' }}>
              {t.iaPausada ? 'IA pausada' : 'IA ativa'}
            </span>
            <button className={'btn btn-sm' + (t.iaPausada ? ' btn-primary' : '')} onClick={() => pausarIA(t.id, !t.iaPausada)}>
              {t.iaPausada ? 'Retomar IA' : 'Pausar IA'}
            </button>
          </div>
          <p className="muted-sm" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Quando pausada, a IA nem lê as novas mensagens desta conversa — zero gasto de tokens. Elas caem direto para você responder manualmente, até clicar em "Retomar IA".
          </p>
        </div>
      )}

      {t.motivoEscalada && t.status === 'humano' && (
        <div className="banner card-purple mb-12">
          <Users size={15} color="var(--purple)" />
          <span><b>Sinalizado para você:</b> {(verTraducao && t.motivoTraducao) || t.motivoEscalada}</span>
        </div>
      )}

      {t.erroEnvio && (
        <div className="banner mb-12" style={{ borderColor: 'var(--danger-border)', background: 'var(--danger-bg)', alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="var(--red)" style={{ marginTop: 2 }} />
          <span>
            <b>O envio falhou{t.tentativasEnvio ? ` (tentativa ${t.tentativasEnvio})` : ''}:</b> {t.erroEnvio}
          </span>
        </div>
      )}

      {(t.idioma !== 'pt' || respostaEmOutroIdioma || t.traducao || t.respostaTraducao || t.historico?.some(m => m.traducao)) && (
        <div className="row mb-12" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={alternarTraducao} disabled={traduzindo}>
            <Languages size={13} />
            {traduzindo ? 'Traduzindo conversa…' : verTraducao ? 'Ver original' : 'Traduzir conversa para português'}
          </button>
        </div>
      )}

      {t.historico?.map((m, i) => (
        <div key={i} className="detail-msg" style={{ opacity: 0.75, ...(m.autor === 'atendo' ? { background: 'var(--panel-soft)' } : {}) }}>
          <div className="head">
            <span>
              {m.autor === 'atendo' ? <Send size={12} style={{ marginRight: 6 }} /> : null}
              <b style={{ color: 'var(--text)' }}>{m.autor === 'atendo' ? 'Você respondeu' : t.nome}</b>
              {m.autor === 'atendo' && <TagOrigem origem={m.origem} />}
              {verTraducao && m.traducao ? <span className="tag tag-outro" style={{ marginLeft: 8 }}>traduzido</span> : null}
            </span>
            <span>{new Date(m.data).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{verTraducao && m.traducao ? m.traducao : m.corpo}</div>
          <ImagensAnexadas anexos={m.anexos} />
        </div>
      ))}

      {t.corpo && (
        <div className="detail-msg">
          <div className="head">
            <span>
              <b style={{ color: 'var(--text)' }}>{t.nome}</b> &lt;{t.de}&gt;
              {t.historico?.length ? <span className="tag tag-purple" style={{ marginLeft: 8 }}>nova resposta</span> : null}
              {verTraducao && t.traducao ? <span className="tag tag-outro" style={{ marginLeft: 8 }}>traduzido</span> : null}
            </span>
            <span>{new Date(t.data).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{verTraducao && t.traducao ? t.traducao : t.corpo}</div>
          <ImagensAnexadas anexos={t.anexos} />
        </div>
      )}

      {t.resposta && (
        <div className="detail-msg" style={{ background: 'var(--panel-soft)' }}>
          <div className="head">
            <span>
              <Send size={12} style={{ marginRight: 6 }} /><b style={{ color: 'var(--text)' }}>Você respondeu</b>
              <TagOrigem origem={t.respostaOrigem} />
              {verTraducao && t.respostaTraducao ? <span className="tag tag-outro" style={{ marginLeft: 8 }}>traduzido</span> : null}
            </span>
            <span>{t.respondidoEm && new Date(t.respondidoEm).toLocaleString('pt-BR')}</span>
          </div>
          <div className="body">{verTraducao && t.respostaTraducao ? t.respostaTraducao : t.resposta}</div>
        </div>
      )}

      {emFluxo && t.rascunho !== undefined && (
        <div className="draft-box">
          <div className="row gap-8 mb-12">
            <Sparkles size={15} color="var(--purple)" />
            <span className="h3" style={{ color: 'var(--purple)' }}>Resposta sugerida</span>
            <span className="muted-sm">
              {t.geradoPorIA ? 'gerada pelo Claude a partir das suas políticas e do pedido' : 'gerada por regras — conecte a IA nas Configurações'}
            </span>
          </div>
          <textarea value={texto} onChange={e => { setTexto(e.target.value); ultimoEditado.current = e.target.value; editarRascunho(t.id, e.target.value) }} />

          {verTradRascunho && t.rascunhoTraducao && (
            <div className="card-soft" style={{ padding: '10px 12px', marginTop: 10, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              <div className="row gap-8 mb-8">
                <Languages size={13} color="var(--purple)" />
                <b style={{ fontSize: 12.5 }}>Tradução — só para você conferir; o envio usa o texto acima</b>
              </div>
              {t.rascunhoTraducao}
            </div>
          )}

          <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <input value={instrucao} onChange={e => setInstrucao(e.target.value)}
              placeholder="Instrução para refazer (ex.: ofereça 10% de desconto, seja mais curto)…"
              style={{ flex: 1, minWidth: 220, border: '1px solid var(--purple-border)', borderRadius: 8, padding: '7px 11px', fontSize: 13, outline: 'none', background: 'var(--panel)' }}
              onKeyDown={e => { if (e.key === 'Enter' && !gerando) (document.getElementById('btn-gerar') as HTMLButtonElement)?.click() }} />
            <button id="btn-gerar" className="btn btn-sm" disabled={gerando}
              onClick={async () => {
                setGerando(true); setErroGerar(null); setVerTradRascunho(false)
                const erro = await regenerarRascunho(t.id, instrucao.trim())
                setGerando(false)
                if (erro) setErroGerar(erro)
                else setInstrucao('')
              }}>
              <Sparkles size={13} /> {gerando ? 'Gerando…' : 'Gerar nova resposta'}
            </button>
            <button className="btn btn-sm" disabled={traduzindoRasc}
              onClick={async () => {
                if (verTradRascunho) { setVerTradRascunho(false); return }
                // sempre pergunta ao servidor — ele retraduz se o rascunho mudou
                setTraduzindoRasc(true)
                const erro = await traduzirRascunho(t.id)
                setTraduzindoRasc(false)
                if (erro) { setErroGerar(erro); return }
                setVerTradRascunho(true)
              }}>
              <Languages size={13} /> {traduzindoRasc ? 'Traduzindo…' : verTradRascunho ? 'Ocultar tradução' : 'Ver em português'}
            </button>
          </div>
          {erroGerar && <p className="muted-sm" style={{ color: 'var(--red)', marginTop: 6 }}>{erroGerar}</p>}

          <div className="row gap-8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            {t.status === 'humano' && (
              <button className="btn" title="Envia a mensagem ao cliente, mas a conversa continua em atendimento humano até você aprovar"
                onClick={() => aprovarEnviar(t.id, texto, true, 'ia')}>
                <Send size={14} /> Enviar (continua comigo)
              </button>
            )}
            <button className="btn btn-primary" title="Envia a mensagem e fecha o caso"
              onClick={() => { aprovarEnviar(t.id, texto, false, 'ia'); onBack() }}>
              <Check size={14} /> Aprovar e enviar
            </button>
            <button className="btn" title={t.resposta ? 'Fecha o caso sem enviar mais nada' : 'Fecha o caso sem enviar nada — ele sai daqui e fica como respondido'}
              onClick={() => { marcarResolvido(t.id); onBack() }}>
              <CheckCheck size={14} /> {t.resposta ? 'Aprovar e fechar' : 'Resolvido sem enviar'}
            </button>
            {t.status !== 'humano' && (
              <button className="btn" onClick={() => { moverPara(t.id, 'humano', 'Escalado manualmente por você'); onBack() }}>
                <Users size={14} /> Escalar para mim
              </button>
            )}
            <button className="btn" onClick={() => { moverPara(t.id, 'spam'); onBack() }}><Shield size={14} /> Spam</button>
            <button className="btn btn-danger" onClick={() => { moverPara(t.id, 'lixeira'); onBack() }}><Trash2 size={14} /> Excluir</button>
          </div>
        </div>
      )}

      {/* Resposta manual: sem rascunho da IA (ex.: IA pausada), você escreve do zero */}
      {emFluxo && t.rascunho === undefined && (
        <div className="draft-box">
          <div className="row gap-8 mb-12">
            <PenSquare size={15} color="var(--purple)" />
            <span className="h3" style={{ color: 'var(--purple)' }}>Responder manualmente</span>
            <span className="muted-sm">escreva do seu jeito — ou peça um texto à IA na barra abaixo</span>
          </div>
          <textarea value={manual} onChange={e => { setManual(e.target.value); setTraducaoManual(null) }} placeholder="Escreva sua resposta ao cliente…" />
          {barraIAManual}
          <div className="row gap-8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            {t.status === 'humano' && (
              <button className="btn" disabled={!manual.trim()} style={!manual.trim() ? { opacity: 0.5 } : undefined}
                title="Envia a mensagem ao cliente, mas a conversa continua em atendimento humano até você aprovar"
                onClick={() => { aprovarEnviar(t.id, manual.trim(), true, 'manual'); setManual(''); setTraducaoManual(null) }}>
                <Send size={14} /> Enviar (continua comigo)
              </button>
            )}
            <button className="btn btn-primary" disabled={!manual.trim()} style={!manual.trim() ? { opacity: 0.5 } : undefined}
              title="Envia a mensagem e fecha o caso"
              onClick={() => { aprovarEnviar(t.id, manual.trim(), false, 'manual'); onBack() }}>
              <Send size={14} /> {t.status === 'humano' ? 'Aprovar e enviar' : 'Enviar resposta'}
            </button>
            <button className="btn" title={t.resposta ? 'Fecha o caso sem enviar mais nada' : 'Fecha o caso sem enviar nada — ele sai daqui e fica como respondido'}
              onClick={() => { marcarResolvido(t.id); onBack() }}>
              <CheckCheck size={14} /> {t.resposta ? 'Aprovar e fechar' : 'Resolvido sem enviar'}
            </button>
            <button className="btn" onClick={() => { moverPara(t.id, 'spam'); onBack() }}><Shield size={14} /> Spam</button>
            <button className="btn btn-danger" onClick={() => { moverPara(t.id, 'lixeira'); onBack() }}><Trash2 size={14} /> Excluir</button>
          </div>
        </div>
      )}

      {/* Conversa já respondida: dá para mandar uma nova mensagem quando quiser */}
      {t.status === 'enviado' && (
        !novaResposta ? (
          <button className="btn" onClick={() => setNovaResposta(true)}><PenSquare size={14} /> Responder novamente</button>
        ) : (
          <div className="draft-box">
            <div className="row gap-8 mb-12">
              <PenSquare size={15} color="var(--purple)" />
              <span className="h3" style={{ color: 'var(--purple)' }}>Nova mensagem ao cliente</span>
              <span className="muted-sm">escreva do seu jeito — ou peça um texto à IA na barra abaixo</span>
            </div>
            <textarea value={manual} onChange={e => { setManual(e.target.value); setTraducaoManual(null) }} placeholder="Escreva a mensagem…" autoFocus />
            {barraIAManual}
            <div className="row gap-8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!manual.trim()} style={!manual.trim() ? { opacity: 0.5 } : undefined}
                onClick={() => { aprovarEnviar(t.id, manual.trim(), false, 'manual'); setManual(''); setNovaResposta(false) }}>
                <Send size={14} /> Enviar
              </button>
              <button className="btn" onClick={() => setNovaResposta(false)}>Cancelar</button>
            </div>
          </div>
        )
      )}

      {(t.status === 'spam' || t.status === 'lixeira') && (
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { restaurar(t.id); onBack() }}><RotateCcw size={14} /> Restaurar</button>
          {t.status === 'lixeira' && (
            <button className="btn btn-danger" onClick={() => { excluirDefinitivo(t.id); onBack() }}><Trash2 size={14} /> Excluir definitivamente</button>
          )}
          {t.status === 'spam' && (
            <button className="btn btn-danger" onClick={() => { moverPara(t.id, 'lixeira'); onBack() }}><Trash2 size={14} /> Mover para a lixeira</button>
          )}
        </div>
      )}
    </div>

    <PainelPedidos t={t} />

    {/* atalhos de rolagem para conversas longas: coluna sticky colada à direita
        do conteúdo — acompanha a rolagem sempre na mesma altura da janela */}
    <div className="botoes-rolagem" style={{ position: 'sticky', top: '58vh', alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <button className="btn" title="Ir para o topo da conversa"
        style={{ padding: 9, borderRadius: '50%', boxShadow: 'var(--shadow)' }}
        onClick={() => document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0, behavior: 'smooth' })}>
        <ChevronUp size={16} />
      </button>
      <button className="btn" title="Ir para o fim da conversa"
        style={{ padding: 9, borderRadius: '50%', boxShadow: 'var(--shadow)' }}
        onClick={() => { const c = document.querySelector<HTMLElement>('.content'); c?.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }) }}>
        <ChevronDown size={16} />
      </button>
    </div>

    {modalRelatorio && <ModalRelatorio t={t} onClose={() => setModalRelatorio(false)} />}
    </div>
  )
}

export function TicketListPage({ tickets, empty, header, tagStatus }: {
  tickets: Ticket[]
  empty: React.ReactNode
  header?: React.ReactNode
  tagStatus?: boolean
}) {
  const [aberto, setAberto] = useState<string | null>(null)
  const atual = tickets.find(t => t.id === aberto)

  if (atual) return <TicketDetail t={atual} onBack={() => setAberto(null)} />

  return (
    <div>
      {header}
      {tickets.length === 0 ? empty : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {tickets.map(t => <TicketRow key={t.id} t={t} onOpen={x => setAberto(x.id)} tagStatus={tagStatus} />)}
        </div>
      )}
    </div>
  )
}
