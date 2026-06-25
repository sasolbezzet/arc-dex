import { useState } from 'react'
import { getTreasuryStatus } from '../payApi'
import { depositUnifiedBalanceWithAppKit, getUnifiedBalanceWithAppKit } from '../appKit'

export function UnifiedBalancePanel({ eoaAddress }: { eoaAddress: string | null }) {
  const [treasury, setTreasury] = useState<any>(null)
  const [balance, setBalance] = useState<any>(null)
  const [deposit, setDeposit] = useState<any>(null)
  const [depositAmount, setDepositAmount] = useState('1')
  const [depositChain, setDepositChain] = useState<'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia'>('Arc_Testnet')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function run(label: string, fn: () => Promise<any>) {
    try {
      setBusy(label)
      setError('')
      const result = await fn()
      if (label === 'treasury') setTreasury(result)
      if (label === 'balance') setBalance(result)
      if (label === 'deposit') setDeposit(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className='pay-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>Unified Balance</div>
        <h2>USDC Routing Status</h2>
        <p>Wallet balance is the USDC held in your connected wallet. Unified Balance is Circle Gateway routing capacity used before spend and settlement.</p>
        <div className='inline-warning'>Real testnet only. ARCOX never marks a payment paid until Arc/Gateway settlement is detected.</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Wallet Balance</h3>
          <p className='pay-muted'>Connected EOA: {eoaAddress || 'not connected'}</p>
          <button className='btn btn-primary' disabled={busy === 'balance'} onClick={() => run('balance', getUnifiedBalanceWithAppKit)}>
            {busy === 'balance' ? 'Checking...' : 'Check Unified Balance'}
          </button>
          {balance && (
            <div className='pay-grid'>
              <Info label='Provider' value='Circle AppKit' />
              <Info label='Token' value='USDC' />
              <Info label='Result' value='Available' />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Deposit to Unified Balance</h3>
          <p className='pay-muted'>Deposit USDC from your wallet into Circle Gateway Unified Balance. This is required before a Unified Balance spend can pay x402.</p>
          <label className='sandbox-field'>
            <span>Source Chain</span>
            <select className='input' value={depositChain} onChange={event => setDepositChain(event.target.value as any)}>
              <option value='Arc_Testnet'>Arc Testnet</option>
              <option value='Base_Sepolia'>Base Sepolia</option>
              <option value='Ethereum_Sepolia'>Ethereum Sepolia</option>
              <option value='Arbitrum_Sepolia'>Arbitrum Sepolia</option>
            </select>
          </label>
          <label className='sandbox-field'>
            <span>Amount USDC</span>
            <input className='input' value={depositAmount} onChange={event => setDepositAmount(event.target.value)} />
          </label>
          <button className='btn btn-primary' disabled={busy === 'deposit'} onClick={() => run('deposit', () => depositUnifiedBalanceWithAppKit({ amount: depositAmount, chain: depositChain }))}>
            {busy === 'deposit' ? 'Depositing...' : 'Deposit USDC'}
          </button>
          {deposit && (
            <div className='pay-grid'>
              <Info label='Status' value='Submitted' />
              <Info label='Tx Hash' value={(deposit as any).txHash || '-'} mono />
              <Info label='Chain' value={depositChain} />
              <Info label='Amount' value={`${depositAmount} USDC`} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>ARCOX Treasury</h3>
          <p className='pay-muted'>The x402 recipient is an Arc Testnet USDC treasury address. Unified Balance spend still settles to this same recipient.</p>
          <button className='btn btn-primary' disabled={busy === 'treasury'} onClick={() => run('treasury', getTreasuryStatus)}>
            {busy === 'treasury' ? 'Checking...' : 'Check Treasury'}
          </button>
          {treasury && (
            <div className='pay-grid'>
              <Info label='Mode' value={treasury.mode || '-'} />
              <Info label='Network' value={treasury.network || '-'} />
              <Info label='Treasury' value={treasury.treasuryWallet || '-'} mono />
              <Info label='Methods' value={(treasury.supportedPaymentMethods || []).join(', ') || '-'} />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value || '-'}</strong>
    </div>
  )
}
