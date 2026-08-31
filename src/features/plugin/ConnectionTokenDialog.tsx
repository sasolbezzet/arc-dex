import type { AgentConnectionToken } from '../../types/agent'
import { CopyField } from './CopyField'

const DEFAULT_MCP_URL = 'https://arcoxdex.vercel.app/mcp'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Build the one-line command that lets Hermes configure its own remote MCP. */
export function buildHermesConnectionCommand(token: Pick<AgentConnectionToken, 'token' | 'mcpUrl'>): string {
  const message = `URL server: ${token.mcpUrl || DEFAULT_MCP_URL} Token: ${token.token}`
  // Always use the published remote-MCP connector. A local executable named
  // `arcox-agent` may be the legacy Agent Jobs CLI with a different `connect`
  // command, which would configure 127.0.0.1 instead of this token's MSCA.
  return `printf '%s\\n' ${shellQuote(message)} | npx --yes arcox-agent@0.1.20 connect`
}

export interface ConnectionTokenDialogProps {
  token: AgentConnectionToken
  onClose: () => void
}

function formatExpiry(value?: string): string {
  if (!value) return 'tidak dibatasi'
  const asNumber = Number(value)
  const date = new Date(Number.isFinite(asNumber) && String(asNumber) === value ? asNumber : value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('id-ID', { hour12: false, dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The connection token is shown exactly once — the backend stores only its
 * hash. Make that consequence explicit before the user closes the dialog.
 */
export function ConnectionTokenDialog({ token, onClose }: ConnectionTokenDialogProps) {
  return (
    <div className='plugin-modal-backdrop' role='dialog' aria-modal='true' aria-label='Token koneksi agent'>
      <div className='glass plugin-modal'>
        <h3>Token koneksi {token.agentName || 'agent'}</h3>
        <p>
          Salin sekarang. Token ini hanya ditampilkan satu kali dan tidak dapat dilihat lagi setelah
          dialog ditutup. Token bukan passkey dan bukan private key — ia hanya memberi agent akses ke
          Agent Wallet yang dipilih.
        </p>

        <CopyField label='Token' value={token.token} ariaLabel='Salin token koneksi' />
        {token.mcpUrl && <CopyField label='Alamat' value={token.mcpUrl} ariaLabel='Salin alamat MCP' />}

        <div className='plugin-command-block'>
          <div className='plugin-command-heading'>
            <strong>Perintah koneksi Hermes</strong>
            <span>Tempel ke input TUI Hermes</span>
          </div>
          <CopyField
            label='Command'
            value={buildHermesConnectionCommand(token)}
            ariaLabel='Salin perintah koneksi Hermes'
          />
          <p>Hermes akan menjalankan helper, memeriksa MCP, lalu menulis koneksi ke profilnya. Jika helper belum terpasang, command memakai npx otomatis.</p>
        </div>
        {token.walletAddress && (
          <CopyField
            label='Wallet'
            value={token.walletAddress}
            display={`${token.walletAddress.slice(0, 8)}…${token.walletAddress.slice(-6)}`}
            ariaLabel='Salin alamat wallet'
          />
        )}

        <p style={{ color: '#71809a', fontSize: 11 }}>
          Berlaku sampai {formatExpiry(token.expiresAt)}. Mencabut akses agent ini akan mematikan token
          tersebut tanpa memengaruhi agent lain.
        </p>

        <div className='plugin-modal-actions'>
          <button type='button' className='action-button' onClick={onClose}>
            Sudah disimpan
          </button>
        </div>
      </div>
    </div>
  )
}
