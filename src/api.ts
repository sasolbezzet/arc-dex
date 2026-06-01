// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safePost(baseUrl: string, path: string, body: object): Promise<any> {
  const resp = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  if (!resp.ok) {
    if (!text.trim().startsWith('<')) {
      try {
        const data = JSON.parse(text)
        if (data?.error) throw new Error(data.error)
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
      }
    }
    const preview = text.trim().startsWith('<') ? `HTML ${resp.status} page (endpoint missing or server error)` : text.slice(0, 200)
    throw new Error(`Server ${resp.status} on ${path}: ${preview}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON from ${path} (HTTP ${resp.status}): ${text.slice(0, 200)}`)
  }
}
