import { useEffect, useMemo, useState } from 'react'
import { estimateSendTokenFromEoa, sendTokenFromEoa } from '../services/eoaTransactions'
import { ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { getInvoice, markInvoicePaid, patchInvoice } from '../payApi'
import type { ArcoxInvoice } from '../payApi'

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
    if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
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
      const estimate = await estimateSendTokenFromEoa({
        from: address,
        to: invoice.merchantAddress,
        token: invoice.token,
        amount: invoice.amount,
      }).catch((e) => ({ error: e instanceof Error ? e.message : 'Estimate failed' }))
      setPreview({
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
    setBusy(true)
    try {
      const sent = await sendTokenFromEoa({
        from: address,
        to: invoice.merchantAddress,
        token: invoice.token,
        amount: invoice.amount,
      })
      const txHash = sent.txHash
      const pending = await patchInvoice(invoice.invoiceId, { status: 'pending', txHash, payerAddress: address })
      setInvoice(pending)
      setPreview(null)
      const receipt = await waitForReceipt(txHash)
      if (receipt?.status === '0x0') {
        setInvoice(await patchInvoice(invoice.invoiceId, { status: 'failed', txHash, payerAddress: address }))
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
            <h2>USDC Payment Request</h2>
          </div>
          {invoice && <span className={`pay-status ${invoice.status}`}>{invoice.status}</span>}
        </div>

        {loading && <p className='pay-muted'>Loading invoice...</p>}
        {error && <div className='inline-error'>{error}</div>}

        {invoice && (
          <>
            <div className='pay-grid'>
              <Info label='Invoice ID' value={invoice.invoiceId} />
              <Info label='Order ID' value={invoice.orderId || '-'} />
              <Info label='Merchant / Receiver' value={invoice.merchantAddress} mono />
              <Info label='Amount' value={`${invoice.amount} ${invoice.token}`} />
              <Info label='Network' value='Arc Testnet' />
              <Info label='Memo' value={invoice.memo || '-'} />
              <Info label='Expires At' value={new Date(invoice.expiresAt).toLocaleString()} />
              <Info label='Tx Hash' value={invoice.txHash || '-'} mono link={invoice.txHash ? ARC_TESTNET_EXPLORER_TX + invoice.txHash : ''} />
            </div>

            <div className='pay-actions'>
              <button className='btn btn-primary' disabled={busy || ['paid','expired','cancelled','failed'].includes(invoice.status)} onClick={preparePayment}>
                {!address ? 'Connect Wallet' : preview ? 'Preview Ready' : 'Pay Now'}
              </button>
              <button className='header-link-button' type='button' onClick={load}>Refresh Status</button>
            </div>

            {preview && (
              <div className='pay-preview'>
                <h3>Confirm Payment Preview</h3>
                <Info label='From' value={preview.from} mono />
                <Info label='To' value={preview.to} mono />
                <Info label='Amount' value={`${preview.amount} ${preview.token}`} />
                <Info label='Estimated network fee' value={preview.estimate?.fee ? `${preview.estimate.fee} USDC` : preview.estimate?.error || 'Unavailable'} />
                <button className='btn btn-primary' disabled={busy} onClick={confirmAndPay}>Confirm and Send</button>
                <button className='header-link-button' type='button' onClick={() => setPreview(null)}>Cancel</button>
              </div>
            )}

            <div className='pay-timeline'>
              <h3>Payment Timeline</h3>
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

async function waitForReceipt(txHash: string) {
  for (let i = 0; i < 20; i++) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] }).catch(() => null)
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
