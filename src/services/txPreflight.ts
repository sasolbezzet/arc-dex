/**
 * Preflight & timeout untuk panggilan RPC wallet.
 *
 * Dua masalah nyata di jalur swap EOA yang keduanya muncul di UI sebagai
 * "approve sudah selesai, lalu tidak terjadi apa-apa":
 *
 * 1. `sendBufferedTx` mengirim `execute` langsung ke wallet tanpa mensimulasi
 *    dulu. Bila calldata-nya akan revert, wallet hanya menampilkan error yang
 *    buram (atau tidak menampilkan apa pun), sehingga penyebab sebenarnya tidak
 *    pernah sampai ke pengguna. `e2e-eoa-swap-mainnet.mjs` selalu mensimulasi
 *    (`eth_call`) sebelum mengirim — frontend harus melakukan hal yang sama.
 *
 * 2. `eth_estimateGas` / `eth_getBlockByNumber` / `eth_gasPrice` lewat provider
 *    wallet tidak punya deadline. RPC wallet yang menggantung membuat seluruh
 *    alur berhenti tanpa promise yang pernah resolve, dan karena itu tanpa
 *    pesan error sama sekali.
 *
 * Modul ini sengaja bebas `window`/wallet agar bisa diuji di node.
 */

/** Deadline panggilan RPC wallet yang hanya membaca data (bukan popup). */
export const WALLET_RPC_TIMEOUT_MS = 20_000

/** Selector revert Solidity: `Error(string)` dan `Panic(uint256)`. */
const ERROR_SELECTOR = '0x08c379a0'
const PANIC_SELECTOR = '0x4e487b71'
/** Revert custom argument signature InvalidSignature pada adapter Circle. */
const INVALID_SIGNATURE_SELECTOR = '0x8baa579f'

/**
 * Batasi satu panggilan wallet dengan deadline. Callback-nya sengaja tidak
 * membatalkan request yang masih berjalan (EIP-1193 tidak menyediakan abort),
 * tetapi pemanggil berhenti menunggu sehingga alur selalu berakhir dengan pesan
 * yang bisa dibaca, bukan spinner tanpa akhir.
 */
export async function withWalletTimeout<T>(promise: Promise<T>, label: string, timeoutMs = WALLET_RPC_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Ambil hex data revert dari berbagai bentuk error EIP-1193/viem. */
export function revertDataFromError(error: unknown): string {
  const source = error as any
  const candidates = [
    source?.data,
    source?.raw,
    source?.cause?.data,
    source?.cause?.raw,
    source?.error?.data,
    source?.info?.error?.data,
  ]
  for (const candidate of candidates) {
    const direct = typeof candidate === 'string' ? candidate : candidate?.data
    if (typeof direct === 'string' && /^0x[0-9a-fA-F]*$/.test(direct) && direct.length > 2) return direct
  }
  const message = String(source?.shortMessage || source?.message || '')
  const match = message.match(/0x[0-9a-fA-F]{8,}/)
  return match ? match[0] : ''
}

/**
 * Terjemahkan revert menjadi alasan yang bisa dibaca pengguna. `null` berarti
 * error-nya bukan revert on-chain (mis. wallet tidak mendukung `eth_call`),
 * sehingga pemanggil harus menganggap simulasi tidak konklusif dan lanjut.
 */
export function hexToAscii(hex: string): string {
  let out = ''
  for (let i = 0; i + 2 <= hex.length; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16)
    if (Number.isNaN(code)) return ''
    out += String.fromCharCode(code)
  }
  return out
}

export function revertReasonFromError(error: unknown): string | null {
  const data = revertDataFromError(error)
  if (!data) return null
  const body = data.slice(2).toLowerCase()
  if (data.startsWith(ERROR_SELECTOR)) {
    // ABI: selector | offset(32B) | length(32B) | payload — offset relatif ke
    // awal argumen (byte ke-4), jadi dihitung dari body index 8.
    const offsetBytes = Number.parseInt(body.slice(8, 72) || '20', 16)
    const start = 8 + offsetBytes * 2
    const lengthBytes = Number.parseInt(body.slice(start, start + 64) || '0', 16)
    const reason = hexToAscii(body.slice(start + 64, start + 64 + lengthBytes * 2))
    return reason || 'revert tanpa pesan'
  }
  if (data.startsWith(PANIC_SELECTOR)) return `panic 0x${body.slice(8, 72)}`
  if (data.startsWith(INVALID_SIGNATURE_SELECTOR)) {
    return 'InvalidSignature 0x8baa579f — signature permit tidak diterima adapter'
  }
  return `revert ${data.slice(0, 10)}`
}
