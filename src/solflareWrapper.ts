// Bungkus Solflare provider supaya kompatibel dengan
// @circle-fin/adapter-solana-kit yang mengharapkan:
//   - provider.address  (string base58, BUKAN object publicKey)
//   - provider.isConnected
//   - provider.connect()
//   - provider.signTransaction(base64String)  →  hasil signed
//
// Solflare native cuma punya `publicKey` (object) dan signTransaction
// yang menerima VersionedTransaction object — bukan base64 string.
// Wrapper ini menjembatani perbedaan tersebut.

import { VersionedTransaction } from '@solana/web3.js'

function toBase58(pk: any): string | null {
  if (!pk) return null
  if (typeof pk === 'string') return pk
  if (typeof pk.toBase58 === 'function') return pk.toBase58()
  if (typeof pk.toString === 'function') return pk.toString()
  return null
}

function decodeB64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'))
  // Browser fallback
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Wrap raw Solflare provider → shape yang adapter-solana-kit harapkan.
 * Sumber kebenaran address selalu dibaca ulang dari provider.publicKey
 * setiap kali diakses (via getter), supaya tidak basi setelah reconnect.
 */
export function wrapSolflare(raw: any): any {
  if (!raw) throw new Error('Solflare provider tidak ditemukan')

  const wrapper: any = {
    // forward identitas
    isSolflare: true,
    _raw: raw,

    get isConnected() {
      return Boolean(raw.isConnected)
    },

    // adapter membaca .address sebagai string
    get address() {
      return toBase58(raw.publicKey) || undefined
    },

    get publicKey() {
      return raw.publicKey
    },

    async connect() {
      if (!raw.isConnected) {
        await raw.connect()
      }
      const addr = toBase58(raw.publicKey)
      if (!addr) {
        throw new Error('Solflare connect() tidak mengembalikan public key')
      }
      // Adapter membaca return value: { address }
      return { address: addr, publicKey: raw.publicKey }
    },

    async disconnect() {
      try { await raw.disconnect?.() } catch { /* ignore */ }
    },

    // Adapter passes base64 string; Solflare native butuh
    // VersionedTransaction object. Convert masuk dan keluar.
    async signTransaction(input: any): Promise<Uint8Array> {
      const tx =
        typeof input === 'string'
          ? VersionedTransaction.deserialize(decodeB64(input))
          : input instanceof Uint8Array
            ? VersionedTransaction.deserialize(input)
            : input
      const signed = await raw.signTransaction(tx)
      // Kembalikan Uint8Array — adapter parser menerima format ini
      return signed.serialize()
    },

    async signAllTransactions(inputs: any[]): Promise<Uint8Array[]> {
      const txs = inputs.map((i) =>
        typeof i === 'string'
          ? VersionedTransaction.deserialize(decodeB64(i))
          : i instanceof Uint8Array
            ? VersionedTransaction.deserialize(i)
            : i,
      )
      const signed = await raw.signAllTransactions(txs)
      return signed.map((t: VersionedTransaction) => t.serialize())
    },

    async signMessage(msg: Uint8Array) {
      return raw.signMessage(msg)
    },
  }

  return wrapper
}
