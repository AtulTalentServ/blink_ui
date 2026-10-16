import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const LOCAL_API = 'http://localhost:8090'
const DEPLOYED_API = 'https://blink-backend-af7x.onrender.com'

function localBackendUp(ms = 250): Promise<boolean> {
  return new Promise((resolve) => {
    // Use localhost (not 127.0.0.1): WSL2 often publishes the API on ::1 only.
    const socket = net.connect({ port: 8090, host: 'localhost' })
    const finish = (up: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(ms)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

function proxyTimeoutMs(url: string | undefined): number {
  const path = url ?? ''
  // Uploads / workspace zip / long agent streams need more than a short JSON probe.
  if (
    path.includes('/requirements/extract') ||
    path.includes('/download') ||
    path.includes('/grooming') ||
    path.includes('/clarify') ||
    path.includes('/plan-product-scope') ||
    path.includes('/confirm-product-scope') ||
    path.includes('/recommend-technology-stack') ||
    path.includes('/architecture-proposal') ||
    path.includes('/confirm-topology') ||
    path.includes('/sdlc-') ||
    path.includes('/classify-work') ||
    path.includes('/create-spec') ||
    path.includes('/technical-plan') ||
    path.includes('/chat') ||
    path.includes('/jira/issues') ||
    path.includes('/integrations/jira')
  ) {
    return 300_000
  }
  return 60_000
}

function forward(base: string, req: IncomingMessage, res: ServerResponse) {
  const dest = new URL(req.url ?? '/', base)
  const lib = dest.protocol === 'https:' ? https : http
  const headers = { ...req.headers, host: dest.host }
  delete headers.connection
  delete headers['x-blink-api-target']
  const upstream = lib.request(
    dest,
    { method: req.method, headers, timeout: proxyTimeoutMs(req.url) },
    (up: IncomingMessage) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (err: Error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(err.message)
    }
  })
  req.pipe(upstream)
}

function apiFallbackProxy(isDesktopDev: boolean): Plugin {
  return {
    name: 'api-fallback-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          next()
          return
        }
        const wantDeployed =
          isDesktopDev && String(req.headers['x-blink-api-target'] ?? '').toLowerCase() === 'deployed'
        if (wantDeployed) {
          forward(DEPLOYED_API, req, res)
          return
        }
        void localBackendUp().then((up) => {
          if (!up) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                message:
                  'Local Blink API is not running on port 8090. In blink-backend run go run ./cmd/server, then try again.',
              }),
            )
            return
          }
          forward(LOCAL_API, req, res)
        })
      })
    },
  }
}

const desktopDev = process.env.BLINK_DESKTOP_DEV === '1'

export default defineConfig({
  plugins: [react(), apiFallbackProxy(desktopDev)],
  server: {
    host: true,
    port: desktopDev ? 5174 : 5173,
    // WebView2 + Vite HMR causes constant main-thread work; desktop uses port 5174 without HMR.
    hmr: desktopDev ? false : undefined,
    watch: desktopDev ? null : undefined,
  },
})
