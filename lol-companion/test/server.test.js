// node --test test/
const test = require('node:test'), assert = require('node:assert');
const { lockAction, isDone } = require('../server/champselect');
const RUNES = require('../server/runes');

// Cliente LCU simulado: la confirmación de Riot tarda `delay` ms en reflejarse en la sesión.
function fakeLcu({ delay = 0, completeWorks = true, patchWorks = true, hoverFails = false } = {}) {
  const act = { id: 7, actorCellId: 2, type: 'ban', championId: 0, completed: false, isInProgress: true };
  const calls = []; let doneAt = null;
  const req = async (method, url, body) => {
    calls.push(`${method} ${url}`);
    if (url === '/lol-champ-select/v1/session') {
      if (doneAt && Date.now() >= doneAt) { act.completed = true; act.isInProgress = false; }
      return { localPlayerCellId: 2, actions: [[act]], bans: { myTeamBans: [], theirTeamBans: [] } };
    }
    if (method === 'PATCH' && url.endsWith('/7') && body?.completed) { if (!patchWorks) throw Object.assign(new Error('x'), { status: 500 }); act.championId = body.championId; doneAt = Date.now() + delay; return; }
    if (method === 'PATCH' && url.endsWith('/7')) { if (hoverFails) throw Object.assign(new Error('x'), { status: 400, body: { message: 'champion not available' } }); act.championId = body.championId; return; }
    if (method === 'POST' && url.endsWith('/7/complete')) { if (!completeWorks) throw Object.assign(new Error('x'), { status: 500 }); doneAt = Date.now() + delay; return; }
    throw new Error('ruta inesperada ' + method + url);
  };
  return { req, calls, act };
}

test('lock: confirma aunque Riot tarde 1,2 s (antes daba falso error a los 400 ms)', async () => {
  const f = fakeLcu({ delay: 1200 });
  await lockAction(f.req, 'ban', 64, {});
  assert.equal(f.act.completed, true);
  assert.equal(f.act.championId, 64);
  assert.equal(f.calls.filter((c) => c.includes('/complete')).length, 1, 'no repite la confirmación si ya funcionó');
});
test('lock: si /complete falla usa PATCH completed:true', async () => {
  const f = fakeLcu({ delay: 100, completeWorks: false });
  await lockAction(f.req, 'ban', 64, {});
  assert.equal(f.act.completed, true);
});
test('lock: error real incluye el motivo del cliente', async () => {
  const f = fakeLcu({ completeWorks: false, patchWorks: false });
  await assert.rejects(lockAction(f.req, 'ban', 64, { wait: 300 }), /no confirmó.*500/);
});
test('lock: campeón rechazado → mensaje claro', async () => {
  const f = fakeLcu({ hoverFails: true });
  await assert.rejects(lockAction(f.req, 'ban', 64), /no aceptó ese campeón.*champion not available/);
});
test('lock: sin turno → error', async () => {
  const f = fakeLcu(); f.act.isInProgress = false;
  await assert.rejects(lockAction(f.req, 'ban', 64), /Todavía no es tu turno/);
});
test('isDone: ban visible en la lista y turno cerrado', () => {
  const cs = { actions: [[{ id: 1, completed: false, isInProgress: false }]], bans: { myTeamBans: [64], theirTeamBans: [] } };
  assert.equal(isDone(cs, 1, 'ban', 64), true);
  assert.equal(isDone(cs, 1, 'ban', 99), false);
});

// ---- runas ----
const page9 = (n = 0) => [8021, 9111, 9104, 8014, 8139, 8135, 5008, 5008, 5001].map((x) => x + n);
test('runas: recomendadas prueba otras rutas, normaliza, quita duplicados y rellena fragmentos', async () => {
  const urls = [];
  const req = async (m, u) => {
    urls.push(u);
    if (u.includes('/position/bottom/')) throw Object.assign(new Error('x'), { status: 404 });
    if (u.includes('/position/none/map/11')) return [
      { name: 'Crítico', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: page9() },
      { name: 'Copia', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: page9() },
      { name: 'Sin fragmentos', primaryStyleId: 8100, subStyleId: 8000, selectedPerkIds: page9(1).slice(0, 6) },
      { name: 'Rota', primaryStyleId: 8100 }];
    return [];
  };
  const r = await RUNES.recommended(req, { championId: 81, position: 'BOTTOM', mapId: 11 });
  assert.equal(r.length, 2);
  assert.equal(r[1].selectedPerkIds.length, 9);
  assert.ok(urls[0].includes('/champion/81/position/bottom/map/11'));
});
test('runas: aplicar escribe en la página activa editable y la deja activa', async () => {
  const log = [];
  const req = async (m, u, b) => { log.push([m, u, b]); if (u === '/lol-perks/v1/pages') return [{ id: 1, isEditable: false, current: true }, { id: 5, isEditable: true }, { id: 6, isEditable: true, current: false }]; };
  const id = await RUNES.applyPage(req, { name: 'X', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: page9() });
  assert.equal(id, 5);
  assert.deepEqual(log.at(-1).slice(0, 3), ['PUT', '/lol-perks/v1/currentpage', 5]);
});
test('runas: si PUT falla borra y crea la página', async () => {
  const log = [];
  const req = async (m, u, b) => { log.push(m + ' ' + u); if (u === '/lol-perks/v1/pages' && m === 'GET') return [{ id: 5, isEditable: true, current: true }]; if (m === 'PUT' && u.endsWith('/5')) throw new Error('x'); if (m === 'POST') return { id: 9 }; };
  assert.equal(await RUNES.applyPage(req, { name: 'X', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: page9() }), 9);
  assert.ok(log.includes('DELETE /lol-perks/v1/pages/5'));
});
test('runas: sin páginas editables crea una', async () => {
  const req = async (m, u) => (m === 'GET' ? [] : m === 'POST' ? { id: 3 } : undefined);
  assert.equal(await RUNES.applyPage(req, { name: 'X', primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: page9() }), 3);
});
test('runas: rellenar usa tantas páginas como tengas (máx. las recomendadas)', async () => {
  const writes = [];
  const req = async (m, u, b) => { if (m === 'GET') return [{ id: 1, isEditable: true }, { id: 2, isEditable: true, current: true }, { id: 3, isEditable: true }]; if (m === 'PUT' && /pages\/\d/.test(u)) writes.push(u); };
  const rec = [1, 2].map((i) => ({ name: 'R' + i, primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: page9(i) }));
  assert.equal(await RUNES.fillPages(req, rec), 2);
  assert.deepEqual(writes, ['/lol-perks/v1/pages/2', '/lol-perks/v1/pages/1']);
});
test('runas: página incompleta se rechaza', () => assert.throws(() => RUNES.check({ primaryStyleId: 8000, subStyleId: 8100, selectedPerkIds: [1, 2, 3] }), /incompleta/));

test('runas: acepta nombres de campo alternativos y deduce los árboles', async () => {
  const req = async (m, u) => (u.includes('/position/bottom/map/11') ? [
    { name: 'A', primaryPerkStyleId: 8000, secondaryPerkStyleId: 8100, perkIds: page9() },
    { name: 'B', perkIds: [8010, 9111, 9104, 8014, 8139, 8135] }] : []);
  const r = await RUNES.recommended(req, { championId: 145, position: 'bottom', mapId: 11 });
  assert.equal(r.length, 2);
  assert.equal(r[1].primaryStyleId, 8000);
  assert.equal(r[1].subStyleId, 8100);
});
