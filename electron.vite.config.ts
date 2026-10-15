import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        // main app + the transparent desktop-pet window
        input: { index: resolve(__dirname, 'src/renderer/index.html'), pet: resolve(__dirname, 'src/renderer/pet.html'), captions: resolve(__dirname, 'src/renderer/captions.html') }
      }
    }
  }
})
