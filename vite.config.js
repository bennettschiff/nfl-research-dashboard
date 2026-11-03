import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { pathToFileURL, fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Dev-only plugin: runs api/*.js handlers so /api/* works without `vercel dev`.
// Not used in the model-only v1 (client reads Supabase directly) but kept ready
// for when we wire the paid Odds API behind a serverless proxy.
function devApiPlugin() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const match = url.pathname.match(/^\/api\/([^/?]+)/)
        if (!match) return next()

        const handlerPath = resolve(__dirname, 'api', `${match[1]}.js`)
        let mod
        try {
          mod = await import(pathToFileURL(handlerPath).href + `?t=${Date.now()}`)
        } catch {
          return next()
        }

        let body = null
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = await new Promise((resolve) => {
            const chunks = []
            req.on('data', c => chunks.push(c))
            req.on('end', () => {
              const raw = Buffer.concat(chunks).toString()
              try { resolve(JSON.parse(raw)) } catch { resolve(raw || null) }
            })
          })
        }

        const mockReq = { method: req.method, query: Object.fromEntries(url.searchParams), body, headers: req.headers }
        let sent = false
        const mockRes = {
          statusCode: 200,
          _headers: {},
          status(code) { this.statusCode = code; return this },
          setHeader(k, v) { this._headers[k] = v; return this },
          json(data) {
            if (sent) return
            sent = true
            const payload = JSON.stringify(data)
            res.writeHead(this.statusCode, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...this._headers })
            res.end(payload)
          },
          end(data) {
            if (sent) return
            sent = true
            res.writeHead(this.statusCode, this._headers)
            res.end(data)
          },
        }

        try {
          await mod.default(mockReq, mockRes)
        } catch (err) {
          if (!sent) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  return {
    plugins: [react(), devApiPlugin()],
    server: { port: 5173, strictPort: true },
    // src/lib/supabase.js builds its client at import time, so tests need these
    // SET (never real): no test makes a network call.
    test: {
      env: {
        VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key',
      },
    },
  }
})
