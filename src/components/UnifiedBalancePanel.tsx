import { useState } from 'react'
import { estimateDelegatedUnifiedBalance, getTreasuryStatus, spendDelegatedUnifiedBalance } from '../payApi'
import { completeUnifiedBalanceWithdrawWithAppKit, depositUnifiedBalanceWithAppKit, getUnifiedBalanceWithAppKit, initiateUnifiedBalanceWithdrawWithAppKit } from '../appKit'
import { CompactChainPicker, CompactTokenPicker } from './CompactPickers'

type UbChain = 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia'
const UB_CHAINS: Array<{ id: UbChain; label: string }> = [
  { id: 'Arc_Testnet', label: 'Arc Testnet' },
  { id: 'Base_Sepolia', label: 'Base Sepolia' },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia' },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia' },
]

export function UnifiedBalancePanel({ eoaAddress }: { eoaAddress: string | null }) {
  const [treasury, setTreasury] = useState<any>(null)
  const [balance, setBalance] = useState<any>(null)
  const [deposit, setDeposit] = useState<any>(null)
  const [withdraw, setWithdraw] = useState<any>(null)
  const [depositAmount, setDepositAmount] = useState('1')
  const [withdrawAmount, setWithdrawAmount] = useState('1')
  const [depositChain, setDepositChain] = useState<UbChain>('Arc_Testnet')
  const [withdrawChain, setWithdrawChain] = useState<UbChain>('Arc_Testnet')
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
      if (label === 'withdraw' || label === 'completeWithdraw') setWithdraw(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  async function estimateWithdraw() {
    try {
      return await initiateUnifiedBalanceWithdrawWithAppKit({ amount: withdrawAmount, chain: withdrawChain })
    } catch (error) {
      if (!delegatedFallbackError(error)) throw error
      const result = await estimateDelegatedUnifiedBalance({ purpose: 'withdraw', amount: withdrawAmount, destinationChain: withdrawChain, sourceChain: 'auto' })
      return { ...result.estimate, delegated: true }
    }
  }

  async function completeWithdraw() {
    if ((withdraw as any)?.delegated) {
      const result = await spendDelegatedUnifiedBalance({ purpose: 'withdraw', amount: withdrawAmount, destinationChain: withdrawChain, sourceChain: 'auto', maxTotalDebit: (withdraw as any)?.totalDebit })
      return { ...result.spend, delegated: true }
    }
    try {
      return await completeUnifiedBalanceWithdrawWithAppKit({ amount: withdrawAmount, chain: withdrawChain })
    } catch (error) {
      if (!delegatedFallbackError(error)) throw error
      const result = await spendDelegatedUnifiedBalance({ purpose: 'withdraw', amount: withdrawAmount, destinationChain: withdrawChain, sourceChain: 'auto', maxTotalDebit: (withdraw as any)?.totalDebit })
      return { ...result.spend, delegated: true }
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
              <Info label='Total' value={formatUnifiedBalance(balance)} />
              <Info label='Chains' value={formatUnifiedChains(balance)} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Deposit to Unified Balance</h3>
          <p className='pay-muted'>Deposit USDC from your wallet into Circle Gateway Unified Balance. This is required before a Unified Balance spend can pay x402.</p>
          <div className='ub-form-row'>
            <div className='ub-picker-field'>
              <span>Source Chain</span>
              <CompactChainPicker value={depositChain} options={UB_CHAINS} onChange={value => setDepositChain(value as UbChain)} />
            </div>
            <div className='ub-token-field'>
              <span>Token</span>
              <CompactTokenPicker value='USDC' options={['USDC']} onChange={() => {}} width={104} />
            </div>
          </div>
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
          <h3>Withdraw Unified Balance</h3>
          <p className='pay-muted'>Preview the route, then spend Unified Balance back to your connected wallet on the selected chain.</p>
          <div className='ub-form-row'>
            <div className='ub-picker-field'>
              <span>Withdraw Chain</span>
              <CompactChainPicker value={withdrawChain} options={UB_CHAINS} onChange={value => { setWithdrawChain(value as UbChain); setWithdraw(null) }} />
            </div>
            <div className='ub-token-field'>
              <span>Token</span>
              <CompactTokenPicker value='USDC' options={['USDC']} onChange={() => {}} width={104} />
            </div>
          </div>
          <label className='sandbox-field'>
            <span>Amount USDC</span>
            <input className='input' value={withdrawAmount} onChange={event => { setWithdrawAmount(event.target.value); setWithdraw(null) }} />
          </label>
          <div className='button-row wrap'>
            <button className='btn btn-secondary' disabled={busy === 'withdraw'} onClick={() => run('withdraw', estimateWithdraw)}>
              {busy === 'withdraw' ? 'Initiating...' : 'Initiate Withdraw'}
            </button>
            <button className='btn btn-primary' disabled={busy === 'completeWithdraw' || !withdraw || !!(withdraw as any).txHash} onClick={() => run('completeWithdraw', completeWithdraw)}>
              {busy === 'completeWithdraw' ? 'Completing...' : 'Complete Withdraw'}
            </button>
          </div>
          {withdraw && (
            <div className='pay-grid'>
              <Info label='Tx Hash' value={(withdraw as any).txHash || '-'} mono />
              <Info label='Chain' value={withdrawChain} />
              <Info label='Receive' value={`${withdrawAmount} USDC`} />
              <Info label='Gateway Fees' value={`${(withdraw as any).totalFee || '0'} USDC`} />
              <Info label='Total Debit' value={`${(withdraw as any).totalDebit || (withdraw as any).spendAmount || withdrawAmount} USDC`} />
              <Info label='Status' value={(withdraw as any).txHash ? 'Submitted' : 'Estimate ready'} />
              <Info label='Execution' value={(withdraw as any).delegated ? 'Auto Pay fallback' : 'Wallet'} />
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

function delegatedFallbackError(error: unknown) {
  return /chainId.*NaN|Maximum retry attempts|Failed to fetch|Gateway API error|Request timed out|temporarily unavailable/i.test(error instanceof Error ? error.message : String(error))
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value || '-'}</strong>
    </div>
  )
}

function formatUnifiedBalance(balance: any) {
  const total = balance?.totalConfirmedBalance ?? balance?.totalBalance ?? balance?.total ?? balance?.balance ?? balance?.amount
  const pending = balance?.totalPendingBalance
  if (total !== undefined && total !== null) return pending ? `${total} confirmed · ${pending} pending` : String(total)
  const entries = unifiedBalanceEntries(balance)
  const sum = entries.reduce((acc: number, item: any) => acc + Number(item?.confirmedBalance || item?.balance || item?.amount || item?.total || 0), 0)
  return Number.isFinite(sum) && sum > 0 ? sum.toFixed(6) : '0'
}

function formatUnifiedChains(balance: any) {
  const entries = unifiedBalanceEntries(balance)
  if (!entries.length) return 'No chain balance found'
  return entries.map((item: any) => `${item.chain || item.blockchain || '-'}: ${item.confirmedBalance || item.balance || item.amount || item.total || '0'}`).join(' · ')
}

function unifiedBalanceEntries(balance: any) {
  if (Array.isArray(balance?.balances)) return balance.balances
  if (Array.isArray(balance?.chainBalances)) return balance.chainBalances
  if (Array.isArray(balance?.breakdown)) {
    return balance.breakdown.flatMap((source: any) => Array.isArray(source?.breakdown) ? source.breakdown : [])
  }
  return []
}
