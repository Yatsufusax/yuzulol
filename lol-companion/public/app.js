// Cliente móvil. Recibe el estado del PC por SSE y manda acciones por POST.
const $ = (s) => document.querySelector(s);
const S = { connected: false, phase: 'None', perks: [], pickable: [], bannable: [], history: [] };
const ui = { sheet: null, friends: null, skins: [], skinFor: 0, skin: null, screen: 'home', mode: 'rift', role: 'all', q: '', pickSel: 0, banSel: 0, view: 'grid', mode2: null, err: '' };
const dd = { spells: [], spellByKey: {}, ver: null, byKey: {}, perkIcon: {}, styleIcon: {}, styles: [] };
let token = localStorage.getItem('token');

// Colas por modo. Los IDs de cola cambian con las temporadas: ajústalos aquí.
// Pon tus imágenes en public/img/ (rift.jpg, aram.jpg, alt.jpg) para el fondo de cada tarjeta.
const MODES = {
  rift: { name: 'Grieta del Invocador', desc: 'Clásico 5v5', img: 'rift.svg', map: 'map_sr.png',
    list: [[480, 'Swiftplay', 'Partida rápida'], [400, 'Normal', 'Selección de reclutamiento'], [420, 'Clasificatoria Solo/Dúo', 'Ranked'], [440, 'Clasificatoria Flexible', 'Ranked']] },
  aram: { name: 'ARAM', desc: 'Todos al medio', img: 'aram.svg', map: 'map_ha.png', list: [[450, 'ARAM', 'Campeones aleatorios']] },
  alt: { name: 'Modos alternativos', desc: 'Rotativos', img: 'alt.svg', map: 'map_rgm.png', list: [[1700, 'Arena', '2v2v2v2']] },
};
// Los iconos de mapa del cliente son una imagen con 2 estados apilados (arriba activo, abajo apagado): se recorta la mitad de arriba.
const mapIcon = (file, cls) => `<i class="mic ${cls}"><img src="${CD}${file}" onerror="this.parentNode.style.display='none'" alt=""></i>`;
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-parties/global/default/'; // iconos y mapas reales del cliente
const POS = [['TOP', 'Top'], ['JUNGLE', 'Jungla'], ['MIDDLE', 'Mid'], ['BOTTOM', 'ADC'], ['UTILITY', 'Soporte'], ['FILL', 'Auto']];
const TAGS = [['all', 'Todos'], ['Fighter', 'Luchador'], ['Tank', 'Tanque'], ['Mage', 'Mago'], ['Assassin', 'Asesino'], ['Marksman', 'Tirador'], ['Support', 'Soporte']];

// ---------- Utilidades ----------
const CDN = 'https://ddragon.leagueoflegends.com/cdn/';
const champ = (id) => dd.byKey[id];
const cico = (id) => (champ(id) ? `<img src="${CDN}${dd.ver}/img/champion/${champ(id).id}.png" alt="">` : '<i></i>');
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(m, ok) { const t = $('#toast'); t.textContent = m; t.className = ok ? 'ok' : ''; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 6000); }
async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { localStorage.removeItem('token'); token = null; render(); }
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const actRaw = (name, args) => api('/api/action', { method: 'POST', body: JSON.stringify({ name, args }) });
const act = (name, args) => api('/api/action', { method: 'POST', body: JSON.stringify({ name, args }) }).then((r) => r.data).catch((e) => { toast(e.message); });

async function loadDD() {
  try {
    dd.ver = (await (await fetch(CDN.replace('cdn/', 'api/versions.json'))).json())[0];
    const ch = (await (await fetch(`${CDN}${dd.ver}/data/es_ES/champion.json`)).json()).data;
    for (const c of Object.values(ch)) dd.byKey[+c.key] = c;
    const sp = (await (await fetch(`${CDN}${dd.ver}/data/es_ES/summoner.json`)).json()).data;
    dd.spells = Object.values(sp);
    for (const x of dd.spells) dd.spellByKey[+x.key] = x;
    const runes = await (await fetch(`${CDN}${dd.ver}/data/es_ES/runesReforged.json`)).json();
    dd.styles = runes;
    for (const st of runes) {
      dd.styleIcon[st.id] = st.icon;
      for (const sl of st.slots) for (const r of sl.runes) dd.perkIcon[r.id] = r.icon;
    }
    render();
  } catch { toast('No pude cargar los iconos (Data Dragon)'); }
}
const rune = (path) => (path ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/${path}" alt="">` : '');

// ---------- Pantallas ----------
function pair() {
  return `<h1>Conectar con tu PC</h1><p class="mut">Escanea el QR de la consola con la cámara del móvil, o escribe aquí el código de 6 dígitos.</p>
  <input id="code" inputmode="numeric" maxlength="6" placeholder="123456"><button class="btn" data-act="pair">Conectar</button>
  <p class="mut center">${esc(ui.err)}</p>`;
}
function waiting() { return `<div class="center" style="margin-top:30vh"><h1>Abre el cliente de LoL</h1><p class="mut">Esperando conexión con el cliente en tu PC…</p></div>`; }

const lastQ = () => +localStorage.getItem('lastQ') || 480;
const ICO = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  runes: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.6 0 4.5 1.8 4.5 4.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
};
const svg = (k) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
// Barra inferior (solo en las pantallas del menú, no durante lobby, selección o partida)
function bnav(cur) {
  const it = [['home', 'Inicio'], ['runes', 'Runas'], ['friends', 'Amigos'], ['settings', 'Ajustes']];
  return `<nav class="bnav">${it.map(([k, n]) => `<button class="${k === cur ? 'on' : ''}" data-act="go" data-arg="${k}">${svg(k)}<span>${n}</span></button>`).join('')}</nav>`;
}
// Campeón más jugado de tu historial reciente → su splash art de cabecera
function topChamp() {
  const n = {}; for (const g of S.history || []) n[g.champ] = (n[g.champ] || 0) + 1;
  const id = Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0];
  return id && champ(+id) ? champ(+id).id : null;
}
function home() {
  const me = S.summoner, rk = S.ranked, hist = S.history || [];
  const tc = topChamp(), ranked = rk && rk.tier;
  const w = rk?.wins ?? 0, l = rk?.losses ?? 0, wr = w + l ? Math.round((100 * w) / (w + l)) : 0;
  const lp = Math.max(0, Math.min(100, rk?.leaguePoints ?? 0));
  const dots = hist.slice(0, 10).map((g) => `<i class="dot ${g.win ? 'w' : 'l'}"></i>`).join('');
  const rows = hist.map((g) => `<div class="hist ${g.win ? 'win' : ''} row" data-act="match" data-arg="${g.id}" style="cursor:pointer">${cico(g.champ).replace('<img', '<img class="ic"')}
    <div class="grow"><b class="${g.win ? 'w' : 'l'}" style="font-size:12px">${g.win ? 'VICTORIA' : 'DERROTA'}</b><div style="font-weight:600">${g.k} / ${g.d} / ${g.a}</div>
    <div class="mut">KDA ${((g.k + g.a) / Math.max(1, g.d)).toFixed(2)} · ${g.cs} CS</div></div><div style="text-align:right"><div class="mut">${fmt(g.dur)}</div><div class="pi" style="margin-top:4px">${(g.items || []).slice(0, 6).map((id) => (id ? `<img src="${CDN}${dd.ver}/img/item/${id}.png" alt="">` : '<i></i>')).join('')}</div></div></div>`).join('');
  const art = tc ? `,url(${CDN.replace('cdn/', 'cdn/img/champion/splash/')}${tc}_0.jpg)` : '';
  return `<div class="hm-hero" style="background-image:linear-gradient(180deg,rgba(10,20,40,.15) 0%,rgba(10,20,40,.55) 55%,var(--bg) 100%)${art}">
      <span class="hm-st"><i></i>Cliente conectado</span></div>
    <div class="hm-me row">${me && dd.ver ? `<img class="hm-av" src="${CDN}${dd.ver}/img/profileicon/${me.icon}.png" alt="">` : '<i class="hm-av"></i>'}
      <div class="grow"><div class="hm-name">${esc(me?.name || '…')}</div><div class="mut">Nivel ${me?.level ?? '–'}${ranked ? ' · ' + esc(rk.tier) + ' ' + esc(rk.division) : ''}</div></div></div>
    <div><button class="hm-play" data-act="play" aria-label="Jugar"><b>JUGAR</b><span>${esc(QNAME[lastQ()] || 'Partida')}</span></button>
      <button class="hm-chg" data-act="go" data-arg="modes">Cambiar modo ›</button></div>
    <div class="card">
      <div class="row"><span class="mut grow">Clasificatoria Solo/Dúo</span><b>${ranked ? lp + ' / 100 LP' : 'Sin rango'}</b></div>
      ${ranked ? `<div class="hm-bar"><i style="width:${lp}%"></i></div>` : ''}
      <div class="row" style="margin-top:12px">
        <svg width="56" height="56" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="21" fill="none" stroke="#1E2D4A" stroke-width="6"/><circle cx="26" cy="26" r="21" fill="none" stroke="#C8AA6E" stroke-width="6" stroke-dasharray="${(wr * 1.32).toFixed(1)} 132" transform="rotate(-90 26 26)"/><text x="26" y="30" text-anchor="middle" font-size="12" font-weight="600" fill="#F0E6D2">${wr}%</text></svg>
        <div><b>${wr}% de victorias</b><div class="mut"><span style="color:var(--teal)">${w} V</span> · <span style="color:var(--red)">${l} D</span></div></div></div>
      ${dots ? `<div class="mut" style="margin-top:12px">Últimas ${hist.slice(0, 10).length} partidas</div><div class="hm-dots">${dots}</div>` : ''}
    </div>
    <h2>HISTORIAL</h2>${rows || '<p class="mut">Sin partidas recientes.</p>'}
    ${bnav('home')}`;
}

function friendsView() {
  const L = ui.fl;
  return `<h1>Amigos conectados</h1><p class="mut">Toca «Invitar» para crear una sala (${esc(QNAME[lastQ()] || 'Partida')}) e invitarlo.</p>
  ${L === null || L === undefined ? '<p class="mut">Cargando…</p>' : L.length ? L.map((f) => `<div class="card row">${dd.ver && f.icon != null ? `<img class="avatar" style="width:40px;height:40px" src="${CDN}${dd.ver}/img/profileicon/${f.icon}.png" alt="">` : '<i class="avatar" style="width:40px;height:40px"></i>'}
    <div class="grow"><b>${esc(f.name)}</b><div class="mut">${esc({ chat: 'Disponible', away: 'Ausente', dnd: 'En partida', mobile: 'En el móvil' }[f.status] || f.status)}</div></div>
    <button class="tag" data-act="invfriend" data-arg="${f.id}">Invitar</button></div>`).join('') : '<p class="mut">No hay amigos conectados ahora.</p>'}
  ${bnav('friends')}`;
}
function settingsView() {
  return `<h1>Ajustes</h1>
  <div class="card"><h2>CONEXIÓN</h2><div class="row" style="margin-top:10px"><span class="mut grow">PC</span><b>${esc(location.host)}</b></div>
    <div class="row" style="margin-top:8px"><span class="mut grow">Cliente de LoL</span><b style="color:${S.connected ? 'var(--teal)' : 'var(--red)'}">${S.connected ? 'Conectado' : 'Desconectado'}</b></div></div>
  <div class="card"><h2>VINCULACIÓN</h2><p class="mut" style="margin:8px 0 12px">Si desvinculas este móvil, tendrás que escanear el QR del PC otra vez.</p>
    <button class="btn ghost" style="border-color:var(--red);color:var(--red)" data-act="askunpair">Desvincular este móvil</button></div>
  ${bnav('settings')}`;
}

function modes() {
  const m = MODES[ui.mode];
  return `<div class="row"><button class="tag" data-act="go" data-arg="home">←</button><h1>Elige tu modo</h1></div>
  <div class="modes">${Object.entries(MODES).map(([k, v]) => `<button class="mode ${k === ui.mode ? 'on' : ''}" data-act="mode" data-arg="${k}"
    style="--bg1:url(img/${v.img.replace('.svg', '.jpg')}?v=2);--bg2:url(img/${v.img})">${mapIcon(v.map, 'memb')}<i class="chk">${k === ui.mode ? '✓' : ''}</i><b>${v.name}</b><span>${v.desc}</span></button>`).join('')}</div>
  <h2>OPCIONES DE COLA</h2>${m.list.map(([id, n, d]) => `<button class="qrow" data-act="queue" data-arg="${id}"><span><b>${n}</b><span class="mut">${d}</span></span><span style="color:var(--gold)">›</span></button>`).join('')}`;
}

const QNAME = Object.fromEntries(Object.values(MODES).flatMap((m) => m.list.map(([id, n]) => [id, n])));
const posIcon = (k, on) => `<img src="${CD}icon-position-${k.toLowerCase()}${on ? '-hover' : ''}.png" onerror="this.onerror=null;this.src='img/pos/${k.toLowerCase()}.svg'" alt="">`;
function lobby() {
  const L = S.lobby || {}, ps = L.members || [], me = L.localMember || {}, searching = S.phase === 'Matchmaking';
  const qid = L.gameConfig?.queueId, ranked = qid === 420 || qid === 440, hasPos = !!L.gameConfig?.showPositionSelector;
  const rk = S.ranked && S.ranked.tier ? `${esc(S.ranked.tier)} ${esc(S.ranked.division)}` : '';
  const f1 = me.firstPositionPreference || 'FILL', f2 = me.secondPositionPreference || 'FILL';
  const roleBtn = (n, k) => `<button class="rb" data-act="rolesheet" data-arg="${n}" aria-label="Línea ${n}">${posIcon(k)}</button>`;
  const est = S.search?.estimatedQueueTime > 0 ? fmt(S.search.estimatedQueueTime) : 'calculando…';
  const emblem = mapIcon(`${qid === 450 ? 'map_ha' : 'map_sr'}.png`, 'qem');
  const banner = searching
    ? `<div class="sbanner"><div class="row"><span class="grow stitle">ENCONTRANDO PARTIDA</span><button class="x" data-act="cancel" aria-label="Cancelar búsqueda">×</button></div>
      <div class="row" style="gap:14px;margin-top:8px">${emblem}<div><div class="stime tm" data-base="0" data-dir="1" data-at="${ui.queueStart || rec}">0:00</div><div class="sest">Estimado: ${est}</div></div></div></div>`
    : `<div class="banner ${ranked ? 'green' : 'blue'}"><div class="row">${emblem}<span class="grow mut" style="letter-spacing:.08em;color:#C9D6EC">${esc((QNAME[qid] || L.gameConfig?.gameMode || 'Lobby').toUpperCase())}</span>
      <button class="x" data-act="leave" aria-label="Salir">×</button></div></div>`;
  // Party como en el cliente: tu tarjeta en el centro y 4 portales alrededor (toca un portal para invitar).
  const avatar = (p, cls) => (dd.ver && p.summonerIconId ? `<img class="${cls}" src="${CDN}${dd.ver}/img/profileicon/${p.summonerIconId}.png" alt="">` : `<i class="${cls}"></i>`);
  const crown = '<svg class="crown" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 18l-1-11 5 4 5-8 5 8 5-4-1 11z"/></svg>';
  // El lobby a veces no trae el nombre en el miembro: para ti se usa el de tu perfil.
  const isMe = (p) => p === mePl || (p.puuid && p.puuid === S.summoner?.puuid) || (p.summonerId && p.summonerId === S.summoner?.id);
  const pname = (p) => esc(p.gameName || p.summonerName || p.displayName || p.summonerInternalName || (isMe(p) ? S.summoner?.name : '') || 'Jugador');
  const mePl = ps.find((p) => p.summonerId === me.summonerId) || me;
  const slots = [null, null, mePl, null, null];
  ps.filter((p) => p !== mePl && p.summonerId !== me.summonerId).forEach((p, i) => { if ([1, 3, 0, 4][i] !== undefined) slots[[1, 3, 0, 4][i]] = p; });
  const RE = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/';
  const tier = S.ranked?.tier;
  const cell = (p, i) => {
    if (i === 2) {
      const emb = tier ? `<img class="remb" src="${RE}emblem-${esc(tier.toLowerCase())}.png" onerror="this.style.display='none'" alt="">` : '';
      const roles = hasPos ? `<div class="prr2">${roleBtn(1, f1)}${roleBtn(2, f2)}</div>` : '';
      return `<div class="pcard"><div class="pin">${avatar(p, 'pav big')}${emb}<div class="prank">${rk}</div><div class="pname">${p.isLeader ? crown : ''}${pname(p)}</div><div class="toks"><i></i><i></i><i></i></div>${roles}</div></div>`;
    }
    if (!p) return `<button class="portal" data-act="invsheet" aria-label="Invitar amigo" ${searching ? 'disabled' : ''}><i></i></button>`;
    const ro = hasPos ? `<div class="prr"><span class="rb ro">${posIcon(p.firstPositionPreference || 'FILL')}</span><span class="rb ro">${posIcon(p.secondPositionPreference || 'FILL')}</span></div>` : '';
    return `<div class="pm">${avatar(p, 'pav')}<div class="pname">${p.isLeader ? crown : ''}${pname(p)}</div>${ro}</div>`;
  };
  const partyHTML = `<div class="scene"><div class="pcol l">${cell(slots[0], 0)}${cell(slots[1], 1)}</div>${cell(slots[2], 2)}<div class="pcol r">${cell(slots[3], 3)}${cell(slots[4], 4)}</div></div>`;
  const bar = searching ? `<div class="bar fbar"><button class="xbtn" data-act="cancel" aria-label="Cancelar búsqueda">×</button><button class="fbtn" disabled><span>EN COLA</span></button></div>`
    : `<div class="bar fbar"><button class="fbtn go" data-act="search" ${me.allowedStartActivity === false ? 'disabled' : ''}><span>BUSCAR PARTIDA</span></button></div>`;
  return `<div class="row"><h1>Lobby</h1></div>${banner}${partyHTML}${bar}${sheet(f1, f2)}`;
}
function sheet(f1, f2) {
  const t = ui.sheet;
  if (!t) return '';
  if (t.t === 'role') {
    const cur = t.n === 1 ? f1 : f2;
    return `<div class="backdrop" data-act="closesheet"></div><div class="sheet"><h2>${t.n === 1 ? 'LÍNEA PRINCIPAL' : 'LÍNEA SECUNDARIA'}</h2>
    ${POS.map(([k, n]) => `<button class="rrow ${cur === k ? 'on' : ''}" data-act="setrole" data-arg="${t.n}:${k}">${posIcon(k)}<span class="grow">${n}</span>${cur === k ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>`;
  }
  if (t.t === 'spell') {
    const cs = S.champSelect || {}, mine = (cs.myTeam || []).find((x) => x.cellId === cs.localPlayerCellId) || {};
    const cur = t.n === 1 ? mine.spell1Id : mine.spell2Id, mode = cs.benchEnabled ? 'ARAM' : 'CLASSIC';
    return `<div class="backdrop" data-act="closesheet"></div><div class="sheet"><h2>HECHIZO DE INVOCADOR ${t.n}</h2><div class="sgrid">
    ${dd.spells.filter((x) => x.modes.includes(mode)).map((x) => `<button class="stile ${cur === +x.key ? 'on' : ''}" data-act="setspell" data-arg="${t.n}:${x.key}"><img src="${CDN}${dd.ver}/img/spell/${x.id}.png" alt=""><span>${esc(x.name)}</span></button>`).join('')}</div></div>`;
  }
  if (t.t === 'runes') return runesSheet();
  if (t.t === 'edit') return editSheet();
  const fr = ui.friends;
  return `<div class="backdrop" data-act="closesheet"></div><div class="sheet"><h2>INVITAR AMIGO</h2>
  ${fr === null ? '<p class="mut">Cargando…</p>' : fr.length ? fr.map((f) => `<div class="rrow"><span class="grow"><b>${esc(f.name)}</b><br><span class="mut">${f.status === 'chat' ? 'En línea' : esc(f.status)}</span></span>
    <button class="tag" data-act="invite" data-arg="${f.id}">Invitar</button></div>`).join('') : '<p class="mut">No hay amigos conectados.</p>'}</div>`;
}
function queueView() {
  return `<h1>Buscando partida</h1><div class="card row"><div class="grow mut">Estimado ${fmt(S.search?.estimatedQueueTime || 0)}</div><span class="big tm" data-base="0" data-dir="1" data-at="${ui.queueStart || rec}">0:00</span></div>
  <button class="btn ghost" data-act="cancel">Cancelar búsqueda</button>`;
}
const RC_TOTAL = 12; // segundos que dura el aviso de partida encontrada
function ready() {
  const rc = S.readyCheck || {}, done = rc.playerResponse === 'Accepted';
  const qid = S.lobby?.gameConfig?.queueId;
  const map = qid === 450 ? 'Abismo de los Lamentos' : 'Grieta del Invocador';
  const kind = [420, 440].includes(qid) ? 'Clasificatoria' : [400, 430, 480, 490].includes(qid) ? 'Normal' : (QNAME[qid] || '');
  const sub = [map, kind, qid === 1700 ? '2 vs. 2 vs. 2 vs. 2' : '5 vs. 5'].filter(Boolean).join(' · ');
  const el = Math.min(RC_TOTAL, (Date.now() - (ui.rcStart || Date.now())) / 1000);
  return `<div class="rcwrap"><div class="rcring"><svg viewBox="0 0 200 200" aria-hidden="true">
    <defs><linearGradient id="rcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2E7BFF"/><stop offset="1" stop-color="#6EE7FF"/></linearGradient></defs>
    <circle cx="100" cy="100" r="97" fill="none" stroke="#6B5A33" stroke-width="1.5"/>
    <circle cx="100" cy="100" r="88" fill="none" stroke="#0E2A44" stroke-width="7"/>
    <circle class="rcp" cx="100" cy="100" r="88" fill="none" stroke="url(#rcg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="553" style="animation-delay:-${el.toFixed(2)}s"/></svg>
    <div class="rcin">${mapIcon(`${qid === 450 ? 'map_ha' : 'map_sr'}.png`, 'rcem')}
    <h1>PARTIDA<br>ENCONTRADA</h1><p>${esc(sub)}</p></div></div>
  <button class="acc" data-act="accept" ${done ? 'disabled' : ''}>${done ? 'ACEPTADA · ESPERANDO…' : '¡ACEPTAR!'}</button>
  <button class="rej" data-act="decline">RECHAZAR</button></div>`;
}
function matchView() {
  const m = ui.match;
  const back = `<div class="row"><button class="tag" data-act="go" data-arg="home">←</button><h1>Detalle de partida</h1></div>`;
  if (m === null) return back + '<p class="mut">Cargando…</p>';
  if (!m) return back + '<p class="mut">No pude cargar esta partida.</p>';
  const hist = (S.history || []).find((g) => g.id === m.id);
  const me = m.players.find((p) => p.puuid && p.puuid === S.summoner?.puuid) || m.players.find((p) => p.champ === hist?.champ) || m.players[0];
  const maxDmg = Math.max(1, ...m.players.map((p) => p.dmg || 0));
  const n = (v) => (v ?? 0).toLocaleString('es');
  const kda = (p) => ((p.k + p.a) / Math.max(1, p.d)).toFixed(2);
  const tile = (l, v) => `<div class="card center" style="padding:10px 4px"><div class="mut">${l}</div><b>${v}</b></div>`;
  const item = (id) => (id ? `<img src="${CDN}${dd.ver}/img/item/${id}.png" alt="">` : '<i></i>');
  const row = (p) => `<div class="mrow ${p === me ? 'me' : ''}"><div class="row" style="gap:8px">${cico(p.champ).replace('<img', '<img class="ic" style="width:32px;height:32px"')}
    <div class="grow pn"><b>${esc(p.name || champ(p.champ)?.name || '')}</b><div class="mut">Nivel ${p.lvl} · ${p.cs} CS</div></div><div class="pk"><b>${p.k}/${p.d}/${p.a}</b><div class="mut">${kda(p)} KDA</div></div></div>
    <div class="row" style="gap:8px;margin-top:6px"><div class="bar2"><i style="width:${Math.round((100 * (p.dmg || 0)) / maxDmg)}%"></i></div><span class="mut" style="width:44px;text-align:right">${n(p.dmg)}</span></div>
    <div class="mitems">${p.items.map(item).join('')}</div></div>`;
  const team = (id, label) => { const ps = m.players.filter((p) => p.team === id); if (!ps.length) return '';
    const win = ps[0].win;
    return `<div class="thead ${win ? 'w' : 'l'}"><b>${label} · ${win ? 'Victoria' : 'Derrota'}</b><span>${ps.reduce((t, p) => t + p.k, 0)} bajas</span></div>${ps.map(row).join('')}`; };
  return `${back}<div class="card row"><div class="grow"><b style="font-size:18px;color:${me.win ? 'var(--teal)' : 'var(--gold)'}">${me.win ? 'VICTORIA' : 'DERROTA'}</b>
    <div class="mut">${esc(QNAME[m.queue] || 'Partida')} · ${fmt(m.dur)} · ${new Date(m.at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</div></div>
    ${cico(me.champ).replace('<img', '<img class="ic"')}</div>
  <div class="row" style="gap:8px"><div class="grow center"><div class="big" style="font-size:26px">${me.k} / ${me.d} / ${me.a}</div><div class="mut">${kda(me)} KDA</div></div></div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${tile('CS', me.cs)}${tile('Oro', n(me.gold))}${tile('Daño', n(me.dmg))}${tile('Visión', me.vision ?? 0)}</div>
  ${team(100, 'Equipo azul')}${team(200, 'Equipo rojo')}`;
}
const ABBR = { IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P', EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C' };
const DIV = { I: 1, II: 2, III: 3, IV: 4 };
const rankTxt = (r) => (r && r.t ? (ABBR[r.t] || r.t) + (/MASTER|CHALLENGER/.test(r.t) ? '' : DIV[r.d] || '') : '—');
const wrTxt = (r) => (r && r.w + r.l ? Math.round((100 * r.w) / (r.w + r.l)) + '%' : '');
function ingame() {
  const G = S.game, L = S.live;
  // La partida cuenta como empezada solo cuando el juego ya corre (gameTime > 0): mientras carga se queda la pantalla de carga.
  const started = !!(L && L.time > 0 && L.players?.length);
  const myPuuid = S.summoner?.puuid;
  const head = `<div class="row"><h1 class="grow">${esc(QNAME[G?.queueId] || 'Partida')}</h1>${started ? `<span class="big tm" data-base="${L.time}" data-dir="1" data-at="${ui.liveAt || rec}" style="font-size:24px">${fmt(L.time)}</span>` : ''}</div>`;
  const spI = (id) => (dd.spellByKey[id] ? `<img class="sp" src="${CDN}${dd.ver}/img/spell/${dd.spellByKey[id].id}.png" alt="">` : '<i class="sp"></i>');
  if (!started) {
    const loadBar = `<div class="loadbox"><div class="row" style="justify-content:center;gap:10px"><span class="spin"></span><b class="lt">CARGANDO PARTIDA</b></div><div class="lbar"><i></i></div><div class="mut center">El marcador se abrirá cuando empiece la partida.</div></div>`;
    if (!G) {
      const blank = '<div class="lc"><div class="ov"><b>&nbsp;</b></div></div>'.repeat(5);
      return head + loadBar + ['TU EQUIPO', 'RIVAL'].map((n, i) => `<div class="mut" style="letter-spacing:.08em">${n}</div><div class="lgrid">${blank}</div>${i === 0 ? '<div class="center mut">VS</div>' : ''}`).join('');
    }
    const mineOne = G.teamOne.some((p) => p.puuid === myPuuid);
    const teams = mineOne ? [['ORDER', G.teamOne, 'Tu equipo'], ['CHAOS', G.teamTwo, 'Rival']] : [['CHAOS', G.teamTwo, 'Tu equipo'], ['ORDER', G.teamOne, 'Rival']];
    const col = (p) => { const c = champ(p.champ), r = S.ranks?.[p.puuid], base = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c?.id}_`;
      return `<div class="lc ${p.puuid === myPuuid ? 'me' : ''}">${c ? `<img class="bg" src="${base}${p.skin}.jpg" onerror="this.onerror=null;this.src='${base}0.jpg'" alt="">` : ''}
      <div class="ov"><b>${esc(p.name || '')}</b><span>${esc(c?.name || '')}</span><span>${rankTxt(r)} ${wrTxt(r)}</span><span class="sps2">${spI(p.s1)}${spI(p.s2)}</span></div></div>`; };
    return head + loadBar + teams.map(([, ps, n], i) => `<div class="mut" style="letter-spacing:.08em">${n.toUpperCase()}</div><div class="lgrid">${ps.map(col).join('')}</div>${i === 0 ? '<div class="center mut">VS</div>' : ''}`).join('');
  }
  const mineOne = !G || G.teamOne.some((p) => p.puuid === myPuuid);
  const teams = mineOne ? [['ORDER', 'Tu equipo'], ['CHAOS', 'Rival']] : [['CHAOS', 'Tu equipo'], ['ORDER', 'Rival']];
  const ic = (p) => (p.champId ? cico(p.champId) : p.raw ? `<img src="${CDN}${dd.ver}/img/champion/${p.raw}.png" alt="">` : '<i></i>');
  const row = (p) => { const r = S.ranks?.[p.puuid], it = [...p.items, 0, 0, 0, 0, 0, 0].slice(0, 6);
    return `<div class="prow ${p.puuid === myPuuid ? 'me' : ''}"><div class="pc">${ic(p)}${p.dead ? `<b class="dead">${p.respawn}</b>` : ''}</div>
    <div class="grow pn"><b>${esc(p.name)}</b><div class="mut">${rankTxt(r)} ${wrTxt(r)}</div></div>
    <div class="pk"><b>${p.k}/${p.d}/${p.a}</b><div class="mut">${p.cs} CS</div></div>
    <div class="pi">${it.map((id) => (id ? `<img src="${CDN}${dd.ver}/img/item/${id}.png" alt="">` : '<i></i>')).join('')}</div></div>`; };
  return head + teams.map(([side, n]) => { const ps = L.players.filter((p) => p.team === side);
    return `<div class="row"><h2 class="grow">${n.toUpperCase()}</h2><span class="mut">${ps.reduce((t, p) => t + p.k, 0)} bajas</span></div>${ps.map(row).join('')}`; }).join('');
}

async function loadSkins(cid) {
  ui.skinFor = cid; ui.skins = []; ui.skin = null;
  const list = await act('skins', { championId: cid });
  if (ui.skinFor === cid && list) { ui.skins = list; ui.centerSkin = true; render(); }
}
const curAction = () => {
  const cs = S.champSelect; if (!cs) return null;
  return (cs.actions || []).flat().find((a) => a.actorCellId === cs.localPlayerCellId && !a.completed && a.isInProgress) || null;
};
function runes() {
  return `<div class="row"><button class="tag" data-act="go" data-arg="home">←</button><h1>Páginas de runas</h1></div>
  <p class="mut">Toca una para usarla en el cliente.</p>
  ${(S.perks || []).filter((p) => p.isValid).map((p) => `<button class="perk ${p.current ? 'on' : ''}" data-act="page" data-arg="${p.id}">
    ${rune(dd.perkIcon[p.selectedPerkIds?.[0]])}<span class="grow"><b>${esc(p.name)}</b><br><span class="mut">${p.current ? 'En uso' : ''}</span></span>${rune(dd.styleIcon[p.subStyleId])}</button>`).join('') || '<p class="mut">No hay páginas.</p>'}
  ${bnav('runes')}`;
}

// ---------- Render y eventos ----------
function view() {
  if (!token) return pair();
  if (!S.connected) return waiting();
  const p = S.phase;
  if (p === 'ChampSelect') return draft();
  if (p === 'ReadyCheck') return ready();
  if (p === 'Matchmaking' || p === 'Lobby') return lobby();
  if (['InProgress', 'GameStart', 'Reconnect'].includes(p)) return ingame();
  return ui.screen === 'modes' ? modes() : ui.screen === 'runes' ? runes() : ui.screen === 'friends' ? friendsView() : ui.screen === 'settings' ? settingsView() : ui.screen === 'match' ? matchView() : home();
}
let rec = 0;
function render() {
  const fid = document.activeElement?.id, keep = [...document.querySelectorAll('[data-sk]')].map((e) => [e.dataset.sk, e.scrollLeft]);
  const html = view(); $('#app').innerHTML = html; $('#app').className = html.includes('class="bnav"') ? 'hasnav' : '';
  if (fid && $('#' + fid) && /^(q|ename)$/.test(fid)) { const el = $('#' + fid); el.focus(); el.setSelectionRange?.(999, 999); }
  for (const [k, x] of keep) { const el = document.querySelector(`[data-sk="${k}"]`); if (el) el.scrollLeft = x; }
  tick();
  if (ui.centerSkin) { ui.centerSkin = false; document.querySelector('.sk.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }
}
const tick = () => document.querySelectorAll('.tm').forEach((e) => { e.textContent = fmt(+e.dataset.base + e.dataset.dir * ((Date.now() - (+e.dataset.at || rec)) / 1000)); });
setInterval(tick, 250);

async function loadFriends() { ui.fl = null; render(); ui.fl = (await act('friends')) || []; if (ui.screen === 'friends') render(); }
const H = {
  async match(a) {
    ui.screen = 'match'; ui.match = null; ui.matchId = +a; render();
    const m = await act('match', { gameId: +a });
    if (ui.matchId === +a) { ui.match = m || false; render(); }
  },
  go: (a) => { ui.screen = a; render(); if (a === 'friends') loadFriends(); },
  play: () => act('queue', { queueId: lastQ() }),
  async invfriend(a) {
    try { await actRaw('queue', { queueId: lastQ() }); await actRaw('invite', { summonerId: +a }); toast('Invitación enviada', true); }
    catch (e) { toast(e.message); }
  },
  askunpair: () => { if (confirm('¿Desvincular este móvil? Tendrás que escanear el QR otra vez.')) H.unpair(); },
  mode: (a) => { ui.mode = a; render(); },
  role: (a) => { ui.role = a; render(); },
  queue: (a) => { localStorage.setItem('lastQ', a); return act('queue', { queueId: +a }); },
  search: () => act('search'), cancel: () => act('cancel'), leave: () => act('leave'),
  accept: () => act('accept'), decline: () => act('decline'),
  swap: (a) => { const [kind, id, op] = a.split(':'); act('swap', { kind, id: +id, op }); },
  spellsheet: (a) => { ui.sheet = { t: 'spell', n: +a }; render(); },
  usepage: (a) => { ui.sheet = null; render(); act('setPage', { id: +a }); },
  setspell: (a) => {
    const [n, k] = a.split(':'), cs = S.champSelect || {}, m = (cs.myTeam || []).find((x) => x.cellId === cs.localPlayerCellId) || {};
    let s1 = m.spell1Id, s2 = m.spell2Id;
    if (n === '1') { if (+k === s2) s2 = s1; s1 = +k; } else { if (+k === s1) s1 = s2; s2 = +k; }
    ui.sheet = null; render(); act('spells', { spell1Id: s1, spell2Id: s2 });
  },
  rolesheet: (a) => { ui.sheet = { t: 'role', n: +a }; render(); },
  closesheet: () => { ui.sheet = null; ui.edit = null; render(); },
  setrole: (a) => {
    const [n, k] = a.split(':'), me = S.lobby?.localMember || {};
    let f = me.firstPositionPreference || 'FILL', s = me.secondPositionPreference || 'FILL';
    if (n === '1') { if (k === s && k !== 'FILL') s = f; f = k; } else { if (k === f && k !== 'FILL') f = s; s = k; }
    ui.sheet = null; render(); act('positions', { first: f, second: s });
  },
  async invsheet() { ui.sheet = { t: 'invite' }; ui.friends = null; render(); ui.friends = (await act('friends')) || []; render(); },
  invite: (a) => { act('invite', { summonerId: +a }); ui.sheet = null; render(); },
  pos: (a) => {
    const [n, k] = a.split(':'), me = S.lobby?.localMember || {};
    const first = n === '1' ? k : me.firstPositionPreference, second = n === '2' ? k : me.secondPositionPreference;
    act('positions', { first: first || 'FILL', second: second || 'FILL' });
  },
  page: (a) => act('setPage', { id: +a }),
  unpair: () => { localStorage.removeItem('token'); token = null; location.reload(); },
  async pair() {
    const code = $('#code').value.trim();
    await doPair({ code });
  },
};
Object.assign(H, DH);
document.addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (t) H[t.dataset.act]?.(t.dataset.arg); });
document.addEventListener('input', (e) => { if (e.target.id === 'q') { ui.q = e.target.value; render(); } });

async function doPair(body) {
  try {
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, name: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Móvil Android' }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    token = j.token; localStorage.setItem('token', token); history.replaceState(null, '', '/'); connect();
  } catch (e) { ui.err = e.message; render(); }
}
let es;
function connect() {
  if (es) es.close();
  es = new EventSource('/api/events?t=' + token);
  es.onmessage = (e) => {
    const m = JSON.parse(e.data); Object.assign(S, m); rec = Date.now();
    if ('search' in m) {   // el cronómetro cuenta desde un inicio fijo; un evento sin tiempo ya no lo reinicia
      const t = m.search?.timeInQueue;
      if (!m.search) ui.queueStart = 0; else if (t > 0) ui.queueStart = rec - t * 1000; else if (!ui.queueStart) ui.queueStart = rec;
    }
    if (S.phase !== 'Matchmaking' && S.phase !== 'ReadyCheck') ui.queueStart = 0;
    if ('champSelect' in m) ui.csAt = rec;
    if ('live' in m) ui.liveAt = rec;
    if (ui.lastPhase === 'ChampSelect' && S.phase !== 'ChampSelect') Object.assign(ui, { pickSel: 0, banSel: 0, view: 'grid', mode2: null, skin: null, skinFor: 0, skins: [], rec: null, rtab: null, lastType: undefined, sheet: null, edit: null, busy: false });
    if (S.phase === 'ChampSelect') {   // al empezar tu turno
      const t = curAction()?.type;
      if (t !== ui.lastType) {
        ui.lastType = t;
        if (t) { navigator.vibrate?.(200); ui.mode2 = null; ui.banSel = 0; if (t === 'ban' || !ui.pickSel) ui.view = 'grid'; }
      }
    }
    if (m.live && !ui.liveSeen) { ui.liveSeen = true; navigator.vibrate?.([120, 80, 120]); }   // empezó la partida
    if (!['GameStart', 'InProgress', 'Reconnect'].includes(S.phase)) ui.liveSeen = false;
    if (S.phase === 'ReadyCheck' && ui.lastPhase !== 'ReadyCheck') { ui.rcStart = Date.now(); navigator.vibrate?.([250, 120, 250]); }
    ui.lastPhase = S.phase;
    if ('readyElapsed' in m) ui.rcStart = Date.now() - m.readyElapsed * 1000;
    render();
  };
  es.onerror = () => api('/api/ping').catch(() => {});
  render();
}

const qp = new URLSearchParams(location.search).get('pair');
if (qp && !token) doPair({ token: qp }); else if (token) connect(); else render();
loadDD();

document.addEventListener('visibilitychange', () => { if (!document.hidden && token && (!es || es.readyState === 2)) connect(); });
