// Página interna "Auditoria da IA" (/auditoria): exige login, mostra a conversa
// correta, a bloqueada e a que aguarda aprovação, e no celular vira abas sem
// rolagem horizontal. A página só observa: nada aqui muda o atendimento.
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:8798'
const DESKTOP = { width: 1280, height: 720 }
const CELULAR = { width: 390, height: 844 }

async function entrar(page, viewport = DESKTOP) {
  await page.setViewportSize(viewport)
  await page.goto(BASE + '/api/state', { waitUntil: 'domcontentloaded' })
  const r = await page.request.post(BASE + '/api/login', {
    data: { email: 'ensaio@teste.local', senha: 'senha-ensaio-1234' },
  })
  expect(r.ok(), 'login do ensaio').toBeTruthy()
  await page.goto(BASE + '/#/auditoria', { waitUntil: 'networkidle' })
  await page.waitForSelector('.auditoria-grade', { timeout: 15_000 })
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
}

test.describe('Auditoria da IA', () => {
  test('exige login: sem sessão a API não devolve nada', async ({ request }) => {
    const r = await request.get(BASE + '/api/auditoria')
    expect(r.status()).toBe(401)
  })

  test('desktop: lista, conversa e painel, com conversa correta, bloqueada e aguardando', async ({ page }) => {
    await entrar(page)
    await expect(page.locator('h1')).toHaveText('Auditoria da IA')
    await expect(page.getByText('Acompanhe o que o cliente escreveu')).toBeVisible()
    // a lista traz as três conversas do ensaio
    const lista = page.locator('.item-auditoria')
    await expect(lista.filter({ hasText: 'Ana Correta' })).toHaveCount(1)
    await expect(lista.filter({ hasText: 'Bruno Bloqueado' })).toHaveCount(1)
    await expect(lista.filter({ hasText: 'Carla Aprovação' })).toHaveCount(1)
    await expect(lista.filter({ hasText: 'Diego Corrigido' })).toHaveCount(1)
    // selos
    await expect(lista.filter({ hasText: 'Ana Correta' })).toContainText('Tudo certo')
    await expect(lista.filter({ hasText: 'Bruno Bloqueado' })).toContainText('Bloqueado')
    await expect(lista.filter({ hasText: 'Carla Aprovação' })).toContainText('Revisar')
    // corrigida depois de um bloqueio: o selo vale pela tentativa ATUAL
    await expect(lista.filter({ hasText: 'Diego Corrigido' })).toContainText('Tudo certo')

    // conversa correta: passos compactos + mensagem enviada + checklist verde
    await lista.filter({ hasText: 'Ana Correta' }).click()
    await expect(page.locator('.passos-auditoria')).toContainText('IA classificou → servidor escolheu a fase')
    await expect(page.locator('.msg-auditoria.sit-enviada').first()).toBeVisible()
    await expect(page.locator('[data-coluna="painel"]')).toContainText('Tudo certo')
    await expect(page.locator('[data-coluna="conversa"]')).toContainText('Tudo certo — enviada e confirmada')
    await expect(page.locator('[data-coluna="painel"]')).toContainText('Cupom correto e verificado na Shopify')
    await expect(page.locator('[data-coluna="painel"]')).toContainText('Próxima fase permitida pelo mapa')
    await expect(page).toHaveScreenshot('auditoria-correta-1280.png', { mask: [page.locator('.muted-sm').filter({ hasText: 'Atualizado' })] })

    // conversa bloqueada: o rascunho aparece, mas marcado como NÃO enviado
    await lista.filter({ hasText: 'Bruno Bloqueado' }).click()
    const bloqueada = page.locator('.msg-auditoria.sit-bloqueada')
    await expect(bloqueada).toHaveCount(1)
    await expect(bloqueada).toContainText('não enviada ao cliente')
    await expect(page.locator('.msg-auditoria.sit-enviada')).toHaveCount(0)
    await expect(page.locator('[data-coluna="painel"]')).toContainText('Bloqueado — não foi enviado')
    await expect(page).toHaveScreenshot('auditoria-bloqueada-1280.png', { mask: [page.locator('.muted-sm').filter({ hasText: 'Atualizado' })] })

    // aguardando aprovação: rascunho, nunca enviado
    await lista.filter({ hasText: 'Carla Aprovação' }).click()
    const pendente = page.locator('.msg-auditoria.sit-rascunho, .msg-auditoria.sit-agendada')
    await expect(pendente.first()).toBeVisible()
    await expect(pendente.first()).toContainText('não enviado')
    // esta conversa tem um item amarelo (foto não validada): o selo é Revisar,
    // e em nenhuma hipótese aparece como enviada ou concluída
    await expect(page.locator('[data-coluna="conversa"]')).toContainText('Revisar')
    await expect(page.locator('[data-coluna="conversa"]')).not.toContainText('Tudo certo')
    await expect(page.locator('[data-coluna="painel"]')).toContainText('Revisar')
    await expect(page).toHaveScreenshot('auditoria-aprovacao-1280.png', { mask: [page.locator('.muted-sm').filter({ hasText: 'Atualizado' })] })
  })

  test('filtros: somente com erro e somente aguardando aprovação', async ({ page }) => {
    await entrar(page)
    await page.getByText('Somente com erro').click()
    await expect(page.locator('.item-auditoria')).toHaveCount(3) // dois bloqueados + revisar
    await page.getByText('Somente com erro').click()
    await page.getByText('Somente aguardando aprovação').click()
    await expect(page.locator('.item-auditoria').filter({ hasText: 'Ana Correta' })).toHaveCount(0)
  })

  test('filtros dos estados novos: aguardando, agendada e envio automático pela evidência', async ({ page }) => {
    await entrar(page)
    const situacao = page.locator('select').nth(5)
    await situacao.selectOption('aguardando')
    await expect(page.locator('.item-auditoria')).toHaveCount(1)
    await expect(page.locator('.item-auditoria')).toContainText('Felipe Aguardando')
    await situacao.selectOption('agendada')
    await expect(page.locator('.item-auditoria')).toHaveCount(1)
    await expect(page.locator('.item-auditoria')).toContainText('Elena Agendada')
    await situacao.selectOption('todas')
    // "somente enviados automaticamente" olha a EVIDÊNCIA gravada no envio: a
    // conversa aprovada pelo dono NÃO entra, mesmo com a loja em modo automático
    await page.getByText('Somente enviados automaticamente').click()
    await expect(page.locator('.item-auditoria')).toHaveCount(1)
    await expect(page.locator('.item-auditoria')).toContainText('Ana Correta')
  })

  test('tentativa atual bloqueada antes do checklist não mostra o checklist antigo', async ({ page }) => {
    await entrar(page)
    await page.locator('.item-auditoria').filter({ hasText: 'Gabi Duas Respostas' }).click()
    const painel = page.locator('[data-coluna="painel"]')
    await expect(painel).toContainText('Checklist não concluído nesta tentativa')
    await expect(painel).toContainText('cupom de 35% ainda não foi conferido na Shopify')
    await expect(painel).not.toContainText('Cadência respeitada')
    // as duas respostas anteriores continuam na linha do tempo, cada uma no seu evento
    await expect(page.locator('.msg-auditoria.sit-enviada')).toHaveCount(2)
    await expect(painel).toContainText('enviada depois da sua aprovação')
    await expect(page).toHaveScreenshot('auditoria-duas-respostas-1280.png', { mask: [page.locator('.muted-sm').filter({ hasText: 'Atualizado' })] })
  })

  test('celular: lista, conversa e painel viram abas, sem rolagem horizontal', async ({ page }) => {
    await entrar(page, CELULAR)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal').toBe(true)
    await expect(page.locator('.abas-auditoria')).toBeVisible()
    // só uma coluna por vez
    await expect(page.locator('.coluna-auditoria.ativa')).toHaveCount(1)
    await page.locator('.item-auditoria').first().click()
    await expect(page.locator('[data-coluna="conversa"]')).toBeVisible()
    await page.getByRole('button', { name: 'Análise' }).click()
    await expect(page.locator('[data-coluna="painel"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem horizontal no painel').toBe(true)
    await expect(page).toHaveScreenshot('auditoria-celular-390.png', { mask: [page.locator('.muted-sm').filter({ hasText: 'Atualizado' })] })
  })

  test('HTML do e-mail aparece como texto, nunca executado', async ({ page }) => {
    await entrar(page)
    const invadido = await page.evaluate(() => window.__invadido)
    expect(invadido).toBeUndefined()
    expect(await page.locator('.corpo-auditoria script').count()).toBe(0)
  })

  test('bloqueio antigo + correção: o selo vale pela tentativa atual e o bloqueio continua na linha do tempo', async ({ page }) => {
    await entrar(page)
    await page.locator('.item-auditoria').filter({ hasText: 'Diego Corrigido' }).click()
    // a mensagem enviada aparece; o bloqueio antigo continua registrado nos eventos
    await expect(page.locator('.msg-auditoria.sit-enviada')).toHaveCount(1)
    await expect(page.locator('[data-coluna="conversa"]')).toContainText('Tudo certo — enviada e confirmada')
    const passos = await page.locator('.passos-auditoria').innerText()
    expect(passos).not.toContain('bloqueada')
    await expect(page).toHaveScreenshot('auditoria-corrigida-1280.png', { mask: [page.locator('.muted-sm').filter({ hasText: 'Atualizado' })] })
  })
})
