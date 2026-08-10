import { methodNotAllowed, readRawBody, parseJsonSafe } from './_webhook-utils.mjs'

// Minimal endpoint to accept Content Security Policy violation reports.
// Vercel's filesystem API routes take precedence over the /api/* rewrite,
// so this function handles the report locally instead of proxying to the
// backend (the frontend's public origin remains arcoxdex.vercel.app).

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res)
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    setCorsHeaders(res)
    return methodNotAllowed(res, ['POST', 'OPTIONS'])
  }

  try {
    // Browsers send `Content-Type: application/csp-report` with a JSON body.
    // We accept it but only log a summary to avoid leaking PII.
    const raw = await readRawBody(req)
    const payload = parseJsonSafe(raw)
    const report = payload['csp-report'] || payload || {}

    console.log('[CSP REPORT]', JSON.stringify({
      effectiveDirective: report['effective-directive'],
      blockedURI: report['blocked-uri'],
      documentURI: report['document-uri'],
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
    }))
  } catch (err) {
    // Never fail the request because of a malformed report; that would only
    // generate noise in the browser console.
    console.warn('[CSP REPORT] parse error:', err.message || err)
  }

  setCorsHeaders(res)
  res.status(204).end()
}
