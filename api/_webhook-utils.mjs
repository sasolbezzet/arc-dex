import { createHmac, timingSafeEqual } from 'crypto'

export async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && typeof req.body === 'object' && !req.readable) return JSON.stringify(req.body)

  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export function parseJsonSafe(rawBody) {
  if (!rawBody) return {}
  try {
    const parsed = JSON.parse(rawBody)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    return { _parseError: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

export function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '))
  sendJson(res, 405, { ok: false, error: 'Method not allowed', allowed })
}

export function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value || ''
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function hmacHex(algorithm, secret, payload) {
  return createHmac(algorithm, secret).update(payload).digest('hex')
}

export function safeEqualHex(left, right) {
  const a = String(left || '').trim().toLowerCase()
  const b = String(right || '').trim().toLowerCase()
  if (!a || !b || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
