// Testes visuais permanentes da página externa do pipeline (npm run test:visual).
// Sobe o servidor de ensaio determinístico (test/visual/servidor.mjs) e compara a
// implementação com as capturas de referência em test/visual/capturas, mascarando
// só números e datas dinâmicos; diferença máxima de 0,5% dos pixels.
import { defineConfig } from '@playwright/test'

// Navegador: as capturas de test/visual/capturas foram geradas no Google Chrome
// (canal "chrome"), que é o padrão. PW_CANAL=chromium usa o Chromium empacotado
// do Playwright (as capturas NÃO batem nele — só para diagnóstico).
const canal = process.env.PW_CANAL === 'chromium' ? undefined : (process.env.PW_CANAL || 'chrome')

export default defineConfig({
  testDir: 'test/visual',
  outputDir: 'test/visual/saida/execucao',
  snapshotPathTemplate: '{testDir}/capturas/{arg}{ext}',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.005, animations: 'disabled', caret: 'hide', scale: 'css' } },
  use: { headless: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', deviceScaleFactor: 1, colorScheme: 'dark', viewport: { width: 1280, height: 720 } },
  webServer: { command: 'node test/visual/servidor.mjs', port: 8798, reuseExistingServer: false, timeout: 60_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(canal ? { channel: canal } : {}) } }],
})
