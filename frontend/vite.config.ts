import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Backend-Port als Single Source of Truth aus der Root-.env (PORT, Default 3000).
  // Identisch zum Backend (src/index.ts liest process.env.PORT). Explizite
  // Prozess-Umgebung (z. B. vom Start-Skript gesetzt) hat Vorrang vor .env,
  // damit scripts/start.mjs den Proxy auf den tatsächlich gebundenen Port
  // richten kann (Port-Fallback im Backend). Target explizit als 127.0.0.1,
  // damit der Proxy nicht in die IPv4/IPv6-Auflösung von "localhost" läuft.
  // Vite-Warnung vermeiden: import.meta.dirname statt __dirname (configLoader
  // 'native' wird Default). Verzeichnis dieser Datei = frontend/.
  const here = import.meta.dirname
  const env = loadEnv(mode, path.resolve(here, '..'), '')
  const backendPort = process.env.PORT ?? env.PORT ?? '3000'
  const backendTarget = `http://127.0.0.1:${backendPort}`

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(here, "./src"),
      },
    },
    server: {
      // Auf IPv4 binden (0.0.0.0) statt nur [::1] (Vite-Default "localhost" kann
      // je nach OS/DNS nur IPv6 ergeben) — sonst: ERR_CONNECTION_REFUSED auf
      // http://localhost:5173 im Browser.
      host: '0.0.0.0',
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/events': { target: backendTarget, changeOrigin: true },
      },
    },
  }
})
