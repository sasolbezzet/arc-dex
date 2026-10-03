/**
 * REGRESSION GUARD — fee platform 50 bps (0,5%).
 *
 * BridgePanel punya dua sumber angka fee: nilai env `VITE_ARCOX_ROUTER_FEE_BPS`
 * (fallback untuk jalur non-router) dan `feeBps()` on-chain untuk jalur Fee
 * Router. Guard ini mengunci default env ke 50 bps dan memastikan selector
 * on-chain tidak berubah, supaya penurunan fee 500 → 50 tidak diam-diam kembali
 * ke 5% lewat edit berikutnya.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const candidates = ['src/components/BridgePanel.tsx', 'arc-dex/src/components/BridgePanel.tsx']
const file = candidates.map((candidate) => resolve(process.cwd(), candidate)).find(existsSync)
if (!file) throw new Error(`BridgePanel.tsx tidak ditemukan dari cwd ${process.cwd()}`)
const source = readFileSync(file, 'utf8')

describe('BridgePanel fee platform 50 bps', () => {
  it('default env fee adalah 50 bps, bukan 500', () => {
    expect(source).toMatch(/VITE_ARCOX_ROUTER_FEE_BPS \|\| 50\)/)
    expect(source).not.toMatch(/VITE_ARCOX_ROUTER_FEE_BPS \|\| 500\)/)
  })

  it('membaca feeBps() on-chain lewat selector yang benar', () => {
    // keccak256('feeBps()')
    expect(source).toContain("ROUTER_FEE_BPS_SELECTOR = '0x24a9d853'")
    expect(source).toMatch(/effectiveFeeBps = routerFeeBps !== null \? routerFeeBps : PLATFORM_FEE_BPS/)
  })

  it('tidak ada sisa komentar yang menyebut feeBps immutable', () => {
    expect(source).not.toMatch(/feeBps`? immutable/i)
  })
})
