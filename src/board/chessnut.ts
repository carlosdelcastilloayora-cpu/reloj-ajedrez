import { create } from 'zustand'

// COPIA de Mastira frontend/src/store/useBoard.ts (protocolo verificado con el Chessnut Go).
// Cambios respecto al original (marcados con "[reloj]"):
//   1. clave de localStorage 'reloj.board.moveLatency'
//   2. reconexión automática al GATT del mismo dispositivo si se cae (sin volver a abrir el selector)
//      → el recorrido de servicios de connect() se movió tal cual a setupGatt()
//   3. estado 'reconnecting'
// El protocolo (servicios, handshake, decodificación, LEDs, batería) NO se modificó.

// ── Protocolo BLE Chessnut (Air/Pro/Go/Evo comparten protocolo) ──
// Fuente: ecrucru/chessnut-connector y chessnutech/EasyLinkSDK.
const SERVICE = '1b7e8271-2877-41c3-b46e-cf057c562023'       // servicio de comandos/confirmación
const WRITE_CHAR = '1b7e8272-2877-41c3-b46e-cf057c562023'    // escritura (comandos, LEDs)
// El estado del tablero llega por OTRO servicio/característica (descubierto en ChessConnect):
// servicio 1b7e8261 → característica 1b7e8262. El Go solo emite ahí; 8273 son solo acks.
const ALL_SERVICES = [
  '1b7e8261-2877-41c3-b46e-cf057c562023',   // posición del tablero (char 1b7e8262)
  SERVICE,                                   // comandos/confirmación (8272 write, 8273 ack)
  '1b7e8281-2877-41c3-b46e-cf057c562023',
]

// piece_map: índice de nibble → letra FEN (espacio=vacío, minúscula=negras, mayúscula=blancas)
const PIECE = ' qkbpnRPrBNQK'
// Reordena los 32 bytes de datos (cada byte = 2 casillas) a orden a8..h1
const MAP = [5, 4, 3, 2, 9, 8, 7, 6, 13, 12, 11, 10, 17, 16, 15, 14,
  21, 20, 19, 18, 25, 24, 23, 22, 29, 28, 27, 26, 33, 32, 31, 30]
const START_CMD = Uint8Array.of(0x21, 0x01, 0x00)   // pide al tablero que emita la posición (realtime)
// Handshake de inicio que usa el conector de referencia: el Go necesita estas consultas
// (+ espera) antes de transmitir. Fuente: ecrucru/chessnut-connector.
const CMD_MICROCODE = Uint8Array.of(0x27, 0x01, 0x01)
const CMD_PROTOCOL = Uint8Array.of(0x27, 0x01, 0x00)
const CMD_BATTERY = Uint8Array.of(0x29, 0x01, 0x00)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Activa logs en consola del crudo BLE para diagnosticar el tablero (window.MASTIRA_BOARD_DEBUG = true)
function dbg(...args: any[]) {
  if (typeof window !== 'undefined' && (window as any).MASTIRA_BOARD_DEBUG) console.log('[board]', ...args)
}

// ── LEDs Chessnut ──
// Frame: [0x0a, 0x08, r8, r7, r6, r5, r4, r3, r2, r1]; en cada byte de rango el bit
// del archivo 'a' es 0x80 y el de 'h' es 0x01. Fuente: ecrucru/chessnut-connector.
function ledFrame(squares: string[]): Uint8Array {
  const rows = [0, 0, 0, 0, 0, 0, 0, 0]   // índice 0 = rango 8
  for (const sq of squares) {
    if (!sq || sq.length < 2) continue
    const file = sq.charCodeAt(0) - 97        // a=0 … h=7
    const rank = sq.charCodeAt(1) - 49        // '1'=0 … '8'=7
    if (file < 0 || file > 7 || rank < 0 || rank > 7) continue
    const row = 7 - rank                       // rango 8 → fila 0
    rows[row] |= 1 << (7 - file)
  }
  return Uint8Array.of(0x0a, 0x08, ...rows)
}

const LATENCY_KEY = 'reloj.board.moveLatency'   // [reloj]
const DEFAULT_LATENCY = 400

type Status = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'   // [reloj] +reconnecting

// [reloj] localStorage puede lanzar (modo privado, datos bloqueados)
function readLatency(): number {
  try { return Number(localStorage.getItem(LATENCY_KEY)) || DEFAULT_LATENCY } catch { return DEFAULT_LATENCY }
}

// ── Handles imperativos (fuera del store para no re-renderizar) ──
let _device: any = null
let _writeChar: any = null
let _timer: number | null = null
let _pending: string | null = null
let _moveHandler: ((placement: string) => void) | null = null
let _batteryTimer: number | null = null
let _manualDisconnect = false                  // [reloj] distingue desconexión pedida vs caída
let _reconnectTimer: number | null = null      // [reloj]
let _reconnectAttempt = 0                      // [reloj]

// Escribe al tablero usando la MISMA ruta que sí funciona para los LEDs
// (writeValueWithoutResponse). El Go ackea writeValue pero no activa el streaming.
function writeBoard(bytes: Uint8Array): Promise<void> {
  const wc: any = _writeChar
  if (!wc) return Promise.resolve()
  const p = wc.writeValueWithoutResponse ? wc.writeValueWithoutResponse(bytes) : wc.writeValue(bytes)
  return Promise.resolve(p).catch((e: any) => dbg('write error', e?.message))
}

// Secuencia de inicio que activa el streaming (consultas + espera + realtime)
async function initBoard(): Promise<void> {
  // El Go transmite la posición por 1b7e8262 sin comando alguno; estas consultas solo
  // despiertan/confirman y el realtime ayuda al Air (que emite por 8273).
  await writeBoard(CMD_MICROCODE); await sleep(120)
  await writeBoard(CMD_PROTOCOL);  await sleep(120)
  await writeBoard(CMD_BATTERY);   await sleep(120)
  await writeBoard(ledFrame([]));  await sleep(120)   // LEDs off
  await writeBoard(START_CMD)
}

// Decodifica la notificación del tablero a placement FEN (rango8/.../rango1)
function decodePlacement(dv: DataView): string {
  let s = ''
  for (let i = 0; i < 32; i++) {
    const p = dv.getUint8(MAP[i])
    s += PIECE[p >> 4] + PIECE[p & 15]
  }
  // s tiene 64 chars en orden a8,b8,..,h8,a7,..,h1 → comprimir a placement FEN
  const ranks: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = '', empty = 0
    for (let f = 0; f < 8; f++) {
      const ch = s[r * 8 + f]
      if (ch === ' ') empty++
      else { if (empty) { row += empty; empty = 0 } row += ch }
    }
    if (empty) row += empty
    ranks.push(row)
  }
  return ranks.join('/')
}

function onBoardNotify(event: Event) {
  const dv: DataView = (event.target as any).value
  if (!dv) return
  const src = (event.target as any).uuid?.slice(4, 8) ?? '????'   // 4 chars distintivos del UUID
  const hex: string[] = []
  for (let i = 0; i < dv.byteLength; i++) hex.push(dv.getUint8(i).toString(16).padStart(2, '0'))
  const packet = `[${src}] ${hex.join(' ')}`
  dbg('notify', dv.byteLength, 'bytes:', packet)
  const st = useBoard.getState()
  const t = new Date().toLocaleTimeString().split(' ')[0]
  const log = [`${t} ${packet}`, ...st.packetLog].slice(0, 15)
  useBoard.setState({ lastPacket: packet, packetCount: st.packetCount + 1, packetLog: log })
  // Batería: respuesta a 0x29 → cabecera [0x2a, 0x02], byte 2 = nivel %, byte 3 = cargando
  if (dv.byteLength >= 3 && dv.getUint8(0) === 0x2a && dv.getUint8(1) === 0x02) {
    useBoard.setState({ battery: dv.getUint8(2), charging: dv.byteLength > 3 && dv.getUint8(3) === 1 })
    return
  }
  if (dv.byteLength < 34) return
  if (dv.getUint8(0) !== 0x01 || dv.getUint8(1) !== 0x24) return   // cabecera [1, 36]
  const pl = decodePlacement(dv)
  // El Go emite la posición EN CONTINUO (varios paquetes/seg). Ignorar los idénticos:
  // si no, el debounce se reinicia con cada paquete y nunca dispara la jugada.
  if (pl === _pending) return
  _pending = pl
  useBoard.setState({ lastPlacement: pl })
  dbg('placement', pl)
  const latency = useBoard.getState().moveLatency
  if (_timer) clearTimeout(_timer)
  _timer = window.setTimeout(() => {
    _timer = null
    if (_pending && _moveHandler) _moveHandler(_pending)
  }, latency)
}

function onDisconnected() {
  if (_timer) { clearTimeout(_timer); _timer = null }
  if (_batteryTimer) { clearInterval(_batteryTimer); _batteryTimer = null }
  _writeChar = null
  // [reloj] caída inesperada → reintentar con el mismo dispositivo
  if (!_manualDisconnect && _device) {
    useBoard.setState({ status: 'reconnecting', battery: null, charging: false })
    scheduleReconnect()
    return
  }
  useBoard.setState({ status: 'disconnected', deviceName: null, battery: null, charging: false })
}

// [reloj] Recorre los TRES servicios y se suscribe (código movido tal cual desde connect())
async function setupGatt(device: any): Promise<string> {
  const server = await device.gatt.connect()
  // Recorrer los TRES servicios del Chessnut: la posición llega por 1b7e8261/8262,
  // los comandos/acks por 1b7e8271/8272-8273.
  const map: string[] = []
  const subscribed: string[] = []
  for (const su of ALL_SERVICES) {
    let svc: any
    try { svc = await server.getPrimaryService(su) } catch { continue }   // servicio ausente
    const chars = await svc.getCharacteristics()
    for (const ch of chars) {
      const p = ch.properties || {}
      const flags = (p.read ? 'R' : '') + (p.write ? 'W' : '') +
        (p.writeWithoutResponse ? 'w' : '') + (p.notify ? 'N' : '') + (p.indicate ? 'I' : '')
      map.push(`${ch.uuid.slice(4, 8)}:${flags}`)
      if (ch.uuid === WRITE_CHAR) _writeChar = ch
      if (p.notify || p.indicate) {
        try {
          await ch.startNotifications()
          ch.addEventListener('characteristicvaluechanged', onBoardNotify)
          subscribed.push(ch.uuid.slice(4, 8))
        } catch (e: any) { dbg('startNotifications fallo', ch.uuid, e?.message) }
      }
    }
  }
  dbg('características:', map.join('  '), '| notify:', subscribed.join(', '))
  return map.join('  ')
}

// [reloj] Tras conectar (o reconectar): handshake + sondeo de batería
function afterConnect() {
  // Handshake de inicio que sí activa el streaming en el Go (igual que el conector
  // de referencia): consultas + LEDs off + espera + comando de tiempo real.
  initBoard()
  // Consultar la batería periódicamente para mantener el indicador al día
  if (_batteryTimer) clearInterval(_batteryTimer)
  _batteryTimer = window.setInterval(() => writeBoard(CMD_BATTERY), 60000)
}

// [reloj] Reconexión con espera creciente (1 s, 2 s, 4 s … máx. 10 s), indefinida hasta
// reconectar o hasta que el usuario desconecte.
function scheduleReconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer)
  const wait = Math.min(10000, 1000 * 2 ** _reconnectAttempt)
  _reconnectAttempt++
  _reconnectTimer = window.setTimeout(async () => {
    _reconnectTimer = null
    if (_manualDisconnect || !_device) return
    try {
      dbg('reconectando, intento', _reconnectAttempt)
      const subscribed = await setupGatt(_device)
      _reconnectAttempt = 0
      _pending = null   // que la primera posición tras reconectar se entregue siempre
      useBoard.setState({ status: 'connected', error: null, subscribed })
      afterConnect()
    } catch (e: any) {
      dbg('reconexión fallida', e?.message)
      scheduleReconnect()
    }
  }, wait)
}

interface BoardStore {
  status: Status
  deviceName: string | null
  error: string | null
  moveLatency: number
  available: boolean
  lastPacket: string | null
  lastPlacement: string | null
  packetCount: number
  packetLog: string[]
  subscribed: string
  battery: number | null
  charging: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  setMoveLatency: (ms: number) => void
  setMoveHandler: (fn: ((placement: string) => void) | null) => void
  setLeds: (squares: string[]) => void
  requestRealtime: () => void
  sendRaw: (hex: string) => void
}

export const useBoard = create<BoardStore>((set, get) => ({
  status: 'disconnected',
  deviceName: null,
  error: null,
  moveLatency: readLatency(),   // [reloj]
  available: typeof navigator !== 'undefined' && !!(navigator as any).bluetooth,
  lastPacket: null,
  lastPlacement: null,
  packetCount: 0,
  packetLog: [],
  subscribed: '',
  battery: null,
  charging: false,

  connect: async () => {
    const bt = (navigator as any).bluetooth
    if (!bt) {
      set({ error: 'Web Bluetooth no está disponible. Usa Chrome o Edge.' })
      return
    }
    set({ status: 'connecting', error: null })
    try {
      const device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: ALL_SERVICES,
      })
      // [reloj] soltar un dispositivo anterior antes de usar el nuevo
      if (_device && _device !== device) {
        _manualDisconnect = true
        try { _device.removeEventListener('gattserverdisconnected', onDisconnected); _device.gatt?.disconnect() } catch { /* noop */ }
      }
      _manualDisconnect = false
      _reconnectAttempt = 0
      _pending = null
      _device = device
      device.addEventListener('gattserverdisconnected', onDisconnected)
      const subscribed = await setupGatt(device)   // [reloj] recorrido de servicios movido a setupGatt()
      set({ status: 'connected', deviceName: device.name || 'Chessnut', error: null, subscribed })
      afterConnect()                               // [reloj] handshake + batería movidos a afterConnect()
    } catch (e: any) {
      try { _device?.gatt?.disconnect() } catch { /* noop */ }
      _device = null; _writeChar = null
      // Cancelar el selector no es un error que mostrar
      const msg = /cancel/i.test(e?.message || '') ? null : (e?.message || 'No se pudo conectar al tablero')
      set({ status: 'disconnected', deviceName: null, error: msg })
    }
  },

  disconnect: async () => {
    _manualDisconnect = true                                        // [reloj] no reconectar
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    try { await writeBoard(ledFrame([])) } catch { /* noop */ }   // apagar LEDs
    try { _device?.gatt?.disconnect() } catch { /* noop */ }
    _device = null; _writeChar = null
    if (_timer) { clearTimeout(_timer); _timer = null }
    if (_batteryTimer) { clearInterval(_batteryTimer); _batteryTimer = null }
    set({ status: 'disconnected', deviceName: null, battery: null, charging: false })
  },

  setMoveLatency: (ms: number) => {
    const v = Math.max(0, Math.min(3000, Math.round(ms || 0)))
    try { localStorage.setItem(LATENCY_KEY, String(v)) } catch { /* noop */ }   // [reloj] try
    set({ moveLatency: v })
  },

  setMoveHandler: (fn) => { _moveHandler = fn },

  requestRealtime: () => {
    dbg('requestRealtime → handshake')
    initBoard()
  },

  // Envía bytes en hex (ej. "21 01 00") al tablero para sondear el protocolo
  sendRaw: (hex: string) => {
    const bytes = hex.trim().split(/[\s,]+/).filter(Boolean).map(h => parseInt(h, 16))
    if (bytes.some(isNaN) || !bytes.length) { dbg('sendRaw hex inválido', hex); return }
    dbg('sendRaw →', hex)
    writeBoard(Uint8Array.from(bytes))
  },

  setLeds: (squares) => {
    dbg('leds', squares.join(',') || '(off)')
    writeBoard(ledFrame(squares))
  },
}))
