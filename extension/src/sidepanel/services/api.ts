
export interface ApiRequestOptions extends RequestInit {
  onUnauthorized?: () => void | string | null | Promise<void | string | null>;
  onDebug?: (tag: string, msg: string) => void;
  token?: string | null;
  timeoutMs?: number;
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
  const { onUnauthorized, onDebug, token, timeoutMs, ...fetchOptions } = options;
  
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
    const controller = new AbortController();
    const upstreamSignal = fetchOptions.signal;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;
    let abortListener: (() => void) | undefined;

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort();
      } else {
        abortListener = () => controller.abort();
        upstreamSignal.addEventListener('abort', abortListener, { once: true });
      }
    }

    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, timeoutMs);
    }

    try {
      return await fetch(url, { ...fetchOptions, headers: requestHeaders, signal: controller.signal });
    } catch (err: unknown) {
      if (didTimeout) {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (upstreamSignal && abortListener) {
        upstreamSignal.removeEventListener('abort', abortListener);
      }
    }
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
