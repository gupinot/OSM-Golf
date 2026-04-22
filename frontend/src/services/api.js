export async function searchByName(query) {
  const res = await fetch(`/api/search/name?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function searchByZone({ lat, lng, city, radius }) {
  const params = new URLSearchParams({ radius });
  if (city) params.set('city', city);
  else { params.set('lat', lat); params.set('lng', lng); }
  const res = await fetch(`/api/search/zone?${params}`);
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
