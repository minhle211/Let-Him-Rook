import { BodyMovementGuide } from './components/BodyMovementGuide.tsx';
import React, { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  getPieceFromFen,
  type AbilityType,
  type AiBehaviorMode,
  type BoardSquare,
  type MatchMode,
  type PieceClass,
  type PlayerColor,
  type PromotionPieceClass,
  type SandboxConfig,
} from '@let-him-rook/shared';
import { DuelEntities } from './arena/DuelEntities.tsx';
import { TabletopArena } from './arena/TabletopArena.tsx';
import { CalibrationOverlay } from './components/CalibrationOverlay.tsx';
import { LobbyScreen } from './components/LobbyScreen.tsx';
import { MatchHUD } from './components/MatchHUD.tsx';
import { PromotionModal } from './components/PromotionModal.tsx';
import { SandboxControlCenter } from './components/SandboxControlCenter.tsx';
import {
  DEFAULT_CALIBRATION,
  loadSavedCalibration,
  saveCalibrationProfile,
  type CalibrationProfile,
} from './gestures/calibration.ts';
import {
  ChessGestureController,
} from './gestures/chessGestures.ts';
import {
  CombatGestureDetector,
  LeftHandCameraController,
  TorsoLeanController,
  type CameraTurnIntent,
} from './gestures/combatGestures.ts';
import { WebSocketClient } from './networking/wsClient.ts';
import { matchStore, type MatchState } from './state/matchStore.ts';
import { VisionManager, type VisionFrameData } from './vision/visionManager.ts';

const PRIMARY_ABILITY_BY_CLASS: Record<PieceClass, AbilityType> = {
  pawn: 'pawn_sweep',
  rook: 'rook_shot',
  knight: 'knight_cleave',
  bishop: 'bishop_ice_bolt',
  queen: 'queen_volley',
  king: 'king_summon',
};

export const App: React.FC = () => {
  const [matchState, setMatchState] = useState<MatchState>(matchStore.getState());
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(sessionStorage.getItem('rook_room_id') && sessionStorage.getItem('rook_token'))
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationProfile, setCalibrationProfile] = useState<CalibrationProfile>(
    () => loadSavedCalibration() ?? DEFAULT_CALIBRATION
  );
  const [lastFrameData, setLastFrameData] = useState<VisionFrameData | null>(null);
  const [isSandboxOpen, setIsSandboxOpen] = useState(true);
  const [selectedPalette, setSelectedPalette] = useState<
    { pieceClass: PieceClass; color: PlayerColor } | 'eraser' | null
  >(null);
  const [torsoTelemetry, setTorsoTelemetry] = useState<{
    leanX: number;
    leanZ: number;
    inDeadzone: boolean;
  } | null>(null);
  const [cameraTelemetry, setCameraTelemetry] = useState<CameraTurnIntent>({
    turnDir: 0,
    tilt: 0,
    active: false,
  });
  const [usingKeyboard, setUsingKeyboard] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const visionManagerRef = useRef<VisionManager | null>(null);
  const calibrationProfileRef = useRef<CalibrationProfile>(calibrationProfile);
  const showCalibrationRef = useRef<boolean>(showCalibration);
  const chessGesturesRef = useRef<ChessGestureController>(new ChessGestureController());
  const torsoLeanRef = useRef<TorsoLeanController>(new TorsoLeanController());
  const leftCameraRef = useRef<LeftHandCameraController>(new LeftHandCameraController());
  const combatDetectorRef = useRef<CombatGestureDetector>(new CombatGestureDetector());
  const keysPressedRef = useRef<Set<string>>(new Set());
  const lastVisionUiUpdateRef = useRef(0);
  const cameraTelemetryRef = useRef<CameraTurnIntent>(cameraTelemetry);
  cameraTelemetryRef.current = cameraTelemetry;

  const actionCounterRef = useRef(0);
  const actionPrefixRef = useRef(crypto.randomUUID());

  calibrationProfileRef.current = calibrationProfile;
  showCalibrationRef.current = showCalibration;

  // Subscribe to match store updates
  useEffect(() => {
    return matchStore.subscribe(state => setMatchState(state));
  }, []);

  // Initialize WebSocket client
  useEffect(() => {
    const ws = new WebSocketClient();
    wsClientRef.current = ws;

    ws.setListeners({
      onJoined: ({ roomId, color, token, mode }) => {
        setIsLoading(false);
        setError(null);
        if (matchStore.getState().snapshot?.roomId !== roomId) {
          setCalibrationProfile(loadSavedCalibration() ?? DEFAULT_CALIBRATION);
        }
        matchStore.setSession(color, token);
        const phase = matchStore.getState().snapshot?.phase;
        if (mode === 'sandbox') {
          setShowCalibration(false);
          setIsSandboxOpen(true);
        } else if ((phase === 'lobby' || phase === 'calibration' || !phase) &&
                   !matchStore.getState().snapshot?.players[color].calibrated) {
          setShowCalibration(true);
        } else {
          setShowCalibration(false);
        }
      },
      onSnapshot: snapshot => {
        matchStore.setSnapshot(snapshot);
        if (snapshot.phase === 'chess_turn' || snapshot.phase === 'active_duel') {
          setShowCalibration(false);
        }
      },
      onDuelEvents: events => {
        matchStore.addDuelEvents(events);
      },
      onActionFeedback: ({ accepted, reason }) => {
        if (!accepted && reason) {
          matchStore.showToast(`Action rejected: ${reason.replace(/_/g, ' ')}`, true);
        }
      },
      onAiAdvice: advice => {
        matchStore.setAiAdvice(advice);
      },
      onError: err => {
        setIsLoading(false);
        setError(err.message);
        if (/Room not found|Invalid reconnect token|Reconnect window expired/.test(err.message)) {
          matchStore.clearSession();
          setShowCalibration(false);
        }
      },
      onStatusChange: isConnected => {
        setConnected(isConnected);
        if (!isConnected) keysPressedRef.current.clear();
      },
    });

    ws.connect();
    return () => ws.disconnect();
  }, []);

  useEffect(() => {
    torsoLeanRef.current.reset();
    leftCameraRef.current.reset();
    combatDetectorRef.current.reset();
  }, [calibrationProfile, matchState.snapshot?.phase, showCalibration]);

  const isInRoom = Boolean(matchState.snapshot?.roomId || showCalibration);

  // Initialize Vision Manager once when entering room/calibration (do NOT stop when closing calibration modal!)
  useEffect(() => {
    if (!isInRoom) return;

    torsoLeanRef.current.reset();
    const vm = new VisionManager();
    visionManagerRef.current = vm;

    vm.subscribe(frameData => {
      // Gesture processing uses every inference result, while visual overlays only
      // need 10 FPS. Avoid rerendering the full React + R3F tree 30 times/second.
      if (frameData.timestamp - lastVisionUiUpdateRef.current >= 100) {
        lastVisionUiUpdateRef.current = frameData.timestamp;
        setLastFrameData(frameData);
      }

      // Pause live game gestures while calibration modal is open
      if (showCalibrationRef.current) return;

      const state = matchStore.getState();
      const snapshot = state.snapshot;
      const localColor = state.localColor;
      const profile = calibrationProfileRef.current;
      if (!snapshot || !localColor || snapshot.paused) return;

      const now = performance.now();

      // 1. Handle Promotion Modal gesture selection if active
      if (state.promotionMove) {
        const dominantHand = frameData.hands[0] || null;
        const promoRes = chessGesturesRef.current.updatePromotionSelection(
          dominantHand,
          profile,
          now
        );
        matchStore.setCursorState(
          chessGesturesRef.current.cursorPoint,
          chessGesturesRef.current.isPinching
        );
        matchStore.setPromotionHover(promoRes.hover);
        if (promoRes.selected) {
          const actionId = `${actionPrefixRef.current}_promo_${++actionCounterRef.current}`;
          wsClientRef.current?.send({
            type: 'chess_move_intent',
            from: state.promotionMove.from,
            to: state.promotionMove.to,
            promotion: promoRes.selected,
            actionId,
          });
          matchStore.setPromotionMove(null);
        }
        return;
      }

      // 2. Process Chess Gestures during chess_turn
      if (snapshot.phase === 'chess_turn' && snapshot.turn === localColor) {
        const dominantHand = frameData.hands[0] || null;
        const res = chessGesturesRef.current.update(
          dominantHand,
          localColor,
          snapshot.legalMoves,
          profile,
          now
        );

        matchStore.setHoverSquare(chessGesturesRef.current.hoverSquare);
        matchStore.setSelectedSquare(chessGesturesRef.current.selectedSquare);
        matchStore.setCursorState(
          chessGesturesRef.current.cursorPoint,
          chessGesturesRef.current.isPinching
        );

        if (res.intent) {
          const movingPiece = getPieceFromFen(snapshot.fen, res.intent.from);
          const isPawn = movingPiece?.pieceClass === 'pawn';
          const isPromoRank = res.intent.to[1] === (localColor === 'w' ? '8' : '1');

          if (isPawn && isPromoRank) {
            matchStore.setPromotionMove(res.intent);
          } else {
            const actionId = `${actionPrefixRef.current}_move_${++actionCounterRef.current}`;
            wsClientRef.current?.send({
              type: 'chess_move_intent',
              from: res.intent.from,
              to: res.intent.to,
              actionId,
            });
          }
        }
      } else {
        matchStore.setCursorState(null, false);
      }

      // 3. Process Combat Gestures during active_duel
      if (snapshot.phase === 'active_duel' && snapshot.duelSnapshot) {
        {
          const lean = torsoLeanRef.current.update(frameData.pose, profile, now);
          const inDeadzone = Math.hypot(lean.moveX, lean.moveZ) < 0.05;
          setTorsoTelemetry({ leanX: lean.moveX, leanZ: lean.moveZ, inDeadzone });

          const camTurn = leftCameraRef.current.update(frameData.hands, frameData.pose, now, profile);
          setCameraTelemetry(camTurn);

          // Only send camera torso-lean & turn if no keyboard WASD/QE keys are currently held
          if (keysPressedRef.current.size === 0) {
            wsClientRef.current?.send({
              type: 'duel_move_intent',
              moveX: lean.moveX,
              moveZ: lean.moveZ,
              turnDir: camTurn.turnDir,
              actionId: `${actionPrefixRef.current}_lean_${Math.round(now)}`,
            });
          }
        }

        const fighter =
          snapshot.duelSnapshot.attacker.color === localColor
            ? snapshot.duelSnapshot.attacker
            : snapshot.duelSnapshot.defender;

        const ability = combatDetectorRef.current.update(
          fighter.pieceClass,
          frameData.pose,
          frameData.hands,
          profile,
          now
        );

        if (ability) {
          const actionId = `${actionPrefixRef.current}_ab_${++actionCounterRef.current}`;
          wsClientRef.current?.send({
            type: 'duel_ability_intent',
            ability: ability.ability,
            parryHolding: ability.parryHolding,
            actionId,
          });
        }
      }
    });

    if (videoRef.current) {
      vm.start(videoRef.current).catch(err => {
        console.warn('[App] Camera start failed or denied:', err);
        matchStore.showToast(!window.isSecureContext
          ? 'Camera needs trusted HTTPS. Use the LAN HTTPS setup or play with mouse and keyboard.'
          : 'Camera unavailable or permission denied. You can play with mouse and keyboard.', true);
      });
    }

    return () => {
      vm.stop();
      visionManagerRef.current = null;
    };
  }, [isInRoom]);

  // Dev keyboard controls (WASD / Arrow keys for duel movement, Q/E for camera rotation + Spacebar for ability)
  useEffect(() => {
    const sendKeyboardMove = () => {
      const state = matchStore.getState();
      if (state.snapshot?.phase !== 'active_duel' || state.snapshot.paused) return;
      const keys = keysPressedRef.current;
      let moveX = 0;
      let moveZ = 0;
      let turnDir = 0;
      if (keys.has('w') || keys.has('arrowup')) moveZ -= 1;
      if (keys.has('s') || keys.has('arrowdown')) moveZ += 1;
      if (keys.has('a') || keys.has('arrowleft')) moveX -= 1;
      if (keys.has('d') || keys.has('arrowright')) moveX += 1;
      if (keys.has('q')) turnDir -= 1;
      if (keys.has('e')) turnDir += 1;

      if (turnDir === 0 && cameraTelemetryRef.current.turnDir !== 0) {
        turnDir = cameraTelemetryRef.current.turnDir;
      }

      wsClientRef.current?.send({
        type: 'duel_move_intent',
        moveX,
        moveZ,
        turnDir,
        actionId: `${actionPrefixRef.current}_kb_mv_${Date.now()}`,
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (showCalibrationRef.current || matchStore.getState().snapshot?.paused) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        keysPressedRef.current.add(key);
        setUsingKeyboard(true);
        sendKeyboardMove();
      } else if (key === ' ' && !e.repeat) {
        const state = matchStore.getState();
        const duel = state.snapshot?.duelSnapshot;
        const localColor = state.localColor;
        if (state.snapshot?.phase === 'active_duel' && !state.snapshot.paused && duel && localColor) {
          e.preventDefault();
          const fighter =
            duel.attacker.color === localColor ? duel.attacker : duel.defender;
          const ability = PRIMARY_ABILITY_BY_CLASS[fighter.pieceClass];
          wsClientRef.current?.send({
            type: 'duel_ability_intent',
            ability,
            actionId: `${actionPrefixRef.current}_kb_ab_${++actionCounterRef.current}`,
          });
        }
      } else if (key === 'shift' && !e.repeat) {
        const state = matchStore.getState();
        const duel = state.snapshot?.duelSnapshot;
        const localColor = state.localColor;
        if (state.snapshot?.phase === 'active_duel' && !state.snapshot.paused && duel && localColor) {
          const fighter =
            duel.attacker.color === localColor ? duel.attacker : duel.defender;
          if (fighter.pieceClass === 'pawn') {
            wsClientRef.current?.send({
              type: 'duel_ability_intent',
              ability: 'pawn_parry',
              parryHolding: true,
              actionId: `${actionPrefixRef.current}_kb_parry_on_${++actionCounterRef.current}`,
            });
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (keysPressedRef.current.has(key)) {
        keysPressedRef.current.delete(key);
        setUsingKeyboard(keysPressedRef.current.size > 0);
        sendKeyboardMove();
      } else if (key === 'shift') {
        const state = matchStore.getState();
        const duel = state.snapshot?.duelSnapshot;
        const localColor = state.localColor;
        if (state.snapshot?.phase === 'active_duel' && duel && localColor) {
          const fighter =
            duel.attacker.color === localColor ? duel.attacker : duel.defender;
          if (fighter.pieceClass === 'pawn') {
            wsClientRef.current?.send({
              type: 'duel_ability_intent',
              ability: 'pawn_parry',
              parryHolding: false,
              actionId: `${actionPrefixRef.current}_kb_parry_off_${++actionCounterRef.current}`,
            });
          }
        }
      }
    };

    const intervalId = window.setInterval(() => {
      if (keysPressedRef.current.size > 0) {
        sendKeyboardMove();
      }
    }, 80);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const clearKeys = () => { keysPressedRef.current.clear(); setUsingKeyboard(false); };
    window.addEventListener('blur', clearKeys);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
    };
  }, []);

  useEffect(() => {
    if (matchState.snapshot?.paused) {
      keysPressedRef.current.clear();
      setUsingKeyboard(false);
      torsoLeanRef.current.reset();
      leftCameraRef.current.reset();
      combatDetectorRef.current = new CombatGestureDetector();
      chessGesturesRef.current = new ChessGestureController();
    }
  }, [matchState.snapshot?.paused]);

  const handleCreateRoom = (mode: MatchMode) => {
    setIsLoading(true);
    setError(null);
    wsClientRef.current?.send({ type: 'create_room', mode });
  };

  const handleJoinRoom = (roomId: string) => {
    setIsLoading(true);
    setError(null);
    wsClientRef.current?.send({ type: 'join_room', roomId });
  };

  const handleCalibrationComplete = (profile: CalibrationProfile, persisted?: CalibrationProfile) => {
    setCalibrationProfile(profile);
    if (persisted) saveCalibrationProfile(persisted);
    setShowCalibration(false);
    wsClientRef.current?.send({ type: 'calibration_ready', ready: true });
  };

  const handleLeaveRoom = () => {
    setShowCalibration(false);
    setCalibrationProfile(loadSavedCalibration() ?? DEFAULT_CALIBRATION);
    matchStore.clearSession();
    wsClientRef.current?.disconnect();
    wsClientRef.current?.connect();
  };

  const handlePromotionSelect = (piece: PromotionPieceClass) => {
    const move = matchState.promotionMove;
    if (move) {
      const actionId = `${actionPrefixRef.current}_promo_${++actionCounterRef.current}`;
      wsClientRef.current?.send({
        type: 'chess_move_intent',
        from: move.from,
        to: move.to,
        promotion: piece,
        actionId,
      });
      matchStore.setPromotionMove(null);
    }
  };

  const handleSquareClick = (square: BoardSquare) => {
    const snapshot = matchState.snapshot;
    const localColor = matchState.localColor;
    if (!snapshot || snapshot.phase !== 'chess_turn') return;

    if (snapshot.mode === 'sandbox') {
      // 1. Eraser tool active
      if (selectedPalette === 'eraser') {
        wsClientRef.current?.send({
          type: 'sandbox_place_piece',
          square,
          pieceClass: null,
        });
        return;
      }

      // 2. Piece palette tool active
      if (selectedPalette) {
        wsClientRef.current?.send({
          type: 'sandbox_place_piece',
          square,
          pieceClass: selectedPalette.pieceClass,
          pieceColor: selectedPalette.color,
        });
        return;
      }

      // 3. Free placement when rules are not enforced
      if (snapshot.sandboxConfig && !snapshot.sandboxConfig.rulesEnforced) {
        if (!matchState.selectedSquare) {
          const piece = getPieceFromFen(snapshot.fen, square);
          if (piece) {
            matchStore.setSelectedSquare(square);
          }
        } else {
          const from = matchState.selectedSquare;
          if (square === from) {
            matchStore.setSelectedSquare(null);
          } else {
            const movingPiece = getPieceFromFen(snapshot.fen, from);
            const targetPiece = getPieceFromFen(snapshot.fen, square);
            if (movingPiece && targetPiece && movingPiece.color !== targetPiece.color) {
              const actionId = `${actionPrefixRef.current}_free_capture_${++actionCounterRef.current}`;
              wsClientRef.current?.send({
                type: 'chess_move_intent',
                from,
                to: square,
                actionId,
              });
            } else {
              wsClientRef.current?.send({
                type: 'sandbox_free_move',
                from,
                to: square,
              });
            }
            matchStore.setSelectedSquare(null);
          }
        }
        return;
      }
    }

    // Rules-enforced movement (in normal mode, only on your turn)
    if (snapshot.paused || (snapshot.mode !== 'sandbox' && snapshot.turn !== localColor)) return;

    if (!matchState.selectedSquare) {
      if (snapshot.legalMoves[square]?.length) {
        matchStore.setSelectedSquare(square);
      }
    } else {
      const from = matchState.selectedSquare;
      if (square === from) {
        matchStore.setSelectedSquare(null);
        return;
      }
      const validDests = snapshot.legalMoves[from];
      if (validDests && validDests.includes(square)) {
        const movingPiece = getPieceFromFen(snapshot.fen, from);
        const isPawn = movingPiece?.pieceClass === 'pawn';
        const isPromoRank = square[1] === (movingPiece?.color === 'w' ? '8' : '1');
        if (isPawn && isPromoRank) {
          matchStore.setPromotionMove({ from, to: square });
        } else {
          const actionId = `${actionPrefixRef.current}_click_move_${++actionCounterRef.current}`;
          wsClientRef.current?.send({
            type: 'chess_move_intent',
            from,
            to: square,
            actionId,
          });
        }
        matchStore.setSelectedSquare(null);
      } else if (snapshot.legalMoves[square]?.length) {
        // Clicked a different friendly piece with legal moves: switch selection
        matchStore.setSelectedSquare(square);
      } else {
        matchStore.setSelectedSquare(null);
      }
    }
  };

  const handleSetFen = (fen: string) => {
    wsClientRef.current?.send({ type: 'sandbox_set_fen', fen });
  };

  const handlePlacePiece = (
    square: BoardSquare,
    pieceClass: PieceClass | null,
    color?: PlayerColor
  ) => {
    wsClientRef.current?.send({
      type: 'sandbox_place_piece',
      square,
      pieceClass,
      pieceColor: color,
    });
  };

  const handleFreeMove = (from: BoardSquare, to: BoardSquare) => {
    wsClientRef.current?.send({ type: 'sandbox_free_move', from, to });
  };

  const handleStartDuel = (
    attackerClass: PieceClass,
    defenderClass: PieceClass,
    aiBehavior?: AiBehaviorMode,
    standalone?: boolean
  ) => {
    wsClientRef.current?.send({
      type: 'sandbox_start_duel',
      attackerClass,
      defenderClass,
      aiBehavior,
      standalone,
    });
  };

  const handleUpdateConfig = (config: Partial<SandboxConfig>) => {
    wsClientRef.current?.send({ type: 'sandbox_update_config', config });
  };

  const handleResetDuel = () => {
    wsClientRef.current?.send({ type: 'sandbox_reset_duel' });
  };

  const handleExitDuel = () => {
    wsClientRef.current?.send({ type: 'sandbox_exit_duel' });
  };

  const handleRespawnObstacles = () => {
    wsClientRef.current?.send({ type: 'sandbox_respawn_obstacles' });
  };

  const handleDevAbility = (ability: AbilityType, parryHolding?: boolean) => {
    if (matchStore.getState().snapshot?.paused) return;
    const actionId = `${actionPrefixRef.current}_dev_ab_${++actionCounterRef.current}`;
    wsClientRef.current?.send({
      type: 'duel_ability_intent',
      ability,
      parryHolding,
      actionId,
    });
  };

  const handleRequestAdvice = () => {
    wsClientRef.current?.send({ type: 'request_ai_advice' });
  };

  const legalDestinations =
    matchState.selectedSquare && matchState.snapshot?.legalMoves
      ? matchState.snapshot.legalMoves[matchState.selectedSquare] || []
      : [];

  const obstacles = matchState.snapshot?.duelSnapshot?.obstacles || [];

  const isDuelCameraActive =
    matchState.snapshot?.phase === 'active_duel' ||
    matchState.snapshot?.phase === 'duel_intro' ||
    matchState.snapshot?.phase === 'duel_result';

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Single Persistent Video for Webcam Tracking (Offscreen with active GPU decoding) */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 640,
          height: 480,
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -999,
        }}
      />

      {/* 3D WebGL Canvas */}
      <Canvas
        shadows
        // Render at 1x even on Retina: at 2x the scene saturates the GPU and starves MediaPipe (~20 FPS -> ~5 FPS).
        dpr={1}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 8.8, 8.2], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight
          position={[6, 12, 6]}
          intensity={1.25}
          castShadow
          shadow-mapSize={[512, 512]}
        />
        <pointLight position={[-6, 6, -6]} intensity={0.5} />

        <TabletopArena
          hoverSquare={matchState.hoverSquare}
          selectedSquare={matchState.selectedSquare}
          legalDestinations={legalDestinations}
          obstacles={obstacles}
          fen={matchState.snapshot?.fen}
          phase={matchState.snapshot?.phase}
          onSquareClick={handleSquareClick}
        />

        <DuelEntities
          interpolation={matchState.interpolation}
          localColor={matchState.localColor}
          isDuelActive={isDuelCameraActive}
          visualEffects={matchState.visualEffects}
        />
      </Canvas>

      <div style={{position:'absolute',bottom:8,left:8,zIndex:20}}>
        <BodyMovementGuide profile={calibrationProfile} pose={lastFrameData?.pose ?? null} cameraTurn={cameraTelemetry} />
      </div>
      {/* HUD Overlays */}
      <MatchHUD
        snapshot={matchState.snapshot}
        localColor={matchState.localColor}
        videoRef={videoRef}
        lastFrameData={lastFrameData}
        cursorPoint={matchState.cursorPoint}
        isPinching={matchState.isPinching}
        onDevAbility={handleDevAbility}
        onRequestAdvice={handleRequestAdvice}
        onOpenCalibration={() => setShowCalibration(true)}
        onLeaveRoom={handleLeaveRoom}
        aiAdviceText={matchState.aiAdvice}
        toast={matchState.feedbackToast}
        onToggleSandbox={() => setIsSandboxOpen(v => !v)}
        isSandboxOpen={isSandboxOpen}
        torsoLean={torsoTelemetry}
        cameraTurn={cameraTelemetry}
        usingKeyboard={usingKeyboard}
        connected={connected}
      />

      {/* Sandbox Control Center Floating Dock */}
      {matchState.snapshot?.mode === 'sandbox' && (
        <SandboxControlCenter
          isOpen={isSandboxOpen}
          onToggle={() => setIsSandboxOpen(v => !v)}
          snapshot={matchState.snapshot}
          selectedPalette={selectedPalette}
          onSelectPalette={setSelectedPalette}
          onSetFen={handleSetFen}
          onPlacePiece={handlePlacePiece}
          onFreeMove={handleFreeMove}
          onStartDuel={handleStartDuel}
          onUpdateConfig={handleUpdateConfig}
          onResetDuel={handleResetDuel}
          onExitDuel={handleExitDuel}
          onRespawnObstacles={handleRespawnObstacles}
        />
      )}

      {/* Promotion Choice Modal */}
      {matchState.promotionMove && (
        <PromotionModal
          onSelect={handlePromotionSelect}
          hoverChoice={matchState.promotionHover}
        />
      )}

      {/* Calibration Overlay */}
      {showCalibration && (
        <CalibrationOverlay
          videoRef={videoRef}
          lastFrameData={lastFrameData}
          initialProfile={calibrationProfile}
          onProfileChange={setCalibrationProfile}
          onComplete={handleCalibrationComplete}
        />
      )}

      {/* Lobby Screen */}
      {!matchState.snapshot && (
        <LobbyScreen
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          isLoading={isLoading}
          error={error}
          connected={connected}
        />
      )}
    </div>
  );
};
