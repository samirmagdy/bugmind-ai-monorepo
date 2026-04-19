
export interface ApiRequestOptions extends RequestInit {
  onUnauthorized?: () => void | string | null | Promise<void | string | null>;
  onDebug?: (tag: string, msg: string) => void;
  token?: string | null;
}

export const readJsonResponse = async <T>(res: Response): Promise<T> => {
  const bodyText = await res.text();

  if (!bodyText) {
    return {} as T;
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(bodyText);
  }
};

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
  
  const execute = async (requestHeaders: Record<string, string>) => {
    return fetch(url, { ...fetchOptions, headers: requestHeaders });
  };

  try {
    let res = await execute(headers);
    
    if (res.status === 401) {
      if (onDebug) onDebug('AUTH-EXPIRED', 'Global session expired (401)');
      const refreshedToken = onUnauthorized ? await onUnauthorized() : null;
      if (refreshedToken) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${refreshedToken}` };
        res = await execute(retryHeaders);
      }
      if (res.status === 401) {
        throw new Error('Unauthorized');
      }
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
