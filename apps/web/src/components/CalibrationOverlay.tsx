import React, { useEffect, useRef, useState } from 'react';
import type { PieceClass } from '@let-him-rook/shared';
import type { Landmark3D, VisionDiagnostics, VisionFrameData } from '../vision/visionManager.ts';
import {
  DEFAULT_CALIBRATION,
  clearSavedCalibration,
  computePinchRatio,
  computeTorsoMetrics,
  loadSavedCalibration,
  saveCalibrationProfile,
  type CalibrationProfile,
} from '../gestures/calibration.ts';
import { CombatGestureDetector, TorsoLeanController } from '../gestures/combatGestures.ts';

interface CalibrationOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  lastFrameData: VisionFrameData | null;
  onComplete: (profile: CalibrationProfile) => void;
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], // Shoulders
  [11, 13], [13, 15], // Left arm
  [12, 14], [14, 16], // Right arm
  [11, 23], [12, 24], [23, 24], // Torso
];

const SANDBOX_CLASSES: { id: PieceClass; label: string; hint: string }[] = [
  { id: 'pawn', label: '♙ Pawn', hint: 'Sweep right wrist horizontally across chest, or hold left open palm up to parry' },
  { id: 'rook', label: '♖ Rook', hint: 'Extend right arm straight forward to fire cannon shot; drop arm to re-arm' },
  { id: 'knight', label: '♘ Knight', hint: 'Cross both wrists at chest, then rapidly separate horizontally' },
  { id: 'bishop', label: '♗ Bishop', hint: 'Cock right hand near right shoulder, then thrust forward' },
  { id: 'queen', label: '♕ Queen', hint: 'Raise both hands to shoulder height and push forward together' },
  { id: 'king', label: '♔ King', hint: 'Clasp both hands together at chest center and hold for 0.4s' },
];

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  videoRef,
  lastFrameData,
  onComplete,
}) => {
  const savedProfile = loadSavedCalibration();
  const [step, setStep] = useState<'neutral' | 'pinch' | 'practice'>('neutral');
  const [torsoCenter, setTorsoCenter] = useState<{ x: number; y: number }>(
    savedProfile?.neutralTorsoCenter ?? DEFAULT_CALIBRATION.neutralTorsoCenter
  );
  const [shoulderWidth, setShoulderWidth] = useState<number>(
    savedProfile?.shoulderWidth ?? DEFAULT_CALIBRATION.shoulderWidth
  );
  const [pinchThresholds, setPinchThresholds] = useState<{ close: number; open: number }>(
    savedProfile?.pinchThresholds ?? DEFAULT_CALIBRATION.pinchThresholds
  );
  const [statusMessage, setStatusMessage] = useState<string>(
    savedProfile
      ? 'Saved personal calibration loaded. Recalibrate below or skip directly to match.'
      : 'Align your upper body and hands in the camera view.'
  );
  const [sandboxClass, setSandboxClass] = useState<PieceClass>('pawn');
  const [lastTriggeredAbility, setLastTriggeredAbility] = useState<{
    name: string;
    at: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestFrameRef = useRef<VisionFrameData | null>(lastFrameData);
  const sandboxDetectorRef = useRef(new CombatGestureDetector());
  const sandboxLeanRef = useRef(new TorsoLeanController());

  latestFrameRef.current = lastFrameData;

  const diagnostics: VisionDiagnostics = lastFrameData?.diagnostics ?? {
    fps: 0,
    inferenceMs: 0,
    isLowLight: false,
    isCroppedBody: false,
    isCroppedHands: false,
    isTrackingLost: true,
    workerStatus: 'loading',
  };

  const liveMetrics = computeTorsoMetrics(lastFrameData?.pose ?? null);
  const livePinchRatio = lastFrameData?.hands?.[0]
    ? computePinchRatio(lastFrameData.hands[0])
    : NaN;
  const isCurrentlyPinched =
    Number.isFinite(livePinchRatio) && livePinchRatio < pinchThresholds.close;

  // Live sandbox gesture evaluation
  useEffect(() => {
    if (step !== 'practice' || !lastFrameData) return;
    const profile: CalibrationProfile = {
      neutralTorsoCenter: torsoCenter,
      shoulderWidth,
      pinchThresholds,
      isCalibrated: true,
    };
    const res = sandboxDetectorRef.current.update(
      sandboxClass,
      lastFrameData.pose,
      lastFrameData.hands,
      profile,
      performance.now()
    );
    if (res) {
      const label =
        res.ability === 'pawn_parry'
          ? res.parryHolding
            ? 'PAWN PARRY (HOLD)'
            : 'PAWN PARRY (RELEASE)'
          : res.ability.toUpperCase().replace(/_/g, ' ');
      setLastTriggeredAbility({ name: label, at: Date.now() });
    }
  }, [step, lastFrameData, sandboxClass, torsoCenter, shoulderWidth, pinchThresholds]);

  // Render mirrored video + pose skeleton + hand landmarks on canvas
  useEffect(() => {
    let animId: number | null = null;

    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // 1. Draw mirrored webcam video
      const video = videoRef.current;
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
        ctx.font = '600 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for webcam stream...', w / 2, h / 2);
      }

      const frame = latestFrameRef.current;
      if (!frame) return;

      // 2. Draw calibrated neutral torso target crosshair
      const nx = torsoCenter.x * w;
      const ny = torsoCenter.y * h;
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(nx, ny, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 3. Draw Pose skeleton
      if (frame.pose && frame.pose.length > 16) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        for (const [i, j] of POSE_CONNECTIONS) {
          const a = frame.pose[i];
          const b = frame.pose[j];
          if (a && b && (a.visibility ?? 1) > 0.3 && (b.visibility ?? 1) > 0.3) {
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }

        for (const idx of [11, 12, 13, 14, 15, 16]) {
          const lm = frame.pose[idx];
          if (lm && (lm.visibility ?? 1) > 0.3) {
            ctx.fillStyle = idx === 15 || idx === 16 ? '#fbbf24' : '#38bdf8';
            ctx.beginPath();
            ctx.arc(lm.x * w, lm.y * h, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        const metrics = computeTorsoMetrics(frame.pose);
        if (metrics) {
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(metrics.center.x * w, metrics.center.y * h, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. Draw Hand skeletons & pinch line
      for (const hand of frame.hands) {
        if (!hand || hand.length < 21) continue;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        for (const [i, j] of HAND_CONNECTIONS) {
          ctx.beginPath();
          ctx.moveTo(hand[i].x * w, hand[i].y * h);
          ctx.lineTo(hand[j].x * w, hand[j].y * h);
          ctx.stroke();
        }

        // Thumb tip (4) and Index tip (8)
        const thumb = hand[4];
        const index = hand[8];
        const ratio = computePinchRatio(hand);
        const pinched = ratio < pinchThresholds.close;

        ctx.strokeStyle = pinched ? '#22c55e' : '#fbbf24';
        ctx.lineWidth = pinched ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(thumb.x * w, thumb.y * h);
        ctx.lineTo(index.x * w, index.y * h);
        ctx.stroke();

        for (let idx = 0; idx < hand.length; idx++) {
          const lm = hand[idx];
          ctx.fillStyle =
            idx === 8
              ? pinched
                ? '#22c55e'
                : '#fbbf24'
              : idx === 4
              ? '#f97316'
              : '#e2e8f0';
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, idx === 8 || idx === 4 ? 5 : 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [videoRef, torsoCenter, pinchThresholds]);

  const handleCaptureNeutral = () => {
    if (liveMetrics) {
      setTorsoCenter(liveMetrics.center);
      setShoulderWidth(liveMetrics.shoulderWidth);
      setStatusMessage(
        `Neutral pose captured! Shoulders centered at (${liveMetrics.center.x.toFixed(2)}, ${liveMetrics.center.y.toFixed(2)}).`
      );
      setStep('pinch');
      return;
    }
    setStatusMessage('Using default neutral torso center (no pose detected in frame).');
    setStep('pinch');
  };

  const handleCapturePinch = () => {
    if (Number.isFinite(livePinchRatio) && livePinchRatio > 0.03) {
      const close = Math.max(0.16, Math.min(0.48, Number((livePinchRatio * 1.22).toFixed(3))));
      const open = Math.max(close + 0.1, Math.min(0.68, Number((close * 1.38).toFixed(3))));
      setPinchThresholds({ close, open });
      setStatusMessage(`Pinch threshold calibrated (close: ${close}, release: ${open}).`);
    } else {
      setStatusMessage('Using default pinch thresholds (hold hand visible to customize).');
    }
    setStep('practice');
  };

  const handleRestoreDefaults = () => {
    clearSavedCalibration();
    setTorsoCenter(DEFAULT_CALIBRATION.neutralTorsoCenter);
    setShoulderWidth(DEFAULT_CALIBRATION.shoulderWidth);
    setPinchThresholds(DEFAULT_CALIBRATION.pinchThresholds);
    setStatusMessage('Default calibration settings restored.');
  };

  const handleFinish = () => {
    const profile: CalibrationProfile = {
      neutralTorsoCenter: torsoCenter,
      shoulderWidth,
      pinchThresholds,
      isCalibrated: true,
    };
    saveCalibrationProfile(profile);
    onComplete(profile);
  };

  const handleSkipWithDefaults = () => {
    const profile = savedProfile ?? {
      ...DEFAULT_CALIBRATION,
      isCalibrated: true,
    };
    onComplete(profile);
  };

  const sandboxLean =
    step === 'practice' && lastFrameData?.pose
      ? sandboxLeanRef.current.update(lastFrameData.pose, {
          neutralTorsoCenter: torsoCenter,
          shoulderWidth,
          pinchThresholds,
          isCalibrated: true,
        })
      : { moveX: 0, moveZ: 0 };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(13, 15, 24, 0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
        padding: '1rem',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          backgroundColor: '#171b2c',
          borderRadius: 16,
          padding: '1.5rem 2rem',
          border: '1px solid #2e3856',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc' }}>
            Vision & Gesture Calibration
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '0.78rem',
                padding: '0.2rem 0.6rem',
                borderRadius: 4,
                backgroundColor:
                  diagnostics.workerStatus === 'loading'
                    ? '#1d4ed8'
                    : diagnostics.workerStatus === 'error'
                    ? '#b91c1c'
                    : diagnostics.fps >= 15
                    ? '#15803d'
                    : '#b45309',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {diagnostics.workerStatus === 'loading'
                ? 'LOADING AI MODELS...'
                : diagnostics.workerStatus === 'error'
                ? 'WORKER ERROR'
                : `${diagnostics.fps} FPS (${diagnostics.inferenceMs}ms)`}
            </span>
            <span
              style={{
                fontSize: '0.78rem',
                padding: '0.2rem 0.6rem',
                borderRadius: 4,
                backgroundColor:
                  diagnostics.workerStatus === 'loading'
                    ? '#475569'
                    : diagnostics.workerStatus === 'error'
                    ? '#b91c1c'
                    : diagnostics.isTrackingLost
                    ? '#b45309'
                    : '#15803d',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {diagnostics.workerStatus === 'loading'
                ? 'INITIALIZING'
                : diagnostics.workerStatus === 'error'
                ? 'OFFLINE / REJECTED'
                : diagnostics.isTrackingLost
                ? 'NO POSE/HANDS IN VIEW'
                : 'TRACKING ACTIVE'}
            </span>
          </div>
        </div>

        {/* Worker Error Notification */}
        {diagnostics.workerStatus === 'error' && (
          <div
            style={{
              backgroundColor: 'rgba(185, 28, 28, 0.25)',
              border: '1px solid #ef4444',
              color: '#fecaca',
              padding: '0.6rem 0.9rem',
              borderRadius: 8,
              fontSize: '0.82rem',
              marginBottom: '0.75rem',
            }}
          >
            <strong>MediaPipe Warning:</strong> {diagnostics.workerError || 'Camera or AI tracking is unavailable.'}
            <div style={{ marginTop: '0.25rem', color: '#cbd5e1', fontSize: '0.75rem' }}>
              Ensure camera permissions are allowed in your browser. You can still play with mouse clicks and WASD keyboard controls.
            </div>
          </div>
        )}

        {/* Stepper Pills */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {(['neutral', 'pinch', 'practice'] as const).map((s, idx) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              style={{
                flex: 1,
                padding: '0.45rem',
                borderRadius: 6,
                border: step === s ? '1px solid #60a5fa' : '1px solid #334155',
                backgroundColor: step === s ? '#1e3a8a' : '#0f172a',
                color: step === s ? '#ffffff' : '#94a3b8',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {idx + 1}. {s === 'neutral' ? 'Neutral Pose' : s === 'pinch' ? 'Pinch Threshold' : 'Gesture Sandbox'}
            </button>
          ))}
        </div>

        {/* Live Video + Skeleton Overlay Canvas */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 270,
            backgroundColor: '#0f172a',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: '0.75rem',
            border: '1px solid #334155',
          }}
        >
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />

          {/* Diagnostic Warnings Banner (only shown once worker is ready) */}
          {diagnostics.workerStatus === 'ready' &&
            (diagnostics.isLowLight || (step === 'neutral' && diagnostics.isCroppedBody) || (step === 'pinch' && diagnostics.isCroppedHands)) && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  right: 8,
                  backgroundColor: 'rgba(180, 83, 9, 0.9)',
                  color: '#ffffff',
                  fontSize: '0.8rem',
                  padding: '0.35rem 0.75rem',
                  borderRadius: 6,
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                {diagnostics.isLowLight && '⚠️ Low lighting detected. '}
                {step === 'neutral' && diagnostics.isCroppedBody && '👋 Keep both shoulders visible in frame. '}
                {step === 'pinch' && diagnostics.isCroppedHands && '✋ Raise your hand into the camera view. '}
              </div>
            )}

          {/* Live Telemetry Overlay at bottom of video */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              right: 8,
              display: 'flex',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(15, 23, 42, 0.82)',
              padding: '0.35rem 0.75rem',
              borderRadius: 6,
              fontSize: '0.78rem',
              color: '#e2e8f0',
            }}
          >
            <span>
              Shoulders: <strong>{liveMetrics ? '✅ Visible' : '—'}</strong>
            </span>
            <span>
              Hands: <strong>{lastFrameData?.hands?.length || 0}</strong>
            </span>
            <span>
              Pinch:{' '}
              <strong style={{ color: isCurrentlyPinched ? '#4ade80' : '#fbbf24' }}>
                {Number.isFinite(livePinchRatio)
                  ? `${livePinchRatio.toFixed(2)} ${isCurrentlyPinched ? '(PINCHED)' : '(OPEN)'}`
                  : '—'}
              </strong>
            </span>
          </div>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#93c5fd', marginBottom: '0.9rem' }}>
          {statusMessage}
        </p>

        {/* Calibration Step 1: Neutral Pose */}
        {step === 'neutral' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <h3 style={{ fontSize: '1.05rem', color: '#60a5fa', margin: 0 }}>
                Step 1: Capture Neutral Upper-Body Pose
              </h3>
              <span
                style={{
                  fontSize: '0.78rem',
                  color: liveMetrics ? '#4ade80' : '#f59e0b',
                  fontWeight: 600,
                }}
              >
                {liveMetrics
                  ? `Body Detected (${liveMetrics.center.x.toFixed(2)}, ${liveMetrics.center.y.toFixed(2)})`
                  : 'Searching for shoulders...'}
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Sit comfortably centered in front of your webcam. Your neutral shoulder center sets the zero-point for 3D duel torso-lean movement.
            </p>

            {/* Quick manual alignment presets */}
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              <span>Manual Preset:</span>
              <button
                onClick={() => setTorsoCenter({ x: 0.5, y: 0.55 })}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                Default Center
              </button>
              <button
                onClick={() => setTorsoCenter(c => ({ ...c, x: Math.max(0.2, c.x - 0.05) }))}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                ◀ Left
              </button>
              <button
                onClick={() => setTorsoCenter(c => ({ ...c, x: Math.min(0.8, c.x + 0.05) }))}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                Right ▶
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleCaptureNeutral}
                style={{
                  flex: 2,
                  padding: '0.8rem',
                  borderRadius: 8,
                  backgroundColor: liveMetrics ? '#3b82f6' : '#2563eb',
                  color: '#ffffff',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {liveMetrics ? 'Capture Live Neutral Pose' : 'Continue with Default Center'}
              </button>
              <button
                onClick={handleSkipWithDefaults}
                style={{
                  flex: 1,
                  padding: '0.8rem',
                  borderRadius: 8,
                  backgroundColor: '#334155',
                  color: '#e2e8f0',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Skip to Match
              </button>
            </div>
          </div>
        )}

        {/* Calibration Step 2: Pinch Threshold */}
        {step === 'pinch' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <h3 style={{ fontSize: '1.05rem', color: '#c084fc', margin: 0 }}>
                Step 2: Calibrate Thumb-Index Pinch
              </h3>
              <span
                style={{
                  fontSize: '0.78rem',
                  color: Number.isFinite(livePinchRatio) ? (isCurrentlyPinched ? '#4ade80' : '#fbbf24') : '#f59e0b',
                  fontWeight: 600,
                }}
              >
                {Number.isFinite(livePinchRatio)
                  ? `Ratio: ${livePinchRatio.toFixed(2)} (${isCurrentlyPinched ? 'PINCHED' : 'OPEN'})`
                  : 'Hold hand up in view'}
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Touch thumb and index fingertips together, then click <strong>Capture Pinch Contact</strong> (or select a sensitivity preset below).
            </p>

            {/* Live Pinch Meter */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#cbd5e1', marginBottom: 4 }}>
                <span>Pinch Contact ({pinchThresholds.close})</span>
                <span>Release ({pinchThresholds.open})</span>
              </div>
              <div style={{ width: '100%', height: 10, backgroundColor: '#0f172a', borderRadius: 5, overflow: 'hidden', border: '1px solid #334155' }}>
                <div
                  style={{
                    width: `${
                      Number.isFinite(livePinchRatio)
                        ? Math.max(5, Math.min(100, (1 - Math.min(1, livePinchRatio)) * 100))
                        : 0
                    }%`,
                    height: '100%',
                    backgroundColor: isCurrentlyPinched ? '#22c55e' : '#8b5cf6',
                    transition: 'width 0.08s linear',
                  }}
                />
              </div>
            </div>

            {/* Sensitivity Presets */}
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              <span>Sensitivity Preset:</span>
              <button
                onClick={() => setPinchThresholds({ close: 0.32, open: 0.46 })}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  backgroundColor: pinchThresholds.close === 0.32 ? '#6b21a8' : '#1e293b',
                  border: '1px solid #475569',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                Strict (0.32)
              </button>
              <button
                onClick={() => setPinchThresholds({ close: 0.38, open: 0.52 })}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  backgroundColor: pinchThresholds.close === 0.38 ? '#6b21a8' : '#1e293b',
                  border: '1px solid #475569',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                Balanced (0.38)
              </button>
              <button
                onClick={() => setPinchThresholds({ close: 0.46, open: 0.60 })}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: 4,
                  backgroundColor: pinchThresholds.close === 0.46 ? '#6b21a8' : '#1e293b',
                  border: '1px solid #475569',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                Forgiving (0.46)
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleCapturePinch}
                style={{
                  flex: 2,
                  padding: '0.8rem',
                  borderRadius: 8,
                  backgroundColor: '#8b5cf6',
                  color: '#ffffff',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {Number.isFinite(livePinchRatio) ? 'Capture Pinch Contact' : 'Continue with Balanced Pinch'}
              </button>
              <button
                onClick={handleRestoreDefaults}
                style={{
                  flex: 1,
                  padding: '0.8rem',
                  borderRadius: 8,
                  backgroundColor: '#334155',
                  color: '#e2e8f0',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Restore Defaults
              </button>
            </div>
          </div>
        )}

        {/* Calibration Step 3: Live Gesture Sandbox */}
        {step === 'practice' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <h3 style={{ fontSize: '1.05rem', color: '#10b981' }}>
                Step 3: Interactive 6-Class Gesture Sandbox
              </h3>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                Lean: X={sandboxLean.moveX.toFixed(2)}, Z={sandboxLean.moveZ.toFixed(2)}
              </span>
            </div>

            {/* Class Selector Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.35rem', marginBottom: '0.6rem' }}>
              {SANDBOX_CLASSES.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSandboxClass(c.id);
                    sandboxDetectorRef.current.reset();
                  }}
                  style={{
                    padding: '0.4rem 0.2rem',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    border: sandboxClass === c.id ? '1px solid #10b981' : '1px solid #334155',
                    backgroundColor: sandboxClass === c.id ? '#064e3b' : '#0f172a',
                    color: '#f8fafc',
                    cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div
              style={{
                backgroundColor: '#0f172a',
                padding: '0.75rem',
                borderRadius: 8,
                marginBottom: '1rem',
                fontSize: '0.83rem',
                color: '#cbd5e1',
                border: '1px solid #1e293b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <div>
                <strong>How to trigger ({sandboxClass.toUpperCase()}):</strong>{' '}
                {SANDBOX_CLASSES.find(c => c.id === sandboxClass)?.hint}
              </div>
              {lastTriggeredAbility && Date.now() - lastTriggeredAbility.at < 3500 && (
                <span
                  style={{
                    backgroundColor: '#15803d',
                    color: '#ffffff',
                    padding: '0.3rem 0.6rem',
                    borderRadius: 6,
                    fontWeight: 800,
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ⚡ {lastTriggeredAbility.name}
                </span>
              )}
            </div>

            <button
              onClick={handleFinish}
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: 8,
                backgroundColor: '#10b981',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.95rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              I'm Ready — Enter 3D Match!
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
