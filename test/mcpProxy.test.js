import { describe, expect, it } from 'vitest'
import { mcpProxyResponseHeaders } from '../src/mcpProxyHeaders.js'

describe('MCP Vercel proxy response headers', () => {
  it('forwards OAuth and Streamable HTTP session headers only', () => {
    expect(mcpProxyResponseHeaders({
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="ARCOX MCP", resource_metadata="https://arcoxdex.vercel.app/.well-known/oauth-protected-resource"',
      'mcp-session-id': 'session-123',
      'cache-control': 'no-store',
      'x-internal-secret': 'must-not-forward',
    })).toEqual({
      'Content-Type': 'application/json',
      'mcp-session-id': 'session-123',
      'www-authenticate': 'Bearer realm="ARCOX MCP", resource_metadata="https://arcoxdex.vercel.app/.well-known/oauth-protected-resource"',
      'cache-control': 'no-store',
    })
  })
})
