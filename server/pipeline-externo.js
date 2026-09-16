/**
 * Pipeline completo — página externa, somente leitura.
 *
 * Mesmo cálculo da Central interna (shared/central.js) sobre os dados reais do
 * workspace; nada simulado, nada fixo. O desenho segue o mapa visual completo
 * (shared/mapa.js): regras, coletas, decisões, ofertas, confirmações e decisões
 * humanas na ordem do mapa mental. Só os itens ligados a uma fase real do motor
 * carregam números de "fase enviada"; regra e decisão nunca são contabilizadas.
 *
 * Segurança: o JSON sai SANITIZADO no servidor — nenhum texto livre vindo da
 * conversa, da IA ou de dados antigos. Motivo vira uma categoria fechada com
 * rótulo gerado aqui; produto vem só do catálogo do pedido (itens da Shopify);
 * pedido é só o número. Nada de nome, e-mail, endereço, telefone ou mensagem.
 * A busca externa procura só em pedido, produto, motivo (rótulo) e loja.
 * Nenhuma rota de escrita existe aqui.
 */
import { calcularCentral, metricasPorFase, indicadores, relacaoComFase, ORDEM_JORNADAS } from '../shared/central.js'
import { MAPA_VISUAL, itensDaJornada, metricasPorItem, SEGMENTOS, segmentoDoRegistro } from '../shared/mapa.js'

const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Filtros aceitos pela página (validados; o resto cai no padrão). */
export function filtrosDaConsulta(q = {}) {
  return {
    busca: String(q.busca ?? '').slice(0, 80),
    lojaId: String(q.loja ?? 'todas'),
    periodo: ['7', '30', '90'].includes(String(q.periodo)) ? String(q.periodo) : 'todas',
    desfecho: String(q.desfecho ?? 'todos'),
    jornada: String(q.jornada ?? 'todas'),
    fase: String(q.fase ?? 'todas'),
  }
}

/** Categoria fechada → rótulo gerado no servidor (nunca texto da conversa ou da IA). */
export const ROTULO_MOTIVO = {
  tamanho_pequeno: 'tamanho pequeno', tamanho_grande: 'tamanho grande', tamanho: 'tamanho não serviu',
  qualidade: 'qualidade', nao_gostou: 'não gostou', defeito: 'defeito', errado: 'produto errado',
  atraso: 'atraso', nao_recebido: 'não recebido', nao_recebeu: 'não recebido',
  cancelamento: 'cancelamento', arrependimento: 'cancelamento', alergia: 'outro', outro: 'outro', nao_informado: 'não informado',
}
export const motivoPublico = categoria => ROTULO_MOTIVO[categoria] ?? (categoria ? 'outro' : 'não informado')

/** Produto só do catálogo do pedido (títulos e variantes da Shopify), nunca de texto livre. */
const produtoDoPedido = p => p?.itens?.[0]
  ? `${p.itens[0].titulo}${p.itens[0].variante ? ` (${p.itens[0].variante})` : ''}${p.itens.length > 1 ? ` +${p.itens.length - 1}` : ''}`
  : null
const numeroPublico = n => { const d = String(n ?? '').replace(/\D/g, ''); return d || null }

/**
 * Dados da página: o mesmo calcularCentral da Central interna. Depois de
 * calcular, os registros e linhas são reduzidos a campos públicos e a busca é
 * aplicada SÓ sobre esses campos; métricas e indicadores são recalculados
 * pelas mesmas funções quando há busca.
 */
export function dadosPipeline({ estado, fases, jornadas, filtros }) {
  const lojas = estado.lojas.map(l => ({ id: l.id, nome: l.nome, moeda: l.moeda || 'EUR' }))
  const produtoPorPedido = new Map((estado.pedidos ?? []).map(p => [p.id, produtoDoPedido(p)]))
  const publico = r => ({
    chave: r.chave, pedidoNumero: numeroPublico(r.pedidoNumero), lojaId: r.lojaId, lojaNome: r.lojaNome, moeda: r.moeda,
    pedidoValor: r.pedidoValor, produto: r.pedidoId ? produtoPorPedido.get(r.pedidoId) ?? null : null,
    motivo: motivoPublico(r.motivoCategoria), jornada: r.jornada, segmento: segmentoDoRegistro(r),
    faseAtual: r.faseAtual, faseTitulo: r.faseTitulo, origem: r.origem, inferidaPor: r.inferidaPor,
    desfecho: r.desfecho, percentual: r.percentual, reembolsado: r.reembolsado, situacaoReembolso: r.situacaoReembolso,
    concluido: r.concluido, comVoce: r.comVoce, dataMs: r.dataMs, conversas: r.tickets?.length ?? 1,
  })
  const base = calcularCentral({ tickets: estado.tickets, pedidos: estado.pedidos ?? [], lojas: estado.lojas, fases, filtros: { ...filtros, busca: '' } })
  const q = norm(filtros.busca.trim())
  const casa = campos => !q || norm(campos.filter(Boolean).join(' ')).includes(q)
  const registrosPub = base.registros.map(publico)
  const registros = base.registros.filter((r, i) => { const p = registrosPub[i]; return casa([p.pedidoNumero, p.produto, p.motivo, p.lojaNome]) })
  const linhasPub = base.linhas.map(l => ({
    chave: l.chave, pedidoId: l.pedidoId, pedidoNumero: numeroPublico(l.pedidoNumero), lojaId: l.lojaId, lojaNome: l.lojaNome, moeda: l.moeda,
    valor: l.valor, dataMs: l.dataMs, produto: l.pedidoId ? produtoPorPedido.get(l.pedidoId) ?? null : null,
    atendimento: l.atendimento, faseTitulo: l.faseTitulo, registro: l.registro ? publico(l.registro) : null,
  }))
  const linhas = base.linhas.filter((l, i) => { const p = linhasPub[i]; return casa([p.pedidoNumero, p.produto, p.registro?.motivo, p.lojaNome]) })
  const metricas = q ? metricasPorFase(registros, fases) : base.metricas
  const kpis = q ? indicadores(linhas) : base.indicadores
  const total = registros.length
  // métricas por ITEM visual (fase real × segmento do caso) — nunca o total global da fase
  const porItem = metricasPorItem(registros, fases, metricasPorFase, relacaoComFase)
  const porFase = {}
  for (const id of Object.keys(fases)) {
    const grupo = { passaram: [], pararam: [], avancaram: [], emAberto: [] }
    for (const r of registros) {
      const rel = relacaoComFase(r, id)
      if (rel) {
        grupo.passaram.push(r.chave)
        if (rel === 'pararam') grupo.pararam.push(r.chave)
        else if (rel === 'avancaram') grupo.avancaram.push(r.chave)
        else grupo.emAberto.push(r.chave)
      } else if (r.confirmacaoEnviada === id) {
        grupo.passaram.push(r.chave); grupo.pararam.push(r.chave)
      }
    }
    porFase[id] = grupo
  }
  return {
    geradoEm: new Date().toISOString(),
    filtros,
    catalogo: {
      ordem: ORDEM_JORNADAS, jornadas, descricoes: DESCRICAO_JORNADA,
      fases: Object.fromEntries(Object.entries(fases).map(([id, f]) => [id, { titulo: f.titulo, jornada: f.jornada, instrucao: f.instrucao ?? null, confirmacao: !!f.confirmacao }])),
      mapa: MAPA_VISUAL,
    },
    lojas,
    indicadores: kpis,
    metricas: Object.fromEntries(Object.entries(metricas).map(([id, m]) => [id, { ...m, pctPassaram: total ? Math.round((m.passaram / total) * 1000) / 10 : 0 }])),
    porFase,
    porItem,
    segmentos: SEGMENTOS,
    totalCasos: total,
    registros: registros.map(publico),
    linhas: linhasPub.filter((_, i) => casa([linhasPub[i].pedidoNumero, linhasPub[i].produto, linhasPub[i].registro?.motivo, linhasPub[i].lojaNome])),
  }
}

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const NOME_TIPO = { regra: 'regra', coleta: 'coleta', decisao: 'decisão', oferta: 'oferta', confirmacao: 'confirmação', humano: 'decisão do dono' }

/** Descrição curta de cada jornada (cabeçalho do painel do fluxo). */
export const DESCRICAO_JORNADA = {
  entrada: 'Triagem e regras gerais do pipeline, comuns a todas as jornadas.',
  tamanho: 'Tamanho ou caimento errado: troca gratuita e, se recusada, a escada completa até a decisão do dono.',
  qualidade: 'Qualidade, preferência ou motivo não informado: alternativa, cupom e a escada de 25% a 70%.',
  defeito_errado: 'Produto danificado (com foto) ou item recebido errado, cada um com o seu caminho completo.',
  nao_recebido: 'Todos os cenários de entrega: status, não chegou ou voltou, marcado como entregue, recusa, prazo e processamento.',
  cancelamento: 'Cancelamento de pedido ainda não processado, sempre com decisão do dono.',
}
/** Cor de cada jornada — paleta padrão do Atendo (etiquetas do painel). */
const TOM_JORNADA = { entrada: 'var(--purple)', tamanho: '#447acb', qualidade: '#9065b0', defeito_errado: 'var(--red)', nao_recebido: 'var(--amber)', cancelamento: 'var(--green)' }

/**
 * HTML da página externa. Estrutura, composição e comportamento seguem a
 * referência operacional (barra lateral fixa com as jornadas, uma jornada por
 * vez, filtros fixos, funil, faixa de indicadores, distribuição por tipo de
 * caso, fluxo conectado, painel "Leitura da jornada", drawer e tabela); as
 * cores, a tipografia e os componentes são os do Atendo. Sem token no corpo:
 * a página busca "dados" pelo caminho relativo ao próprio endereço.
 */
export function paginaPipeline({ catalogo, lojas }) {
  const ordem = catalogo.ordem
  const tituloFase = id => catalogo.fases[id]?.titulo ?? id
  // o mapa visual inteiro vai no HTML (servidor): a página nunca depende só do JS para mostrar as etapas
  const fluxos = ordem.map(j => {
    const itens = itensDaJornada(j)
    const grupos = [...new Set(itens.map(i => i.grupo))]
    return `<div class="flow-canvas" data-jornada="${j}"${j === ordem[0] ? '' : ' hidden'}>${grupos.map(g => `<section class="flow-group"><h3 class="group-title">${escapar(g)}</h3><div class="stage-list">${itens.filter(i => i.grupo === g).map(i => {
      const dica = i.fase
        ? `Fase do motor: ${tituloFase(i.fase)} · casos: ${SEGMENTOS[i.segmento] ?? i.segmento}${i.tipo === 'humano' ? ' · decisão do dono' : ''}`
        : `${NOME_TIPO[i.tipo]} do mapa — não é fase enviada; os números vêm do caminho e não entram nas métricas oficiais`
      return `<button type="button" class="stage tipo-${i.tipo}${i.fase ? '' : ' derivada'}" data-item="${i.id}"${i.fase ? ` data-fase="${i.fase}"` : ''} title="${escapar(dica)}"><span class="stage-index">${String(i.ordem).padStart(2, '0')}</span><span class="stage-copy"><strong>${escapar(i.titulo)}</strong><span>${escapar(i.descricao)}</span></span><span class="stage-metrics"><span class="metric"><strong data-num><b data-n="passaram">0</b> <em data-n="passaram-pct">0%</em></strong><span>passaram</span></span><span class="metric"><strong data-num><b data-n="pararam">0</b> <em data-n="pararam-pct">0%</em></strong><span>pararam</span></span><span class="metric"><strong data-num><b data-n="avancaram">0</b> <em data-n="avancaram-pct">0%</em></strong><span>avançaram</span></span><span class="metric"><strong class="stage-value" data-num data-n="valor">—</strong><span>valor</span></span></span></button>`
    }).join('')}</div></section>`).join('')}</div>`
  }).join('')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#f7f7f5">
<title>Pipeline completo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  /* tokens do Atendo (src/index.css) — a página externa usa a identidade padrão do painel */
  :root{--bg:#f7f7f5;--panel:#ffffff;--panel-soft:#fafaf9;--hover:#f1f1ef;--border:#e9e9e7;--border-soft:#f1f1ef;--text:#37352f;--text-2:#73726e;--text-3:#9f9e9b;--purple:#2383e2;--purple-soft:#e7f3f8;--purple-border:#cfe4f5;--grad:linear-gradient(92deg,#2383e2 0%,#2f8ee8 100%);--green:#448361;--amber:#cb912f;--red:#d44c47;--ok-bg:#edf3ec;--warn-bg:#fbf3db;--warn-border:#eeddb1;--danger-bg:#fdebec;--danger-border:#f2c5c2;--shadow:0 1px 2px rgba(15,15,15,.03),0 3px 12px rgba(15,15,15,.05);--ring:rgba(35,131,226,.14);--radius:18px;--sidebar:272px}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;min-width:320px;background:var(--bg);color:var(--text);font:16px/1.45 Inter,-apple-system,"Segoe UI",sans-serif}
  button,input,select{font:inherit}
  button,select{color:inherit}
  button{cursor:pointer}
  button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
  .hidden{display:none!important}

  .app{min-height:100vh;display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr)}
  .sidebar{position:sticky;top:0;height:100vh;padding:22px 16px;border-right:1px solid var(--border);background:var(--panel);overflow-y:auto;z-index:5}
  .brand{display:flex;align-items:center;gap:12px;padding:0 7px 22px}
  .mark{width:40px;height:40px;display:grid;place-items:center;border-radius:13px;background:var(--grad);color:#fff;box-shadow:0 1px 3px color-mix(in srgb,var(--purple) 35%,transparent)}
  .mark svg{width:23px}
  .brand strong{display:block;font-size:1rem;letter-spacing:-.02em}
  .brand span{display:block;color:var(--text-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
  .nav-label{margin:8px 8px 10px;color:var(--text-3);font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;font-weight:800}
  .nav-list{display:grid;gap:7px}
  .nav-item{width:100%;display:grid;grid-template-columns:35px 1fr auto;gap:10px;align-items:center;padding:11px;border:1px solid transparent;border-radius:13px;background:transparent;text-align:left;transition:.18s ease}
  .nav-item:hover{background:var(--hover);border-color:var(--border)}
  .nav-item.active{background:var(--purple-soft);border-color:var(--purple-border)}
  .nav-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:var(--panel-soft);border:1px solid var(--border);color:var(--tone,var(--purple));font-weight:800;font-size:.78rem}
  .nav-copy strong{display:block;font-size:.84rem}
  .nav-copy span{display:block;color:var(--text-2);font-size:.7rem;margin-top:2px}
  .nav-count{font-size:.78rem;font-weight:800;color:var(--text-2);font-variant-numeric:tabular-nums;text-align:right}
  .sidebar-note{margin-top:18px;padding:13px;border:1px solid var(--warn-border);border-radius:13px;background:var(--warn-bg);color:var(--text);font-size:.76rem}
  .sidebar-note strong{display:block;margin-bottom:4px}
  .sidebar-note p{margin:0;color:var(--text-2)}

  .main{min-width:0;padding:24px 28px 50px}
  .topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}
  .title-wrap .eyebrow{margin:0 0 4px;color:var(--purple);font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;font-weight:800}
  .title-wrap h1{margin:0;font-size:clamp(1.55rem,2.4vw,2.25rem);line-height:1.08;letter-spacing:-.045em}
  .title-wrap p{margin:7px 0 0;color:var(--text-2);font-size:.86rem}
  .top-actions{display:flex;gap:9px;align-items:center;flex:0 0 auto}
  .button{border:1px solid var(--border);background:var(--panel);border-radius:11px;padding:9px 13px;color:var(--text);font-size:.84rem;font-weight:600;white-space:nowrap}
  .button:hover{background:var(--hover)}
  .view-switch{display:flex;padding:3px;border:1px solid var(--border);border-radius:12px;background:var(--panel-soft)}
  .view-button{border:0;background:transparent;border-radius:9px;padding:7px 11px;color:var(--text-2);font-size:.8rem;white-space:nowrap}
  .view-button.active{background:var(--panel);color:var(--text);box-shadow:var(--shadow)}

  .toolbar{position:sticky;top:10px;z-index:4;display:grid;grid-template-columns:minmax(220px,1fr) 160px 170px 145px auto;gap:9px;margin-bottom:16px;padding:10px;border:1px solid var(--border);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)}
  .control{width:100%;height:42px;border:1px solid var(--border);border-radius:11px;background:var(--panel-soft);padding:0 12px;color:var(--text)}
  .search-wrap{position:relative}
  .search-wrap svg{position:absolute;left:12px;top:12px;width:18px;color:var(--text-2)}
  .search-wrap input{padding-left:39px}
  .filter-result{display:flex;align-items:center;justify-content:flex-end;color:var(--text-2);font-size:.77rem;white-space:nowrap}

  .notice{display:flex;gap:11px;align-items:flex-start;margin-bottom:16px;padding:13px 15px;border:1px solid var(--warn-border);border-radius:14px;background:var(--warn-bg)}
  .notice i{width:8px;height:8px;flex:0 0 auto;margin-top:6px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 5px rgba(203,145,47,.14)}
  .notice strong{display:block;color:var(--text);font-size:.84rem}
  .notice p{margin:2px 0 0;color:var(--text-2);font-size:.77rem}
  .kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}
  .kpi{min-width:0;padding:15px;border:1px solid var(--border);border-radius:15px;background:var(--panel);box-shadow:var(--shadow);position:relative;overflow:hidden}
  .kpi::after{content:"";position:absolute;width:95px;height:70px;right:-25px;bottom:-35px;border-radius:50%;background:var(--glow,rgba(35,131,226,.08));filter:blur(14px)}
  .kpi>span{display:block;color:var(--text-2);font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:800}
  .kpi strong{display:block;min-width:0;font-size:1.45rem;line-height:1;letter-spacing:-.045em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kpi>small{display:block;margin-top:7px;color:var(--text-3);font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kpi-main{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:9px}
  .kpi-main em{flex:0 0 auto;padding:5px 7px;border-radius:999px;background:var(--purple-soft);border:1px solid var(--purple-border);color:var(--purple);font-size:.7rem;font-style:normal;font-weight:800;font-variant-numeric:tabular-nums}
  .kpi-main .pending{font-size:.95rem;line-height:1.15;letter-spacing:-.02em}
  .kpi strong.multi{font-size:.95rem;line-height:1.15;white-space:normal}
  .kpi strong.multi .linha{display:block}
  .pipe-stat strong.multi{font-size:.78rem}
  .pipeline-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin-bottom:16px;border:1px solid var(--border);border-radius:14px;background:var(--border);overflow:hidden}
  .pipe-stat{padding:12px 14px;background:var(--panel)}
  .pipe-stat span{display:block;color:var(--text-2);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}
  .pipe-stat strong{display:block;margin-top:4px;font-size:.98rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pipe-stat small{display:block;margin-top:3px;color:var(--text-3);font-size:.65rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .case-mix{margin-bottom:16px;padding:15px 17px;border:1px solid var(--border);border-radius:15px;background:var(--panel);box-shadow:var(--shadow)}
  .case-mix-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}
  .case-mix h2{margin:0;font-size:.9rem}
  .case-mix p{margin:2px 0 0;color:var(--text-2);font-size:.72rem}
  .case-bars{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
  .case-bar{min-width:0}
  .case-bar-top{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:.69rem}
  .case-bar-top span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
  .case-bar-top strong{color:var(--purple);font-variant-numeric:tabular-nums}
  .case-track{height:6px;border-radius:999px;background:var(--hover);overflow:hidden}
  .case-track i{display:block;height:100%;width:var(--share);border-radius:inherit;background:linear-gradient(90deg,var(--tone),var(--purple))}

  .flow-shell{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px}
  .panel{border:1px solid var(--border);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow)}
  .panel-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 19px;border-bottom:1px solid var(--border)}
  .panel-head h2{margin:0 0 4px;font-size:1.05rem;letter-spacing:-.02em}
  .panel-head p{margin:0;color:var(--text-2);font-size:.78rem}
  .panel-total{text-align:right}
  .panel-total strong{display:block;font-size:1.15rem}
  .panel-total span{color:var(--text-2);font-size:.72rem}

  .flow-canvas{padding:20px 18px 22px;min-height:500px}
  .flow-group{position:relative;margin-bottom:22px}
  .flow-group:last-child{margin-bottom:0}
  .group-title{display:flex;align-items:center;gap:9px;margin:0 0 10px 8px;color:var(--text-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
  .group-title::after{content:"";height:1px;flex:1;background:var(--border)}
  .stage-list{display:grid;gap:10px;position:relative}
  .stage-list::before{content:"";position:absolute;left:21px;top:22px;bottom:22px;width:2px;background:linear-gradient(var(--purple),var(--border))}
  .stage{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:13px;align-items:center;width:100%;padding:13px 14px 13px 7px;border:1px solid var(--border);border-radius:14px;background:var(--panel-soft);text-align:left;transition:.16s ease;color:inherit}
  .stage:hover{transform:translateX(3px);border-color:var(--purple-border);background:var(--panel)}
  .stage.selected{border-color:var(--purple);box-shadow:0 0 0 3px var(--ring)}
  .stage-index{z-index:1;width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:var(--purple-soft);color:var(--purple);font-weight:800;font-size:.78rem;border:1px solid var(--purple-border)}
  .tipo-humano .stage-index{background:var(--warn-bg);color:var(--amber);border-color:var(--warn-border)}
  .tipo-confirmacao .stage-index{background:var(--ok-bg);color:var(--green);border-color:#cfe3d4}
  .tipo-regra .stage-index,.tipo-decisao .stage-index{background:var(--panel);color:var(--text-2);border-color:var(--border)}
  .stage-copy strong{display:block;font-size:.88rem}
  .stage-copy span{display:block;margin-top:3px;color:var(--text-2);font-size:.73rem;line-height:1.4}
  .stage-metrics{display:grid;grid-template-columns:repeat(4,68px);gap:7px}
  .metric{text-align:center;padding:7px 5px;border-radius:10px;background:var(--panel);border:1px solid var(--border)}
  .metric strong{display:block;font-size:.84rem;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .metric strong b{font-weight:inherit}
  .metric strong em{color:var(--green);font-size:.62rem;font-style:normal;margin-left:2px}
  .metric:nth-child(2) strong em{color:var(--red)}
  .metric:nth-child(3) strong em{color:var(--purple)}
  .metric span{display:block;color:var(--text-2);font-size:.57rem;text-transform:uppercase;letter-spacing:.05em;margin-top:1px}
  .stage-value{color:var(--amber)!important}
  .stage.derivada .metric strong{color:var(--text-2)}

  .insight-panel{align-self:start;position:sticky;top:24px;overflow:hidden}
  .insight-body{padding:17px}
  .health{display:grid;place-items:center;padding:10px 0 18px}
  .ring{width:134px;aspect-ratio:1;display:grid;place-items:center;border-radius:50%;background:conic-gradient(var(--purple) 0 var(--progress),var(--hover) var(--progress) 100%);position:relative}
  .ring::before{content:"";width:92px;aspect-ratio:1;border-radius:50%;background:var(--panel);border:1px solid var(--border)}
  .ring-label{position:absolute;text-align:center}
  .ring-label strong{display:block;font-size:1.5rem;line-height:1}
  .ring-label span{display:block;color:var(--text-2);font-size:.67rem;margin-top:3px}
  .insight-list{display:grid;gap:9px}
  .insight-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:11px;border-radius:11px;background:var(--panel-soft);border:1px solid var(--border-soft)}
  .insight-row span{color:var(--text-2);font-size:.74rem}
  .insight-row strong{font-size:.8rem;font-variant-numeric:tabular-nums;text-align:right}
  .legend{display:grid;gap:8px;margin-top:16px;padding-top:15px;border-top:1px solid var(--border)}
  .legend div{display:flex;align-items:center;gap:8px;color:var(--text-2);font-size:.71rem}
  .legend i{width:8px;height:8px;border-radius:50%;background:var(--dot);flex:0 0 auto}

  .orders-view{display:none}
  .orders-view.active{display:block}
  .flow-view.hidden{display:none}
  .orders-panel{overflow:hidden}
  .orders-table-wrap{overflow:auto;max-height:calc(100vh - 290px)}
  table{width:100%;border-collapse:collapse;min-width:1120px}
  th,td{padding:12px 14px;border-bottom:1px solid var(--border);text-align:left}
  th{position:sticky;top:0;z-index:1;background:var(--panel-soft);color:var(--text-2);font-size:.69rem;text-transform:uppercase;letter-spacing:.07em}
  td{font-size:.8rem}
  .order-id{font-weight:800;color:var(--purple)}
  .money{font-weight:800;color:var(--amber);white-space:nowrap}
  .reason{max-width:340px;color:var(--text)}
  .product-chip{display:inline-flex;padding:4px 7px;border-radius:8px;background:#f6f3f9;border:1px solid #e6dff0;color:#9065b0;font-size:.68rem}
  .date-missing{color:var(--text-3);font-size:.7rem}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:999px;background:var(--purple-soft);border:1px solid var(--purple-border);color:var(--purple);font-size:.68rem;white-space:nowrap}
  .badge.manual{color:var(--green);background:var(--ok-bg);border-color:#cfe3d4}
  .badge.warn{color:var(--amber);background:var(--warn-bg);border-color:var(--warn-border)}
  .badge.local{color:#9065b0;background:#f6f3f9;border-color:#e6dff0}
  .row-button{border:0;background:transparent;color:var(--purple);font-size:.73rem;font-weight:700;padding:5px}
  .sub{font-size:.69rem;color:var(--text-2)}

  .backdrop{position:fixed;inset:0;background:rgba(15,15,15,.45);backdrop-filter:blur(3px);z-index:20;opacity:0;pointer-events:none;transition:.2s}
  .backdrop.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;z-index:21;top:0;right:0;width:min(720px,92vw);height:100vh;display:flex;flex-direction:column;background:var(--panel);border-left:1px solid var(--border);box-shadow:-28px 0 80px rgba(15,15,15,.18);transform:translateX(103%);transition:.24s ease}
  .drawer.open{transform:translateX(0)}
  .drawer-head{padding:20px;border-bottom:1px solid var(--border)}
  .drawer-topline{display:flex;justify-content:space-between;gap:15px}
  .drawer-kicker{color:var(--purple);font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
  .drawer h2{margin:5px 0;font-size:1.28rem;letter-spacing:-.03em}
  .drawer-head p{margin:0;color:var(--text-2);font-size:.78rem}
  .close{width:38px;height:38px;flex:0 0 auto;border:1px solid var(--border);border-radius:11px;background:var(--panel-soft);font-size:1.2rem}
  .drawer-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:15px}
  .drawer-stat{padding:10px;border:1px solid var(--border);border-radius:11px;background:var(--panel-soft)}
  .drawer-stat span{display:block;color:var(--text-2);font-size:.64rem;text-transform:uppercase;letter-spacing:.07em}
  .drawer-stat strong{display:block;margin-top:3px;font-size:1rem}
  .drawer-tools{display:grid;grid-template-columns:1fr auto;gap:9px;padding:13px 20px;border-bottom:1px solid var(--border)}
  .drawer-tools input{height:40px;border:1px solid var(--border);border-radius:10px;background:var(--panel-soft);padding:0 11px;color:var(--text)}
  .drawer-list{flex:1;overflow:auto;padding:12px 14px 25px}
  .order-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:13px;margin-bottom:9px;border:1px solid var(--border);border-radius:13px;background:var(--panel-soft)}
  .order-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .order-top strong{color:var(--purple)}
  .order-card .store{color:var(--text-2);font-size:.71rem}
  .order-card p{margin:7px 0 0;color:var(--text);font-size:.76rem}
  .order-side{text-align:right}
  .order-side .money{display:block;font-size:.94rem}
  .order-side .pct{display:block;color:var(--text-2);font-size:.68rem;margin-top:2px}
  .phase-select{grid-column:1/-1;display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center;padding-top:10px;border-top:1px solid var(--border)}
  .phase-select label{color:var(--text-2);font-size:.7rem}
  .phase-select select{height:36px;border:1px solid var(--border);border-radius:9px;background:var(--panel);padding:0 9px;font-size:.72rem}
  .empty{padding:35px 15px;text-align:center;color:var(--text-2);font-size:.82rem}

  @media(max-width:1120px){.flow-shell{grid-template-columns:1fr}.insight-panel{position:static}.insight-body{display:grid;grid-template-columns:160px 1fr;gap:18px}.legend{margin:0;padding:0 0 0 15px;border-top:0;border-left:1px solid var(--border)}.kpis,.pipeline-strip{grid-template-columns:repeat(3,1fr)}.toolbar{grid-template-columns:minmax(200px,1fr) repeat(3,150px)}.filter-result{display:none}.case-bars{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:860px){.app{grid-template-columns:1fr}.sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--border);padding:14px}.brand{padding-bottom:12px}.nav-label,.sidebar-note{display:none}.nav-list{display:flex;overflow-x:auto;gap:7px}.nav-item{flex:0 0 205px}.main{padding:20px 16px 42px}.kpis,.pipeline-strip{grid-template-columns:1fr 1fr}.toolbar{position:static;grid-template-columns:1fr 1fr}.search-wrap{grid-column:1/-1}.case-bars{grid-template-columns:1fr 1fr}.stage{grid-template-columns:40px minmax(0,1fr)}.stage-metrics{grid-column:2;grid-template-columns:repeat(4,minmax(52px,1fr))}.insight-body{grid-template-columns:1fr}.legend{border-left:0;border-top:1px solid var(--border);padding:15px 0 0}.topbar{flex-direction:column}.top-actions{width:100%;justify-content:space-between}.orders-table-wrap{max-height:none}}
  @media(max-width:560px){.main{padding:16px 12px 36px}.kpis{gap:8px}.kpi{padding:13px}.kpi strong{font-size:1.25rem}.kpi-main .pending{font-size:.82rem}.toolbar{grid-template-columns:1fr}.search-wrap{grid-column:auto}.case-bars{grid-template-columns:1fr}.flow-canvas{padding:15px 10px}.stage{padding-right:9px}.stage-metrics{gap:5px}.metric{padding:6px 3px}.panel-head{padding:15px}.drawer{width:100vw}.drawer-stats{grid-template-columns:repeat(2,1fr)}.drawer-tools{grid-template-columns:1fr}.phase-select{grid-template-columns:1fr}.view-button{padding:7px 8px}.top-actions{align-items:stretch}.button{padding:8px 10px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 5h16M7 12h13M11 19h9"/></svg></div><div><span>Operação</span><strong>Reembolsos</strong></div></div>
    <p class="nav-label">Jornadas do Miro</p>
    <nav class="nav-list" id="journeyNav" aria-label="Jornadas do atendimento">${ordem.map((j, k) => `<button type="button" class="nav-item${k === 0 ? ' active' : ''}" data-flow="${j}" style="--tone:${TOM_JORNADA[j] ?? 'var(--purple)'}"><span class="nav-icon">${String(k + 1).padStart(2, '0')}</span><span class="nav-copy"><strong>${escapar(catalogo.jornadas[j] ?? j)}</strong><span data-num data-nav="valor">—</span></span><span class="nav-count" data-num><span data-nav="n">0</span><br><span data-nav="pct">0%</span></span></button>`).join('')}</nav>
    <div class="sidebar-note"><strong>Como ler os números</strong><p>“Passaram” inclui quem chegou à fase. “Pararam” mostra quem aceitou ali. “Avançaram” seguiram para a próxima etapa.</p></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="title-wrap"><p class="eyebrow">Central operacional</p><h1>Pipeline completo</h1><p>Todas as fases do fluxo enviado, com pedidos e valores.</p></div><div class="top-actions"><div class="view-switch" role="tablist" aria-label="Visualização"><button type="button" class="view-button active" data-view="flow" role="tab" aria-selected="true">Mapa do fluxo</button><button type="button" class="view-button" data-view="orders" role="tab" aria-selected="false">Todos os pedidos</button></div><button type="button" class="button" id="resetAssignments">Limpar ajustes</button></div></header>
    <section class="toolbar" id="filtros" aria-label="Filtros do dashboard"><div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="control" id="f-busca" type="search" placeholder="Buscar pedido, produto, motivo ou loja…" aria-label="Buscar pedido, produto, motivo ou loja"></div><select class="control" id="f-loja" aria-label="Filtrar por loja"><option value="todas">Todas as lojas</option>${lojas.map(l => `<option value="${escapar(l.id)}">${escapar(l.nome)}</option>`).join('')}</select><select class="control" id="f-periodo" aria-label="Filtrar por data do pedido"><option value="todas">Todas as datas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select><select class="control" id="f-desfecho" aria-label="Filtrar por desfecho"><option value="todos">Todos os desfechos</option><option value="em_aberto">Em aberto</option><option value="reembolso">Reembolso</option><option value="troca">Troca</option><option value="reenvio">Reenvio</option><option value="cupom">Cupom</option><option value="cancelamento">Cancelamento</option><option value="encerrado">Encerrado</option>${[20, 25, 35, 40, 50, 60, 70, 100].map(p => `<option value="${p}">Reembolso ${p}%</option>`).join('')}</select><div class="filter-result" id="filterResult" data-num>0 pedidos no filtro</div></section>
    <section class="notice"><i></i><div><strong>Funil conectado aos dados disponíveis</strong><p>Os pedidos, os casos e as fases vêm do Atendo em tempo real e reagem aos filtros. Só fases efetivamente enviadas entram nas métricas; inferências e correções aparecem marcadas. <span id="quando" data-date></span></p></div></section>
    <section class="kpis" aria-label="Funil geral de pedidos e casos"><article class="kpi"><span>Pedidos totais</span><div class="kpi-main"><strong id="kpiTotalOrders" data-num>0</strong><em id="kpiTotalOrdersPct" data-num>100%</em></div><small>base de pedidos da loja nos filtros</small></article><article class="kpi"><span>Pedidos com ticket</span><div class="kpi-main"><strong id="kpiTicketOrders" data-num>0</strong><em id="kpiTicketPct" data-num>—</em></div><small>percentual sobre pedidos totais</small></article><article class="kpi" style="--glow:rgba(212,76,71,.10)"><span>Pedidos sobre reembolso</span><div class="kpi-main"><strong style="color:var(--red)" id="kpiRefundOrders" data-num>0</strong><em id="kpiRefundPct" data-num>—</em></div><small>percentual dos tickets abertos</small></article><article class="kpi" style="--glow:rgba(203,145,47,.12)"><span>Valor dos pedidos totais</span><div class="kpi-main"><strong class="kpi-valor" style="color:var(--amber)" id="kpiTotalOrderValue" data-num>—</strong><em id="kpiTotalValuePct" data-num>100%</em></div><small>soma de todos os pedidos da loja</small></article><article class="kpi" style="--glow:rgba(68,131,97,.12)"><span>Valor dos pedidos reembolsados</span><div class="kpi-main"><strong class="kpi-valor" style="color:var(--green)" id="kpiRefundedValue" data-num>—</strong><em id="kpiRefundedValuePct" data-num>0%</em></div><small id="kpiRefundedValueNote">reembolsado de fato sobre o valor total</small></article></section>
    <section class="pipeline-strip" aria-label="Indicadores operacionais do pipeline"><div class="pipe-stat"><span>Antes do pipeline</span><strong id="kpiBefore" data-num>0%</strong><small id="kpiBeforeCount" data-num>0 pedidos integrais</small></div><div class="pipe-stat"><span>Após o pipeline</span><strong id="kpiAfter" data-num>0%</strong><small id="kpiDelta" data-num>casos do motor novo</small></div><div class="pipe-stat"><span>Reembolso parcial</span><strong id="kpiPartial" data-num>0</strong><small id="kpiPartialPct" data-num>0% dos casos</small></div><div class="pipe-stat"><span>Valor com ticket</span><strong id="kpiTicketValue" data-num>—</strong><small>pedidos com atendimento</small></div><div class="pipe-stat"><span>Produto identificado</span><strong id="kpiProducts" data-num>0%</strong><small id="kpiProductCount" data-num>0 produtos identificados</small></div></section>
    <section class="case-mix" aria-labelledby="caseMixTitle"><div class="case-mix-head"><div><h2 id="caseMixTitle">Percentual por tipo de caso</h2><p>Distribuição recalculada conforme os filtros.</p></div><strong id="caseMixTotal" data-num>0 casos</strong></div><div class="case-bars" id="caseMixList">${ordem.filter(j => j !== 'entrada').map(j => `<div class="case-bar" data-mix="${j}" style="--tone:${TOM_JORNADA[j]};--share:0%"><div class="case-bar-top"><span>${escapar(catalogo.jornadas[j] ?? j)}</span><strong data-num>0 · 0%</strong></div><div class="case-track"><i></i></div></div>`).join('')}</div></section>
    <section class="flow-view" id="flowView"><div class="flow-shell"><article class="panel"><div class="panel-head"><div><h2 id="journeyTitle">${escapar(catalogo.jornadas[ordem[0]] ?? ordem[0])}</h2><p id="journeyDescription">${escapar(DESCRICAO_JORNADA[ordem[0]] ?? '')}</p></div><div class="panel-total"><strong id="journeyOrders" data-num>0 pedidos</strong><span id="journeyValue" data-num>— em valor</span></div></div>${fluxos}</article><aside class="panel insight-panel"><div class="panel-head"><div><h2>Leitura da jornada</h2><p>Resultado dos pedidos filtrados</p></div></div><div class="insight-body"><div class="health"><div class="ring" id="retentionRing" style="--progress:0%"><div class="ring-label"><strong id="retentionPct" data-num>0%</strong><span>antes do final</span></div></div></div><div><div class="insight-list"><div class="insight-row"><span>Pedidos da jornada</span><strong id="insightTotal" data-num>0</strong></div><div class="insight-row"><span>Pararam antes do fim</span><strong id="insightStopped" data-num>0</strong></div><div class="insight-row"><span>Chegaram ao final</span><strong id="insightFinal" data-num>0</strong></div><div class="insight-row"><span>Valor da jornada</span><strong id="insightValue" data-num>—</strong></div></div><div class="legend"><div><i style="--dot:var(--purple)"></i>Fase clicável — abra para ver os pedidos</div><div><i style="--dot:var(--amber)"></i>Valor soma apenas pedidos com preço localizado, por moeda</div><div><i style="--dot:#9065b0"></i>Ajustes manuais ficam neste navegador</div></div></div></div></aside></div></section>
    <section class="orders-view" id="ordersView"><article class="panel orders-panel"><div class="panel-head"><div><h2>Todos os pedidos</h2><p>Abra qualquer pedido para conferir ou ajustar a fase atribuída neste navegador.</p></div><div class="panel-total"><strong id="ordersViewCount" data-num>0 pedidos</strong><span id="ordersViewValue" data-num>— em valor</span></div></div><div class="orders-table-wrap"><table><thead><tr><th>Pedido</th><th>Produto</th><th>Loja</th><th>Data do pedido</th><th>Valor</th><th>Reembolso</th><th>Motivo</th><th>Fase atual</th><th></th></tr></thead><tbody id="allOrdersTable"></tbody></table></div></article></section>
  </main>
</div>
<div class="backdrop" id="backdrop"></div>
<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" aria-hidden="true" inert><div class="drawer-head"><div class="drawer-topline"><div><span class="drawer-kicker" id="drawerKicker">Detalhe da fase</span><h2 id="drawerTitle">Fase</h2><p id="drawerDescription"></p></div><button type="button" class="close" id="closeDrawer" aria-label="Fechar">×</button></div><div class="drawer-stats"><div class="drawer-stat"><span>Passaram</span><strong id="drawerPassed" data-num>0</strong></div><div class="drawer-stat"><span>Pararam aqui</span><strong id="drawerStopped" data-num>0</strong></div><div class="drawer-stat"><span>Avançaram</span><strong id="drawerAdvanced" data-num>0</strong></div><div class="drawer-stat"><span>Valor</span><strong id="drawerValue" data-num>—</strong></div></div></div><div class="drawer-tools"><input id="drawerSearch" type="search" placeholder="Buscar dentro desta fase…" aria-label="Buscar dentro desta fase"><button type="button" class="button" id="showMode">Ver: passaram</button></div><div class="drawer-list" id="drawerList"></div></aside>

<script>
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var CHAVE_AJUSTES = 'atendo-pipeline-ajustes';
  var ajustes = {}; try { ajustes = JSON.parse(localStorage.getItem(CHAVE_AJUSTES) || '{}') || {}; } catch (e) { ajustes = {}; }
  var estado = { dados: null, jornada: null, item: null, modo: 'passaram', buscaFase: '', vista: 'flow' };
  var NOME_DESFECHO = { em_aberto: 'Em aberto', reembolso: 'Reembolso', troca: 'Troca', reenvio: 'Reenvio', cupom: 'Cupom', cancelamento: 'Cancelamento', encerrado: 'Encerrado' };
  var MOEDA_ISO = { EUR: 'EUR', GBP: 'GBP', USD: 'USD', BRL: 'BRL' };
  var FINAIS = /-full$|^entry-products-required$|^delivery-status-within$|^delivery-status-late$|^delivery-returned-report$|^delivery-processed-terms$|^delivery-unprocessed-cancel$|^cancel-complete$/;
  function texto(el, s) { if (el) { el.textContent = s == null ? '' : String(s); if (el.hasAttribute('data-num')) el.title = el.textContent; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase(); }
  function dinheiro(v, moeda) { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: MOEDA_ISO[moeda] || moeda || 'EUR' }).format(Number(v || 0)); } catch (e) { return (Number(v || 0)).toFixed(2).replace('.', ',') + ' ' + moeda; } }
  // moedas nunca se somam: cada moeda aparece separada dentro do mesmo componente
  function porMoeda(obj) { var k = Object.keys(obj || {}).filter(function (m) { return obj[m] != null; }); return k.length ? k.map(function (m) { return dinheiro(obj[m], m); }).join(' · ') : '—'; }
  // vários valores de moedas diferentes no mesmo componente: cada moeda separada, nunca somada
  function valorEm(el, obj) { var k = Object.keys(obj || {}).filter(function (m) { return obj[m] != null; }); el.classList.toggle('multi', k.length > 1); if (k.length > 1 && el.classList.contains('kpi-valor')) { el.innerHTML = k.map(function (m) { return '<span class="linha">' + esc(dinheiro(obj[m], m)) + '</span>'; }).join(''); el.title = porMoeda(obj); } else texto(el, porMoeda(obj)); }
  function somaPorMoeda(regs) { var o = {}; regs.forEach(function (r) { if (r.pedidoValor != null) o[r.moeda] = (o[r.moeda] || 0) + r.pedidoValor; }); return o; }
  function pct(n, d) { return d ? Math.round(n / d * 100) + '%' : '0%'; }
  function pct1(n, d) { return d ? (n / d * 100).toFixed(1).replace('.', ',') + '%' : '0,0%'; }
  function dataBr(ms) { return ms ? new Intl.DateTimeFormat('pt-BR').format(new Date(ms)) : 'Data não disponível'; }
  function filtros() { return { busca: $('#f-busca').value, loja: $('#f-loja').value, periodo: $('#f-periodo').value, desfecho: $('#f-desfecho').value }; }
  function carregar() {
    var f = filtros(); var q = Object.keys(f).map(function (k) { return k + '=' + encodeURIComponent(f[k]); }).join('&');
    // caminho relativo ao próprio endereço (o token fica só na URL, nunca no HTML)
    return fetch(location.pathname.replace(/[/]+$/, '') + '/dados?' + q, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Link inválido ou revogado'); return r.json(); })
      .then(function (d) { estado.dados = d; if (!estado.jornada) estado.jornada = d.catalogo.ordem[0]; desenhar(); })
      .catch(function (e) { texto($('#quando'), e.message); });
  }

  /* ---------- modelo local: catálogo + ajustes manuais (só neste navegador) ---------- */
  function itens() { return estado.dados.catalogo.mapa; }
  function itemPorId(id) { return itens().filter(function (i) { return i.id === id; })[0] || null; }
  function registros() { return estado.dados.registros; }
  function ajusteDe(r) { var id = ajustes[r.chave]; return id && itemPorId(id) ? itemPorId(id) : null; }
  function jornadaDe(r) { var a = ajusteDe(r); return a ? a.jornada : r.jornada; }
  function segmentoDe(r) { var a = ajusteDe(r); return a ? a.segmento : r.segmento; }
  function casosDaJornada(j, base) { base = base || registros(); return j === 'entrada' ? base : base.filter(function (r) { return jornadaDe(r) === j; }); }
  // chaves por item: as do servidor (fases enviadas), com os ajustes locais aplicados por cima
  function chavesPorItem() {
    var d = estado.dados; var saida = {}; var ajustados = Object.keys(ajustes).filter(function (c) { return itemPorId(ajustes[c]); });
    itens().forEach(function (i) {
      var g = d.porItem[i.id] && d.porItem[i.id].chaves ? d.porItem[i.id].chaves : { passaram: [], pararam: [], avancaram: [], emAberto: [] };
      saida[i.id] = { passaram: g.passaram.filter(function (c) { return ajustados.indexOf(c) < 0; }), pararam: g.pararam.filter(function (c) { return ajustados.indexOf(c) < 0; }), avancaram: g.avancaram.filter(function (c) { return ajustados.indexOf(c) < 0; }), emAberto: g.emAberto.filter(function (c) { return ajustados.indexOf(c) < 0; }) };
    });
    ajustados.forEach(function (c) {
      var alvo = itemPorId(ajustes[c]); if (!alvo || !registros().some(function (r) { return r.chave === c; })) return;
      itens().filter(function (i) { return i.fase && i.jornada === alvo.jornada && i.grupo === alvo.grupo && i.ordem <= alvo.ordem; }).forEach(function (i) {
        saida[i.id].passaram.push(c); if (i.id === alvo.id) saida[i.id].pararam.push(c); else saida[i.id].avancaram.push(c);
      });
    });
    // regras e decisões (sem fase): números derivados do caminho — nunca entram nas métricas oficiais
    itens().forEach(function (i) {
      if (i.fase) return;
      var grupo = itens().filter(function (x) { return x.jornada === i.jornada && x.grupo === i.grupo; });
      var depois = grupo.filter(function (x) { return x.fase && x.ordem > i.ordem; })[0];
      var antes = grupo.filter(function (x) { return x.fase && x.ordem < i.ordem; }).slice(-1)[0];
      var chaves = depois ? saida[depois.id].passaram.slice() : antes ? saida[antes.id].avancaram.slice() : casosDaJornada(i.jornada).filter(function (r) { return i.jornada === 'entrada' || segmentoDe(r) === i.segmento; }).map(function (r) { return r.chave; });
      saida[i.id] = { passaram: chaves, pararam: [], avancaram: chaves.slice(), emAberto: [], derivada: true };
    });
    return saida;
  }
  function regsDe(chaves) { var s = {}; chaves.forEach(function (c) { s[c] = true; }); return registros().filter(function (r) { return s[r.chave]; }); }
  function metricasDoItem(i, chaves) {
    var g = chaves[i.id]; var base = i.jornada === 'entrada' ? registros() : casosDaJornada(i.jornada).filter(function (r) { return segmentoDe(r) === i.segmento; });
    return { passaram: g.passaram.length, pararam: g.pararam.length, avancaram: g.avancaram.length, emAberto: g.emAberto.length, totalSegmento: base.length, valorPorMoeda: somaPorMoeda(regsDe(g.passaram)), chaves: g, derivada: !!g.derivada };
  }
  function itemDoRegistro(r) {
    var a = ajusteDe(r); if (a) return a;
    if (!r.faseAtual) return null;
    var cand = itens().filter(function (i) { return i.fase === r.faseAtual && i.jornada === r.jornada && (i.jornada === 'entrada' || i.segmento === r.segmento); });
    if (!cand.length) cand = itens().filter(function (i) { return i.fase === r.faseAtual; });
    return cand[0] || null;
  }
  function chegouAoFinal(r) { var i = itemDoRegistro(r); return !!(i && FINAIS.test(i.id)) || r.percentual === 100 || r.faseAtual === 'reemb_100' || r.faseAtual === 'cancel_nao_processado'; }
  function badge(r) {
    if (ajustes[r.chave]) return '<span class="badge local">Ajuste local</span>';
    if (r.origem === 'manual') return '<span class="badge manual">Fase manual</span>';
    if (r.origem === 'inferida' || r.inferidaPor) return '<span class="badge warn">Fase inferida</span>';
    return '<span class="badge">Fase enviada</span>';
  }
  function faseLabel(r) { var i = itemDoRegistro(r); return i ? i.titulo : (r.faseTitulo || 'Sem fase'); }

  /* ---------- desenho ---------- */
  function desenhar() {
    var d = estado.dados; if (!d) return;
    texto($('#quando'), 'Atualizado ' + new Date(d.geradoEm).toLocaleString('pt-BR') + '.');
    var regs = registros(); var chaves = chavesPorItem();
    // barra lateral: quantidade, valor e percentual por jornada (dados reais, moedas separadas)
    d.catalogo.ordem.forEach(function (j) {
      var b = $('.nav-item[data-flow="' + j + '"]'); var lista = casosDaJornada(j);
      texto($('[data-nav=n]', b), lista.length); texto($('[data-nav=pct]', b), j === 'entrada' ? '100%' : pct1(lista.length, regs.length)); texto($('[data-nav=valor]', b), porMoeda(somaPorMoeda(lista)));
      b.classList.toggle('active', estado.jornada === j);
    });
    // funil e faixa de indicadores (indicadores do servidor, por moeda)
    var ind = d.indicadores || []; var soma = function (k) { return ind.reduce(function (s, x) { return s + (x[k] || 0); }, 0); };
    var valores = function (k) { var o = {}; ind.forEach(function (x) { o[x.moeda] = x[k] || 0; }); return o; };
    var totais = soma('pedidosTotais'), comTicket = soma('pedidosComAtendimento'), sobreReemb = soma('pedidosEmReembolso');
    texto($('#kpiTotalOrders'), totais.toLocaleString('pt-BR')); texto($('#kpiTotalOrdersPct'), '100%');
    texto($('#kpiTicketOrders'), comTicket.toLocaleString('pt-BR')); texto($('#kpiTicketPct'), pct1(comTicket, totais));
    texto($('#kpiRefundOrders'), sobreReemb.toLocaleString('pt-BR')); texto($('#kpiRefundPct'), pct1(sobreReemb, comTicket));
    var vt = valores('valorTotalPedidos'), vr = valores('reembolsadoEfetivo');
    valorEm($('#kpiTotalOrderValue'), vt); texto($('#kpiTotalValuePct'), '100%');
    valorEm($('#kpiRefundedValue'), vr); texto($('#kpiRefundedValuePct'), Object.keys(vr).length ? Object.keys(vr).map(function (m) { return pct1(vr[m], vt[m]); }).join(' · ') : '0%');
    var historicos = regs.filter(function (r) { return r.origem !== 'confirmada'; }), motorNovo = regs.filter(function (r) { return r.origem === 'confirmada'; });
    var antesInt = historicos.filter(function (r) { return r.percentual === 100; }).length, depoisInt = motorNovo.filter(function (r) { return r.percentual === 100 || r.faseAtual === 'reemb_100'; }).length;
    var antesTaxa = historicos.length ? antesInt / historicos.length * 100 : 0, depoisTaxa = motorNovo.length ? depoisInt / motorNovo.length * 100 : 0, delta = antesTaxa - depoisTaxa;
    texto($('#kpiBefore'), pct1(antesInt, historicos.length)); texto($('#kpiBeforeCount'), antesInt + ' pedidos integrais · ' + historicos.length + ' casos históricos');
    texto($('#kpiAfter'), pct1(depoisInt, motorNovo.length)); texto($('#kpiDelta'), (motorNovo.length ? (delta >= 0 ? '−' : '+') + Math.abs(delta).toFixed(1).replace('.', ',') + ' p.p. · ' : '') + motorNovo.length + ' casos do motor novo');
    var parciais = regs.filter(function (r) { return r.percentual != null && r.percentual < 100; }).length;
    texto($('#kpiPartial'), parciais); texto($('#kpiPartialPct'), pct1(parciais, regs.length) + ' dos casos');
    valorEm($('#kpiTicketValue'), valores('valorComAtendimento'));
    var identificados = regs.filter(function (r) { return r.produto; }).length;
    texto($('#kpiProducts'), pct1(identificados, regs.length)); texto($('#kpiProductCount'), identificados + ' produtos identificados');
    texto($('#filterResult'), d.linhas.length + ' pedidos no filtro');
    // distribuição por tipo de caso
    texto($('#caseMixTotal'), regs.length + ' casos');
    $$('[data-mix]').forEach(function (el) { var j = el.getAttribute('data-mix'); var n = casosDaJornada(j).length; var share = pct1(n, regs.length); el.style.setProperty('--share', share.replace(',', '.')); texto($('strong', el), n + ' · ' + share); });
    desenharFluxo(chaves);
    desenharPedidos();
    desenharDrawer(chaves);
  }
  function desenharFluxo(chaves) {
    var d = estado.dados; var j = estado.jornada; var lista = casosDaJornada(j);
    texto($('#journeyTitle'), d.catalogo.jornadas[j] || j); texto($('#journeyDescription'), d.catalogo.descricoes[j] || '');
    texto($('#journeyOrders'), lista.length + ' pedidos'); texto($('#journeyValue'), porMoeda(somaPorMoeda(lista)) + ' em valor');
    $$('.flow-canvas[data-jornada]').forEach(function (c) { c.hidden = c.getAttribute('data-jornada') !== j; });
    $$('.stage[data-item]').forEach(function (b) {
      var i = itemPorId(b.getAttribute('data-item')); if (!i) return; var m = metricasDoItem(i, chaves);
      texto($('[data-n=passaram]', b), m.passaram); texto($('[data-n=passaram-pct]', b), pct1(m.passaram, m.totalSegmento));
      texto($('[data-n=pararam]', b), m.pararam); texto($('[data-n=pararam-pct]', b), pct1(m.pararam, m.passaram));
      texto($('[data-n=avancaram]', b), m.avancaram); texto($('[data-n=avancaram-pct]', b), pct1(m.avancaram, m.passaram));
      var v = $('[data-n=valor]', b); texto(v, porMoeda(m.valorPorMoeda)); v.title = porMoeda(m.valorPorMoeda);
      b.classList.toggle('selected', estado.item === i.id);
    });
    var finais = lista.filter(chegouAoFinal).length, antes = Math.max(0, lista.length - finais);
    texto($('#retentionPct'), pct(antes, lista.length)); $('#retentionRing').style.setProperty('--progress', pct(antes, lista.length));
    texto($('#insightTotal'), lista.length); texto($('#insightStopped'), antes); texto($('#insightFinal'), finais); texto($('#insightValue'), porMoeda(somaPorMoeda(lista)));
  }
  function desenharPedidos() {
    var d = estado.dados; var linhas = d.linhas;
    texto($('#ordersViewCount'), linhas.length + ' pedidos'); texto($('#ordersViewValue'), porMoeda(somaPorMoeda(linhas.map(function (l) { return { pedidoValor: l.valor, moeda: l.moeda }; }))) + ' em valor');
    var porChave = {}; registros().forEach(function (r) { porChave[r.chave] = r; });
    $('#allOrdersTable').innerHTML = linhas.map(function (l) {
      var r = l.registro ? (porChave[l.registro.chave] || l.registro) : null;
      var reemb = !r ? '—' : r.percentual != null ? r.percentual + '%' : (r.desfecho === 'em_aberto' ? 'em aberto' : NOME_DESFECHO[r.desfecho] || r.desfecho);
      return '<tr><td><span class="order-id">' + (l.pedidoNumero ? '#' + esc(l.pedidoNumero) : 'sem pedido') + '</span></td><td>' + (l.produto ? '<span class="product-chip">' + esc(l.produto) + '</span>' : '<span class="date-missing">Produto não informado</span>') + '</td><td>' + esc(l.lojaNome) + '</td><td><span data-date class="' + (l.dataMs ? '' : 'date-missing') + '">' + dataBr(l.dataMs) + '</span></td><td class="money" data-num>' + (l.valor != null ? dinheiro(l.valor, l.moeda) : 'Valor não localizado') + '</td><td data-num>' + esc(reemb) + '</td><td class="reason">' + (r ? esc(r.motivo) : '—') + '</td><td>' + (r ? badge(r) + '<br><span class="sub">' + esc(faseLabel(r)) + '</span>' : '<span class="sub">sem atendimento</span>') + '</td><td>' + (r ? '<button type="button" class="row-button" data-open-order="' + esc(r.chave) + '">Abrir</button>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="9"><div class="empty">Nenhum pedido encontrado.</div></td></tr>';
    $$('[data-open-order]').forEach(function (b) { b.addEventListener('click', function () { abrirPedido(b.getAttribute('data-open-order')); }); });
  }
  function listaDoDrawer(i, chaves) {
    var g = chaves[i.id]; var base = regsDe(g[estado.modo] || []); var q = fold(estado.buscaFase);
    return base.filter(function (r) { return !q || fold([r.pedidoNumero, r.produto, r.motivo, r.lojaNome].filter(Boolean).join(' ')).indexOf(q) >= 0; });
  }
  function desenharDrawer(chaves) {
    var d = estado.dados; var i = estado.item ? itemPorId(estado.item) : null; if (!i) return;
    chaves = chaves || chavesPorItem(); var m = metricasDoItem(i, chaves); var lista = listaDoDrawer(i, chaves);
    texto($('#drawerKicker'), (d.catalogo.jornadas[i.jornada] || i.jornada) + ' › ' + i.grupo); texto($('#drawerTitle'), i.titulo);
    texto($('#drawerDescription'), i.descricao + (i.fase ? ' Fase do motor: ' + (d.catalogo.fases[i.fase] ? d.catalogo.fases[i.fase].titulo : i.fase) + ' · casos: ' + (d.segmentos[i.segmento] || i.segmento) + '.' : ' Regra do mapa: os números vêm do caminho e não entram nas métricas oficiais de fases enviadas.'));
    texto($('#drawerPassed'), m.passaram + ' · ' + pct1(m.passaram, m.totalSegmento)); texto($('#drawerStopped'), m.pararam + ' · ' + pct1(m.pararam, m.passaram)); texto($('#drawerAdvanced'), m.avancaram + ' · ' + pct1(m.avancaram, m.passaram)); texto($('#drawerValue'), porMoeda(m.valorPorMoeda));
    var opcoes = itens().filter(function (x) { return x.fase && x.jornada !== 'entrada'; }).map(function (x) { return '<option value="' + x.id + '">' + esc((d.catalogo.jornadas[x.jornada] || x.jornada) + ' › ' + x.titulo) + '</option>'; }).join('');
    $('#drawerList').innerHTML = lista.map(function (r) {
      var origem = r.origem === 'confirmada' ? 'fase enviada' : r.origem === 'manual' ? 'correção manual' : 'inferida' + (r.inferidaPor === 'ia' ? ' pela IA' : r.inferidaPor === 'relatorio' ? ' pelo relatório' : '');
      var desf = r.percentual != null ? r.percentual + '% reembolsado' : r.desfecho === 'em_aberto' ? 'Em aberto' : (NOME_DESFECHO[r.desfecho] || r.desfecho);
      var aplicavel = r.jornada !== 'entrada' && !!r.faseAtual;
      return '<article class="order-card"><div><div class="order-top"><strong>' + (r.pedidoNumero ? '#' + esc(r.pedidoNumero) : 'sem pedido') + '</strong><span class="store">' + esc(r.lojaNome) + '</span><span class="product-chip">' + esc(r.produto || 'Produto não informado') + '</span>' + badge(r) + '</div><p>' + esc(r.motivo) + ' · origem: ' + origem + (r.conversas > 1 ? ' · ' + r.conversas + ' conversas' : '') + '</p><span class="date-missing" data-date>Data do pedido: ' + dataBr(r.dataMs) + '</span></div><div class="order-side"><span class="money" data-num>' + (r.pedidoValor != null ? dinheiro(r.pedidoValor, r.moeda) : 'Valor não localizado') + '</span><span class="pct" data-num>' + esc(desf) + '</span></div>' + (aplicavel ? '<div class="phase-select"><label for="fase-' + esc(r.chave) + '">Fase atribuída</label><select id="fase-' + esc(r.chave) + '" data-assign="' + esc(r.chave) + '">' + opcoes + '</select></div>' : '') + '</article>';
    }).join('') || '<div class="empty">Nenhum pedido neste recorte.</div>';
    $$('[data-assign]').forEach(function (s) { var r = registros().filter(function (x) { return x.chave === s.getAttribute('data-assign'); })[0]; var atual = r ? itemDoRegistro(r) : null; if (atual) s.value = atual.id; s.addEventListener('change', function () { ajustes[s.getAttribute('data-assign')] = s.value; localStorage.setItem(CHAVE_AJUSTES, JSON.stringify(ajustes)); desenhar(); }); });
  }

  /* ---------- navegação ---------- */
  function abrirItem(id) {
    estado.item = id; estado.modo = 'passaram'; estado.buscaFase = ''; $('#drawerSearch').value = ''; texto($('#showMode'), 'Ver: passaram');
    desenhar();
    var dr = $('#drawer'); dr.removeAttribute('inert'); dr.setAttribute('aria-hidden', 'false'); dr.classList.add('open'); $('#backdrop').classList.add('open'); document.body.style.overflow = 'hidden'; $('#closeDrawer').focus();
  }
  function fecharDrawer() { var dr = $('#drawer'); dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); dr.setAttribute('inert', ''); $('#backdrop').classList.remove('open'); document.body.style.overflow = ''; estado.item = null; desenhar(); }
  function abrirPedido(chave) { var r = registros().filter(function (x) { return x.chave === chave; })[0]; if (!r) return; var i = itemDoRegistro(r); if (!i) return; estado.jornada = i.jornada; estado.vista = 'flow'; sincronizarVista(); abrirItem(i.id); }
  function sincronizarVista() {
    $$('.view-button').forEach(function (b) { var on = b.getAttribute('data-view') === estado.vista; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    $('#flowView').classList.toggle('hidden', estado.vista !== 'flow'); $('#ordersView').classList.toggle('active', estado.vista === 'orders');
  }
  $$('.nav-item[data-flow]').forEach(function (b) { b.addEventListener('click', function () { estado.jornada = b.getAttribute('data-flow'); estado.item = null; estado.vista = 'flow'; sincronizarVista(); desenhar(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); });
  $$('.stage[data-item]').forEach(function (b) { b.addEventListener('click', function () { abrirItem(b.getAttribute('data-item')); }); });
  $$('.view-button').forEach(function (b) { b.addEventListener('click', function () { estado.vista = b.getAttribute('data-view'); sincronizarVista(); }); });
  $$('#filtros select').forEach(function (s) { s.addEventListener('change', carregar); });
  var t; $('#f-busca').addEventListener('input', function () { clearTimeout(t); t = setTimeout(carregar, 300); });
  $('#closeDrawer').addEventListener('click', fecharDrawer); $('#backdrop').addEventListener('click', fecharDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && estado.item) fecharDrawer(); });
  $('#drawerSearch').addEventListener('input', function (e) { estado.buscaFase = e.target.value; desenharDrawer(); });
  $('#showMode').addEventListener('click', function () { estado.modo = estado.modo === 'passaram' ? 'pararam' : estado.modo === 'pararam' ? 'avancaram' : 'passaram'; texto($('#showMode'), 'Ver: ' + { passaram: 'passaram', pararam: 'pararam aqui', avancaram: 'avançaram' }[estado.modo]); desenharDrawer(); });
  $('#resetAssignments').addEventListener('click', function () { ajustes = {}; localStorage.removeItem(CHAVE_AJUSTES); desenhar(); });
  carregar();
  setInterval(carregar, 60000);
})();
</script>
</body>
</html>`
}
