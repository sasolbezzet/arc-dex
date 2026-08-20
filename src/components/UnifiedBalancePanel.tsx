import { useState } from 'react'
import { useI18n } from '../i18n'
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
  const { t } = useI18n()

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
        <div className='docs-kicker'>{t('balance.title')}</div>
        <h2>{t('balance.hero')}</h2>
        <p>{t('balance.copy')}</p>
        <div className='inline-warning'>{t('balance.testFunds')}</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>{t('balance.available')}</h3>
          <p className='pay-muted'>{t('balance.connectedWallet', { address: eoaAddress || t('common.notConnected') })}</p>
          <button className='btn btn-primary' disabled={busy === 'balance'} onClick={() => run('balance', getUnifiedBalanceWithAppKit)}>
            {busy === 'balance' ? t('common.checking') : t('balance.check')}
          </button>
          {balance && (
            <div className='pay-grid'>
              <Info label={t('common.token')} value='USDC' />
              <Info label={t('common.total')} value={formatUnifiedBalance(balance, t)} />
              <Info label={t('common.networks')} value={formatUnifiedChains(balance, t)} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>{t('balance.add')}</h3>
          <p className='pay-muted'>{t('balance.addCopy')}</p>
          {(depositChain === 'Solana_Devnet') && <div className='inline-warning'>{t('balance.solanaWarning')}</div>}
          {(depositChain === 'Solana_Devnet') && (
            <button className='btn btn-secondary' disabled={busy === 'solanaDiagnostics'} onClick={() => run('solanaDiagnostics', checkSolanaReadiness)}>
              {busy === 'solanaDiagnostics' ? t('balance.solanaChecking') : t('balance.solanaReadiness')}
            </button>
          )}
          {depositChain === 'Solana_Devnet' && solanaDiagnostics && <SolanaDiagnostics value={solanaDiagnostics} t={t} />}
          <div className='ub-form-row'>
            <div className='ub-picker-field'>
              <span>{t('balance.fromNetwork')}</span>
              <CompactChainPicker value={depositChain} options={UB_CHAINS} onChange={value => setDepositChain(value as UbChain)} />
            </div>
            <div className='ub-token-field'>
              <span>{t('common.token')}</span>
              <CompactTokenPicker value='USDC' options={['USDC']} onChange={() => {}} width={104} />
            </div>
          </div>
          <label className='sandbox-field'>
            <span>{t('balance.amount')}</span>
            <input className='input' value={depositAmount} onChange={event => setDepositAmount(event.target.value)} />
          </label>
          <button className='btn btn-primary' disabled={busy === 'deposit'} onClick={() => run('deposit', () => depositUnifiedBalanceWithAppKit({ amount: depositAmount, chain: depositChain }))}>
            {busy === 'deposit' ? t('common.depositing') : t('common.deposit')}
          </button>
          {deposit && (
            <div className='pay-grid'>
              <Info label={t('common.status')} value={t('balance.submitted')} />
              <Info label={t('info.tx')} value={(deposit as any).txHash || '-'} mono />
              <Info label={t('common.chain')} value={depositChain} />
              <Info label={t('common.amount')} value={`${depositAmount} USDC`} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>{t('balance.withdraw')}</h3>
          <p className='pay-muted'>{t('balance.withdrawCopy')}</p>
          <div className='inline-warning'>{t('balance.walletApproval')}</div>
          {(withdrawChain === 'Solana_Devnet') && <div className='inline-warning'>{t('balance.connectSolana')}</div>}
          {(withdrawChain === 'Solana_Devnet') && (
            <button className='btn btn-secondary' disabled={busy === 'solanaDiagnostics'} onClick={() => run('solanaDiagnostics', checkSolanaReadiness)}>
              {busy === 'solanaDiagnostics' ? t('balance.solanaChecking') : t('balance.solanaReadiness')}
            </button>
          )}
          {withdrawChain === 'Solana_Devnet' && solanaDiagnostics && <SolanaDiagnostics value={solanaDiagnostics} t={t} />}
          <div className='ub-form-row'>
            <div className='ub-picker-field'>
              <span>{t('balance.toNetwork')}</span>
              <CompactChainPicker value={withdrawChain} options={UB_CHAINS} onChange={value => { setWithdrawChain(value as UbChain); setWithdraw(null) }} />
            </div>
            <div className='ub-token-field'>
              <span>{t('common.token')}</span>
              <CompactTokenPicker value='USDC' options={['USDC']} onChange={() => {}} width={104} />
            </div>
          </div>
          <label className='sandbox-field'>
            <span>{t('balance.amount')}</span>
            <input className='input' value={withdrawAmount} onChange={event => { setWithdrawAmount(event.target.value); setWithdraw(null) }} />
          </label>
          <div className='button-row wrap'>
            <button className='btn btn-secondary' disabled={busy === 'withdraw'} onClick={() => run('withdraw', estimateWithdraw)}>
              {busy === 'withdraw' ? t('common.checking') : t('common.reviewWithdrawal')}
            </button>
            <button className='btn btn-primary' disabled={busy === 'completeWithdraw' || !withdraw || !!(withdraw as any).txHash} onClick={() => run('completeWithdraw', completeWithdraw)}>
              {busy === 'completeWithdraw' ? t('common.confirming') : (withdraw as any)?.recoveryRequired ? t('common.retryReceive') : t('common.confirmWithdrawal')}
            </button>
          </div>
          {withdraw && (
            <div className='pay-grid'>
              <Info label={t('info.tx')} value={(withdraw as any).txHash || '-'} mono />
              <Info label={t('common.network')} value={withdrawChain} />
              <Info label={t('common.receive')} value={`${withdrawAmount} USDC`} />
              <Info label={t('common.fee')} value={`${(withdraw as any).totalFee || '0'} USDC`} />
              <Info label={t('common.total')} value={`${(withdraw as any).totalDebit || (withdraw as any).spendAmount || withdrawAmount} USDC`} />
              {(withdraw as any).maxTotalDebit && <Info label={t('common.max')} value={`${(withdraw as any).maxTotalDebit} USDC`} />}
              <Info label={t('common.status')} value={(withdraw as any).txHash ? t('common.sent') : (withdraw as any).recoveryRequired ? t('common.retryReceive') : t('common.ready')} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>{t('balance.paymentDestination')}</h3>
          <p className='pay-muted'>{t('balance.paymentCopy')}</p>
          <button className='btn btn-primary' disabled={busy === 'treasury'} onClick={() => run('treasury', getTreasuryStatus)}>
            {busy === 'treasury' ? t('common.checking') : t('balance.paymentDetails')}
          </button>
          {treasury && (
            <div className='pay-grid'>
              <Info label={t('common.network')} value={treasury.network || '-'} />
              <Info label={t('common.wallet')} value={treasury.treasuryWallet || '-'} mono />
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

function SolanaDiagnostics({ value, t }: { value: any; t: ReturnType<typeof useI18n>['t'] }) {
  return (
    <div className='pay-grid'>
      <Info label={t('balance.solanaWallet')} value={value.walletAddress || '-'} mono />
      <Info label={t('balance.usdcAta')} value={value.ataAddress || '-'} mono />
      <Info label={t('balance.ataStatus')} value={value.ataExists ? t('common.ready') : t('common.missing')} />
      <Info label={t('balance.devnetSol')} value={String(value.solBalance ?? '0')} />
      <Info label={t('balance.devnetUsdc')} value={String(value.usdcBalance ?? '0')} />
    </div>
  )
}

function formatUnifiedBalance(balance: any, t: ReturnType<typeof useI18n>['t']) {
  const total = balance?.totalConfirmedBalance ?? balance?.totalBalance ?? balance?.total ?? balance?.balance ?? balance?.amount
  const pending = balance?.totalPendingBalance
  if (total !== undefined && total !== null) return pending ? t('balance.confirmedPending', { total: String(total), pending: String(pending) }) : String(total)
  const entries = unifiedBalanceEntries(balance)
  const sum = entries.reduce((acc: number, item: any) => acc + Number(item?.confirmedBalance || item?.balance || item?.amount || item?.total || 0), 0)
  return Number.isFinite(sum) && sum > 0 ? sum.toFixed(6) : '0'
}

function formatUnifiedChains(balance: any, t: ReturnType<typeof useI18n>['t']) {
  const entries = unifiedBalanceEntries(balance)
  if (!entries.length) return t('balance.noChainBalance')
  return entries.map((item: any) => t('balance.chainBalance', { chain: item.chain || item.blockchain || '-', amount: item.confirmedBalance || item.balance || item.amount || item.total || '0' })).join(' · ')
}

function unifiedBalanceEntries(balance: any) {
  if (Array.isArray(balance?.balances)) return balance.balances
  if (Array.isArray(balance?.chainBalances)) return balance.chainBalances
  if (Array.isArray(balance?.breakdown)) {
    return balance.breakdown.flatMap((source: any) => Array.isArray(source?.breakdown) ? source.breakdown : [])
  }
  return []
}
