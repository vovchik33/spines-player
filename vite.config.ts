import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // spine-pixi-v8 depends on spine-core; without dedupe, Vite can bundle two copies and
    // `instanceof TextureAtlas` / runtime class checks break across loaders vs app code.
    dedupe: ['@esotericsoftware/spine-core'],
  },
  server: {
    // Native FS events often miss saves under iCloud Documents, Docker mounts, or network drives.
    watch: {
      usePolling: true,
      interval: 150,
    },
    hmr: true,
  },
})
