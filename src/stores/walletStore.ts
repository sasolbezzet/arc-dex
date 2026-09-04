import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WalletState {
  address: string | null;
  chainId: number | null;
  provider: any | null;
  circleWallet: string | null;
  solanaAddress: string | null;
  isConnecting: boolean;

  connect: (address: string, provider: any, chainId?: number) => void;
  disconnect: () => void;
  setChainId: (chainId: number) => void;
  setCircleWallet: (address: string | null) => void;
  setSolanaAddress: (address: string | null) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      address: null,
      chainId: null,
      provider: null,
      circleWallet: null,
      solanaAddress: null,
      isConnecting: false,

      connect: (address, provider, chainId) =>
        set({ address, provider, chainId: chainId ?? null, isConnecting: false }),

      disconnect: () =>
        set({
          address: null,
          provider: null,
          chainId: null,
          circleWallet: null,
          solanaAddress: null,
        }),

      setChainId: (chainId) => set({ chainId }),

      setCircleWallet: (circleWallet) => set({ circleWallet }),

      setSolanaAddress: (solanaAddress) => set({ solanaAddress }),
    }),
    {
      name: 'arx-wallet',
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(
            ([key]) => !['provider', 'isConnecting'].includes(key)
          )
        ),
    }
  )
);
