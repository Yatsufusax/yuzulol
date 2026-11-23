// Lógica de selección de campeones (separada de index.js para poder probarla sin el cliente de LoL).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (cs) => (cs?.actions || []).flat();
const errText = (e) => `${e.status || ''} ${e.body?.message || e.message || ''}`.trim();

// ¿El cliente ya dio por buena la acción?
function isDone(cs, id, type, championId) {
  if (!cs) return false;
  const a = flat(cs).find((x) => x.id === id);
  if (!a) return true;                       // la acción ya no está: la fase avanzó
  if (a.completed) return true;
  if (type === 'ban' && !a.isInProgress) {   // el ban aparece en la lista de bans y el turno terminó
    const bans = [...(cs.bans?.myTeamBans || []), ...(cs.bans?.theirTeamBans || [])];
    if (bans.includes(championId)) return true;
  }
  return false;
}

// Marca el campeón y confirma la acción (ban o pick).
// El servidor de Riot puede tardar más de 1 s en confirmar, así que se espera con reintentos
// en vez de comprobar una sola vez a los 400 ms (eso daba falsos errores).
async function lockAction(req, type, championId, { log = () => {}, wait = 1800, step = 150 } = {}) {
  const session = () => req('GET', '/lol-champ-select/v1/session').catch(() => null);
  const cs = await session();
  if (!cs) throw new Error('No hay selección de campeón activa');
  const a = flat(cs).find((x) => x.actorCellId === cs.localPlayerCellId && x.type === type && !x.completed && x.isInProgress);
  if (!a) throw new Error('Todavía no es tu turno');
  const url = `/lol-champ-select/v1/session/actions/${a.id}`;
  const errs = [];
  const call = async (label, method, u, body) => {
    try { await req(method, u, body); return true; }
    catch (e) { errs.push(`${label}: ${errText(e)}`); log(`[${type}] ${label} falló → ${errText(e)}`); return false; }
  };
  const waitDone = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await sleep(step);
      if (isDone(await session(), a.id, type, championId)) return true;
    }
    return false;
  };

  // 1) marcar el campeón
  if (a.championId !== championId) {
    if (!(await call('marcar campeón', 'PATCH', url, { championId })))
      throw new Error(`El cliente no aceptó ese campeón (${errs.at(-1)})`);
    await sleep(120);
  }
  // 2) confirmar: varios métodos, según la versión del cliente
  const methods = [
    ['confirmar (complete)', () => call('complete', 'POST', url + '/complete')],
    ['confirmar (completed:true)', () => call('completed:true', 'PATCH', url, { championId, completed: true })],
    ['confirmar (complete + datos)', () => call('complete+body', 'POST', url + '/complete', { championId, completed: true })],
  ];
  for (const [name, fn] of methods) {
    log(`[${type}] ${name}`);
    await fn();
    if (await waitDone(wait)) return { id: a.id };
  }
  throw new Error('El cliente no confirmó la acción. Inténtalo de nuevo.' + (errs.length ? ` (${errs.join(' · ')})` : ''));
}

// Prepick: marca el campeón en tu acción de pick aunque todavía no sea tu turno.
async function setIntent(req, cs, championId) {
  const a = flat(cs).find((x) => x.actorCellId === cs.localPlayerCellId && x.type === 'pick' && !x.completed);
  if (!a) throw new Error('Ya no puedes cambiar tu pick');
  await req('PATCH', `/lol-champ-select/v1/session/actions/${a.id}`, { championId });
}

module.exports = { lockAction, setIntent, isDone };
