// Ventana propia de YuzuLOL: el panel se ve dentro del programa, sin abrir el navegador.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) app.quit();

let win;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // Los datos (dispositivos vinculados, imágenes) van a AppData\Roaming\YuzuLOL: se conservan aunque muevas el .exe
  process.env.YUZU_DATA = app.getPath('userData');
  process.env.NO_OPEN = '1';                       // que el servidor no abra el navegador
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1200, height: 860, minWidth: 900, minHeight: 640,
    backgroundColor: '#050B16', title: 'YuzuLOL', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Cualquier enlace externo se abre en el navegador del sistema; el panel nunca navega fuera
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  process.once('yuzu-ready', (port) => win.loadURL(`http://localhost:${port}/panel`));
  require('../server/index.js');
});

app.on('window-all-closed', () => app.quit());
