import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  getMerchants,
  getCardBalance,
  syncCardBalance,
  listCards,
  createCard,
  setCardStatus,
  spendWithCard,
  refundCardTx,
  listMyCardTransactions,
  type SimCard,
  type SimMerchant,
  type CardTx,
  type CardBalance,
} from '../cardsApi'

export function CardsPanel() {
  const { t } = useI18n()
  const [merchants, setMerchants] = useState<SimMerchant[]>([])
  const [cards, setCards] = useState<SimCard[]>([])
  const [balance, setBalance] = useState<CardBalance | null>(null)
  const [transactions, setTransactions] = useState<CardTx[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  // create-card form
  const [label, setLabel] = useState('Agent Card')
  const [perTx, setPerTx] = useState('25')
  const [daily, setDaily] = useState('100')

  // spend form
  const [spendCardId, setSpendCardId] = useState('')
  const [spendMerchant, setSpendMerchant] = useState('m_arcmart')
  const [spendAmount, setSpendAmount] = useState('5')
  const [spendDescription, setSpendDescription] = useState('')

  const refresh = useCallback(async () => {
    try {
      setError('')
      const [merch, bal, cs, txs] = await Promise.all([
        getMerchants().catch(() => ({ merchants: [] as SimMerchant[] })),
        getCardBalance().catch(() => null),
        listCards().catch(() => ({ cards: [] as SimCard[] })),
        listMyCardTransactions().catch(() => ({ transactions: [] as CardTx[] })),
      ])
      setMerchants(merch.merchants || [])
      setBalance(bal && bal.ok ? bal : null)
      setCards(cs.cards || [])
      setTransactions(txs.transactions || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh().catch(() => {})
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(label: string, fn: () => Promise<any>, message?: string) {
    try {
      setBusy(label)
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

  const selectedCard = cards.find(c => c.cardId === spendCardId) || cards[0]
  const activeCardId = spendCardId || selectedCard?.cardId || ''

  return (
    <div className='pay-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>ARCOX Cards</div>
        <h2>{t('cards.title')}</h2>
        <p>{t('cards.subtitle')}</p>
        <div className='inline-warning'>⚠️ {t('cards.warning')}</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}
      {notice && <div className='inline-notice'>{notice}</div>}

      {/* Balance + issue card */}
      <section className='glass sandbox-card'>
        <h3>
          💳 {balance?.balance ? `${balance.balance} USDC` : '…'}
          {balance?.source === 'onchain' && <span className='muted'> · on-chain MSCA</span>}
        </h3>
        <div className='row'>
          {balance?.source === 'onchain' ? (
            <button
              type='button'
              className='action-button'
              disabled={busy !== ''}
              onClick={() => run('sync', () => syncCardBalance(), 'Balance synced from MSCA on-chain')}
            >
              {busy === 'sync' ? '…' : '⟳ Sync Saldo MSCA'}
            </button>
          ) : (
            <button
              type='button'
              className='action-button'
              disabled={busy !== ''}
              onClick={() => run('fund', () => fundCardBalance('50'), '+50 test USDC')}
            >
              {busy === 'fund' ? '…' : '+50 test USDC'}
            </button>
          )}
          <button
            type='button'
            className='action-button'
            disabled={busy !== ''}
            onClick={() => run('create', () => createCard({ label, perTxLimit: perTx, dailyLimit: daily }), 'Card created')}
          >
            {busy === 'create' ? '…' : t('cards.create')}
          </button>
        </div>
        <div className='form-grid'>
          <label>
            {t('cards.label')}
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder='Agent Card' />
          </label>
          <label>
            {t('cards.perTx')}
            <input value={perTx} onChange={e => setPerTx(e.target.value)} inputMode='decimal' placeholder='25' />
          </label>
          <label>
            {t('cards.daily')}
            <input value={daily} onChange={e => setDaily(e.target.value)} inputMode='decimal' placeholder='100' />
          </label>
        </div>
      </section>

      {/* Cards */}
      <section className='glass'>
        <h3>🏦 {t('cards.myCards')}</h3>
        {cards.length === 0 && <p className='muted'>{t('cards.noCards')}</p>}
        <div className='card-list'>
          {cards.map(card => (
            <div key={card.cardId} className={`card-tile ${card.status}`}>
              <div className='card-tile-head'>
                <strong>{card.label}</strong>
                <span className={`status-chip ${card.status}`}>{card.status}</span>
              </div>
              <div className='card-pan'>•••• •••• •••• {card.last4}</div>
              <div className='card-meta'>
                <span>{card.brand} · {card.expMonth}/{card.expYear}</span>
                <span>perTx {card.limits.perTx || '∞'} · daily {card.limits.daily || '∞'}</span>
                <span>today {card.usage.today} · month {card.usage.month}</span>
              </div>
              <div className='card-actions'>
                <button type='button' className='mini-button' disabled={busy !== ''} onClick={async () => {
                  const next = card.status === 'frozen' ? 'active' : 'frozen'
                  await run('status', () => setCardStatus(card.cardId, next), `Card ${next}`)
                }}>
                  {card.status === 'frozen' ? '▶ Activate' : '⏸ Freeze'}
                </button>
                <button type='button' className='mini-button' disabled={busy !== ''} onClick={async () => {
                  const ok = window.confirm('Remove this test card? Transactions stay.')
                  if (!ok) return
                  await run('status', () => setCardStatus(card.cardId, 'closed'), 'Card closed')
                }}>
                  ✕ Close
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Spend simulator */}
      <section className='glass'>
        <h3>🛍️ {t('cards.spend')}</h3>
        <div className='form-grid'>
          <label>
            {t('cards.card')}
            <select value={activeCardId} onChange={e => setSpendCardId(e.target.value)}>
              {cards.map(card => (
                <option key={card.cardId} value={card.cardId}>{card.label} •••• {card.last4}</option>
              ))}
            </select>
          </label>
          <label>
            {t('cards.merchant')}
            <select value={spendMerchant} onChange={e => setSpendMerchant(e.target.value)}>
              {merchants.map(m => (
                <option key={m.merchantId} value={m.merchantId}>{m.emoji} {m.name} ({m.category})</option>
              ))}
            </select>
          </label>
          <label>
            {t('cards.amount')}
            <input value={spendAmount} onChange={e => setSpendAmount(e.target.value)} inputMode='decimal' placeholder='5' />
          </label>
          <label>
            {t('cards.description')}
            <input value={spendDescription} onChange={e => setSpendDescription(e.target.value)} placeholder='Laptop stand' />
          </label>
        </div>
        <p className='muted'>
          {balance?.source === 'onchain'
            ? 'Spend mengirim USDC nyata (Arc Testnet) dari Agent Wallet MSCA via session key — periksa saldo on-chain sebelum bayar.'
            : 'Mode simulasi — tidak ada uang sungguhan.'}
        </p>
        <button
          type='button'
          className='action-button'
          disabled={busy !== '' || !activeCardId}
          onClick={async () => {
            const result = await run('spend', async () => spendWithCard(activeCardId, {
              merchantId: spendMerchant,
              amount: spendAmount,
              description: spendDescription,
            }))
            if (result?.approved && result?.txHash) {
              setNotice(`✅ ${result.amount} USDC settled · tx ${String(result.txHash).slice(0, 10)}…`)
            }
          }}
        >
          {busy === 'spend' ? '…' : '💳 Pay with card'}
        </button>
      </section>

      {/* Transactions */}
      <section className='glass'>
        <h3>🧾 {t('cards.transactions')}</h3>
        {transactions.length === 0 && <p className='muted'>{t('cards.noTx')}</p>}
        <table className='table'>
          <thead>
            <tr><th>{t('cards.when')}</th><th>{t('cards.merchant')}</th><th>Amount</th><th>Status</th><th>{t('cards.action')}</th></tr>
          </thead>
          <tbody>
            {transactions.slice(0, 12).map(tx => (
              <tr key={tx.id}>
                <td>{new Date(tx.createdAt).toLocaleTimeString()}</td>
                <td>{tx.merchantName} <small>{tx.description}</small></td>
                <td>{tx.amount} USDC</td>
                <td>
                  <span className={`badge-${tx.status}`}>{tx.status}{tx.declineReason ? ` (${tx.declineReason})` : ''}</span>
                  {tx.txHash && <div className='muted'><a href={tx.explorerUrl || '#'} target='_blank' rel='noreferrer'>{tx.txHash.slice(0, 10)}…</a></div>}
                </td>
                <td>
                  {tx.status === 'settled' && (
                    <button type='button' className='mini-button' disabled={busy !== ''} onClick={() => run('refund', () => refundCardTx(tx.cardId, tx.id), 'Refunded')}>
                      ↩ {t('cards.refund')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}