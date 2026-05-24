const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Ganti kedua fungsi solana dengan versi browser-compatible
const oldBurnFunc = bridge.slice(
  bridge.indexOf('  // ── Solana burn helper ──'),
  bridge.indexOf('  const waitEvmTx')
);

const newBurnFunc = `  // ── Browser-compatible helpers ──
  const hexToU8 = (hex: string): Uint8Array => {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex
    const arr = new Uint8Array(h.length / 2)
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(h.slice(i*2, i*2+2), 16)
    return arr
  }
  const concatU8 = (...arrays: Uint8Array[]): Uint8Array => {
    const total = arrays.reduce((s, a) => s + a.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    arrays.forEach(a => { out.set(a, offset); offset += a.length })
    return out
  }
  const u32LE = (n: number): Uint8Array => {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
  }
  const u64LE = (n: bigint): Uint8Array => {
    const buf = new Uint8Array(8)
    new DataView(buf.buffer).setBigUint64(0, n, true)
    return buf
  }
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

  // ── Solana burn helper ──
  const burnSolanaUsdc = async (amtNum: number, mintRecipientEvm: string): Promise<string> => {
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = solanaWallet!.provider
    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const owner = new PublicKey(solanaWallet!.address)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const senderAta = await getAssociatedTokenAddress(mint, owner)

    // EVM address sebagai bytes32 mintRecipient
    const evmHex = (mintRecipientEvm.startsWith('0x') ? mintRecipientEvm.slice(2) : mintRecipientEvm).toLowerCase().padStart(64, '0')
    const mintRecipientBytes = hexToU8(evmHex)

    const amountLamports = BigInt(Math.round(amtNum * 1e6))

    // depositForBurn discriminator
    const discriminator = new Uint8Array([210, 114, 249, 160, 192, 146, 195, 101])
    const destCallerBytes = new Uint8Array(32)
    const data = concatU8(discriminator, u64LE(amountLamports), u32LE(26), mintRecipientBytes, destCallerBytes)

    const tmProgram = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)
    const mtProgram = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')

    const [tmMinterPDA] = PublicKey.findProgramAddressSync([enc('token_messenger_minter')], tmProgram)
    const domainBuf = new Uint8Array(4); new DataView(domainBuf.buffer).setUint32(0, 26, true)
    const [remoteTokenMsgPDA] = PublicKey.findProgramAddressSync([enc('remote_token_messenger'), domainBuf], tmProgram)
    const [tokenMinterPDA] = PublicKey.findProgramAddressSync([enc('token_minter')], tmProgram)
    const [localTokenPDA] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tmProgram)
    const [burnTokenAccPDA] = PublicKey.findProgramAddressSync([enc('burn_token_account'), mint.toBytes()], tmProgram)
    const [mtPDA] = PublicKey.findProgramAddressSync([enc('message_transmitter')], mtProgram)
    const [eventAuthPDA] = PublicKey.findProgramAddressSync([enc('__event_authority')], mtProgram)

    const ix = new TransactionInstruction({
      programId: tmProgram,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: senderAta, isSigner: false, isWritable: true },
        { pubkey: tmMinterPDA, isSigner: false, isWritable: false },
        { pubkey: remoteTokenMsgPDA, isSigner: false, isWritable: false },
        { pubkey: tokenMinterPDA, isSigner: false, isWritable: true },
        { pubkey: localTokenPDA, isSigner: false, isWritable: true },
        { pubkey: burnTokenAccPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: mtPDA, isSigner: false, isWritable: true },
        { pubkey: eventAuthPDA, isSigner: false, isWritable: true },
        { pubkey: mtProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    })

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: owner })
    tx.add(ix)
    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(signed.serialize())
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return sig
  }

  // ── Solana receiveMessage helper ──
  const signSolanaReceiveMessage = async (attestationHex: string, messageHex: string, toAddress: string): Promise<string> => {
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = solanaWallet!.provider
    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const owner = new PublicKey(toAddress)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const recipientAta = await getAssociatedTokenAddress(mint, owner)

    const msgBytes = hexToU8(messageHex)
    const attBytes = hexToU8(attestationHex)

    // receiveMessage discriminator
    const discriminator = new Uint8Array([216, 249, 210, 149, 228, 210, 244, 218])
    const data = concatU8(discriminator, u32LE(msgBytes.length), msgBytes, u32LE(attBytes.length), attBytes)

    const mtProgram = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')
    const tmProgram = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)

    const [mtPDA] = PublicKey.findProgramAddressSync([enc('message_transmitter')], mtProgram)
    const [usedNoncesPDA] = PublicKey.findProgramAddressSync([enc('used_nonces'), msgBytes.slice(0, 32)], mtProgram)
    const [tmMinterPDA] = PublicKey.findProgramAddressSync([enc('token_messenger_minter')], tmProgram)
    const [localTokenPDA] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tmProgram)
    const [tokenMinterPDA] = PublicKey.findProgramAddressSync([enc('token_minter')], tmProgram)
    const [custodyAccPDA] = PublicKey.findProgramAddressSync([enc('custody'), mint.toBytes()], tmProgram)
    const [eventAuthPDA] = PublicKey.findProgramAddressSync([enc('__event_authority')], mtProgram)

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: owner })

    const ataInfo = await conn.getAccountInfo(recipientAta)
    if (!ataInfo) {
      tx.add(createAssociatedTokenAccountInstruction(owner, recipientAta, owner, mint))
    }

    tx.add(new TransactionInstruction({
      programId: mtProgram,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: mtPDA, isSigner: false, isWritable: true },
        { pubkey: usedNoncesPDA, isSigner: false, isWritable: true },
        { pubkey: tmMinterPDA, isSigner: false, isWritable: false },
        { pubkey: localTokenPDA, isSigner: false, isWritable: true },
        { pubkey: tokenMinterPDA, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: custodyAccPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: eventAuthPDA, isSigner: false, isWritable: false },
        { pubkey: tmProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    }))

    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(signed.serialize())
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return sig
  }

`;

bridge = bridge.replace(oldBurnFunc, newBurnFunc);

// Fix panggilan signSolanaReceiveMessage - pastikan pakai mintData.attestation dan mintData.message
bridge = bridge.replace(
  'const solTxHash = await signSolanaReceiveMessage(mintData.attestation, mintData.message, mintData.toAddress)',
  'const solTxHash = await signSolanaReceiveMessage(mintData.attestation, mintData.message, solanaWallet!.address)'
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Solana helpers rewritten - browser compatible');
