#!/usr/bin/env node
/**
 * sttProxy.example.mjs — a minimal example of the backend proxy the README
 * and speechProvider.ts both point to.
 *
 * What this is for: CloudSpeechProvider in the app can post recorded audio
 * here instead of calling a transcription API directly from the browser. The
 * API key then lives only in this process's environment, never in the
 * browser, which is the production-safe shape "Do not expose secret API
 * keys in frontend code" actually requires.
 *
 * This is intentionally small and NOT hardened for production: no auth on
 * this proxy itself, no rate limiting, no request size caps beyond Node's
 * defaults. Treat it as a starting point for a real backend endpoint, not as
 * a deployable service.
 *
 * Run it:
 *   STT_API_KEY=sk-... node server/sttProxy.example.mjs
 *
 * Then point the app at it:
 *   VITE_CLOUD_STT_PROXY_URL=http://localhost:8787/transcribe
 *
 * and restart `npm run dev` so Vite picks up the new environment variable.
 */
import http from 'node:http'

const PORT = process.env.STT_PROXY_PORT || 8787
const UPSTREAM = process.env.STT_UPSTREAM_URL || 'https://api.openai.com/v1/audio/transcriptions'
const API_KEY = process.env.STT_API_KEY

if (!API_KEY) {
  console.error('STT_API_KEY is not set. Set it to your transcription provider key before starting this proxy.')
  process.exit(1)
}

const server = http.createServer(async (req, res) => {
  // CORS: permissive here because this is a local dev example. A real
  // deployment should restrict this to the app's own origin.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/transcribe')) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
        Authorization: `Bearer ${API_KEY}`,
      },
      body,
    })

    const text = await upstream.text()
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
    res.end(text)
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(error?.message || error) }))
  }
})

server.listen(PORT, () => {
  console.log(`STT proxy listening on http://localhost:${PORT}/transcribe -> ${UPSTREAM}`)
})
