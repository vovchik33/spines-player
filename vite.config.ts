import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Native FS events often miss saves under iCloud Documents, Docker mounts, or network drives.
    watch: {
      usePolling: true,
      interval: 150,
    },
    hmr: true,
  },
})
