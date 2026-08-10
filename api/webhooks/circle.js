// Circle v2 webhook endpoint on the public Vercel origin.
//
// Circle sends HEAD while creating/updating a subscription. Do not proxy that
// probe to the backend: an upstream/rewrite can keep a HEAD connection open
// even after returning its headers, which makes Circle report the endpoint as
// unreachable. Actual POST notifications are forwarded with their raw body
// and signature headers unchanged.

const BACKEND = String(
  process.env.CIRCLE_WEBHOOK_BACKEND_URL ||
  'https://43.134.14.43.nip.io',
).replace(/\/+$/, '')

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)

  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  // Circle's v2 subscription validation requires a fast successful HEAD.
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.setHeader('Cache-Control', 'no-store')
    res.end()
    return
  }

  if (req.method === 'GET') {
    json(res, 200, {
      ok: true,
      provider: 'circle',
      product: 'gateway',
      message: 'Circle webhook endpoint is alive. Use POST for callbacks.',
    })
    return
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Methods', 'HEAD, GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Circle-Signature, X-Circle-Key-Id')
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'HEAD, GET, POST, OPTIONS')
    json(res, 405, { ok: false, error: 'Method not allowed' })
    return
  }

  try {
    const body = await readRawBody(req)
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Content-Length': String(body.length),
      Accept: req.headers.accept || 'application/json',
    }

    // Forward only webhook-relevant headers. Never forward the Vercel Host.
    for (const name of ['x-circle-signature', 'x-circle-key-id', 'x-circle-timestamp']) {
      const value = req.headers[name]
      if (value) headers[name] = Array.isArray(value) ? value[0] : value
    }

    const upstream = await fetch(`${BACKEND}/api/webhooks/circle`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    })
    const responseBody = await upstream.arrayBuffer()
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(Buffer.from(responseBody))
  } catch (error) {
    json(res, 502, {
      ok: false,
      provider: 'circle',
      error: 'Webhook upstream unavailable',
    })
  }
}

export const config = { api: { bodyParser: false } }
