import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

// Config publique Firebase (non secrète) — paramétrée par variables d'env Vite.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Auth active uniquement si Firebase est configuré (prod). Sinon (dev local sans
// config), l'appli tourne ouverte — cohérent avec le backend en AUTH_DISABLED=1.
export const authEnabled = Boolean(config.apiKey && config.projectId);

let auth = null;
const provider = new GoogleAuthProvider();

if (authEnabled) {
  auth = getAuth(initializeApp(config));
}

// S'abonne aux changements d'état de connexion. Renvoie la fonction de désinscription.
export function onAuthChange(cb) {
  if (!authEnabled) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

export function login() {
  return signInWithPopup(auth, provider);
}

export function logout() {
  return signOut(auth);
}

// ID token courant (null si auth désactivée ou utilisateur non connecté).
export async function getIdToken() {
  if (!authEnabled || !auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}
