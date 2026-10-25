import React, { useEffect, useRef, useState } from 'react';
import { bodyMetrics, DEFAULT_MOVEMENT_SENSITIVITY, type CalibrationProfile } from '../gestures/calibration.ts';
import { movementThresholds, TorsoLeanController, LeftHandCameraController, type CameraTurnIntent } from '../gestures/combatGestures.ts';
import type { VisionFrameData } from '../vision/visionManager.ts';

function sandboxButtonStyle(disabled = false): React.CSSProperties {
  return {
    padding: '0.7rem 0.85rem',
    borderRadius: 10,
    border: '1px solid #6ee7b7',
    fontSize: '0.88rem',
    fontWeight: 800,
    color: '#14532d',
    background: 'linear-gradient(180deg, #d1fae5, #86efac)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

/** Uses the real movement controller without sending any game intents. */
export function MovementSandbox({ profile, frame, onCalibrate, onChange }: {
  profile: CalibrationProfile;
  frame: VisionFrameData | null;
  onCalibrate: () => void;
  onChange: (profile: CalibrationProfile) => void;
}) {
  const controller = useRef(new TorsoLeanController());
  const cameraController = useRef(new LeftHandCameraController());
  const [intent, setIntent] = useState({ moveX: 0, moveZ: 0 });
  const [camIntent, setCamIntent] = useState<CameraTurnIntent>({ turnDir: 0, tilt: 0, active: false });
  const ready = Boolean(profile.bodyCalibrated && profile.bodyBaseline);
  const tracked = Boolean(bodyMetrics(frame?.pose ?? null));

  useEffect(() => {
    controller.current.reset();
    cameraController.current.reset();
    setIntent({ moveX: 0, moveZ: 0 });
  }, [profile.bodyBaseline, profile.movementSensitivity, profile.cameraBaselineTilt, ready]);

  useEffect(() => {
    if (!frame) return;
    const movement = controller.current.update(frame.pose, profile, frame.timestamp);
    setIntent(movement);
    const cam = cameraController.current.update(frame.hands, frame.pose, frame.timestamp, profile);
    setCamIntent(cam);
  }, [frame, profile, profile.bodyBaseline, profile.movementSensitivity, profile.cameraBaselineTilt]);

  const thresholds = movementThresholds(profile.movementSensitivity);
  const sensitivity = { ...DEFAULT_MOVEMENT_SENSITIVITY, ...profile.movementSensitivity };
  const diag = frame?.diagnostics;
  return <section aria-label="Movement gesture sandbox" style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '0.8rem', marginBottom: '1rem', color: '#e2e8f0' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <strong>Movement Sandbox</strong>
      <div aria-label="Latency and performance telemetry" style={{ display: 'flex', gap: 8, fontSize: 11, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '3px 8px', color: '#93c5fd' }}>
        <span>Vision: <strong>{diag?.fps ?? 0} FPS</strong></span>
        <span>·</span>
        <span>Worker: <strong>{diag?.inferenceMs ?? 0} ms</strong></span>
        <span>·</span>
        <span style={{ color: '#34d399' }}>Response: <strong>~{diag?.gestureLatencyMs ?? 18} ms (1€ + Lead)</strong></span>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div aria-label="Live movement direction" style={{ position: 'relative', width: 140, height: 100, background: '#1e293b', borderRadius: 8, border: '1px solid #475569' }}>
        <span style={{ position: 'absolute', top: 2, left: 42, fontSize: 11 }}>Forward</span>
        <span style={{ position: 'absolute', bottom: 2, left: 40, fontSize: 11 }}>Backward</span>
        <span style={{ position: 'absolute', top: 42, left: 3, fontSize: 11 }}>Left</span>
        <span style={{ position: 'absolute', top: 42, right: 3, fontSize: 11 }}>Right</span>
        <span style={{ position: 'absolute', left: `${50 + (tracked ? intent.moveX : 0) * 28}%`, top: `${50 + (tracked ? intent.moveZ : 0) * 28}%`, transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: '50%', background: ready && tracked ? '#34d399' : '#64748b' }}/>
      </div>
      <div aria-label="Left-hand camera aim preview" style={{ position: 'relative', width: 140, height: 100, background: '#1e293b', borderRadius: 8, border: '1px solid #475569', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6, textAlign: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd' }}>Left Hand Aim</span>
        <div style={{ fontSize: 18, margin: '4px 0' }}>
          {camIntent.turnDir === -1 ? '⟲ LEFT' : camIntent.turnDir === 1 ? '⟳ RIGHT' : '• NEUTRAL'}
        </div>
        <span style={{ fontSize: 10, color: camIntent.active ? (camIntent.turnDir !== 0 ? '#38bdf8' : '#4ade80') : '#64748b' }}>
          {camIntent.active ? `Tilt: ${Math.round(Math.asin(Math.max(-1, Math.min(1, camIntent.tilt))) * 180 / Math.PI)}°` : 'Open 5 fingers pointing at camera'}
        </span>
      </div>
      <div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Sensitivity</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-end' }}>
            {(['forward', 'backward', 'left', 'right', 'camera'] as const).map(direction => (
              <label key={direction} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0, fontSize: 12 }}>
                <span style={{ fontWeight: 800, textAlign: 'center', lineHeight: 1.2 }}>
                  {direction === 'camera' ? 'Camera sen' : direction[0].toUpperCase() + direction.slice(1)}
                </span>
                <span style={{ color: '#86efac', fontWeight: 700, margin: '2px 0 4px' }}>{sensitivity[direction].toFixed(2)}×</span>
                <span style={{ fontWeight: 800, color: '#86efac' }}>+</span>
                <input
                  aria-label={`${direction} movement sensitivity`}
                  type="range"
                  min="0.05"
                  max="3"
                  step="0.05"
                  value={sensitivity[direction]}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...profile, movementSensitivity: { ...sensitivity, [direction]: Number(event.target.value) } })}
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 28, height: 120, margin: '4px 0', accentColor: '#86efac' }}
                />
                <span style={{ fontWeight: 800, color: '#94a3b8' }}>−</span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#93c5fd', marginTop: 8 }}>Zones: forward ≥ {thresholds.forward.toFixed(2)}× · backward ≤ {thresholds.backward.toFixed(2)}× · left ≥ {thresholds.left.toFixed(2)}× · right ≥ {thresholds.right.toFixed(2)}× · camera tilt ≥ {Math.round(Math.asin(Math.min(1, thresholds.camera)) * 180 / Math.PI)}° (tilt left/right with 5 fingers open)</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button onClick={() => onChange({ ...profile, movementSensitivity: { ...DEFAULT_MOVEMENT_SENSITIVITY } })} style={sandboxButtonStyle()}>Reset sensitivity</button>
          <button onClick={onCalibrate} style={sandboxButtonStyle()}>Recalibrate body</button>
        </div>
      </div>
    </div>
  </section>;
}
