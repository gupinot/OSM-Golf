import { useState } from 'react';
import SearchPanel from './components/SearchPanel.jsx';
import CourseList from './components/CourseList.jsx';
import HolesTable from './components/HolesTable.jsx';
import { fetchHoles, fetchCgolfHoles, fetchZoneStats, searchByName, searchByZone } from './services/api.js';
import './App.css';

export default function App() {
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [holesData, setHolesData] = useState(null);
  const [holesLoading, setHolesLoading] = useState(false);
  const [holesError, setHolesError] = useState(null);
  const [cgolfData, setCgolfData] = useState(null);
  const [cgolfLoading, setCgolfLoading] = useState(false);
  const [cgolfError, setCgolfError] = useState(null);
  const [statsMap, setStatsMap] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(660);

  // Stats au fil de l'eau (zone uniquement). fresh=true contourne le cache disque.
  function loadStats(results, fresh = false) {
    setStatsMap(null);
    setStatsLoading(false);
    if (results?.mode === 'zone' && results.lat != null) {
      setStatsLoading(true);
      fetchZoneStats(results.lat, results.lng, results.radius, { fresh })
        .then(setStatsMap)
        .catch(() => setStatsMap({}))
        .finally(() => setStatsLoading(false));
    }
  }

  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = ev => setSidebarWidth(Math.min(Math.max(startW + ev.clientX - startX, 320), 1100));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  function handleResults(results) {
    setSearchResults(results);
    loadStats(results);
  }

  // Rejoue la dernière recherche en contournant le cache disque Overpass (fresh=1),
  // puis recharge les stats fraîches (mode zone).
  async function handleRefreshSearch() {
    if (!searchResults || refreshing) return;
    const previous = searchResults;
    setError(null);
    setRefreshing(true);
    // Vide la liste affichée avant de la régénérer.
    setSearchResults(null);
    setStatsMap(null);
    setStatsLoading(false);
    setLoading(true);
    try {
      if (previous.mode === 'name') {
        const courses = await searchByName(previous.query, { fresh: true });
        setSearchResults({ ...previous, courses });
      } else {
        const { lat, lng, radius } = previous;
        const data = await searchByZone({ lat, lng, radius, fresh: true });
        const results = { mode: 'zone', ...data };
        setSearchResults(results);
        loadStats(results, true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSelectCourse(course) {
    setSelectedCourse(course);
    setHolesData(null);
    setHolesError(null);
    setHolesLoading(true);
    setCgolfData(null);
    setCgolfError(null);
    setCgolfLoading(true);

    fetchHoles(course.osmId, course.lat, course.lng)
      .then(data => setHolesData(data))
      .catch(err => setHolesError(err.message))
      .finally(() => setHolesLoading(false));

    fetchCgolfHoles(course.osmId, course.name, course.lat, course.lng)
      .then(data => setCgolfData(data))
      .catch(err => setCgolfError(err.message))
      .finally(() => setCgolfLoading(false));
  }

  function handleRefreshHoles() {
    if (!selectedCourse) return;
    setHolesError(null);
    setHolesLoading(true);
    fetchHoles(selectedCourse.osmId, selectedCourse.lat, selectedCourse.lng)
      .then(data => setHolesData(data))
      .catch(err => setHolesError(err.message))
      .finally(() => setHolesLoading(false));
  }

  const courses = searchResults?.courses ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>OSM Golf Explorer</h1>
      </header>

      <main className="app-main">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <SearchPanel
            onResults={handleResults}
            onLoading={setLoading}
            onError={setError}
          />

          {error && <p className="error">{error}</p>}
          {loading && <p className="loading">Recherche en cours…</p>}

          {!loading && searchResults && (
            <CourseList
              courses={courses}
              selected={selectedCourse}
              onSelect={handleSelectCourse}
              statsMap={statsMap}
              statsLoading={statsLoading}
              onRefresh={handleRefreshSearch}
              refreshing={refreshing}
            />
          )}
        </aside>

        <div
          className="sidebar-resizer"
          onMouseDown={startResize}
          title="Glisser pour redimensionner"
        />

        <section className="content">
          <HolesTable
            key={selectedCourse?.osmId}
            course={selectedCourse}
            holesData={holesData}
            holesLoading={holesLoading}
            holesError={holesError}
            cgolfData={cgolfData}
            cgolfLoading={cgolfLoading}
            cgolfError={cgolfError}
            onRefreshHoles={handleRefreshHoles}
          />
        </section>
      </main>
    </div>
  );
}
