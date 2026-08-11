// api/mcp.js — Vercel serverless proxy for MCP Streamable HTTP.
// Vercel rewrites DO NOT stream SSE; API routes DO.
import http from 'node:http'
import https from 'node:https'
import { mcpProxyResponseHeaders } from '../src/mcpProxyHeaders.js'

export { mcpProxyResponseHeaders }

// MCP's public endpoint is Vercel. Set MCP_BACKEND_URL only for an intentional private-upstream override.
const BACKEND = process.env.MCP_BACKEND_URL || 'https://43.134.14.43.nip.io'

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Preserve protocol-critical response headers. Claude discovers OAuth from
// WWW-Authenticate after the MCP resource returns 401, while Streamable HTTP
// clients need mcp-session-id on initialize and subsequent requests.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' })

  const body = await collectBody(req)
  const backendUrl = new URL('/mcp', BACKEND)

  try {
    const proxyRes = await new Promise((resolve, reject) => {
      const proto = backendUrl.protocol === 'https:' ? https : http
      const headers = {
   'Content-Type': req.headers['content-type'] || 'application/json',
   'Accept': req.headers['accept'] || 'application/json, text/event-stream',
   'Content-Length': body.length,
   // Preserve Host: backend’s StreamableHTTP transport validates origin/host.
   'Host': backendUrl.host,
 }
 if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization']
 if (req.headers['mcp-session-id']) headers['mcp-session-id'] = req.headers['mcp-session-id']

      const proxyReq = proto.request(backendUrl, { method: 'POST', headers }, resolve)
      proxyReq.on('error', reject)
      proxyReq.write(body)
      proxyReq.end()
    })

    res.writeHead(proxyRes.statusCode, mcpProxyResponseHeaders(proxyRes.headers))
    proxyRes.pipe(res)
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'proxy_error', message: e.message }))
  }
}

export const config = { api: { bodyParser: false } }
