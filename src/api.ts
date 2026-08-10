export class HttpError extends Error {
  status: number
  body: any
  constructor(message: string, status: number, body: any) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export async function safePost(baseUrl: string, path: string, body: object, signal?: AbortSignal): Promise<any> {
  const token = localStorage.getItem('arc-dex-auth')
  let authToken = ''
  try { authToken = token ? JSON.parse(token)?.token || '' : '' } catch {}
  const resp = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  const text = await resp.text()
  if (!resp.ok) {
    const preview = sanitizePreview(text, resp.status)
    let parsedBody: any = null
    if (!preview.startsWith('HTML ')) {
      try {
        parsedBody = JSON.parse(text)
        if (parsedBody?.error) {
          throw new HttpError(parsedBody.error, resp.status, parsedBody)
        }
      } catch (e) {
        if (e instanceof HttpError) throw e
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
      }
    }
    throw new HttpError(`Server ${resp.status} on ${path}: ${preview}`, resp.status, parsedBody)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON from ${path} (HTTP ${resp.status}): ${text.slice(0, 200)}`)
  }
}

function sanitizePreview(text: string, status: number): string {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    return `HTML ${status} response (endpoint unavailable)`
  }
  return trimmed.slice(0, 200).replace(/[<>]/g, '')
}
