import { Chess, type Move } from 'chess.js'

// placementMap / diffSquares: COPIA de Mastira frontend/src/pages/StudyView.tsx (sin cambios).

// Expande un placement FEN (rango8/.../rango1) a un mapa casilla → pieza
export function placementMap(placement: string): Record<string, string> {
  const map: Record<string, string> = {}
  const ranks = placement.split('/')
  for (let r = 0; r < ranks.length && r < 8; r++) {
    const rankNum = 8 - r
    let file = 0
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') file += ch.charCodeAt(0) - 48
      else { map[String.fromCharCode(97 + file) + rankNum] = ch; file++ }
    }
  }
  return map
}

// Casillas donde dos placements difieren (pieza distinta, sobrante o faltante)
export function diffSquares(a: string, b: string): string[] {
  const ma = placementMap(a), mb = placementMap(b)
  const out: string[] = []
  for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
    const sq = String.fromCharCode(97 + f) + r
    if ((ma[sq] ?? '') !== (mb[sq] ?? '')) out.push(sq)
  }
  return out
}

export const placementOf = (fen: string) => fen.split(' ')[0]

// Deducción de jugada: misma lógica que StudyView.boardMoveRef — prueba cada jugada legal
// y devuelve la que produce exactamente el placement del tablero físico.
// Cubre enroque (rey+torre), captura al paso (peón capturado retirado) y promoción con la
// pieza real colocada (una dama en e8 ≠ una torre en e8 → placements distintos).
export function findMove(fen: string, placement: string): Move | null {
  const chess = new Chess(fen)
  for (const m of chess.moves({ verbose: true })) {
    const probe = new Chess(fen)
    probe.move(m)
    if (placementOf(probe.fen()) === placement) return m
  }
  return null
}

// Nuevo para el reloj: promoción dejando el PEÓN en la última fila (no hay pieza de repuesto).
// El tablero coincide con la promoción salvo en la casilla de destino, donde hay un peón
// propio. La pieza se elige luego en pantalla.
export function findPawnPromotion(fen: string, placement: string): { from: string; to: string } | null {
  const chess = new Chess(fen)
  const board = placementMap(placement)
  for (const m of chess.moves({ verbose: true })) {
    if (m.promotion !== 'q') continue
    const probe = new Chess(fen)
    probe.move(m)
    const d = diffSquares(placementOf(probe.fen()), placement)
    const pawn = m.color === 'w' ? 'P' : 'p'
    if (d.length === 1 && d[0] === m.to && board[m.to] === pawn) return { from: m.from, to: m.to }
  }
  return null
}

// Notación en español: R rey, D dama, T torre, A alfil, C caballo
const ES: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' }
export function sanEs(san: string): string {
  return san.replace(/[KQRBN]/g, c => ES[c])
}
