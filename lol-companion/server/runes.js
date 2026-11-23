// Runas: recomendadas por el juego, aplicar en una página y rellenar tus páginas.
const errText = (e) => `${e.status || ''} ${e.body?.message || e.message || ''}`.trim();
const POS = { top: 'top', jungle: 'jungle', middle: 'middle', mid: 'middle', bottom: 'bottom', adc: 'bottom', utility: 'utility', support: 'utility' };
const DEFAULT_SHARDS = [5008, 5008, 5001]; // por si una recomendación llega sin fragmentos

// El cliente nombra los campos distinto según la versión (primaryStyleId / primaryPerkStyleId, selectedPerkIds / perkIds…).
// Se aceptan todas las variantes y, si falta algún árbol, se deduce de los ids de las runas (8000 Precisión, 8100 Dominación, 8200 Brujería, 8300 Inspiración, 8400 Valor).
const styleOf = (id) => (id >= 8000 && id < 8500 ? Math.floor(id / 100) * 100 : 0);
function normalize(p, i) {
  if (!p || typeof p !== 'object') return null;
  let ids = p.selectedPerkIds || p.perkIds || p.perks || p.runeIds || [];
  if (!Array.isArray(ids)) return null;
  ids = ids.map((x) => Number(x?.id ?? x)).filter(Boolean);
  if (ids.length < 6) return null;
  const primary = +(p.primaryStyleId || p.primaryPerkStyleId || p.primaryStyle || p.primaryPerkStyle || styleOf(ids[0]));
  const sub = +(p.subStyleId || p.secondaryPerkStyleId || p.secondaryStyleId || p.subPerkStyleId || p.secondaryStyle || styleOf(ids[4]));
  if (!primary || !sub) return null;
  const perks = ids.length >= 9 ? ids.slice(0, 9) : [...ids.slice(0, 6), ...DEFAULT_SHARDS];
  // Texto largo que muestra el cliente bajo cada página (p. ej. "Daño a un solo objetivo y DPS"), si el cliente lo envía.
  const desc = [p.description, p.summary, p.label, p.tagline, p.subtitle, p.title].find((x) => typeof x === 'string' && /\s/.test(x.trim()));
  const sp = (p.summonerSpellIds || p.spellIds || p.spells || []).map(Number).filter(Boolean);
  return { name: String(p.name || p.title || `Recomendada ${i + 1}`).slice(0, 25), desc: desc ? String(desc).slice(0, 60) : '', spells: sp.length === 2 ? sp : [],
    primaryStyleId: primary, subStyleId: sub, selectedPerkIds: perks };
}

// Si la ruta conocida no devuelve nada, se buscan en el propio cliente (swagger) las rutas "recommended" de lol-perks y se prueban.
let swaggerPaths = null;
async function discover(req, log) {
  if (swaggerPaths) return swaggerPaths;
  try {
    const sw = await req('GET', '/swagger/v2/swagger.json');
    swaggerPaths = Object.entries(sw?.paths || {}).filter(([u, d]) => /perks/i.test(u) && /recommend/i.test(u) && d.get).map(([u]) => u);
  } catch (e) { swaggerPaths = []; log(`[runas] no pude leer el swagger del cliente → ${errText(e)}`); }
  log('[runas] rutas "recommended" que ofrece tu cliente: ' + (swaggerPaths.join(' | ') || '(ninguna)'));
  return swaggerPaths;
}
const fillUrl = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (/champ/i.test(k) ? v.cid : /pos/i.test(k) ? v.pos : /map/i.test(k) ? v.map : /queue/i.test(k) ? v.queue : '0'));
function collect(list) {
  const out = [], seen = new Set();
  const arr = Array.isArray(list) ? list : Array.isArray(list?.pages) ? list.pages : Array.isArray(list?.recommendedPages) ? list.recommendedPages : [];
  for (const [i, p] of arr.entries()) {
    const n = normalize(p, i), key = n && n.selectedPerkIds.join();
    if (n && !seen.has(key)) { seen.add(key); out.push(n); }
  }
  return out;
}

// Páginas que el propio juego recomienda para un campeón y línea (las del cliente).
// El nombre exacto de la ruta/posición cambia entre versiones, así que se prueban varias.
async function recommended(req, { championId, position, mapId }, log = () => {}) {
  const cid = +championId, map = +mapId || 11;
  const pos = POS[String(position || '').toLowerCase()] || '';
  const tries = [pos, 'none'].filter(Boolean);
  const maps = [...new Set([map, 11, 12])];
  for (const m of maps) for (const ps of tries) {
    const url = `/lol-perks/v1/recommended-pages/champion/${cid}/position/${ps}/map/${m}`;
    try {
      const raw = await req('GET', url), out = collect(raw);
      if (out.length) { log(`[runas] ${out.length} páginas. Campos del cliente: ${Object.keys((Array.isArray(raw) ? raw : raw?.pages || [])[0] || {}).join(', ')}`); return out; }
      log(`[runas] ${url} → sin páginas válidas. Respuesta cruda: ${JSON.stringify(raw)?.slice(0, 300)}`);
    } catch (e) { log(`[runas] ${url} → ${errText(e)}`); }
  }
  // Plan B: otras rutas "recommended" que tenga tu versión del cliente
  const v = { cid, pos: pos || 'none', map, queue: 420 };
  for (const tpl of await discover(req, log)) {
    if (tpl.includes('/recommended-pages/champion/{')) continue; // ya probada arriba
    const url = fillUrl(tpl, v);
    try {
      const out = collect(await req('GET', url));
      if (out.length) { log(`[runas] OK con ${url}`); return out; }
      log(`[runas] ${url} → vacío`);
    } catch (e) { log(`[runas] ${url} → ${errText(e)}`); }
  }
  return [];
}

function check(page) {
  const ids = page?.selectedPerkIds;
  if (!page || !Array.isArray(ids) || ids.length !== 9 || ids.some((x) => !Number.isInteger(x) || x <= 0) || !page.primaryStyleId || !page.subStyleId)
    throw new Error('La página de runas está incompleta');
  return { name: String(page.name || 'Mi página').slice(0, 25), primaryStyleId: +page.primaryStyleId, subStyleId: +page.subStyleId, selectedPerkIds: ids };
}

// Escribe `page` en una página editable tuya y la deja activa.
async function applyPage(req, rawPage, targetId) {
  const page = check(rawPage);
  const pages = (await req('GET', '/lol-perks/v1/pages').catch(() => [])) || [];
  const editable = pages.filter((p) => p.isEditable);
  const target = editable.find((p) => p.id === targetId) || editable.find((p) => p.current) || editable[0];
  let id;
  if (target) {
    try { await req('PUT', `/lol-perks/v1/pages/${target.id}`, { ...page, current: true }); id = target.id; }
    catch { // plan B: borrar y volver a crear
      await req('DELETE', `/lol-perks/v1/pages/${target.id}`);
      id = (await req('POST', '/lol-perks/v1/pages', { ...page, current: true }))?.id;
    }
  } else id = (await req('POST', '/lol-perks/v1/pages', { ...page, current: true }))?.id;
  if (id != null) await req('PUT', '/lol-perks/v1/currentpage', id).catch(() => {});
  return id;
}

// Rellena tus páginas editables (la activa primero) con las recomendadas. Devuelve cuántas escribió.
async function fillPages(req, list) {
  const pages = ((await req('GET', '/lol-perks/v1/pages').catch(() => [])) || []).filter((p) => p.isEditable);
  pages.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));
  const n = Math.max(1, Math.min(list.length, pages.length));
  let done = 0, firstId;
  for (let i = 0; i < n; i++) {
    const id = await applyPage(req, list[i], pages[i]?.id);
    if (i === 0) firstId = id;
    done++;
  }
  if (firstId != null) await req('PUT', '/lol-perks/v1/currentpage', firstId).catch(() => {});
  return done;
}

module.exports = { recommended, applyPage, fillPages, check, normalize };
