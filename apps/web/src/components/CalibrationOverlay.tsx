import { MovementSandbox } from './MovementSandbox.tsx';
import { CombinedCalibrationCapture, DEFAULT_MOVEMENT_SENSITIVITY } from '../gestures/calibration.ts';
import React, { useEffect, useRef, useState } from 'react';
import type { PieceClass } from '@let-him-rook/shared';
import type { Landmark3D, VisionDiagnostics, VisionFrameData } from '../vision/visionManager.ts';
import {
  DEFAULT_CALIBRATION,
  computePinchRatio,
  computeTorsoMetrics,
  loadSavedCalibration,
  type CalibrationProfile,
} from '../gestures/calibration.ts';
import { CombatGestureDetector } from '../gestures/combatGestures.ts';

interface CalibrationOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  lastFrameData: VisionFrameData | null;
  onComplete: (profile: CalibrationProfile, savedProfile?: CalibrationProfile) => void;
  initialProfile: CalibrationProfile;
  onProfileChange: (profile: CalibrationProfile) => void;
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
  { id: 'pawn', label: '♙ Pawn', hint: 'Stationary open right palm to parry; rapid right wrist sweep to slash (distinct gestures)' },
  { id: 'rook', label: '♖ Rook', hint: 'Extend right arm straight forward to fire cannon shot; drop arm to re-arm' },
  { id: 'knight', label: '♘ Knight', hint: 'Raise right hand above shoulder, then rapidly chop downward to cleave' },
  { id: 'bishop', label: '♗ Bishop', hint: 'Cock right hand near right shoulder, then thrust forward for ice bolt' },
  { id: 'queen', label: '♕ Queen', hint: 'Raise right open palm to shoulder height and hold for homing volley' },
  { id: 'king', label: '♔ King', hint: 'Hold closed right fist at chest center for 0.4s to summon ally' },
];

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  videoRef,
  lastFrameData,
  onComplete, initialProfile, onProfileChange,
}) => {
  const savedProfile = loadSavedCalibration();
  const savedBodyRef = useRef({
    baseline: savedProfile?.bodyBaseline,
    center: savedProfile?.neutralTorsoCenter ?? initialProfile.neutralTorsoCenter,
    shoulderWidth: savedProfile?.shoulderWidth ?? initialProfile.shoulderWidth,
  });
  const [bodyBaseline, setBodyBaseline] = useState(initialProfile.bodyBaseline);
  const [movementSensitivity, setMovementSensitivity] = useState(initialProfile.movementSensitivity ?? { ...DEFAULT_MOVEMENT_SENSITIVITY });
  const [cameraBaselineTilt, setCameraBaselineTilt] = useState<number | undefined>(initialProfile.cameraBaselineTilt ?? savedProfile?.cameraBaselineTilt ?? 0);
  const captureRef = useRef(new CombinedCalibrationCapture());
  const [captureStart, setCaptureStart] = useState<number | null>(null);
  const [clock, setClock] = useState(performance.now());
  const [captureError, setCaptureError] = useState('');
  useEffect(() => {
    if (captureStart === null) return;
    const id = window.setInterval(() => setClock(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [captureStart]);
  useEffect(() => {
    if (captureStart === null || !lastFrameData) return;
    captureRef.current.update(lastFrameData, lastFrameData.timestamp - captureStart, lastFrameData.timestamp);
  }, [captureStart, lastFrameData]);
  useEffect(() => {
    if (captureStart === null || clock < captureStart + 5000) return;
    const result = captureRef.current.finish();
    setCaptureStart(null);
    if (result.errors.length) { setCaptureError(result.errors.join(' ')); setStatusMessage('Calibration needs another try.'); return; }
    const baseline = result.baseline!;
    setBodyBaseline(baseline); setTorsoCenter(result.center!); setShoulderWidth(baseline.shoulderWidth);
    setPinchThresholds(result.pinch!);
    if (result.cameraBaselineTilt !== undefined) setCameraBaselineTilt(result.cameraBaselineTilt);
    savedBodyRef.current = { baseline, center: result.center!, shoulderWidth: baseline.shoulderWidth };
    setCaptureError(''); setStatusMessage('Body, pinch, and 5-finger open camera direction calibrated. Test movement and gestures below.'); setStep('practice');
  }, [clock, captureStart]);
  const [step, setStep] = useState<'neutral' | 'practice'>('neutral');
  const [torsoCenter, setTorsoCenter] = useState<{ x: number; y: number }>(
    initialProfile.neutralTorsoCenter ?? DEFAULT_CALIBRATION.neutralTorsoCenter
  );
  const [shoulderWidth, setShoulderWidth] = useState<number>(
    initialProfile.shoulderWidth ?? DEFAULT_CALIBRATION.shoulderWidth
  );
  const [pinchThresholds, setPinchThresholds] = useState<{ close: number; open: number }>(
    initialProfile.pinchThresholds ?? DEFAULT_CALIBRATION.pinchThresholds
  );
  const [, setStatusMessage] = useState<string>(
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
      bodyBaseline, bodyCalibrated: Boolean(bodyBaseline), movementSensitivity,
      cameraBaselineTilt,
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
  }, [step, lastFrameData, sandboxClass, torsoCenter, shoulderWidth, pinchThresholds, bodyBaseline]);

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
    captureRef.current = new CombinedCalibrationCapture();
    setCaptureError(''); setBodyBaseline(undefined);
    const start = performance.now() + 3000;
    setCaptureStart(start); setClock(performance.now());
    setStatusMessage('Get ready — calibration starts in 3 seconds.');
  };

  const handleFinish = () => {
    const profile: CalibrationProfile = {
      bodyBaseline, bodyCalibrated: Boolean(bodyBaseline), movementSensitivity,
      cameraBaselineTilt,
      neutralTorsoCenter: torsoCenter,
      shoulderWidth,
      pinchThresholds,
      isCalibrated: true,
    };
    onComplete(profile, {
      ...profile,
      bodyBaseline: savedBodyRef.current.baseline,
      bodyCalibrated: Boolean(savedBodyRef.current.baseline),
      neutralTorsoCenter: savedBodyRef.current.center,
      shoulderWidth: savedBodyRef.current.shoulderWidth,
      cameraBaselineTilt,
      movementSensitivity: undefined,
    });
  };

  const handleSkipWithDefaults = () => {
    const profile = initialProfile ?? savedProfile ?? {
      ...DEFAULT_CALIBRATION,
      isCalibrated: false,
    };
    onComplete(profile);
  };

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
          maxWidth: 820,
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
                : `${diagnostics.fps} FPS (${diagnostics.inferenceMs}ms${diagnostics.delegate ? ` · ${diagnostics.delegate}` : ''})`}
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

        {step === 'neutral' && (
        <img
          src="/calibration-gestures.png"
          alt="Neutral pose: right hand in an L, left hand fingertips at the camera. Pinch to pick up, swing the left hand to turn."
          style={{
            display: 'block',
            width: 'auto',
            maxWidth: '100%',
            maxHeight: 338,
            height: 'auto',
            margin: '0 auto 0.75rem',
            borderRadius: 12,
            border: '1px solid #31406b',
          }}
        />
        )}

        {/* Live Video + Skeleton Overlay Canvas */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 382,
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
            (diagnostics.isLowLight || (step === 'neutral' && (diagnostics.isCroppedBody || diagnostics.isCroppedHands))) && (
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
                {step === 'neutral' && diagnostics.isCroppedHands && '✋ Raise your hand into the camera view. '}
              </div>
            )}

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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setStep('neutral')}
            aria-current={step === 'neutral' ? 'step' : undefined}
            style={{
              padding: '0.7rem 0.8rem',
              borderRadius: 10,
              fontSize: '0.92rem',
              fontWeight: 800,
              cursor: 'pointer',
              color: step === 'neutral' ? '#14532d' : '#e2e8f0',
              background: step === 'neutral' ? 'linear-gradient(180deg, #d1fae5, #86efac)' : '#0f172a',
              border: step === 'neutral' ? '1px solid #6ee7b7' : '1px solid #334155',
            }}
          >
            1. Body + Pinch
          </button>
          <button
            onClick={() => setStep('practice')}
            aria-current={step === 'practice' ? 'step' : undefined}
            style={{
              padding: '0.7rem 0.8rem',
              borderRadius: 10,
              fontSize: '0.92rem',
              fontWeight: 800,
              cursor: 'pointer',
              color: step === 'practice' ? '#ecfdf5' : '#e2e8f0',
              background: step === 'practice' ? 'linear-gradient(180deg, #059669, #047857)' : '#0f172a',
              border: step === 'practice' ? '1px solid #34d399' : '1px solid #334155',
            }}
          >
            2. Gesture Sandbox
          </button>
        </div>

        {step === 'neutral' && <section style={{padding:16,background:'#1e293b',border:'2px solid #86efac',borderRadius:8,marginTop:10}}>
          <p style={{ marginTop: 0, marginBottom: 0, fontSize: '1.2rem', lineHeight: 1.45, color: '#f8fafc' }}>Keep your face and shoulders in the camera. Open all 5 fingers on your left hand pointing at the camera as the neutral position. Use your right hand for pinch calibration.</p>
          {captureStart !== null && (
          <div role="status" aria-live="polite" style={{fontSize:20,fontWeight:800,padding:12,background:'#14532d',color:'#d1fae5',borderRadius:6,marginTop:12,marginBottom:8}}>
            {clock < captureStart
              ? `Get ready — calibration starts in ${Math.ceil((captureStart-clock)/1000)} seconds. Open 5 fingers on left hand pointing at camera.`
              : clock < captureStart + 2500
                ? 'Left hand: 5 fingers open pointing at camera (neutral). Right hand: open palm.'
                : 'Keep left hand 5 fingers open pointing at camera. Right hand: pinch thumb and index together.'}
          </div>
          )}
          {captureStart !== null && clock >= captureStart && <progress aria-label="Calibration progress" value={Math.min(5000,clock-captureStart)} max={5000} style={{width:'100%',height:16}} />}
          {captureError && <p role="alert" style={{color:'#fecaca',fontWeight:700}}>{captureError}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              onClick={handleCaptureNeutral}
              disabled={captureStart !== null}
              style={{
                flex: 1,
                padding: '0.8rem 1rem',
                borderRadius: 10,
                border: 'none',
                fontSize: '0.95rem',
                fontWeight: 800,
                color: '#14532d',
                background: 'linear-gradient(180deg, #d1fae5, #86efac)',
                cursor: captureStart !== null ? 'not-allowed' : 'pointer',
                opacity: captureStart !== null ? 0.55 : 1,
              }}
            >
              {captureError ? 'Retry calibration' : 'Start 5-second calibration'}
            </button>
            <button
              onClick={handleSkipWithDefaults}
              style={{
                padding: '0.8rem 1rem',
                borderRadius: 10,
                border: '1px solid #475569',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Skip to Match
            </button>
          </div>
        </section>}

        {step === 'practice' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <h3 style={{ fontSize: '1.05rem', color: '#10b981' }}>
                Step 2: Movement & Ability Gesture Sandbox
              </h3>

            </div>

            <MovementSandbox
              profile={{ neutralTorsoCenter: torsoCenter, shoulderWidth, pinchThresholds,
                bodyBaseline, bodyCalibrated: Boolean(bodyBaseline), movementSensitivity, cameraBaselineTilt, isCalibrated: true }}
              frame={lastFrameData}
              onCalibrate={() => setStep('neutral')}
              onChange={profile => {
                setBodyBaseline(profile.bodyBaseline);
                setTorsoCenter(profile.neutralTorsoCenter);
                setShoulderWidth(profile.shoulderWidth);
                setMovementSensitivity(profile.movementSensitivity ?? { ...DEFAULT_MOVEMENT_SENSITIVITY });
                if (profile.cameraBaselineTilt !== undefined) setCameraBaselineTilt(profile.cameraBaselineTilt);
                onProfileChange(profile);
              }}
            />
            <h4 style={{ color: '#10b981', margin: '0 0 0.5rem' }}>Class Abilities</h4>
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
