import type { AgentConnectionToken } from '../../types/agent'
import { useI18n } from '../../i18n'
import { CopyField } from './CopyField'

const DEFAULT_MCP_URL = 'https://arcoxdex.vercel.app/mcp'
const ARCOX_AGENT_VERSION = '0.1.27'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Build a command that never embeds the bearer token in shell history. */
export function buildHermesConnectionCommand(token: Pick<AgentConnectionToken, 'token' | 'mcpUrl'>): string {
  void token.token
  return `tmp=$(mktemp -d) && npm install --prefix "$tmp" --no-save --no-package-lock --ignore-scripts --no-audit --no-fund arcox-agent@${ARCOX_AGENT_VERSION} >/dev/null && ARCOX_MCP_URL=${shellQuote(token.mcpUrl || DEFAULT_MCP_URL)} node "$tmp/node_modules/arcox-agent/bin/arcox-agent.mjs" connect --prompt-token; status=$?; rm -rf "$tmp"; exit $status`
}

export interface ConnectionTokenDialogProps {
  token: AgentConnectionToken
  onClose: () => void
}

function formatExpiry(value?: string, locale = 'id'): string {
  if (!value) return 'tidak dibatasi'
  const asNumber = Number(value)
  const date = new Date(Number.isFinite(asNumber) && String(asNumber) === value ? asNumber : value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(locale === 'zh' ? 'zh-CN' : locale, { hour12: false, dateStyle: 'medium', timeStyle: 'short' })
}

export function ConnectionTokenDialog({ token, onClose }: ConnectionTokenDialogProps) {
  const { lang, t } = useI18n()
  const expiry = formatExpiry(token.expiresAt, lang)
  return (
    <div className='plugin-modal-backdrop' role='dialog' aria-modal='true' aria-label={t('plugin.tokenDialogLabel')}>
      <div className='glass plugin-modal'>
        <h3>{t('plugin.tokenTitle', { agent: token.agentName || 'agent' })}</h3>
        <p>{t('plugin.tokenCopy')}</p>

        <CopyField label={t('plugin.tokenLabel')} value={token.token} ariaLabel={t('plugin.tokenLabel')} />
        {token.mcpUrl && <CopyField label={t('plugin.addressLabel')} value={token.mcpUrl} ariaLabel={t('plugin.copyMcpUrl')} />}

        <div className='plugin-command-block'>
          <div className='plugin-command-heading'>
            <strong>{t('plugin.hermesCommandTitle')}</strong>
            <span>{t('plugin.hermesCommandHint')}</span>
          </div>
          <CopyField label={t('plugin.commandLabel')} value={buildHermesConnectionCommand(token)} ariaLabel={t('plugin.hermesCommandTitle')} />
          <p>{t('plugin.hermesCommandCopy')}</p>
        </div>

        {token.walletAddress && <CopyField label={t('plugin.walletLabel')} value={token.walletAddress} display={`${token.walletAddress.slice(0, 8)}…${token.walletAddress.slice(-6)}`} ariaLabel={t('plugin.copyAgentWalletAddress')} />}
        <p style={{ color: '#71809a', fontSize: 11 }}>{t('plugin.validUntil', { date: expiry })}</p>
        <div className='plugin-modal-actions'>
          <button type='button' className='action-button' onClick={onClose}>{t('plugin.backToPlugin')}</button>
        </div>
      </div>
    </div>
  )
}
