// Helpers purs de comparaison OSM ↔ scorecard, partagés entre l'OSM Proxy (HolesTable)
// et la page détail parcours (CoursePage).

export const ALL_COLORS = ['black', 'white', 'yellow', 'blue', 'red'];

export function compareField(osmVal, cgolfVal) {
  const hasOsm = osmVal != null && osmVal !== '';
  const hasCgolf = cgolfVal != null && cgolfVal !== '';
  if (!hasOsm && hasCgolf) return 'missing-in-osm';
  if (hasOsm && !hasCgolf) return 'missing-in-cgolf';
  if (hasOsm && hasCgolf && String(osmVal) !== String(cgolfVal)) return 'mismatch';
  return 'ok';
}

export function buildComparison(osmHoles, cgolfHoles) {
  if (!osmHoles?.length || !cgolfHoles?.length) return {};
  const cgolfMap = Object.fromEntries(cgolfHoles.map(h => [String(h.hole), h]));
  const result = {};
  for (const osmHole of osmHoles) {
    if (!osmHole.refTarget) continue;
    const ref = String(osmHole.refTarget);
    const cg = cgolfMap[ref];
    if (!cg) continue;
    result[ref] = {
      par: compareField(osmHole.par, cg.par),
      handicap: compareField(osmHole.handicap, cg.handicap),
      distances: Object.fromEntries(ALL_COLORS.map(c => [c, compareField(osmHole.distances?.[c], cg.distances?.[c])])),
    };
  }
  return result;
}

export function cellClass(status, side) {
  if (status === 'mismatch') return 'cell-mismatch';
  if (side === 'osm' && status === 'missing-in-osm') return 'cell-missing';
  if (side === 'cgolf' && status === 'missing-in-cgolf') return 'cell-missing';
  return '';
}

export function findCgolfForCourse(cgolfData, courseKey) {
  if (!cgolfData?.matches) return null;
  if (cgolfData.matches.length === 1) return cgolfData.matches[0];
  const key = courseKey.toLowerCase();
  const slug = key.replace(/\s+/g, '-');
  return cgolfData.matches.find(m =>
    m.cgolfName.toLowerCase().includes(key) ||
    m.cgolfUrl.toLowerCase().includes(slug)
  ) ?? null;
}

export function swapHalves(holes) {
  if (!holes?.length) return holes;
  return holes
    .map(h => {
      const n = Number(h.hole);
      return { ...h, hole: n <= 9 ? n + 9 : n - 9 };
    })
    .sort((a, b) => Number(a.hole) - Number(b.hole));
}
