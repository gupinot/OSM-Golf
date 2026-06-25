export async function searchByName(query, { fresh = false } = {}) {
  const params = new URLSearchParams({ q: query });
  if (fresh) params.set('fresh', '1');
  const res = await fetch(`/api/search/name?${params}`);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function searchByZone({ lat, lng, city, radius, fresh = false }) {
  const params = new URLSearchParams({ radius });
  if (city) params.set('city', city);
  else { params.set('lat', lat); params.set('lng', lng); }
  if (fresh) params.set('fresh', '1');
  const res = await fetch(`/api/search/zone?${params}`);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function fetchZoneStats(lat, lng, radius, { fresh = false } = {}) {
  const params = new URLSearchParams({ lat, lng, radius });
  if (fresh) params.set('fresh', '1');
  const res = await fetch(`/api/search/zone-stats?${params}`);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function fetchHoles(osmId, lat, lng, radius = 5) {
  const params = new URLSearchParams({ osmId, lat, lng, radius });
  const res = await fetch(`/api/holes?${params}`);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function fetchCgolfHoles(osmId, name, lat, lng) {
  const params = new URLSearchParams({ osmId, name, lat, lng });
  const res = await fetch(`/api/cgolf-holes?${params}`);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function analyzeCustomScorecard(payload) {
  const res = await fetch('/api/cgolf-holes/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function fetchPersistedCustomSources(osmId) {
  const params = new URLSearchParams({ osmId });
  const res = await fetch(`/api/cgolf-holes/custom-sources?${params}`);
  if (!res.ok) return {};
  return res.json();
}

export async function removePersistedCustomSource(osmId, courseKey) {
  const params = new URLSearchParams({ osmId, courseKey });
  await fetch(`/api/cgolf-holes/custom-source?${params}`, { method: 'DELETE' });
}
