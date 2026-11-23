# YuzuLOL (uso personal)

Segunda pantalla para League of Legends: cola, aceptar partida, selección de campeones, runas e historial desde el móvil.

## Cómo funciona
- `server/` corre en tu PC. Lee el `lockfile` del cliente de LoL, habla con la LCU (API local del cliente) y expone una API + una web al móvil.
- `public/` es la app del móvil (web/PWA). Los iconos salen de Data Dragon (CDN de Riot) y se cargan directo en el móvil.

## Requisitos
- Node.js 18 o superior en el PC.
- PC y móvil en la misma red Wi-Fi.

## Uso fácil (Windows)
Instala Node.js (nodejs.org) y haz doble clic en `iniciar.bat`. Instala lo necesario la primera vez y arranca el servidor.

## Crear un .exe
Con Node.js instalado, abre una terminal en la carpeta y ejecuta `npm install` y luego `npm run build`. Genera `dist/YuzuLOL.exe` (Electron): una ventana propia, sin navegador, que no necesita Node ni la carpeta del proyecto. Los dispositivos vinculados se guardan en `%APPDATA%\YuzuLOL`, así que no se pierden aunque muevas el .exe. Para probar sin compilar: `npm run app`.

## Uso
1. `npm install`
2. Abre el cliente de LoL y ejecuta `npm start`.
3. Escanea el QR de la consola con la cámara del móvil (o abre la dirección que se muestra y escribe el código de 6 dígitos).
4. Aprueba el dispositivo en la consola (`s`). Queda guardado en `devices.json`; la próxima vez entra solo.
5. Escribe `qr` + Enter en la consola para emparejar otro móvil.

Si LoL no está en `C:\Riot Games\League of Legends`, define `LOL_PATH` con tu carpeta (en la que está el archivo `lockfile`).
Para otro puerto: `PORT=9000 npm start`.

## Imágenes
Los iconos de líneas y las imágenes de los mapas son los originales del cliente y se cargan solos desde CommunityDragon (`raw.communitydragon.org`) cuando el móvil tiene internet. No hay que descargar nada. Si no cargan, se usan dibujos de respaldo que están en `public/img/`.

## Fuera de casa
Instala Tailscale en el PC y en el móvil y abre `http://IP-de-Tailscale:8080`. El tráfico va por HTTP simple, así que no lo expongas a internet sin VPN.

## Qué está hecho
Emparejamiento por QR/código, inicio con rango e historial, elegir modo y buscar cola, cancelar, aceptar/rechazar partida, lobby con líneas, y selección de campeón:
- Cuadrícula con filtros, bans y equipos en vivo. Banear y bloquear esperan la confirmación del cliente (hasta ~5 s, con reintentos) y, si falla, el aviso muestra el motivo.
- Prepick: tu campeón aparece al instante en tu ranura. Al elegir campeón se abre la vista de skins (como el cliente): splash grande, miniaturas de tus skins, flechas o deslizar.
- Runas: recomendadas por el propio juego para tu campeón y línea (tantas como páginas editables tengas), "Usar", "Cargar en mis páginas" y editor completo (árboles, runas, fragmentos, nombre y página de destino).
- Pantalla de carga con los splash de ambos equipos hasta que la partida empieza de verdad; entonces aparecen las tablas.
- Cambiar de página de runas, hechizos de invocador, invitar amigos, chromas no.

Pruebas del servidor: `node --test test/server.test.js`. Si algo falla en el cliente, la consola del servidor escribe líneas `[ban]`, `[pick]` y `[runas]` con el motivo.

## Qué falta
- Builds y estadísticas propias (las runas recomendadas son las que da el cliente).
- Chromas, tier list, builds de pros.
- Teamfight Tactics, iconos de la app y modo sin conexión (service worker).
- Aviso de no afiliación con Riot si algún día la publicas.

## Aviso
La LCU no es una API oficial y puede cambiar con los parches. Este proyecto no está afiliado a Riot Games.

## Para repartirlo a un amigo (sin instalar nada)
1. Sube esta carpeta a un repositorio de GitHub. En la pestaña **Actions** se compilan solos `YuzuLOL.exe` y `app-debug.apk` (también con "Run workflow").
2. Tu amigo, en su PC: abre `YuzuLOL.exe` (si Windows avisa, "Más información" > "Ejecutar de todas formas"; en el firewall, "Permitir acceso" en red privada). Se abre la ventana de YuzuLOL con el QR. No necesita Node.js.
3. En su móvil: instala el APK (permitir "orígenes desconocidos"), ábrelo, pulsa **Escanear QR** y escanea el QR del panel. Solo se hace una vez.
4. Desde entonces: abre el programa en el PC y la app en el móvil. Si cambia la IP del PC, la app vuelve a pedir el QR (pulsa "Generar nuevo QR" en el panel).

## Panel del PC
Al abrir `YuzuLOL.exe` se abre la ventana del programa: estado del cliente de LoL, tu invocador, el QR para vincular el móvil, el código de 6 dígitos y la lista de dispositivos vinculados (con botón para quitarlos). El panel solo funciona desde el propio PC. Deja el programa abierto (puedes minimizarlo). Con un móvil ya vinculado el QR no se muestra: solo sale si pulsas «¿Vincular otro móvil?».
