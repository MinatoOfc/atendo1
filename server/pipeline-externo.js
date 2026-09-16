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
import { MAPA_VISUAL, itensDaJornada, metricasPorItem, SEGMENTOS } from '../shared/mapa.js'

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
    motivo: motivoPublico(r.motivoCategoria), jornada: r.jornada,
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
      ordem: ORDEM_JORNADAS, jornadas,
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

/** HTML da página. Sem token no corpo: a página busca "dados" pelo caminho relativo ao próprio endereço. */
export function paginaPipeline({ catalogo, lojas }) {
  const ordem = catalogo.ordem
  const titulo = id => catalogo.fases[id]?.titulo ?? id
  // o mapa visual inteiro vai no HTML (servidor): a página nunca depende só do JS para mostrar as etapas
  const mapaInicial = ordem.map(j => {
    const itens = itensDaJornada(j)
    const grupos = [...new Set(itens.map(i => i.grupo))]
    return `
    <section class="jornada" data-jornada="${j}">
      <h2>${escapar(catalogo.jornadas[j] ?? j)} <span class="mini" data-jornada-resumo="${j}"></span></h2>
      ${grupos.map(g => `
      <div class="grupo"><div class="grupo-titulo">${escapar(g)}</div>
      <div class="fases">
        ${itens.filter(i => i.grupo === g).map(i => `
        <${i.fase ? 'button type="button"' : 'div'} class="fase tipo-${i.tipo}${i.fase ? '' : ' sem-fase'}" data-item="${i.id}"${i.fase ? ` data-fase="${i.fase}"` : ''}>
          <div class="fase-cab"><span class="ordem">${i.ordem}</span><span class="tipo">${NOME_TIPO[i.tipo]}</span></div>
          <div class="fase-titulo">${escapar(i.titulo)}</div>
          <div class="mini desc">${escapar(i.descricao)}</div>
          ${i.fase ? `<div class="mini">fase do motor: <code>${i.fase}</code> — ${escapar(titulo(i.fase))} · casos: ${escapar(SEGMENTOS[i.segmento] ?? i.segmento)}</div>
          <div class="nums"><span><b data-n="passaram">0</b> passaram</span><span><b data-n="pararam">0</b> pararam</span><span><b data-n="avancaram">0</b> avançaram</span></div>
          <div class="mini" data-n="pct"></div>
          <div class="mini" data-n="valor">—</div>
          <div class="mini" data-n="fora"></div>` : `<div class="mini nao-conta">${i.tipo === 'humano' ? 'decisão do dono — não é fase enviada' : `${NOME_TIPO[i.tipo]} — não é fase enviada, não entra nas métricas`}</div>`}
          ${i.destinos.length ? `<div class="mini">→ ${i.destinos.map(d => escapar(MAPA_VISUAL.find(x => x.id === d)?.titulo ?? d)).join(' · ')}</div>` : ''}
        </${i.fase ? 'button' : 'div'}>`).join('')}
      </div></div>`).join('')}
    </section>`
  }).join('')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Pipeline completo</title>
<style>
  :root { --bg:#f6f7fb; --panel:#fff; --border:#e4e6ee; --text:#1c1f2b; --muted:#6b7080; --purple:#6b5cf6; --purple-soft:#eeebff; --green:#e6f7ee; --amber:#fff3d6; --red:#fde8e8; --blue:#e7f0ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:14px 16px 40px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:18px 0 8px; }
  .muted { color:var(--muted); font-size:12.5px; }
  .mini { color:var(--muted); font-size:11.5px; }
  code { font-size:11px; background:#eef0f5; padding:0 4px; border-radius:4px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:12px 14px; }
  .wrap { max-width:1180px; margin:0 auto; }
  .topo { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:flex-start; margin-bottom:12px; }
  .abas { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { border:1px solid var(--border); background:var(--panel); border-radius:999px; padding:6px 12px; font-size:12.5px; cursor:pointer; color:var(--text); max-width:100%; }
  .chip.on { background:var(--text); color:#fff; border-color:var(--text); }
  select.chip { appearance:auto; }
  .filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
  .filtros input { flex:1; min-width:180px; max-width:100%; border:1px solid var(--border); border-radius:999px; padding:7px 12px; font-size:13px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:10px; }
  .kpi .r { text-transform:uppercase; letter-spacing:.04em; font-size:10.5px; color:var(--muted); }
  .kpi .v { font-size:18px; margin-top:2px; }
  .jornadas { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom:6px; }
  .jornadas .card { cursor:pointer; }
  .jornadas .card.on { border-color:var(--purple); box-shadow:0 0 0 2px var(--purple-soft); }
  .legenda { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0 4px; }
  .grupo { margin-bottom:10px; }
  .grupo-titulo { font-size:12px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:6px 0 6px; }
  .fases { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:8px; }
  .fase { text-align:left; background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:10px 12px; display:grid; gap:4px; font:inherit; color:inherit; align-content:start; }
  button.fase { cursor:pointer; }
  button.fase.on { border-color:var(--purple); box-shadow:0 0 0 2px var(--purple-soft); }
  .fase.sem-fase { background:#fbfbfd; border-style:dashed; }
  .fase-cab { display:flex; justify-content:space-between; align-items:center; }
  .ordem { font-size:11px; color:var(--muted); }
  .tipo { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; border-radius:999px; padding:1px 8px; background:#eef0f5; }
  .tipo-oferta .tipo { background:var(--purple-soft); } .tipo-confirmacao .tipo { background:var(--green); } .tipo-humano .tipo { background:var(--amber); } .tipo-decisao .tipo { background:var(--blue); } .tipo-coleta .tipo { background:#f1f5f9; }
  .fase-titulo { font-weight:600; font-size:12.5px; }
  .nao-conta { font-style:italic; }
  .nums { display:flex; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--muted); }
  .nums b { color:var(--text); }
  .tabela { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; min-width:760px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .tag { display:inline-block; border-radius:999px; padding:1px 8px; font-size:11px; background:#eef0f5; }
  .tag.green { background:var(--green); } .tag.amber { background:var(--amber); } .tag.red { background:var(--red); }
  .painel { position:fixed; top:0; right:0; bottom:0; width:380px; max-width:100vw; background:var(--panel); border-left:1px solid var(--border); box-shadow:-12px 0 40px rgba(0,0,0,.18); padding:16px; z-index:20; overflow:auto; }
  .painel[hidden] { display:none; }
  .painel .fechar { float:right; border:0; background:none; font-size:18px; cursor:pointer; }
  .item { border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:12.5px; margin-bottom:6px; }
  .item .l { display:flex; justify-content:space-between; gap:8px; }
  .oculto { display:none; }
  @media (max-width:768px) { .painel { width:100vw; } body { padding:10px 12px 32px; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="topo">
    <div>
      <h1>Pipeline completo</h1>
      <div class="muted">Casos de devolução, reembolso e entrega — dados reais, atualizados pelo servidor. Somente leitura. <span id="quando"></span></div>
    </div>
    <div class="abas">
      <button class="chip on" data-aba="mapa" type="button">Mapa do fluxo</button>
      <button class="chip" data-aba="pedidos" type="button">Todos os pedidos (<span id="n-pedidos">0</span>)</button>
    </div>
  </div>

  <div class="card filtros" id="filtros">
    <input id="f-busca" placeholder="Pedido, produto, motivo ou loja" aria-label="Busca">
    <select class="chip" id="f-loja"><option value="todas">Todas as lojas</option>${lojas.map(l => `<option value="${escapar(l.id)}">${escapar(l.nome)}</option>`).join('')}</select>
    <select class="chip" id="f-periodo"><option value="todas">Todas as datas</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select>
    <select class="chip" id="f-desfecho"><option value="todos">Todos os desfechos</option><option value="em_aberto">Em aberto</option><option value="reembolso">Reembolso</option><option value="troca">Troca</option><option value="reenvio">Reenvio</option><option value="cupom">Cupom</option><option value="cancelamento">Cancelamento</option><option value="encerrado">Encerrado</option>${[20, 25, 35, 40, 50, 60, 70, 100].map(p => `<option value="${p}">${p}% reembolsado</option>`).join('')}</select>
    <select class="chip" id="f-jornada"><option value="todas">Todas as jornadas</option>${ordem.map(j => `<option value="${j}">${escapar(catalogo.jornadas[j] ?? j)}</option>`).join('')}</select>
    <select class="chip" id="f-fase"><option value="todas">Todas as fases</option><option value="sem_fase">Sem fase</option>${ordem.flatMap(j => Object.entries(catalogo.fases).filter(([, f]) => f.jornada === j).map(([id, f]) => `<option value="${id}" data-jornada="${j}">${escapar(f.titulo)}</option>`)).join('')}</select>
  </div>

  <div id="aviso-moedas" class="muted oculto" style="margin-bottom:8px">Lojas em moedas diferentes não se somam — os indicadores aparecem por moeda.</div>
  <div id="kpis"></div>

  <div id="mapa">
    <div class="legenda muted">Legenda: <span class="tipo" style="background:var(--purple-soft)">oferta</span> <span class="tipo" style="background:var(--green)">confirmação</span> <span class="tipo" style="background:#f1f5f9">coleta</span> <span class="tipo" style="background:var(--blue)">decisão</span> <span class="tipo">regra</span> <span class="tipo" style="background:var(--amber)">decisão do dono</span> — só itens com fase do motor carregam números; regra e decisão não entram nas métricas.</div>
    ${mapaInicial}
  </div>

  <div id="pedidos" class="card tabela oculto">
    <table>
      <thead><tr><th>Pedido</th><th>Produto</th><th>Loja</th><th>Data</th><th>Valor</th><th>% reemb.</th><th>Motivo</th><th>Atendimento</th><th>Fase atual</th></tr></thead>
      <tbody id="linhas"></tbody>
    </table>
  </div>
</div>

<aside class="painel" id="painel" hidden>
  <button class="fechar" id="painel-fechar" type="button" aria-label="Fechar">×</button>
  <b id="painel-titulo"></b>
  <p class="muted" id="painel-desc"></p>
  <div class="nums" id="painel-nums"></div>
  <div class="mini" id="painel-valor"></div>
  <div class="abas" id="painel-abas" style="margin:8px 0">
    <button class="chip on" data-rel="passaram" type="button">passaram</button><button class="chip" data-rel="pararam" type="button">pararam</button><button class="chip" data-rel="avancaram" type="button">avançaram</button>
  </div>
  <input id="painel-busca" placeholder="Buscar nesta fase" style="width:100%;border:1px solid var(--border);border-radius:999px;padding:7px 12px;font-size:13px;margin-bottom:8px">
  <div id="painel-lista"></div>
</aside>

<script>
(function () {
  'use strict';
  var estado = { dados: null, aba: 'mapa', item: null, rel: 'passaram', buscaFase: '' };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var NOME_DESFECHO = { em_aberto: 'Em aberto', reembolso: 'Reembolso', troca: 'Troca', reenvio: 'Reenvio', cupom: 'Cupom', cancelamento: 'Cancelamento', encerrado: 'Encerrado' };
  var SIMB = { EUR: '€', BRL: 'R$', USD: 'US$', GBP: '£' };
  function dinheiro(v, moeda) { return (Number(v || 0)).toFixed(2).replace('.', ',') + ' ' + (SIMB[moeda] || moeda || ''); }
  function porMoeda(obj) { var k = Object.keys(obj || {}); return k.length ? k.map(function (m) { return dinheiro(obj[m], m); }).join(' · ') : '—'; }
  function texto(el, s) { el.textContent = s == null ? '' : String(s); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function filtros() {
    return { busca: $('#f-busca').value, loja: $('#f-loja').value, periodo: $('#f-periodo').value, desfecho: $('#f-desfecho').value, jornada: $('#f-jornada').value, fase: $('#f-fase').value };
  }
  function carregar() {
    var f = filtros(); var q = Object.keys(f).map(function (k) { return k + '=' + encodeURIComponent(f[k]); }).join('&');
    // caminho relativo ao próprio endereço (o token fica só na URL, nunca no HTML)
    return fetch(location.pathname.replace(/[/]+$/, '') + '/dados?' + q, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Link inválido ou revogado'); return r.json(); })
      .then(function (d) { estado.dados = d; desenhar(); })
      .catch(function (e) { texto($('#quando'), e.message); });
  }
  function desenhar() {
    var d = estado.dados; if (!d) return;
    texto($('#quando'), 'Atualizado ' + new Date(d.geradoEm).toLocaleString('pt-BR'));
    texto($('#n-pedidos'), d.linhas.length);
    $('#aviso-moedas').classList.toggle('oculto', d.indicadores.length <= 1);
    var kp = $('#kpis'); kp.innerHTML = '';
    d.indicadores.forEach(function (k) {
      var bloco = el('div'); if (d.indicadores.length > 1) bloco.appendChild(el('div', 'muted', k.moeda));
      var g = el('div', 'kpis');
      var itens = [
        ['Pedidos totais', String(k.pedidosTotais), 'nos filtros atuais'],
        ['Pedidos com atendimento', String(k.pedidosComAtendimento), dinheiro(k.valorComAtendimento, k.moeda) + ' em pedidos'],
        ['Casos', String(k.casos), k.pctProdutoIdentificado + '% com produto identificado'],
        ['Envolvidos em reembolso', String(k.pedidosEmReembolso), k.reembolsosRegistrados + ' só no relatório · ' + k.reembolsosInferidos + ' só inferidos'],
        ['Valor total dos pedidos', dinheiro(k.valorTotalPedidos, k.moeda), 'pago na Shopify'],
        ['Valor dos pedidos reembolsados', dinheiro(k.valorPedidosReembolsados, k.moeda), 'valor pago dos casos com reembolso'],
        ['Aceites pendentes', String(k.aceitesPendentes), dinheiro(k.valorAceitesPendentes, k.moeda) + ' aguardando decisão'],
        ['Reembolsado de fato', dinheiro(k.reembolsadoEfetivo, k.moeda), k.reembolsosEfetivados + ' efetivados (' + k.reembolsosParciais + ' parciais)'],
        ['Cenário hipotético sem retenção', k.historicoSuficiente ? dinheiro(k.hipoteticoSemRetencao, k.moeda) : '—', k.historicoSuficiente ? 'hipótese: os mesmos efetivados com 100% (não é economia comprovada)' : 'dados históricos insuficientes'],
      ];
      itens.forEach(function (it) { var c = el('div', 'card kpi'); c.appendChild(el('div', 'r', it[0])); c.appendChild(el('div', 'v', it[1])); c.appendChild(el('div', 'mini', it[2])); g.appendChild(c); });
      bloco.appendChild(g);
      var j = el('div', 'jornadas');
      k.porJornada.forEach(function (pj) {
        var c = el('div', 'card' + ($('#f-jornada').value === pj.chave ? ' on' : '')); c.appendChild(el('div', '', d.catalogo.jornadas[pj.chave] || pj.chave)).style.fontWeight = '600';
        c.appendChild(el('div', '', pj.pedidos + ' · ' + pj.pct + '%')).style.fontSize = '18px'; c.appendChild(el('div', 'mini', dinheiro(pj.valor, k.moeda)));
        c.addEventListener('click', function () { $('#f-jornada').value = $('#f-jornada').value === pj.chave ? 'todas' : pj.chave; $('#f-fase').value = 'todas'; carregar(); });
        j.appendChild(c);
      });
      bloco.appendChild(j); kp.appendChild(bloco);
    });
    // itens do mapa com fase (já estão no HTML): só os números
    $$('.fase[data-fase]').forEach(function (b) {
      var item = b.getAttribute('data-item'); var m = d.porItem[item] || { passaram: 0, pararam: 0, avancaram: 0, emAberto: 0, valorPorMoeda: {}, inferidos: 0, manuais: 0, pctPassaram: 0, totalSegmento: 0 };
      texto($('[data-n=passaram]', b), m.passaram); texto($('[data-n=pararam]', b), m.pararam); texto($('[data-n=avancaram]', b), m.avancaram);
      texto($('[data-n=pct]', b), m.pctPassaram + '% dos ' + m.totalSegmento + ' caso(s) deste caminho' + (m.emAberto ? ' · ' + m.emAberto + ' em aberto' : ''));
      texto($('[data-n=valor]', b), porMoeda(m.valorPorMoeda));
      texto($('[data-n=fora]', b), (m.inferidos || m.manuais) ? ((m.inferidos ? m.inferidos + ' inferido(s)' : '') + (m.inferidos && m.manuais ? ' · ' : '') + (m.manuais ? m.manuais + ' manual(is)' : '') + ' — fora das métricas') : '');
      b.classList.toggle('on', estado.item === item);
    });
    // jornada filtrada: o mapa mostra só aquela jornada (mais a Entrada geral, que é comum a todas) — cada jornada pode ser lida sozinha
    var fj = $('#f-jornada').value;
    d.catalogo.ordem.forEach(function (jn) { var sec = $('section.jornada[data-jornada="' + jn + '"]'); if (sec) sec.hidden = !(fj === 'todas' || fj === jn || jn === 'entrada'); });
    d.catalogo.ordem.forEach(function (jn) { var s = $('[data-jornada-resumo="' + jn + '"]'); if (s) texto(s, (d.indicadores[0] ? (d.indicadores[0].porJornada.filter(function (x) { return x.chave === jn; })[0] || {}).pedidos || 0 : 0) + ' caso(s) nos filtros'); });
    // tabela
    var tb = $('#linhas'); tb.innerHTML = '';
    if (!d.linhas.length) { var tr0 = el('tr'); var td0 = el('td', 'muted', 'Nenhum pedido nestes filtros.'); td0.colSpan = 9; tr0.appendChild(td0); tb.appendChild(tr0); }
    d.linhas.slice(0, 300).forEach(function (l) {
      var r = l.registro; var tr = el('tr');
      tr.appendChild(el('td', '', l.pedidoNumero ? '#' + l.pedidoNumero : 'sem pedido'));
      tr.appendChild(el('td', '', l.produto || '—'));
      tr.appendChild(el('td', '', l.lojaNome));
      tr.appendChild(el('td', 'muted', new Date(l.dataMs).toLocaleDateString('pt-BR')));
      tr.appendChild(el('td', '', l.valor != null ? dinheiro(l.valor, l.moeda) : '—'));
      var tdp = el('td', '', !r ? '—' : r.percentual != null ? r.percentual + '%' : (r.desfecho === 'em_aberto' ? 'em aberto' : NOME_DESFECHO[r.desfecho] || r.desfecho));
      if (r && r.situacaoReembolso) tdp.appendChild(el('div', 'mini', { efetivado: 'efetivado', aceite_pendente: 'aceite pendente', registrado: 'no relatório, não processado', inferido: 'só inferido pela IA' }[r.situacaoReembolso] || r.situacaoReembolso));
      tr.appendChild(tdp);
      tr.appendChild(el('td', '', r ? r.motivo : '—'));
      var tda = el('td'); var tag = el('span', 'tag ' + (l.atendimento === 'confirmada' ? 'green' : l.atendimento === 'manual' ? 'amber' : ''), l.atendimento + (r && r.inferidaPor === 'ia' ? ' (IA)' : r && r.inferidaPor === 'relatorio' ? ' (relatório)' : '')); tda.appendChild(tag);
      if (r && r.comVoce) { tda.appendChild(document.createTextNode(' ')); tda.appendChild(el('span', 'tag red', 'com o dono')); }
      tr.appendChild(tda);
      tr.appendChild(el('td', '', r ? l.faseTitulo : 'sem fase'));
      tb.appendChild(tr);
    });
    if (d.linhas.length > 300) { var trm = el('tr'); var tdm = el('td', 'muted', 'Mostrando 300 de ' + d.linhas.length + ' — refine os filtros.'); tdm.colSpan = 9; trm.appendChild(tdm); tb.appendChild(trm); }
    desenharPainel();
  }
  function desenharPainel() {
    var p = $('#painel'); var d = estado.dados; var itemId = estado.item;
    var item = itemId && d ? d.catalogo.mapa.filter(function (x) { return x.id === itemId; })[0] : null;
    if (!item || !item.fase || !d.catalogo.fases[item.fase]) { p.hidden = true; return; }
    p.hidden = false; var f = d.catalogo.fases[item.fase]; var m = d.porItem[itemId]; var g = (m && m.chaves) || { passaram: [], pararam: [], avancaram: [], emAberto: [] };
    texto($('#painel-titulo'), item.titulo); texto($('#painel-desc'), (d.segmentos[item.segmento] || item.segmento) + ' · fase do motor: ' + f.titulo + ' — ' + (f.instrucao || 'decisão do dono, sem texto automático'));
    var nums = $('#painel-nums'); nums.innerHTML = ''; [['passaram', m.passaram], ['pararam', m.pararam], ['avançaram', m.avancaram]].forEach(function (x) { var s = el('span'); s.appendChild(el('b', '', x[1])); s.appendChild(document.createTextNode(' ' + x[0])); nums.appendChild(s); });
    texto($('#painel-valor'), 'Valor dos pedidos, por moeda: ' + porMoeda(m.valorPorMoeda) + ((m.inferidos || m.manuais) ? ' · ' + m.inferidos + ' inferidos · ' + m.manuais + ' manuais fora das métricas' : ''));
    $$('#painel-abas .chip').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-rel') === estado.rel); });
    var chaves = g[estado.rel] || []; var q = estado.buscaFase.toLowerCase();
    var lista = $('#painel-lista'); lista.innerHTML = '';
    var itens = d.registros.filter(function (r) { return chaves.indexOf(r.chave) >= 0; }).filter(function (r) { return !q || [r.pedidoNumero, r.produto, r.motivo, r.lojaNome].filter(Boolean).join(' ').toLowerCase().indexOf(q) >= 0; });
    if (!itens.length) lista.appendChild(el('div', 'muted', 'Nenhum pedido.'));
    itens.forEach(function (r) {
      var it = el('div', 'item'); var l1 = el('div', 'l'); l1.appendChild(el('b', '', r.pedidoNumero ? '#' + r.pedidoNumero : 'sem pedido')); l1.appendChild(el('span', 'muted', r.pedidoValor != null ? dinheiro(r.pedidoValor, r.moeda) : '')); it.appendChild(l1);
      it.appendChild(el('div', 'muted', [r.produto, r.lojaNome].filter(Boolean).join(' · ')));
      it.appendChild(el('div', 'muted', r.motivo + ' · estágio: ' + r.faseTitulo + (r.concluido ? ' · ' + (NOME_DESFECHO[r.desfecho] || r.desfecho) + (r.percentual != null ? ' ' + r.percentual + '%' : '') : '')));
      it.appendChild(el('div', 'mini', 'origem: ' + r.origem + (r.inferidaPor === 'ia' ? ' (IA)' : r.inferidaPor === 'relatorio' ? ' (relatório)' : '') + (r.conversas > 1 ? ' · ' + r.conversas + ' conversas' : '')));
      lista.appendChild(it);
    });
  }
  $$('#filtros select').forEach(function (s) { s.addEventListener('change', function () { if (s.id === 'f-jornada') $('#f-fase').value = 'todas'; carregar(); }); });
  var t; $('#f-busca').addEventListener('input', function () { clearTimeout(t); t = setTimeout(carregar, 300); });
  $$('[data-aba]').forEach(function (b) { b.addEventListener('click', function () {
    estado.aba = b.getAttribute('data-aba'); $$('[data-aba]').forEach(function (x) { x.classList.toggle('on', x === b); });
    $('#mapa').classList.toggle('oculto', estado.aba !== 'mapa'); $('#pedidos').classList.toggle('oculto', estado.aba !== 'pedidos');
  }); });
  $$('.fase[data-fase]').forEach(function (b) { b.addEventListener('click', function () { estado.item = b.getAttribute('data-item'); estado.rel = 'passaram'; estado.buscaFase = ''; $('#painel-busca').value = ''; desenhar(); }); });
  $('#painel-fechar').addEventListener('click', function () { estado.item = null; desenhar(); });
  $$('#painel-abas .chip').forEach(function (b) { b.addEventListener('click', function () { estado.rel = b.getAttribute('data-rel'); desenharPainel(); }); });
  $('#painel-busca').addEventListener('input', function (e) { estado.buscaFase = e.target.value; desenharPainel(); });
  carregar();
  setInterval(carregar, 60000);
})();
</script>
</body>
</html>`
}
