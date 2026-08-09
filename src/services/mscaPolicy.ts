export type AuthorizationOutcome = 'success' | 'pending' | 'failed' | 'unknown'

// Circle's Arbitrum Sepolia bundler rejected the SDK response when the tip was
// zero. Keep the floor in wei (0.002 gwei), comfortably above observed minimums.
export const ARBITRUM_PRIORITY_FEE_FLOOR = 2_000_000n
export const ARBITRUM_FEE_FALLBACK = 4_000_000n

export function parseFeeWei(value: unknown): bigint {
  const text = String(value ?? '').trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text)
  if (/^\d+$/.test(text)) return BigInt(text)
  return 0n
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

/** Put the validated fee envelope into the request before paymaster signing. */
export function hasCompleteFeeEnvelope(fees: Partial<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }>): fees is { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint } {
  return typeof fees.maxPriorityFeePerGas === 'bigint' && fees.maxPriorityFeePerGas > 0n
    && typeof fees.maxFeePerGas === 'bigint' && fees.maxFeePerGas >= fees.maxPriorityFeePerGas
}

export function withUserOperationFees<T extends Record<string, any>>(parameters: T, fees: Partial<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }>): T {
  if (!hasCompleteFeeEnvelope(fees)) return { ...parameters }
  return { ...parameters, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas }
}

/** Prevent a paymaster response from overwriting the already-signed fee envelope. */
export function removePaymasterFeeFields<T extends Record<string, any>>(response: T): Omit<T, 'maxPriorityFeePerGas' | 'maxFeePerGas'> {
  const { maxPriorityFeePerGas: _priority, maxFeePerGas: _max, ...paymaster } = response
  return paymaster
}

export async function requestPaymasterWithFees<T extends Record<string, any>>(
  parameters: T,
  fees: Partial<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }>,
  request: (parameters: T) => Promise<T>,
): Promise<Omit<T, 'maxPriorityFeePerGas' | 'maxFeePerGas'>> {
  if (!hasCompleteFeeEnvelope(fees)) throw new Error('Complete non-zero UserOperation fee envelope required before paymaster signing')
  const signedRequest = withUserOperationFees(parameters, fees)
  const response = await request(signedRequest)
  return removePaymasterFeeFields(response)
}

/**
 * Circle mapping only proves mapping initialization; it does not prove that
 * addOwners completed. Retry an existing mapping only after an explicit failed
 * prior UserOperation, never after an unknown result.
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

export function isSuccessfulUserOpReceipt(receipt: any): boolean {
  const status = receipt?.receipt?.status
  return receipt?.success === true && (status === '0x1' || status === 'success' || status === 1 || status === true)
}
