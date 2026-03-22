import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev-only: always hard-refresh the browser when source files change (no HMR patch). */
function fullReloadOnChange(): Plugin {
  return {
    name: 'full-reload-on-change',
    apply: 'serve',
    handleHotUpdate({ server }) {
      server.ws.send({ type: 'full-reload' })
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), fullReloadOnChange()],
  server: {
    // Native FS events often miss saves under iCloud Documents, Docker mounts, or network drives.
    watch: {
      usePolling: true,
      interval: 150,
    },
    hmr: true,
  },
})
