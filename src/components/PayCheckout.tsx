import { useEffect, useMemo, useState } from 'react'
import { estimateSendTokenFromEoa, sendTokenFromEoa } from '../services/eoaTransactions'
import { ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { getInvoice, markInvoicePaid, quoteEcoRoute } from '../payApi'
import type { ArcoxInvoice } from '../payApi'
import { findConnectedWalletProvider, normalizeWalletProvider } from '../walletProvider'
import { useI18n } from '../i18n'

type Props = {
  address: string | null
  onConnect: (address: string) => Promise<void> | void
  onRefresh?: () => void
}

export function PayCheckout({ address, onConnect, onRefresh }: Props) {
  const invoiceId = useMemo(() => new URLSearchParams(window.location.search).get('invoice') || '', [])
  const [invoice, setInvoice] = useState<ArcoxInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [paymentMode, setPaymentMode] = useState<'arc-eoa' | 'cross-chain'>('arc-eoa')
  const [sourceChain, setSourceChain] = useState('base-sepolia')
  const { t } = useI18n()

  const load = async () => {
    if (!invoiceId) {
      setError('Missing invoice id.')
      setLoading(false)
      return
    }
    try {
      setError('')
      setInvoice(await getInvoice(invoiceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const connectWallet = async () => {
    const provider = await findConnectedWalletProvider()
    if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
    const accounts = await normalizeWalletProvider(provider).request({ method: 'eth_requestAccounts' })
    if (!accounts?.[0]) throw new Error('Wallet address tidak ditemukan.')
    await onConnect(accounts[0])
  }

  const preparePayment = async () => {
    if (!invoice) return
    if (!address) {
      await connectWallet()
      return
    }
    if (invoice.status !== 'unpaid' && invoice.status !== 'pending') throw new Error(`Invoice status is ${invoice.status}.`)
    setBusy(true)
    try {
      if (paymentMode === 'cross-chain') {
        const route = await quoteEcoRoute({
          sourceChain,
          destinationChain: 'arc-testnet',
          sourceToken: invoice.token,
          destinationToken: invoice.token,
          amount: invoice.amount,
          recipient: invoice.merchantAddress,
          invoiceId: invoice.invoiceId,
        })
        setPreview({
          type: 'cross-chain',
          invoiceId: invoice.invoiceId,
          from: address,
          to: invoice.merchantAddress,
          amount: invoice.amount,
          token: invoice.token,
          sourceChain,
          network: 'Arc Testnet',
          route,
        })
        return
      }
      const estimate = await estimateSendTokenFromEoa({
        from: address,
        to: invoice.merchantAddress,
        token: invoice.token,
        amount: invoice.amount,
      }).catch((e) => ({ error: e instanceof Error ? e.message : 'Estimate failed' }))
      setPreview({
        type: 'arc-eoa',
        invoiceId: invoice.invoiceId,
        from: address,
        to: invoice.merchantAddress,
        amount: invoice.amount,
        token: invoice.token,
        network: 'Arc Testnet',
        estimate,
      })
    } finally {
      setBusy(false)
    }
  }

  const confirmAndPay = async () => {
    if (!invoice || !address || !preview) return
    if (preview.type !== 'arc-eoa') return
    setBusy(true)
    try {
      const sent = await sendTokenFromEoa({
        from: address,
        to: invoice.merchantAddress,
        token: invoice.token,
        amount: invoice.amount,
      })
      const txHash = sent.txHash
      setInvoice(current => current ? { ...current, status: 'pending', txHash, payerAddress: address } : current)
      setPreview(null)
      const receipt = await waitForReceipt(txHash, address)
      if (receipt?.status === '0x0') {
        setInvoice(current => current ? { ...current, status: 'failed', txHash, payerAddress: address } : current)
      } else if (receipt?.status === '0x1') {
        setInvoice(await markInvoicePaid(invoice.invoiceId, { txHash, payerAddress: address }))
      }
      onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='pay-page'>
      <div className='glass pay-shell'>
        <div className='pay-title-row'>
          <div>
            <div className='docs-kicker'>ARCOX Pay</div>
            <h2>{t('pay.request')}</h2>
          </div>
          {invoice && <span className={`pay-status ${invoice.status}`}>{invoice.status}</span>}
        </div>

        {loading && <p className='pay-muted'>{t('pay.loading')}</p>}
        {error && <div className='inline-error'>{error}</div>}

        {invoice && (
          <>
            <div className='pay-grid'>
              <Info label='You Pay' value={`${invoice.amount} ${invoice.token}`} />
              <Info label='Merchant Receives' value={`${invoice.amount} ${invoice.token} on Arc Testnet`} />
              <Info label='Receiver Wallet' value={invoice.merchantAddress} mono />
              <Info label='Your Wallet' value={address || 'Connect wallet to continue'} mono />
              <Info label='Order ID' value={invoice.orderId || '-'} />
              <Info label='Memo' value={invoice.memo || '-'} />
              <Info label='Expires At' value={new Date(invoice.expiresAt).toLocaleString()} />
              <Info label='Invoice ID' value={invoice.invoiceId} />
            </div>

            <div className='pay-stepper'>
              {['Review invoice', 'Choose wallet', 'Preview fee', 'Confirm payment', 'Payment complete'].map((item, idx) => (
                <div className='pay-step' key={item}>
                  <span>{idx + 1}</span>
                  <strong>{item}</strong>
                </div>
              ))}
            </div>

            <div className='pay-methods'>
              <button type='button' className={paymentMode === 'arc-eoa' ? 'active' : ''} onClick={() => { setPaymentMode('arc-eoa'); setPreview(null) }}>
                <strong>{t('pay.payOnArc')}</strong>
                <span>{t('pay.payOnArcCopy')}</span>
              </button>
              <button type='button' className={paymentMode === 'cross-chain' ? 'active' : ''} onClick={() => { setPaymentMode('cross-chain'); setPreview(null) }}>
                <strong>{t('pay.payCrossChain')}</strong>
                <span>{t('pay.payCrossChainCopy')}</span>
              </button>
            </div>

            {paymentMode === 'cross-chain' && (
              <label className='sandbox-field pay-source-chain'>
                <span>{t('common.sourceChain')}</span>
                <select className='input' value={sourceChain} onChange={event => setSourceChain(event.target.value)}>
                  <option value='base-sepolia'>Base Sepolia</option>
                  <option value='ethereum-sepolia'>Ethereum Sepolia</option>
                  <option value='arbitrum-sepolia'>Arbitrum Sepolia</option>
                  <option value='solana-devnet'>Solana Devnet</option>
                </select>
              </label>
            )}

            <div className='pay-actions'>
              <button className='btn btn-primary' disabled={busy || ['paid','expired','cancelled','failed'].includes(invoice.status)} onClick={preparePayment}>
                {!address ? t('pay.connect') : preview ? t('pay.previewReady') : paymentMode === 'cross-chain' ? t('pay.previewRoute') : t('pay.payNow')}
              </button>
              <button className='header-link-button' type='button' onClick={load}>{t('pay.refresh')}</button>
            </div>

            {preview && (
              <div className='pay-preview'>
                <h3>{preview.type === 'cross-chain' ? t('pay.previewRoute') : t('ui.paymentPreview')}</h3>
                <Info label='From' value={preview.from} mono />
                <Info label='To' value={preview.to} mono />
                <Info label='Amount' value={`${preview.amount} ${preview.token}`} />
                {preview.type === 'cross-chain' ? (
                  <>
                    <Info label='Source chain' value={preview.sourceChain} />
                    <Info label='Route provider' value={preview.route?.provider ? `${preview.route.provider}${preview.route.mockMode ? ' preview' : ''}` : 'Eco preview'} />
                    <Info label='Estimated steps' value={(preview.route?.estimatedSteps || []).join(' -> ') || 'Publish intent -> fulfill -> prove -> settle'} />
                    <p className='pay-muted'>{t('pay.crossChainPreviewNote')}</p>
                  </>
                ) : (
                  <Info label='Estimated network fee' value={preview.estimate?.fee ? `${preview.estimate.fee} USDC` : preview.estimate?.error || 'Unavailable'} />
                )}
                {preview.type === 'arc-eoa' && <button className='btn btn-primary' disabled={busy} onClick={confirmAndPay}>{t('pay.confirmSend')}</button>}
                <button className='header-link-button' type='button' onClick={() => setPreview(null)}>{t('pay.cancel')}</button>
              </div>
            )}

            <details className='pay-advanced'>
              <summary>{t('pay.advanced')}</summary>
              <div className='pay-grid'>
                <Info label='Network' value='Arc Testnet' />
                <Info label='Tx Hash' value={invoice.txHash || '-'} mono link={invoice.txHash ? ARC_TESTNET_EXPLORER_TX + invoice.txHash : ''} />
                <Info label='Payer Address' value={invoice.payerAddress || '-'} mono />
                <Info label='Created At' value={new Date(invoice.createdAt).toLocaleString()} />
              </div>
            </details>

            <div className='pay-timeline'>
              <h3>{t('pay.timeline')}</h3>
              {(invoice.timeline || []).map((item, idx) => (
                <div className='pay-timeline-item' key={`${item.type}-${idx}`}>
                  <div>
                    <strong>{item.type}</strong>
                    <p>{item.message}</p>
                    {item.txHash && <a href={ARC_TESTNET_EXPLORER_TX + item.txHash} target='_blank' rel='noreferrer'>{item.txHash.slice(0, 12)}...{item.txHash.slice(-8)}</a>}
                  </div>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

async function waitForReceipt(txHash: string, address: string) {
  for (let i = 0; i < 20; i++) {
    const provider = await findConnectedWalletProvider(address)
    if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
    const receipt = await normalizeWalletProvider(provider).request({ method: 'eth_getTransactionReceipt', params: [txHash] }).catch(() => null)
    if (receipt) return receipt
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return null
}

function Info({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: string }) {
  const body = link ? <a href={link} target='_blank' rel='noreferrer'>{value}</a> : value
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{body}</strong>
    </div>
  )
}
