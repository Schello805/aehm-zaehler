import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execSync } from 'child_process'

let gitRev = 'dev'
try {
  gitRev = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  gitRev = 'latest'
}

const buildDate = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_REVISION__: JSON.stringify(gitRev),
    __BUILD_TIME__: JSON.stringify(buildDate),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/verify-delete-password': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
