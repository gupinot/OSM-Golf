import { NavLink, Link, Outlet } from 'react-router-dom';
import { authEnabled, logout } from '../services/firebase.js';

// Coquille commune à toutes les pages : en-tête (marque + navigation + utilisateur)
// puis le contenu de la route via <Outlet/>. Chaque page gère son propre conteneur
// (l'OSM Proxy est un split pleine hauteur sans scroll ; l'accueil est défilant).
export default function Layout({ user }) {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <Link to="/" className="app-title">OSM Golf Explorer</Link>
          <nav className="app-nav">
            <NavLink to="/" end>Accueil</NavLink>
            <NavLink to="/search">Recherche</NavLink>
            <NavLink to="/osmproxy">OSM Proxy</NavLink>
          </nav>
        </div>
        {authEnabled && user && (
          <div className="app-user">
            <span className="app-user-email">{user.email}</span>
            <button className="app-logout" onClick={logout}>Déconnexion</button>
          </div>
        )}
      </header>
      <Outlet />
    </div>
  );
}
