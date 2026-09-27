// flowErrors.ts — klasifikasi kegagalan swap/bridge untuk pesan UI.
//
// Produksi pernah menampilkan pesan mentah (mis. "The entity secret has not
// been set yet" atau "Insufficient token balance on Arc") yang tidak memberi
// tahu pengguna apa yang harus dilakukan. Modul ini memetakan kegagalan ke
// penyebab yang bisa ditindaklanjuti: saldo, route, konfigurasi jaringan,
// sesi wallet, atau pembatasan laju.
import type { MessageKey } from '../i18n'

export type FlowContext = 'swap' | 'bridge'
export type FlowErrorCode = 'insufficient_balance' | 'no_route' | 'config' | 'auth' | 'chain_unsupported' | 'rate_limit' | 'unknown'

type Translator = (key: MessageKey, params?: Record<string, string | number>) => string

// Urutan penting: pola paling spesifik lebih dulu (mis. "insufficient balance"
// tidak boleh jatuh ke pola generik).
const PATTERNS: Array<{ code: FlowErrorCode; test: RegExp }> = [
  { code: 'insufficient_balance', test: /insufficient (?:token )?balance|insufficient funds|insufficient allowance|not enough (?:funds|balance|token)|exceeds (?:balance|allowance)|saldo .*tidak (?:cukup|mencukupi)|saldo tidak mencukupi/i },
  { code: 'no_route', test: /no route|route (?:is )?not (?:available|found|supported)|NO_SWAP_ROUTE|swap route not found|route tidak tersedia|belum tersedia untuk (?:pasangan|route)/i },
  { code: 'chain_unsupported', test: /unsupported_chain|msca_unsupported|unknown chain|not supported on|tidak didukung|only available for source/i },
  { code: 'config', test: /entity secret|belum dikonfigurasi|not configured|not been set yet|belum di-?deploy|belum siap|router belum tersedia|SDK Circle|_MAINNET|Missing params|Unsupported token/i },
  { code: 'auth', test: /wallet authentication required|owner session|owner_session|unauthorized|\b401\b|session (?:expired|invalid|required)|vault token/i },
  { code: 'rate_limit', test: /\b429\b|too many requests|rate ?limit/i },
]

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message || '')
  return error ? String(error) : ''
}

/** Penyebab kegagalan + pesan asli untuk ditampilkan sebagai detail. */
export function classifyFlowError(error: unknown): { code: FlowErrorCode; detail: string } {
  const detail = messageOf(error)
  for (const pattern of PATTERNS) {
    if (pattern.test.test(detail)) return { code: pattern.code, detail }
  }
  return { code: 'unknown', detail }
}

const BODY_KEYS: Record<FlowErrorCode, MessageKey> = {
  insufficient_balance: 'flow.balance',
  no_route: 'flow.route',
  config: 'flow.config',
  auth: 'flow.auth',
  chain_unsupported: 'flow.chain',
  rate_limit: 'flow.rateLimit',
  unknown: 'flow.unknown',
}

const HINT_KEYS: Record<FlowErrorCode, MessageKey> = {
  insufficient_balance: 'flow.balanceHint',
  no_route: 'flow.routeHint',
  config: 'flow.configHint',
  auth: 'flow.authHint',
  chain_unsupported: 'flow.chainHint',
  rate_limit: 'flow.rateLimitHint',
  unknown: 'flow.unknownHint',
}

/** Judul + penyebab + saran, sudah diterjemahkan. Pesan asli tidak pernah
 * dibuang: untuk error tak dikenal pesan asli dipakai sebagai penjelasan
 * (banyak pesan internal sudah spesifik, mis. menyebut jumlah dan chain),
 * sedangkan untuk error yang sudah diklasifikasi pesan asli tampil sebagai
 * rincian supaya angka/alamat yang disebutkan tetap terlihat. */
export function flowErrorText(t: Translator, error: unknown, context: FlowContext): string {
  const { code, detail } = classifyFlowError(error)
  const title = t(context === 'bridge' ? 'flow.titleBridge' : 'flow.titleSwap')
  const known = code !== 'unknown'
  const body = known || !detail ? t(BODY_KEYS[code]) : detail
  const lines = [title, body, t(HINT_KEYS[code])]
  if (known && detail) lines.push(t('flow.detail', { detail: detail.slice(0, 300) }))
  return lines.join('\n')
}

/** Sama seperti flowErrorText, untuk payload yang sudah berisi pesan (bukan exception). */
export function flowErrorTextFromMessage(t: Translator, message: unknown, context: FlowContext): string {
  return flowErrorText(t, message, context)
}
