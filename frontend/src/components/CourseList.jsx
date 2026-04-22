export default function CourseList({ courses, selected, onSelect }) {
  if (!courses.length) return <p className="empty">Aucun parcours trouvé.</p>;

  return (
    <ul className="course-list">
      {courses.map(course => (
        <li
          key={course.osmId}
          className={`course-item${selected?.osmId === course.osmId ? ' selected' : ''}`}
          onClick={() => onSelect(course)}
        >
          <span className="course-name">{course.name}</span>
          <span className="course-meta">
            {course.city && <span>{course.city}</span>}
            {course.holes && <span>{course.holes} trous</span>}
            {course.distanceKm != null && <span>{course.distanceKm} km</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
