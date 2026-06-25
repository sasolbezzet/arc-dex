import { useI18n, type Lang } from '../i18n'

type DocSection = {
  title: string
  body: string
  steps?: string[]
  code?: string
}

const docs: Record<Lang, { intro: string; warning: DocSection; sections: DocSection[]; agentMcp: { intro: string; sections: DocSection[] } }> = {
  id: {
    intro: 'Panduan singkat ARCOX DEX untuk wallet, swap, bridge, send, receive, agent jobs, dan recovery transaksi bridge.',
    warning: {
      title: 'Bridge pending bukan berarti dana hilang',
      body: 'Bridge CCTP berjalan beberapa tahap: approve, burn, attestation, lalu mint/receive di chain tujuan. Jika burn sudah sukses tetapi mint pending, dana sedang menunggu bukti attestation atau transaksi receive. Jangan ulang burn dengan nominal yang sama sebelum cek Retry Center.',
      steps: [
        'Buka tab Info, lalu lihat Bridge Retry Center.',
        'Jika transaksi muncul di sana, tekan Retry Mint setelah wallet berada di chain tujuan.',
        'Pastikan wallet punya gas testnet di chain tujuan. Arc memakai USDC sebagai gas, EVM lain memakai ETH testnet.',
        'Jika retry gagal, salin burn tx hash dan tunggu beberapa menit sebelum retry lagi. Attestation kadang belum siap.',
      ],
    },
    sections: [
      {
        title: 'Mulai pakai app',
        body: 'Hubungkan MetaMask dari tombol Connect Wallet. App akan meminta signature login untuk membuktikan ownership wallet, lalu menyiapkan Circle Wallet proxy bila tersedia.',
        steps: ['Pastikan MetaMask aktif.', 'Gunakan jaringan testnet yang diminta app.', 'Jika Circle Wallet belum muncul, tekan Retry setup di header.'],
      },
      {
        title: 'Saldo dan wallet',
        body: 'Header menampilkan MetaMask, Circle Wallet, E-USDC, E-cirBTC, dan saldo Circle jika ada. E berarti saldo EOA/MetaMask, C berarti saldo Circle Wallet proxy.',
      },
      {
        title: 'Swap',
        body: 'Swap memakai wallet user untuk transaksi EOA. Selalu buat quote/estimasi dulu sebelum swap. Jika route belum tersedia, ganti token, jumlah, atau coba lagi setelah liquidity/route tersedia.',
      },
      {
        title: 'Bridge',
        body: 'Bridge memindahkan USDC atau token yang didukung antar testnet melalui Circle CCTP. Flow normal adalah approve, burn, menunggu attestation, lalu mint di chain tujuan.',
        steps: ['Pilih chain asal dan tujuan.', 'Pilih sumber dana: Circle Wallet atau EOA jika tersedia.', 'Masukkan jumlah, cek estimasi diterima, lalu ikuti popup wallet.', 'Tunggu sampai step mint selesai sebelum refresh saldo.'],
      },
      {
        title: 'Bridge Solana',
        body: 'Untuk Solana, user wajib memakai Solana Devnet. Gunakan Solflare atau Phantom Devnet. Bridge dari atau ke Solana membutuhkan signature wallet Solana untuk burn/mint.',
      },
      {
        title: 'Send',
        body: 'Menu Send dipakai untuk mengirim token dari Circle Wallet proxy atau EOA. Untuk EOA, transaksi harus ditandatangani dari wallet user.',
      },
      {
        title: 'Receive',
        body: 'Menu Receive menampilkan alamat penerima dan bisa membuat request link berisi token, nominal, dan memo. Link akan membuka app ke flow Send.',
      },
      {
        title: 'ARCOX Pay',
        body: 'ARCOX Pay membuat invoice/payment link USDC publik di Arc Testnet. Buka /pay/status untuk membuat invoice x402, melihat exact amount, memo ID, status settlement, dan opsi Unified Balance.',
        steps: ['Invoice payment tidak menyimpan private key user.', 'Pembayaran EOA sign lewat wallet user.', 'Privacy/private payment masih roadmap, bukan fitur live.'],
      },
      {
        title: 'Circle Gateway Nanopayments',
        body: 'ARCOX x402 sekarang memakai invoice internal dan pembayaran USDC real di Arc Testnet dengan Transaction Memo. Circle Gateway/Unified Balance disiapkan sebagai rail pembayaran, sedangkan gas-free nanopayments masih roadmap.',
        steps: ['Invoice publik tetap pembayaran USDC biasa di Arc Testnet.', 'x402 tidak membuka data sebelum invoice paid.', 'Tidak ada fee tersembunyi pada invoice merchant.', 'Buka /pay/status untuk cek payment status.'],
      },
      {
        title: 'Agent Jobs',
        body: 'Menu Agent Jobs adalah simulasi agentic economy: register agent, hubungkan AI endpoint, create job, fund escrow USDC, submit deliverable, lalu verifier/evaluator menyelesaikan job.',
      },
      {
        title: 'Info dan history',
        body: 'Menu Info menampilkan address, Wallet ID, semua saldo, riwayat bridge, dan Bridge Retry Center. Ini halaman utama untuk diagnosis transaksi pending.',
      },
    ],
    agentMcp: {
      intro: 'ARCOX MCP membuat agent lokal seperti Codex atau Hermes bisa memahami dan menjalankan fitur ARCOX DEX dari terminal, dengan private key tetap berada di komputer user.',
      sections: [
        {
          title: 'Instalasi sekali pakai',
          body: 'Install package npm publik lalu jalankan server MCP lokal. Setelah terpasang, agent bisa memanggil tools ARCOX tanpa mencari file repo.',
          code: 'npm install -g arcox-mcp\narcox-mcp',
        },
        {
          title: 'File env user',
          body: 'Simpan private key dan RPC di komputer user. Jangan taruh private key di browser, chat, atau repository.',
          code: 'mkdir -p ~/.arcox\nnano ~/.arcox/.env\n\nAGENT_PRIVATE_KEY=0x...\nARC_RPC=https://rpc.testnet.arc.network/\nARCOX_API_URL=https://arc-dex-bice.vercel.app\nSOLANA_PRIVATE_KEY=[1,2,3,...]\nSOLANA_DEVNET_RPC=https://api.devnet.solana.com',
        },
        {
          title: 'Koneksi ke Hermes',
          body: 'Tambahkan MCP server ke Hermes. Pastikan args berbentuk array kosong, bukan string.',
          code: 'hermes mcp add arcox -- arcox-mcp\n\nmcp_servers:\n  arcox:\n    command: arcox-mcp\n    args: []',
        },
        {
          title: 'Koneksi ke Codex',
          body: 'Tambahkan MCP server bernama arcox dengan command arcox-mcp. Setelah itu restart Codex session agar tool muncul.',
          code: '{\n  "mcpServers": {\n    "arcox": {\n      "command": "arcox-mcp",\n      "args": []\n    }\n  }\n}',
        },
        {
          title: 'Aturan keamanan transaksi',
          body: 'Semua aksi yang memindahkan dana wajib quote/preview dulu. User cukup jawab yes, ya, confirm, konfirmasi, lanjut, atau ok setelah membaca preview. Agent tidak boleh langsung execute hanya dengan confirmed=true.',
          steps: ['Agent memanggil quote.', 'Agent menampilkan detail route, fee, saldo, wallet sumber, estimasi diterima, dan risiko.', 'User memberi konfirmasi sederhana.', 'Agent execute dengan previewId dan confirmationText.'],
        },
        {
          title: 'Fitur MCP',
          body: 'Tools MCP mencakup balances, history, route status, UI map, swap, bridge, send, retry bridge, agent status, dan Agentic Economy jobs.',
          steps: ['arcox_wallet_balances', 'arcox_transaction_history', 'arcox_quote_swap / arcox_execute_swap', 'arcox_quote_bridge / arcox_execute_bridge', 'arcox_quote_send / arcox_execute_send', 'arcox_retry_bridge', 'arcox_agent_job', 'arcox_search_docs / arcox_read_doc'],
        },
        {
          title: 'Dynamic-style docs discovery',
          body: 'Mengikuti pola Dynamic MCP docs, ARCOX MCP menyediakan tool untuk mencari dan membaca dokumentasi produk. Agent harus memakai docs tool ini sebelum menebak flow yang tidak dikenal.',
          steps: ['arcox_search_docs mencari topik ARCOX.', 'arcox_read_doc membaca halaman docs terstruktur.', 'Resource MCP tetap tersedia untuk UI map dan safety rules.'],
        },
        {
          title: 'Contoh prompt',
          body: 'Prompt harus tetap natural, tapi untuk transaksi agent wajib menampilkan preview dulu.',
          code: 'show all wallet balances\nquote bridge 1 usdc from arc to base\nsend 1 eurc from eoa to 0x...\nretry bridge 0xBURN_TX from arbitrum sepolia to arc\nswap 1 eurc to usdc\ncreate agent job review github repo with budget 1 usdc',
        },
        {
          title: 'Batasan penting',
          body: 'EOA execution memakai AGENT_PRIVATE_KEY lokal. Circle Wallet proxy memakai backend ARCOX dan wallet id dari database ARCOX DEX. Solana wajib Devnet. Untuk Web UI, EOA tetap sign lewat wallet browser user.',
        },
      ],
    },
  },
  en: {
    intro: 'A short ARCOX DEX guide for wallets, swap, bridge, send, receive, agent jobs, and bridge recovery.',
    warning: {
      title: 'A pending bridge does not mean funds are lost',
      body: 'CCTP bridging has several stages: approve, burn, attestation, then mint/receive on the destination chain. If burn succeeded but mint is pending, the funds are waiting for attestation or the receive transaction. Do not burn the same amount again before checking Retry Center.',
      steps: [
        'Open Info, then check Bridge Retry Center.',
        'If the transaction appears there, press Retry Mint after your wallet is on the destination chain.',
        'Make sure the wallet has testnet gas on the destination chain. Arc uses USDC as gas, other EVM testnets use test ETH.',
        'If retry fails, copy the burn tx hash and wait a few minutes before retrying. Attestation may not be ready yet.',
      ],
    },
    sections: [
      { title: 'Getting started', body: 'Connect MetaMask from Connect Wallet. The app asks for a login signature to prove wallet ownership, then prepares the Circle Wallet proxy when available.', steps: ['Keep MetaMask active.', 'Use the testnet requested by the app.', 'If Circle Wallet is missing, press Retry setup in the header.'] },
      { title: 'Balances and wallets', body: 'The header shows MetaMask, Circle Wallet, E-USDC, E-cirBTC, and Circle balances when present. E means EOA/MetaMask balance, C means Circle Wallet proxy balance.' },
      { title: 'Swap', body: 'Swap uses the user wallet for EOA transactions. Always create a quote/estimate before swapping. If no route is available, change token, amount, or try again later.' },
      { title: 'Bridge', body: 'Bridge moves supported tokens across testnets through Circle CCTP. The normal flow is approve, burn, wait for attestation, then mint on the destination chain.', steps: ['Choose source and destination chains.', 'Choose Circle Wallet or EOA as the funding source.', 'Enter amount, check estimated receive, then follow wallet popups.', 'Wait for mint to finish before refreshing balances.'] },
      { title: 'Solana bridge', body: 'Solana users must use Solana Devnet. Use Solflare or Phantom Devnet. Bridge from or to Solana requires Solana wallet signatures for burn/mint.' },
      { title: 'Send', body: 'Send transfers tokens from Circle Wallet proxy or EOA. For EOA, the transaction must be signed by the user wallet.' },
      { title: 'Receive', body: 'Receive shows the receiving address and can create a request link with token, amount, and memo. The link opens the app into the Send flow.' },
      { title: 'ARCOX Pay', body: 'ARCOX Pay creates public USDC invoices/payment links on Arc Testnet. Open /pay/status to create x402 invoices, check exact amount, memo ID, settlement status, and Unified Balance options.', steps: ['Invoice payment never stores user private keys.', 'EOA invoice payment is signed by the user wallet.', 'Privacy/private payment is roadmap only, not live.'] },
      { title: 'Circle Gateway / x402', body: 'ARCOX x402 uses internal invoices and real Arc Testnet USDC with Transaction Memo reconciliation. Circle Gateway/Unified Balance is prepared as a payment rail, while gas-free nanopayments remain roadmap work.', steps: ['Public invoices remain normal USDC payments on Arc Testnet.', 'x402 never unlocks data before paid status.', 'No hidden fee is taken from merchant invoices.', 'Open /pay/status to check payment status.'] },
      { title: 'Agent Jobs', body: 'Agent Jobs simulates agentic economy flows: register agent, link AI endpoint, create job, fund USDC escrow, submit deliverable, then verifier/evaluator completes the job.' },
      { title: 'Info and history', body: 'Info shows address, Wallet ID, all balances, bridge history, and Bridge Retry Center. This is the main page for diagnosing pending transactions.' },
    ],
    agentMcp: {
      intro: 'ARCOX MCP lets a local agent such as Codex or Hermes understand and run ARCOX DEX features from the terminal while private keys stay on the user computer.',
      sections: [
        { title: 'One-time install', body: 'Install the public npm package and run the local MCP server. After installation, the agent can call ARCOX tools without searching repository files.', code: 'npm install -g arcox-mcp\narcox-mcp' },
        { title: 'User env file', body: 'Store private keys and RPC settings on the user computer. Do not put private keys in the browser, chat, or repository.', code: 'mkdir -p ~/.arcox\nnano ~/.arcox/.env\n\nAGENT_PRIVATE_KEY=0x...\nARC_RPC=https://rpc.testnet.arc.network/\nARCOX_API_URL=https://arc-dex-bice.vercel.app\nSOLANA_PRIVATE_KEY=[1,2,3,...]\nSOLANA_DEVNET_RPC=https://api.devnet.solana.com' },
        { title: 'Connect Hermes', body: 'Add the MCP server to Hermes. Make sure args is an empty array, not a string.', code: 'hermes mcp add arcox -- arcox-mcp\n\nmcp_servers:\n  arcox:\n    command: arcox-mcp\n    args: []' },
        { title: 'Connect Codex', body: 'Add an MCP server named arcox with command arcox-mcp. Restart the Codex session so the tool appears.', code: '{\n  "mcpServers": {\n    "arcox": {\n      "command": "arcox-mcp",\n      "args": []\n    }\n  }\n}' },
        { title: 'Transaction safety rule', body: 'Every value-moving action must quote/preview first. The user can simply reply yes, ya, confirm, konfirmasi, lanjut, or ok after reading the preview. The agent must not execute directly with confirmed=true only.', steps: ['Agent calls quote.', 'Agent shows route, fee, balances, source wallet, estimated receive, and risks.', 'User gives a simple confirmation.', 'Agent executes with previewId and confirmationText.'] },
        { title: 'MCP features', body: 'MCP tools cover balances, history, route status, UI map, swap, bridge, send, retry bridge, agent status, and Agentic Economy jobs.', steps: ['arcox_wallet_balances', 'arcox_transaction_history', 'arcox_quote_swap / arcox_execute_swap', 'arcox_quote_bridge / arcox_execute_bridge', 'arcox_quote_send / arcox_execute_send', 'arcox_retry_bridge', 'arcox_agent_job', 'arcox_search_docs / arcox_read_doc'] },
        { title: 'Dynamic-style docs discovery', body: 'Following the Dynamic MCP docs pattern, ARCOX MCP exposes tools for searching and reading product documentation. Agents should use these docs tools before guessing an unfamiliar flow.', steps: ['arcox_search_docs searches ARCOX topics.', 'arcox_read_doc reads structured doc pages.', 'MCP resources still expose UI map and safety rules.'] },
        { title: 'Prompt examples', body: 'Prompts can stay natural, but for transactions the agent must show a preview first.', code: 'show all wallet balances\nquote bridge 1 usdc from arc to base\nsend 1 eurc from eoa to 0x...\nretry bridge 0xBURN_TX from arbitrum sepolia to arc\nswap 1 eurc to usdc\ncreate agent job review github repo with budget 1 usdc' },
        { title: 'Important limits', body: 'EOA execution uses the local AGENT_PRIVATE_KEY. Circle Wallet proxy uses ARCOX backend and the wallet id from the ARCOX DEX database. Solana must use Devnet. In the Web UI, EOA still signs through the user browser wallet.' },
      ],
    },
  },
  zh: {
    intro: 'ARCOX DEX 简短指南：钱包、兑换、跨链、发送、收款、Agent Jobs 和桥接恢复。',
    warning: {
      title: 'Bridge pending 不代表资产丢失',
      body: 'CCTP 跨链分为 approve、burn、attestation、目标链 mint/receive。若 burn 已成功但 mint pending，通常是在等待 attestation 或 receive 交易。先检查 Retry Center，不要马上重复 burn 同样金额。',
      steps: [
        '打开 Info 页面，查看 Bridge Retry Center。',
        '如果交易出现在列表里，切到目标链后点击 Retry Mint。',
        '确认目标链钱包有测试网 gas。Arc 使用 USDC 作为 gas，其他 EVM 测试网使用测试 ETH。',
        '如果 retry 失败，复制 burn tx hash，等待几分钟后再试。Attestation 可能还未准备好。',
      ],
    },
    sections: [
      { title: '开始使用', body: '点击 Connect Wallet 连接 MetaMask。App 会要求签名登录以证明钱包 ownership，然后准备 Circle Wallet proxy。', steps: ['保持 MetaMask 可用。', '使用 app 要求的测试网。', '如果 Circle Wallet 未显示，点击 header 的 Retry setup。'] },
      { title: '余额和钱包', body: 'Header 显示 MetaMask、Circle Wallet、E-USDC、E-cirBTC 以及 Circle 余额。E 表示 EOA/MetaMask，C 表示 Circle Wallet proxy。' },
      { title: 'Swap', body: 'Swap 的 EOA 交易由用户钱包签名。Swap 前必须先获取 quote/estimate。若无 route，请更换 token、金额或稍后再试。' },
      { title: 'Bridge', body: 'Bridge 通过 Circle CCTP 在测试网间移动支持的 token。正常流程是 approve、burn、等待 attestation、目标链 mint。', steps: ['选择来源链和目标链。', '选择 Circle Wallet 或 EOA 作为资金来源。', '输入金额，确认 estimated receive，然后按钱包弹窗操作。', '等待 mint 完成后再刷新余额。'] },
      { title: 'Solana bridge', body: 'Solana 用户必须使用 Solana Devnet。请使用 Solflare 或 Phantom Devnet。Solana 方向的 bridge 需要 Solana 钱包签名 burn/mint。' },
      { title: 'Send', body: 'Send 用于从 Circle Wallet proxy 或 EOA 发送 token。EOA 发送必须由用户钱包签名。' },
      { title: 'Receive', body: 'Receive 显示收款地址，也可以创建包含 token、金额、memo 的 request link。链接会打开 Send flow。' },
      { title: 'ARCOX Pay', body: 'ARCOX Pay 在 Arc Testnet 创建公开 USDC invoice/payment link。打开 /pay/status 可创建 x402 invoice、查看 exact amount、memo ID、settlement status 和 Unified Balance 选项。', steps: ['Invoice payment 不保存用户 private key。', 'EOA invoice payment 由用户钱包签名。', 'Privacy/private payment 只是 roadmap，不是 live 功能。'] },
      { title: 'Circle Gateway / x402', body: 'ARCOX x402 使用内部 invoice，并通过 Arc Testnet USDC + Transaction Memo 做真实测试网支付和 reconciliation。Circle Gateway/Unified Balance 是支付 rail，gas-free nanopayments 仍是 roadmap。', steps: ['Public invoice 仍是 Arc Testnet 上的普通 USDC payment。', 'x402 在 paid 前不会解锁数据。', '不会从 merchant invoice 中隐藏收费。', '打开 /pay/status 查看 payment status。'] },
      { title: 'Agent Jobs', body: 'Agent Jobs 模拟 agentic economy：注册 agent、连接 AI endpoint、创建 job、注入 USDC escrow、提交 deliverable，然后 verifier/evaluator 完成 job。' },
      { title: 'Info and history', body: 'Info 显示 address、Wallet ID、全部余额、bridge history 和 Bridge Retry Center。这里是排查 pending bridge 的主要页面。' },
    ],
    agentMcp: {
      intro: 'ARCOX MCP 让 Codex 或 Hermes 等本地 agent 可以从终端理解并执行 ARCOX DEX 功能，私钥仍保存在用户电脑。',
      sections: [
        { title: '一次安装', body: '安装公开 npm package 并运行本地 MCP server。安装后 agent 可以直接调用 ARCOX tools。', code: 'npm install -g arcox-mcp\narcox-mcp' },
        { title: '用户 env 文件', body: '把 private key 和 RPC 保存在用户电脑。不要把 private key 放进浏览器、聊天或仓库。', code: 'mkdir -p ~/.arcox\nnano ~/.arcox/.env\n\nAGENT_PRIVATE_KEY=0x...\nARC_RPC=https://rpc.testnet.arc.network/\nARCOX_API_URL=https://arc-dex-bice.vercel.app\nSOLANA_PRIVATE_KEY=[1,2,3,...]\nSOLANA_DEVNET_RPC=https://api.devnet.solana.com' },
        { title: '连接 Hermes', body: '把 MCP server 添加到 Hermes。确认 args 是空数组，不是字符串。', code: 'hermes mcp add arcox -- arcox-mcp\n\nmcp_servers:\n  arcox:\n    command: arcox-mcp\n    args: []' },
        { title: '连接 Codex', body: '添加名为 arcox 的 MCP server，command 使用 arcox-mcp。重启 Codex session 后 tool 会出现。', code: '{\n  "mcpServers": {\n    "arcox": {\n      "command": "arcox-mcp",\n      "args": []\n    }\n  }\n}' },
        { title: '交易安全规则', body: '所有会移动资金的动作必须先 quote/preview。用户阅读 preview 后只需回复 yes、ya、confirm、konfirmasi、lanjut 或 ok。agent 不允许只用 confirmed=true 直接执行。', steps: ['Agent 调用 quote。', 'Agent 显示 route、fee、余额、来源钱包、预计到账和风险。', '用户给出简单确认。', 'Agent 使用 previewId 和 confirmationText 执行。'] },
        { title: 'MCP 功能', body: 'MCP tools 包含 balances、history、route status、UI map、swap、bridge、send、retry bridge、agent status 和 Agentic Economy jobs。', steps: ['arcox_wallet_balances', 'arcox_transaction_history', 'arcox_quote_swap / arcox_execute_swap', 'arcox_quote_bridge / arcox_execute_bridge', 'arcox_quote_send / arcox_execute_send', 'arcox_retry_bridge', 'arcox_agent_job', 'arcox_search_docs / arcox_read_doc'] },
        { title: 'Dynamic-style docs discovery', body: '参考 Dynamic MCP docs 模式，ARCOX MCP 提供搜索和读取产品文档的 tools。Agent 在不熟悉 flow 时应先调用 docs tools，而不是猜测。', steps: ['arcox_search_docs 搜索 ARCOX topic。', 'arcox_read_doc 读取结构化 docs。', 'MCP resources 继续提供 UI map 和 safety rules。'] },
        { title: 'Prompt 示例', body: 'Prompt 可以保持自然语言，但交易必须先显示 preview。', code: 'show all wallet balances\nquote bridge 1 usdc from arc to base\nsend 1 eurc from eoa to 0x...\nretry bridge 0xBURN_TX from arbitrum sepolia to arc\nswap 1 eurc to usdc\ncreate agent job review github repo with budget 1 usdc' },
        { title: '重要限制', body: 'EOA execution 使用本地 AGENT_PRIVATE_KEY。Circle Wallet proxy 使用 ARCOX backend 和 ARCOX DEX 数据库里的 wallet id。Solana 必须使用 Devnet。Web UI 中 EOA 仍由用户浏览器钱包签名。' },
      ],
    },
  },
}

export function DocsPanel() {
  const { lang } = useI18n()
  const content = docs[lang]
  return (
    <div className='docs-panel'>
      <div className='docs-hero'>
        <div>
          <div className='docs-kicker'>ARCOX DEX Docs</div>
          <h2>User Guide</h2>
          <p>{content.intro}</p>
        </div>
      </div>

      <section className='docs-alert'>
        <div className='docs-alert-icon'>!</div>
        <div>
          <h3>{content.warning.title}</h3>
          <p>{content.warning.body}</p>
          <ol>
            {content.warning.steps?.map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </section>

      <div className='docs-grid'>
        {content.sections.map(section => (
          <section className='docs-card' key={section.title}>
            <h3>{section.title}</h3>
            <p>{section.body}</p>
            {section.steps && (
              <ol>
                {section.steps.map(step => <li key={step}>{step}</li>)}
              </ol>
            )}
          </section>
        ))}
      </div>

      <section className='docs-agent-section'>
        <div className='docs-kicker'>Agent MCP</div>
        <h2>Terminal Agent Setup</h2>
        <p>{content.agentMcp.intro}</p>
        <div className='docs-grid docs-agent-grid'>
          {content.agentMcp.sections.map(section => (
            <section className='docs-card' key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
              {section.steps && (
                <ol>
                  {section.steps.map(step => <li key={step}>{step}</li>)}
                </ol>
              )}
              {section.code && <pre className='docs-code'><code>{section.code}</code></pre>}
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
