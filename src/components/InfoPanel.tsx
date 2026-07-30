import { useEffect, useState } from 'react'
import { encodeFunctionData } from 'viem'
import { safePost } from '../api'
import { findChain } from '../chains'
import { txHistory, type TxRecord } from '../txHistory'
import { useI18n } from '../i18n'
import { ChainLogo, TokenLogo } from './CompactPickers'
import { findConnectedWalletProvider, normalizeWalletProvider } from '../walletProvider'
import { rpcUint } from '../utils/rpcQuantity'
const EXPLORER = 'https://testnet.arcscan.app'
const SOLANA_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const INITIAL_FEE_MULTIPLIER = 3n
const MAX_FEE_MULTIPLIER = 4n
const RECEIVE_MESSAGE_ABI = [{
  type: 'function',
  name: 'receiveMessage',
  inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }],
  outputs: [{ name: 'success', type: 'bool' }],
  stateMutability: 'nonpayable',
}] as const
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }

function fmtTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function HistoryRow({ rec }: { rec: TxRecord }) {
  const [expanded, setExpanded] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string|null>(null)
  const [copiedReceipt, setCopiedReceipt] = useState(false)
  const color = rec.status === 'success' ? '#10b981' : rec.status === 'error' ? '#f87171' : '#f59e0b'
  const icon = rec.status === 'success' ? '✓' : rec.status === 'error' ? '✗' : '⏳'
  const canRetry = Boolean((rec.action || 'bridge') === 'bridge' && rec.burnTx && rec.to !== 'Solana_Devnet' && rec.status !== 'success')
  const short = (value?: string) => value ? `${value.slice(0, 10)}...${value.slice(-6)}` : '-'
  const action = rec.action || 'bridge'
  const evmRequest = async (request: { method: string; params?: unknown[] | object }) => {
    const provider = await findConnectedWalletProvider()
    if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
    return normalizeWalletProvider(provider).request(request)
  }
  const copyReceipt = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rec, null, 2))
      setCopiedReceipt(true)
      setTimeout(() => setCopiedReceipt(false), 1600)
    } catch {
      setRetryError('Copy receipt gagal.')
    }
  }
  const waitEvmTx = async (txHash: string) => {
    for (let i = 0; i < 90; i++) {
      const r = await evmRequest({ method:'eth_getTransactionReceipt', params:[txHash] })
      if (r?.status === '0x1') return r
      if (r?.status === '0x0') throw new Error('Transaksi penerimaan gagal di jaringan.')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    throw new Error('Waktu penerimaan habis. Cek explorer lalu coba lagi.')
  }
  const toHex = (n: bigint) => `0x${n.toString(16)}`
  const getBufferedEvmFees = async (tx: any, multiplier = 3n) => {
    const out: any = {}
    try {
      const gasHex = await evmRequest({ method:'eth_estimateGas', params:[tx] })
      out.gas = toHex((rpcUint(gasHex, 'estimated gas') * 13n) / 10n + 10_000n)
    } catch(e) {
      console.warn('retry eth_estimateGas failed:', e instanceof Error ? e.message : String(e))
    }
    try {
      const block = await evmRequest({ method:'eth_getBlockByNumber', params:['latest', false] })
      const baseFee = block?.baseFeePerGas ? rpcUint(block.baseFeePerGas, 'base fee', true) : 0n
      if (baseFee > 0n) {
        let tip = 0n
        try { tip = rpcUint(await evmRequest({ method:'eth_maxPriorityFeePerGas' }), 'priority fee', true) } catch {}
        if (tip < 1_500_000n) tip = 1_500_000n
        out.maxPriorityFeePerGas = toHex(tip)
        out.maxFeePerGas = toHex(baseFee * multiplier + tip * 2n)
        return out
      }
    } catch(e) {
      console.warn('retry EIP-1559 fee lookup failed:', e instanceof Error ? e.message : String(e))
    }
    try {
      const gasPrice = rpcUint(await evmRequest({ method:'eth_gasPrice' }), 'gas price')
      out.gasPrice = toHex(gasPrice * multiplier)
    } catch {}
    return out
  }
  const sendEvmTxBuffered = async (tx: any): Promise<string> => {
    const firstFees = await getBufferedEvmFees(tx, INITIAL_FEE_MULTIPLIER)
    try {
      return await evmRequest({ method:'eth_sendTransaction', params:[{ ...tx, ...firstFees }] })
    } catch(e:any) {
      const msg = e?.message || ''
      if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw e
      await new Promise(resolve => setTimeout(resolve, 1200))
      const retryFees = await getBufferedEvmFees(tx, MAX_FEE_MULTIPLIER)
      return await evmRequest({ method:'eth_sendTransaction', params:[{ ...tx, ...retryFees }] })
    }
  }
  const switchDestinationChain = async () => {
    const chain = findChain(rec.to)
    if (!chain?.chainId) throw new Error('Destination chain tidak didukung untuk retry wallet: ' + rec.to)
    try {
      await evmRequest({ method:'wallet_switchEthereumChain', params:[{ chainId: chain.chainId }] })
    } catch(e:any) {
      if ((e.code === 4902 || e.code === -32603) && chain.addParams) {
        await evmRequest({ method:'wallet_addEthereumChain', params:[chain.addParams] })
        return
      }
      throw e
    }
  }
  const retryMint = async () => {
    if (!rec.burnTx || !canRetry) return
    setRetrying(true)
    setRetryError(null)
    try {
      const att = await safePost('', '/api/get-attestation', {
        txHash: rec.burnTx,
        fromChain: rec.from,
        toChain: rec.to,
      })
      if (!att.success || !att.message || !att.attestation || !att.messageTransmitter) {
        throw new Error(att.error || 'Konfirmasi jaringan belum tersedia. Coba lagi nanti.')
      }
      await switchDestinationChain()
      const accounts = await evmRequest({ method:'eth_requestAccounts' })
      const from = accounts?.[0]
      if (!from) throw new Error('MetaMask account tidak tersedia.')
      const data = encodeFunctionData({
        abi: RECEIVE_MESSAGE_ABI,
        functionName: 'receiveMessage',
        args: [att.message, att.attestation],
      })
      const mintTx = await sendEvmTxBuffered({ from, to: att.messageTransmitter, data })
      await waitEvmTx(mintTx)
      const chain = findChain(rec.to)
      const explorerUrl = chain?.explorer ? `${chain.explorer}/tx/${mintTx}` : undefined
      txHistory.update(rec.id, {
        status: 'success',
        mintTx,
        mintExplorerUrl: explorerUrl,
        error: undefined,
        note: `${rec.note || ''}\nRetry penerimaan selesai via MetaMask.`,
      })
    } catch(e: unknown) {
      const msg = e instanceof Error ? e.message : 'Retry penerimaan gagal'
      setRetryError(msg)
      txHistory.update(rec.id, { status:'error', error:msg })
    }
    setRetrying(false)
  }
  return (
    <div style={{ borderTop: '1px solid #1e1e2e', paddingTop: 8, marginTop: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
        <div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
            <TokenLogo token={rec.token || 'USDC'} size={16} />
            <span>{action.toUpperCase()} · {rec.amount} {rec.token || 'USDC'} ·</span>
            <ChainLogo chain={rec.from} size={16} />
            <span>{rec.from} →</span>
            <ChainLogo chain={rec.to} size={16} />
            <span>{rec.to}</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 11 }}>{fmtTime(rec.ts)} · {rec.source || 'web-ui'}{rec.walletSource ? ` · ${rec.walletSource}` : ''}</div>
        </div>
        <div style={{ color, fontWeight: 700, fontSize: 14 }}>{icon}</div>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, paddingLeft: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rec.tx && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Tx</span>
              <a href={rec.explorer || '#'} target='_blank' rel='noreferrer' style={{ color: '#818cf8', fontFamily: 'monospace' }}>{short(rec.tx)} →</a>
            </div>
          )}
          {rec.approveTx && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Izinkan</span>
              <span style={{ color: '#818cf8', fontFamily: 'monospace' }}>{short(rec.approveTx)}</span>
            </div>
          )}
          {rec.burnTx && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Kirim</span>
              <a href={rec.burnExplorerUrl || '#'} target='_blank' rel='noreferrer' style={{ color: '#818cf8', fontFamily: 'monospace' }}>{short(rec.burnTx)} →</a>
            </div>
          )}
          {rec.mintTx && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Terima</span>
              <a href={rec.mintExplorerUrl || '#'} target='_blank' rel='noreferrer' style={{ color: '#818cf8', fontFamily: 'monospace' }}>{short(rec.mintTx)} →</a>
            </div>
          )}
          {(rec.srcDomain !== undefined || rec.dstDomain !== undefined) && <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#64748b' }}>Domain</span>
            <span style={{ fontFamily: 'monospace' }}>{rec.srcDomain} → {rec.dstDomain}</span>
          </div>}
          {rec.error && <div style={{ color: '#f87171', fontSize: 11 }}>{rec.error}</div>}
          {retryError && <div style={{ color: '#f87171', fontSize: 11 }}>{retryError}</div>}
          {rec.note && <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'pre-wrap' }}>{rec.note}</div>}
          <button onClick={copyReceipt} style={{marginTop:4,background:'rgba(16,185,129,0.1)',color:'#10b981',border:'1px solid rgba(16,185,129,0.25)',padding:'6px 8px',borderRadius:8,cursor:'pointer',fontSize:11}}>
            {copiedReceipt ? 'Receipt copied' : 'Copy receipt JSON'}
          </button>
          {canRetry && (
            <button onClick={retryMint} disabled={retrying} style={{marginTop:4,background:'rgba(99,102,241,0.14)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.35)',padding:'6px 8px',borderRadius:8,cursor:retrying?'not-allowed':'pointer',fontSize:11}}>
              {retrying ? 'Menunggu penerimaan...' : 'Retry penerimaan'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function InfoPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const { t } = useI18n()
  const [copied, setCopied] = useState<string|null>(null)
  const [history, setHistory] = useState<TxRecord[]>(() => txHistory.list())
  const [historyFilter, setHistoryFilter] = useState<'all'|'pending'|'bridge'|'swap'|'send'|'agent'>('all')
  const [solanaAddress, setSolanaAddress] = useState<string|null>(null)
  const [solanaUsdc, setSolanaUsdc] = useState('0')
  useEffect(() => {
    txHistory.setOwner(address)
    const unsub = txHistory.subscribe(() => setHistory(txHistory.list()))
    queueMicrotask(() => setHistory(txHistory.list()))
    txHistory.syncRemote()
    return unsub
  }, [address])
  const refreshSolana = async () => {
    const provider = (window as any).solflare || (window as any).solana
    if (!provider) return
    try {
      if (!provider.publicKey) await provider.connect?.({ onlyIfTrusted: true })
      const addr = provider.publicKey?.toString()
      if (!addr) return
      setSolanaAddress(addr)
      const { Connection, PublicKey } = await import('@solana/web3.js')
      const { getAssociatedTokenAddress } = await import('@solana/spl-token')
      const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
      const ata = await getAssociatedTokenAddress(new PublicKey(SOLANA_USDC_MINT), new PublicKey(addr))
      try {
        const bal = await conn.getTokenAccountBalance(ata)
        setSolanaUsdc(bal.value.uiAmountString || '0')
      } catch { setSolanaUsdc('0') }
    } catch {}
  }
  const connectSolana = async () => {
    const provider = (window as any).solflare || (window as any).solana
    if (!provider) return alert('Install Solflare atau Phantom wallet')
    await provider.connect()
    await refreshSolana()
  }
  useEffect(() => { refreshSolana() }, [])
  const copy = async (text:string, key:string) => {
    try { await navigator.clipboard.writeText(text) } catch { console.warn('Clipboard failed') }
    setCopied(key); setTimeout(()=>setCopied(null),2000)
  }
  const tokens = [
    { sym:'USDC', name:'USD Coin', circleBal:balances.USDC||'0', eoaBal:eoaBalances.USDC||'0', dec:4 },
    { sym:'EURC', name:'Euro Coin', circleBal:balances.EURC||'0', eoaBal:eoaBalances.EURC||'0', dec:4 },
    { sym:'USYC', name:'US Yield Coin', circleBal:balances.USYC||'0', eoaBal:eoaBalances.USYC||'0', dec:6 },
    { sym:'cirBTC', name:'Circle Wrapped BTC', circleBal:balances.cirBTC||'0', eoaBal:eoaBalances.cirBTC||'0', dec:8 },
  ]
  const pending = history.filter(rec => rec.status !== 'success')
  const retryable = history.filter(rec => (rec.action || 'bridge') === 'bridge' && rec.burnTx && rec.to !== 'Solana_Devnet' && rec.status !== 'success')
  const filteredHistory = history.filter(rec => {
    if (historyFilter === 'all') return true
    if (historyFilter === 'pending') return rec.status !== 'success'
    if (historyFilter === 'agent') return rec.source === 'agent-mcp'
    return (rec.action || 'bridge') === historyFilter
  })
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {circleWallet&&(
        <div className='glass' style={{borderRadius:12,padding:14}}>
          <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🔵 Circle Wallet</div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>{t('info.address')}</div>
          <div style={{color:'#818cf8',fontFamily:'monospace',fontSize:11,wordBreak:'break-all',background:'rgba(99,102,241,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{circleWallet.address}</div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>{t('info.walletId')}</div>
          <div style={{color:'#f59e0b',fontFamily:'monospace',fontSize:11,background:'rgba(245,158,11,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{circleWallet.id}</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>copy(circleWallet.address,'addr')} style={{flex:1,background:'rgba(99,102,241,0.2)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'6px 0',borderRadius:8,cursor:'pointer',fontSize:12}}>{copied==='addr'?`✓ ${t('common.copied')}!`:`📋 ${t('info.copyAddress')}`}</button>
            <button onClick={()=>copy(circleWallet.id,'id')} style={{flex:1,background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)',padding:'6px 0',borderRadius:8,cursor:'pointer',fontSize:12}}>{copied==='id'?`✓ ${t('common.copied')}!`:`📋 ${t('info.copyId')}`}</button>
          </div>
          <a href={`${EXPLORER}/address/${circleWallet.address}`} target='_blank' rel='noreferrer' style={{display:'block',marginTop:8,background:'rgba(16,185,129,0.1)',color:'#10b981',border:'1px solid rgba(16,185,129,0.3)',padding:'6px 0',borderRadius:8,fontSize:12,textDecoration:'none',textAlign:'center'}}>🔍 {t('info.viewExplorer')}</a>
        </div>
      )}
      {address&&(
        <div className='glass' style={{borderRadius:12,padding:14}}>
          <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🟡 MetaMask (EOA)</div>
          <div style={{color:'#f59e0b',fontFamily:'monospace',fontSize:11,wordBreak:'break-all',background:'rgba(245,158,11,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{address}</div>
          <div style={{display:'flex',flexDirection:'column',gap:4,fontSize:13}}>
            {Object.entries(eoaBalances).map(([sym,bal])=>(
              <div key={sym} style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{sym}</span><span style={{fontFamily:'monospace'}}>{parseFloat(bal).toFixed(4)}</span></div>
            ))}
          </div>
        </div>
      )}
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🟣 Solana Devnet</div>
        {solanaAddress ? (
          <>
            <div style={{color:'#a78bfa',fontFamily:'monospace',fontSize:11,wordBreak:'break-all',background:'rgba(167,139,250,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{solanaAddress}</div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:8}}>
              <span style={{color:'#64748b'}}>USDC</span>
              <span style={{fontFamily:'monospace',color:'#e2e8f0'}}>{parseFloat(solanaUsdc || '0').toFixed(6)}</span>
            </div>
              <div style={{fontSize:11,color:'#10b981',marginBottom:8}}>{t('bridge.solanaRequired')}</div>
            <button onClick={refreshSolana} style={{width:'100%',background:'rgba(167,139,250,0.12)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>↻ {t('common.refresh')} Solana</button>
          </>
        ) : (
          <button onClick={connectSolana} style={{width:'100%',background:'rgba(167,139,250,0.15)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.4)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>{t('bridge.connectSolana')}</button>
        )}
      </div>
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>💰 {t('info.allBalances')}</div>
        {tokens.map(t=>(
          <div key={t.sym} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <TokenLogo token={t.sym} size={32} />
              <div><div style={{color:'#e2e8f0',fontSize:13,fontWeight:600}}>{t.sym}</div><div style={{color:'#64748b',fontSize:11}}>{t.name}</div></div>
            </div>
            <div style={{textAlign:'right',fontSize:12}}>
              <div style={{color:'#818cf8'}}>Circle: {parseFloat(t.circleBal).toFixed(t.dec)}</div>
              <div style={{color:'#f59e0b'}}>EOA: {parseFloat(t.eoaBal).toFixed(t.dec)}</div>
              <div style={{color:'#e2e8f0',fontWeight:600}}>Total: {(parseFloat(t.circleBal)+parseFloat(t.eoaBal)).toFixed(t.dec)}</div>
            </div>
          </div>
        ))}
        <button onClick={()=>{ onRefresh(); refreshSolana() }} style={{width:'100%',background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>↻ {t('info.refreshBalance')}</button>
      </div>
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <div style={{fontWeight:600,fontSize:14,color:'#e2e8f0'}}>Pending Transaction Center</div>
          {history.length>0&&<button onClick={()=>{ if(confirm('Hapus semua riwayat?')) txHistory.clear() }} style={{fontSize:11,background:'rgba(239,68,68,0.1)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>{t('common.delete')}</button>}
        </div>
        {pending.length > 0 ? (
          <>
            <div style={{color:'#f59e0b',fontSize:12,marginBottom:8}}>{pending.length} transaksi perlu dicek. Bridge pending bisa dilanjutkan jika konfirmasi jaringan sudah siap.</div>
            {pending.slice(0,6).map(rec=><HistoryRow key={`pending-${rec.id}`} rec={rec} />)}
          </>
        ) : (
          <div style={{color:'#10b981',fontSize:12,marginBottom:8}}>{t('info.retryClear')}</div>
        )}
        {retryable.length > 0 && <div style={{color:'#94a3b8',fontSize:11,marginTop:8}}>{retryable.length} bridge bisa dilanjutkan penerimaannya dari detail transaksi.</div>}
      </div>
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <div style={{fontWeight:600,fontSize:14,color:'#e2e8f0'}}>📜 {t('info.history')}</div>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
          {(['all','pending','bridge','swap','send','agent'] as const).map(filter=>(
            <button key={filter} onClick={()=>setHistoryFilter(filter)} style={{fontSize:11,textTransform:'capitalize',background:historyFilter===filter?'rgba(99,102,241,0.22)':'rgba(18,18,26,0.8)',color:historyFilter===filter?'#c7d2fe':'#94a3b8',border:historyFilter===filter?'1px solid rgba(99,102,241,0.55)':'1px solid #1e1e2e',padding:'5px 8px',borderRadius:8,cursor:'pointer'}}>{filter}</button>
          ))}
        </div>
        {filteredHistory.length===0?(
          <div style={{color:'#64748b',fontSize:12,textAlign:'center',padding:'12px 0'}}>{t('info.noHistory')}</div>
        ):filteredHistory.slice(0,30).map(rec=><HistoryRow key={rec.id} rec={rec} />)}
      </div>
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🌐 Arc Testnet</div>
        {[['Chain ID','5042002'],['Finality','⚡ Sub-second'],['Gas token','USDC'],['RPC','Private backend proxy']].map(([k,v])=>(
          <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:4}}><span style={{color:'#64748b'}}>{k}</span><span style={{color:v.startsWith('⚡')?'#10b981':'#e2e8f0',fontSize:12}}>{v}</span></div>
        ))}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <a href='https://faucet.circle.com/' target='_blank' rel='noreferrer' style={{display:'flex',alignItems:'center',gap:10,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.3)',borderRadius:12,padding:'12px 14px',color:'#10b981',textDecoration:'none',fontSize:13}}>
          <span style={{fontSize:20}}>🚰</span><div><div style={{fontWeight:600}}>Circle Faucet (USDC/EURC)</div><div style={{fontSize:11,opacity:0.8}}>faucet.circle.com</div></div><span style={{marginLeft:'auto'}}>→</span>
        </a>
        <a href='https://console.circle.com/faucet' target='_blank' rel='noreferrer' style={{display:'flex',alignItems:'center',gap:10,background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:12,padding:'12px 14px',color:'#f59e0b',textDecoration:'none',fontSize:13}}>
          <span style={{fontSize:20}}>⛽</span><div><div style={{fontWeight:600}}>Console Faucet (Native Gas)</div><div style={{fontSize:11,opacity:0.8}}>{t('info.useWalletId')}</div></div><span style={{marginLeft:'auto'}}>→</span>
        </a>
      </div>
    </div>
  )
}
