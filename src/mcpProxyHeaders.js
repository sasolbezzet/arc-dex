// Response headers that must survive the Vercel MCP proxy boundary.
// Keep this helper free of Node HTTP imports so it can be unit-tested by Vite.
export function mcpProxyResponseHeaders(headers = {}) {
  const result = { 'Content-Type': headers['content-type'] || 'application/json' }
  for (const name of ['mcp-session-id', 'www-authenticate', 'cache-control']) {
    if (headers[name]) result[name] = headers[name]
  }
  return result
}
