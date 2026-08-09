export type AuthorizationOutcome = 'success' | 'pending' | 'failed' | 'unknown'

// Circle's Arbitrum Sepolia bundler rejected the SDK response when the tip was
// zero. Keep the floor in wei (0.002 gwei), comfortably above the observed
// 953452 wei minimum, while still using Circle's quoted max fee when available.
export const ARBITRUM_PRIORITY_FEE_FLOOR = 2_000_000n
export const ARBITRUM_FEE_FALLBACK = 4_000_000n

export function parseFeeWei(value: unknown): bigint {
  const text = String(value ?? '').trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text)
  if (/^\d+$/.test(text)) return BigInt(text)
  return 0n
}

export function isSuccessfulUserOpReceipt(receipt: any): boolean {
  const status = receipt?.receipt?.status
  return receipt?.success === true && (status === '0x1' || status === 'success' || status === 1 || status === true)
}

export function normalizeArbitrumFees(priority: bigint, max: bigint, networkGasPrice = 0n) {
  const safePriority = priority > ARBITRUM_PRIORITY_FEE_FLOOR
    ? priority
    : ARBITRUM_PRIORITY_FEE_FLOOR
  const quotedMax = max > safePriority ? max : ARBITRUM_FEE_FALLBACK
  const networkMax = networkGasPrice > 0n ? networkGasPrice + safePriority : 0n
  const safeMax = quotedMax > networkMax ? quotedMax : networkMax
  return {
    maxPriorityFeePerGas: safePriority,
    maxFeePerGas: safeMax >= safePriority ? safeMax : safePriority,
  }
}

/**
 * Decide whether a recovery owner UserOperation can be retried safely.
 * A Circle address mapping only proves the mapping exists; it does not prove
 * that addOwners succeeded. Therefore an existing mapping is retryable only
 * when the previous UserOperation is explicitly finalized as failed.
 */
export function authorizationRetryDecision({
  mappingKnown,
  mappingExists,
  previousOutcome,
  previousAttempt = false,
}: {
  mappingKnown: boolean
  mappingExists: boolean
  previousOutcome: AuthorizationOutcome
  previousAttempt?: boolean
}): 'submit' | 'already_authorized' | 'pending' | 'unreconciled' | 'unavailable' {
  if (!mappingKnown) return 'unavailable'
  if (previousOutcome === 'success') return 'already_authorized'
  if (previousOutcome === 'pending') return 'pending'
  if (previousAttempt && previousOutcome === 'unknown') return 'unreconciled'
  if (mappingExists) return previousOutcome === 'failed' ? 'submit' : 'unreconciled'
  return 'submit'
}
