/**
 * Relatório diário — página externa (/r/:wsId/:token).
 *
 * Mesma linguagem visual do "Pipeline completo" (server/pipeline-externo.js):
 * tokens do tema escuro do Atendo, barra lateral fixa, cabeçalho, indicadores,
 * filtros e cartões. Diferente do pipeline, este link MOSTRA dados pessoais
 * (nome e e-mail do cliente) — por isso avisa disso na própria página e é
 * servido com no-store, no-referrer e nosniff.
 *
 * Todos os números vêm do normalizador único (shared/relatorio.js), calculado no
 * servidor: o navegador só desenha. O checkbox de processado continua usando
 * POST /r/:wsId/:token/processar.
 */
import { ROTULO_TIPO, dinheiro, textoParaCopiar } from '../shared/relatorio.js'

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const dataBr = dia => { const [a, m, d] = String(dia).split('-'); return `${d}/${m}/${a}` }
const quando = iso => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

/** Ícone neutro de produto (sem foto no catálogo) — inline, sem rede. */
const ICONE_PRODUTO = `<svg class="sem-foto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z"/><path d="m3 8.5 9 4.5 9-4.5M12 13v7"/></svg>`

const foto = p => p.imagem
  ? `<img class="foto" src="${escapar(p.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.foto-caixa').innerHTML=this.getAttribute('data-vazio')" data-vazio="${escapar(ICONE_PRODUTO)}">`
  : ICONE_PRODUTO

const etiquetaTipo = tipo => `<span class="tag tipo-${escapar(tipo)}">${escapar(ROTULO_TIPO[tipo] ?? tipo)}</span>`

function cartaoCaso(c) {
  const principal = c.produtos[0]
  const extras = c.produtos.length - 1
  const semDados = c.pedidosSemDados ?? []
  // "Pedido #2614", "Pedidos #2673 e #2695" ou "Sem pedido informado"; quando o
  // número foi escrito mas o pedido não está sincronizado, o aviso vem embaixo
  const tituloPedido = c.pedidoTitulo ?? (c.pedidoNumero ? `Pedido #${c.pedidoNumero}` : 'Sem pedido informado')
  const avisoPedido = !semDados.length ? ''
    : semDados.length === (c.pedidos?.length ?? 0)
      ? `citado${semDados.length > 1 ? 's' : ''} — dados não encontrados na Shopify`
      : `${semDados.map(n => '#' + n).join(', ')} — dados não encontrados na Shopify`
  const valorTexto = c.valor != null ? dinheiro(c.valor, c.moeda) : (c.acoes.includes('reembolso') ? 'Valor não registrado' : '—')
  // troca/reenvio COM reembolso parcial viram uma etiqueta só, como o dono lê
  const envio = c.acoes.find(a => a === 'troca' || a === 'reenvio')
  const acoes = (envio && c.acoes.includes('reembolso'))
    ? `<span class="tag tipo-${escapar(envio)}">${envio === 'troca' ? 'Troca' : 'Reenvio'} + reembolso</span>`
    : c.acoes.map(etiquetaTipo).join('')
  // de onde saiu o pedido — e, quando não saiu, quantos candidatos existem
  const diagnostico = c.rotuloOrigemPedido
    ?? (c.candidatos?.length ? `${c.candidatos.length} pedido(s) candidato(s) — escolha no Atendo` : 'nenhum pedido encontrado')
  return `<article class="caso${c.processado ? ' processado' : ''}" data-caso="${escapar(c.ticketId)}">
    <span class="marca">
      <input type="checkbox" data-id="${escapar(c.ticketId)}"${c.processado ? ' checked' : ''} aria-label="Marcar como processado" title="Marcar como processado">
    </span>
    <div class="foto-caixa">${principal ? foto(principal) : ICONE_PRODUTO}</div>
    <div class="pedido">
      <strong>${escapar(tituloPedido)}</strong>
      ${avisoPedido ? `<span class="mini aviso">${escapar(avisoPedido)}</span>` : ''}
      <span class="mini">${principal ? `${escapar(principal.titulo)}${principal.variante ? ` · ${escapar(principal.variante)}` : ''}${principal.quantidade > 1 ? ` · ${principal.quantidade}x` : ''}` : 'Produto não identificado'}${extras > 0 ? ` <em>+${extras}</em>` : ''}</span>
      <span class="tag loja">${escapar(c.lojaNome)}</span>
    </div>
    <div class="cliente">
      <strong>${escapar(c.clienteNome ?? 'Cliente não identificado')}</strong>
      <span class="mini">${escapar(c.clienteEmail ?? '—')}</span>
    </div>
    <div class="solucao">
      <div class="tags">${acoes}</div>
      <span class="mini">${escapar(c.descricao)}</span>
    </div>
    <div class="valores">
      ${c.percentual != null ? `<strong class="pct">${c.percentual}%</strong>` : ''}
      <strong class="valor${c.valor == null ? ' vazio' : ''}">${escapar(valorTexto)}</strong>
      <span class="mini">${c.valorPedido != null ? `pedido: ${escapar(dinheiro(c.valorPedido, c.moeda))}` : 'valor do pedido desconhecido'}</span>
    </div>
    <div class="situacao">
      <span class="tag ${c.processado ? 'ok' : 'espera'}">${c.processado ? 'Processado' : 'Pendente'}</span>
      <span class="mini">${c.processado && c.processadoEm ? escapar(quando(c.processadoEm)) : ''}</span>
      <span class="mini origem">${c.origem === 'motor_novo_automatico' ? 'conclusão automática' : 'manual'}</span>
    </div>
    <button type="button" class="abrir" aria-expanded="false">detalhes</button>
    <div class="detalhes" hidden>
      <div class="produtos">
        ${c.produtos.length ? c.produtos.map(p => `<div class="prod"><div class="foto-caixa pequena">${foto(p)}</div><div><strong>${escapar(p.titulo)}</strong><span class="mini">${p.variante ? escapar(p.variante) + ' · ' : ''}${p.quantidade}x</span></div></div>`).join('') : '<span class="mini">Nenhum produto identificado para este caso.</span>'}
      </div>
      <dl>
        ${(c.pedidos?.length ?? 0) > 1 ? `<div><dt>Pedidos</dt><dd>${c.pedidos.map(p => `#${escapar(p.numero)}${p.localizado ? (p.valor != null ? ` (${escapar(dinheiro(p.valor, p.moeda))})` : '') : ' (sem dados)'}`).join(' · ')}</dd></div>` : ''}
        <div><dt>Valor do pedido</dt><dd>${c.valorPedido != null ? escapar(dinheiro(c.valorPedido, c.moeda)) : 'não registrado'}</dd></div>
        <div><dt>Percentual</dt><dd>${c.percentual != null ? c.percentual + '%' : '—'}</dd></div>
        <div><dt>Valor reembolsado</dt><dd>${escapar(valorTexto)}</dd></div>
        ${c.cupom ? `<div><dt>Cupom</dt><dd>${escapar(c.cupom)}</dd></div>` : ''}
        <div><dt>Associação</dt><dd>${escapar(diagnostico)}</dd></div>
        <div><dt>Origem</dt><dd>${c.origem === 'motor_novo_automatico' ? 'conclusão automática do motor novo' : 'manual'}${c.faseTitulo ? ` · ${escapar(c.faseTitulo)}` : ''}</dd></div>
        <div><dt>Incluído em</dt><dd>${c.incluidoEm ? escapar(quando(c.incluidoEm)) : '—'}</dd></div>
        <div><dt>Confirmação</dt><dd>${c.confirmadoEm ? escapar(quando(c.confirmadoEm)) : '—'}</dd></div>
        <div><dt>Processado em</dt><dd>${c.processadoEm ? escapar(quando(c.processadoEm)) : '—'}</dd></div>
      </dl>
      <p class="descricao">${escapar(c.descricao)}${c.observacao ? ` — ${escapar(c.observacao)}` : ''}</p>
    </div>
  </article>`
}

function blocoDia({ dia, indicadores, lojas }) {
  const lista = l => (l?.length ? l.map(v => escapar(dinheiro(v.valor, v.moeda))).join(' · ') : '—')
  const valores = lista(indicadores.reembolsadoPorMoeda)
  const previstos = lista(indicadores.previstoPorMoeda)
  return `<section class="dia" data-dia="${escapar(dia)}">
    <header class="dia-cab">
      <div>
        <h2>Relatório ${dataBr(dia)}</h2>
        <p class="mini">${indicadores.total} caso(s) · ${indicadores.pendentes} pendente(s) · ${indicadores.processados} processado(s) · previsto: ${previstos} · reembolsado: ${valores}</p>
      </div>
      <button type="button" class="button copiar-dia" data-dia="${escapar(dia)}">Copiar este dia</button>
    </header>
    ${lojas.map(({ nome, casos }) => `<div class="grupo-loja"><h3>${escapar(nome)}</h3>${casos.map(cartaoCaso).join('')}</div>`).join('')}
  </section>`
}

/** HTML completo do relatório externo. */
export function paginaRelatorio(dados) {
  const { filtros, lojas, indicadores, dias, totalDias, totalCasos } = dados
  const opcao = (v, rotulo, atual) => `<option value="${escapar(v)}"${v === atual ? ' selected' : ''}>${escapar(rotulo)}</option>`
  const diasDisponiveis = [...new Set(dias.map(d => d.dia))]
  const emMoedas = lista => (lista?.length
    ? lista.map(v => `<span class="linha-moeda">${escapar(dinheiro(v.valor, v.moeda))}</span>`).join('')
    : '<span class="linha-moeda vazio">—</span>')
  // dinheiro JÁ devolvido só conta caso processado; o resto é previsão
  const valores = emMoedas(indicadores.reembolsadoPorMoeda)
  const previstos = emMoedas(indicadores.previstoPorMoeda)

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#191919">
<title>Relatórios diários</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  /* tokens do Atendo (tema escuro), iguais aos do Pipeline completo */
  :root{color-scheme:dark;--bg:#191919;--panel:#1f1f1f;--panel-soft:#232323;--hover:#2a2a2a;--border:#2f2f2f;--border-soft:#282828;--text:#d4d4d4;--text-2:#9b9b9b;--text-3:#6f6f6f;--purple:#529cca;--purple-soft:#1d3247;--purple-border:#2c4a66;--grad:linear-gradient(92deg,#2383e2 0%,#2f8ee8 100%);--green:#529e72;--amber:#ca9849;--red:#df5452;--ok-bg:#1f3b2c;--ok-border:#2c5a3f;--warn-bg:#372f1e;--warn-border:#574a28;--danger-bg:#3a2524;--danger-border:#5a3331;--roxo:#9a7acb;--roxo-bg:#2f2743;--roxo-border:#463a63;--azul:#6fa8dc;--azul-bg:#1d3247;--shadow:0 1px 2px rgba(0,0,0,.35),0 4px 16px rgba(0,0,0,.28);--ring:rgba(82,156,202,.18);--radius:18px;--sidebar:272px}
  *{box-sizing:border-box}
  body{margin:0;min-width:320px;background:var(--bg);color:var(--text);font:16px/1.45 Inter,-apple-system,"Segoe UI",sans-serif}
  button,input,select{font:inherit}button,select{color:inherit}button{cursor:pointer}
  button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
  .app{min-height:100vh;display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr)}
  .sidebar{position:sticky;top:0;height:100vh;padding:22px 16px;border-right:1px solid var(--border);background:var(--panel);overflow-y:auto;z-index:5}
  .brand{display:flex;align-items:center;gap:12px;padding:0 7px 22px}
  .mark{width:40px;height:40px;display:grid;place-items:center;border-radius:13px;background:var(--grad);color:#fff;font-weight:800}
  .brand strong{display:block;font-size:1rem;letter-spacing:-.02em}
  .brand span{display:block;color:var(--text-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
  .nav-label{margin:8px 8px 10px;color:var(--text-3);font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;font-weight:800}
  .nav-item{width:100%;display:grid;grid-template-columns:35px 1fr;gap:10px;align-items:center;padding:11px;border:1px solid var(--purple-border);border-radius:13px;background:var(--purple-soft);text-align:left}
  .nav-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:var(--panel-soft);border:1px solid var(--border);color:var(--purple);font-weight:800;font-size:.78rem}
  .nav-copy strong{display:block;font-size:.84rem}.nav-copy span{display:block;color:var(--text-2);font-size:.7rem;margin-top:2px}
  .sidebar-note{margin-top:18px;padding:13px;border:1px solid var(--warn-border);border-radius:13px;background:var(--warn-bg);font-size:.76rem}
  .sidebar-note strong{display:block;margin-bottom:4px}.sidebar-note p{margin:0;color:var(--text-2)}
  .main{min-width:0;padding:24px 28px 50px}
  .topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}
  .title-wrap .eyebrow{margin:0 0 4px;color:var(--purple);font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;font-weight:800}
  .title-wrap h1{margin:0;font-size:clamp(1.55rem,2.4vw,2.25rem);line-height:1.08;letter-spacing:-.045em}
  .title-wrap p{margin:7px 0 0;color:var(--text-2);font-size:.86rem}
  .top-actions{display:flex;gap:9px;align-items:center;flex:0 0 auto}
  .button{border:1px solid var(--border);background:var(--panel);border-radius:11px;padding:9px 13px;color:var(--text);font-size:.84rem;font-weight:600;white-space:nowrap}
  .button:hover{background:var(--hover)}
  .kpis{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin-bottom:16px}
  .kpi{min-width:0;padding:15px;border:1px solid var(--border);border-radius:15px;background:var(--panel);box-shadow:var(--shadow)}
  .kpi>span{display:block;color:var(--text-2);font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:800}
  .kpi strong{display:block;margin-top:9px;font-size:1.45rem;line-height:1;letter-spacing:-.045em;font-variant-numeric:tabular-nums}
  .kpi .linha-moeda{display:block;font-size:1rem;line-height:1.35;letter-spacing:-.02em;font-weight:700;color:var(--amber)}
  .kpi .linha-moeda.vazio{color:var(--text-3)}
  .kpi small{display:block;margin-top:7px;color:var(--text-3);font-size:.7rem}
  .toolbar{position:sticky;top:10px;z-index:4;display:grid;grid-template-columns:minmax(220px,1fr) 160px 150px 150px 150px;gap:9px;margin-bottom:16px;padding:10px;border:1px solid var(--border);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)}
  .control{width:100%;height:42px;border:1px solid var(--border);border-radius:11px;background:var(--panel-soft);padding:0 12px;color:var(--text)}
  .dia{border:1px solid var(--border);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);margin-bottom:16px;overflow:hidden}
  .dia-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 19px;border-bottom:1px solid var(--border)}
  .dia-cab h2{margin:0 0 4px;font-size:1.05rem;letter-spacing:-.02em}
  .grupo-loja{padding:12px 14px}
  .grupo-loja h3{margin:6px 0 10px 4px;color:var(--text-2);font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
  .mini{color:var(--text-2);font-size:.73rem;display:block}
  .mini.aviso{color:var(--amber)}
  .caso{display:grid;grid-template-columns:34px 48px minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.3fr) minmax(0,1fr) 110px auto;gap:12px;align-items:center;padding:11px 12px;margin-bottom:9px;border:1px solid var(--border);border-radius:14px;background:var(--panel-soft)}
  .caso.processado{opacity:.78}
  .caso strong{display:block;font-size:.86rem;overflow:hidden;text-overflow:ellipsis}
  .marca{display:grid;place-items:center}
  .marca input{width:20px;height:20px;accent-color:var(--purple);cursor:pointer}
  .foto-caixa{width:48px;height:48px;display:grid;place-items:center;border-radius:10px;background:var(--panel);border:1px solid var(--border);overflow:hidden;color:var(--text-3)}
  .foto-caixa.pequena{width:38px;height:38px}
  .foto{width:100%;height:100%;object-fit:cover}
  .sem-foto{width:22px;height:22px}
  .tag{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:.68rem;border:1px solid var(--border);background:var(--panel);color:var(--text-2);margin-right:4px}
  .tag.loja{margin-top:4px}
  .tipo-reembolso{background:var(--warn-bg);border-color:var(--warn-border);color:var(--amber)}
  .tipo-cancelamento{background:var(--danger-bg);border-color:var(--danger-border);color:var(--red)}
  .tipo-troca{background:var(--roxo-bg);border-color:var(--roxo-border);color:var(--roxo)}
  .tipo-reenvio{background:var(--azul-bg);border-color:var(--purple-border);color:var(--azul)}
  .tipo-cupom{background:var(--ok-bg);border-color:var(--ok-border);color:var(--green)}
  .tag.ok{background:var(--ok-bg);border-color:var(--ok-border);color:var(--green)}
  .tag.espera{background:var(--warn-bg);border-color:var(--warn-border);color:var(--amber)}
  .valores .pct{color:var(--purple);font-size:.95rem}
  .valores .valor{color:var(--amber);font-size:.95rem;white-space:nowrap}
  .valores .valor.vazio{color:var(--text-3);font-size:.78rem}
  .abrir{border:1px solid var(--border);background:var(--panel);border-radius:9px;padding:6px 9px;color:var(--text-2);font-size:.7rem}
  .detalhes{grid-column:1/-1;margin-top:8px;padding:12px;border-top:1px solid var(--border);display:grid;gap:12px}
  .detalhes[hidden]{display:none}
  .produtos{display:flex;flex-wrap:wrap;gap:12px}
  .prod{display:flex;gap:8px;align-items:center;padding:6px 10px 6px 6px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}
  .detalhes dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0}
  .detalhes dt{color:var(--text-2);font-size:.66rem;text-transform:uppercase;letter-spacing:.06em}
  .detalhes dd{margin:2px 0 0;font-size:.82rem}
  .detalhes .descricao{margin:0;color:var(--text-2);font-size:.8rem}
  .vazio-geral{padding:40px 16px;text-align:center;color:var(--text-2)}
  .aviso-erro{display:none;margin-bottom:12px;padding:10px 13px;border:1px solid var(--danger-border);border-radius:12px;background:var(--danger-bg);color:var(--red);font-size:.8rem}
  .aviso-erro.on{display:block}
  @media(max-width:1120px){.kpis{grid-template-columns:repeat(3,1fr)}.toolbar{grid-template-columns:minmax(200px,1fr) repeat(2,150px)}
    .caso{grid-template-columns:34px 48px minmax(0,1fr) minmax(0,1fr) 110px auto}.cliente{grid-column:3}.solucao{grid-column:4}.valores{grid-column:3/5}}
  @media(max-width:860px){.app{grid-template-columns:1fr}
    .sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--border);padding:14px}
    .nav-label,.sidebar-note p{display:none}.sidebar-note{margin-top:10px;padding:10px}
    .main{padding:20px 16px 42px}.kpis{grid-template-columns:1fr 1fr}.toolbar{position:static;grid-template-columns:1fr 1fr}.search-wrap{grid-column:1/-1}
    .topbar{flex-direction:column}.top-actions{width:100%;justify-content:space-between}
    /* celular: a linha vira cartão; nada de rolagem horizontal */
    .caso{grid-template-columns:34px 48px minmax(0,1fr);grid-auto-rows:auto;align-items:start;gap:10px}
    .pedido{grid-column:3}.cliente,.solucao,.valores,.situacao{grid-column:1/-1}
    .abrir{grid-column:1/-1;justify-self:start}
    .valores{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
    .situacao{display:flex;gap:8px;align-items:center;flex-wrap:wrap}}
  @media(max-width:560px){.main{padding:16px 12px 36px}.kpis{grid-template-columns:1fr}.toolbar{grid-template-columns:1fr}}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark" aria-hidden="true">a</div><div><span>Operação</span><strong>atendo.</strong></div></div>
    <p class="nav-label">Relatório</p>
    <div class="nav-item"><span class="nav-icon">01</span><span class="nav-copy"><strong>Relatórios diários</strong><span data-resumo>${totalDias} dia(s) · ${totalCasos} caso(s)</span></span></div>
    <div class="sidebar-note"><strong>Este link contém dados pessoais</strong><p>Nome e e-mail de clientes aparecem aqui. Não compartilhe publicamente.</p></div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div class="title-wrap">
        <p class="eyebrow">Central operacional</p>
        <h1>Relatórios diários</h1>
        <p>Os casos marcados para o relatório, atualizados em tempo real. <span data-atualizado></span></p>
      </div>
      <div class="top-actions">
        <button type="button" class="button" id="atualizar">Atualizar</button>
        <button type="button" class="button" id="copiar">Copiar relatório do dia</button>
      </div>
    </header>
    <div class="aviso-erro" id="erro"></div>
    <section class="kpis" aria-label="Indicadores do relatório">
      <article class="kpi"><span>Casos</span><strong>${indicadores.total}</strong><small>nos filtros atuais</small></article>
      <article class="kpi"><span>Pendentes</span><strong style="color:var(--amber)">${indicadores.pendentes}</strong><small>aguardando processamento</small></article>
      <article class="kpi"><span>Processados</span><strong style="color:var(--green)">${indicadores.processados}</strong><small>já executados</small></article>
      <article class="kpi"><span>Reembolsos</span><strong>${indicadores.reembolsos}</strong><small>${indicadores.semValor} sem valor registrado</small></article>
      <article class="kpi"><span>Trocas e reenvios</span><strong>${indicadores.trocasReenvios}</strong><small>envio de produto</small></article>
      <article class="kpi"><span>Valor previsto</span><strong>${previstos}</strong><small>pendentes, ainda não devolvidos</small></article>
      <article class="kpi"><span>Valor reembolsado</span><strong>${valores}</strong><small>só processados, por moeda</small></article>
    </section>
    <section class="toolbar" id="filtros" aria-label="Filtros do relatório">
      <div class="search-wrap"><input class="control" id="f-busca" type="search" placeholder="Buscar pedido, cliente, e-mail ou produto…" value="${escapar(filtros.busca)}" aria-label="Buscar"></div>
      <select class="control" id="f-loja" aria-label="Loja">${opcao('todas', 'Todas as lojas', filtros.loja)}${lojas.map(l => opcao(l.id, l.nome, filtros.loja)).join('')}</select>
      <select class="control" id="f-tipo" aria-label="Tipo da solução">${opcao('todos', 'Todos os tipos', filtros.tipo)}${Object.entries(ROTULO_TIPO).map(([v, r]) => opcao(v, r, filtros.tipo)).join('')}</select>
      <select class="control" id="f-situacao" aria-label="Situação">${opcao('todas', 'Todas as situações', filtros.situacao)}${opcao('pendentes', 'Pendentes', filtros.situacao)}${opcao('processados', 'Processados', filtros.situacao)}</select>
      <select class="control" id="f-dia" aria-label="Dia">${opcao('todos', 'Todos os dias', filtros.dia)}${diasDisponiveis.map(d => opcao(d, dataBr(d), filtros.dia)).join('')}</select>
    </section>
    <div id="lista">
      ${dias.length ? dias.map(blocoDia).join('') : '<p class="vazio-geral">Nenhum caso no relatório com estes filtros.</p>'}
    </div>
  </main>
</div>
<textarea id="copia" style="position:fixed;left:-9999px;top:0" aria-hidden="true"></textarea>
<script>
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s) }
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)) }
  var base = location.pathname.replace(/[/]+$/, '')
  var textoCopia = ${JSON.stringify(textoParaCopiar(dias))}
  function marcarAtualizado() { $('[data-atualizado]').textContent = 'Atualizado ' + new Date().toLocaleString('pt-BR') + '.' }
  marcarAtualizado()
  function erro(msg) { var e = $('#erro'); e.textContent = msg || ''; e.classList.toggle('on', !!msg) }

  // filtros: recarregam a página com a querystring (o servidor recalcula tudo)
  function aplicar() {
    var q = new URLSearchParams()
    var b = $('#f-busca').value.trim(); if (b) q.set('busca', b)
    ;['loja', 'tipo', 'situacao', 'dia'].forEach(function (k) {
      var v = $('#f-' + k).value
      if (v && v !== 'todas' && v !== 'todos') q.set(k, v)
    })
    location.search = q.toString()
  }
  $$('#filtros select').forEach(function (s) { s.addEventListener('change', aplicar) })
  var tb; $('#f-busca').addEventListener('input', function () { clearTimeout(tb); tb = setTimeout(aplicar, 450) })
  $('#atualizar').addEventListener('click', function () { location.reload() })

  // copiar (todos os dias visíveis ou um dia só)
  function copiar(txt) {
    var area = $('#copia'); area.value = txt; area.select()
    try { document.execCommand('copy') } catch (e) { /* navegador sem execCommand */ }
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(function () {})
  }
  $('#copiar').addEventListener('click', function () { copiar(textoCopia); this.textContent = 'Copiado!'; var b = this; setTimeout(function () { b.textContent = 'Copiar relatório do dia' }, 1500) })
  $$('.copiar-dia').forEach(function (b) {
    b.addEventListener('click', function () {
      var dia = b.getAttribute('data-dia')
      var blocos = textoCopia.split('\\n\\n\\n').filter(function (p) { return p.indexOf(dia.split('-').reverse().join('/')) >= 0 })
      copiar(blocos.join('\\n\\n\\n') || textoCopia)
      b.textContent = 'Copiado!'; setTimeout(function () { b.textContent = 'Copiar este dia' }, 1500)
    })
  })

  // detalhes expansíveis
  $$('.abrir').forEach(function (b) {
    b.addEventListener('click', function () {
      var caso = b.closest('.caso'); var det = $('.detalhes', caso)
      var aberto = !det.hidden
      det.hidden = aberto; b.setAttribute('aria-expanded', String(!aberto)); b.textContent = aberto ? 'detalhes' : 'fechar'
    })
  })

  // checkbox de processado: desabilita só ele, salva, atualiza os números sem recarregar
  document.addEventListener('change', function (e) {
    var cb = e.target
    if (!cb.matches || !cb.matches('.marca input')) return
    var caso = cb.closest('.caso')
    if (cb.dataset.ocupado === '1') return
    cb.dataset.ocupado = '1'; cb.disabled = true
    erro('')
    fetch(base + '/processar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: cb.getAttribute('data-id'), processado: cb.checked }),
    }).then(function (r) {
      if (!r.ok) throw new Error('falhou')
      caso.classList.toggle('processado', cb.checked)
      var tag = $('.situacao .tag', caso)
      tag.textContent = cb.checked ? 'Processado' : 'Pendente'
      tag.className = 'tag ' + (cb.checked ? 'ok' : 'espera')
      recontar()
      marcarAtualizado()
    }).catch(function () {
      cb.checked = !cb.checked
      erro('Não foi possível salvar. Tente de novo.')
    }).finally(function () { cb.disabled = false; cb.dataset.ocupado = '0' })
  })

  // recalcula os contadores visíveis (o servidor continua sendo a fonte de verdade ao recarregar)
  function recontar() {
    var casos = $$('.caso')
    var proc = casos.filter(function (c) { return c.classList.contains('processado') }).length
    var kpis = $$('.kpi strong')
    if (kpis[1]) kpis[1].textContent = String(casos.length - proc)
    if (kpis[2]) kpis[2].textContent = String(proc)
    $$('.dia').forEach(function (d) {
      var lista = $$('.caso', d)
      var p = lista.filter(function (c) { return c.classList.contains('processado') }).length
      var resumo = $('.dia-cab .mini', d)
      resumo.textContent = resumo.textContent.replace(/\\d+ pendente\\(s\\) · \\d+ processado\\(s\\)/, (lista.length - p) + ' pendente(s) · ' + p + ' processado(s)')
    })
  }
})();
</script>
</body>
</html>`
}
