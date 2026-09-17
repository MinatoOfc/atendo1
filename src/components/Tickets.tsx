import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Check, CheckCheck, Users, Shield, Trash2, RotateCcw, Clock, Sparkles, Send, AlertTriangle, Languages,
  Package, ExternalLink, PenSquare, ClipboardList, X, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useStore, nomeCategoria, nomeIdioma, tempoRelativo } from '../store'
import type { Ticket, AnexoImagem } from '../store'
import { MiniFoto, Modal } from './Shared'

/* Instruções salvas do "Gerar com IA": 1 clique gera; dá para salvar a atual e remover as que não usa */
function OpcoesInstrucao({ atual, onUsar }: { atual: string; onUsar: (texto: string) => void }) {
  const { opcoesInstrucao = [], salvarOpcoesInstrucao } = useStore()
  const podeSalvar = atual.trim().length > 2 && !opcoesInstrucao.includes(atual.trim())
  if (!opcoesInstrucao.length && !podeSalvar) return null
  return (
    <div className="row gap-8" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      {opcoesInstrucao.map(o => (
        <span key={o} className="chip" role="button" title={`Gerar com: ${o}`}
          style={{ cursor: 'pointer' }} onClick={() => onUsar(o)}>
          <Sparkles size={11} /> {o.length > 48 ? o.slice(0, 48) + '…' : o}
          <span role="button" title="Tirar esta instrução da lista" style={{ marginLeft: 2, color: 'var(--text-3)', display: 'inline-flex' }}
            onClick={e => { e.stopPropagation(); salvarOpcoesInstrucao(opcoesInstrucao.filter(x => x !== o)) }}>
            <X size={11} />
          </span>
        </span>
      ))}
      {podeSalvar && (
        <span className="chip" role="button" title="Salvar o texto digitado como instrução de 1 clique"
          style={{ cursor: 'pointer', color: 'var(--purple)' }}
          onClick={() => salvarOpcoesInstrucao([...opcoesInstrucao, atual.trim()])}>
          <Plus size={11} /> Salvar instrução
        </span>
      )}
    </div>
  )
}

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
  const { lojasVisiveis, lojaAtiva, prefs, pedidos, moverPara, fasesNovo } = useStore()
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
      {/* modo novo: em que fase da escada a conversa está */}
      {t.atendimentoNovo && fasesNovo && (
        <span className="tag tag-outro" title="Fase do atendimento novo">
          {t.atendimentoNovo.etapa ? fasesNovo[t.atendimentoNovo.etapa]?.titulo ?? t.atendimentoNovo.etapa : 'Triagem'}
        </span>
      )}
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
/* ---------- Modo novo: fase, oferta e próximos passos da conversa ---------- */

const JORNADA_DO_FLUXO: Record<string, string> = {
  tamanho: 'tamanho', errado: 'defeito_errado', defeito: 'defeito_errado', qualidade: 'qualidade',
  nao_recebido_status: 'nao_recebido', nao_recebido_reembolso: 'nao_recebido', entregue_nao_recebido: 'nao_recebido',
  cancelamento: 'cancelamento',
}
const NOME_MOTIVO: Record<string, string> = {
  tamanho: 'tamanho não serviu', qualidade: 'qualidade/material', nao_gostou: 'não gostou', defeito: 'defeito',
  errado: 'produto errado', nao_recebido: 'não recebido', nao_informado: 'não informou',
}
const NOME_FALTA: Record<string, string> = {
  pedido: 'número do pedido', produtos: 'quais produtos', motivo: 'o motivo', ajuste: 'se ficou pequeno ou grande', foto: 'foto do defeito',
  end_rua: 'rua e número', end_cep: 'código postal', end_cidade: 'cidade', foto_melhor: 'outra foto, nítida',
}
function descreverOferta(o: { tipo: string; pct: number | null; cupom: number | null; prazo: string | null; semDevolucao: boolean } | null) {
  if (!o) return '—'
  const partes: string[] = []
  if (o.tipo === 'troca') partes.push('troca gratuita')
  if (o.tipo === 'troca_reembolso') partes.push(`troca gratuita + reembolso de ${o.pct}%`)
  if (o.tipo === 'reenvio') partes.push('reenvio expresso')
  if (o.tipo === 'reenvio_reembolso') partes.push(`reenvio expresso + reembolso de ${o.pct}%`)
  if (o.tipo === 'reembolso') partes.push(`reembolso de ${o.pct}%`)
  if (o.tipo === 'cancelamento') partes.push('cancelamento')
  if (o.tipo === 'cupom') partes.push(`cupom de ${o.cupom}%`)
  else if (o.cupom) partes.push(`cupom de ${o.cupom}%`)
  if (o.prazo) partes.push(o.prazo)
  if (o.semDevolucao) partes.push('sem devolução')
  return partes.join(' · ')
}
const quando = (iso?: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

function LinhaFase({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, fontSize: 12.5, lineHeight: 1.5, padding: '3px 0' }}>
      <span className="muted-sm" style={{ paddingTop: 1 }}>{rotulo}</span>
      <span>{children}</span>
    </div>
  )
}

/* o que a confirmação vai dizer, conforme o tipo da opção aceita (mapa, seção 9) */
function descreverConfirmacao(tipo?: string | null) {
  if (!tipo) return ''
  if (/troca|reenvio/.test(tipo)) return ' (aprovado, prazo do envio expresso e o endereço confirmado)'
  if (/reembolso|cancelamento/.test(tipo)) return ' (aprovado e 3 a 14 dias para o dinheiro voltar ao método de pagamento)'
  if (tipo === 'cupom') return ' (código do cupom liberado)'
  return ''
}

/* linha sugerida para o relatório manual a partir da opção aceita — só entra se o dono clicar */
function sugestaoRelatorio(t: Ticket, fasesNovo?: Record<string, { oferta: { tipo: string; pct: number | null; cupom: number | null } | null }>): string | null {
  const an = t.atendimentoNovo
  const o = an?.acaoAceita ? fasesNovo?.[an.acaoAceita]?.oferta : null
  if (!an || !o) return null
  const partes: string[] = []
  if (o.tipo === 'cancelamento') partes.push('CANCELAMENTO')
  else if (o.tipo === 'reembolso') partes.push(`REEMBOLSO ${o.pct}%`)
  else if (o.tipo === 'cupom') partes.push(`CUPOM ${o.cupom}%`)
  else {
    partes.push(/reenvio/.test(o.tipo) ? 'REENVIO' : 'TROCA')
    if (o.pct) partes.push(`+ REEMBOLSO ${o.pct}%`)
    if (o.cupom) partes.push(`+ CUPOM ${o.cupom}%`)
    if (an.enderecoConfirmado) partes.push(`— ENDEREÇO: ${an.enderecoConfirmado}`)
  }
  return partes.join(' ')
}

/** Motor desta conversa: definido no nascimento (data real do primeiro e-mail × ativação do novo) e nunca muda. Não existe migração. */
function PainelMotor({ t }: { t: Ticket }) {
  const { lojas } = useStore()
  const loja = lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
  const motor = t.motorAtendimento ?? t.motor ?? (t.atendimentoNovo ? 'novo' : 'classico')
  const lojaNovo = loja?.modoAtendimento === 'novo'
  if (motor === 'novo' && !lojaNovo) {
    return <div className="muted-sm" style={{ marginBottom: 10 }}>Motor desta conversa: <b>novo</b> — a loja voltou ao clássico, mas esta conversa segue suas etapas até o fim. O motor de uma conversa nunca muda.</div>
  }
  if (motor === 'classico' && lojaNovo) {
    return (
      <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 12.5 }}>
        <div>Motor desta conversa: <b>clássico</b> — o primeiro e-mail chegou antes de a loja ativar o novo. Ela fica no clássico para sempre; o motor de uma conversa nunca muda e não existe migração.</div>
      </div>
    )
  }
  return null
}

function PainelFaseNovo({ t }: { t: Ticket }) {
  const { fasesNovo, jornadasNovo, lojas, validarFotoNovo, confirmarAceiteNovo, recusarAceiteNovo } = useStore()
  const an = t.atendimentoNovo
  if (!an || !fasesNovo) return null
  const titulo = (id?: string | null) => (id ? fasesNovo[id]?.titulo ?? id : '')
  const fase = an.etapa ? fasesNovo[an.etapa] : null
  const jornada = an.fluxo ? jornadasNovo?.[JORNADA_DO_FLUXO[an.fluxo] ?? ''] : null
  const pendente = an.transicaoPendente
  const faltando = pendente?.faltando ?? []
  const loja = lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
  const minimo = an.proximoEnvioMinimo ? new Date(an.proximoEnvioMinimo).getTime() : null

  const aguardando = an.aguardando === 'humano' ? 'você (decisão pendente)'
    : an.aguardando === 'envio' ? 'o envio do rascunho'
      : an.aguardando === 'cliente' ? 'resposta do cliente' : 'classificação da primeira mensagem'

  let proxima: React.ReactNode
  if (an.aguardando === 'humano') {
    proxima = an.acaoAceita
      ? <>Decisão sua — {fasesNovo[an.acaoAceita]?.decisaoDono ? 'chegou a' : 'o cliente aceitou'} <b>{titulo(an.acaoAceita)}</b>{an.enderecoConfirmado ? ` (endereço: ${an.enderecoConfirmado})` : ''}</>
      : <>Decisão sua — {t.motivoEscalada || 'sem próxima etapa automática'}</>
  } else if (pendente) {
    proxima = <>Rascunho pronto para <b>{titulo(pendente.para)}</b></>
  } else if (fase) {
    const seAceitar = fase.aoAceitar === 'endereco' ? 'pedir o endereço e passar para você' : fase.aoAceitar === 'humano' ? 'passar para você' : '—'
    const seRecusar = fase.aoRecusar ? titulo(fase.aoRecusar) : 'passar para você'
    proxima = <>Se aceitar → {seAceitar}. Se recusar → <b>{seRecusar}</b>.</>
  } else {
    proxima = 'Definida na primeira classificação'
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div className="row gap-8 mb-8" style={{ flexWrap: 'wrap' }}>
        <Sparkles size={13} color="var(--purple)" />
        <b style={{ fontSize: 13 }}>Atendimento novo</b>
        {jornada && <span className="tag tag-outro">{jornada}</span>}
      </div>
      <LinhaFase rotulo="Fase atual">
        <b>{fase ? fase.titulo : 'Triagem'}</b>
        {an.ofertaEnviadaEm && fase?.oferta && <span className="muted-sm"> · enviada {quando(an.ofertaEnviadaEm)}</span>}
      </LinhaFase>
      <LinhaFase rotulo="Aguardando">{aguardando}</LinhaFase>
      {(() => {
        const loja = lojas.find(l => l.id === (t.lojaId ?? 'loja1'))
        const cp = an.conclusaoPendente
        const modoAceite = cp ? cp.modo : (loja?.exigirAprovacaoAceiteNovo !== false ? 'manual' : 'automatico')
        const ativa = cp && !['concluida', 'cancelada', 'recusada'].includes(cp.status)
        if (!ativa) {
          return (
            <LinhaFase rotulo="Negociação">
              Negociação automática pelo mapa · fase atual: <b>{fase ? fase.titulo : 'triagem'}</b>
              {an.ofertaAtual ? <> · última oferta: {descreverOferta(an.ofertaAtual)}</> : null}
              {fase?.aoRecusar ? <> · se recusar → {titulo(fase.aoRecusar)}</> : null}
              {' '}· depois do aceite: <b>{modoAceite === 'manual' ? 'aprovação humana' : 'conclusão automática'}</b>
            </LinhaFase>
          )
        }
        const dinheiro = (v: number | null) => (v == null ? '—' : `${v.toFixed(2).replace('.', ',')} ${cp!.moeda}`)
        const dados = [
          `proposta: ${titulo(cp!.faseAceita)}`,
          cp!.percentual ? `${cp!.percentual}% = ${dinheiro(cp!.valor)}` : null,
          cp!.cupom ? `cupom ${cp!.cupom}` : null,
          cp!.produtos.length ? `produtos: ${cp!.produtos.join('; ')}` : null,
          cp!.endereco ? `endereço: ${cp!.endereco}` : null,
        ].filter(Boolean).join(' · ')
        if (cp!.modo === 'manual') {
          return (
            <LinhaFase rotulo="Aceite">
              <b>Cliente aceitou — aguardando sua aprovação.</b> {dados}
              {cp!.status === 'aguardando_aprovacao' ? ' · nenhum envio agendado antes da sua aprovação' : cp!.status === 'aguardando_cadencia' ? ` · confirmação autorizada; sai a partir de ${an.proximoEnvioMinimo ? quando(an.proximoEnvioMinimo) : 'agora'}` : ''}
            </LinhaFase>
          )
        }
        return (
          <LinhaFase rotulo="Aceite">
            <b>Cliente aceitou — confirmação automática.</b> {dados}
            {cp!.status === 'aguardando_dados' ? ` · faltam: ${(cp!.faltando ?? ['endereço completo']).join('; ')}` : ''}
            {cp!.status === 'aguardando_cadencia' ? ` · confirmação agendada; horário mínimo: ${an.proximoEnvioMinimo ? quando(an.proximoEnvioMinimo) : 'agora'}` : ''}
            {cp!.status === 'falha' ? ` · falha: ${cp!.falha}` : ''}
            {' '}· relatório: {t.relatorioAuto ? 'registrado automaticamente' : 'só depois do envio real da confirmação'}
          </LinhaFase>
        )
      })()}
      <LinhaFase rotulo="Idioma da conversa">
        {an.idioma
          ? <>{nomeIdioma[an.idioma] ?? an.idioma}{an.idiomaOriginal && an.idiomaOriginal.toLowerCase() !== an.idioma ? ` (${an.idiomaOriginal})` : ''}{an.idiomaIncerto ? ' · ainda incerto (mensagem curta)' : ''}</>
          : <span className="muted-sm">ainda não detectado</span>}
        <span className="muted-sm"> · a resposta sai sempre neste idioma, mesmo com idioma fixo na loja</span>
      </LinhaFase>
      {an.aprovacaoObrigatoria && <LinhaFase rotulo="Aprovação obrigatória">{an.aprovacaoObrigatoria}</LinhaFase>}
      {an.envioBloqueado && <LinhaFase rotulo="Envio automático">{an.envioBloqueado}</LinhaFase>}
      {an.ofertaAtual && <LinhaFase rotulo="Última oferta">{descreverOferta(an.ofertaAtual)}</LinhaFase>}
      <LinhaFase rotulo="Próxima ação">{proxima}</LinhaFase>
      {faltando.length > 0 && (
        <LinhaFase rotulo="Falta o cliente informar">{faltando.map(f => NOME_FALTA[f] ?? f).join(', ')}</LinhaFase>
      )}
      {an.aguardando === 'envio' && minimo && (
        <LinhaFase rotulo="Pode sair a partir de">
          {quando(an.proximoEnvioMinimo)}
          <span className="muted-sm">
            {' · '}{t.enviaEm ? 'sai sozinho na hora' : loja?.novoEnvioAutomatico ? 'aguardando' : 'envio automático desligado — aguarda sua aprovação'}
            {minimo <= Date.now() && !t.enviaEm ? ' · já pode sair' : ''}
          </span>
        </LinhaFase>
      )}
      <LinhaFase rotulo="Já sabemos">
        {[
          an.motivo ? `motivo: ${NOME_MOTIVO[an.motivo] ?? an.motivo}` : null,
          an.produtosAfetados.length ? `produtos: ${an.produtosAfetados.join('; ')}` : null,
          an.ajusteTamanho && Object.keys(an.ajusteTamanho).length ? `ajuste: ${Object.entries(an.ajusteTamanho).map(([p, a]) => `${p} ficou ${a}`).join('; ')}` : null,
          an.fotoValidada === true ? 'foto validada por você' : an.fotoRecebida ? 'imagem recebida (ainda não validada)' : an.fotoSolicitada ? 'foto pedida, ainda não veio' : null,
          an.enderecoConfirmado ? `endereço: ${an.enderecoConfirmado}` : an.enderecoInformado ? `endereço parcial: ${an.enderecoInformado}` : null,
        ].filter(Boolean).join(' · ') || <span className="muted-sm">nada ainda</span>}
      </LinhaFase>
      {an.fluxo === 'defeito' && an.aguardandoComprovacao && an.fotoRecebida && an.fotoValidada !== true && an.aguardando === 'humano' && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--panel-soft)', borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, marginBottom: 6 }}>
            O cliente mandou uma imagem. Ela <b>comprova o defeito</b>? Só depois da sua confirmação a troca é oferecida.
          </div>
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => validarFotoNovo(t.id, true)}><Check size={13} /> Sim, comprova</button>
            <button className="btn btn-sm" onClick={() => validarFotoNovo(t.id, false)}><X size={13} /> Não — pedir outra foto</button>
          </div>
        </div>
      )}
      {an.aguardando === 'humano' && an.acaoAceita && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--panel-soft)', borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, marginBottom: 6 }}>
            {fasesNovo[an.acaoAceita]?.decisaoDono
              ? <>O caso chegou a <b>{titulo(an.acaoAceita)}</b>. Se você conceder, gere a confirmação ao cliente.</>
              : <>O cliente aceitou <b>{titulo(an.acaoAceita)}</b>. Ao aprovar, a IA escreve a confirmação{descreverConfirmacao(fasesNovo[an.acaoAceita]?.oferta?.tipo)} — ela sai na cadência (5 h da última mensagem do cliente; se já passou, na hora){an.conclusaoPendente?.faltando?.length ? <> — antes disso falta: {an.conclusaoPendente.faltando.join('; ')}</> : null}.</>}
          </div>
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => confirmarAceiteNovo(t.id)}>
              <CheckCheck size={13} /> Aprovar e gerar a confirmação
            </button>
            {!fasesNovo[an.acaoAceita]?.decisaoDono && an.conclusaoPendente?.status === 'aguardando_aprovacao' && (
              <button className="btn btn-sm" onClick={() => recusarAceiteNovo(t.id)}><X size={13} /> Recusar / corrigir a decisão</button>
            )}
          </div>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <a className="btn btn-sm" href={`#/central?caso=${encodeURIComponent(t.id)}`} title="Ver esta fase na Central operacional">
          <ExternalLink size={12} /> Abrir na Central operacional
        </a>
      </div>
      <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <div className="muted-sm" style={{ marginBottom: 4 }}>Histórico de fases</div>
        {an.historicoEtapas.length === 0 ? (
          <span className="muted-sm" style={{ fontSize: 12 }}>nenhuma etapa enviada ainda</span>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
            {an.historicoEtapas.map((h, i) => (
              <li key={i}>
                {h.evento ? h.mensagem : titulo(h.para)}
                <span className="muted-sm"> · {quando(h.em)}{!h.evento && h.mensagem ? ` · "${h.mensagem}"` : ''}</span>
                {h.observacao && <div className="muted-sm" style={{ fontSize: 11.5 }}>⚠ {h.observacao}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

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
    <aside className="painel-pedidos" style={{ width: '100%' }}>
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
              {/* quem comprou: nome e e-mail direto no pedido */}
              <div style={{ marginTop: -4, marginBottom: 8, fontSize: 12.5, lineHeight: 1.45 }}>
                {p.cliente && <div><b>{p.cliente}</b></div>}
                {p.email && (
                  <div className="muted-sm" style={{ overflowWrap: 'anywhere' }}>
                    {p.email}
                    {p.email.trim().toLowerCase() !== emailCliente && ' (diferente do remetente)'}
                  </div>
                )}
              </div>
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
                {p.rastreio && p.rastreio !== '—' && (
                  <a className="btn btn-sm" href={`https://t.17track.net/pt#nums=${encodeURIComponent(p.rastreio)}`}
                    target="_blank" rel="noreferrer" title="Ver o rastreio no 17TRACK"
                    style={{ justifySelf: 'start', marginTop: 3 }}>
                    <ExternalLink size={12} /> Ver no 17TRACK
                  </a>
                )}
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
  const { opcoesRelatorio = [], alternarRelatorio, salvarOpcoesRelatorio, fasesNovo } = useStore()
  const [novo, setNovo] = useState('')
  const escolher = (texto?: string) => { alternarRelatorio(t.id, true, texto); onClose() }
  const sugestao = sugestaoRelatorio(t, fasesNovo)
  return (
    <Modal title="Adicionar ao relatório de hoje" onClose={onClose}>
      <p className="muted-sm" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        Escolha como este caso aparece no relatório manual — a linha sai como <b>PEDIDO Nº - texto escolhido</b>.
      </p>
      {sugestao && (
        <button className={'btn mb-8' + (t.relatorioDia && t.relatorioTexto === sugestao ? ' btn-primary' : '')}
          style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
          title="Sugestão do atendimento novo, a partir da opção aceita — só entra se você clicar"
          onClick={() => escolher(sugestao)}>
          <Sparkles size={13} /> Sugestão: {sugestao}
        </button>
      )}
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

/** Navegação entre casos sem voltar à lista: posição, anterior e próximo */
export interface NavCasos { pos: number; total: number; anterior?: () => void; proximo?: () => void }

export function TicketDetail({ t, onBack, nav }: { t: Ticket; onBack: () => void; nav?: NavCasos }) {
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

  // trocou de caso: volta ao topo da conversa
  useEffect(() => { document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0 }) }, [t.id])

  // setas do teclado navegam entre os casos (fora de campos de texto)
  useEffect(() => {
    if (!nav) return
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable)) return
      if (e.key === 'ArrowRight' && nav.proximo) nav.proximo()
      if (e.key === 'ArrowLeft' && nav.anterior) nav.anterior()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [nav])

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
      || (t.assunto && !t.assuntoTraducao)
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
  // regenera o rascunho da IA com uma instrução (digitada ou de 1 clique)
  const regerarRascunhoCom = async (texto: string) => {
    setGerando(true); setErroGerar(null); setVerTradRascunho(false)
    const erro = await regenerarRascunho(t.id, texto.trim())
    setGerando(false)
    if (erro) setErroGerar(erro)
    else setInstrucao('')
  }

  const gerarNaCaixa = async (texto?: string) => {
    const pedido = (texto ?? instrucao).trim()
    setGerando(true); setErroGerar(null)
    const r = await gerarTexto(t.id, pedido)
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
        <button className="btn btn-sm" disabled={gerando} onClick={() => gerarNaCaixa()}>
          <Sparkles size={13} /> {gerando ? 'Gerando…' : 'Gerar com IA'}
        </button>
        <button className="btn btn-sm" disabled={traduzindoRasc || (!manual.trim() && !traducaoManual)} onClick={traduzirCaixa}>
          <Languages size={13} /> {traduzindoRasc ? 'Traduzindo…' : traducaoManual ? 'Ocultar tradução' : 'Ver em português'}
        </button>
      </div>
      <OpcoesInstrucao atual={instrucao} onUsar={texto => { setInstrucao(texto); gerarNaCaixa(texto) }} />
      {erroGerar && <p className="muted-sm" style={{ color: 'var(--red)', marginTop: 6 }}>{erroGerar}</p>}
    </>
  )

  return (
    <div className="detail-wrap" style={{ display: 'flex', gap: 20, alignItems: 'flex-start', maxWidth: 1180, margin: '0 auto' }}>
    <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
      <div className="row spread mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</button>
        {nav && nav.total > 1 && (
          <div className="row gap-8">
            <span className="muted-sm">{nav.pos} de {nav.total}</span>
            <button className="btn btn-sm" disabled={!nav.anterior} style={!nav.anterior ? { opacity: 0.45 } : undefined}
              title="Caso anterior (seta ←)" onClick={() => nav.anterior?.()}>
              <ChevronLeft size={14} /> Anterior
            </button>
            <button className="btn btn-sm" disabled={!nav.proximo} style={!nav.proximo ? { opacity: 0.45 } : undefined}
              title="Próximo caso (seta →)" onClick={() => nav.proximo?.()}>
              Próximo <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="row gap-10 mb-12" style={{ flexWrap: 'wrap' }}>
        <h1 className="h2">{verTraducao && t.assuntoTraducao ? t.assuntoTraducao : t.assunto}</h1>
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
              onClick={() => regerarRascunhoCom(instrucao)}>
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
          <OpcoesInstrucao atual={instrucao} onUsar={texto => { setInstrucao(texto); regerarRascunhoCom(texto) }} />
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

    <div className="coluna-lateral" style={{ width: 280, flexShrink: 0 }}>
      <PainelMotor t={t} />
      <PainelFaseNovo t={t} />
      <PainelPedidos t={t} />
    </div>

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
  const { tickets: todosTickets } = useStore()
  // a conversa aberta pode sair da lista filtrada (ex.: filtro "Não lidos" e
  // ela acabou de ser lida) — busca também na lista completa pra não fechar
  const atual = tickets.find(t => t.id === aberto) ?? todosTickets.find(t => t.id === aberto)

  if (atual) {
    const idx = tickets.findIndex(t => t.id === aberto)
    return (
      <TicketDetail t={atual} onBack={() => setAberto(null)}
        nav={idx >= 0 ? {
          pos: idx + 1,
          total: tickets.length,
          anterior: idx > 0 ? () => setAberto(tickets[idx - 1].id) : undefined,
          proximo: idx < tickets.length - 1 ? () => setAberto(tickets[idx + 1].id) : undefined,
        } : undefined} />
    )
  }

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
