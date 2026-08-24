import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  getCardConfig,
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
  type SimCard,
  type SimMerchant,
  type CardTx,
  type CardBalance,
  type ProvisionedCard,
} from '../cardsApi'

function shortProvider(value: string | undefined | null) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Simulator'
}

function formatDate(value: string) {
  try { return new Date(value).toLocaleString() } catch { return value }
}

export function CardsPanel() {
  const { t } = useI18n()
  const [config, setConfig] = useState<any>(null)
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
    const [cfg, merch, bal, cs, txs] = await Promise.all([
      getCardConfig().catch(() => null),
      getMerchants().catch(() => ({ merchants: [] as SimMerchant[] })),
      getCardBalance().catch(() => null),
      listCards().catch(() => ({ cards: [] as SimCard[] })),
      listMyCardTransactions().catch(() => ({ transactions: [] as CardTx[] })),
    ])
    setConfig(cfg)
    setMerchants(merch.merchants || [])
    setBalance(bal && bal.ok ? bal : null)
    setCards(cs.cards || [])
    setTransactions(txs.transactions || [])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { refresh().catch(() => {}) }, 0)
    return () => clearTimeout(timer)
  }, [refresh])

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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function issueExistingCard(card: SimCard) {
    const issued = await provisionCard(card.cardId, card.label)
    if (issued.sensitive && issued.card?.pan) setRevealedCard(issued.card)
    return issued
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
  const selectedCard = cards.find(c => c.cardId === spendCardId) || cards[0]
  const activeCardId = spendCardId || selectedCard?.cardId || ''

  return (
    <div className='cards-page'>
      <section className='glass cards-hero'>
        <div className='cards-hero-copy'>
          <div className='docs-kicker'>ARCOX CARD CONTROL · {shortProvider(issuer)} sandbox</div>
          <h2>{t('cards.title')}</h2>
          <p>{isRealSandbox
            ? 'Buat kartu Visa virtual sandbox langsung dari ARCOX. Kartu diterbitkan oleh Lithic untuk pengujian, sedangkan saldo dan kebijakan tetap dikontrol oleh ARCOX.'
            : t('cards.subtitle')}</p>
        </div>
        <div className='cards-hero-badge'>
          <span className='cards-status-dot' />
          <strong>{isRealSandbox ? 'TEST MODE' : 'SIMULATOR'}</strong>
          <small>Arc Testnet · USDC</small>
        </div>
      </section>

      {error && <div className='inline-error'>{error}</div>}
      {notice && <div className='inline-notice'>{notice}</div>}

      {revealedCard && (
        <section className='glass card-details-alert'>
          <div>
            <strong>Card issued successfully</strong>
            <p>Save these details now. PAN and CVV are shown only in this session and will not be shown again from the card list.</p>
          </div>
          <div className='issued-card-details'>
            <div><span>Card number</span><code>{revealedCard.pan}</code></div>
            <div><span>CVV</span><code>{revealedCard.cvv || '—'}</code></div>
            <div><span>Expires</span><code>{revealedCard.expMonth}/{revealedCard.expYear}</code></div>
          </div>
          <button type='button' className='mini-button' onClick={() => setRevealedCard(null)}>Hide details</button>
        </section>
      )}

      <section className='cards-overview-grid'>
        <div className='glass cards-balance-panel'>
          <div className='section-eyebrow'>AVAILABLE BALANCE</div>
          <div className='cards-balance'>{balance?.balance || '—'} <small>USDC</small></div>
          <div className='cards-balance-source'>
            <span className='cards-status-dot' />
            {balance?.source === 'onchain' ? 'Synced from MSCA on Arc Testnet' : 'Local test balance'}
          </div>
          <button type='button' className='text-button' disabled={busy !== ''} onClick={() => run('sync', () => syncCardBalance(), 'MSCA balance synced')}>
            {busy === 'sync' ? 'Syncing…' : '↻ Sync MSCA balance'}
          </button>
        </div>

        <div className='glass card-create-panel'>
          <div className='section-eyebrow'>{isRealSandbox ? 'ISSUE A VISA TEST CARD' : 'CREATE A TEST CARD'}</div>
          <div className='card-create-title'>
            <span className='card-chip-icon'>▦</span>
            <div><strong>{isRealSandbox ? 'New virtual card' : 'Local virtual card'}</strong><small>{isRealSandbox ? 'Powered by Lithic Sandbox' : 'Enable issuer for network card'}</small></div>
          </div>
          <div className='card-create-form'>
            <label>Card name<input value={label} onChange={e => setLabel(e.target.value)} maxLength={60} /></label>
            <label>Per transaction<input value={perTx} onChange={e => setPerTx(e.target.value)} inputMode='decimal' /></label>
            <label>Daily limit<input value={daily} onChange={e => setDaily(e.target.value)} inputMode='decimal' /></label>
          </div>
          <button type='button' className='action-button card-primary-action' disabled={busy !== ''} onClick={() => run('create', createAndIssue, isRealSandbox ? 'Visa sandbox card issued' : 'Test card created')}>
            {busy === 'create' ? 'Issuing card…' : isRealSandbox ? '＋ Issue Visa test card' : t('cards.create')}
          </button>
        </div>
      </section>

      <section className='glass cards-section'>
        <div className='cards-section-heading'>
          <div><div className='section-eyebrow'>YOUR WALLET</div><h3>{t('cards.myCards')}</h3></div>
          <span className='cards-count'>{cards.length} / {config?.maxCardsPerOwner || 10}</span>
        </div>
        {cards.length === 0 && <div className='cards-empty'><span>▣</span><p>{t('cards.noCards')}</p></div>}
        <div className='card-list'>
          {cards.map(card => (
            <article key={card.cardId} className={`card-tile ${card.status}`}>
              <div className='card-tile-top'><span className='card-brand-mark'>ARCOX <b>VISA</b></span><span className={`status-chip ${card.status}`}>{card.status}</span></div>
              <div className='card-tile-number'>•••• <span>••••</span> <span>••••</span> <strong>{card.last4}</strong></div>
              <div className='card-tile-bottom'>
                <div><small>CARD NAME</small><strong>{card.label}</strong></div>
                <div><small>VALID THRU</small><strong>{card.expMonth}/{card.expYear}</strong></div>
                <div><small>ISSUER</small><strong>{shortProvider(card.provider)}</strong></div>
              </div>
              <div className='card-tile-footer'>
                <span>{card.limits.perTx || '∞'} / tx · {card.limits.daily || '∞'} / day</span>
                <div className='card-actions'>
                  {isRealSandbox && card.provider === 'simulator' && card.status === 'active' && <button type='button' className='mini-button mini-button-primary' disabled={busy !== ''} onClick={() => run('provision', () => issueExistingCard(card), 'Visa sandbox card issued')}>Issue Visa</button>}
                  <button type='button' className='mini-button' disabled={busy !== '' || card.status === 'closed'} onClick={() => run('status', () => setCardStatus(card.cardId, card.status === 'frozen' ? 'active' : 'frozen'), card.status === 'frozen' ? 'Card activated' : 'Card frozen')}>
                    {card.status === 'frozen' ? '▶ Activate' : '⏸ Freeze'}
                  </button>
                  {card.status !== 'closed' && <button type='button' className='mini-button' disabled={busy !== ''} onClick={() => { if (window.confirm('Close this test card?')) run('status', () => setCardStatus(card.cardId, 'closed'), 'Card closed') }}>Close</button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className='cards-lower-grid'>
        <div className='glass cards-section spend-panel'>
          <div className='section-eyebrow'>AGENT SPEND</div><h3>{t('cards.spend')}</h3>
          <div className='card-create-form'>
            <label>{t('cards.card')}<select value={activeCardId} onChange={e => setSpendCardId(e.target.value)}>{cards.map(card => <option key={card.cardId} value={card.cardId}>{card.label} ···· {card.last4}</option>)}</select></label>
            <label>{t('cards.merchant')}<select value={spendMerchant} onChange={e => setSpendMerchant(e.target.value)}>{merchants.map(m => <option key={m.merchantId} value={m.merchantId}>{m.emoji} {m.name}</option>)}</select></label>
            <label>{t('cards.amount')}<input value={spendAmount} onChange={e => setSpendAmount(e.target.value)} inputMode='decimal' /></label>
            <label>{t('cards.description')}<input value={spendDescription} onChange={e => setSpendDescription(e.target.value)} placeholder='Software subscription' /></label>
          </div>
          <p className='muted'>{balance?.source === 'onchain' ? 'Settlement debits USDC from the MSCA wallet on Arc Testnet.' : 'Test mode: no real funds move.'}</p>
          <button type='button' className='action-button' disabled={busy !== '' || !activeCardId} onClick={() => run('spend', () => spendWithCard(activeCardId, { merchantId: spendMerchant, amount: spendAmount, description: spendDescription }), 'Payment settled')}>
            {busy === 'spend' ? 'Processing…' : '💳 Pay with card'}
          </button>
        </div>

        <div className='glass cards-section transactions-panel'>
          <div className='section-eyebrow'>ACTIVITY</div><h3>{t('cards.transactions')}</h3>
          {transactions.length === 0 ? <p className='muted'>{t('cards.noTx')}</p> : <div className='transaction-list'>{transactions.slice(0, 8).map(tx => <div className='transaction-row' key={tx.id}><span className={`transaction-icon ${tx.status}`}>{tx.status === 'settled' ? '✓' : tx.status === 'refunded' ? '↩' : '•'}</span><div><strong>{tx.merchantName}</strong><small>{formatDate(tx.createdAt)}</small></div><b>{tx.amount} USDC</b><span className={`badge-${tx.status}`}>{tx.status}</span>{tx.status === 'settled' && <button type='button' className='mini-button' disabled={busy !== ''} onClick={() => run('refund', () => refundCardTx(tx.cardId, tx.id), 'Refunded')}>{t('cards.refund')}</button>}</div>)}</div>}
        </div>
      </section>
    </div>
  )
}
