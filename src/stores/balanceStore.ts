import { create } from 'zustand';

export interface ChainBalance {
  chainKey: string;
  chainName: string;
  balance: string;
  rawBalance: bigint | null;
  loading: boolean;
  error: string | null;
}

export interface BalanceStoreState {
  balances: Record<string, ChainBalance>;
  totalUsd: string;
  loading: boolean;
  lastUpdated: number | null;
  
  setChainBalance: (chainKey: string, balance: Partial<ChainBalance>) => void;
  setTotalUsd: (total: string) => void;
  setLoading: (loading: boolean) => void;
  setLastUpdated: (timestamp: number) => void;
  clearAll: () => void;
}

export const useBalanceStore = create<BalanceStoreState>((set) => ({
  balances: {},
  totalUsd: '0',
  loading: false,
  lastUpdated: null,

  setChainBalance: (chainKey, balanceUpdate) => set((state) => {
    const existing = state.balances[chainKey] || {
      chainKey,
      chainName: '',
      balance: '0',
      rawBalance: null,
      loading: false,
      error: null,
    };
    
    return {
      balances: {
        ...state.balances,
        [chainKey]: { ...existing, ...balanceUpdate },
      }
    };
  }),

  setTotalUsd: (totalUsd) => set({ totalUsd }),
  
  setLoading: (loading) => set({ loading }),
  
  setLastUpdated: (lastUpdated) => set({ lastUpdated }),
  
  clearAll: () => set({
    balances: {},
    totalUsd: '0',
    loading: false,
    lastUpdated: null,
  }),
}));
