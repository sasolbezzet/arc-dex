import { useState } from 'react'

export interface CopyFieldProps {
  value: string
  /** Shown instead of the raw value (e.g. a shortened wallet address). */
  display?: string
  label?: string
  ariaLabel?: string
}

/** Read-only value with a copy button, styled like the rest of ARCOX. */
export function CopyField({ value, display, label, ariaLabel }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className='agent-wallet-row'>
      {label && <span>{label}</span>}
      <code>{display || value}</code>
      <button
        type='button'
        className='mini-button'
        onClick={copy}
        aria-label={ariaLabel || `Salin ${label || 'nilai'}`}
      >
        {copied ? 'Tersalin' : 'Salin'}
      </button>
    </div>
  )
}

export function shortAddress(address: string): string {
  if (!address) return '—'
  return address.length <= 14 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`
}
