import { getIdToken } from './firebase.js';

// fetch enrichi : attache l'ID token Firebase (Bearer) quand l'auth est active.
// En dev local (auth désactivée), se comporte comme un fetch normal.
export async function apiFetch(url, options = {}) {
  const token = await getIdToken();
  if (!token) return fetch(url, options);
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
}
