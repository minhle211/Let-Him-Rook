import type { MatchSnapshot, PieceClass } from '@let-him-rook/shared';
import { Chess } from '../chess/chess.ts';

export interface AiProvider {
  explainPosition(snapshot: Readonly<MatchSnapshot>, signal: AbortSignal): Promise<string>;
}

export function defaultTacticalAdvice(snapshot: MatchSnapshot): string {
  if (snapshot.phase === 'active_duel' && snapshot.duelSnapshot) {
    const duel = snapshot.duelSnapshot;
    return `In 3D duel! Attacker (${duel.attacker.pieceClass}) has ${Math.round(duel.attacker.hp)} HP, defender (${duel.defender.pieceClass}) has ${Math.round(duel.defender.hp)} HP. Time remaining: ${Math.round(duel.remainingMs / 1000)}s. Dodge obstacles and fire signature abilities!`;
  }

  const chess = new Chess(snapshot.fen);
  const turn = snapshot.turn === 'w' ? 'White' : 'Black';
  const isCheck = chess.isCheck();

  if (isCheck) {
    return `⚠️ ${turn} is in check! Relocate the King, block the attack line, or initiate a counter-duel to resolve the check.`;
  }

  let wScore = 0;
  let bScore = 0;
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  const fenBoard = snapshot.fen.split(' ')[0];
  for (const ch of fenBoard) {
    if (ch >= 'A' && ch <= 'Z') {
      wScore += values[ch.toLowerCase()] || 0;
    } else if (ch >= 'a' && ch <= 'z') {
      bScore += values[ch] || 0;
    }
  }

  const diff = wScore - bScore;
  const leadStr =
    diff > 0
      ? `White leads material by +${diff}`
      : diff < 0
      ? `Black leads material by +${-diff}`
      : `Material is dead even`;

  return `${turn} to move. ${leadStr}. Prioritize piece coordination, control the center, and choose capture duels where your piece class holds an advantage.`;
}

export async function explainPosition(
  provider: AiProvider | null,
  snapshot: MatchSnapshot
): Promise<string> {
  if (!provider) {
    return defaultTacticalAdvice(snapshot);
  }

  const signal = AbortSignal.timeout(5000);
  try {
    return await Promise.race([
      provider.explainPosition(structuredClone(snapshot), signal),
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('AI request timed out')), {
          once: true,
        })
      ),
    ]);
  } catch {
    return defaultTacticalAdvice(snapshot);
  }
}
