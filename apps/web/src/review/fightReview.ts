import type { DuelEvent, MatchSnapshot, PieceClass, PlayerColor } from '@let-him-rook/shared';

export const FIGHT_JOURNAL_KEY = 'rook_fight_journal_v1';
const JOURNAL_LIMIT = 12;

export interface FightTally {
  hitsLanded: number;
  hitsTaken: number;
  damageLanded: number;
  damageTaken: number;
  parries: number;
  attacksParried: number;
  shotsFired: number;
  teleports: number;
  summons: number;
  obstacleHits: number;
  iceHitsTaken: number;
}

export interface FightEnd {
  roomId: string;
  square: string | null;
  localColor: PlayerColor;
  localClass: PieceClass;
  opponentClass: PieceClass;
  role: 'attacker' | 'defender';
  winner: PlayerColor | 'draw';
  reason: string;
  durationMs: number;
  localHp: number;
  opponentHp: number;
}

export interface FightRecord {
  id: string;
  at: number;
  roomId: string;
  square: string | null;
  localClass: PieceClass;
  opponentClass: PieceClass;
  role: 'attacker' | 'defender';
  result: 'win' | 'loss' | 'draw';
  reason: string;
  durationSec: number;
  localHp: number;
  opponentHp: number;
  hitsLanded: number;
  hitsTaken: number;
  parries: number;
  attacksParried: number;
  shotsFired: number;
  teleports: number;
  summons: number;
  obstacleHits: number;
  iceHitsTaken: number;
  drawbacks: string[];
  improvements: string[];
  plan: string[];
}

export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyTally(): FightTally {
  return {
    hitsLanded: 0,
    hitsTaken: 0,
    damageLanded: 0,
    damageTaken: 0,
    parries: 0,
    attacksParried: 0,
    shotsFired: 0,
    teleports: 0,
    summons: 0,
    obstacleHits: 0,
    iceHitsTaken: 0,
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Fold one duel-event batch into the running tally for the local player. */
export function noteDuelEvents(
  tally: FightTally,
  events: DuelEvent[],
  localColor: PlayerColor
): FightTally {
  const next = { ...tally };
  for (const event of events) {
    const data = event.data;
    if (event.type === 'melee_hit' || event.type === 'projectile_hit') {
      const onAlly = typeof data.targetAllyId === 'string';
      const fromAlly = typeof data.attackerId === 'string';
      const damage = num(data.damage);
      if (onAlly) continue;
      if (data.target === localColor) {
        next.hitsTaken += 1;
        next.damageTaken += damage;
        if (data.projectileType === 'bishop_ice_bolt') next.iceHitsTaken += 1;
      } else if (!fromAlly) {
        next.hitsLanded += 1;
        next.damageLanded += damage;
      }
    } else if (event.type === 'parry_blocked') {
      if (data.defender === localColor) next.parries += 1;
      else next.attacksParried += 1;
    } else if (event.type === 'projectile_spawn' && data.owner === localColor) {
      next.shotsFired += 1;
    } else if (event.type === 'teleport' && data.color === localColor) {
      next.teleports += 1;
    } else if (event.type === 'summon_ally' && data.owner === localColor) {
      next.summons += 1;
    } else if (event.type === 'obstacle_damage') {
      next.obstacleHits += 1;
    }
  }
  return next;
}

function pieceName(piece: PieceClass): string {
  return piece.charAt(0).toUpperCase() + piece.slice(1);
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'knockout':
      return 'knockout';
    case 'timeout_higher_hp':
      return 'time ran out';
    case 'duel_timeout_tie':
      return 'time ran out with equal HP';
    case 'mutual_knockout':
      return 'both fighters fell';
    default:
      return reason.replace(/_/g, ' ');
  }
}

function classFix(piece: PieceClass): string {
  switch (piece) {
    case 'pawn':
      return 'Hold a still open right palm to parry the next swing, then sweep the wrist once their attack is blocked.';
    case 'rook':
      return 'Extend your right arm to fire, and aim the third shot (the bomb) at the fighter rather than a glass or vase.';
    case 'knight':
      return 'Raise your right hand above the shoulder and chop down so the cleave teleports you into slash range.';
    case 'bishop':
      return 'Cock your right hand at the shoulder and thrust forward so the ice bolt lands before you walk in.';
    case 'queen':
      return 'Raise an open right palm to shoulder height and loose the three-orb volley before closing distance.';
    case 'king':
      return 'Hold a closed right fist at the center of your chest until the ally appears, then let it hit while you move.';
  }
}

function unusedAbility(tally: FightTally, piece: PieceClass): boolean {
  if (piece === 'knight') return tally.teleports === 0;
  if (piece === 'king') return tally.summons === 0;
  if (piece === 'pawn') return tally.hitsLanded === 0 && tally.attacksParried === 0;
  return tally.shotsFired === 0;
}

function coach(end: FightEnd, tally: FightTally, result: FightRecord['result']): {
  drawbacks: string[];
  improvements: string[];
  plan: string[];
} {
  const notes: { drawback: string; improvement: string }[] = [];
  const add = (drawback: string, improvement: string) => {
    if (notes.length < 3) notes.push({ drawback, improvement });
  };
  const name = pieceName(end.localClass);

  if (end.localClass === 'pawn' && tally.parries === 0 && tally.hitsTaken > 0) {
    add(
      `You took ${tally.hitsTaken} hit${tally.hitsTaken === 1 ? '' : 's'} and never parried.`,
      'Hold a still open right palm as they swing. The parry stops that hit, then sweep while they recover.'
    );
  }
  if (tally.attacksParried >= 2) {
    add(
      `They parried ${tally.attacksParried} of your attacks.`,
      'Do not swing into a held palm. Pause, let the parry drop, then attack.'
    );
  }
  if (tally.shotsFired >= 2 && tally.hitsLanded < tally.shotsFired && tally.obstacleHits >= 2) {
    add(
      `${tally.obstacleHits} shots hit table props, and only ${tally.hitsLanded} hit the fighter.`,
      'Step sideways until the glass or vase is not on the line, then fire.'
    );
  }
  if (tally.iceHitsTaken > 0) {
    add(
      `An ice bolt chilled you ${tally.iceHitsTaken} time${tally.iceHitsTaken === 1 ? '' : 's'}, which slows you and keeps dealing damage.`,
      'Sidestep the bolt. Do not run through the ice patch on the table.'
    );
  }
  if (unusedAbility(tally, end.localClass) && result !== 'win') {
    add(`You never got the ${name} ability out.`, classFix(end.localClass));
  }
  if (result === 'loss' && (end.reason === 'timeout_higher_hp' || end.reason === 'duel_timeout_tie')) {
    add(
      `Time ran out with you on ${end.localHp} HP and them on ${end.opponentHp} HP.`,
      'Open with your ability in the first few seconds. Circling for the whole 90 seconds hands the square to whoever pokes once.'
    );
  }
  if (result === 'win' && end.localHp < 30) {
    add(
      `You won the square with only ${end.localHp} HP left.`,
      'Next time, stop chasing once you are ahead. Make them walk into the next attack.'
    );
  }
  if (result === 'win' && tally.obstacleHits >= 3) {
    add(
      `You won, and still spent ${tally.obstacleHits} hits on props.`,
      'Clear the line of fire before the next shot so that damage lands on the fighter.'
    );
  }
  if (notes.length === 0 && result === 'loss' && end.reason === 'knockout') {
    add(
      `Knockout. You landed ${tally.hitsLanded} hit${tally.hitsLanded === 1 ? '' : 's'} and took ${tally.hitsTaken}.`,
      'Give ground after you land a hit, then use the ability again instead of standing in their range.'
    );
  }
  if (notes.length === 0 && result === 'win') {
    add(
      `No clear leak this fight. You landed ${tally.hitsLanded} hit${tally.hitsLanded === 1 ? '' : 's'} and finished on ${end.localHp} HP.`,
      classFix(end.localClass)
    );
  }
  if (notes.length === 0) {
    add(
      `The square went against you, ${end.localHp} HP to their ${end.opponentHp}.`,
      classFix(end.localClass)
    );
  }

  const open =
    end.role === 'attacker'
      ? `Attacking as ${name}: use the ability before you walk into ${pieceName(end.opponentClass)}.`
      : `Defending as ${name}: hold the square and make ${pieceName(end.opponentClass)} walk into your ability.`;
  const close =
    result === 'win'
      ? 'Next capture, repeat that first ability, then stop pressing once you are clearly ahead.'
      : result === 'draw'
        ? 'Next capture, commit to one ability in the first few seconds so the clock cannot tie the square.'
        : 'Next capture, back off once you are about 20 HP ahead, and do not fight with a prop between you and them.';

  return {
    drawbacks: notes.map(note => note.drawback),
    improvements: notes.map(note => note.improvement),
    plan: [open, notes[0].improvement, close],
  };
}

export function buildFightRecord(tally: FightTally, end: FightEnd, at = Date.now()): FightRecord {
  const result: FightRecord['result'] =
    end.winner === 'draw' ? 'draw' : end.winner === end.localColor ? 'win' : 'loss';
  const advice = coach(end, tally, result);
  return {
    id: `${end.roomId}-${at}`,
    at,
    roomId: end.roomId,
    square: end.square,
    localClass: end.localClass,
    opponentClass: end.opponentClass,
    role: end.role,
    result,
    reason: reasonLabel(end.reason),
    durationSec: Math.max(0, Math.round(end.durationMs / 1000)),
    localHp: end.localHp,
    opponentHp: end.opponentHp,
    hitsLanded: tally.hitsLanded,
    hitsTaken: tally.hitsTaken,
    parries: tally.parries,
    attacksParried: tally.attacksParried,
    shotsFired: tally.shotsFired,
    teleports: tally.teleports,
    summons: tally.summons,
    obstacleHits: tally.obstacleHits,
    iceHitsTaken: tally.iceHitsTaken,
    drawbacks: advice.drawbacks,
    improvements: advice.improvements,
    plan: advice.plan,
  };
}

export function fightEndFromSnapshot(snapshot: MatchSnapshot, localColor: PlayerColor): FightEnd | null {
  const duel = snapshot.duelSnapshot;
  if (!duel) return null;
  const attacking = duel.attacker.color === localColor;
  const local = attacking ? duel.attacker : duel.defender;
  const opponent = attacking ? duel.defender : duel.attacker;
  return {
    roomId: snapshot.roomId,
    square: snapshot.pendingCapture?.to ?? null,
    localColor,
    localClass: local.pieceClass,
    opponentClass: opponent.pieceClass,
    role: attacking ? 'attacker' : 'defender',
    winner: duel.winner ?? 'draw',
    reason: duel.resolutionReason ?? 'finished',
    durationMs: duel.elapsedMs,
    localHp: Math.max(0, Math.round(local.hp)),
    opponentHp: Math.max(0, Math.round(opponent.hp)),
  };
}

function journalStorage(): JournalStorage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is FightRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as FightRecord;
  return (
    typeof record.id === 'string' &&
    (record.result === 'win' || record.result === 'loss' || record.result === 'draw') &&
    Array.isArray(record.drawbacks) &&
    Array.isArray(record.improvements) &&
    Array.isArray(record.plan)
  );
}

export function loadJournal(storage: JournalStorage | undefined = journalStorage()): FightRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(FIGHT_JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).slice(0, JOURNAL_LIMIT);
  } catch {
    return [];
  }
}

export function saveJournal(
  records: FightRecord[],
  storage: JournalStorage | undefined = journalStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(FIGHT_JOURNAL_KEY, JSON.stringify(records.slice(0, JOURNAL_LIMIT)));
  } catch {
    // A full or blocked browser store should not break the match.
  }
}
