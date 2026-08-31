export interface PasskeyOptions {
  flowId: string;
  options: any; // WebAuthnOptions
}

export interface PasskeyResult {
  success: boolean;
  token: string;
  address: string;
  walletAddress: string;
  credential: {
    id: string;
    publicKey: string;
  };
}

export interface OAuthVerifyParams {
  mscaWalletAddress: string;
  mscaSessionToken: string;
  requestId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface OAuthVerifyResult {
  redirect: string;
  success: boolean;
}

export async function getPasskeyOptions(
  mode: 'Login' | 'Register',
  agentKey?: string,
  username?: string
): Promise<PasskeyOptions> {
  let response;
  try {
    response = await fetch('/api/auth/passkey-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, agentKey, username }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error: any) {
    throw new Error(error.message || 'Network error');
  }
  
  if (!response.ok) {
    throw new Error(`Failed to get passkey options: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

export async function verifyPasskey(
  credential: any,
  mode: 'Login' | 'Register',
  flowId: string,
  agentKey?: string,
  walletAddress?: string
): Promise<PasskeyResult> {
  let response;
  try {
    response = await fetch('/api/auth/passkey-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, mode, flowId, agentKey, walletAddress }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error: any) {
    throw new Error(error.message || 'Network error');
  }
  
  if (!response.ok) {
    throw new Error(`Failed to verify passkey: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

export async function verifyPasskeyForOAuth(params: OAuthVerifyParams): Promise<OAuthVerifyResult> {
  let response;
  try {
    response = await fetch('/api/auth/passkey-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error: any) {
    throw new Error(error.message || 'Network error');
  }
  
  if (!response.ok) {
    throw new Error(`Failed to verify passkey for OAuth: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

export async function createAuthSession(
  address: string,
  signature: string,
  message: string
): Promise<{ token: string }> {
  let response;
  try {
    response = await fetch('/api/auth/siwe-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, message }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error: any) {
    throw new Error(error.message || 'Network error');
  }
  
  if (!response.ok) {
    throw new Error(`Failed to create auth session: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}
