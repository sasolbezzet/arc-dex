import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../api/webhooks/circle-wallet.js'

function request(method, body, headers = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    setHeader(name, value) { this.headers[name] = value },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)) },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('Circle Wallets webhook proxy', () => {
  it('returns a fast HEAD response', async () => {
    const res = response()
    await handler(request('HEAD'), res)
    expect(res.statusCode).toBe(200)
  })

  it('acknowledges only the Wallets webhooks.test probe without forwarding', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const res = response()
    await handler(request('POST', JSON.stringify({ version: 2, notificationType: 'webhooks.test' })), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body.toString())).toMatchObject({ ok: true, product: 'wallets', probe: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed for unsigned Wallets notifications', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'signature required' }), { status: 401 }))
    const res = response()
    await handler(request('POST', JSON.stringify({ version: 2, notificationType: 'transactions.inbound' })), res)
    expect(res.statusCode).toBe(401)
  })
})
