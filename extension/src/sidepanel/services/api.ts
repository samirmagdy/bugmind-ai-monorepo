
export interface ApiRequestOptions extends RequestInit {
  onUnauthorized?: () => void;
  onDebug?: (tag: string, msg: string) => void;
  token?: string | null;
}

export const apiRequest = async (
  url: string, 
  options: ApiRequestOptions = {}
): Promise<Response> => {
  const { onUnauthorized, onDebug, token, ...fetchOptions } = options;
  
  const headers: Record<string, string> = {};
  
  // Safely merge existing headers
  if (fetchOptions.headers) {
    const originalHeaders = fetchOptions.headers as Record<string, string>;
    Object.entries(originalHeaders).forEach(([key, value]) => {
      headers[key] = value;
    });
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (fetchOptions.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  } else if (!fetchOptions.body) {
    delete headers['Content-Type'];
  }
  
  try {
    const res = await fetch(url, { ...fetchOptions, headers });
    
    if (res.status === 401) {
      if (onDebug) onDebug('AUTH-EXPIRED', 'Global session expired (401)');
      if (onUnauthorized) onUnauthorized();
      throw new Error('Unauthorized');
    }
    
    return res;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg !== 'Unauthorized') {
      if (onDebug) onDebug('API-ERROR', `Request to ${url} failed: ${errMsg}`);
    }
    throw err;
  }
};
