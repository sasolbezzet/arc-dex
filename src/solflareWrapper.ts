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
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function transactionInput(input: any) {
  if (typeof input === 'string') return VersionedTransaction.deserialize(decodeB64(input))
  if (input instanceof Uint8Array) return VersionedTransaction.deserialize(input)
  return input
}

function assertFeePayerSigned(result: any) {
  const signature = result instanceof VersionedTransaction
    ? result.signatures?.[0]
    : result instanceof Transaction
      ? result.signatures?.[0]?.signature
      : result?.signatures?.[0]?.signature || result?.signatures?.[0]
  if (!(signature instanceof Uint8Array) || !signature.some(byte => byte !== 0)) {
    throw new Error('Wallet did not sign the Solana fee payer transaction.')
  }
  return result
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
      try { await raw.disconnect?.() } catch(e) { console.warn('disconnect error:', e instanceof Error ? e.message : String(e)) }
    },

    async signTransaction(input: any) {
      return assertFeePayerSigned(await raw.signTransaction(transactionInput(input)))
    },

    async signAllTransactions(inputs: any[]) {
      const txs = inputs.map(transactionInput)
      const signed = await raw.signAllTransactions(txs)
      return signed.map(assertFeePayerSigned)
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
 * Fix error #5663012: decode base64 sendiri, kirim VersionedTransaction ke Phantom.
 * Phantom return Transaction object — serialize dengan serializeSigned().
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
      try { await raw.disconnect?.() } catch(e) { console.warn('disconnect error:', e instanceof Error ? e.message : String(e)) }
    },

    async signTransaction(input: any) {
      return assertFeePayerSigned(await raw.signTransaction(transactionInput(input)))
    },

    async signAllTransactions(inputs: any[]) {
      const txs = inputs.map(transactionInput)
      const signed = await raw.signAllTransactions(txs)
      return signed.map(assertFeePayerSigned)
    },

    async signMessage(msg: Uint8Array) {
      return raw.signMessage(msg)
    },
  }

  return wrapper
}
