export class ApiError extends Error {
  public status: number;
  public code: string;
  public data: unknown;

  constructor(message: string, status: number, code: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  
  let token = window.localStorage.getItem('arx_vault_token') || window.localStorage.getItem('arx_passkey_vault_token');
  
  if (token) {
    try {
      // Handle potential JSON string from Zustand persist or other serialization
      const parsed = JSON.parse(token);
      if (parsed && typeof parsed === 'object') {
        if (parsed.state?.token) {
          token = parsed.state.token;
        } else if (parsed.token) {
          token = parsed.token;
        } else if (typeof parsed === 'string') {
          token = parsed;
        }
      }
    } catch {
      // If it fails to parse, it might just be a raw string token, so we proceed with it as-is
    }
  }
  
  return token || null;
}

export interface ApiConfig extends Omit<RequestInit, 'body'> {
  timeoutMs?: number;
}

const BASE_URL = '';

async function request<T>(path: string, options: RequestInit & { timeoutMs?: number }): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const timeoutMs = options.timeoutMs ?? 15000;
  
  const config: RequestInit = {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(timeoutMs),
  };

  try {
    const response = await fetch(`${BASE_URL}${path}`, config);

    let data: any;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message = data?.message || response.statusText || 'API Request Failed';
      const code = data?.code || 'UNKNOWN_ERROR';
      throw new ApiError(message, response.status, code, data);
    }

    return data as T;
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.message?.toLowerCase().includes('timeout')) {
      throw new ApiError('Request timed out', 408, 'TIMEOUT_ERROR');
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(error.message || 'Network Error', 0, 'NETWORK_ERROR');
  }
}

export const apiClient = {
  get: <T>(path: string, config?: ApiConfig) => 
    request<T>(path, { ...config, method: 'GET' }),
  
  post: <T>(path: string, body?: unknown, config?: ApiConfig) => 
    request<T>(path, { ...config, method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  
  put: <T>(path: string, body?: unknown, config?: ApiConfig) => 
    request<T>(path, { ...config, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  
  delete: <T>(path: string, config?: ApiConfig) => 
    request<T>(path, { ...config, method: 'DELETE' }),
};
