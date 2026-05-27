const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Tambah fungsi pollIrisAttestation di frontend langsung
const helperFunc = `  // ── Poll Iris attestation langsung dari frontend ──
  const pollIrisAttestation = async (domain: number, txHash: string): Promise<{attestation:string;message:string}|null> => {
    const url = \`https://iris-api-sandbox.circle.com/v2/messages/\${domain}?transactionHash=\${txHash}\`
    setStep('Polling attestation dari Circle Iris API...')
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!r.ok) { console.log('[iris] HTTP', r.status); continue }
        const data = await r.json()
        const msg = data?.messages?.[0]
        console.log(\`[iris] attempt \${i+1}: \${msg?.status}\`)
        setStep(\`Attestation... (\${i+1}/60, status: \${msg?.status || 'pending'})\`)
        if (msg?.status === 'complete' && msg.attestation && msg.message) {
          return { attestation: msg.attestation, message: msg.message }
        }
      } catch(e) { console.log('[iris] error:', e) }
    }
    return null
  }

`;

// Sisipkan sebelum waitEvmTx
bridge = bridge.replace(
  '  const waitEvmTx',
  helperFunc + '  const waitEvmTx'
);

// Ganti seluruh blok mint-via-appkit dengan: iris langsung + MetaMask sign
bridge = bridge.replace(
  `      // Mint via backend App Kit (lebih reliable dari manual receiveMessage)
      setStep('Backend memproses mint via App Kit...')
      localSteps[localSteps.length-1].state='success'
      setStatus({ type:'info', msg:'⏳ Backend mint USDC di '+toChain+' via App Kit...', steps:[...localSteps] })
      
      const mintResp = await fetch(API+'/api/mint-via-appkit', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ burnTxHash:burnTx, fromChain, toChain, toAddress:address })
      })
      const mintData = await mintResp.json()
      if (!mintResp.ok || !mintData.success) throw new Error(mintData.error||'Mint gagal')
      
      const DST_EXPLORER: Record<string,string> = {
        Arc_Testnet: 'https://testnet.arcscan.app/tx/',
        Ethereum_Sepolia: 'https://sepolia.etherscan.io/tx/',
        Base_Sepolia: 'https://sepolia.basescan.org/tx/',
        Arbitrum_Sepolia: 'https://sepolia.arbiscan.io/tx/',
      }
      localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash, explorerUrl:(DST_EXPLORER[toChain]||'')+mintData.txHash })
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })`,

  `      // Step 3: Poll Iris attestation langsung dari frontend
      const srcDomain = { Arc_Testnet:26, Ethereum_Sepolia:0, Base_Sepolia:6, Arbitrum_Sepolia:3 }[fromChain] ?? 0
      const attResult = await pollIrisAttestation(srcDomain, burnTx)
      if (!attResult) throw new Error('Attestation timeout setelah 3 menit. Coba lagi.')
      localSteps[localSteps.length-1].state='success'

      // Step 4: Switch ke destination chain
      const dstChainInfo = EVM_CHAINS.find(c=>c.id===toChain)
      if (dstChainInfo) {
        setStep('Switch ke destination chain...')
        try {
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:dstChainInfo.chainId}] })
          await new Promise(r=>setTimeout(r,2000))
        } catch(e:any) {
          if ((e.code===4902||e.code===-32603) && dstChainInfo.addParams) {
            await window.ethereum.request({ method:'wallet_addEthereumChain', params:[dstChainInfo.addParams] })
            await new Promise(r=>setTimeout(r,3000))
          }
        }
      }

      // Step 5: MetaMask sign receiveMessage (mint)
      setStep('MetaMask: Approve mint di destination (3/3)...')
      setStatus({ type:'info', msg:'⏳ MetaMask popup 3/3: Approve mint USDC di '+toChain+'...', steps:[...localSteps] })

      const DST_TRANSMITTER: Record<string,string> = {
        Arc_Testnet: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
        Ethereum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Base_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Arbitrum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
      }
      const DST_EXPLORER: Record<string,string> = {
        Arc_Testnet: 'https://testnet.arcscan.app/tx/',
        Ethereum_Sepolia: 'https://sepolia.etherscan.io/tx/',
        Base_Sepolia: 'https://sepolia.basescan.org/tx/',
        Arbitrum_Sepolia: 'https://sepolia.arbiscan.io/tx/',
      }

      // Encode receiveMessage(bytes message, bytes attestation)
      const msgHex = attResult.message.startsWith('0x') ? attResult.message.slice(2) : attResult.message
      const attHex = attResult.attestation.startsWith('0x') ? attResult.attestation.slice(2) : attResult.attestation
      const encBytes = (hex: string) => {
        const lenHex = (hex.length/2).toString(16).padStart(64,'0')
        const padded = hex.length % 64 === 0 ? hex : hex + '0'.repeat(64 - (hex.length % 64))
        return lenHex + padded
      }
      const msgPaddedLen = Math.ceil(msgHex.length/2/32)*32
      const attOffset = (64 + 32 + msgPaddedLen).toString(16).padStart(64,'0')
      const calldata = '0x57ecfd28'
        + '0000000000000000000000000000000000000000000000000000000000000040'
        + attOffset
        + encBytes(msgHex)
        + encBytes(attHex)

      // Query gas price dari destination network
      let mintGas = '0x77359400'
      try {
        const gp = await window.ethereum.request({ method: 'eth_gasPrice' })
        mintGas = '0x' + (BigInt(gp) * 200n / 100n).toString(16)
      } catch {}

      const mintTx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: DST_TRANSMITTER[toChain], data: calldata, gas: '0x493e0', maxFeePerGas: mintGas, maxPriorityFeePerGas: mintGas }]
      })
      localSteps.push({ name:'mint', state:'pending', txHash:mintTx })
      setStatus({ type:'info', msg:'⏳ Menunggu mint dikonfirmasi...', steps:[...localSteps] })
      await waitEvmTx(mintTx)
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=(DST_EXPLORER[toChain]||'')+mintTx
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })`
);

// Update info popup count
bridge = bridge.replace(
  `{!isFromSolana && !isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>2x (approve + burn)</span></div>}`,
  `{!isFromSolana && !isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>3x (approve + burn + mint)</span></div>}`
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Done - full wallet flow: approve+burn+mint via MetaMask, Iris direct poll');
