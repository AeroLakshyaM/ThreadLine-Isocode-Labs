import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'Threadline Production Workspace',
        short_name: 'Threadline',
        description: 'Production visibility for every order, stage and line.',
        theme_color: '#f8f8f6',
        background_color: '#f8f8f6',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/threadline-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] }
    })
  ]
})
