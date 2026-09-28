/**
 * Fee floor untuk UserOperation MSCA (deploy + addOwners) per chain.
 *
 * Arc mainnet menolak UserOperation bermasalah dengan
 * `precheck failed: maxPriorityFeePerGas is 0 but must be at least 1000000000`,
 * jadi Arc tetap memakai lantai 1 gwei.
 *
 * Base dan Arbitrum TIDAK punya syarat itu: gas aslinya ~0.02 gwei. Menerapkan
 * lantai Arc di sana melipatgandakan fee 50-400x sehingga paymaster Gas Station
 * menolak operasinya dengan
 * `Exceeded max spend USD per transaction of the policy` — persis error yang
 * dulu memblokir deploy MSCA di Base/Arbitrum.
 */
export interface MscaFeeFloor {
  maxPriorityFeePerGas: bigint
  maxFeePerGas: bigint
}

export function mscaFeeFloor(chainKey: string): MscaFeeFloor {
  if (String(chainKey || '').startsWith('arc')) {
    return { maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 2_000_000_000n }
  }
  return { maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: 2_000_000n }
}
