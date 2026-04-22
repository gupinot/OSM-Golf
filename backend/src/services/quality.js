function analyzeHolesQuality(holes) {
  if (!holes.length) {
    return { valid: false, totalHoles: 0, missingRefCount: 0, unresolvedDuplicates: 0, courses: {} };
  }

  const groups = {};
  for (const h of holes) {
    const key = h.course || '';
    (groups[key] = groups[key] || []).push(h);
  }

  let totalMissing = 0;
  let totalDupes = 0;
  const courses = {};

  for (const [key, grp] of Object.entries(groups)) {
    const missing = grp.filter(h => !h.ref).length;
    const refCounts = {};
    for (const h of grp) {
      if (h.ref) refCounts[h.ref] = (refCounts[h.ref] || 0) + 1;
    }
    const dupes = Object.entries(refCounts).filter(([, c]) => c > 1).map(([r]) => r);

    totalMissing += missing;
    totalDupes += dupes.length;

    courses[key] = {
      holes: [...grp].sort(holeSort),
      missingRefCount: missing,
      duplicateRefs: dupes,
    };
  }

  return {
    valid: totalMissing === 0 && totalDupes === 0,
    totalHoles: holes.length,
    missingRefCount: totalMissing,
    unresolvedDuplicates: totalDupes,
    courses,
  };
}

function holeSort(a, b) {
  const na = parseInt(a.ref);
  const nb = parseInt(b.ref);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  if (!isNaN(na)) return -1;
  if (!isNaN(nb)) return 1;
  return (a.ref || '').localeCompare(b.ref || '');
}

module.exports = { analyzeHolesQuality };
