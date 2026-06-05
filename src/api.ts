// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safePost(baseUrl: string, path: string, body: object): Promise<any> {
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
  })
  const text = await resp.text()
  if (!resp.ok) {
    const preview = sanitizePreview(text, resp.status)
    if (!preview.startsWith('HTML ')) {
      try {
        const data = JSON.parse(text)
        if (data?.error) throw new Error(data.error)
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
      }
    }
    throw new Error(`Server ${resp.status} on ${path}: ${preview}`)
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
