// Selección de campeón: cuadrícula, vista de skins (como el cliente), runas recomendadas y editor de runas.
// Se carga antes que app.js; usa sus globales ($, S, ui, dd, H, act, actRaw, toast, render, champ, cico, esc, fmt, rec…) solo dentro de funciones.
const DDI = 'https://ddragon.leagueoflegends.com/cdn/';
const PHASE_ES = { PLANNING: 'PLANIFICACIÓN', BAN_PICK: 'SELECCIÓN', FINALIZATION: 'ELIGE TU CONFIGURACIÓN' };
const SHARD_IMG = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/';
const SHARDS = { 5008: ['Fuerza adaptable', 'statmodsadaptiveforceicon'], 5005: ['Vel. de ataque', 'statmodsattackspeedicon'], 5007: ['Aceleración de habilidad', 'statmodscdrscalingicon'],
  5010: ['Vel. de movimiento', 'statmodsmovementspeedicon'], 5001: ['Vida escalable', 'statmodshealthscalingicon'], 5011: ['Vida', 'statmodshealthplusicon'], 5013: ['Tenacidad', 'statmodstenacityicon'] };
const SHARD_ROWS = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
const shardImg = (id) => (SHARDS[id] ? `<img src="${SHARD_IMG}${SHARDS[id][1]}.png" alt="" onerror="this.style.visibility='hidden'">` : '<i></i>');
const anyRune = (id) => (SHARDS[id] ? shardImg(id) : rune(dd.perkIcon[id]) || '<i></i>');

// ---------- Contexto de la selección ----------
const myCell = (cs) => (cs.myTeam || []).find((x) => x.cellId === cs.localPlayerCellId) || {};
const myPickAct = (cs) => (cs.actions || []).flat().find((x) => x.actorCellId === cs.localPlayerCellId && x.type === 'pick');
function draftCtx() {
  const cs = S.champSelect, a = curAction(), type = a?.type, me = myCell(cs), pk = myPickAct(cs);
  const locked = !!(pk?.completed && me.championId);
  // campeón "tuyo": el bloqueado, o el que acabas de marcar (se muestra al instante, sin esperar al cliente)
  const cid = locked ? me.championId : ui.pickSel || me.championId || me.championPickIntent || 0;
  const banMode = type === 'ban' && ui.mode2 !== 'prepick';
  return { cs, type, me, locked, cid, banMode, skinMode: !!cid && !!champ(cid) && (locked || (ui.view === 'skin' && !banMode)) };
}
// Campeones ya baneados (o con ban completado). Para banear NO se usa la lista "bannable" del cliente:
// puede llegar vieja o parcial y bloqueaba bans válidos. Si el cliente rechaza el ban, el servidor devuelve el motivo real.
function bannedIds(cs) {
  const ids = new Set([...(cs.bans?.myTeamBans || []), ...(cs.bans?.theirTeamBans || [])].filter((x) => x > 0));
  for (const a of (cs.actions || []).flat()) if (a.type === 'ban' && a.completed && a.championId > 0) ids.add(a.championId);
  return ids;
}
const posName = (k) => (POS.find((x) => x[0] === (k || '').toUpperCase()) || [0, ''])[1];
const spIcon = (id) => (dd.spellByKey[id] ? `<img class="sp" src="${DDI}${dd.ver}/img/spell/${dd.spellByKey[id].id}.png" alt="">` : '<i class="sp"></i>');

// ---------- Piezas comunes ----------
function headerHTML(cs, type) {
  const left = (cs.timer?.adjustedTimeLeftInPhase || 0) / 1000;
  const title = type === 'ban' ? 'ELIGE UN BAN' : type === 'pick' ? 'ELIGE TU CAMPEÓN' : PHASE_ES[cs.timer?.phase] || esc(cs.timer?.phase || 'SELECCIÓN');
  return `<div class="center"><h2>${title}</h2><div class="big tm" data-base="${left}" data-dir="-1" data-at="${ui.csAt || rec}" style="color:var(--teal)">${fmt(left)}</div></div>`;
}
function bansHTML(cs) {
  const list = (ally) => {
    const seen = new Map();
    for (const x of (cs.actions || []).flat()) if (x.type === 'ban' && !!x.isAllyAction === ally && x.championId > 0) seen.set(x.championId, !!x.completed);
    for (const id of (ally ? cs.bans?.myTeamBans : cs.bans?.theirTeamBans) || []) if (id > 0) seen.set(id, true);
    return [...seen];
  };
  const bans = (ally) => `<div class="bans">${[...list(ally), null, null, null, null, null].slice(0, 5).map((b) => (b ? `<span class="bn ${b[1] ? '' : 'pend'}">${cico(b[0])}</span>` : '<i></i>')).join('')}</div>`;
  return `<div class="row"><div class="grow"><div class="mut">Bans aliados</div>${bans(true)}</div><div class="grow"><div class="mut">Bans rivales</div>${bans(false)}</div></div>`;
}
function swapsOf(cs) {
  return [['pickOrderSwaps', 'pick', 'de orden de selección'], ['positionSwaps', 'position', 'de línea / rol'], ['trades', 'trade', 'de campeón']]
    .flatMap(([key, kind, what]) => (cs[key] || []).map((x) => ({ kind, what, id: x.id, cellId: x.cellId, state: x.state })));
}
// Un botón por tipo de cambio: orden de selección (flechas), línea / rol (pin) o campeón (intercambio).
const SW_ICON = {
  pick: '<path d=\"M4 8h14l-4-4M20 16H6l4 4\"/>',
  position: '<path d=\"M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z\"/><circle cx=\"12\" cy=\"11\" r=\"2\"/>',
  trade: '<path d=\"M7 7h10l-3-3M17 17H7l3 3M17 7v4M7 17v-4\"/>',
};
const swapBtn = (w) => `<button class=\"swb ${w.kind}\" data-act=\"swap\" data-arg=\"${w.kind}:${w.id}:request\" title=\"Pedir cambio ${w.what}\" aria-label=\"Pedir cambio ${w.what}\"><svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">${SW_ICON[w.kind] || SW_ICON.pick}</svg></button>`;
function swapBannerHTML(cs, swaps) {
  const whoIs = (cell) => { const m = cs.myTeam.find((x) => x.cellId === cell); return esc(m?.gameName || m?.summonerName || champ(m?.championId)?.name || 'Un aliado'); };
  return swaps.filter((x) => x.state === 'RECEIVED' || x.state === 'SENT').map((x) => x.state === 'RECEIVED'
    ? `<div class="card swreq"><span class="grow"><b>${whoIs(x.cellId)}</b> quiere un cambio ${x.what}</span><button class="tag" data-act="swap" data-arg="${x.kind}:${x.id}:accept">Aceptar</button><button class="tag" data-act="swap" data-arg="${x.kind}:${x.id}:decline">Rechazar</button></div>`
    : `<div class="card swreq"><span class="grow">Pediste un cambio ${x.what} a <b>${whoIs(x.cellId)}</b>…</span><button class="tag" data-act="swap" data-arg="${x.kind}:${x.id}:cancel">Cancelar</button></div>`).join('');
}
const currentPage = () => (S.perks || []).find((x) => x.current);

// ---------- Vista 1: cuadrícula de campeones ----------
function gridBody(cx) {
  const { cs, type, cid, banMode } = cx;
  const swaps = swapsOf(cs);
  const ally = (p) => {
    const mine = p.cellId === cs.localPlayerCellId;
    const shown = mine ? cid : p.championId || p.championPickIntent;   // tu prepick se ve al instante
    const nm = mine ? 'Tú' : esc(p.gameName || p.summonerName || champ(p.championId)?.name || 'Aliado');
    const ws = swaps.filter((x) => x.cellId === p.cellId && x.state === 'AVAILABLE');
    return `<div class=\"slot ${mine ? 'me' : ''}\">${cico(shown)}<span class=\"grow\"><b>${nm}</b><br><span class=\"mut\">${posName(p.assignedPosition)}</span></span><span class=\"sps\">${spIcon(p.spell1Id)}${spIcon(p.spell2Id)}</span>${mine ? '' : ws.map(swapBtn).join('')}</div>`;
  };
  const enemy = (p) => (p && p.championId ? `<div class="slot">${cico(p.championId)}<span class="grow">${esc(champ(p.championId)?.name || '')}</span></div>`
    : `<div class="slot"><i></i><span class="grow mut">Jugador oculto</span></div>`);
  const banned = bannedIds(cs), pool = S.pickable;
  const ok = (id) => (banMode ? !banned.has(id) : !pool?.length || pool.includes(id));
  const list = Object.values(dd.byKey).filter((c) => (ui.role === 'all' || c.tags.includes(ui.role)) && c.name.toLowerCase().includes(ui.q.toLowerCase())).sort((x, y) => x.name.localeCompare(y.name));
  const sel = banMode ? ui.banSel : cid, nm = (id) => esc(champ(id)?.name || '');
  let label, can;
  if (banMode) { can = !!ui.banSel; label = 'BANEAR' + (ui.banSel ? ' · ' + nm(ui.banSel) : ''); }
  else if (type === 'pick') { can = !!cid; label = 'BLOQUEAR' + (cid ? ' · ' + nm(cid) : ''); }
  else { can = false; label = cid ? 'PREPICK · ' + nm(cid) : type === 'ban' ? 'ELIGE TU PREPICK' : 'ESPERA TU TURNO'; }
  const modeTags = type === 'ban' ? `<div class="tags"><button class="tag ${banMode ? 'on' : ''}" data-act="m2" data-arg="ban">Banear</button><button class="tag ${!banMode ? 'on' : ''}" data-act="m2" data-arg="prepick">Prepick</button></div>` : '';
  const toSkin = cid && !banMode ? `<button class="tag on" data-act="toskin">${nm(cid)} · skins y runas →</button>` : '';
  return `${headerHTML(cs, type)}${bansHTML(cs)}${swapBannerHTML(cs, swaps)}<div class="teams">${cs.myTeam.map((p, i) => ally(p) + enemy(cs.theirTeam?.[i])).join('')}</div>
  ${modeTags}<input id="q" placeholder="Buscar campeón…" value="${esc(ui.q)}">
  <div class="tags" data-sk="roles">${TAGS.map(([k, n]) => `<button class="tag ${ui.role === k ? 'on' : ''}" data-act="role" data-arg="${k}">${n}</button>`).join('')}</div>${toSkin ? `<div class="tags">${toSkin}</div>` : ''}
  <div class="grid">${list.map((c) => `<button class="ch ${sel === +c.key ? 'sel' : ''} ${ok(+c.key) ? '' : 'off'}" data-act="pick" data-arg="${c.key}" aria-label="${esc(c.name)}">${cico(+c.key)}</button>`).join('')}</div>
  <div class="bar"><button class="rb" data-act="runesheet" aria-label="Runas">${rune(dd.perkIcon[currentPage()?.selectedPerkIds?.[0]]) || '✦'}</button>
    <button class="btn teal" data-act="lock" ${can && !ui.busy ? '' : 'disabled'}>${ui.busy ? 'Confirmando…' : label}</button>
    <button class="rb sq" data-act="spellsheet" data-arg="1" aria-label="Hechizo 1">${spIcon(cx.me.spell1Id)}</button>
    <button class="rb sq" data-act="spellsheet" data-arg="2" aria-label="Hechizo 2">${spIcon(cx.me.spell2Id)}</button></div>`;
}

// ---------- Vista 2: skins (como la pantalla de selección del cliente) ----------
function skinState(cx) {
  const c = champ(cx.cid), owned = ui.skinFor === cx.cid ? ui.skins : [];
  const list = owned.length ? owned : [{ id: cx.cid * 1000, name: c.name }];
  const want = ui.skin ?? ((cx.me.championId === cx.cid && cx.me.selectedSkinId) || cx.cid * 1000);
  return { c, list, idx: Math.max(0, list.findIndex((s) => s.id === want)) };
}
const splashUrl = (c, num) => `${DDI}img/champion/splash/${c.id}_${num}.jpg`;
function skinBody(cx) {
  const { cs, type, cid, locked, me } = cx, { c, list, idx } = skinState(cx), sk = list[idx], num = sk.id % 1000;
  const skinName = num === 0 ? 'Clásica' : sk.name;
  const alt = `${DDI}img/champion/loading/${c.id}_${num}.jpg`;
  const many = list.length > 1;
  const dots = !many ? '' : list.length <= 16 ? `<div class="dots">${list.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : `<div class="mut center">${idx + 1} / ${list.length}</div>`;
  const thumbs = many ? `<div class="skins" data-sk="thumbs">${list.map((k) => `<button class="sk ${k.id === sk.id ? 'on' : ''}" data-act="skin" data-arg="${k.id}" aria-label="${esc(k.id % 1000 === 0 ? 'Clásica' : k.name)}">
    <img src="${DDI}img/champion/tiles/${c.id}_${k.id % 1000}.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='${DDI}img/champion/loading/${c.id}_${k.id % 1000}.jpg'"></button>`).join('')}</div>`
    : `<p class="mut center">No tienes más skins de ${esc(c.name)}.</p>`;
  const team = cs.myTeam.map((p) => {
    const mine = p.cellId === cs.localPlayerCellId, shown = mine ? cid : p.championId || p.championPickIntent;
    const nm = mine ? 'Tú' : esc(p.gameName || p.summonerName || champ(p.championId)?.name || 'Aliado');
    return `<div class="al ${mine ? 'me' : ''}"><div class="alp">${cico(shown)}</div><b>${nm}</b><span class="als">${spIcon(p.spell1Id)}${spIcon(p.spell2Id)}</span></div>`;
  }).join('');
  const banBanner = type === 'ban' ? `<button class="card swreq" data-act="m2" data-arg="ban"><span class="grow"><b>Es tu turno de banear</b></span><span class="tag on">Elegir ban</span></button>` : '';
  const label = locked ? 'CAMPEÓN BLOQUEADO' : type === 'pick' ? 'BLOQUEAR · ' + esc(c.name) : 'PREPICK · ' + esc(c.name);
  const pg = currentPage();
  return `<div class="row">${locked ? '' : '<button class="tag" data-act="togrid">← Campeones</button>'}<div class="grow center"><h2>${PHASE_ES[cs.timer?.phase] && !type ? PHASE_ES[cs.timer.phase] : type === 'ban' ? 'ELIGE UN BAN' : type === 'pick' ? 'ELIGE TU CAMPEÓN' : 'TU CAMPEÓN'}</h2></div>
    <span class="big tm" style="font-size:24px;color:var(--teal)" data-base="${(cs.timer?.adjustedTimeLeftInPhase || 0) / 1000}" data-dir="-1" data-at="${ui.csAt || rec}">${fmt((cs.timer?.adjustedTimeLeftInPhase || 0) / 1000)}</span></div>
  ${banBanner}${swapBannerHTML(cs, swapsOf(cs))}
  <div class="hero"><img class="himg" src="${splashUrl(c, num)}" alt="" onerror="this.onerror=null;this.src='${alt}'"><div class="hfade"></div>
    ${many ? `<button class="hnav l" data-act="skinstep" data-arg="-1" aria-label="Skin anterior">‹</button><button class="hnav r" data-act="skinstep" data-arg="1" aria-label="Skin siguiente">›</button>` : ''}
    <div class="htxt"><div class="hch">${esc(c.name.toUpperCase())}</div><div class="hsk">${esc(skinName)}</div></div></div>
  ${dots}${thumbs}
  <div class="allies" data-sk="allies">${team}</div>${bansHTML(cs)}
  <div class="bar col"><div class="row" style="width:100%">
    <button class="pill" data-act="runesheet" aria-label="Runas">${rune(dd.perkIcon[pg?.selectedPerkIds?.[0]]) || '✦'}<span class="grow">${esc(pg?.name || 'Runas')}</span><span class="mut">▾</span></button>
    <button class="rb sq" data-act="spellsheet" data-arg="1" aria-label="Hechizo 1">${spIcon(me.spell1Id)}</button>
    <button class="rb sq" data-act="spellsheet" data-arg="2" aria-label="Hechizo 2">${spIcon(me.spell2Id)}</button></div>
    <button class="btn teal" data-act="lock" ${type === 'pick' && !locked && !ui.busy ? '' : 'disabled'}>${ui.busy ? 'Confirmando…' : label}</button></div>`;
}

function draft() {
  const cs = S.champSelect;
  if (!cs) return waiting();
  const cx = draftCtx();
  if (cx.cid && ui.skinFor !== cx.cid) loadSkins(cx.cid);
  return (cx.skinMode ? skinBody(cx) : gridBody(cx)) + sheet();
}

// ---------- Runas: recomendadas del juego + mis páginas ----------
const editablePages = () => (S.perks || []).filter((p) => p.isEditable && p.isValid !== false);
function recKey() { const cx = draftCtx(); return cx.cid ? cx.cid + ':' + (cx.me.assignedPosition || '') : ''; }
async function loadRec() {
  const key = recKey(); if (!key || ui.rec?.key === key) return;
  ui.rec = { key, list: null }; render();
  const cx = draftCtx();
  let list = [], err = '';
  try { list = (await actRaw('recRunes', { championId: cx.cid, position: cx.me.assignedPosition })).data || []; } catch (e) { err = e.message; }
  if (ui.rec?.key === key) { ui.rec = { key, list, err }; render(); }
}
const pageIcons = (p) => p.selectedPerkIds.slice(0, 4).map(anyRune).join('') + '<b class="sepv"></b>' + p.selectedPerkIds.slice(4, 6).map(anyRune).join('') + '<b class="sepv"></b>' + p.selectedPerkIds.slice(6, 9).map(anyRune).join('');
function runesSheet() {
  const cx = S.champSelect ? draftCtx() : { cid: 0 }, cid = cx.cid, c = champ(cid), tab = ui.rtab || (cid ? 'rec' : 'mine');
  if (cid && tab === 'rec' && recKey() && ui.rec?.key !== recKey()) setTimeout(loadRec, 0);
  const N = Math.max(1, editablePages().length);
  const tabs = `<div class="tags"><button class="tag ${tab === 'rec' ? 'on' : ''}" data-act="rtab" data-arg="rec">Recomendadas</button><button class="tag ${tab === 'mine' ? 'on' : ''}" data-act="rtab" data-arg="mine">Mis páginas</button></div>`;
  let body;
  if (tab === 'rec') {
    const R = ui.rec?.key === recKey() ? ui.rec.list : null;
    if (!cid) body = '<p class="mut">Elige un campeón para ver sus runas recomendadas.</p>';
    else if (R === null) body = '<p class="mut">Buscando las runas recomendadas…</p>';
    else if (!R.length) body = `<p class="mut">El cliente no tiene runas recomendadas para ${esc(c?.name || 'este campeón')} en esta línea.${ui.rec?.err ? ' (' + esc(ui.rec.err) + ')' : ''}</p>
      <button class="btn ghost" data-act="editcur">Crear mi propia página</button>`;
    else {
      const fillN = Math.min(R.length, N);
      const card = (p, i) => { const k = p.selectedPerkIds;
        return `<div class="rcard"><div class="rk">${anyRune(k[0])}</div><div class="rm">${k.slice(1, 4).map(anyRune).join('')}</div>
        <div class="rt">${esc(p.desc || p.name)}</div><div class="rs">${k.slice(4, 6).map(anyRune).join('')}</div>
        ${p.spells?.length ? `<div class="rsp">${p.spells.map(spIcon).join('')}</div>` : ''}
        <div class="rbtn"><button class="tag on" data-act="userec" data-arg="${i}">Usar</button><button class="tag" data-act="editrec" data-arg="${i}">Editar</button></div></div>`; };
      body = `<p class="mut">Recomendadas por el juego para <b>${esc(c.name)}</b>${cx.me.assignedPosition ? ' · ' + posName(cx.me.assignedPosition) : ''}. Desliza para ver las ${R.length}.</p>
      <div class="rcards">${R.map(card).join('')}</div>
      <button class="btn ghost" data-act="fillrunes">Cargar en mis ${fillN} página${fillN > 1 ? 's' : ''}</button>`;
    }
  } else {
    body = (S.perks || []).filter((x) => x.isValid).map((x) => `<div class="rrow pgrow ${x.current ? 'on' : ''}"><button class="pgsel" data-act="usepage" data-arg="${x.id}">${rune(dd.perkIcon[x.selectedPerkIds?.[0]])}<span class="grow"><b>${esc(x.name)}</b></span>${rune(dd.styleIcon[x.subStyleId])}</button>
      ${x.isEditable ? `<button class="tag" data-act="editpage" data-arg="${x.id}">Editar</button>` : ''}</div>`).join('') || '<p class="mut">No hay páginas.</p>';
  }
  return `<div class="backdrop" data-act="closesheet"></div><div class="sheet"><h2>RUNAS</h2>${tabs}${body}</div>`;
}

// ---------- Editor de runas ----------
function editFrom(page, target) {
  const st = dd.styles || [], ids = page.selectedPerkIds || [];
  const pst = st.find((x) => x.id === page.primaryStyleId), sst = st.find((x) => x.id === page.subStyleId);
  const pr = (pst?.slots || [0, 0, 0, 0]).map((sl) => (sl.runes ? ids.slice(0, 6).find((id) => sl.runes.some((r) => r.id === id)) || 0 : 0));
  const se = ids.slice(0, 6).filter((id) => sst?.slots.some((sl, i) => i > 0 && sl.runes.some((r) => r.id === id))).slice(0, 2);
  ui.edit = { target, name: page.name || 'Mi página', p: page.primaryStyleId, s: page.subStyleId, pr: pr.length === 4 ? pr : [0, 0, 0, 0], se, sh: [0, 1, 2].map((i) => ids[6 + i] || SHARD_ROWS[i][0]) };
  ui.sheet = { t: 'edit' }; render();
}
function editSheet() {
  const E = ui.edit, st = dd.styles || [];
  if (!E || !st.length) return `<div class="backdrop" data-act="closesheet"></div><div class="sheet"><p class="mut">Cargando datos de runas…</p></div>`;
  const pst = st.find((x) => x.id === E.p), sst = st.find((x) => x.id === E.s);
  const styleBtns = (w, sel, skip) => `<div class="styles">${st.filter((x) => x.id !== skip).map((x) => `<button class="stl ${x.id === sel ? 'on' : ''}" data-act="estyle" data-arg="${w}:${x.id}" aria-label="${esc(x.name)}">${rune(x.icon)}</button>`).join('')}</div>`;
  const rn = (r, w, row, on) => `<button class="rn ${on ? 'on' : ''}" data-act="erune" data-arg="${w}:${row}:${r.id}" aria-label="${esc(r.name)}">${rune(r.icon)}<span>${esc(r.name)}</span></button>`;
  const prim = pst.slots.map((sl, row) => `<div class="rr ${row === 0 ? 'key' : ''}">${sl.runes.map((r) => rn(r, 'p', row, E.pr[row] === r.id)).join('')}</div>`).join('');
  const sec = sst.slots.map((sl, row) => (row === 0 ? '' : `<div class="rr">${sl.runes.map((r) => rn(r, 's', row, E.se.includes(r.id))).join('')}</div>`)).join('');
  const shards = SHARD_ROWS.map((ids, row) => `<div class="rr">${ids.map((id) => `<button class="rn ${E.sh[row] === id ? 'on' : ''}" data-act="eshard" data-arg="${row}:${id}">${shardImg(id)}<span>${SHARDS[id][0]}</span></button>`).join('')}</div>`).join('');
  const ready = E.pr.every(Boolean) && E.se.length === 2 && E.sh.every(Boolean);
  const targets = editablePages();
  return `<div class="backdrop" data-act="closesheet"></div><div class="sheet tall"><h2>EDITAR RUNAS</h2>
    <input id="ename" maxlength="25" value="${esc(E.name)}" placeholder="Nombre de la página" aria-label="Nombre">
    ${targets.length ? `<label class="mut">Guardar en <select id="etarget">${targets.map((t) => `<option value="${t.id}" ${(E.target ?? currentPage()?.id) === t.id ? 'selected' : ''}>${esc(t.name)}${t.current ? ' (activa)' : ''}</option>`).join('')}</select></label>` : ''}
    <div class="mut">Árbol principal</div>${styleBtns('p', E.p)}${prim}
    <div class="mut">Árbol secundario · elige 2 de filas distintas</div>${styleBtns('s', E.s, E.p)}${sec}
    <div class="mut">Fragmentos</div>${shards}
    <div class="row" style="position:sticky;bottom:-18px;background:#0F1E38;padding:10px 0"><button class="btn ghost" data-act="runesheet" style="flex:0 0 38%">Volver</button><button class="btn" data-act="esave" ${ready ? '' : 'disabled'}>${ready ? 'Guardar y usar' : 'Completa la página'}</button></div></div>`;
}

// ---------- Acciones ----------
function pickSkin(id) { ui.skin = id; ui.centerSkin = true; render(); act('setSkin', { skinId: id }); const { c, list } = skinState(draftCtx()); for (const k of list) new Image().src = splashUrl(c, k.id % 1000); }
const DH = {
  async pick(a) {
    const id = +a, cx = draftCtx(), t = cx.type, pool = S.pickable;
    if (cx.banMode) { if (bannedIds(cx.cs).has(id)) return toast('Ese campeón ya está baneado'); }
    else if (pool?.length && !pool.includes(id)) return toast('Ese campeón no está disponible');
    if (cx.banMode) { ui.banSel = id; render(); return act('hover', { type: 'ban', championId: id }); }  // elegir ban
    const prev = ui.pickSel;                                                                              // prepick o pick: se ve al instante y abre las skins
    ui.pickSel = id; ui.view = 'skin'; ui.centerSkin = true; ui.skin = null; render();
    try { await actRaw(t === 'pick' ? 'hover' : 'intent', t === 'pick' ? { type: 'pick', championId: id } : { championId: id }); }
    catch (e) { toast(e.message); if (ui.pickSel === id) { ui.pickSel = prev; ui.view = 'grid'; } render(); }
  },
  async lock() {
    const cx = draftCtx(), t = cx.type; if (!t || ui.busy) return;
    const id = cx.banMode ? ui.banSel : t === 'pick' ? cx.cid : 0;   // nunca banea tu prepick
    if (!id) return;
    ui.busy = true; render();
    try { await actRaw('lock', { type: t, championId: id }); if (t === 'ban') ui.banSel = null; }
    catch (e) { toast(e.message); }
    ui.busy = false; render();
  },
  m2: (a) => { ui.mode2 = a; if (a === 'ban') ui.view = 'grid'; render(); },
  toskin() { if (curAction()?.type === 'ban') ui.mode2 = 'prepick'; ui.view = 'skin'; ui.centerSkin = true; render(); },
  togrid() { ui.view = 'grid'; render(); },
  skin: (a) => pickSkin(+a),
  skinstep(a) { const { list, idx } = skinState(draftCtx()); if (list.length > 1) pickSkin(list[(idx + +a + list.length) % list.length].id); },
  // runas
  runesheet() { ui.sheet = { t: 'runes' }; render(); },
  rtab: (a) => { ui.rtab = a; render(); },
  async userec(a) {
    const p = ui.rec?.list?.[+a]; if (!p) return;
    try { await actRaw('applyRunes', { page: p }); ui.sheet = null; toast('Runas aplicadas: ' + p.name, true); } catch (e) { toast(e.message); }
    render();
  },
  async fillrunes() {
    const R = (ui.rec?.list || []).slice(0, Math.max(1, editablePages().length)); if (!R.length) return;
    if (!confirm(`Esto reemplaza ${R.length} de tus páginas de runas por las recomendadas. ¿Continuar?`)) return;
    try { const r = await actRaw('fillRunes', { pages: R }); ui.sheet = null; toast(`${r.data} página(s) de runas cargadas`, true); } catch (e) { toast(e.message); }
    render();
  },
  editrec: (a) => { const p = ui.rec?.list?.[+a]; if (p) editFrom(p, currentPage()?.isEditable ? currentPage().id : editablePages()[0]?.id); },
  editpage: (a) => { const p = (S.perks || []).find((x) => x.id === +a); if (p) editFrom(p, p.id); },
  editcur() { const p = currentPage() || (S.perks || [])[0]; if (p) editFrom(p, p.isEditable ? p.id : editablePages()[0]?.id); },
  estyle(a) {
    const [w, id] = a.split(':'), E = ui.edit, n = +id;
    if (w === 'p') { E.p = n; E.pr = [0, 0, 0, 0]; if (E.s === n) { E.s = dd.styles.find((x) => x.id !== n).id; E.se = []; } } else { E.s = n; E.se = []; }
    render();
  },
  erune(a) {
    const [w, row, id] = a.split(':'), E = ui.edit, n = +id, r = +row;
    if (w === 'p') E.pr[r] = n;
    else {
      const sst = dd.styles.find((x) => x.id === E.s), rowOf = (rid) => sst.slots.findIndex((sl) => sl.runes.some((x) => x.id === rid));
      if (E.se.includes(n)) E.se = E.se.filter((x) => x !== n);
      else { E.se = E.se.filter((x) => rowOf(x) !== r); E.se.push(n); if (E.se.length > 2) E.se.shift(); }
    }
    render();
  },
  eshard(a) { const [row, id] = a.split(':'); ui.edit.sh[+row] = +id; render(); },
  async esave() {
    const E = ui.edit, page = { name: (E.name || 'Mi página').trim(), primaryStyleId: E.p, subStyleId: E.s, selectedPerkIds: [...E.pr, ...E.se, ...E.sh] };
    try { await actRaw('applyRunes', { page, targetId: E.target }); ui.sheet = null; ui.edit = null; toast('Runas guardadas y activas', true); } catch (e) { toast(e.message); }
    render();
  },
};
document.addEventListener('input', (e) => { if (e.target.id === 'ename' && ui.edit) ui.edit.name = e.target.value; });
document.addEventListener('change', (e) => { if (e.target.id === 'etarget' && ui.edit) ui.edit.target = +e.target.value; });
// Deslizar sobre la skin para cambiarla
let swipeX = null;
document.addEventListener('touchstart', (e) => { swipeX = e.target.closest?.('.hero') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (swipeX == null) return;
  const dx = e.changedTouches[0].clientX - swipeX; swipeX = null;
  if (Math.abs(dx) > 50) DH.skinstep(dx < 0 ? '1' : '-1');
}, { passive: true });
