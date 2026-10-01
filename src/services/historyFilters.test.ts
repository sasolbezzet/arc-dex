import { describe, expect, it } from 'vitest'
import { filterHistory } from './historyFilters'
import type { TxRecord } from '../txHistory'

const rows: TxRecord[] = [
  { id: 'a', ts: 4, action: 'bridge', source: 'agent-mcp', from: 'Base', to: 'Arc', amount: '0.0095', status: 'success', burnTx: '0x1' },
  { id: 'b', ts: 3, action: 'bridge', source: 'agent-mcp', from: 'Arbitrum', to: 'Arc', amount: '0.015', status: 'pending', burnTx: '0x2', pendingMint: true },
  { id: 'c', ts: 2, action: 'bridge', source: 'web-ui', from: 'Arc', to: 'Arbitrum', amount: '0.02', status: 'success' },
  { id: 'd', ts: 1, action: 'swap', source: 'web-ui', from: 'Arc', to: 'Arc', amount: '1', status: 'error' },
]

describe('filterHistory', () => {
  it('matches a hop on either end of the bridge', () => {
    expect(filterHistory(rows, { chain: 'Base' }).map(row => row.id)).toEqual(['a'])
    expect(filterHistory(rows, { chain: 'Arc' }).map(row => row.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(filterHistory(rows, { chain: 'Arbitrum' }).map(row => row.id)).toEqual(['b', 'c'])
  })

  it('combines status with chain and kind', () => {
    expect(filterHistory(rows, { status: 'pending' }).map(row => row.id)).toEqual(['b'])
    expect(filterHistory(rows, { chain: 'Arc', status: 'error' }).map(row => row.id)).toEqual(['d'])
    expect(filterHistory(rows, { kind: 'swap', chain: 'Base' })).toEqual([])
  })

  it('keeps the existing panel semantics for agent and pending kinds', () => {
    expect(filterHistory(rows, { kind: 'agent' }).map(row => row.id)).toEqual(['a', 'b'])
    // `pending` in the panel means "belum sukses" (pending + error), persis seperti sebelum filter baru ditambahkan.
    expect(filterHistory(rows, { kind: 'pending' }).map(row => row.id)).toEqual(['b', 'd'])
    expect(filterHistory(rows, { kind: 'bridge' }).map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(filterHistory(rows).length).toBe(4)
  })
})
