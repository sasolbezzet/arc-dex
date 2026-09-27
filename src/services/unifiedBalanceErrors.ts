// unifiedBalanceErrors.ts — pesan Unified Balance (Gateway) yang bisa ditindaklanjuti.
//
// SDK Gateway melempar pesan mentah seperti
//   "Insufficient USDC balance on Arc. Available: 0.020000 USDC, required: 0.0235 USDC"
// tanpa menjelaskan bahwa selisihnya adalah FEE Gateway yang ikut dipotong dari
// saldo Unified Balance (0.00385 USDC di Arc mainnet). Pengguna hanya melihat
// "saldo 0.02 kok kurang" padahal saldo memang 0.02. Modul ini menyusun pesan
// dengan angka eksplisit + langkah yang bisa diambil.

export type UnifiedBalanceShortfall = {
  /** Chain sumber saldo Unified Balance (mis. 'Arc'). */
  chain: string
  /** Saldo confirmed yang tersedia di chain itu (base units USDC 6 desimal). */
  available: bigint
  /** Jumlah yang ingin ditarik/dibelanjakan (base units). */
  requested: bigint
  /** Fee Gateway yang dipotong dari saldo Unified Balance (base units). */
  fee: bigint
}

/** 2000000n → '2', 3850n → '0.00385'. Selalu USDC 6 desimal. */
export function formatUsdcUnits(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 1_000_000n
  const fraction = String(absolute % 1_000_000n).padStart(6, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/** Pesan ketika saldo Unified Balance tidak menutup jumlah + fee Gateway. */
export function unifiedBalanceShortfallError({ chain, available, requested, fee }: UnifiedBalanceShortfall): Error {
  const total = requested + fee
  const head = `Saldo Terpadu (${chain}) tidak cukup: tersedia ${formatUsdcUnits(available)} USDC, `
    + `butuh ${formatUsdcUnits(total)} USDC = ${formatUsdcUnits(requested)} untuk withdraw + ${formatUsdcUnits(fee)} fee Gateway.`
  // Fee Gateway selalu dipotong dari saldo Unified Balance, jadi jumlah yang
  // bisa ditarik maksimum adalah saldo dikurangi fee — bukan seluruh saldo.
  if (available > fee) {
    return new Error(`${head} Turunkan jumlah withdraw ke maksimum ${formatUsdcUnits(available - fee)} USDC, atau tambah saldo Unified Balance dulu.`)
  }
  return new Error(`${head} Fee Gateway sendirian (${formatUsdcUnits(fee)} USDC) sudah melebihi saldo, jadi tambah saldo minimal ${formatUsdcUnits(total - available)} USDC dulu sebelum menarik dana.`)
}
