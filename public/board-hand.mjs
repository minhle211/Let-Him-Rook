export function boardSquare(point, color, previous = null) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  // Use the middle 80% of the camera so edge squares are comfortable to reach.
  const x = (point.x - 0.1) / 0.8, y = (point.y - 0.1) / 0.8;
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;
  if (previous !== null) {
    const row = color === 'white' ? 7 - Math.floor(previous / 8) : Math.floor(previous / 8);
    const col = color === 'white' ? previous % 8 : 7 - previous % 8;
    // Keep the current target through small movements across a square boundary.
    if (x * 8 >= col - 0.12 && x * 8 < col + 1.12 && y * 8 >= row - 0.12 && y * 8 < row + 1.12) return previous;
  }
  const row = Math.floor(y * 8), col = Math.floor(x * 8);
  return color === 'white' ? (7 - row) * 8 + col : row * 8 + 7 - col;
}
export class BoardHandController {
  hover = null;
  grab = null;
  cancel() { this.hover = null; this.grab = null; }
  sync(context) {
    if (!context.enabled || !context.canMove || (this.grab && (
      this.grab.revision !== context.revision || this.grab.roomId !== context.roomId || this.grab.color !== context.color
    ))) { this.cancel(); return false; }
    return true;
  }
  update(action, point, context) {
    if (action === 'cancel' || !this.sync(context)) { this.cancel(); return null; }
    if (action === 'hold') return null;
    // Freeze the target during release confirmation: opening the fingers moves the tip.
    if (action === 'end' && boardSquare(point, context.color) === null) this.hover = null;
    if (action !== 'end') this.hover = boardSquare(point, context.color, this.hover);
    if (action === 'start') {
      const destinations = context.legalMoves[this.hover];
      if (this.hover !== null && destinations?.length) {
        this.grab = { from: this.hover, revision: context.revision, roomId: context.roomId, color: context.color };
      }
    }
    if (action === 'end') {
      const grab = this.grab; this.grab = null;
      if (grab && context.legalMoves[grab.from]?.includes(this.hover)) {
        const move = { from: grab.from, to: this.hover, revision: grab.revision };
        this.hover = null;
        return move;
      }
    }
    return null;
  }
}
