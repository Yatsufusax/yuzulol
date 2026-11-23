// App de escritorio: puente entre el cliente de LoL (LCU) y el móvil.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const crypto = require('crypto'), readline = require('readline'), qr = require('qrcode-terminal');
const LCU = require('./lcu');
const CS = require('./champselect'), RUNES = require('./runes');

const PORT = +process.env.PORT || 8080;
const PUB = path.join(__dirname, '..', 'public');
// Carpeta de datos: la fija Electron (AppData\YuzuLOL, siempre la misma aunque muevas el .exe); si no, junto al proyecto / .exe
const BASE = process.env.YUZU_DATA || (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));
try { fs.mkdirSync(BASE, { recursive: true }); } catch {}
const DEV_FILE = path.join(BASE, 'devices.json');
let devices = {};
try { devices = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8')); } catch {}
const saveDevices = () => fs.writeFileSync(DEV_FILE, JSON.stringify(devices, null, 1));

const lcu = new LCU();
// Sin consola (ventana propia / Electron) no hay teclado: se usa un lector vacío
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : { on() {}, question: (q, cb) => cb('s') };
const state = { connected: false, phase: 'None', lobby: null, search: null, readyCheck: null, champSelect: null,
  summoner: null, ranked: null, history: [], pickable: [], bannable: [], perks: [], game: null, ranks: {}, live: null };
const clients = new Set();
const broadcast = (p) => { const m = `data: ${JSON.stringify(p)}\n\n`; for (const r of clients) r.write(m); };
const stamps = {};
const set = (k, v) => { state[k] = v; stamps[k] = Date.now(); broadcast({ [k]: v }); };
// Estado para un móvil que (re)conecta: los contadores se corrigen con el tiempo que pasó desde la última actualización.
function snapshot() {
  const s = { ...state }, now = Date.now(), age = (k) => (now - (stamps[k] || now)) / 1000;
  if (s.search) s.search = { ...s.search, timeInQueue: (s.search.timeInQueue || 0) + age('search') };
  if (s.champSelect?.timer) s.champSelect = { ...s.champSelect, timer: { ...s.champSelect.timer, adjustedTimeLeftInPhase: Math.max(0, (s.champSelect.timer.adjustedTimeLeftInPhase || 0) - age('champSelect') * 1000) } };
  if (s.live) s.live = { ...s.live, time: s.live.time + age('live') };
  if (s.phase === 'ReadyCheck') s.readyElapsed = age('phase');
  return s;
}
const mergeSearch = (d) => set('search', d ? { ...(state.search || {}), ...d } : null);
const get = (u) => lcu.request('GET', u).catch(() => null);

// ---------- Datos del cliente ----------
async function refreshProfile() {
  const [me, rk, hist] = await Promise.all([
    get('/lol-summoner/v1/current-summoner'),
    get('/lol-ranked/v1/current-ranked-stats'),
    get('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=10'),
  ]);
  set('summoner', me && { id: me.summonerId, puuid: me.puuid, name: me.gameName || me.displayName, level: me.summonerLevel, icon: me.profileIconId });
  set('ranked', rk?.queueMap?.RANKED_SOLO_5x5 || null);
  set('history', (hist?.games?.games || []).map((g) => {
    const p = g.participants[0], s = p.stats;
    return { id: g.gameId, champ: p.championId, win: s.win, k: s.kills, d: s.deaths, a: s.assists,
      dur: g.gameDuration, items: [0, 1, 2, 3, 4, 5].map((i) => s['item' + i] || 0), cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0), queue: g.queueId };
  }));
}
const refreshPerks = async () => set('perks', (await get('/lol-perks/v1/pages')) || []);
let pickTimer;
function refreshPick() {
  clearTimeout(pickTimer);
  pickTimer = setTimeout(async () => {
    if (!state.champSelect) return;
    set('pickable', (await get('/lol-champ-select/v1/pickable-champion-ids')) || []);
    set('bannable', (await get('/lol-champ-select/v1/bannable-champion-ids')) || []);
  }, 250);
}
async function loadAll() {
  const ph = (await get('/lol-gameflow/v1/gameflow-phase')) || 'None';
  set('phase', ph); onPhase(ph);
  set('lobby', await get('/lol-lobby/v2/lobby'));
  mergeSearch({ ...(await get('/lol-lobby/v2/lobby/matchmaking/search-state')), ...(await get('/lol-matchmaking/v1/search')) });
  set('readyCheck', await get('/lol-matchmaking/v1/ready-check'));
  set('champSelect', await get('/lol-champ-select/v1/session'));
  refreshPick(); refreshPerks(); refreshProfile();
}
lcu.on('connected', () => { console.log('Cliente de LoL conectado'); set('connected', true); loadAll(); });
lcu.on('disconnected', () => { console.log('Cliente de LoL desconectado'); set('connected', false); });
lcu.on('event', (ev) => {
  const u = ev.uri, d = ev.eventType === 'Delete' ? null : ev.data;
  if (u === '/lol-gameflow/v1/gameflow-phase') {
    set('phase', d || 'None'); onPhase(d || 'None');
    if (['None', 'Lobby', 'EndOfGame'].includes(d || 'None')) setTimeout(refreshProfile, 1500);
  } else if (u === '/lol-lobby/v2/lobby') set('lobby', d);
  else if (u === '/lol-lobby/v2/lobby/matchmaking/search-state' || u === '/lol-matchmaking/v1/search') mergeSearch(d);
  else if (u === '/lol-matchmaking/v1/ready-check') set('readyCheck', d);
  else if (u === '/lol-champ-select/v1/session') { set('champSelect', d); refreshPick(); }
  else if (u.startsWith('/lol-perks/v1/pages') || u === '/lol-perks/v1/currentpage') refreshPerks();
});

// ---------- Partida: pantalla de carga y partida en vivo ----------
let liveTimer, lastGameTime = null, gameRunning = false;
async function fetchRanks(players) {
  const out = { ...state.ranks };
  await Promise.all(players.filter((p) => p.puuid && !out[p.puuid]).map(async (p) => {
    const r = await get('/lol-ranked/v1/ranked-stats/' + p.puuid);
    const q = r?.queueMap?.RANKED_SOLO_5x5;
    out[p.puuid] = q && q.tier ? { t: q.tier, d: q.division, lp: q.leaguePoints, w: q.wins, l: q.losses } : { t: '', d: '' };
  }));
  set('ranks', out);
}
let gameTimer;
const inGamePhase = () => ['GameStart', 'InProgress', 'Reconnect'].includes(state.phase);
// Datos de la pantalla de carga. Al empezar la fase el cliente a veces aún no tiene la lista completa: se reintenta.
async function refreshGame(tries = 0) {
  clearTimeout(gameTimer);
  const ses = await get('/lol-gameflow/v1/session');
  const gd = ses?.gameData;
  const sel = gd?.playerChampionSelections || [];
  const norm = (p) => {
    const s = sel.find((x) => x.summonerInternalName === p.summonerInternalName) || {};
    return { puuid: p.puuid, name: p.gameName || p.summonerName, champ: p.championId || s.championId || 0,
      s1: p.spell1Id || s.spell1Id || 0, s2: p.spell2Id || s.spell2Id || 0, skin: p.selectedSkinIndex || 0 };
  };
  const game = gd && { teamOne: (gd.teamOne || []).map(norm), teamTwo: (gd.teamTwo || []).map(norm), queueId: gd.queue?.id };
  const all = game ? [...game.teamOne, ...game.teamTwo] : [];
  const incomplete = !game || !all.length || all.some((p) => !p.champ);
  if (game && all.length) { set('game', game); fetchRanks(all); }
  if (incomplete && tries < 25 && inGamePhase()) gameTimer = setTimeout(() => refreshGame(tries + 1), 1500);
}
// Partida en vivo. Mientras carga la partida, el juego ya responde pero con gameTime = 0:
// eso NO cuenta como partida empezada (se sigue mostrando la pantalla de carga).
async function pollLive() {
  try {
    const d = await lcu.live('/liveclientdata/allgamedata');
    const t = d.gameData?.gameTime || 0;
    // La partida solo cuenta como empezada cuando el propio juego lo dice: evento "GameStart" (se emite al terminar la carga)
    // o, si no llega, cuando el reloj de la partida avanza de verdad entre dos consultas. Un gameTime > 0 suelto no basta (puede darse aún cargando).
    const evStart = (d.events?.Events || []).some((e) => e.EventName === 'GameStart');
    const advancing = lastGameTime != null && t - lastGameTime >= 0.5;
    lastGameTime = t;
    if (evStart || advancing) gameRunning = true;
    if (!gameRunning || !(t > 0) || !(d.allPlayers || []).length) { if (state.live) set('live', null); return; }
    const byName = new Map();
    for (const p of [...(state.game?.teamOne || []), ...(state.game?.teamTwo || [])]) byName.set(p.name, p);
    const players = (d.allPlayers || []).map((p) => {
      const nm = p.riotIdGameName || p.summonerName, g = byName.get(nm) || byName.get(p.summonerName) || {};
      return { name: nm, puuid: g.puuid, champId: g.champ || 0, raw: (p.rawChampionName || '').replace('game_character_displayname_', ''),
        team: p.team, k: p.scores?.kills || 0, d: p.scores?.deaths || 0, a: p.scores?.assists || 0, cs: p.scores?.creepScore || 0,
        lvl: p.level, items: (p.items || []).map((i) => i.itemID), dead: !!p.isDead, respawn: Math.ceil(p.respawnTimer || 0) };
    });
    set('live', { time: d.gameData?.gameTime || 0, players });
  } catch { if (state.live) set('live', null); }
}
function onPhase(ph) {
  clearInterval(liveTimer); if (!inGamePhase()) clearTimeout(gameTimer);
  if (!inGamePhase()) { gameRunning = false; lastGameTime = null; }   // nueva partida: vuelve a esperar el inicio real
  if (['GameStart', 'InProgress', 'Reconnect'].includes(ph)) refreshGame();
  if (ph === 'InProgress' || ph === 'Reconnect') { pollLive(); liveTimer = setInterval(pollLive, 1500); }
  else if (state.live) set('live', null);
  if (['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect'].includes(ph) && state.game) { set('game', null); set('ranks', {}); }
}

// ---------- Acciones que manda el móvil ----------
function currentAction(type) {
  const cs = state.champSelect;
  if (!cs) return null;
  const mine = (cs.actions || []).flat().filter((a) => a.actorCellId === cs.localPlayerCellId && a.type === type && !a.completed);
  return mine.find((a) => a.isInProgress) || null;
}
const needAction = (type) => { const a = currentAction(type); if (!a) throw new Error('Todavía no es tu turno'); return a; };
const A = {
  async queue({ queueId }) {
    await lcu.request('DELETE', '/lol-lobby/v2/lobby').catch(() => {});
    await lcu.request('POST', '/lol-lobby/v2/lobby', { queueId }); // solo crea el lobby; la búsqueda se inicia con "search"
  },
  positions: ({ first, second }) =>
    lcu.request('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: first, secondPreference: second }),
  intent: ({ championId }) => CS.setIntent((m, u, b) => lcu.request(m, u, b), state.champSelect, championId), // prepick
  // Cambios de posición / orden / campeón con otros jugadores. Los nombres de las rutas varían según la versión del cliente: se prueban varias.
  async swap({ kind, id, op }) {
    const bases = { trade: ['trades', 'champion-swaps'], pick: ['pick-order-swaps', 'swaps'], position: ['position-swaps', 'positionswaps', 'role-swaps'] }[kind] || [];
    const verbs = { request: ['request'], accept: ['accept'], decline: ['decline', 'reject'], cancel: ['cancel', 'clear'] }[op] || [];
    let last;
    for (const b of bases) for (const v of verbs) {
      try { return await lcu.request('POST', `/lol-champ-select/v1/session/${b}/${id}/${v}`); } catch (e) { last = e; if (e.status && e.status !== 404) break; }
    }
    // Plan B: leer del propio cliente cómo se llama la ruta en tu versión
    try {
      const sw = await lcu.request('GET', '/swagger/v2/swagger.json');
      const word = { trade: /trade|champion-swap/i, pick: /pick-?order/i, position: /position|role/i }[kind];
      const hits = Object.entries(sw?.paths || {}).filter(([u, d]) => d.post && u.startsWith('/lol-champ-select/') && /\{\w+\}/.test(u) && word.test(u) && verbs.some((v) => u.endsWith('/' + v)));
      console.log(`[swap] ${kind}: rutas del cliente → ${hits.map((h) => h[0]).join(' | ') || '(ninguna)'}`);
      for (const [u] of hits) { try { return await lcu.request('POST', u.replace(/\{\w+\}/, id)); } catch (e) { last = e; } }
    } catch {}
    console.log(`[swap] ${kind}/${op} falló → ${last?.status || ''} ${last?.body?.message || last?.message || ''}`);
    throw new Error('El cliente no aceptó el cambio' + (last?.status ? ` (${last.status})` : ''));
  },
  async skins({ championId }) {
    const id = state.summoner?.id;
    if (!id) throw new Error('Perfil no cargado');
    const list = await lcu.request('GET', `/lol-champions/v1/inventories/${id}/champions/${championId}/skins`);
    return list.filter((s) => s.ownership?.owned && !s.disabled).map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.id - b.id);
  },
  async friends() {
    const list = (await lcu.request('GET', '/lol-chat/v1/friends')) || [];
    return list.filter((f) => f.availability && f.availability !== 'offline')
      .map((f) => ({ id: f.summonerId, name: f.gameName || f.name, status: f.availability, icon: f.icon }))
      .slice(0, 60);
  },
  invite: ({ summonerId }) => lcu.request('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: summonerId }]),
  async match({ gameId }) {
    const g = await lcu.request('GET', `/lol-match-history/v1/games/${gameId}`);
    const ids = g.participantIdentities || [];
    const players = (g.participants || []).map((p) => {
      const pl = ids.find((i) => i.participantId === p.participantId)?.player || {}, s = p.stats || {};
      return { team: p.teamId, win: !!s.win, champ: p.championId, name: pl.gameName || pl.summonerName || '', puuid: pl.puuid, lvl: s.champLevel,
        k: s.kills, d: s.deaths, a: s.assists, cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0), gold: s.goldEarned,
        dmg: s.totalDamageDealtToChampions, vision: s.visionScore, items: [0, 1, 2, 3, 4, 5, 6].map((i) => s['item' + i] || 0) };
    });
    return { id: g.gameId, queue: g.queueId, dur: g.gameDuration, at: g.gameCreation, players };
  },
  setSkin: ({ skinId }) => lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', { selectedSkinId: skinId }),
  search: () => lcu.request('POST', '/lol-lobby/v2/lobby/matchmaking/search'),
  cancel: () => lcu.request('DELETE', '/lol-lobby/v2/lobby/matchmaking/search'),
  leave: () => lcu.request('DELETE', '/lol-lobby/v2/lobby'),
  accept: () => lcu.request('POST', '/lol-matchmaking/v1/ready-check/accept'),
  decline: () => lcu.request('POST', '/lol-matchmaking/v1/ready-check/decline'),
  async hover({ type, championId }) {
    await lcu.request('PATCH', `/lol-champ-select/v1/session/actions/${needAction(type).id}`, { championId });
  },
  lock: ({ type, championId }) => CS.lockAction((m, u, b) => lcu.request(m, u, b), type, championId, { log: console.log }),
  setPage: ({ id }) => lcu.request('PUT', '/lol-perks/v1/currentpage', id),
  // Runas recomendadas por el juego para el campeón (y línea) elegidos
  recRunes({ championId, position }) {
    const mapId = state.lobby?.gameConfig?.mapId || (state.champSelect?.benchEnabled ? 12 : 11);
    return RUNES.recommended((m, u, b) => lcu.request(m, u, b), { championId, position, mapId }, console.log);
  },
  async applyRunes({ page, targetId }) { const id = await RUNES.applyPage((m, u, b) => lcu.request(m, u, b), page, targetId); await refreshPerks(); return id; },
  async fillRunes({ pages }) { const n = await RUNES.fillPages((m, u, b) => lcu.request(m, u, b), pages.map(RUNES.check)); await refreshPerks(); return n; },
  spells: ({ spell1Id, spell2Id }) => lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id, spell2Id }),
};

// ---------- Emparejamiento (QR / código) ----------
let pairing = null, attempts = 0;
function localIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}
function newPairing(print = true) {
  pairing = { token: crypto.randomBytes(16).toString('hex'), code: String(crypto.randomInt(100000, 999999)), exp: Date.now() + 300000 };
  attempts = 0;
  const url = `http://${localIp()}:${PORT}/?pair=${pairing.token}`;
  if (print) {
    qr.generate(url, { small: true });
    console.log(`\nEscanea el QR con la app (vale 5 minutos)\nO abre ${url.split('?')[0]} y escribe el código: ${pairing.code}\n(Escribe "qr" + Enter para generar otro)\n`);
  }
  return url;
}
rl.on('line', (l) => { if (l.trim() === 'qr') newPairing(); });
const approve = (name) => new Promise((ok) => rl.question(`\n¿Permitir el dispositivo "${name}"? (s/n) `, (a) => ok(/^s/i.test(a))));

// ---------- Panel de escritorio (solo desde este PC) ----------
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const devId = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 10);
function panelState() {
  const valid = pairing && Date.now() < pairing.exp;
  if (!valid && !Object.keys(devices).length) newPairing(false);   // primera vez: el QR ya está listo
  const live = pairing && Date.now() < pairing.exp ? pairing : null;
  const online = new Set([...clients].map((r) => r.tok).filter(Boolean));
  return {
    lol: !!state.connected, phase: state.phase, summoner: state.summoner,
    ip: localIp(), port: PORT,
    pairing: live && { id: live.token.slice(0, 8), code: live.code, expiresIn: Math.max(0, Math.round((live.exp - Date.now()) / 1000)), url: `http://${localIp()}:${PORT}/?pair=${live.token}` },
    devices: Object.entries(devices).map(([t, d]) => ({ id: devId(t), name: d.name, at: d.at, online: online.has(t) })).sort((x, y) => y.at - x.at),
  };
}
function qrSvg(text) {
  const QRCode = require('qrcode-terminal/vendor/QRCode'), EC = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  const q = new QRCode(-1, EC.M); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0A1428"/></svg>`;
}
function openPanel() {
  if (process.env.NO_OPEN) return;
  const u = `http://localhost:${PORT}/panel`;
  const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
  require('child_process').exec(cmd, () => {});
}

// Splash arts: se bajan una vez de Data Dragon y se guardan en disco (después cargan al instante y sin internet)
const ART_DIR = path.join(BASE, 'cache', 'art');
function serveArt(res, name) {
  if (!/^[A-Za-z]{2,24}$/.test(name)) { res.writeHead(400); return res.end(); }
  const f = path.join(ART_DIR, name + '.jpg');
  const send = () => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }); fs.createReadStream(f).pipe(res); };
  if (fs.existsSync(f)) return send();
  require('https').get(`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${name}_0.jpg`, (r) => {
    if (r.statusCode !== 200) { r.resume(); res.writeHead(404); return res.end(); }
    fs.mkdirSync(ART_DIR, { recursive: true });
    const tmp = f + '.part', w = fs.createWriteStream(tmp);
    r.pipe(w);
    w.on('finish', () => { fs.renameSync(tmp, f); send(); });
    w.on('error', () => { res.writeHead(500); res.end(); });
  }).on('error', () => { res.writeHead(502); res.end(); });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const tok = (req.headers.authorization || '').replace('Bearer ', '') || url.searchParams.get('t');
  const dev = devices[tok];
  try {
    if (url.pathname === '/panel' || url.pathname.startsWith('/panel/')) {
      if (!isLocal(req)) { res.writeHead(403); return res.end('El panel solo se abre desde este PC'); }
      if (url.pathname === '/panel') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return fs.createReadStream(path.join(PUB, 'panel.html')).pipe(res); }
      if (url.pathname === '/panel/api/state') return json(res, 200, panelState());
      if (url.pathname === '/panel/api/pair/new' && req.method === 'POST') { newPairing(false); return json(res, 200, panelState()); }
      if (url.pathname === '/panel/api/pair/cancel' && req.method === 'POST') { pairing = null; return json(res, 200, panelState()); }
      if (url.pathname === '/panel/api/device/remove' && req.method === 'POST') {
        const { id } = await body(req); const t = Object.keys(devices).find((k) => devId(k) === id);
        if (t) { delete devices[t]; saveDevices(); for (const r of clients) if (r.tok === t) r.end(); }
        return json(res, 200, panelState());
      }
      if (url.pathname.startsWith('/panel/art/')) return serveArt(res, decodeURIComponent(url.pathname.slice(11)));
      if (url.pathname === '/panel/qr.svg') {
        if (!pairing || Date.now() > pairing.exp) { res.writeHead(404); return res.end(); }
        try { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return res.end(qrSvg(`http://${localIp()}:${PORT}/?pair=${pairing.token}`)); }
        catch (e) { console.log('No pude dibujar el QR del panel:', e.message); res.writeHead(500); return res.end(); }
      }
      res.writeHead(404); return res.end();
    }
    if (url.pathname === '/api/pair' && req.method === 'POST') {
      const b = await body(req);
      if (!pairing || Date.now() > pairing.exp || attempts++ > 5) return json(res, 403, { error: 'Código vencido. Escribe "qr" en la consola.' });
      if (b.token !== pairing.token && b.code !== pairing.code) return json(res, 403, { error: 'Código incorrecto' });
      const viaQr = b.token === pairing.token;   // el QR solo lo ve quien está delante del PC: no hace falta preguntar
      pairing = null;
      const name = String(b.name || 'Móvil').slice(0, 40);
      if (!viaQr && !(await approve(name))) return json(res, 403, { error: 'Rechazado en el PC' });
      if (viaQr) console.log(`Dispositivo \"${name}\" vinculado por QR.`);
      const t = crypto.randomBytes(24).toString('hex');
      devices[t] = { name, at: Date.now() }; saveDevices();
      return json(res, 200, { token: t });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!dev) return json(res, 401, { error: 'No autorizado' });
      if (url.pathname === '/api/ping') return json(res, 200, { ok: true });
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
        res.tok = tok; clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/action' && req.method === 'POST') {
        const { name, args } = await body(req);
        if (!A[name]) return json(res, 400, { error: 'Acción desconocida' });
        try { const data = await A[name](args || {}); return json(res, 200, { ok: true, data }); }
        catch (e) { return json(res, 400, { error: e.body?.message || e.message }); }
      }
      return json(res, 404, { error: 'No existe' });
    }
    const file = path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.on('error', (e) => {
  const msg = e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso. ¿Tienes YuzuLOL abierto dos veces?` : e.message;
  console.error(msg);
  if (process.versions.electron) require('electron').dialog.showErrorBox('YuzuLOL', msg);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  YuzuLOL en marcha\n  Panel: http://localhost:${PORT}/panel  (se abre solo; si no, ábrelo en el navegador)\n  Deja esta ventana abierta mientras juegas; puedes minimizarla.\n`);
  process.emit('yuzu-ready', PORT);
  setInterval(() => { for (const r of clients) r.write(': ping\n\n'); }, 20000);
  if (!Object.keys(devices).length) newPairing(false);
  openPanel();
  lcu.start();
});
