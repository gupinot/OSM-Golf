export default function CourseList({ courses, selected, onSelect, statsMap, statsLoading }) {
  if (!courses.length) return <p className="empty">Aucun parcours trouvé.</p>;

  // Cellules de stats d'une ligne : '…' tant que le comptage tourne, '–' si pas de données.
  function statCells(course) {
    const s = statsMap?.[course.osmId];
    if (!s) {
      const placeholder = statsLoading && !statsMap ? '…' : '–';
      return Array.from({ length: 8 }, (_, i) => (
        <td key={i} className="stat-cell">{placeholder}</td>
      ));
    }
    const ref = (g, k) => <td className="stat-cell">{g[k] || 0}</td>;
    return (
      <>
        {ref(s.holes, 'withRef')}{ref(s.holes, 'withoutRef')}
        {ref(s.tees, 'withRef')}{ref(s.tees, 'withoutRef')}
        {ref(s.greens, 'withRef')}{ref(s.greens, 'withoutRef')}
        <td className="stat-cell">{s.fairways || 0}</td>
        <td className="stat-cell">{s.bunkers || 0}</td>
      </>
    );
  }

  return (
    <div className="course-table-wrap">
      <table className="course-table">
        <thead>
          <tr>
            <th rowSpan={2} className="col-golf">Golf</th>
            <th colSpan={2}>Trous</th>
            <th colSpan={2}>Tees</th>
            <th colSpan={2}>Greens</th>
            <th rowSpan={2}>Fairw.</th>
            <th rowSpan={2}>Bunk.</th>
          </tr>
          <tr>
            <th className="sub">réf</th><th className="sub">sans</th>
            <th className="sub">réf</th><th className="sub">sans</th>
            <th className="sub">réf</th><th className="sub">sans</th>
          </tr>
        </thead>
        <tbody>
          {courses.map(course => (
            <tr
              key={course.osmId}
              className={`course-row${selected?.osmId === course.osmId ? ' selected' : ''}`}
              onClick={() => onSelect(course)}
            >
              <td className="col-golf">
                <span className="course-name">{course.name}</span>
                <span className="course-meta">
                  {course.city && <span>{course.city}</span>}
                  {course.distanceKm != null && <span>{course.distanceKm} km</span>}
                </span>
              </td>
              {statCells(course)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
