// Gera os PNGs do PWA a partir de public/icone.svg (rodar uma vez: node scripts/gerar-icones.mjs)
import fs from 'fs'
import { Resvg } from '@resvg/resvg-js'

const svg = fs.readFileSync('public/icone.svg', 'utf8')
const tamanhos = [
  ['public/apple-touch-icon.png', 180],
  ['public/icone-192.png', 192],
  ['public/icone-512.png', 512],
]
for (const [arquivo, tam] of tamanhos) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: tam },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  })
  fs.writeFileSync(arquivo, r.render().asPng())
  console.log(arquivo, tam + 'px ok')
}
