export interface SessionStatus {
  active: boolean;
  walletAddress: string;
  delegateAddress: string;
  chainStatus: Record<string, any>;
}

export interface SessionKeyResult {
  delegateAddress: string;
  walletAddress: string;
  pendingAuthorization: boolean;
}

async function fetchWithAuth(url: string, options: RequestInit, token: string) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  
  let response;
  try {
    response = await fetch(url, { 
      ...options, 
      headers,
      signal: AbortSignal.timeout(15000)
    });
  } catch (error: any) {
    throw new Error(error.message || 'Network error');
  }
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function getSessionStatus(token: string): Promise<SessionStatus> {
  return fetchWithAuth('/api/session/status', { method: 'GET' }, token);
}

export async function generateSessionKey(
  walletAddress: string,
  ownerAddress: string | undefined,
  ownerSessionToken: string | undefined,
  token: string
): Promise<SessionKeyResult> {
  return fetchWithAuth('/api/session/generate-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, ownerAddress, ownerSessionToken })
  }, token);
}

export async function setupSession(
  walletAddress: string,
  delegateAddress: string,
  token: string
): Promise<{active: boolean}> {
  return fetchWithAuth('/api/session/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, delegateAddress })
  }, token);
}

export async function recordAuthorizationAttempt(
  walletAddress: string,
  delegateAddress: string,
  authorizationUserOpHash: string,
  token: string
): Promise<{recorded: boolean}> {
  return fetchWithAuth('/api/session/authorization-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, delegateAddress, authorizationUserOpHash })
  }, token);
}

export async function reconcileSession(
  walletAddress: string,
  token: string
): Promise<{resolved: boolean; notFound?: boolean}> {
  return fetchWithAuth('/api/session/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress })
  }, token);
}

export async function authorizeChain(
  chainKey: string,
  walletAddress: string,
  delegateAddress: string,
  authorizationUserOpHash: string,
  token: string
): Promise<{authorized: boolean}> {
  return fetchWithAuth('/api/session/authorize-chain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainKey, walletAddress, delegateAddress, authorizationUserOpHash })
  }, token);
}

export async function getDestinationStatus(
  chainKey: string,
  walletAddress: string,
  token: string
): Promise<{deployed: boolean; authorized: boolean}> {
  const params = new URLSearchParams({ chainKey, walletAddress });
  return fetchWithAuth(`/api/session/destination-status?${params.toString()}`, { method: 'GET' }, token);
}
