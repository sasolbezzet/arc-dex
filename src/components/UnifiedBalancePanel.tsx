import { useState } from 'react'
import { getTreasuryStatus } from '../payApi'
import { completeUnifiedBalanceWithdrawWithAppKit, depositUnifiedBalanceWithAppKit, getConnectedSolanaAddress, getSolanaWalletDiagnostics, getUnifiedBalanceWithAppKit, initiateUnifiedBalanceWithdrawWithAppKit } from '../appKit'
import { CompactChainPicker, CompactTokenPicker } from './CompactPickers'

type UbChain = 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia' | 'Solana_Devnet'
const UB_CHAINS: Array<{ id: UbChain; label: string }> = [
  { id: 'Arc_Testnet', label: 'Arc Testnet' },
  { id: 'Base_Sepolia', label: 'Base Sepolia' },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia' },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia' },
  { id: 'Solana_Devnet', label: 'Solana Devnet' },
]

export function UnifiedBalancePanel({ eoaAddress }: { eoaAddress: string | null }) {
  const [treasury, setTreasury] = useState<any>(null)
  const [balance, setBalance] = useState<any>(null)
  const [deposit, setDeposit] = useState<any>(null)
  const [withdraw, setWithdraw] = useState<any>(null)
  const [solanaDiagnostics, setSolanaDiagnostics] = useState<any>(null)
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
      if (label === 'completeWithdraw' && (e as any)?.retryConfig) {
        setWithdraw((current: any) => ({ ...current, retryConfig: (e as any).retryConfig, recoveryRequired: true }))
      }
      setError(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  async function estimateWithdraw() {
    return initiateUnifiedBalanceWithdrawWithAppKit({ amount: withdrawAmount, chain: withdrawChain })
  }

  async function completeWithdraw() {
    return completeUnifiedBalanceWithdrawWithAppKit({ amount: withdrawAmount, chain: withdrawChain, retryConfig: (withdraw as any)?.retryConfig })
  }

  async function checkSolanaReadiness() {
    const walletAddress = await getConnectedSolanaAddress(true)
    const diagnostics = await getSolanaWalletDiagnostics(walletAddress)
    setSolanaDiagnostics(diagnostics)
    return diagnostics
  }

  return (
    <div className='pay-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>Unified Balance</div>
        <h2>Your USDC across networks</h2>
        <p>View, add, and withdraw deposited USDC from one place.</p>
        <div className='inline-warning'>Test funds only. A payment is complete after the transfer is confirmed.</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Available Balance</h3>
          <p className='pay-muted'>Connected wallet: {eoaAddress || 'not connected'}</p>
          <button className='btn btn-primary' disabled={busy === 'balance'} onClick={() => run('balance', getUnifiedBalanceWithAppKit)}>
            {busy === 'balance' ? 'Checking...' : 'Check Unified Balance'}
          </button>
          {balance && (
            <div className='pay-grid'>
              <Info label='Token' value='USDC' />
              <Info label='Total' value={formatUnifiedBalance(balance)} />
              <Info label='Networks' value={formatUnifiedChains(balance)} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Add USDC</h3>
          <p className='pay-muted'>Add USDC from a supported wallet to your available balance.</p>
          {(depositChain === 'Solana_Devnet') && <div className='inline-warning'>Solana uses your connected Solflare Devnet wallet.</div>}
          {(depositChain === 'Solana_Devnet') && (
            <button className='btn btn-secondary' disabled={busy === 'solanaDiagnostics'} onClick={() => run('solanaDiagnostics', checkSolanaReadiness)}>
              {busy === 'solanaDiagnostics' ? 'Checking Solana...' : 'Check Solana Wallet Readiness'}
            </button>
          )}
          {depositChain === 'Solana_Devnet' && solanaDiagnostics && <SolanaDiagnostics value={solanaDiagnostics} />}
          <div className='ub-form-row'>
            <div className='ub-picker-field'>
              <span>From Network</span>
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
          <h3>Withdraw USDC</h3>
          <p className='pay-muted'>Review the amount and fee, then send USDC to your connected wallet.</p>
          <div className='inline-warning'>Your wallet approval is required to complete every withdrawal.</div>
          {(withdrawChain === 'Solana_Devnet') && <div className='inline-warning'>Connect Solflare on Devnet before reviewing this withdrawal.</div>}
          {(withdrawChain === 'Solana_Devnet') && (
            <button className='btn btn-secondary' disabled={busy === 'solanaDiagnostics'} onClick={() => run('solanaDiagnostics', checkSolanaReadiness)}>
              {busy === 'solanaDiagnostics' ? 'Checking Solana...' : 'Check Solana Wallet Readiness'}
            </button>
          )}
          {withdrawChain === 'Solana_Devnet' && solanaDiagnostics && <SolanaDiagnostics value={solanaDiagnostics} />}
          <div className='ub-form-row'>
            <div className='ub-picker-field'>
              <span>To Network</span>
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
              {busy === 'withdraw' ? 'Checking...' : 'Review Withdrawal'}
            </button>
            <button className='btn btn-primary' disabled={busy === 'completeWithdraw' || !withdraw || !!(withdraw as any).txHash} onClick={() => run('completeWithdraw', completeWithdraw)}>
              {busy === 'completeWithdraw' ? 'Confirming...' : (withdraw as any)?.recoveryRequired ? 'Retry Receive' : 'Confirm Withdrawal'}
            </button>
          </div>
          {withdraw && (
            <div className='pay-grid'>
              <Info label='Tx Hash' value={(withdraw as any).txHash || '-'} mono />
              <Info label='Network' value={withdrawChain} />
              <Info label='Receive' value={`${withdrawAmount} USDC`} />
              <Info label='Network Fee' value={`${(withdraw as any).totalFee || '0'} USDC`} />
              <Info label='Estimated Total' value={`${(withdraw as any).totalDebit || (withdraw as any).spendAmount || withdrawAmount} USDC`} />
              {(withdraw as any).maxTotalDebit && <Info label='Maximum Total' value={`${(withdraw as any).maxTotalDebit} USDC`} />}
              <Info label='Status' value={(withdraw as any).txHash ? 'Sent' : (withdraw as any).recoveryRequired ? 'Receive pending - retry safely' : 'Ready to confirm'} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Payment Destination</h3>
          <p className='pay-muted'>Paid services send completed payments to the ARCOX payment wallet.</p>
          <button className='btn btn-primary' disabled={busy === 'treasury'} onClick={() => run('treasury', getTreasuryStatus)}>
            {busy === 'treasury' ? 'Checking...' : 'View Payment Details'}
          </button>
          {treasury && (
            <div className='pay-grid'>
              <Info label='Network' value={treasury.network || '-'} />
              <Info label='Wallet' value={treasury.treasuryWallet || '-'} mono />
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

function SolanaDiagnostics({ value }: { value: any }) {
  return (
    <div className='pay-grid'>
      <Info label='Solana Wallet' value={value.walletAddress || '-'} mono />
      <Info label='USDC ATA' value={value.ataAddress || '-'} mono />
      <Info label='ATA Status' value={value.ataExists ? 'Ready' : 'Missing'} />
      <Info label='Devnet SOL' value={String(value.solBalance ?? '0')} />
      <Info label='Devnet USDC' value={String(value.usdcBalance ?? '0')} />
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
