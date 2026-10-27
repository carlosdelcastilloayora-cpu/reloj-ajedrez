import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Genera dist/sw.js con la lista exacta de archivos de esta compilación (para el modo avión).
function serviceWorker(): Plugin {
  return {
    name: 'reloj-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map'))
      const core = ['./', ...files, 'manifest.webmanifest', 'icon.svg']
      const template = readFileSync('sw-template.js', 'utf8')
      // la versión cambia si cambian los archivos de la app o el propio service worker
      const version = createHash('sha256').update(files.sort().join(',') + template).digest('hex').slice(0, 10)
      const source = template
        .replace('__VERSION__', version)
        .replace('__CORE__', JSON.stringify(core))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// base relativa: funciona igual en localhost y en GitHub Pages (https://usuario.github.io/repo/)
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5180 },
})
