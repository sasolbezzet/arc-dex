// Menjaga preflight swap EOA: timeout wallet tidak boleh berubah menjadi
// penantian tanpa akhir, dan revert on-chain harus terbaca sebagai kalimat yang
// bisa ditampilkan ke pengguna (bukan "approve selesai lalu diam").
import { describe, expect, it } from 'vitest'
import { WALLET_RPC_TIMEOUT_MS, revertDataFromError, revertReasonFromError, withWalletTimeout } from './txPreflight'

const encodeErrorString = (text: string) => {
  const hex = Array.from(text).map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  const length = (hex.length / 2).toString(16).padStart(64, '0')
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
  return `0x08c379a0${'20'.padStart(64, '0')}${length}${padded}`
}

describe('withWalletTimeout', () => {
  it('meneruskan hasil saat RPC menjawab tepat waktu', async () => {
    await expect(withWalletTimeout(Promise.resolve('0x1'), 'Estimasi gas')).resolves.toBe('0x1')
  })

  it('berhenti dengan pesan yang menyebut label saat RPC menggantung', async () => {
    await expect(withWalletTimeout(new Promise(() => {}), 'Estimasi gas', 20))
      .rejects.toThrow('Estimasi gas tidak merespons dalam 0 detik.')
  })

  it('memakai deadline default 20 detik', () => {
    expect(WALLET_RPC_TIMEOUT_MS).toBe(20_000)
  })
})

describe('revertReasonFromError', () => {
  it('membaca Error(string) milik revert allowance', () => {
    const error = { data: encodeErrorString('ERC20: transfer amount exceeds allowance') }
    expect(revertReasonFromError(error)).toBe('ERC20: transfer amount exceeds allowance')
  })

  it('membaca revert yang dibungkus viem (cause.data)', () => {
    const error = { shortMessage: 'execution reverted', cause: { data: encodeErrorString('Expired') } }
    expect(revertReasonFromError(error)).toBe('Expired')
  })

  it('menerjemahkan selector InvalidSignature adapter Circle', () => {
    expect(revertReasonFromError({ data: '0x8baa579f' })).toContain('InvalidSignature 0x8baa579f')
  })

  it('membaca Panic(uint256)', () => {
    expect(revertReasonFromError({ data: `0x4e487b71${'11'.padStart(64, '0')}` })).toBe('panic 0x' + '11'.padStart(64, '0'))
  })

  it('mengembalikan null untuk error yang bukan revert on-chain', () => {
    expect(revertReasonFromError(new Error('User rejected the request'))).toBeNull()
    expect(revertReasonFromError({ code: 4001 })).toBeNull()
  })

  it('mengambil data revert dari pesan wallet yang hanya memuat hex', () => {
    const error = new Error(`execution reverted (data: ${encodeErrorString('boom').slice(0, 74)})`)
    expect(revertDataFromError(error).slice(0, 10)).toBe('0x08c379a0')
  })
})
