// Testes visuais da página externa "Pipeline completo".
//
// 1) Implementação (Atendo) — capturas de regressão em 1280×720 e 390×844:
//    Entrada geral, Tamanho, Não recebeu, drawer aberto e aba Todos os pedidos.
//    Só números e datas dinâmicos são mascarados; layout, dimensões e
//    componentes precisam bater com as capturas de test/visual/capturas com
//    diferença máxima de 0,5% dos pixels (playwright.config.mjs).
// 2) Referência (site de exemplo) × Atendo — mesmas telas, mesmas dimensões:
//    a estrutura é comparada medida a medida (barra lateral 272px, colunas do
//    fluxo 621/300 com intervalo 16, cartões, métricas 4×68px, drawer 720px…)
//    e o comportamento é exercitado nas duas. As cores são intencionalmente
//    diferentes (identidade do Atendo) e ficam fora da comparação. As capturas
//    lado a lado são gravadas em test/visual/saida/lado-a-lado-*.png.
import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const REFERENCIA = 'https://fluxo-reembolsos.arthur-assisasantos.chatgpt.site/'
const ATENDO = 'http://localhost:8798/p/visual/' + '0123456789abcdef'.repeat(4)
const SAIDA = path.join('test', 'visual', 'saida')
const DESKTOP = { width: 1280, height: 720 }
const CELULAR = { width: 390, height: 844 }
// jornada → índice na barra lateral (a referência e o Atendo têm as mesmas seis, na mesma ordem)
const JORNADAS = { entrada: 0, tamanho: 1, qualidade: 2, defeito: 3, nao_recebido: 4, cancelamento: 5 }

const mascaras = page => [page.locator('[data-num]'), page.locator('[data-date]')]

async function abrir(page, url, viewport = DESKTOP) {
  await page.setViewportSize(viewport)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => /^\d+ pedidos no filtro$/.test(document.getElementById('filterResult')?.textContent || '') && document.querySelectorAll('.nav-item').length === 6)
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}' })
}
async function jornada(page, nome) {
  await page.locator('.nav-item').nth(JORNADAS[nome]).click()
  await page.waitForFunction(k => document.querySelectorAll('.nav-item')[k].classList.contains('active'), JORNADAS[nome])
  await page.evaluate(() => window.scrollTo(0, 0))
}
async function abrirDrawer(page, indice = 1) {
  await page.locator('.stage:visible').nth(indice).click()
  await expect(page.locator('#drawer')).toHaveClass(/open/)
  await page.waitForTimeout(350)
}
async function abaPedidos(page) {
  await page.locator('.view-button[data-view="orders"]').click()
  await expect(page.locator('#ordersView')).toHaveClass(/active/)
}
const caixa = async (page, seletor) => { const b = await page.locator(seletor).first().boundingBox(); if (!b) throw new Error('sem caixa: ' + seletor); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
const estilo = (page, seletor, prop) => page.locator(seletor).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

/** Medidas estruturais comparáveis entre referência e Atendo (independem de cor). */
async function medidas(page) {
  const m = {}
  m.sidebar = await caixa(page, '.sidebar'); m.main = await caixa(page, '.main'); m.topbar = await caixa(page, '.topbar')
  m.toolbar = await caixa(page, '.toolbar'); m.toolbarSticky = await estilo(page, '.toolbar', 'position'); m.controle = await caixa(page, '.toolbar .control')
  m.notice = await caixa(page, '.notice'); m.kpis = await page.locator('.kpis .kpi').count(); m.kpi = await caixa(page, '.kpis .kpi')
  m.strip = await page.locator('.pipeline-strip .pipe-stat').count(); m.pipeStat = await caixa(page, '.pipe-stat')
  m.caseBars = await page.locator('.case-bars .case-bar').count(); m.caseMix = await caixa(page, '.case-mix'); m.caseTrack = (await caixa(page, '.case-track')).h
  m.flow = await caixa(page, '.flow-shell > .panel'); m.insight = await caixa(page, '.insight-panel'); m.insightSticky = await estilo(page, '.insight-panel', 'position')
  m.ring = await caixa(page, '.ring'); m.insightRows = await page.locator('.insight-row').count(); m.legenda = await page.locator('.legend div').count()
  m.stage = await caixa(page, '.stage:visible'); m.stageIndex = await caixa(page, '.stage:visible .stage-index'); m.metric = await caixa(page, '.stage:visible .metric')
  m.metricas = await page.locator('.stage:visible').first().locator('.metric').count(); m.linha = await estilo(page, '.stage-list', 'position')
  m.navItem = await caixa(page, '.nav-item'); m.navIcon = await caixa(page, '.nav-icon'); m.nav = await page.locator('.nav-item').count()
  m.canvasVisiveis = await page.locator('.flow-canvas:visible, #flowCanvas:visible').count()
  return m
}
function comparar(ref, impl, tol = 2) {
  const perto = (a, b, nome) => expect(Math.abs(a - b), `${nome}: referência ${a} × Atendo ${b}`).toBeLessThanOrEqual(tol)
  perto(ref.sidebar.w, impl.sidebar.w, 'largura da barra lateral'); perto(ref.main.x, impl.main.x, 'início do conteúdo'); perto(ref.main.w, impl.main.w, 'largura do conteúdo')
  perto(ref.toolbar.x, impl.toolbar.x, 'x da barra de filtros'); perto(ref.toolbar.w, impl.toolbar.w, 'largura da barra de filtros'); perto(ref.toolbar.h, impl.toolbar.h, 'altura da barra de filtros'); perto(ref.controle.h, impl.controle.h, 'altura dos controles')
  expect(impl.toolbarSticky).toBe(ref.toolbarSticky); expect(impl.insightSticky).toBe(ref.insightSticky)
  expect(impl.kpis).toBe(ref.kpis); perto(ref.kpi.w, impl.kpi.w, 'largura do cartão do funil'); perto(ref.notice.w, impl.notice.w, 'largura do aviso')
  expect(impl.strip).toBe(ref.strip); perto(ref.pipeStat.w, impl.pipeStat.w, 'largura do indicador operacional'); perto(ref.pipeStat.h, impl.pipeStat.h, 'altura do indicador operacional')
  expect(impl.caseBars).toBe(ref.caseBars); perto(ref.caseMix.w, impl.caseMix.w, 'largura do quadro por tipo de caso'); expect(impl.caseTrack).toBe(ref.caseTrack)
  perto(ref.flow.w, impl.flow.w, 'coluna do fluxo'); perto(ref.insight.w, impl.insight.w, 'painel Leitura da jornada'); perto(ref.insight.x - (ref.flow.x + ref.flow.w), impl.insight.x - (impl.flow.x + impl.flow.w), 'intervalo entre fluxo e painel')
  perto(ref.ring.w, impl.ring.w, 'gráfico circular'); expect(impl.insightRows).toBe(ref.insightRows); expect(impl.legenda).toBe(ref.legenda)
  perto(ref.stage.w, impl.stage.w, 'largura do cartão da etapa'); expect(impl.stageIndex.w).toBe(ref.stageIndex.w); expect(impl.stageIndex.h).toBe(ref.stageIndex.h)
  expect(impl.metricas).toBe(ref.metricas); expect(impl.metric.w).toBe(ref.metric.w); expect(impl.linha).toBe(ref.linha)
  perto(ref.navItem.w, impl.navItem.w, 'item da barra lateral'); expect(impl.navIcon.w).toBe(ref.navIcon.w); expect(impl.nav).toBe(ref.nav)
  expect(impl.canvasVisiveis, 'somente uma jornada visível por vez').toBe(1); expect(ref.canvasVisiveis).toBe(1)
}
async function ladoALado(browser, nome, refPng, implPng) {
  mkdirSync(SAIDA, { recursive: true })
  const pagina = await browser.newPage({ viewport: { width: 2600, height: 900 } })
  const img = b => 'data:image/png;base64,' + b.toString('base64')
  await pagina.setContent(`<body style="margin:0;background:#fff;font:600 14px Inter,Segoe UI,sans-serif;color:#333"><div style="display:flex;gap:20px;padding:12px"><figure style="margin:0"><figcaption style="padding:0 0 6px">Referência — ${nome}</figcaption><img src="${img(refPng)}" style="display:block;border:1px solid #ccc"></figure><figure style="margin:0"><figcaption style="padding:0 0 6px">Atendo — ${nome}</figcaption><img src="${img(implPng)}" style="display:block;border:1px solid #ccc"></figure></div></body>`)
  const composto = await pagina.screenshot({ fullPage: true })
  writeFileSync(path.join(SAIDA, `lado-a-lado-${nome}.png`), composto)
  await pagina.close()
}

test.describe('Atendo — capturas de regressão (números e datas mascarados)', () => {
  test('entrada geral 1280×720', async ({ page }) => { await abrir(page, ATENDO); await expect(page).toHaveScreenshot('atendo-entrada-1280.png', { mask: mascaras(page) }) })
  test('tamanho 1280×720', async ({ page }) => { await abrir(page, ATENDO); await jornada(page, 'tamanho'); await expect(page).toHaveScreenshot('atendo-tamanho-1280.png', { mask: mascaras(page) }) })
  test('não recebeu 1280×720', async ({ page }) => { await abrir(page, ATENDO); await jornada(page, 'nao_recebido'); await expect(page).toHaveScreenshot('atendo-nao-recebido-1280.png', { mask: mascaras(page) }) })
  test('drawer aberto 1280×720', async ({ page }) => { await abrir(page, ATENDO); await jornada(page, 'tamanho'); await abrirDrawer(page); await expect(page).toHaveScreenshot('atendo-drawer-1280.png', { mask: mascaras(page) }) })
  test('aba Todos os pedidos 1280×720', async ({ page }) => { await abrir(page, ATENDO); await abaPedidos(page); await expect(page).toHaveScreenshot('atendo-pedidos-1280.png', { mask: mascaras(page) }) })
  test('entrada geral 390×844 (celular)', async ({ page }) => {
    await abrir(page, ATENDO, CELULAR)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal').toBe(true)
    await expect(page).toHaveScreenshot('atendo-entrada-390.png', { mask: mascaras(page) })
  })
  test('drawer no celular ocupa a tela; painel de leitura abaixo do fluxo', async ({ page }) => {
    await abrir(page, ATENDO, CELULAR); await jornada(page, 'tamanho')
    const fluxo = await caixa(page, '.flow-shell > .panel'); const leitura = await caixa(page, '.insight-panel')
    expect(leitura.y).toBeGreaterThan(fluxo.y + fluxo.h - 1); expect(fluxo.w).toBe(leitura.w)
    await abrirDrawer(page); expect((await caixa(page, '#drawer')).w).toBe(390)
    await expect(page).toHaveScreenshot('atendo-drawer-390.png', { mask: mascaras(page) })
  })
})

test.describe('Referência × Atendo — estrutura, dimensões e comportamento', () => {
  test.describe.configure({ mode: 'serial' })
  let ref, impl
  test.beforeAll(async ({ browser }) => {
    ref = await browser.newPage({ viewport: DESKTOP }); impl = await browser.newPage({ viewport: DESKTOP })
    try { await abrir(ref, REFERENCIA) } catch (e) { throw new Error('referência inacessível (' + REFERENCIA + '): ' + e.message) }
    await abrir(impl, ATENDO)
  })
  test.afterAll(async () => { await ref?.close(); await impl?.close() })

  for (const nome of ['entrada', 'tamanho', 'nao_recebido']) {
    test(`jornada ${nome}: mesma estrutura e medidas`, async ({ browser }) => {
      await jornada(ref, nome); await jornada(impl, nome)
      comparar(await medidas(ref), await medidas(impl))
      // grupos com título em caixa alta e cartões clicáveis dentro de uma lista com a linha vertical
      expect(await estilo(impl, '.group-title', 'textTransform')).toBe(await estilo(ref, '.group-title', 'textTransform'))
      expect(await impl.locator('.stage:visible').count()).toBeGreaterThan(0)
      await ladoALado(browser, nome, await ref.screenshot(), await impl.screenshot())
    })
  }
  test('drawer: 720px, quatro métricas, busca, seletor "Ver" e lista de pedidos', async ({ browser }) => {
    await jornada(ref, 'tamanho'); await jornada(impl, 'tamanho')
    await abrirDrawer(ref, 1); await abrirDrawer(impl, 1)
    const dr = await caixa(ref, '#drawer'), di = await caixa(impl, '#drawer')
    expect(di.w).toBe(dr.w); expect(di.w).toBe(720); expect(di.x).toBe(dr.x); expect(di.h).toBe(dr.h)
    expect(await impl.locator('.drawer-stat').count()).toBe(await ref.locator('.drawer-stat').count())
    expect(await impl.locator('#drawerSearch').isVisible()).toBe(true); expect(await impl.locator('#showMode').textContent()).toBe(await ref.locator('#showMode').textContent())
    expect(await estilo(impl, '.backdrop', 'backdropFilter')).toBe(await estilo(ref, '.backdrop', 'backdropFilter'))
    expect(await impl.locator('.order-card').count()).toBeGreaterThan(0); expect(await impl.locator('.phase-select select').count()).toBeGreaterThan(0)
    await ladoALado(browser, 'drawer', await ref.screenshot(), await impl.screenshot())
    await impl.keyboard.press('Escape'); await expect(impl.locator('#drawer')).not.toHaveClass(/open/)
    await ref.keyboard.press('Escape'); await expect(ref.locator('#drawer')).not.toHaveClass(/open/)
  })
  test('aba Todos os pedidos: mesma tabela (9 colunas, cabeçalho fixo) e mesmo painel', async ({ browser }) => {
    await abaPedidos(ref); await abaPedidos(impl)
    expect(await impl.locator('thead th').count()).toBe(await ref.locator('thead th').count()); expect(await impl.locator('thead th').count()).toBe(9)
    expect(await estilo(impl, 'thead th', 'position')).toBe(await estilo(ref, 'thead th', 'position'))
    expect(await impl.locator('tbody tr').count()).toBeGreaterThan(0)
    const pr = await caixa(ref, '.orders-panel'), pi = await caixa(impl, '.orders-panel'); expect(Math.abs(pr.w - pi.w)).toBeLessThanOrEqual(2); expect(Math.abs(pr.x - pi.x)).toBeLessThanOrEqual(2)
    await ladoALado(browser, 'pedidos', await ref.screenshot(), await impl.screenshot())
    await ref.locator('.view-button[data-view="flow"]').click(); await impl.locator('.view-button[data-view="flow"]').click()
  })
  test('comportamento: filtros reagem, barra de filtros fica fixa ao rolar, "Limpar ajustes" só limpa o navegador', async () => {
    await jornada(impl, 'tamanho')
    const antes = await impl.locator('#filterResult').textContent()
    await impl.locator('#f-loja').selectOption({ index: 1 }); await impl.waitForFunction(a => document.getElementById('filterResult').textContent !== a, antes)
    await impl.locator('#f-loja').selectOption('todas'); await impl.waitForFunction(a => document.getElementById('filterResult').textContent === a, antes)
    await impl.fill('#f-busca', 'Chino'); await impl.waitForFunction(a => document.getElementById('filterResult').textContent !== a, antes)
    await impl.fill('#f-busca', ''); await impl.waitForFunction(a => document.getElementById('filterResult').textContent === a, antes)
    await impl.evaluate(() => window.scrollTo(0, 600)); await impl.waitForTimeout(100)
    expect((await caixa(impl, '.toolbar')).y).toBe(10)
    await impl.evaluate(() => window.scrollTo(0, 0))
    // ajuste local: muda a fase atribuída no drawer, some da fase antiga, e "Limpar ajustes" desfaz — sem tocar o servidor
    await abrirDrawer(impl, 1)
    const select = impl.locator('.phase-select select').first(); const chave = await select.getAttribute('data-assign'); const original = await select.inputValue()
    await select.selectOption('size-refund-70'); await impl.waitForTimeout(100)
    expect(await impl.evaluate(() => JSON.parse(localStorage.getItem('atendo-pipeline-ajustes') || '{}'))).toHaveProperty(chave, 'size-refund-70')
    await impl.keyboard.press('Escape')
    await impl.locator('#resetAssignments').click()
    expect(await impl.evaluate(() => localStorage.getItem('atendo-pipeline-ajustes'))).toBeNull()
    await abrirDrawer(impl, 1); expect(await impl.locator('.phase-select select').first().inputValue()).toBe(original); await impl.keyboard.press('Escape')
  })
})
