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

const TEE_COLORS = ['black', 'white', 'yellow', 'blue', 'red'];

function analyzeTeeGreenQuality(holes, rawTees, rawGreens) {
  const teeMap = {};
  for (const tee of rawTees) {
    if (!tee.ref) continue;
    const key = `${tee.course}|${tee.ref}`;
    if (!teeMap[key]) teeMap[key] = {};
    for (const color of tee.color.split(';').map(c => c.trim()).filter(Boolean)) {
      if (TEE_COLORS.includes(color)) teeMap[key][color] = true;
    }
  }

  const taggedGreenKeys = new Set(
    rawGreens.filter(g => g.ref).map(g => `${g.course}|${g.ref}`)
  );

  const greenMap = {};
  for (const hole of holes) {
    const key = `${hole.course}|${hole.ref}`;
    if (!hole.ref) { greenMap[key] = 'missing'; continue; }
    if (taggedGreenKeys.has(key)) { greenMap[key] = 'tagged'; continue; }
    const inside = hole.lastPoint && rawGreens.some(g => pointInPolygon(hole.lastPoint, g.geometry));
    greenMap[key] = inside ? 'untagged' : 'missing';
  }

  return { tees: teeMap, greens: greenMap };
}

function pointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  const { lat, lon } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

module.exports = { analyzeHolesQuality, analyzeTeeGreenQuality };
