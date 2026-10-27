# Reloj Ajedrez

Reloj de ajedrez inteligente para tinta electrónica (Bigme B7) con tablero Chessnut Go y botones ESP32. Está inspirado en el Chessnut Companion. Es una PWA (React + Vite + TypeScript) que corre en Chrome.

## Estado por fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Reloj en pantalla + Chessnut Go + botones por teclado | ✅ |
| 2 | Modo Lichess (IA, retos, lobby) | ✅ |
| 3 | Modo offline con Stockfish + service worker | ✅ |
| 4 | Firmware ESP32 | pendiente |
| 5 | Historial PGN, importación a Lichess, voz, servo | pendiente |

## Estructura

```
src/
  board/chessnut.ts   protocolo BLE: COPIA de Mastira frontend/src/store/useBoard.ts (cambios marcados [reloj])
  board/placement.ts  diff de casillas y deducción de jugada (copiado de StudyView) + promoción con peón
  clock/clock.ts      reloj puro: incremento Fischer, demora simple, pausa, sync con servidor
  game/session.ts     flujo: jugada pendiente → botón confirma → cambia reloj; fin de partida
  input/keys.ts       a = botón izquierdo · l = botón derecho · p = pausa/menú
  lichess/api.ts      cliente Board API: streams ndjson con watchdog, ritmos permitidos, enroque e1h1→e1g1
  lichess/auth.ts     login OAuth PKCE (sin secreto) o token personal
  lichess/online.ts   cuenta, stream de eventos, retos/IA/lobby, stream de la partida, reconexión
  engine/engine.ts    Stockfish 16 WASM un hilo en Web Worker; NNUE con respaldo a evaluación clásica; bloqueado en línea
  storage/games.ts    partidas guardadas en IndexedDB
  eink/eink.ts        limpieza negro→blanco, Wake Lock, pantalla completa, pitido
  ui/                 Setup, ClockScreen (dígitos escritos directo al DOM), overlays
```

### Cambios al módulo de Mastira (`board/chessnut.ts`)

El protocolo no se tocó: servicios, handshake, decodificación, LEDs y batería quedan igual. Solo cambió esto:

1. La clave de localStorage es `reloj.board.moveLatency`.
2. **Reconexión automática.** Si el tablero se cae, se reconecta al mismo dispositivo sin abrir el selector, con esperas de 1, 2, 4… hasta 10 s. Para lograrlo, el recorrido de servicios de `connect()` se movió tal cual a `setupGatt()` y el handshake a `afterConnect()`.
3. Nuevo estado `reconnecting`.
4. Las lecturas y escrituras de localStorage van dentro de `try`.

Debug del BLE: en la consola escribe `window.MASTIRA_BOARD_DEBUG = true`, igual que en Mastira.

## Desarrollo

```bash
cd reloj
npm install
npm run dev        # http://localhost:5180
npm run build      # genera dist/
```

En la PC, Web Bluetooth funciona en `localhost` con Chrome o Edge, y puedes probar con el teclado.

## Publicar en GitHub Pages

El código se desarrolla en `reloj/`, dentro del repo privado de Mastira. Se publica en un **repo público aparte**, `reloj-ajedrez`, que contiene solo esta carpeta. Así Mastira sigue siendo privado.

**Configuración inicial (una sola vez):**
1. En GitHub crea un repo **público** vacío, `reloj-ajedrez`, sin README.
2. En el repo nuevo ve a **Settings → Pages → Source: GitHub Actions**.
3. Desde la raíz del repo Mastira, registra el remoto:
   ```bash
   git remote add reloj https://github.com/<usuario>/reloj-ajedrez.git
   ```

**Publicar** (cada vez que quieras actualizar). Desde la raíz de Mastira, con los cambios ya en `main`:
```bash
git subtree push --prefix=reloj reloj main
```

El workflow `.github/workflows/pages.yml` se ejecuta en el repo nuevo y publica en `https://<usuario>.github.io/reloj-ajedrez/`.

## Configuración de la Bigme B7

1. **Instalar Chrome** desde Google Play. Web Bluetooth no funciona en el navegador propio de Bigme.
2. **Modo de refresco rápido para Chrome.** En el centro de control de Bigme (E-ink Center / ajustes de la app), asigna a Chrome el modo de refresco rápido, *Speed* o *A2*. Si los números se ven con fantasmas, prueba *Balanced* y activa la limpieza periódica de la app.
3. **Quitar Chrome de la optimización de batería.** Ve a Ajustes → Batería → Optimización de batería → Chrome → *No optimizar*. Si no, Android puede cortar el Bluetooth con la pantalla quieta.
4. **ESP32 (opcional).** Por defecto el reloj se pulsa tocando la pantalla de la tablet. Si eliges *Botones externos (ESP32)* en los ajustes, empareja el ESP32 en Ajustes → Bluetooth como teclado. Aparece como **"Reloj Ajedrez"**. Mientras no lo armes, sirve cualquier teclado Bluetooth.
5. **El Chessnut acepta una sola conexión BLE.** Cierra la app oficial de Chessnut y Mastira, y quita la app oficial de recientes, antes de conectar.
6. **No emparejes el Chessnut en Ajustes de Android.** Se conecta desde la app con el botón *Conectar tablero*.
7. Abre la URL de Pages en Chrome y elige ⋮ → **Agregar a pantalla principal**. Se abre a pantalla completa y en horizontal.
8. Activa la ubicación y los permisos de "Dispositivos cercanos" para Chrome. Android los exige para escanear BLE.

## Cómo probar la Fase 1 en la Bigme

**Cómo se pulsa el reloj** (en los ajustes):
- **En la pantalla de la tablet** (por defecto): cada jugador toca *su mitad* de la pantalla.
- **Botones externos (ESP32)**: los toques se desactivan para evitar pulsaciones accidentales. El panel *Esperando pulsación…* muestra en vivo cada botón recibido, para comprobar el emparejamiento.

El teclado (`A` / `L` / `P`) funciona en los dos modos.

**A. Solo reloj (sin tablero)**
1. Elige *Solo reloj* y el ritmo 1+0, luego *Comenzar partida*.
2. Toca cualquier mitad de la pantalla (o pulsa `A` o `L`). Arranca el reloj de las blancas.
3. Cada toque del lado en turno cambia el reloj de lado. Los toques del lado que no juega se ignoran.
4. Por debajo de 10 s aparecen décimas. Al llegar a 0 se muestra el resultado.
5. `P` pausa y abre el menú: reanudar, deshacer, limpiar, terminar.

**B. Dos jugadores con el Chessnut Go**
1. Pulsa *Conectar tablero*, elige el Chessnut en el selector y espera a que diga *Conectado · Batería N%*.
2. Pulsa *Comenzar partida*. Si las piezas no están en la posición inicial, la parte de abajo dice qué poner o quitar en cada casilla, el minitablero marca esas casillas y los LEDs del tablero se encienden en ellas.
3. Pulsa cualquier botón para arrancar.
4. Mueve 1.e4 en el tablero. Aparece *Pendiente — e4* y el reloj de las blancas sigue corriendo.
5. Toca la mitad de las blancas (o pulsa su botón). La jugada queda registrada y el reloj pasa a las negras.
6. Comprueba estos casos:
   - **Botón equivocado:** se ignora.
   - **Pulsar sin mover:** muestra el aviso "Primero mueve en el tablero".
   - **Pieza levantada o mal puesta:** "El tablero no coincide", con las casillas marcadas.
   - **Enroque:** mueve rey y torre, y luego pulsa.
   - **Captura al paso:** retira el peón capturado.
   - **Promoción:** si pones la dama real, se reconoce sola. Si dejas el peón en la 8ª fila, al pulsar aparece el selector de pieza.
7. Apaga el tablero a mitad de partida. El reloj se pausa solo y la app reconecta sola cuando lo vuelves a encender. Luego pulsa `P` para seguir.
8. Si una jugada se detecta antes de que termines de soltar la pieza, sube *Espera antes de leer la jugada* (por defecto 400 ms).

**C. Pantalla**
- La opción *Limpiar tras cada jugada* o *Limpiar cada N s* hace un flash negro→blanco. El botón *Limpiar* de la barra superior hace lo mismo a mano.
- La pantalla no debe apagarse durante la partida (Wake Lock).

## Cómo probar la Fase 2 (Lichess) en la Bigme

**1. Iniciar sesión** (una sola vez; el token queda guardado en la tablet)
- **Opción A, *Iniciar sesión con Lichess*:** te lleva a lichess.org. Autoriza y vuelves a la app ya conectado. Si la app está instalada en la pantalla principal, puede que la vuelta se abra en Chrome; cierra esa pestaña y abre de nuevo la app: la sesión ya está guardada.
- **Opción B, *Usar token personal*:** abre *Crear token en Lichess ↗*, que ya trae marcados los permisos `board:play` y `challenge:write`. Crea el token, cópialo y pégalo en la app.

Cuando la conexión está lista, el panel dice `TuUsuario · en línea`.

**2. Primera partida contra la IA**
1. Conecta el Chessnut y pon las piezas en la posición inicial.
2. Elige *Lichess (en línea)* → *IA de Lichess* → nivel 1 → color *Blancas* → ritmo **10+5** → *Jugar contra la IA*.
3. La partida empieza sola. Arriba aparecen los nombres: tú y "IA Lichess nivel 1".
4. Mueve en el tablero y toca tu lado del reloj (o pulsa tu botón). La jugada se envía a Lichess.
5. Cuando juega la IA:
   - Suena un pitido.
   - Abajo aparece *Juega el rival — reprodúcela en el tablero*, con la jugada en grande (por ejemplo "1… Cc6 b8→c6").
   - El minitablero marca las casillas y los LEDs del Chessnut se encienden en origen y destino.
6. Reproduce la jugada en el tablero. Hasta que el tablero coincida, la app no deja hacer tu siguiente jugada.
7. Abre lichess.org en otro dispositivo, si quieres comprobar que la partida es real.

**3. Qué más probar**
- **Menú (`P` o *☰ Menú*):**
  - Ofrecer tablas.
  - Rendirse (pide confirmación).
  - Abortar, si todavía no hay jugadas.
  - Salir: la partida sigue en Lichess; al volver aparece en *Partidas en curso → Continuar*.
- **Retar a un amigo o bot:** *Retar a usuario o bot* → escribe el nombre → *Retar a…*. El reto sigue abierto hasta que lo acepte, lo rechace o lo canceles.
- **Lobby:** *Buscar en el lobby* (solo rápidas y clásicas, por ejemplo 10+0 o 15+10).
- **Partida creada desde otra app:** si inicias una partida con tablero desde la app de Lichess, el reloj la detecta y entra solo.
- **Retos que te envían:** aparecen en *Retos recibidos*, con botones *Aceptar* y *Rechazar*.
- **Sin red:** apaga el Wi-Fi unos segundos. Arriba aparece *Lichess · reconectando…* y al volver la red se recupera la partida. Mientras tanto el reloj de Lichess sigue corriendo: el servidor manda.
- **Ritmos bloqueados:** bullet nunca se permite; blitz solo contra la IA o en retos. El botón se desactiva y la app explica el motivo.

**Reglas del modo en línea**
- El tiempo oficial lo lleva Lichess. La app sincroniza con cada actualización del servidor y cuenta hacia atrás entre una y otra.
- El menú no detiene el reloj, y no se puede deshacer una jugada (solo aceptar el deshacer que pida el rival).
- Si se desconecta el tablero, el reloj NO se pausa; solo suena un aviso.
- Durante una partida en línea el motor está bloqueado (`onlineLocked()`). El análisis solo existe para partidas offline (Fase 3).

## Cómo probar la Fase 3 (Stockfish sin internet) en la Bigme

**1. Preparar el modo avión** (una sola vez, con Wi-Fi)
1. Abre la app con conexión y espera un minuto. En segundo plano se descargan el motor y su red neuronal (unos 41 MB).
2. Entra en *Stockfish (sin internet)*. Cuando todo está guardado, el panel dice **"Listo para modo avión: el motor y su red neuronal están guardados en la tablet"**.
3. Si dice que la red aún se está descargando, espera un poco más con Wi-Fi.

**2. Partida contra Stockfish**
1. Activa el **modo avión** de la Bigme y deja encendido solo el Bluetooth.
2. Abre la app. Debe cargar igual que con internet.
3. Conecta el Chessnut y elige *Stockfish (sin internet)*.
4. Configura la partida:
   - **Fuerza:** *Por nivel* (0–20) o *Por Elo* (1320–3190).
   - **Color:** blancas, negras o al azar.
   - **Velocidad de respuesta:** *Rápido (1–2 s)* o *Administrando su reloj*. Con su reloj piensa más en ritmos largos.
   - **Ritmo:** cualquiera, incluido bullet; admite incremento y demora.
5. Pulsa *Comenzar contra Stockfish* y toca para empezar. Si Stockfish lleva blancas, juega primero.
6. Cuando juega Stockfish:
   - Suena un pitido.
   - Aparece su jugada en grande y se encienden los LEDs.
   - Reprodúcela en el tablero; después mueve tú y toca tu lado del reloj.
7. **Pausa (`P`):** detiene los dos relojes y también a Stockfish. Al reanudar, vuelve a pensar.
8. **Deshacer** (desde la pausa): retrocede hasta tu turno, quitando su jugada y la tuya. Regresa también las piezas en el tablero.

**3. Al terminar**
- **Analizar partida:**
  - Recorre las jugadas con ⏮ ◀ ▶ ⏭.
  - En cada posición ves la evaluación y la mejor jugada.
  - *Revisar errores de la partida* marca errores graves (??), errores (?) e imprecisiones (?!).
- **Partidas guardadas** (en Ajustes): todas las partidas con tablero, contra Stockfish o en Lichess se guardan solas. Desde ahí puedes copiar el PGN, analizar o borrar. La importación a Lichess llega en la Fase 5.

**Juego limpio**
- Durante una partida de Lichess, Stockfish y el análisis están bloqueados.
- El análisis también se bloquea mientras tengas partidas de Lichess abiertas, aunque hayas salido de ellas.

**Notas técnicas**
- La versión del motor es la de un solo hilo (GitHub Pages no permite los headers COOP/COEP del multihilo).
- La red NNUE se guarda en una caché aparte, `reloj-engine-sf16`. Al publicar versiones nuevas de la app no se vuelve a descargar.
- Si la red no está disponible, Stockfish se reinicia solo con la evaluación clásica, que es algo más débil, en lugar de quedarse colgado.
- Para ver la versión compilada con el service worker en la PC, ejecuta `npm run build`, luego `npm run preview` y abre `http://localhost:5181`.

### Probar desde la PC en la red local (opcional)

Web Bluetooth exige HTTPS o localhost. Para abrir en la Bigme el servidor de desarrollo de la PC (`http://IP-de-la-PC:5180`):

1. En Chrome de la Bigme abre `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
2. Agrega `http://IP-de-la-PC:5180`, actívalo y reinicia Chrome.
