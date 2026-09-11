import type { AgentType } from '../../types/agent'

interface AgentLogoProps {
  type: AgentType
  size?: number
  className?: string
}

/**
 * Local brand marks for the supported clients. Keeping these as inline SVGs
 * avoids third-party image requests and keeps the Plugin usable under the
 * application's CSP/offline fallback.
 */
export function AgentLogo({ type, size = 24, className = '' }: AgentLogoProps) {
  const label = type === 'hermes'
    ? 'Hermes by Nous Research'
    : type === 'claude'
      ? 'Claude by Anthropic'
      : type === 'chatgpt'
        ? 'ChatGPT by OpenAI'
        : type === 'grok'
          ? 'Grok by xAI'
          : 'Custom MCP agent'

  return (
    <svg
      className={`agent-logo agent-logo-${type} ${className}`}
      width={size}
      height={size}
      viewBox='0 0 48 48'
      role='img'
      aria-label={label}
      focusable='false'
    >
      <title>{label}</title>
      {type === 'hermes' && (
        <>
          <path d='M13 8c9 0 14 7 14 16s-5 16-14 16' fill='none' stroke='currentColor' strokeWidth='4.5' strokeLinecap='round' />
          <path d='M35 8c-9 0-14 7-14 16s5 16 14 16' fill='none' stroke='currentColor' strokeWidth='4.5' strokeLinecap='round' />
          <path d='M14 24h20' fill='none' stroke='currentColor' strokeWidth='4.5' strokeLinecap='round' />
        </>
      )}
      {type === 'claude' && (
        <>
          <path d='M24 4 29.2 18.8 44 24l-14.8 5.2L24 44l-5.2-14.8L4 24l14.8-5.2L24 4Z' fill='currentColor' />
          <path d='m11.5 11.5 5 5m15 15 5 5m0-25-5 5m-15 15-5 5' stroke='currentColor' strokeWidth='3.2' strokeLinecap='round' opacity='.72' />
        </>
      )}
      {type === 'chatgpt' && (
        <>
          <path d='M24 6a8.5 8.5 0 0 1 8.2 6.2A8.5 8.5 0 0 1 39 27a8.5 8.5 0 0 1-8.2 12.3A8.5 8.5 0 0 1 19 42a8.5 8.5 0 0 1-8.2-6.2A8.5 8.5 0 0 1 9 21a8.5 8.5 0 0 1 8.2-12.3A8.5 8.5 0 0 1 24 6Z' fill='none' stroke='currentColor' strokeWidth='3.2' />
          <path d='m24 14-7.8 4.5v9L24 32l7.8-4.5v-9L24 14Zm0 0v9m0 9v-9m0 0 7.8-4.5m-15.6 9L24 23' fill='none' stroke='currentColor' strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round' />
        </>
      )}
      {type === 'grok' && (
        <>
          <path d='M8 8 40 40M40 8 8 40' stroke='currentColor' strokeWidth='5' strokeLinecap='round' />
          <path d='M24 8v12M24 28v12' stroke='currentColor' strokeWidth='3.2' strokeLinecap='round' opacity='.62' />
        </>
      )}
      {type === 'custom' && (
        <path d='M24 5 39 14v20L24 43 9 34V14L24 5Z M24 13v22m-9-16 18 10m0-10L15 29' fill='none' stroke='currentColor' strokeWidth='3' strokeLinejoin='round' />
      )}
    </svg>
  )
}
