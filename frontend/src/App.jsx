import { useState } from 'react';
import SearchPanel from './components/SearchPanel.jsx';
import CourseList from './components/CourseList.jsx';
import HolesTable from './components/HolesTable.jsx';
import { fetchHoles, fetchCgolfHoles } from './services/api.js';
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

  function handleSelectCourse(course) {
    setSelectedCourse(course);
    setHolesData(null);
    setHolesError(null);
    setHolesLoading(true);
    setCgolfData(null);
    setCgolfError(null);
    setCgolfLoading(true);

    fetchHoles(course.lat, course.lng)
      .then(data => setHolesData(data))
      .catch(err => setHolesError(err.message))
      .finally(() => setHolesLoading(false));

    fetchCgolfHoles(course.osmId)
      .then(data => setCgolfData(data))
      .catch(err => setCgolfError(err.message))
      .finally(() => setCgolfLoading(false));
  }

  const courses = searchResults?.courses ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>OSM Golf Explorer</h1>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <SearchPanel
            onResults={setSearchResults}
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
            />
          )}
        </aside>

        <section className="content">
          <HolesTable
            course={selectedCourse}
            holesData={holesData}
            holesLoading={holesLoading}
            holesError={holesError}
            cgolfData={cgolfData}
            cgolfLoading={cgolfLoading}
            cgolfError={cgolfError}
          />
        </section>
      </main>
    </div>
  );
}
