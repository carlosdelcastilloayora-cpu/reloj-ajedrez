// Partidas guardadas en la tablet (IndexedDB). Sirven para revisarlas, copiar el PGN y,
// en la Fase 5, importarlas a Lichess.

export interface SavedGame {
  id: number               // marca de tiempo de fin de partida
  date: string             // ISO
  source: 'board' | 'engine' | 'lichess'
  white: string
  black: string
  result: string
  reason: string
  timeControl: string
  pgn: string
  lichessUrl?: string
  imported?: boolean       // Fase 5: ya importada a Lichess
}

const DB = 'reloj-ajedrez', STORE = 'games'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }).finally(() => db.close())
}

export async function saveGame(g: SavedGame): Promise<void> {
  try { await tx('readwrite', s => s.put(g)) } catch (e) { console.warn('No se pudo guardar la partida', e) }
}

export async function listGames(): Promise<SavedGame[]> {
  try { return ((await tx('readonly', s => s.getAll())) as SavedGame[]).sort((a, b) => b.id - a.id) } catch { return [] }
}

export async function deleteGame(id: number): Promise<void> {
  try { await tx('readwrite', s => s.delete(id)) } catch { /* noop */ }
}
