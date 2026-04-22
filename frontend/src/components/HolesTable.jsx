const ALL_COLORS = ['black', 'white', 'yellow', 'blue', 'red'];

function findCgolfForCourse(cgolfData, courseKey) {
  if (!cgolfData?.matches) return null;
  if (cgolfData.matches.length === 1) return cgolfData.matches[0];
  const key = courseKey.toLowerCase();
  const slug = key.replace(/\s+/g, '-');
  return (
    cgolfData.matches.find(m =>
      m.cgolfName.toLowerCase().includes(key) ||
      m.cgolfUrl.toLowerCase().includes(slug)
    ) || cgolfData.matches[0]
  );
}

export default function HolesTable({
  course,
  holesData, holesLoading, holesError,
  cgolfData, cgolfLoading, cgolfError,
}) {
  if (!course) return null;

  return (
    <div className="holes-section">
      <div className="holes-header">
        <h2>{course.name}</h2>
        {holesData && <QualityBadge quality={holesData.quality} />}
      </div>

      {holesLoading && !holesData && <p className="loading">Chargement OSM…</p>}
      {holesError && <p className="error">{holesError}</p>}

      {holesData && (() => {
        const { holes, quality } = holesData;
        const courseEntries = Object.entries(quality.courses);
        return (
          <>
            {courseEntries.map(([courseKey, courseData]) => (
              <div key={courseKey} className="course-group">
                {courseKey && <h3 className="course-key">{courseKey}</h3>}
                <div className="panels-layout">
                  <div className="panel panel-osm">
                    <div className="panel-title">OSM</div>
                    <OsmCourseTable holes={courseData.holes} issues={courseData} />
                  </div>
                  <div className="panel panel-cgolf">
                    {(() => {
                      const match = findCgolfForCourse(cgolfData, courseKey);
                      return (
                        <>
                          <div className="panel-title">
                            cgolf.fr
                            {match?.cgolfName && (
                              <span className="panel-subtitle">{match.cgolfName}</span>
                            )}
                          </div>
                          <CgolfPanel match={match} cgolfLoading={cgolfLoading} cgolfError={cgolfError} cgolfFound={cgolfData?.found} />
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ))}
            {!holes.length && (
              <p className="empty">Aucun trou (golf=hole) trouvé dans un rayon de 5 km.</p>
            )}
          </>
        );
      })()}
    </div>
  );
}

function QualityBadge({ quality }) {
  const issues = [];
  if (quality.missingRefCount > 0) issues.push(`${quality.missingRefCount} sans ref`);
  if (quality.unresolvedDuplicates > 0) issues.push(`${quality.unresolvedDuplicates} doublons`);

  if (quality.valid) {
    return <span className="badge badge-ok">✓ {quality.totalHoles} trous</span>;
  }
  return (
    <span className="badge badge-warn">
      ⚠ {quality.totalHoles} trous — {issues.join(', ')}
    </span>
  );
}

function OsmCourseTable({ holes, issues }) {
  if (!holes.length) return null;
  const dupRefs = new Set(issues.duplicateRefs || []);

  return (
    <div className="table-wrapper">
      <table className="holes-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Par</th>
            <th>Hcp</th>
            {ALL_COLORS.map(c => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {holes.map(h => (
            <tr
              key={h.osmWayId}
              className={!h.ref ? 'row-warn' : dupRefs.has(h.ref) ? 'row-dup' : ''}
            >
              <td>{h.ref || <span className="missing">—</span>}</td>
              <td>{h.par || <span className="missing">—</span>}</td>
              <td>{h.handicap || <span className="missing">—</span>}</td>
              {ALL_COLORS.map(c => (
                <td key={c}>{h.distances[c] ?? <span className="missing">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CgolfPanel({ match, cgolfLoading, cgolfError, cgolfFound }) {
  if (cgolfLoading) return <p className="loading">Analyse scorecard…</p>;
  if (cgolfError) return <p className="error">{cgolfError}</p>;
  if (cgolfFound === false) return <p className="empty">Aucune correspondance cgolf.fr</p>;
  if (!match) return null;

  return (
    <div className="table-wrapper">
      <table className="holes-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Par</th>
            <th>Hcp</th>
            {ALL_COLORS.map(c => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {match.holes.map(h => (
            <tr key={h.hole}>
              <td>{h.hole}</td>
              <td>{h.par ?? <span className="missing">—</span>}</td>
              <td>{h.handicap ?? <span className="missing">—</span>}</td>
              {ALL_COLORS.map(c => (
                <td key={c}>{h.distances?.[c] ?? <span className="missing">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
