import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      watch: { usePolling: env.VITE_USE_POLLING === 'true' },
      proxy: {
        '/api/ws': { target: apiTarget, ws: true },
        '/api': { target: apiTarget },
      },
    },
  }
})
