import type { AgentConnectionToken } from '../../types/agent'
import { CopyField } from './CopyField'

const DEFAULT_MCP_URL = 'https://arcoxdex.vercel.app/mcp'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Build a command that never embeds the bearer token in shell history. */
export function buildHermesConnectionCommand(token: Pick<AgentConnectionToken, 'token' | 'mcpUrl'>): string {
  void token.token
  return `ARCOX_MCP_URL=${shellQuote(token.mcpUrl || DEFAULT_MCP_URL)} npx --yes arcox-agent@0.1.20 connect --prompt-token`
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

export function ConnectionTokenDialog({ token, onClose }: ConnectionTokenDialogProps) {
  return (
    <div className='plugin-modal-backdrop' role='dialog' aria-modal='true' aria-label='Token koneksi agent'>
      <div className='glass plugin-modal'>
        <h3>Token koneksi {token.agentName || 'agent'}</h3>
        <p>
          Salin token hanya ke Hermes melalui prompt rahasia. Token ini hanya ditampilkan satu kali,
          bukan passkey, dan bukan private key.
        </p>

        <CopyField label='Token' value={token.token} ariaLabel='Salin token koneksi' />
        {token.mcpUrl && <CopyField label='Alamat' value={token.mcpUrl} ariaLabel='Salin alamat MCP' />}

        <div className='plugin-command-block'>
          <div className='plugin-command-heading'>
            <strong>Perintah koneksi Hermes</strong>
            <span>Tempel ke terminal/TUI yang menjalankan connector</span>
          </div>
          <CopyField label='Command' value={buildHermesConnectionCommand(token)} ariaLabel='Salin perintah koneksi Hermes' />
          <p>Jalankan command ini. Hermes akan meminta token secara tersembunyi; token tidak masuk ke command, argumen proses, output, atau shell history.</p>
        </div>

        {token.walletAddress && <CopyField label='Wallet' value={token.walletAddress} display={`${token.walletAddress.slice(0, 8)}…${token.walletAddress.slice(-6)}`} ariaLabel='Salin alamat wallet' />}
        <p style={{ color: '#71809a', fontSize: 11 }}>Berlaku sampai {formatExpiry(token.expiresAt)}.</p>
        <div className='plugin-modal-actions'>
          <button type='button' className='action-button' onClick={onClose}>Sudah disimpan</button>
        </div>
      </div>
    </div>
  )
}
