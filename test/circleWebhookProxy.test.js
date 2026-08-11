import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../api/webhooks/circle.js'

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
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value = '') {
      this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Circle webhook public proxy', () => {
  it('acknowledges an empty connection probe at the edge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const res = response()

    await handler(request('POST', ''), res)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body.toString())).toMatchObject({
      ok: true,
      provider: 'circle',
      product: 'gateway',
      probe: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('acknowledges Circle webhooks.test without a signature', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const res = response()
    const body = JSON.stringify({
      version: 2,
      notificationType: 'webhooks.test',
      notification: { amount: '999999', destinationAddress: '0x0000000000000000000000000000000000000001' },
    })

    await handler(request('POST', body, { 'content-type': 'application/json' }), res)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body.toString())).toMatchObject({
      ok: true,
      probe: true,
      notificationType: 'webhooks.test',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps non-empty unsigned notifications fail-closed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'X-Circle-Signature header is required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = response()

    await handler(request('POST', '{}', { 'content-type': 'application/json' }), res)

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body.toString()).error.toLowerCase()).toContain('signature')
  })

  it('forwards signed notification headers and exact raw bytes', async () => {
    const rawBody = '{"notificationId":"n-1","unicode":"é"}'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, received: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = response()

    await handler(request('POST', rawBody, {
      'content-type': 'application/json',
      'x-circle-signature': 'signature',
      'x-circle-key-id': 'key-id',
    }), res)

    expect(res.statusCode).toBe(200)
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(Buffer.from(options.body).toString()).toBe(rawBody)
    expect(options.headers['x-circle-signature']).toBe('signature')
    expect(options.headers['x-circle-key-id']).toBe('key-id')
    expect(options.headers['Content-Length']).toBe(String(Buffer.byteLength(rawBody)))
  })
})
