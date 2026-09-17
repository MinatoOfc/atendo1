// Relatório diário externo (/r/:wsId/:token): mesma linguagem visual do Pipeline
// completo. Capturas de regressão em 1280×720 e 390×844 (números e datas
// mascarados), estrutura comparada com a do Pipeline, checkbox de processado
// real, escape de texto malicioso, fallback de imagem e privacidade do Pipeline.
// As imagens das fixtures são data: — nada depende da internet.
import { test, expect } from '@playwright/test'
import path from 'node:path'

const TOKEN_REL = 'fedcba9876543210'.repeat(2)
const RELATORIO = 'http://localhost:8798/r/visual/' + TOKEN_REL
const PIPELINE = 'http://localhost:8798/p/visual/' + '0123456789abcdef'.repeat(4)
const DESKTOP = { width: 1280, height: 720 }
const CELULAR = { width: 390, height: 844 }
const mascaras = page => [page.locator('[data-num]'), page.locator('[data-date]'), page.locator('.valores'), page.locator('.kpi strong'), page.locator('[data-atualizado]'), page.locator('.dia-cab .mini'), page.locator('.situacao .mini')]

async function abrir(page, url, viewport = DESKTOP) {
  await page.setViewportSize(viewport)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
}
const caixa = async (page, seletor) => { const b = await page.locator(seletor).first().boundingBox(); if (!b) throw new Error('sem caixa: ' + seletor); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
const estilo = (page, seletor, prop) => page.locator(seletor).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

test.describe('Relatório diário externo', () => {
  test('desktop: mesma linguagem visual do Pipeline (barra lateral 272px, cabeçalho, indicadores, filtros fixos) e dados completos do caso', async ({ page, browser }) => {
    await abrir(page, RELATORIO)
    // estrutura equivalente à do Pipeline completo
    const pipe = await browser.newPage({ viewport: DESKTOP })
    await abrir(pipe, PIPELINE)
    const sidebarRel = await caixa(page, '.sidebar'); const sidebarPipe = await caixa(pipe, '.sidebar')
    expect(sidebarRel.w).toBe(sidebarPipe.w)
    expect((await caixa(page, '.main')).x).toBe((await caixa(pipe, '.main')).x)
    expect(await estilo(page, '.toolbar', 'position')).toBe(await estilo(pipe, '.toolbar', 'position'))
    expect(await estilo(page, 'body', 'backgroundColor')).toBe(await estilo(pipe, 'body', 'backgroundColor'))
    expect(await estilo(page, '.kpi', 'borderRadius')).toBe(await estilo(pipe, '.kpi', 'borderRadius'))
    await pipe.close()
    // conteúdo obrigatório de um caso
    const primeiro = page.locator('.caso').first()
    await expect(primeiro.locator('.pedido strong')).toContainText('Pedido #')
    await expect(primeiro.locator('.cliente strong')).not.toBeEmpty()
    await expect(primeiro.locator('.cliente .mini')).toContainText('@')
    await expect(primeiro.locator('.marca input')).toBeVisible()
    expect(await page.locator('.kpi').count()).toBe(7)
    // aviso de dados pessoais
    await expect(page.locator('.sidebar-note')).toContainText('dados pessoais')
    await expect(page).toHaveScreenshot('relatorio-desktop-1280.png', { mask: mascaras(page), fullPage: false })
  })

  test('celular: a linha vira cartão, sem rolagem horizontal, com checkbox e situação sempre visíveis', async ({ page }) => {
    await abrir(page, RELATORIO, CELULAR)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal').toBe(true)
    const caso = page.locator('.caso').first()
    await expect(caso.locator('.marca input')).toBeVisible()
    await expect(caso.locator('.situacao .tag')).toBeVisible()
    // no celular o cartão empilha: o cliente fica abaixo do pedido
    const pedido = await caixa(page, '.caso .pedido'); const cliente = await caixa(page, '.caso .cliente')
    expect(cliente.y).toBeGreaterThan(pedido.y)
    await expect(page).toHaveScreenshot('relatorio-celular-390.png', { mask: mascaras(page) })
  })

  test('casos pendentes e processados, reembolso integral e parcial, troca, troca com reembolso, produto sem imagem e duas moedas', async ({ page }) => {
    await abrir(page, RELATORIO)
    const texto = await page.locator('#lista').innerText()
    // tipos presentes nas fixtures
    for (const t of ['Reembolso', 'Troca', 'Reenvio', 'Cupom', 'Cancelamento']) expect(texto).toContain(t)
    expect(await page.locator('.tag.espera').count()).toBeGreaterThan(0)
    expect(await page.locator('.tag.ok').count()).toBeGreaterThan(0)
    // processado NÃO risca nem esconde: o nome continua legível, só a opacidade cai
    const processado = page.locator('.caso.processado').first()
    await expect(processado.locator('.cliente strong')).not.toBeEmpty()
    expect(await processado.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('none')
    expect(Number(await processado.evaluate(el => getComputedStyle(el).opacity))).toBeGreaterThan(0.5)
    // troca com reembolso parcial vira uma etiqueta só: "Troca + reembolso"
    expect(texto).toContain('Troca + reembolso')
    const comReembolso = page.locator('.caso', { hasText: 'Troca + reembolso' })
    expect(await comReembolso.count()).toBeGreaterThan(0)
    await expect(comReembolso.first().locator('.valores .valor')).not.toBeEmpty()
    // valor desconhecido aparece como texto, nunca como zero
    expect(texto).toContain('Valor não registrado')
    expect(texto).not.toMatch(/€ 0,00/)
    // duas moedas: uma linha por moeda, sem soma
    const moedas = await page.locator('.kpi .linha-moeda').allInnerTexts()
    expect(moedas.length).toBeGreaterThan(1)
    expect(moedas.some(m => m.includes('€'))).toBe(true)
    expect(moedas.some(m => m.includes('£'))).toBe(true)
    // imagem do catálogo, fallback de produto e ícone neutro
    expect(await page.locator('.caso .foto').count()).toBeGreaterThan(0)
    expect(await page.locator('.caso .sem-foto').count()).toBeGreaterThan(0)
  })

  test('imagem quebrada cai no ícone de fallback', async ({ page }) => {
    await abrir(page, RELATORIO)
    const trocou = await page.evaluate(() => {
      const img = document.querySelector('.caso .foto')
      if (!img) return 'sem imagem'
      const caixa = img.closest('.foto-caixa')
      img.dispatchEvent(new Event('error'))
      return caixa.querySelector('svg.sem-foto') ? 'icone' : caixa.innerHTML.slice(0, 40)
    })
    expect(trocou).toBe('icone')
  })

  test('detalhes expansíveis mostram produtos, valores e datas sem sair da página', async ({ page }) => {
    await abrir(page, RELATORIO)
    const caso = page.locator('.caso').first()
    await expect(caso.locator('.detalhes')).toBeHidden()
    await caso.locator('.abrir').click()
    await expect(caso.locator('.detalhes')).toBeVisible()
    const det = await caso.locator('.detalhes').innerText()
    for (const rotulo of ['valor do pedido', 'percentual', 'valor reembolsado', 'origem', 'processado em']) expect(det.toLowerCase()).toContain(rotulo)
    await expect(page).toHaveScreenshot('relatorio-detalhes-1280.png', { mask: mascaras(page) })
  })

  test('filtros mudam linhas e indicadores', async ({ page }) => {
    await abrir(page, RELATORIO)
    const antes = await page.locator('.caso').count()
    const totalAntes = await page.locator('.kpi strong').first().innerText()
    await page.locator('#f-situacao').selectOption('processados')
    await page.waitForLoadState('networkidle')
    const depois = await page.locator('.caso').count()
    expect(depois).toBeLessThan(antes)
    expect(await page.locator('.kpi strong').first().innerText()).not.toBe(totalAntes)
    expect(await page.locator('.caso:not(.processado)').count()).toBe(0)
    // busca por e-mail
    await page.goto(RELATORIO, { waitUntil: 'networkidle' })
    await page.fill('#f-busca', 'c3001@web.de')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(700)
    await page.waitForLoadState('networkidle')
    expect(await page.locator('.caso').count()).toBeLessThan(antes)
  })

  test('checkbox de processado: salva no servidor, atualiza os números sem recarregar e desfaz', async ({ page }) => {
    await abrir(page, RELATORIO)
    // id fixo: o seletor ":not(.processado)" mudaria de elemento depois da marcação
    const id = await page.locator('.caso:not(.processado)').first().getAttribute('data-caso')
    const caso = page.locator(`.caso[data-caso="${id}"]`)
    const cb = caso.locator('.marca input')
    const processadosAntes = Number(await page.locator('.kpi strong').nth(2).innerText())
    await cb.check()
    await expect(caso).toHaveClass(/processado/)
    await expect(caso.locator('.situacao .tag')).toHaveText('Processado')
    expect(Number(await page.locator('.kpi strong').nth(2).innerText())).toBe(processadosAntes + 1)
    // recarregar confirma que foi salvo no servidor
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator(`.caso[data-caso="${id}"]`)).toHaveClass(/processado/)
    expect(Number(await page.locator('.kpi strong').nth(2).innerText())).toBe(processadosAntes + 1)
    // desfaz e volta ao estado inicial (o servidor é a fonte de verdade)
    await page.locator(`.caso[data-caso="${id}"] .marca input`).uncheck()
    await expect(page.locator(`.caso[data-caso="${id}"]`)).not.toHaveClass(/processado/)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator(`.caso[data-caso="${id}"]`)).not.toHaveClass(/processado/)
    expect(Number(await page.locator('.kpi strong').nth(2).innerText())).toBe(processadosAntes)
  })

  test('erro no servidor restaura o checkbox e mostra o aviso', async ({ page }) => {
    await abrir(page, RELATORIO)
    const id = await page.locator('.caso:not(.processado)').first().getAttribute('data-caso')
    await page.route('**/processar', rota => rota.fulfill({ status: 500, body: '' }))
    const caso = page.locator(`.caso[data-caso="${id}"]`)
    const cb = caso.locator('.marca input')
    // click (e não check): o handler desfaz a marcação quando o servidor recusa
    await cb.click()
    await expect(page.locator('#erro')).toBeVisible()
    await expect(cb).not.toBeChecked()
    await expect(caso).not.toHaveClass(/processado/)
  })

  test('texto malicioso é totalmente escapado e o token inválido dá 404', async ({ page, request }) => {
    await abrir(page, RELATORIO)
    const html = await page.content()
    expect(html).toContain('&lt;img src=x onerror=') // a tag saiu ESCAPADA, como texto
    expect(await page.locator('.caso img[onerror*="__invadido"]').count()).toBe(0)
    expect(await page.locator('.caso script').count()).toBe(0)
    expect(await page.evaluate(() => window.__invadido)).toBeUndefined()
    expect(await page.locator('.solucao .mini', { hasText: 'REEMBOLSO 10%' }).first().innerText()).toContain('<img')
    const ruim = await request.get('http://localhost:8798/r/visual/' + 'f'.repeat(32))
    expect(ruim.status()).toBe(404)
  })

  test('privacidade: o relatório manda no-store e no-referrer; o Pipeline continua SEM dados pessoais', async ({ request }) => {
    const rel = await request.get(RELATORIO)
    expect(rel.headers()['cache-control']).toContain('no-store')
    expect(rel.headers()['referrer-policy']).toBe('no-referrer')
    expect(rel.headers()['x-content-type-options']).toBe('nosniff')
    const htmlRel = await rel.text()
    expect(htmlRel).toContain('c3001@web.de') // o relatório MOSTRA o e-mail do cliente
    // o Pipeline externo não pode ganhar nome nem e-mail
    const pipeHtml = await (await request.get(PIPELINE)).text()
    const pipeJson = await (await request.get(PIPELINE + '/dados')).text()
    for (const proibido of ['c3001@web.de', '@web.de', 'Cliente 3001', 'Ana Souza', 'Hauptstr']) {
      expect(pipeHtml, 'HTML do pipeline sem ' + proibido).not.toContain(proibido)
      expect(pipeJson, 'JSON do pipeline sem ' + proibido).not.toContain(proibido)
    }
  })

  test('relatórios antigos: pedido único pela linha, dois pedidos e número citado sem dados na Shopify', async ({ page }) => {
    await abrir(page, RELATORIO)
    // 1) um pedido, achado pelo número escrito na linha final
    const um = page.locator('.caso[data-caso="r3009"]')
    await expect(um.locator('.pedido strong')).toHaveText('Pedido #3009')
    await expect(um.locator('.pedido .aviso')).toHaveCount(0)
    await expect(um.locator('.cliente strong')).toHaveText('Cliente 3009')
    await expect(um.locator('.foto-caixa img').first()).toBeVisible()
    // 2) dois pedidos: os dois números e os produtos dos dois
    const dois = page.locator('.caso[data-caso="r3010"]')
    await expect(dois.locator('.pedido strong')).toHaveText('Pedidos #3010 e #3011')
    await expect(dois.locator('.pedido .mini').last()).toContainText('+1')
    await dois.locator('.abrir').click()
    const detalhes = await dois.locator('.detalhes').innerText()
    expect(detalhes).toContain('Polo Premium')
    expect(detalhes).toContain('Hemd Classic')
    expect(detalhes).toContain('#3010')
    expect(detalhes).toContain('#3011')
    // nada de somar os totais dos dois pedidos
    await expect(dois.locator('.valores .mini')).toHaveText('valor do pedido desconhecido')
    // 3) número citado que não existe na Shopify: o número continua visível, com aviso
    const citado = page.locator('.caso[data-caso="r3012"]')
    await expect(citado.locator('.pedido strong')).toHaveText('Pedido #8888')
    await expect(citado.locator('.pedido .aviso')).toContainText('dados não encontrados na Shopify')
    // troca pura não tem valor de reembolso; o que não pode é inventar total de pedido
    await expect(citado.locator('.valores .mini')).toHaveText('valor do pedido desconhecido')
    // nenhum caso mostra mais "Sem pedido localizado"
    expect(await page.locator('#lista').innerText()).not.toContain('Sem pedido localizado')
    await expect(page).toHaveScreenshot('relatorio-antigos-1280.png', { mask: mascaras(page) })
  })

  test('celular: os casos antigos também cabem na tela, sem rolagem horizontal', async ({ page }) => {
    await abrir(page, RELATORIO, CELULAR)
    await page.locator('.caso[data-caso="r3010"]').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal').toBe(true)
    const dois = page.locator('.caso[data-caso="r3010"]')
    await expect(dois.locator('.pedido strong')).toHaveText('Pedidos #3010 e #3011')
    const caixaCaso = await dois.boundingBox()
    expect(Math.round(caixaCaso.width)).toBeLessThanOrEqual(390)
  })

  test('"PEDIU DUAS VEZES ... 3085 E 3086" vira "Pedidos #3085 e #3086" no desktop e no celular', async ({ page }) => {
    await abrir(page, RELATORIO)
    const angela = page.locator('.caso[data-caso="r3085"]')
    await expect(angela.locator('.pedido strong')).toHaveText('Pedidos #3085 e #3086')
    await expect(angela.locator('.pedido .aviso')).toHaveCount(0)
    await expect(angela.locator('.cliente strong')).toHaveText('Angela Ruiz')
    // os produtos dos dois pedidos, com miniatura, e nenhuma soma de valores
    await expect(angela.locator('.pedido .mini').last()).toContainText('+1')
    await expect(angela.locator('.valores .mini')).toHaveText('valor do pedido desconhecido')
    await angela.locator('.abrir').click()
    const detalhes = await angela.locator('.detalhes').innerText()
    expect(detalhes).toContain('Polo Premium')
    expect(detalhes).toContain('Chino Slim')
    expect(detalhes).toContain('#3085')
    expect(detalhes).toContain('#3086')
    // a página externa continua só de leitura: nenhuma ação de vínculo por lá
    const html = await page.content()
    expect(html).not.toMatch(/vincular pedido/i)
    expect(html).not.toContain('<form')
    // celular: mesmo texto, sem rolagem horizontal
    await abrir(page, RELATORIO, CELULAR)
    await page.locator('.caso[data-caso="r3085"]').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal').toBe(true)
    await expect(page.locator('.caso[data-caso="r3085"] .pedido strong')).toHaveText('Pedidos #3085 e #3086')
  })
})
