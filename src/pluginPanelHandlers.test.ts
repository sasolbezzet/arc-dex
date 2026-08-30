// Regression tests for the PluginPanel wallet handlers.
//
// Bug history: in forceRegisterMsca the destructuring
//   const { walletAddress, sessionToken } = await registerPasskey(...)
// was accidentally swallowed into the preceding `//` comment line, so the
// handler never created a wallet and crashed on the undefined binding.
// TypeScript cannot catch that class of bug when the swallowed statement is
// syntactically valid inside the comment, so these tests assert at the source
// level that every MSCA handler actually calls its passkey operation with a
// live (non-commented) statement.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, 'components/PluginPanel.tsx'), 'utf8')

/** Strip // line comments and /* block comments so assertions see live code only. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '')
}

const liveSource = stripComments(source)

/** Extract the body of `const <name> = async () => { ... }` (brace-balanced). */
function extractHandler(name: string): string {
  const marker = `const ${name} = async () => {`
  const start = liveSource.indexOf(marker)
  expect(start, `handler ${name} must exist in PluginPanel.tsx`).toBeGreaterThanOrEqual(0)
  let depth = 0
  let end = -1
  for (let i = start + marker.length - 1; i < liveSource.length; i++) {
    if (liveSource[i] === '{') depth++
    else if (liveSource[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  expect(end, `handler ${name} must have a balanced body`).toBeGreaterThan(0)
  return liveSource.slice(start, end + 1)
}

describe('PluginPanel MSCA handlers (regression: commented-out destructuring)', () => {
  it('forceRegisterMsca calls registerPasskey in live code', () => {
    const body = extractHandler('forceRegisterMsca')
    expect(body).toContain('await registerPasskey(AGENT_KEYS.claude)')
    expect(body).toContain('const { walletAddress, sessionToken }')
  })

  it('registerMsca calls registerPasskey in live code', () => {
    const body = extractHandler('registerMsca')
    expect(body).toContain('await registerPasskey(AGENT_KEYS.claude)')
    expect(body).toContain('const { walletAddress, sessionToken }')
  })

  it('loginMsca calls loginPasskey in live code', () => {
    const body = extractHandler('loginMsca')
    expect(body).toContain('await loginPasskey(AGENT_KEYS.claude)')
    expect(body).toContain('const { walletAddress, sessionToken }')
  })

  it('every handler that destructures walletAddress/sessionToken persists the session token', () => {
    for (const name of ['registerMsca', 'forceRegisterMsca', 'loginMsca']) {
      const body = extractHandler(name)
      expect(body, name).toContain("localStorage.setItem('arx_vault_token', sessionToken)")
      expect(body, name).toContain("localStorage.setItem('arx_passkey_vault_token', sessionToken)")
      expect(body, name).toContain('await autoActivateSession(walletAddress')
    }
  })

  it('registerMsca still guards against silently replacing an existing wallet', () => {
    const body = extractHandler('registerMsca')
    expect(body).toContain('getMscaState(AGENT_KEYS.claude)')
    expect(body).toContain('plugin.walletExists')
  })
})
