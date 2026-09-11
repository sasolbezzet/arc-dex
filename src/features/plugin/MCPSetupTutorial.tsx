import { useI18n } from '../../i18n'

/**
 * Client-facing setup guide. Keep this separate from the backend protocol:
 * Hermes uses a one-time connection token, while Claude/ChatGPT use MCP OAuth.
 */
export function MCPSetupTutorial() {
  const { t } = useI18n()

  return (
    <section className='glass plugin-mcp-tutorial' aria-labelledby='plugin-mcp-tutorial-title'>
      <div className='plugin-section-heading'>
        <div>
          <span className='section-eyebrow'>{t('plugin.tutorialTitle')}</span>
          <strong id='plugin-mcp-tutorial-title'>{t('plugin.endpointEyebrow')}</strong>
        </div>
      </div>
      <p className='plugin-muted-copy'>{t('plugin.tutorialIntro')}</p>

      <div className='plugin-mcp-tutorial-grid'>
        <article className='plugin-mcp-tutorial-card'>
          <h4>{t('plugin.tutorialHermesTitle')}</h4>
          <ol>
            <li>{t('plugin.tutorialHermes1')}</li>
            <li>{t('plugin.tutorialHermes2')}</li>
            <li>{t('plugin.tutorialHermes3')}</li>
          </ol>
        </article>
        <article className='plugin-mcp-tutorial-card'>
          <h4>{t('plugin.tutorialOAuthTitle')}</h4>
          <ol>
            <li>{t('plugin.tutorialOAuth1')}</li>
            <li>{t('plugin.tutorialOAuth2')}</li>
            <li>{t('plugin.tutorialOAuth3')}</li>
          </ol>
        </article>
      </div>

      <div className='plugin-mcp-tutorial-status'>
        <strong>{t('plugin.tutorialStatusTitle')}</strong>
        <span>{t('plugin.tutorialStatus')}</span>
      </div>
    </section>
  )
}
