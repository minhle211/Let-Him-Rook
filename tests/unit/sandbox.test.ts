import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setPieceOnSquare,
  removePieceFromSquare,
  freeMovePiece,
  createInitialFen,
  getPieceAt,
} from '../../apps/server/src/chess/chessEngine.ts';
import {
  parseClientMessage,
  createDefaultSandboxConfig,
  FIGHTER_MAX_HP,
} from '@let-him-rook/shared';
import {
  createDuel,
  applyFighterDamage,
  applyMovementIntent,
  applyAbilityIntent,
  stepDuel,
  resetDuelSimulation,
  respawnObstacles,
} from '../../apps/server/src/combat/duelSimulator.ts';
import { BotController } from '../../apps/server/src/match/botController.ts';
import { MatchMachine } from '../../apps/server/src/match/matchMachine.ts';

// -----------------------------------------------------------------------------
// 1. Chess Engine Direct Board Editing Helpers
// -----------------------------------------------------------------------------
test('Chess Engine Sandbox: setPieceOnSquare places and replaces pieces correctly', () => {
  const initialFen = createInitialFen();

  // Place a White Queen on e4
  const fenWithQueen = setPieceOnSquare(initialFen, 'e4', 'queen', 'w');
  const queenPiece = getPieceAt(fenWithQueen, 'e4');
  assert.deepEqual(queenPiece, { color: 'w', pieceClass: 'queen' });

  // Replace Black Pawn on e7 with a Black Knight
  const fenWithKnight = setPieceOnSquare(fenWithQueen, 'e7', 'knight', 'b');
  const knightPiece = getPieceAt(fenWithKnight, 'e7');
  assert.deepEqual(knightPiece, { color: 'b', pieceClass: 'knight' });

  // Place White King replacing initial King at e1
  const fenNewKing = setPieceOnSquare(initialFen, 'e1', 'king', 'w');
  assert.deepEqual(getPieceAt(fenNewKing, 'e1'), { color: 'w', pieceClass: 'king' });
});

test('Chess Engine Sandbox: removePieceFromSquare removes piece and handles empty squares', () => {
  const initialFen = createInitialFen();

  // e2 has White Pawn initially
  assert.ok(getPieceAt(initialFen, 'e2') !== null);
  const fenRemoved = removePieceFromSquare(initialFen, 'e2');
  assert.equal(getPieceAt(fenRemoved, 'e2'), null);

  // Removing from an already empty square does not throw and leaves square empty
  const fenEmptyAgain = removePieceFromSquare(fenRemoved, 'e2');
  assert.equal(getPieceAt(fenEmptyAgain, 'e2'), null);
});

test('Chess Engine Sandbox: freeMovePiece moves piece arbitrarily without chess legality checks', () => {
  const initialFen = createInitialFen();

  // Move White Pawn from e2 to e5 directly (illegal in standard chess from start)
  const movedFen = freeMovePiece(initialFen, 'e2', 'e5');
  assert.equal(getPieceAt(movedFen, 'e2'), null);
  assert.deepEqual(getPieceAt(movedFen, 'e5'), { color: 'w', pieceClass: 'pawn' });

  // Move White Pawn to occupied square e7 (overwrites Black pawn directly)
  const capturedFen = freeMovePiece(movedFen, 'e5', 'e7');
  assert.equal(getPieceAt(capturedFen, 'e5'), null);
  assert.deepEqual(getPieceAt(capturedFen, 'e7'), { color: 'w', pieceClass: 'pawn' });

  // Moving from an empty square leaves FEN unchanged
  const noopFen = freeMovePiece(initialFen, 'e4', 'e5');
  assert.equal(noopFen, initialFen);
});

// -----------------------------------------------------------------------------
// 2. Client Protocol Parsing & Validation for Sandbox Messages
// -----------------------------------------------------------------------------
test('Protocol Parser Sandbox: validates sandbox_set_fen correctly', () => {
  const validFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const parsed = parseClientMessage(JSON.stringify({ type: 'sandbox_set_fen', fen: validFen }));
  assert.deepEqual(parsed, { type: 'sandbox_set_fen', fen: validFen });

  assert.throws(() => parseClientMessage(JSON.stringify({ type: 'sandbox_set_fen', fen: '' })), /Invalid FEN string/);
  assert.throws(() => parseClientMessage(JSON.stringify({ type: 'sandbox_set_fen', fen: 123 })), /Invalid FEN string/);
});

test('Protocol Parser Sandbox: validates sandbox_place_piece correctly', () => {
  const parsedPlace = parseClientMessage(
    JSON.stringify({
      type: 'sandbox_place_piece',
      square: 'e4',
      pieceClass: 'queen',
      pieceColor: 'w',
    })
  );
  assert.deepEqual(parsedPlace, {
    type: 'sandbox_place_piece',
    square: 'e4',
    pieceClass: 'queen',
    pieceColor: 'w',
  });

  // Null pieceClass for eraser
  const parsedEraser = parseClientMessage(
    JSON.stringify({
      type: 'sandbox_place_piece',
      square: 'e4',
      pieceClass: null,
    })
  );
  assert.deepEqual(parsedEraser, {
    type: 'sandbox_place_piece',
    square: 'e4',
    pieceClass: null,
    pieceColor: undefined,
  });

  // Rejections
  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_place_piece', square: 'z9', pieceClass: 'pawn' })),
    /Invalid square/
  );
  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_place_piece', square: 'e4', pieceClass: 'dragon' })),
    /Invalid pieceClass/
  );
  assert.throws(
    () =>
      parseClientMessage(
        JSON.stringify({ type: 'sandbox_place_piece', square: 'e4', pieceClass: 'pawn', pieceColor: 'green' })
      ),
    /Invalid pieceColor/
  );
});

test('Protocol Parser Sandbox: validates sandbox_free_move correctly', () => {
  const parsed = parseClientMessage(JSON.stringify({ type: 'sandbox_free_move', from: 'e2', to: 'e5' }));
  assert.deepEqual(parsed, { type: 'sandbox_free_move', from: 'e2', to: 'e5' });

  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_free_move', from: 'bad', to: 'e5' })),
    /Invalid from square/
  );
  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_free_move', from: 'e2', to: 'bad' })),
    /Invalid to square/
  );
});

test('Protocol Parser Sandbox: validates sandbox_start_duel correctly', () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      type: 'sandbox_start_duel',
      attackerClass: 'knight',
      defenderClass: 'rook',
      aiBehavior: 'passive',
      standalone: true,
    })
  );
  assert.deepEqual(parsed, {
    type: 'sandbox_start_duel',
    attackerClass: 'knight',
    defenderClass: 'rook',
    aiBehavior: 'passive',
    standalone: true,
  });

  assert.throws(
    () =>
      parseClientMessage(
        JSON.stringify({ type: 'sandbox_start_duel', attackerClass: 'invalid', defenderClass: 'pawn' })
      ),
    /Invalid attackerClass/
  );
  assert.throws(
    () =>
      parseClientMessage(
        JSON.stringify({ type: 'sandbox_start_duel', attackerClass: 'pawn', defenderClass: 'invalid' })
      ),
    /Invalid defenderClass/
  );
  assert.throws(
    () =>
      parseClientMessage(
        JSON.stringify({ type: 'sandbox_start_duel', attackerClass: 'pawn', defenderClass: 'pawn', aiBehavior: 'berserk' })
      ),
    /Invalid aiBehavior/
  );
});

test('Protocol Parser Sandbox: validates sandbox_update_config correctly', () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      type: 'sandbox_update_config',
      config: {
        godMode: true,
        noCooldowns: true,
        moveSpeedMultiplier: 1.5,
        aiBehavior: 'dummy',
      },
    })
  );
  assert.deepEqual(parsed, {
    type: 'sandbox_update_config',
    config: {
      godMode: true,
      noCooldowns: true,
      moveSpeedMultiplier: 1.5,
      aiBehavior: 'dummy',
    },
  });

  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_update_config', config: 'not-an-object' })),
    /config must be an object/
  );
  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_update_config', config: { godMode: 'yes' } })),
    /godMode must be boolean/
  );
  assert.throws(
    () =>
      parseClientMessage(
        JSON.stringify({ type: 'sandbox_update_config', config: { moveSpeedMultiplier: 'fast' } })
      ),
    /moveSpeedMultiplier must be a number/
  );
  assert.throws(
    () => parseClientMessage(JSON.stringify({ type: 'sandbox_update_config', config: { aiBehavior: 'unknown' } })),
    /Invalid aiBehavior/
  );
});

test('Protocol Parser Sandbox: validates sandbox_reset_duel, sandbox_exit_duel, and sandbox_respawn_obstacles', () => {
  assert.deepEqual(
    parseClientMessage(JSON.stringify({ type: 'sandbox_reset_duel' })),
    { type: 'sandbox_reset_duel' }
  );
  assert.deepEqual(
    parseClientMessage(JSON.stringify({ type: 'sandbox_exit_duel' })),
    { type: 'sandbox_exit_duel' }
  );
  assert.deepEqual(
    parseClientMessage(JSON.stringify({ type: 'sandbox_respawn_obstacles' })),
    { type: 'sandbox_respawn_obstacles' }
  );
});

// -----------------------------------------------------------------------------
// 3. Duel Simulator Sandbox Mechanics
// -----------------------------------------------------------------------------
test('Duel Simulator Sandbox: godMode protects White fighter from damage', () => {
  const fen = createInitialFen();
  const duel = createDuel(fen, {
    from: 'e2',
    to: 'e7',
    attackerColor: 'w',
    attackerClass: 'knight',
    defenderClass: 'rook',
  });

  const whiteFighter = duel.attacker; // color 'w'
  const blackFighter = duel.defender; // color 'b'

  assert.equal(whiteFighter.hp, FIGHTER_MAX_HP);
  const hpAfterHitWithGodMode = applyFighterDamage(whiteFighter, 40, true);
  assert.equal(hpAfterHitWithGodMode, FIGHTER_MAX_HP);
  assert.equal(whiteFighter.hp, FIGHTER_MAX_HP);

  // Black fighter still takes damage when godMode is true
  assert.equal(blackFighter.hp, FIGHTER_MAX_HP);
  const blackHpAfterHit = applyFighterDamage(blackFighter, 30, true);
  assert.equal(blackHpAfterHit, FIGHTER_MAX_HP - 30);
  assert.equal(blackFighter.hp, FIGHTER_MAX_HP - 30);

  // When godMode is false, White takes damage normally
  const whiteHpWithoutGodMode = applyFighterDamage(whiteFighter, 25, false);
  assert.equal(whiteHpWithoutGodMode, FIGHTER_MAX_HP - 25);
});

test('Duel Simulator Sandbox: moveSpeedMultiplier scales fighter movement speed', () => {
  const fen = createInitialFen();
  const duelBase = createDuel(fen, {
    from: 'e2',
    to: 'e7',
    attackerColor: 'w',
    attackerClass: 'pawn',
    defenderClass: 'pawn',
  });
  duelBase.sandboxOptions = { moveSpeedMultiplier: 1.0 };
  applyMovementIntent(duelBase, 'w', 0, -1, 100);
  const baseSpeed = Math.hypot(duelBase.attacker.vx, duelBase.attacker.vz);

  const duelFast = createDuel(fen, {
    from: 'e2',
    to: 'e7',
    attackerColor: 'w',
    attackerClass: 'pawn',
    defenderClass: 'pawn',
  });
  duelFast.sandboxOptions = { moveSpeedMultiplier: 2.0 };
  applyMovementIntent(duelFast, 'w', 0, -1, 100);
  const fastSpeed = Math.hypot(duelFast.attacker.vx, duelFast.attacker.vz);

  assert.ok(
    Math.abs(fastSpeed - baseSpeed * 2.0) < 0.01,
    `Fast speed ${fastSpeed} should be 2x base speed ${baseSpeed}`
  );
});

test('Duel Simulator Sandbox: noCooldowns allows immediate re-triggering of abilities', () => {
  const fen = createInitialFen();
  const duel = createDuel(fen, {
    from: 'e2',
    to: 'e7',
    attackerColor: 'w',
    attackerClass: 'knight',
    defenderClass: 'rook',
  });
  duel.sandboxOptions = { noCooldowns: true };

  // Trigger primary ability (knight cleave)
  applyAbilityIntent(duel, 'w', 'primary', undefined, 100);
  assert.equal(duel.attacker.cooldowns.primary, 0);

  // Step duel simulation: cooldown should remain 0
  stepDuel(duel, 150);
  assert.equal(duel.attacker.cooldowns.primary, 0);
  assert.equal(duel.attacker.cooldowns.secondary, 0);
});

test('Duel Simulator Sandbox: resetDuelSimulation and respawnObstacles restore state', () => {
  const fen = createInitialFen();
  const duel = createDuel(fen, {
    from: 'e2',
    to: 'e7',
    attackerColor: 'w',
    attackerClass: 'knight',
    defenderClass: 'rook',
  });

  // Damage fighters and obstacles
  duel.attacker.hp = 10;
  duel.defender.hp = 20;
  duel.obstacles[0].hp = 1;
  duel.iceHazards.push({ id: 'h1', x: 0, z: 0, radius: 1.5, expiresAt: 99999 });

  // Respawn obstacles clears hazards and restores obstacle health
  respawnObstacles(duel);
  assert.equal(duel.iceHazards.length, 0);
  assert.equal(duel.obstacles[0].hp, duel.obstacles[0].maxHp);

  // Reset duel simulation restores fighters and time
  resetDuelSimulation(duel, 2000);
  assert.equal(duel.attacker.hp, FIGHTER_MAX_HP);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP);
  assert.equal(duel.isFinished, false);
  assert.equal(duel.iceHazards.length, 0);
  assert.equal(duel.projectiles.length, 0);
});

// -----------------------------------------------------------------------------
// 4. Bot Controller AI Behavior Modes in Sandbox
// -----------------------------------------------------------------------------
test('Bot Controller Sandbox: does not auto-play moves during chess turns', () => {
  const match = new MatchMachine('sb_bot_test', 'sandbox');
  match.setPlayerConnected('w', true);
  const bot = new BotController();

  assert.equal(match.turn, 'w');
  // Switch turn to Black via legal move
  const res = match.handleChessMove('w', 'e2', 'e4', undefined, 'act_1', 100);
  assert.equal(res.accepted, true);
  assert.equal(match.turn, 'b');

  // Bot tick at later time should NOT execute Black move in sandbox
  bot.tick(match, 1000);
  bot.tick(match, 2000);
  assert.equal(match.turn, 'b');
  assert.equal(match.fen.includes(' w '), false);
});

test('Bot Controller Sandbox: AI behaviors (dummy, passive, aggressive) in duels', () => {
  const match = new MatchMachine('sb_duel_bot', 'sandbox');
  match.setPlayerConnected('w', true);
  const bot = new BotController();

  // 1. Dummy Behavior: zero movement and no abilities
  match.handleSandboxStartDuel('pawn', 'pawn', 'dummy', true, 1000);
  assert.ok(match.duel);
  bot.tick(match, 1050);
  assert.equal(match.duel.defender.vx, 0);
  assert.equal(match.duel.defender.vz, 0);

  // 2. Passive Behavior: movement occurs but zero abilities are triggered
  match.handleSandboxUpdateConfig({ aiBehavior: 'passive' });
  match.duel.defender.x = 4.0;
  match.duel.defender.z = 4.0;
  match.duel.attacker.x = 0;
  match.duel.attacker.z = 0;

  bot.tick(match, 1100);
  const passiveSpeed = Math.hypot(match.duel.defender.vx, match.duel.defender.vz);
  assert.ok(passiveSpeed > 0, 'Passive AI should move');
  assert.equal(match.duel.defender.cooldowns.primary, 0);

  // 3. Aggressive Behavior: approaches and triggers abilities
  match.handleSandboxUpdateConfig({ aiBehavior: 'aggressive' });
  // Place bot within melee range
  match.duel.defender.x = 1.0;
  match.duel.defender.z = 0;
  match.duel.attacker.x = 0;
  match.duel.attacker.z = 0;

  bot.tick(match, 2000);
  assert.ok(
    match.duel.events.length > 0 || match.duel.defender.cooldowns.primary > 0,
    'Aggressive AI should trigger ability or generate duel event'
  );
});

// -----------------------------------------------------------------------------
// 5. Match Machine Sandbox Lifecycle & Standalone Duel Holding
// -----------------------------------------------------------------------------
test('Match Machine Sandbox: initializes with sandboxConfig and calibrated players', () => {
  const match = new MatchMachine('sb_init', 'sandbox');
  match.setPlayerConnected('w', true);
  const snapshot = match.getSnapshot();

  assert.equal(snapshot.mode, 'sandbox');
  assert.equal(snapshot.phase, 'chess_turn');
  assert.ok(snapshot.players.w.calibrated);
  assert.ok(snapshot.players.b.calibrated);
  assert.ok(snapshot.sandboxConfig);
  assert.equal(snapshot.sandboxConfig?.rulesEnforced, true);
  assert.equal(snapshot.sandboxConfig?.godMode, false);
});

test('Match Machine Sandbox: rulesEnforced toggle allows bypassing chess legality', () => {
  const match = new MatchMachine('sb_rules', 'sandbox');
  match.setPlayerConnected('w', true);
  assert.equal(match.sandboxConfig.rulesEnforced, true);

  // Standard illegal move is rejected when rulesEnforced is true
  const illegalRes = match.handleChessMove('w', 'e2', 'e5', undefined, 'm1');
  assert.equal(illegalRes.accepted, false);

  // Disable rulesEnforced
  match.handleSandboxUpdateConfig({ rulesEnforced: false });
  assert.equal(match.sandboxConfig.rulesEnforced, false);

  // Now illegal move is applied via freeMovePiece under the hood
  const legalNow = match.handleChessMove('w', 'e2', 'e5', undefined, 'm2');
  assert.equal(legalNow.accepted, true);
  assert.deepEqual(getPieceAt(match.fen, 'e5'), { color: 'w', pieceClass: 'pawn' });
  assert.equal(getPieceAt(match.fen, 'e2'), null);
});

test('Match Machine Sandbox: standalone duel preserves chess FEN upon completion and exit', () => {
  const match = new MatchMachine('sb_standalone', 'sandbox');
  match.setPlayerConnected('w', true);
  const originalFen = match.fen;

  // Start standalone duel: Queen vs Rook
  match.handleSandboxStartDuel('queen', 'rook', 'dummy', true, 1000);
  assert.equal(match.phase, 'active_duel');
  assert.ok(match.duel);
  assert.equal(match.sandboxConfig.isStandaloneDuel, true);

  // Kill defender
  match.duel.defender.hp = 0;
  match.duel.isFinished = true;
  match.duel.winner = 'w';

  // Tick machine into duel_result
  match.tick(1100);
  assert.equal(match.phase, 'duel_result');

  // Tick past result duration: standalone duels HOLD in duel_result without mutating FEN
  match.tick(10000);
  assert.equal(match.phase, 'duel_result');
  assert.equal(match.fen, originalFen);

  // Reset duel returns to active_duel
  match.handleSandboxResetDuel(11000);
  assert.equal(match.phase, 'active_duel');
  assert.equal(match.duel.attacker.hp, FIGHTER_MAX_HP);
  assert.equal(match.duel.defender.hp, FIGHTER_MAX_HP);

  // Exit duel returns cleanly to chess_turn with original board FEN preserved
  match.handleSandboxExitDuel();
  assert.equal(match.phase, 'chess_turn');
  assert.equal(match.duel, null);
  assert.equal(match.fen, originalFen);
});

test('Match Machine Sandbox: handleSandboxRespawnObstacles restores obstacle state during active duel', () => {
  const match = new MatchMachine('sb_obs', 'sandbox');
  match.setPlayerConnected('w', true);
  match.handleSandboxStartDuel('pawn', 'pawn', 'dummy', true, 1000);
  assert.ok(match.duel);

  // Damage obstacle and add ice hazard
  match.duel.obstacles[0].hp = 0;
  match.duel.obstacles[0].hitsRemaining = 0;
  match.duel.iceHazards.push({ id: 'ice_1', x: 0, z: 0, radius: 1.5, expiresAt: 99999 });

  const res = match.handleSandboxRespawnObstacles();
  assert.equal(res, true);
  assert.equal(match.duel.obstacles[0].hp, match.duel.obstacles[0].maxHp);
  assert.equal(match.duel.iceHazards.length, 0);
});

test('Match Machine Sandbox: free placement capture duel resolves and moves piece without throwing', () => {
  const match = new MatchMachine('sb_free_capture', 'sandbox');
  match.setPlayerConnected('w', true);
  match.handleSandboxUpdateConfig({ rulesEnforced: false });

  // White Knight at b1 captures Black Pawn at d7 (illegal chess move, allowed in free placement)
  const moveRes = match.handleChessMove('w', 'b1', 'd7', undefined, 'act_free_1', 1000);
  assert.equal(moveRes.accepted, true);
  assert.equal(match.phase, 'duel_intro');
  assert.ok(match.duel);

  // Transition to active_duel
  match.tick(3000);
  assert.equal(match.phase, 'active_duel');

  // Attacker wins
  match.duel.defender.hp = 0;
  match.duel.isFinished = true;
  match.duel.winner = 'w';

  // Tick past duel_result duration
  match.tick(3100);
  assert.equal(match.phase, 'duel_result');
  match.tick(10000);

  // Board should have knight at d7 and b1 empty, without server throwing exception
  assert.equal(match.phase, 'chess_turn');
  assert.equal(getPieceAt(match.fen, 'b1'), null);
  assert.deepEqual(getPieceAt(match.fen, 'd7'), { color: 'w', pieceClass: 'knight' });
});

test('Match Machine Sandbox: staged board duel resolves without legal chess move exception', () => {
  const match = new MatchMachine('sb_staged_duel', 'sandbox');
  match.setPlayerConnected('w', true);

  // Stage duel between queen and rook with standalone = false
  match.handleSandboxStartDuel('queen', 'rook', 'dummy', false, 1000);
  assert.equal(match.phase, 'active_duel');
  assert.ok(match.duel);

  // Finish duel
  match.duel.defender.hp = 0;
  match.duel.isFinished = true;
  match.duel.winner = 'w';

  match.tick(1100);
  assert.equal(match.phase, 'duel_result');

  // Must not throw "Failed to commit legal capture"
  match.tick(10000);
  assert.equal(match.phase, 'chess_turn');
});

test('Match Machine Sandbox: recovers cleanly from match_over when FEN or pieces are edited', () => {
  const match = new MatchMachine('sb_gameover_recovery', 'sandbox');
  match.setPlayerConnected('w', true);

  // Simulate game over state
  match.phase = 'match_over';
  match.winner = 'b';
  match.winReason = 'checkmate';

  // 1. Setting FEN resets phase to chess_turn and clears winner
  match.handleSandboxSetFen(createInitialFen());
  assert.equal(match.phase, 'chess_turn');
  assert.equal(match.winner, null);
  assert.equal(match.winReason, undefined);

  // 2. Placing piece resets phase to chess_turn and clears winner
  match.phase = 'match_over';
  match.winner = 'w';
  match.handleSandboxPlacePiece('e4', 'queen', 'w');
  assert.equal(match.phase, 'chess_turn');
  assert.equal(match.winner, null);

  // 3. Free moving piece resets phase to chess_turn and clears winner
  match.phase = 'match_over';
  match.winner = 'w';
  match.handleSandboxFreeMove('e4', 'e5');
  assert.equal(match.phase, 'chess_turn');
  assert.equal(match.winner, null);
});
