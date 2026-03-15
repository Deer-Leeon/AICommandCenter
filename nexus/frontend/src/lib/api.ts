import { supabase } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://nexus-api.lj-buchmiller.com';

async function getValidSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  // Token may have expired — attempt a silent refresh before giving up
  const { data } = await supabase.auth.refreshSession();
  return data.session;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const session = await getValidSession();

  const makeRequest = (token: string | undefined) =>
    fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string> | undefined),
      },
    });

  const res = await makeRequest(session?.access_token);

  // If 401, force a token refresh and retry exactly once — handles the case
  // where the token expired between getSession() and the actual request.
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      return makeRequest(data.session.access_token);
    }
  }

  return res;
}

/**
 * apiFetchMultipart — like apiFetch but for FormData (multipart/form-data).
 * Does NOT set Content-Type so the browser can inject the correct boundary.
 */
export async function apiFetchMultipart(
  path: string,
  body: FormData,
  method = 'POST',
): Promise<Response> {
  const session = await getValidSession();

  const makeRequest = (token: string | undefined) =>
    fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });

  const res = await makeRequest(session?.access_token);

  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) return makeRequest(data.session.access_token);
  }

  return res;
}
