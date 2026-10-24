import React, { useEffect, useRef, useState } from 'react';
import type {
  AbilityType,
  MatchSnapshot,
  PieceClass,
  PlayerColor,
} from '@let-him-rook/shared';
import type { VisionFrameData } from '../vision/visionManager.ts';

interface MatchHUDProps {
  snapshot: MatchSnapshot | null;
  localColor: PlayerColor | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  lastFrameData?: VisionFrameData | null;
  cursorPoint?: { x: number; y: number } | null;
  isPinching?: boolean;
  onDevAbility?: (ability: AbilityType, parryHolding?: boolean) => void;
  onRequestAdvice?: () => void;
  onOpenCalibration?: () => void;
  onLeaveRoom?: () => void;
  aiAdviceText?: string | null;
  toast?: { message: string; isError: boolean } | null;
  onToggleSandbox?: () => void;
  isSandboxOpen?: boolean;
  torsoLean?: { leanX: number; leanZ: number; inDeadzone: boolean } | null;
  usingKeyboard?: boolean;
}

const CLASS_GESTURE_GUIDE: Record<PieceClass, { title: string; gesture: string; primaryAbility: AbilityType }> = {
  pawn: {
    title: '♙ PAWN',
    gesture: 'Sweep right wrist to Slash (18 dmg) • Hold left open palm to Parry (100% block)',
    primaryAbility: 'pawn_sweep',
  },
  rook: {
    title: '♖ ROOK',
    gesture: 'Extend right arm forward to fire Cannon Shot (16 dmg; every 3rd shot is 28 dmg AoE Bomb)',
    primaryAbility: 'rook_shot',
  },
  knight: {
    title: '♘ KNIGHT',
    gesture: 'Cross forearms at chest then rapidly separate to Teleport + Cleave (24 dmg)',
    primaryAbility: 'knight_cleave',
  },
  bishop: {
    title: '♗ BISHOP',
    gesture: 'Cock right hand near shoulder then thrust forward for Ice Bolt (14 dmg + 4s Chill/Freeze)',
    primaryAbility: 'bishop_ice_bolt',
  },
  queen: {
    title: '♕ QUEEN',
    gesture: 'Raise both open palms to shoulder height and push forward for 3-Orb Homing Volley (27 dmg)',
    primaryAbility: 'queen_volley',
  },
  king: {
    title: '♔ KING',
    gesture: 'Clasp both hands at chest for 0.4s to Summon a random 1-HP Ally',
    primaryAbility: 'king_summon',
  },
};

export const MatchHUD: React.FC<MatchHUDProps> = ({
  snapshot,
  localColor,
  videoRef,
  lastFrameData,
  cursorPoint,
  isPinching = false,
  onDevAbility,
  onRequestAdvice,
  onOpenCalibration,
  onLeaveRoom,
  aiAdviceText,
  toast,
  onToggleSandbox,
  isSandboxOpen,
  torsoLean,
  usingKeyboard,
}) => {
  const [showMiniCam, setShowMiniCam] = useState(true);
  const [copiedRoom, setCopiedRoom] = useState(false);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestFrameRef = useRef<VisionFrameData | null>(lastFrameData ?? null);
  latestFrameRef.current = lastFrameData ?? null;

  // Mini camera Picture-in-Picture draw loop
  useEffect(() => {
    if (!showMiniCam) return;
    let animId: number | null = null;

    const renderMini = () => {
      animId = requestAnimationFrame(renderMini);
      const canvas = miniCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const video = videoRef?.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#64748b';
        ctx.font = '600 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Camera Off / Mouse Mode', w / 2, h / 2);
      }

      const frame = latestFrameRef.current;
      if (!frame) return;

      // Draw shoulders & wrists
      if (frame.pose && frame.pose.length > 16) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        const pairs: [number, number][] = [
          [11, 12],
          [11, 13],
          [13, 15],
          [12, 14],
          [14, 16],
        ];
        for (const [i, j] of pairs) {
          const a = frame.pose[i];
          const b = frame.pose[j];
          if (a && b && (a.visibility ?? 1) > 0.3 && (b.visibility ?? 1) > 0.3) {
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }
      }

      // Draw hand tips
      for (const hand of frame.hands) {
        if (!hand || hand.length < 21) continue;
        const thumb = hand[4];
        const index = hand[8];
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(thumb.x * w, thumb.y * h);
        ctx.lineTo(index.x * w, index.y * h);
        ctx.stroke();

        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(index.x * w, index.y * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    animId = requestAnimationFrame(renderMini);
    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [showMiniCam, videoRef]);

  if (!snapshot) return null;

  const isDuel =
    snapshot.phase === 'active_duel' ||
    snapshot.phase === 'duel_intro' ||
    snapshot.phase === 'duel_result';
  const duel = snapshot.duelSnapshot;
  const isMyTurn = snapshot.turn === localColor;

  const localFighter =
    duel && localColor
      ? duel.attacker.color === localColor
        ? duel.attacker
        : duel.defender
      : duel?.attacker ?? null;

  const localGuide = localFighter ? CLASS_GESTURE_GUIDE[localFighter.pieceClass] : null;

  // Check disconnect grace timer
  const opponentColor: PlayerColor = localColor === 'w' ? 'b' : 'w';
  const opponentStatus = snapshot.players[opponentColor];
  const isOpponentDisconnected = !opponentStatus?.connected && opponentStatus?.disconnectedAt;
  const remainingGraceSec = isOpponentDisconnected
    ? Math.max(0, Math.ceil((30000 - (Date.now() - (opponentStatus.disconnectedAt || 0))) / 1000))
    : 0;

  // Waiting for second player in PvP lobby
  const isWaitingForOpponent =
    snapshot.mode === 'pvp' &&
    snapshot.phase === 'lobby' &&
    (!snapshot.players.w.connected || !snapshot.players.b.connected);

  // Strictly gated dev controls check
  const allowDev =
    Boolean(import.meta.env.DEV) ||
    (import.meta.env.VITE_ALLOW_DEV_CONTROLS === 'true' &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('dev') === '1');

  const handleCopyRoom = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(snapshot.roomId).catch(() => {});
      setCopiedRoom(true);
      setTimeout(() => setCopiedRoom(false), 1800);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '1rem 1.2rem',
        zIndex: 30,
      }}
    >
      {/* Floating Fingertip Cursor during chess turn */}
      {snapshot.phase === 'chess_turn' && cursorPoint && (
        <div
          style={{
            position: 'fixed',
            left: `${Math.max(2, Math.min(98, ((cursorPoint.x - 0.1) / 0.8) * 100))}%`,
            top: `${Math.max(2, Math.min(98, ((cursorPoint.y - 0.1) / 0.8) * 100))}%`,
            width: isPinching ? 22 : 16,
            height: isPinching ? 22 : 16,
            borderRadius: '50%',
            backgroundColor: isPinching ? 'rgba(34, 197, 94, 0.85)' : 'rgba(251, 191, 36, 0.75)',
            border: '2px solid #ffffff',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 12px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
            zIndex: 70,
            transition: 'width 0.08s, height 0.08s',
          }}
        />
      )}

      {/* Top Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'auto',
          flexWrap: 'wrap',
          gap: '0.6rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleCopyRoom}
            title="Click to copy Room Code"
            style={{
              backgroundColor: '#171b2c',
              padding: '0.45rem 0.9rem',
              borderRadius: 8,
              border: '1px solid #2e3856',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            ROOM: <span style={{ color: '#60a5fa' }}>{snapshot.roomId}</span>{' '}
            {copiedRoom ? '✅' : '📋'}
          </button>

          <div
            style={{
              backgroundColor: '#171b2c',
              padding: '0.45rem 0.9rem',
              borderRadius: 8,
              border: '1px solid #2e3856',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: localColor === 'w' ? '#f8fafc' : '#94a3b8',
            }}
          >
            YOU:{' '}
            <span style={{ color: localColor === 'w' ? '#fbbf24' : '#c084fc' }}>
              {localColor === 'w' ? 'WHITE' : 'BLACK'}
            </span>
            {snapshot.mode === 'bot' ? ' (VS BOT)' : ''}
          </div>

          {snapshot.mode === 'sandbox' && (
            <div
              style={{
                backgroundColor: 'rgba(6, 182, 212, 0.2)',
                color: '#38bdf8',
                padding: '0.45rem 0.85rem',
                borderRadius: 8,
                border: '1px solid #06b6d4',
                fontSize: '0.82rem',
                fontWeight: 800,
                letterSpacing: '0.05em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              🛠️ SANDBOX
            </div>
          )}

          {snapshot.mode === 'sandbox' && onToggleSandbox && (
            <button
              onClick={onToggleSandbox}
              style={{
                backgroundColor: isSandboxOpen ? '#0891b2' : '#1e293b',
                color: '#ffffff',
                border: '1px solid #06b6d4',
                padding: '0.45rem 0.75rem',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ⚙️ Controls {isSandboxOpen ? '▲' : '▼'}
            </button>
          )}

          {!isDuel && onOpenCalibration && (
            <button
              onClick={onOpenCalibration}
              style={{
                backgroundColor: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #475569',
                padding: '0.45rem 0.75rem',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📷 Calibrate
            </button>
          )}

          <button
            onClick={onRequestAdvice}
            style={{
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #0284c7',
              padding: '0.45rem 0.75rem',
              borderRadius: 8,
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            💡 AI Advice
          </button>

          {onLeaveRoom && (
            <button
              onClick={onLeaveRoom}
              style={{
                backgroundColor: '#1e293b',
                color: '#f87171',
                border: '1px solid #7f1d1d',
                padding: '0.45rem 0.75rem',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Lobby
            </button>
          )}
        </div>

        {/* Phase / Turn Status Pill */}
        <div
          style={{
            backgroundColor: '#171b2c',
            padding: '0.55rem 1.2rem',
            borderRadius: 20,
            border: '1px solid #3b82f6',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            fontSize: '0.9rem',
            fontWeight: 800,
            color: '#f8fafc',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {(snapshot.phase === 'lobby' || snapshot.phase === 'calibration') && (
            <span>
              {isWaitingForOpponent
                ? `Waiting for Opponent (Code: ${snapshot.roomId})`
                : 'Waiting for Calibration Ready...'}
            </span>
          )}
          {snapshot.phase === 'chess_turn' && (
            <span>
              {snapshot.turn === 'w' ? 'White' : 'Black'}'s Turn{' '}
              {isMyTurn ? '(YOUR MOVE)' : '(WAITING)'}
            </span>
          )}
          {snapshot.phase === 'duel_intro' && '⚡ CONTESTED DUEL INCOMING ⚡'}
          {snapshot.phase === 'active_duel' && '⚔️ SPELL DUEL IN PROGRESS ⚔️'}
          {snapshot.phase === 'duel_result' && '🏆 DUEL RESOLVED'}
          {snapshot.phase === 'match_over' &&
            `👑 MATCH OVER — WINNER: ${
              snapshot.winner === 'w'
                ? 'WHITE'
                : snapshot.winner === 'b'
                ? 'BLACK'
                : 'DRAW'
            }`}
        </div>
      </div>

      {/* Disconnect Grace Warning Banner */}
      {isOpponentDisconnected && (
        <div
          style={{
            alignSelf: 'center',
            backgroundColor: 'rgba(239, 68, 68, 0.92)',
            color: '#ffffff',
            padding: '0.6rem 1.2rem',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.9rem',
          }}
        >
          ⚠️ Opponent disconnected! Forfeit timer: {remainingGraceSec}s
        </div>
      )}

      {/* Duel Intro Banner */}
      {snapshot.phase === 'duel_intro' && snapshot.pendingCapture && (
        <div
          style={{
            alignSelf: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            border: '2px solid #f59e0b',
            borderRadius: 16,
            padding: '1.4rem 2.4rem',
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.75)',
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f59e0b', letterSpacing: '0.1em' }}>
            CONTESTED CAPTURE ON {snapshot.pendingCapture.to.toUpperCase()}
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 900, color: '#ffffff', margin: '0.4rem 0' }}>
            {snapshot.pendingCapture.attackerClass.toUpperCase()} vs{' '}
            {snapshot.pendingCapture.defenderClass.toUpperCase()}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Get ready to lean and cast your signature class gesture!
          </div>
        </div>
      )}

      {/* Duel Result Banner */}
      {snapshot.phase === 'duel_result' && duel && (
        <div
          style={{
            alignSelf: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            border: '2px solid #10b981',
            borderRadius: 16,
            padding: '1.4rem 2.4rem',
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.75)',
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#10b981', letterSpacing: '0.1em' }}>
            DUEL COMPLETE
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#ffffff', margin: '0.4rem 0' }}>
            {duel.winner === 'draw'
              ? '⚖️ MUTUAL DRAW!'
              : duel.winner === duel.attacker.color
              ? `⚔️ ATTACKER (${duel.attacker.pieceClass.toUpperCase()}) WINS THE SQUARE!`
              : `🛡️ DEFENDER (${duel.defender.pieceClass.toUpperCase()}) HOLDS THE SQUARE!`}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Returning to chessboard...
          </div>
        </div>
      )}

      {/* Match Over Overlay Banner */}
      {snapshot.phase === 'match_over' && (
        <div
          style={{
            alignSelf: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            border: '2px solid #fbbf24',
            borderRadius: 16,
            padding: '2rem 2.8rem',
            textAlign: 'center',
            boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ fontSize: '2.2rem', marginBottom: '0.3rem' }}>👑</div>
          <h2 style={{ fontSize: '1.7rem', fontWeight: 900, color: '#f8fafc', marginBottom: '0.4rem' }}>
            {snapshot.winner === 'draw'
              ? 'MATCH DRAWN'
              : `${snapshot.winner === 'w' ? 'WHITE' : 'BLACK'} WINS THE MATCH!`}
          </h2>
          {snapshot.winReason && (
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.2rem' }}>
              Reason: {snapshot.winReason.replace(/_/g, ' ').toUpperCase()}
            </p>
          )}
          {onLeaveRoom && (
            <button
              onClick={onLeaveRoom}
              style={{
                padding: '0.75rem 1.6rem',
                borderRadius: 8,
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Play Again / Return to Lobby
            </button>
          )}
        </div>
      )}

      {/* Bottom Area: Duel Health & Ability Bars + Dev Toolbar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.6rem',
          width: '100%',
        }}
      >
        {/* AI Advice Banner */}
        {aiAdviceText && (
          <div
            style={{
              maxWidth: 620,
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid #38bdf8',
              borderRadius: 10,
              padding: '0.7rem 1.1rem',
              color: '#e0f2fe',
              fontSize: '0.84rem',
              lineHeight: 1.4,
              pointerEvents: 'auto',
            }}
          >
            <strong>Tactical Advice:</strong> {aiAdviceText}
          </div>
        )}

        {/* Action Toast Cue */}
        {toast && (
          <div
            style={{
              backgroundColor: toast.isError
                ? 'rgba(239, 68, 68, 0.92)'
                : 'rgba(16, 185, 129, 0.92)',
              color: '#ffffff',
              padding: '0.45rem 1rem',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '0.84rem',
            }}
          >
            {toast.message}
          </div>
        )}

        {/* Duel Health & Ability Bars */}
        {isDuel && duel && (
          <div
            style={{
              width: '100%',
              maxWidth: 680,
              backgroundColor: 'rgba(23, 27, 44, 0.94)',
              borderRadius: 16,
              padding: '0.9rem 1.2rem',
              border: '1px solid #3b82f6',
              boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#93c5fd' }}>
                {localGuide ? `${localGuide.title}: ${localGuide.gesture}` : ''}
              </span>
              <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#f59e0b', whiteSpace: 'nowrap' }}>
                ⏳ {Math.ceil(duel.remainingMs / 1000)}s
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem' }}>
              {/* Attacker */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '0.25rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                  }}
                >
                  <span>
                    {duel.attacker.color === 'w' ? '⚪' : '⚫'}{' '}
                    {duel.attacker.pieceClass.toUpperCase()} (ATK)
                  </span>
                  <span>{Math.round(duel.attacker.hp)} HP</span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 10,
                    backgroundColor: '#334155',
                    borderRadius: 5,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(0, (duel.attacker.hp / duel.attacker.maxHp) * 100)}%`,
                      height: '100%',
                      backgroundColor: duel.attacker.hp > 30 ? '#22c55e' : '#ef4444',
                      transition: 'width 0.1s ease',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '0.25rem',
                    fontSize: '0.74rem',
                    color: '#94a3b8',
                  }}
                >
                  <span>
                    Ability:{' '}
                    <span
                      style={{
                        color:
                          duel.attacker.cooldowns.primary > (snapshot.serverTime || Date.now())
                            ? '#f87171'
                            : '#4ade80',
                        fontWeight: 600,
                      }}
                    >
                      {duel.attacker.cooldowns.primary > (snapshot.serverTime || Date.now())
                        ? `${
                            Math.ceil(
                              (duel.attacker.cooldowns.primary -
                                (snapshot.serverTime || Date.now())) /
                                100
                            ) / 10
                          }s`
                        : 'READY'}
                    </span>
                  </span>
                  {duel.attacker.pieceClass === 'rook' && (
                    <span
                      style={{
                        color: duel.attacker.rookShotCounter % 3 === 2 ? '#f59e0b' : '#94a3b8',
                        fontWeight: 600,
                      }}
                    >
                      Bomb: {duel.attacker.rookShotCounter % 3}/3{' '}
                      {duel.attacker.rookShotCounter % 3 === 2 ? '💣' : ''}
                    </span>
                  )}
                  {duel.attacker.pieceClass === 'pawn' && (
                    <span>Parry: {duel.attacker.isParrying ? '🛡️ HELD' : 'Ready'}</span>
                  )}
                </div>
              </div>

              {/* Defender */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '0.25rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                  }}
                >
                  <span>
                    {duel.defender.color === 'w' ? '⚪' : '⚫'}{' '}
                    {duel.defender.pieceClass.toUpperCase()} (DEF)
                  </span>
                  <span>{Math.round(duel.defender.hp)} HP</span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 10,
                    backgroundColor: '#334155',
                    borderRadius: 5,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(0, (duel.defender.hp / duel.defender.maxHp) * 100)}%`,
                      height: '100%',
                      backgroundColor: duel.defender.hp > 30 ? '#22c55e' : '#ef4444',
                      transition: 'width 0.1s ease',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '0.25rem',
                    fontSize: '0.74rem',
                    color: '#94a3b8',
                  }}
                >
                  <span>
                    Ability:{' '}
                    <span
                      style={{
                        color:
                          duel.defender.cooldowns.primary > (snapshot.serverTime || Date.now())
                            ? '#f87171'
                            : '#4ade80',
                        fontWeight: 600,
                      }}
                    >
                      {duel.defender.cooldowns.primary > (snapshot.serverTime || Date.now())
                        ? `${
                            Math.ceil(
                              (duel.defender.cooldowns.primary -
                                (snapshot.serverTime || Date.now())) /
                                100
                            ) / 10
                          }s`
                        : 'READY'}
                    </span>
                  </span>
                  {duel.defender.pieceClass === 'rook' && (
                    <span
                      style={{
                        color: duel.defender.rookShotCounter % 3 === 2 ? '#f59e0b' : '#94a3b8',
                        fontWeight: 600,
                      }}
                    >
                      Bomb: {duel.defender.rookShotCounter % 3}/3{' '}
                      {duel.defender.rookShotCounter % 3 === 2 ? '💣' : ''}
                    </span>
                  )}
                  {duel.defender.pieceClass === 'pawn' && (
                    <span>Parry: {duel.defender.isParrying ? '🛡️ HELD' : 'Ready'}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Strictly Gated Dev Controls Toolbar */}
        {allowDev && snapshot.phase === 'active_duel' && localFighter && localGuide && (
          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.92)',
              padding: '0.45rem 0.9rem',
              borderRadius: 8,
              border: '1px dashed #64748b',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '0.75rem',
              pointerEvents: 'auto',
            }}
          >
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>
              [DEV • WASD Move • Space Cast]:
            </span>
            <button
              onClick={() => onDevAbility?.(localGuide.primaryAbility)}
              style={{
                padding: '0.25rem 0.65rem',
                borderRadius: 4,
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cast {localGuide.primaryAbility.replace(/_/g, ' ').toUpperCase()} [Space]
            </button>
            {localFighter.pieceClass === 'pawn' && (
              <button
                onMouseDown={() => onDevAbility?.('pawn_parry', true)}
                onMouseUp={() => onDevAbility?.('pawn_parry', false)}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: 4,
                  backgroundColor: '#0891b2',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Hold Parry [Shift]
              </button>
            )}
          </div>
        )}
      </div>

      {/* Real-time Movement & Diagnostics HUD Overlay in Sandbox Duel */}
      {snapshot.mode === 'sandbox' && isDuel && snapshot.duelSnapshot && (
        <div
          style={{
            position: 'fixed',
            bottom: 14,
            left: 14,
            zIndex: 35,
            padding: '0.75rem 1rem',
            borderRadius: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(6, 182, 212, 0.4)',
            color: '#e2e8f0',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            minWidth: 260,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '0.8rem', marginBottom: '0.2rem' }}>
            📊 MOVEMENT & DIAGNOSTICS
          </div>
          {(() => {
            const fighter =
              snapshot.duelSnapshot.attacker.color === 'w'
                ? snapshot.duelSnapshot.attacker
                : snapshot.duelSnapshot.defender;
            const distToRail = Math.max(
              0,
              Math.min(7.0 - Math.abs(fighter.x), 7.0 - Math.abs(fighter.z))
            );
            const status = distToRail < 1.0 ? 'DANGER' : distToRail < 2.5 ? 'WARNING' : 'SAFE';
            const color = distToRail < 1.0 ? '#ef4444' : distToRail < 2.5 ? '#f59e0b' : '#10b981';

            return (
              <>
                <div>
                  <span style={{ color: '#94a3b8' }}>Position: </span>
                  <span style={{ color: '#f8fafc', fontWeight: 700 }}>
                    X: {fighter.x >= 0 ? `+${fighter.x.toFixed(2)}` : fighter.x.toFixed(2)}, Z:{' '}
                    {fighter.z >= 0 ? `+${fighter.z.toFixed(2)}` : fighter.z.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Velocity: </span>
                  <span style={{ color: '#a5f3fc' }}>
                    Vx: {fighter.vx.toFixed(2)}, Vz: {fighter.vz.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Body movement: </span>
                  <span style={{ color: '#cbd5e1' }}>
                    X: {(torsoLean?.leanX ?? 0).toFixed(2)}, Z: {(torsoLean?.leanZ ?? 0).toFixed(2)}
                  </span>{' '}
                  <span
                    style={{
                      fontWeight: 700,
                      color: (torsoLean?.inDeadzone ?? true) ? '#64748b' : '#06b6d4',
                    }}
                  >
                    [{(torsoLean?.inDeadzone ?? true) ? 'IN DEADZONE' : 'MOVING'}]
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Distance to Rail: </span>
                  <span style={{ color, fontWeight: 700 }}>
                    {distToRail.toFixed(1)}u ({status})
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Input Mode: </span>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                    {usingKeyboard ? '⌨️ WASD Keyboard' : '📷 Camera Steps'}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Picture-in-Picture Live Camera & Skeleton Corner Preview */}
      <div
        style={{
          position: 'fixed',
          bottom: 14,
          right: 14,
          pointerEvents: 'auto',
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          border: '1px solid #334155',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          zIndex: 35,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.25rem 0.5rem',
            backgroundColor: '#1e293b',
            fontSize: '0.7rem',
            color: '#cbd5e1',
            gap: '0.5rem',
          }}
        >
          <span>
            📷 {lastFrameData?.diagnostics?.fps ?? 0} FPS
          </span>
          <button
            onClick={() => setShowMiniCam(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#93c5fd',
              fontSize: '0.7rem',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {showMiniCam ? 'Hide' : 'Show Cam'}
          </button>
        </div>
        {showMiniCam && (
          <canvas
            ref={miniCanvasRef}
            width={180}
            height={112}
            style={{ display: 'block', width: 180, height: 112 }}
          />
        )}
      </div>
    </div>
  );
};
