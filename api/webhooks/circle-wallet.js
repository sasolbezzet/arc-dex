// Circle Wallets v2 webhook endpoint on the public Vercel origin.
// This is deliberately separate from the Gateway webhook route.

const BACKEND = String(
  process.env.CIRCLE_WEBHOOK_BACKEND_URL ||
  'https://43.134.14.43.nip.io',
).replace(/\/+$/, '')

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function isWalletsTestNotification(body) {
  if (!body || body.length === 0) return false
  try {
    const payload = JSON.parse(body.toString('utf8'))
    return payload?.version === 2 && payload?.notificationType === 'webhooks.test'
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', '0')
    res.end()
    return
  }

  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      provider: 'circle',
      product: 'wallets',
      message: 'Circle Wallets webhook endpoint is alive. Use POST for callbacks.',
    })
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
    return json(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const body = await readRawBody(req)
    // Circle's connection/test notification is not a wallet event. It is safe
    // to acknowledge only this exact v2 test shape without signature.
    if (body.length === 0 || isWalletsTestNotification(body)) {
      return json(res, 200, {
        ok: true,
        provider: 'circle',
        product: 'wallets',
        probe: true,
        ...(body.length > 0 ? { notificationType: 'webhooks.test' } : {}),
        message: 'Connection probe accepted. Signed Wallets notifications are required.',
      })
    }

    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Content-Length': String(body.length),
      Accept: req.headers.accept || 'application/json',
    }
    for (const name of ['x-circle-signature', 'x-circle-key-id', 'x-circle-timestamp']) {
      const value = req.headers[name]
      if (value) headers[name] = Array.isArray(value) ? value[0] : value
    }

    const upstream = await fetch(`${BACKEND}/api/webhooks/circle-wallet`, {
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
  } catch {
    json(res, 502, { ok: false, provider: 'circle', product: 'wallets', error: 'Webhook upstream unavailable' })
  }
}

export const config = { api: { bodyParser: false } }
