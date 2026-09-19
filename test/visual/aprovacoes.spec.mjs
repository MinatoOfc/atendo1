// Aprovações e a tela da conversa, no NAVEGADOR de verdade: as duas usam a
// MESMA fotografia de aprovação que a Auditoria — a que o servidor calculou e
// mandou em /api/state. Nenhum envio real acontece: o ensaio não tem caixa de
// e-mail configurada, então o servidor recusa no canal DEPOIS de aceitar a
// fotografia. É essa diferença (400 do canal x 409 de tela velha) que prova
// que a página passou pela reconferência.
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:8798'
const DESKTOP = { width: 1280, height: 900 }
// as dez chaves que o servidor exige de volta (server/index.js: fotografiaDaAprovacao)
const CHAVES = ['workspaceId', 'lojaId', 'ticketId', 'mensagemEm', 'cicloId', 'tentativaId', 'fase', 'rascunhoHash', 'validado', 'versao']

async function entrar(page, rota, viewport = DESKTOP) {
  await page.setViewportSize(viewport)
  await page.goto(BASE + '/api/state', { waitUntil: 'domcontentloaded' })
  const r = await page.request.post(BASE + '/api/login', { data: { email: 'ensaio@teste.local', senha: 'senha-ensaio-1234' } })
  expect(r.ok(), 'login do ensaio').toBeTruthy()
  await page.goto(BASE + '/#' + rota, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
}

/** a fotografia que o SERVIDOR publica para esta conversa */
async function fotoDoServidor(page, id) {
  const st = await page.request.get(BASE + '/api/state').then(r => r.json())
  return st.state.tickets.find(t => t.id === id)?.aprovacao
}

test.describe('Fotografia da aprovação nas três telas', () => {
  test('a página Aprovações manda a fotografia inteira no clique de enviar', async ({ page }) => {
    await entrar(page, '/aprovacoes')
    await expect(page.getByText('Felipe Aguardando').first()).toBeVisible()

    const foto = await fotoDoServidor(page, 'aud-espera')
    expect(foto, 'o servidor publica a fotografia em /api/state').toBeTruthy()
    for (const k of CHAVES) expect(foto, 'a fotografia tem ' + k).toHaveProperty(k)

    // abre a conversa de Felipe (aguardando aprovação, rascunho validado)
    await page.getByText('Felipe Aguardando').first().click()

    let corpo = null
    await page.route('**/api/tickets/aud-espera/aprovar', async rota => {
      corpo = JSON.parse(rota.request().postData() ?? '{}')
      await rota.abort()
    })
    await page.getByRole('button', { name: /^Aprovar e enviar/ }).first().click()
    await expect.poll(() => corpo, { timeout: 10_000 }).not.toBeNull()

    expect(corpo.esperado, 'a página mandou a fotografia').toBeTruthy()
    for (const k of CHAVES) {
      expect(corpo.esperado[k], 'a fotografia da tela bate com a do servidor em ' + k).toEqual(foto[k])
    }
  })

  test('a tela da conversa manda a MESMA fotografia, e o servidor a aceita', async ({ page }) => {
    await entrar(page, '/aprovacoes')
    const foto = await fotoDoServidor(page, 'aud-espera')
    await page.getByText('Felipe Aguardando').first().click()

    // sem interceptar: o pedido chega ao servidor de verdade. O ensaio não tem
    // caixa de e-mail, então a recusa é do CANAL (400) — e só se chega até ela
    // DEPOIS de a fotografia ser aceita. Uma tela sem fotografia levaria 409.
    const [resposta] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/aud-espera/aprovar')),
      page.getByRole('button', { name: /^Aprovar e enviar/ }).first().click(),
    ])
    const json = await resposta.json()
    expect(resposta.status(), 'motivo: ' + (json.erro ?? '')).toBe(400)
    expect(json.erro).toMatch(/caixa de e-mail/)
    expect(json.semFotografia ?? false, 'a fotografia foi aceita').toBe(false)
    expect(json.desatualizado ?? false, 'e não estava velha').toBe(false)

    // nada mudou na conversa: continua esperando aprovação
    const depois = await fotoDoServidor(page, 'aud-espera')
    expect(depois).toEqual(foto)
  })

  test('a Auditoria manda a mesma fotografia pelo modal "Revisar e enviar"', async ({ page }) => {
    await entrar(page, '/auditoria')
    await page.waitForSelector('.auditoria-grade', { timeout: 15_000 })
    const foto = await fotoDoServidor(page, 'aud-espera')

    await page.locator('.item-auditoria').filter({ hasText: 'Felipe Aguardando' }).click()
    await page.locator('[data-revisar="abrir"]').click()
    await expect(page.locator('.modal-revisao')).toBeVisible()

    const [resposta] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/aud-espera/aprovar')),
      page.locator('.modal-revisao').getByRole('button', { name: 'Confirmar envio' }).click(),
    ])
    const json = await resposta.json()
    expect(resposta.status(), 'motivo: ' + (json.erro ?? '')).toBe(400)
    expect(json.erro).toMatch(/caixa de e-mail/)
    expect(json.semFotografia ?? false).toBe(false)
    // o motivo aparece no próprio modal, sem alert
    await expect(page.locator('.modal-revisao')).toContainText('caixa de e-mail')
    expect(await fotoDoServidor(page, 'aud-espera')).toEqual(foto)
  })

  test('tela velha é recusada de verdade: fotografia de outra conversa não envia', async ({ page }) => {
    await entrar(page, '/aprovacoes')
    const outra = await fotoDoServidor(page, 'aud-aprovacao')
    // a tela manda a fotografia de OUTRA conversa: o servidor recusa antes de tudo
    const r = await page.request.post(BASE + '/api/tickets/aud-espera/aprovar', {
      data: { texto: 'Hallo!', origem: 'ia', esperado: outra },
    })
    expect(r.status()).toBe(409)
    const json = await r.json()
    expect(json.desatualizado).toBe(true)
    // e sem fotografia nenhuma, também
    const sem = await page.request.post(BASE + '/api/tickets/aud-espera/aprovar', {
      data: { texto: 'Hallo!', origem: 'ia' },
    })
    expect(sem.status()).toBe(409)
    expect((await sem.json()).semFotografia).toBe(true)
  })
})
