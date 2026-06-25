import { useState } from 'react'
import { getTreasuryStatus } from '../payApi'
import { completeUnifiedBalanceWithdrawWithAppKit, depositUnifiedBalanceWithAppKit, getUnifiedBalanceWithAppKit, initiateUnifiedBalanceWithdrawWithAppKit } from '../appKit'

type UbChain = 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia'
const UB_CHAINS: Array<{ id: UbChain; label: string }> = [
  { id: 'Arc_Testnet', label: 'Arc' },
  { id: 'Base_Sepolia', label: 'Base' },
  { id: 'Ethereum_Sepolia', label: 'ETH' },
  { id: 'Arbitrum_Sepolia', label: 'ARB' },
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
          <ChainButtons label='Source Chain' value={depositChain} onChange={setDepositChain} />
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
          <p className='pay-muted'>Withdraw has two steps: initiate removal, wait until the withdrawal block is ready, then complete withdraw on the same chain.</p>
          <ChainButtons label='Withdraw Chain' value={withdrawChain} onChange={setWithdrawChain} />
          <label className='sandbox-field'>
            <span>Amount USDC</span>
            <input className='input' value={withdrawAmount} onChange={event => setWithdrawAmount(event.target.value)} />
          </label>
          <div className='button-row wrap'>
            <button className='btn btn-secondary' disabled={busy === 'withdraw'} onClick={() => run('withdraw', () => initiateUnifiedBalanceWithdrawWithAppKit({ amount: withdrawAmount, chain: withdrawChain }))}>
              {busy === 'withdraw' ? 'Initiating...' : 'Initiate Withdraw'}
            </button>
            <button className='btn btn-primary' disabled={busy === 'completeWithdraw'} onClick={() => run('completeWithdraw', () => completeUnifiedBalanceWithdrawWithAppKit({ chain: withdrawChain }))}>
              {busy === 'completeWithdraw' ? 'Completing...' : 'Complete Withdraw'}
            </button>
          </div>
          {withdraw && (
            <div className='pay-grid'>
              <Info label='Tx Hash' value={(withdraw as any).txHash || '-'} mono />
              <Info label='Chain' value={withdrawChain} />
              <Info label='Withdrawal Block' value={String((withdraw as any).withdrawalBlock || '-')} />
              <Info label='Status' value='Check block readiness before complete' />
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

function ChainButtons({ label, value, onChange }: { label: string; value: UbChain; onChange: (value: UbChain) => void }) {
  return (
    <div className='sandbox-field'>
      <span>{label}</span>
      <div className='compact-chain-grid compact-chain-grid--stacked'>
        {UB_CHAINS.map(chain => (
          <button key={chain.id} type='button' className={value === chain.id ? 'active' : ''} onClick={() => onChange(chain.id)}>
            {chain.label}
          </button>
        ))}
      </div>
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
