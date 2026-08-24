import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { loginPasskey } from '../services/modularWallet'
import {
  getCardConfig,
  getCardAccess,
  getMerchants,
  getCardBalance,
  syncCardBalance,
  listCards,
  createCard,
  provisionCard,
  setCardStatus,
  spendWithCard,
  refundCardTx,
  listMyCardTransactions,
  revealCardDetails,
  type SimCard,
  type SimMerchant,
  type CardTx,
  type CardBalance,
  type CardAccess,
  type ProvisionedCard,
} from '../cardsApi'

function shortProvider(value: string | undefined | null) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Simulator'
}

function formatDate(value: string) {
  try { return new Date(value).toLocaleString() } catch { return value }
}

function formatCardPan(value: string) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.replace(/(.{4})/g, '$1 ').trim() || value
}

export function CardsPanel() {
  const { t } = useI18n()
  const [config, setConfig] = useState<any>(null)
  const [access, setAccess] = useState<CardAccess | null>(null)
  const [merchants, setMerchants] = useState<SimMerchant[]>([])
  const [cards, setCards] = useState<SimCard[]>([])
  const [balance, setBalance] = useState<CardBalance | null>(null)
  const [transactions, setTransactions] = useState<CardTx[]>([])
  const [revealedCard, setRevealedCard] = useState<ProvisionedCard | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  const [label, setLabel] = useState('ARCOX Agent Card')
  const [perTx, setPerTx] = useState('25')
  const [daily, setDaily] = useState('100')
  const [spendCardId, setSpendCardId] = useState('')
  const [spendMerchant, setSpendMerchant] = useState('m_arcmart')
  const [spendAmount, setSpendAmount] = useState('5')
  const [spendDescription, setSpendDescription] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    const [cfg, cardAccess, merch, bal, cs, txs] = await Promise.all([
      getCardConfig().catch(() => null),
      getCardAccess().catch(() => null),
      getMerchants().catch(() => ({ merchants: [] as SimMerchant[] })),
      getCardBalance().catch(() => null),
      listCards().catch(() => ({ cards: [] as SimCard[] })),
      listMyCardTransactions().catch(() => ({ transactions: [] as CardTx[] })),
    ])
    setConfig(cfg)
    setAccess(cardAccess)
    setMerchants(merch.merchants || [])
    setBalance(bal && bal.ok ? bal : null)
    setCards(cs.cards || [])
    setTransactions(txs.transactions || [])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { refresh().catch(() => {}) }, 0)
    return () => clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!revealedCard) return
    const timer = setTimeout(() => setRevealedCard(null), 60_000)
    return () => clearTimeout(timer)
  }, [revealedCard])

  async function run(action: string, fn: () => Promise<any>, message?: string) {
    try {
      setBusy(action)
      setError('')
      setNotice('')
      const result = await fn()
      if (result?.message && !result?.approved) setError(result.message)
      else if (message) setNotice(message)
      await refresh()
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/Active authenticated MSCA session required/i.test(message)) {
        setAccess(current => ({ ...(current || { ok: true }), active: false, requiresPasskey: true, statusReason: 'setup_required' }))
      }
      setError(message)
    } finally {
      setBusy('')
    }
  }

  async function issueExistingCard(card: SimCard) {
    // Provisioning never returns PAN/CVV. Details are revealed only after the
    // owner completes a fresh biometric/passkey assertion below.
    return provisionCard(card.cardId, card.label)
  }

  async function authenticateAndReveal(card: SimCard) {
    const fresh = await loginPasskey()
    // Keep the newly issued short-lived vault session for subsequent Card API
    // calls. The backend still requires an active MSCA session for every read.
    localStorage.setItem('arx_vault_token', fresh.sessionToken)
    localStorage.setItem('arx_passkey_vault_token', fresh.sessionToken)
    const result = await revealCardDetails(card.cardId, fresh.sessionToken)
    setRevealedCard(result.card)
    return result
  }

  async function authenticateAndPay() {
    const fresh = await loginPasskey()
    localStorage.setItem('arx_vault_token', fresh.sessionToken)
    localStorage.setItem('arx_passkey_vault_token', fresh.sessionToken)
    return spendWithCard(activeCardId, { merchantId: spendMerchant, amount: spendAmount, description: spendDescription }, fresh.sessionToken)
  }

  async function createAndIssue() {
    const created = await createCard({ label, perTxLimit: perTx, dailyLimit: daily })
    if (!created?.card?.cardId) throw new Error('Card record was not created')
    const issuerConfigured = Boolean(config?.issuer?.configured && config?.issuer?.provider !== 'simulator')
    if (!issuerConfigured) {
      setNotice('Local test card created. Enable the Lithic sandbox issuer to issue a Visa test card.')
      return created
    }
    return issueExistingCard(created.card)
  }

  const issuer = config?.issuer?.configured ? config.issuer.provider : 'simulator'
  const isRealSandbox = issuer !== 'simulator'
  const mscaActive = access?.active === true
  const selectedCard = cards.find(c => c.cardId === spendCardId) || cards[0]
  const activeCardId = spendCardId || selectedCard?.cardId || ''

  return (
    <div className='cards-page'>
      <section className='glass cards-hero'>
        <div className='cards-hero-copy'>
          <div className='docs-kicker'>ARCOX CARD CONTROL · {shortProvider(issuer)} sandbox</div>
          <h2>{t('cards.title')}</h2>
          <p>{isRealSandbox
            ? t('cards.realSubtitle')
            : t('cards.subtitle')}</p>
        </div>
        <div className='cards-hero-badge'>
          <span className='cards-status-dot' />
          <strong>{isRealSandbox ? t('cards.testMode') : t('cards.simulator')}</strong>
          <small>{t('cards.arcUsdc')}</small>
        </div>
      </section>

      {error && <div className='inline-error'>{error}</div>}
      {notice && <div className='inline-notice'>{notice}</div>}
      {access && !access.active && (
        <section className='glass cards-access-gate'>
          <div className='cards-access-icon'>!</div>
          <div className='cards-access-copy'>
            <strong>{t('cards.sessionTitle')}</strong>
            <p>{t('cards.sessionCopy')}</p>
            <small>{t('cards.sessionStatus')}: {access.statusReason || 'inactive'}</small>
          </div>
          <button type='button' className='action-button' onClick={() => { window.location.assign('/arc-dex/plugin') }}>{t('cards.activateSession')}</button>
        </section>
      )}

      <section className='cards-overview-grid'>
        <div className='glass cards-balance-panel'>
          <div className='section-eyebrow'>{t('cards.availableBalance')}</div>
          <div className='cards-balance'>{balance?.balance || '—'} <small>USDC</small></div>
          <div className='cards-balance-source'>
            <span className='cards-status-dot' />
            {access === null ? t('cards.sessionChecking') : balance?.source === 'onchain' ? t('cards.syncSource') : t('cards.localBalance')}
          </div>
          <button type='button' className='text-button' disabled={busy !== '' || !mscaActive} onClick={() => run('sync', () => syncCardBalance(), 'MSCA balance synced')}>
            {busy === 'sync' ? 'Syncing…' : `↻ ${t('cards.syncMsca')}`}
          </button>
        </div>

        <div className='glass card-create-panel'>
          <div className='section-eyebrow'>{isRealSandbox ? t('cards.issueTitle') : t('cards.createTitle')}</div>
          <div className='card-create-title'>
            <span className='card-chip-icon'>▦</span>
            <div><strong>{isRealSandbox ? t('cards.newVirtual') : t('cards.localVirtual')}</strong><small>{isRealSandbox ? t('cards.poweredLithic') : t('cards.enableIssuer')}</small></div>
          </div>
          <div className='card-create-form'>
            <label>{t('cards.cardName')}<input value={label} onChange={e => setLabel(e.target.value)} maxLength={60} /></label>
            <label>{t('cards.cardLimit')}<input value={perTx} onChange={e => setPerTx(e.target.value)} inputMode='decimal' /></label>
            <label>{t('cards.dailyLimit')}<input value={daily} onChange={e => setDaily(e.target.value)} inputMode='decimal' /></label>
          </div>
          <button type='button' className='action-button card-primary-action' disabled={busy !== '' || !mscaActive} onClick={() => run('create', createAndIssue, isRealSandbox ? 'Visa sandbox card issued' : 'Test card created')}>
            {busy === 'create' ? 'Issuing card…' : isRealSandbox ? `＋ ${t('cards.issueCard')}` : t('cards.create')}
          </button>
        </div>
      </section>

      <section className='glass cards-section'>
        <div className='cards-section-heading'>
          <div><div className='section-eyebrow'>{t('cards.yourWallet')}</div><h3>{t('cards.myCards')}</h3></div>
          <span className='cards-count'>{cards.length} / {config?.maxCardsPerOwner || 10}</span>
        </div>
        {cards.length === 0 && <div className='cards-empty'><span>▣</span><p>{t('cards.noCards')}</p></div>}
        <div className='card-list'>
          {cards.map(card => (
            <article key={card.cardId} className={`card-tile card-tile-premium ${card.status} ${revealedCard?.cardId === card.cardId ? 'revealed' : ''}`}>
              {(() => {
                const isRevealed = revealedCard?.cardId === card.cardId
                return <>
                  <div className='card-tile-glow' aria-hidden='true' />
                  <div className='card-tile-top'>
                    <span className='card-brand-mark'><span className='card-brand-orbit'>◈</span> ARCOX <b>VISA</b></span>
                    <span className={`status-chip ${card.status}`}>{card.status}</span>
                  </div>
                  <div className='card-tile-art' aria-hidden='true'>
                    <span className='card-emv-chip'><i /><i /><i /><i /></span>
                    <span className='card-contactless'>)))</span>
                  </div>
                  <div className='card-tile-number' aria-label={isRevealed ? t('cards.cardNumber') : undefined}>
                    {isRevealed ? formatCardPan(revealedCard.pan) : <>•••• <span>••••</span> <span>••••</span> <strong>{card.last4}</strong></>}
                  </div>
                  {isRevealed ? (
                    <div className='card-tile-sensitive' role='status'>
                      <div><small>{t('cards.cvv')}</small><strong>{revealedCard.cvv || '—'}</strong></div>
                      <div><small>{t('cards.validThru')}</small><strong>{revealedCard.expMonth}/{revealedCard.expYear}</strong></div>
                      <div><small>{t('cards.cardName')}</small><strong>{card.label}</strong></div>
                    </div>
                  ) : (
                    <div className='card-tile-bottom'>
                      <div><small>{t('cards.cardName')}</small><strong>{card.label}</strong></div>
                      <div><small>{t('cards.validThru')}</small><strong>{card.expMonth}/{card.expYear}</strong></div>
                      <div><small>{t('cards.issuer')}</small><strong>{shortProvider(card.provider)}</strong></div>
                    </div>
                  )}
                  <div className='card-tile-footer'>
                    <span>{isRevealed ? `⌁ ${t('cards.issuedTitle')}` : `${card.limits.perTx || '∞'} / tx · ${card.limits.daily || '∞'} / day`}</span>
                    <div className='card-actions'>
                      {card.status !== 'closed' && (isRevealed
                        ? <button type='button' className='mini-button mini-button-primary' onClick={() => setRevealedCard(null)}>{t('cards.hideDetails')}</button>
                        : <button type='button' className='mini-button mini-button-primary' disabled={busy !== '' || !mscaActive} onClick={() => run(`reveal-${card.cardId}`, () => authenticateAndReveal(card))}>{busy === `reveal-${card.cardId}` ? t('cards.authenticating') : `⌁ ${t('cards.viewDetails')}`}</button>)}
                      {isRealSandbox && card.provider === 'simulator' && card.status === 'active' && <button type='button' className='mini-button mini-button-primary' disabled={busy !== '' || !mscaActive} onClick={() => run('provision', () => issueExistingCard(card), 'Visa sandbox card issued')}>{t('cards.issueVisa')}</button>}
                      <button type='button' className='mini-button' disabled={busy !== '' || card.status === 'closed'} onClick={() => run('status', () => setCardStatus(card.cardId, card.status === 'frozen' ? 'active' : 'frozen'), card.status === 'frozen' ? 'Card activated' : 'Card frozen')}>
                        {card.status === 'frozen' ? '▶ Activate' : '⏸ Freeze'}
                      </button>
                      {card.status !== 'closed' && <button type='button' className='mini-button' disabled={busy !== ''} onClick={() => { if (window.confirm('Close this test card?')) run('status', () => setCardStatus(card.cardId, 'closed'), 'Card closed') }}>Close</button>}
                    </div>
                  </div>
                </>
              })()}
            </article>
          ))}
        </div>
      </section>

      <section className='cards-lower-grid'>
        <div className='glass cards-section spend-panel'>
          <div className='section-eyebrow'>{t('cards.agentSpend')}</div><h3>{t('cards.spend')}</h3>
          <div className='card-create-form'>
            <label>{t('cards.card')}<select value={activeCardId} onChange={e => setSpendCardId(e.target.value)}>{cards.map(card => <option key={card.cardId} value={card.cardId}>{card.label} ···· {card.last4}</option>)}</select></label>
            <label>{t('cards.merchant')}<select value={spendMerchant} onChange={e => setSpendMerchant(e.target.value)}>{merchants.map(m => <option key={m.merchantId} value={m.merchantId}>{m.emoji} {m.name}</option>)}</select></label>
            <label>{t('cards.amount')}<input value={spendAmount} onChange={e => setSpendAmount(e.target.value)} inputMode='decimal' /></label>
            <label>{t('cards.description')}<input value={spendDescription} onChange={e => setSpendDescription(e.target.value)} placeholder='Software subscription' /></label>
          </div>
          <p className='muted'>{balance?.source === 'onchain' ? t('cards.mscaSettlement') : t('cards.noRealFunds')}</p>
          <button type='button' className='action-button' disabled={busy !== '' || !activeCardId || !mscaActive} onClick={() => run('spend', authenticateAndPay, 'Payment settled')}>
            {busy === 'spend' ? t('cards.authenticatingPayment') : `🔐 ${t('cards.payWithCard')}`}
          </button>
        </div>

        <div className='glass cards-section transactions-panel'>
          <div className='section-eyebrow'>{t('cards.activity')}</div><h3>{t('cards.transactions')}</h3>
          {transactions.length === 0 ? <p className='muted'>{t('cards.noTx')}</p> : <div className='transaction-list'>{transactions.slice(0, 8).map(tx => <div className='transaction-row' key={tx.id}><span className={`transaction-icon ${tx.status}`}>{tx.status === 'settled' ? '✓' : tx.status === 'refunded' ? '↩' : '•'}</span><div><strong>{tx.merchantName}</strong><small>{formatDate(tx.createdAt)}</small></div><b>{tx.amount} USDC</b><span className={`badge-${tx.status}`}>{tx.status}</span>{tx.status === 'settled' && <button type='button' className='mini-button' disabled={busy !== ''} onClick={() => run('refund', () => refundCardTx(tx.cardId, tx.id), 'Refunded')}>{t('cards.refund')}</button>}</div>)}</div>}
        </div>
      </section>
    </div>
  )
}
