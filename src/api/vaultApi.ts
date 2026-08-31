import { apiClient } from './client';
import type {
  VaultAgent,
  McpSession,
  Approval,
  Activity,
  Credential,
  Limits,
  PendingTx,
  AgentConnectionToken,
} from '../types/agent';

async function fetchWithAuth<T>(
  url: string,
  method: string,
  token: string,
  body?: any
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error: any) {
    throw new Error(error.message || 'Network error');
  }

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.message) errorMessage = errorData.message;
      else if (errorData.error) errorMessage = errorData.error;
    } catch (e) {
      // Ignored
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export const listVaultAgents = (token: string): Promise<VaultAgent[]> =>
  fetchWithAuth<VaultAgent[]>('/api/vault/agents', 'GET', token);

export const getVaultSessions = (token: string): Promise<McpSession[]> =>
  fetchWithAuth<McpSession[]>('/api/vault/sessions', 'GET', token);

export const getVaultApprovals = (token: string): Promise<Approval[]> =>
  fetchWithAuth<Approval[]>('/api/vault/approvals', 'GET', token);

export const getVaultActivity = (token: string): Promise<Activity[]> =>
  fetchWithAuth<Activity[]>('/api/vault/activity', 'GET', token);

export const getVaultCredentials = (token: string): Promise<Credential[]> =>
  fetchWithAuth<Credential[]>('/api/vault/credentials', 'GET', token);

export const getVaultLimits = (token: string): Promise<Limits> =>
  fetchWithAuth<Limits>('/api/vault/limits', 'GET', token);

export const getPendingTxs = (token: string): Promise<PendingTx[]> =>
  fetchWithAuth<PendingTx[]>('/api/pending-txs', 'GET', token);

export const createConnectionToken = (
  agentKey: string,
  clientName: string,
  ttlDays: number,
  token: string,
  walletAddress?: string
): Promise<AgentConnectionToken> => {
  const url = agentKey 
    ? `/api/vault/agents/${encodeURIComponent(agentKey)}/connection-token` 
    : '/api/vault/agents/bootstrap-connection-token';
  return fetchWithAuth<AgentConnectionToken>(url, 'POST', token, {
    agentKey,
    clientName,
    ttlDays,
    walletAddress,
  });
};

export const revokeVaultAgent = (
  agentKey: string,
  token: string
): Promise<{ success: boolean }> =>
  fetchWithAuth<{ success: boolean }>(`/api/vault/agents/${encodeURIComponent(agentKey)}`, 'DELETE', token);
