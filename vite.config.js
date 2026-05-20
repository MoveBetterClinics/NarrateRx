import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveBuildSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  // ES-format workers so we can use dynamic `import()` inside the worker
  // body. Default is IIFE which rejects code splits. Needed by
  // src/lib/heicWorker.js — it polyfills `self.window = self` before
  // heic2any module-init runs (heic2any writes to window.libheif at top
  // level), and a static import would be hoisted ahead of the polyfill.
  worker: {
    format: 'es',
  },
  test: {
    exclude: ['tests/e2e/**', '.claude/**', 'node_modules/**'],
  },
})
