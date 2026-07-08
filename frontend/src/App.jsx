import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import OsmProxyPage from './pages/OsmProxyPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import CoursePage from './pages/CoursePage.jsx';
import { authEnabled, onAuthChange, login } from './services/firebase.js';
import './App.css';

function LoginScreen() {
  const [error, setError] = useState(null);
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>OSM Golf Explorer</h1>
        <p>Connecte-toi pour accéder à l'application.</p>
        <button
          className="login-google"
          onClick={() => login().catch(err => setError(err.message))}
        >
          Se connecter avec Google
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

// Gate d'accès : en prod (Firebase configuré) l'appli n'est rendue qu'après connexion.
// En dev local (auth désactivée), rendue directement. Le routeur (BrowserRouter) est
// monté au-dessus dans main.jsx ; ici on définit les routes sous le layout commun.
export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!authEnabled);

  useEffect(() => {
    if (!authEnabled) return;
    return onAuthChange(u => { setUser(u); setAuthReady(true); });
  }, []);

  if (!authReady) return <div className="login-screen"><p className="loading">Chargement…</p></div>;
  if (authEnabled && !user) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<Layout user={user} />}>
        <Route index element={<HomePage />} />
        <Route path="osmproxy" element={<OsmProxyPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="course/:id" element={<CoursePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
