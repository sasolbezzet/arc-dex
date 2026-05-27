const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Ganti seluruh blok attestation+mint EVM dengan mint-via-appkit
bridge = bridge.replace(
  `      // Retry attestation sampai 3x kalau timeout
      let attData: any = null
      for (let retry = 0; retry < 3; retry++) {
        setStep(\`Menunggu attestation... (percobaan \${retry+1}/3, ~2 menit)\`)
        const attResp = await fetch(API+'/api/get-attestation', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({txHash:burnTx,fromChain})
        })
        const data = await attResp.json()
        if (attResp.ok && data.success) { attData = data; break }
        if (retry < 2) {
          setStatus({ type:'info', msg:\`⏳ Attestation belum siap, retry dalam 15 detik...\`, steps:[...localSteps] })
          await new Promise(r=>setTimeout(r,15000))
        } else {
          throw new Error(data.error || 'Attestation timeout setelah 3x percobaan')
        }
      }
      if (!attData) throw new Error('Attestation gagal')
      localSteps[localSteps.length-1].state='success'

      // Switch ke destination chain
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

      // User sign receiveMessage di destination chain (MetaMask popup #3)
      setStep('MetaMask: Konfirmasi mint di destination (3/3)...')
      setStatus({ type:'info', msg:'⏳ MetaMask popup 3/3: Konfirmasi mint USDC di '+toChain+'...', steps:[...localSteps] })

      const DST_TRANSMITTER: Record<string,string> = {
        Arc_Testnet: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
        Ethereum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Base_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Arbitrum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
      }

      // Encode receiveMessage calldata
      const msgHex = attData.message.startsWith('0x') ? attData.message.slice(2) : attData.message
      const attHex = attData.attestation.startsWith('0x') ? attData.attestation.slice(2) : attData.attestation
      const encodeBytes = (hex: string) => {
        const len = (hex.length/2).toString(16).padStart(64,'0')
        const padded = hex.padEnd(Math.ceil(hex.length/64)*64,'0')
        return len + padded
      }
      // ABI encode: receiveMessage(bytes,bytes)
      // offset1 = 0x40 (64 bytes = setelah 2 offset slots)
      const msgByteLen = msgHex.length/2
      const msgPaddedLen = Math.ceil(msgByteLen/32)*32
      // offset2 = 64 + 32 (len) + msgPaddedLen
      const attOffsetNum = 64 + 32 + msgPaddedLen
      const attOffsetHex = attOffsetNum.toString(16).padStart(64,'0')
      const selector = '0x57ecfd28'
      const calldata = selector + '0000000000000000000000000000000000000000000000000000000000000040' + attOffsetHex + encodeBytes(msgHex) + encodeBytes(attHex)

      // Query gas price untuk mint di destination
      let mintGasPrice = '0x77359400'
      try {
        const gp = await window.ethereum.request({ method: 'eth_gasPrice' })
        mintGasPrice = '0x' + (BigInt(gp) * 200n / 100n).toString(16)
      } catch {}
      const mintTx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: DST_TRANSMITTER[toChain], data: calldata, gas: '0x493e0', maxFeePerGas: mintGasPrice, maxPriorityFeePerGas: mintGasPrice }]
      })
      localSteps.push({ name:'mint', state:'pending', txHash:mintTx })
      setStatus({ type:'info', msg:'⏳ Menunggu mint dikonfirmasi...', steps:[...localSteps] })
      await waitEvmTx(mintTx)

      const DST_EXPLORER: Record<string,string> = {
        Arc_Testnet: 'https://testnet.arcscan.app/tx/',
        Ethereum_Sepolia: 'https://sepolia.etherscan.io/tx/',
        Base_Sepolia: 'https://sepolia.basescan.org/tx/',
        Arbitrum_Sepolia: 'https://sepolia.arbiscan.io/tx/',
      }
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=(DST_EXPLORER[toChain]||'')+mintTx
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })`,

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
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })`
);

// Update info panel - MetaMask popup jadi 2x untuk EVM (tidak perlu mint popup)
bridge = bridge.replace(
  `{!isFromSolana && !isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>3x (approve + burn + mint)</span></div>}`,
  `{!isFromSolana && !isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>2x (approve + burn)</span></div>}`
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Frontend updated to use App Kit mint');
