# Reloj Ajedrez

Reloj de ajedrez inteligente para tinta electrónica (Bigme B7) con tablero Chessnut Go y botones ESP32. Está inspirado en el Chessnut Companion. Es una PWA (React + Vite + TypeScript) que corre en Chrome.

## Estado por fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Reloj en pantalla + Chessnut Go + botones por teclado | ✅ |
| 2 | Modo Lichess (IA, retos, lobby) | pendiente |
| 3 | Modo offline con Stockfish + service worker | pendiente |
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

1. Sube el repo a GitHub. En el plan gratuito, Pages solo funciona con repos públicos.
2. Ve a **Settings → Pages → Source: GitHub Actions**.
3. Cada push a `main` que toque `reloj/` publica en `https://<usuario>.github.io/<repo>/`, mediante el workflow `.github/workflows/reloj-pages.yml`. También puedes lanzarlo a mano desde Actions.

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

### Probar desde la PC en la red local (opcional)

Web Bluetooth exige HTTPS o localhost. Para abrir en la Bigme el servidor de desarrollo de la PC (`http://IP-de-la-PC:5180`):

1. En Chrome de la Bigme abre `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
2. Agrega `http://IP-de-la-PC:5180`, actívalo y reinicia Chrome.
