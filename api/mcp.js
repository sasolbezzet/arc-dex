// api/mcp.js — Vercel serverless proxy for MCP Streamable HTTP.
// Vercel rewrites DO NOT stream SSE; API routes DO.
// This proxies POST /mcp and /mcp/* to the backend with full streaming.
import http from 'node:http'
import https from 'node:https'

const BACKEND = process.env.MCP_BACKEND_URL || 'https://43.134.14.43.nip.io'

export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' })

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  const backendUrl = new URL(req.url, BACKEND)

  const proxyRes = await new Promise((resolve, reject) => {
    const proto = backendUrl.protocol === 'https:' ? https : http
    const proxyReq = proto.request(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': req.headers['accept'] || 'application/json, text/event-stream',
        'Authorization': req.headers['authorization'] || '',
        'mcp-session-id': req.headers['mcp-session-id'] || '',
      },
    }, resolve)
    proxyReq.on('error', reject)
    proxyReq.write(body)
    proxyReq.end()
  })

  // Forward status + key headers
  res.writeHead(proxyRes.statusCode, {
    'Content-Type': proxyRes.headers['content-type'] || 'application/json',
    ...(proxyRes.headers['mcp-session-id'] ? { 'mcp-session-id': proxyRes.headers['mcp-session-id'] } : {}),
  })

  // Stream the response body back to the client
  proxyRes.pipe(res)
}

export const config = { api: { bodyParser: false } }
