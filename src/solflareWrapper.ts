// Bungkus Solflare/Phantom provider supaya kompatibel dengan
// @circle-fin/adapter-solana-kit yang mengharapkan:
//   - provider.address     (string base58)
//   - provider.isConnected
//   - provider.connect()
//   - provider.signTransaction()  → hasil: { signatures[], message }
//   - provider.signAllTransactions()  → hasil: array
//
// Root cause error lama:
//   Wrapper deserialize base64 → VersionedTransaction → panggil
//   wallet.signTransaction(tx). Phantom mengembalikan Transaction object
//   (bukan VersionedTransaction), serialize() menghasilkan format berbeda.
//   Solana SDK verify signature gagal karena format tidak sesuai.

import { VersionedTransaction, Transaction } from '@solana/web3.js'

function toBase58(pk: any): string | null {
  if (!pk) return null
  if (typeof pk === 'string') return pk
  if (typeof pk.toBase58 === 'function') return pk.toBase58()
  if (typeof pk.toString === 'function') return pk.toString()
  return null
}

function decodeB64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'))
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function serializeSigned(result: any): Uint8Array {
  if (result instanceof Uint8Array) return result
  if (result instanceof VersionedTransaction) return result.serialize()
  if (result instanceof Transaction) return result.serialize()
  // Object dengan .serialize()
  if (result && typeof result.serialize === 'function') return result.serialize()
  // Base64 string
  if (typeof result === 'string') return decodeB64(result)
  throw new Error(`signTransaction: unknown return type ${typeof result}`)
}

/**
 * Wrap raw Solflare provider.
 * Solflare: signTransaction(VersionedTransaction) → VersionedTransaction
 */
export function wrapSolflare(raw: any): any {
  if (!raw) throw new Error('Solflare provider tidak ditemukan')

  const wrapper: any = {
    isSolflare: true,
    _raw: raw,

    get isConnected() { return Boolean(raw.isConnected) },
    get address() { return toBase58(raw.publicKey) || undefined },
    get publicKey() { return raw.publicKey },

    async connect() {
      if (!raw.isConnected) await raw.connect()
      const addr = toBase58(raw.publicKey)
      if (!addr) throw new Error('Solflare connect() tidak mengembalikan public key')
      return { address: addr, publicKey: raw.publicKey }
    },

    async disconnect() {
      try { await raw.disconnect?.() } catch { /* ignore */ }
    },

    async signTransaction(input: any): Promise<Uint8Array> {
      // Solflare native expect VersionedTransaction; decode base64 if needed
      const tx = typeof input === 'string'
        ? VersionedTransaction.deserialize(decodeB64(input))
        : input instanceof Uint8Array
          ? VersionedTransaction.deserialize(input)
          : input
      const signed = await raw.signTransaction(tx)
      return serializeSigned(signed)
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
      return signed.map(serializeSigned)
    },

    async signMessage(msg: Uint8Array) {
      return raw.signMessage(msg)
    },
  }

  return wrapper
}

/**
 * Wrap raw Phantom provider.
 * Phantom: signTransaction(Transaction|VersionedTransaction|string) → Transaction
 * Phantom tidak perlu decode base64 — bisa terima langsung.
 * Yang penting: serialize hasil return dengan benar.
 */
export function wrapPhantom(raw: any): any {
  if (!raw) throw new Error('Phantom provider tidak ditemukan')

  const wrapper: any = {
    _isPhantom: true,
    _raw: raw,

    get isConnected() { return Boolean(raw.isConnected) },
    get address() { return toBase58(raw.publicKey) || undefined },
    get publicKey() { return raw.publicKey },

    async connect() {
      if (!raw.isConnected) await raw.connect()
      const addr = toBase58(raw.publicKey)
      if (!addr) throw new Error('Phantom connect() tidak mengembalikan public key')
      return { address: addr, publicKey: raw.publicKey }
    },

    async disconnect() {
      try { await raw.disconnect?.() } catch { /* ignore */ }
    },

    // Phantom menerima input apa pun (string/Transaction/VersionedTransaction)
    // dan mengembalikan Transaction object. Serialize hasilnya.
    async signTransaction(input: any): Promise<Uint8Array> {
      const signed = await raw.signTransaction(input)
      return serializeSigned(signed)
    },

    async signAllTransactions(inputs: any[]): Promise<Uint8Array[]> {
      const signed = await raw.signAllTransactions(inputs)
      return signed.map(serializeSigned)
    },

    async signMessage(msg: Uint8Array) {
      return raw.signMessage(msg)
    },
  }

  return wrapper
}