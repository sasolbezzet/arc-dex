// Bungkus Solflare/Phantom provider supaya kompatibel dengan signer
// @solana/kit yang dipakai oleh Circle adapter:
//   - provider.address     (string base58)
//   - provider.isConnected
//   - provider.connect()
//   - provider.signTransaction()  → hasil: { signatures[], message }
//   - provider.signAllTransactions()  → hasil: array
//
// Input base64 dari @solana/kit harus dideserialisasi sebelum diteruskan ke
// extension, lalu signature slot pertama diverifikasi sebagai fee payer.

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

function signedTransactionResult(result: any) {
  const value = result?.signedTransaction ?? result
  if (value instanceof VersionedTransaction || value instanceof Transaction) return value
  if (typeof value === 'string' || value instanceof Uint8Array) {
    const bytes = typeof value === 'string' ? decodeB64(value) : value
    try { return VersionedTransaction.deserialize(bytes) } catch {
      try { return Transaction.from(bytes) } catch {
        throw new Error('Wallet returned invalid serialized Solana transaction bytes.')
      }
    }
  }
  return value
}

function transactionFeePayer(input: any): string | null {
  if (input instanceof VersionedTransaction) return toBase58(input.message.staticAccountKeys?.[0])
  if (input instanceof Transaction) return toBase58(input.feePayer || input.signatures?.[0]?.publicKey)
  return null
}

export function solanaFeePayerSignature(result: any): Uint8Array {
  const signature = result instanceof VersionedTransaction
    ? result.signatures?.[0]
    : result instanceof Transaction
      ? result.signatures?.[0]?.signature
      : result?.signatures?.[0]?.signature || result?.signatures?.[0]
  if (!(signature instanceof Uint8Array) || !signature.some(byte => byte !== 0)) {
    throw new Error('Wallet did not sign the Solana fee payer transaction.')
  }
  return signature
}

function assertFeePayerSigned(result: any, expectedAddress: string) {
  const payer = transactionFeePayer(result)
  if (payer && payer !== expectedAddress) {
    throw new Error(`Solana fee payer ${payer} does not match connected wallet ${expectedAddress}.`)
  }
  solanaFeePayerSignature(result)
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
      const transaction = transactionInput(input)
      const address = toBase58(raw.publicKey)
      if (!address) throw new Error('Solflare public key tidak tersedia.')
      const payer = transactionFeePayer(transaction)
      if (payer && payer !== address) throw new Error(`Solana fee payer ${payer} does not match connected wallet ${address}.`)
      return assertFeePayerSigned(signedTransactionResult(await raw.signTransaction(transaction)), address)
    },

    async signAllTransactions(inputs: any[]) {
      const txs = inputs.map(transactionInput)
      const signed = await raw.signAllTransactions(txs)
      const address = toBase58(raw.publicKey)
      if (!address) throw new Error('Solflare public key tidak tersedia.')
      return signed.map((result: any) => assertFeePayerSigned(signedTransactionResult(result), address))
    },

    async signMessage(msg: Uint8Array) {
      return raw.signMessage(msg)
    },
  }

  return wrapper
}

/**
 * Wrap raw Phantom provider.
 * Phantom: decode base64 sendiri dan kirim VersionedTransaction ke extension.
 * Hasil dapat berupa Transaction-like object; signature fee payer dinormalisasi.
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
      const transaction = transactionInput(input)
      const address = toBase58(raw.publicKey)
      if (!address) throw new Error('Phantom public key tidak tersedia.')
      const payer = transactionFeePayer(transaction)
      if (payer && payer !== address) throw new Error(`Solana fee payer ${payer} does not match connected wallet ${address}.`)
      return assertFeePayerSigned(signedTransactionResult(await raw.signTransaction(transaction)), address)
    },

    async signAllTransactions(inputs: any[]) {
      const txs = inputs.map(transactionInput)
      const signed = await raw.signAllTransactions(txs)
      const address = toBase58(raw.publicKey)
      if (!address) throw new Error('Phantom public key tidak tersedia.')
      return signed.map((result: any) => assertFeePayerSigned(signedTransactionResult(result), address))
    },

    async signMessage(msg: Uint8Array) {
      return raw.signMessage(msg)
    },
  }

  return wrapper
}
