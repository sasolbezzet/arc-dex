import React, { useState, useEffect, useRef } from 'react';

export interface AgentWalletSummaryProps {
  walletAddress: string;
  label?: string;
  showBalance?: boolean;
}

export const AgentWalletSummary: React.FC<AgentWalletSummaryProps> = ({
  walletAddress,
  label = 'Wallet:',
  showBalance = true,
}) => {
  const [balance, setBalance] = useState<string>('—');
  const [copied, setCopied] = useState<boolean>(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!showBalance || !walletAddress) return;

    const fetchBalance = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(`/api/multi-balance/${walletAddress}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        // Parsing total USDC balance, handling multiple common field names
        const totalUsdc = data.totalUsdc ?? data.usdcBalance ?? data.totalUSDC ?? data.balance ?? 0;
        
        const parsedBalance = Number(totalUsdc);
        if (mounted.current && !isNaN(parsedBalance) && parsedBalance !== null) {
          setBalance(parsedBalance.toFixed(2));
        } else if (mounted.current) {
          setBalance('0.00');
        }
      } catch (error) {
        console.error('Failed to fetch balance:', error);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 60000);

    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [walletAddress, showBalance]);

  const handleCopy = () => {
    navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const truncateAddress = (addr: string) => {
    if (!addr) return '';
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  return (
    <div className="flex flex-row items-center space-x-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-mono text-indigo-400 text-sm">
        {truncateAddress(walletAddress)}
      </span>
      <button 
        onClick={handleCopy}
        className="text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:text-indigo-300 transition-colors rounded p-1"
        title="Copy Address"
      >
        {copied ? '✅' : '📋'}
      </button>
      {showBalance && (
        <span className="text-sm text-green-400 font-medium">
          {balance !== '—' ? `$${balance}` : '—'}
        </span>
      )}
    </div>
  );
};
