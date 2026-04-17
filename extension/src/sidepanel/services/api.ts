
export interface ApiRequestOptions extends RequestInit {
  onUnauthorized?: () => void;
  onDebug?: (tag: string, msg: string) => void;
  token?: string | null;
}

export const apiRequest = async (
  url: string, 
  options: ApiRequestOptions = {}
) => {
  const { onUnauthorized, onDebug, token, ...fetchOptions } = options;
  
  const headers: Record<string, string> = {
    ...fetchOptions.headers as any,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (fetchOptions.body && (!fetchOptions.headers || !(fetchOptions.headers as any)['Content-Type'])) {
    headers['Content-Type'] = 'application/json';
  } else if (!fetchOptions.body) {
    // Prevent stale Content-Type headers on GET/DELETE requests
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
  } catch (err: any) {
    if (err.message !== 'Unauthorized') {
      if (onDebug) onDebug('API-ERROR', `Request to ${url} failed: ${err.message}`);
    }
    throw err;
  }
};
