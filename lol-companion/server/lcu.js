// Conexión con el cliente de LoL (LCU API). No es una API oficial documentada.
const fs = require('fs'), https = require('https'), path = require('path');
const WebSocket = require('ws'), EventEmitter = require('events'), { execFile } = require('child_process');

// Carpetas donde buscar el "lockfile". Puedes fijar la tuya con LOL_PATH.
const DIRS = [process.env.LOL_PATH, 'C:\\Riot Games\\League of Legends', 'D:\\Riot Games\\League of Legends',
  '/Applications/League of Legends.app/Contents/LoL'].filter(Boolean);

function readLockfile() {
  for (const d of DIRS) {
    try {
      const [, , port, password] = fs.readFileSync(path.join(d, 'lockfile'), 'utf8').split(':');
      return { port, password };
    } catch {}
  }
  return null;
}

// Plan B: leer puerto y clave del proceso del cliente (no depende de dónde esté instalado el juego).
function fromProcess() {
  return new Promise((ok) => {
    if (process.platform !== 'win32') return ok(null);
    const cmd = `(Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'").CommandLine`;
    execFile('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 8000 }, (e, out) => {
      const port = /--app-port=(\d+)/.exec(out || ''), pw = /--remoting-auth-token=([\w-]+)/.exec(out || '');
      ok(port && pw ? { port: port[1], password: pw[1] } : null);
    });
  });
}

class LCU extends EventEmitter {
  constructor() { super(); this.lock = null; this.ws = null; }
  auth() { return 'Basic ' + Buffer.from('riot:' + this.lock.password).toString('base64'); }

  request(method, url, body) {
    return new Promise((resolve, reject) => {
      if (!this.lock) return reject(new Error('El cliente de LoL está cerrado'));
      const data = body === undefined ? null : JSON.stringify(body);
      const req = https.request({
        host: '127.0.0.1', port: this.lock.port, path: url, method, rejectUnauthorized: false,
        headers: { Authorization: this.auth(), Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
      }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = buf ? JSON.parse(buf) : null; } catch { json = buf; }
          if (res.statusCode >= 400) reject(Object.assign(new Error(`LCU ${res.statusCode} ${url}`), { status: res.statusCode, body: json }));
          else resolve(json);
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // Live Client Data API: la abre el juego (no el cliente) en el puerto 2999 mientras hay partida.
  live(pathname) {
    return new Promise((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port: 2999, path: pathname, method: 'GET', rejectUnauthorized: false, timeout: 1500 }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.end();
    });
  }

  start() { this.tick(); setInterval(() => this.tick(), 3000); }

  async tick() {
    if (this.ws || this.busy) return;
    this.busy = true;
    const lock = readLockfile() || (await fromProcess());
    this.busy = false;
    if (this.ws) return;
    if (!lock) {
      if (!this.warned) { this.warned = true; console.log('Buscando el cliente de LoL… ábrelo e inicia sesión (la ventana con tu perfil y amigos, no solo el Riot Client).'); }
      return;
    }
    this.warned = false;
    this.lock = lock;
    const ws = new WebSocket(`wss://127.0.0.1:${lock.port}/`, { headers: { Authorization: this.auth() }, rejectUnauthorized: false });
    this.ws = ws;
    ws.on('open', () => { ws.send(JSON.stringify([5, 'OnJsonApiEvent'])); this.emit('connected'); });
    ws.on('message', (m) => {
      if (!m.length) return;
      try { const [op, , ev] = JSON.parse(m); if (op === 8) this.emit('event', ev); } catch {}
    });
    ws.on('close', () => { this.ws = null; this.lock = null; this.emit('disconnected'); });
    ws.on('error', (e) => { if (this.lastErr !== e.message) { this.lastErr = e.message; console.log('No pude conectar con el cliente:', e.message); } });
  }
}
module.exports = LCU;
