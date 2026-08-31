import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthState {
  jwtToken: string | null;
  jwtAddress: string | null;
  vaultToken: string | null;
  hermesToken: string | null;
  hermesWalletAddress: string | null;
  agentTokens: Record<string, string>;
  isAuthenticated: boolean;

  setJwt: (token: string, address: string) => void;
  clearJwt: () => void;
  setVaultToken: (token: string) => void;
  clearVaultToken: () => void;
  setHermesSession: (token: string, walletAddress: string) => void;
  clearHermesSession: () => void;
  setAgentToken: (agentKey: string, token: string) => void;
  clearAgentToken: (agentKey: string) => void;
  clearAll: () => void;
}

const getMigratedInitialState = () => {
  let jwtToken: string | null = null;
  let vaultToken: string | null = null;
  let hermesToken: string | null = null;
  let hermesWalletAddress: string | null = null;
  const agentTokens: Record<string, string> = {};

  if (typeof window !== 'undefined') {
    // Migrate 'arc-dex-auth' -> jwtToken
    const arcDexAuth = localStorage.getItem('arc-dex-auth');
    if (arcDexAuth) {
      try {
        const parsed = JSON.parse(arcDexAuth);
        jwtToken = parsed.state?.jwtToken || parsed.jwtToken || parsed.state?.token || parsed.token || null;
      } catch {
        jwtToken = arcDexAuth;
      }
    }

    // Migrate vault token
    vaultToken =
      localStorage.getItem('arx_vault_token') ||
      localStorage.getItem('arx_passkey_vault_token') ||
      null;

    // Migrate hermes session
    hermesToken = localStorage.getItem('arx_hermes_vault_token') || null;
    hermesWalletAddress = localStorage.getItem('arx_hermes_wallet_address') || null;

    // Migrate agent tokens
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('arx_oauth_vault_token:')) {
        const agentKey = key.replace('arx_oauth_vault_token:', '');
        if (agentKey) {
          agentTokens[agentKey] = localStorage.getItem(key) || '';
        }
      }
    }
  }

  return {
    jwtToken,
    jwtAddress: null,
    vaultToken,
    hermesToken,
    hermesWalletAddress,
    agentTokens,
  };
};

const initialState = getMigratedInitialState();

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      jwtToken: initialState.jwtToken,
      jwtAddress: initialState.jwtAddress,
      vaultToken: initialState.vaultToken,
      hermesToken: initialState.hermesToken,
      hermesWalletAddress: initialState.hermesWalletAddress,
      agentTokens: initialState.agentTokens,
      isAuthenticated: initialState.jwtToken !== null,

      setJwt: (token, address) =>
        set(() => ({
          jwtToken: token,
          jwtAddress: address,
          isAuthenticated: token !== null,
        })),

      clearJwt: () =>
        set(() => ({
          jwtToken: null,
          jwtAddress: null,
          isAuthenticated: false,
        })),

      setVaultToken: (token) =>
        set(() => ({
          vaultToken: token,
        })),

      clearVaultToken: () =>
        set(() => ({
          vaultToken: null,
        })),

      setHermesSession: (token, walletAddress) =>
        set(() => ({
          hermesToken: token,
          hermesWalletAddress: walletAddress,
        })),

      clearHermesSession: () =>
        set(() => ({
          hermesToken: null,
          hermesWalletAddress: null,
        })),

      setAgentToken: (agentKey, token) =>
        set((state) => ({
          agentTokens: {
            ...state.agentTokens,
            [agentKey]: token,
          },
        })),

      clearAgentToken: (agentKey) =>
        set((state) => {
          const newAgentTokens = { ...state.agentTokens };
          delete newAgentTokens[agentKey];
          return { agentTokens: newAgentTokens };
        }),

      clearAll: () =>
        set(() => ({
          jwtToken: null,
          jwtAddress: null,
          vaultToken: null,
          hermesToken: null,
          hermesWalletAddress: null,
          agentTokens: {},
          isAuthenticated: false,
        })),
    }),
    {
      name: 'arx-auth',
    }
  )
);
