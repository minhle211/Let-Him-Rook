import React, { useEffect, useRef, useState } from 'react';
import { bodyMetrics, BodyCalibrationCapture, LeftHandCalibrationCapture, DEFAULT_MOVEMENT_SENSITIVITY, type CalibrationProfile } from '../gestures/calibration.ts';
import { movementThresholds, TorsoLeanController, LeftHandCameraController, type CameraTurnIntent } from '../gestures/combatGestures.ts';
import type { VisionFrameData } from '../vision/visionManager.ts';

type Direction = 'Forward' | 'Backward' | 'Left' | 'Right' | 'Stop';
const directions: Direction[] = ['Forward', 'Backward', 'Left', 'Right', 'Stop'];

/** Uses the real movement controller without sending any game intents. */
export function MovementSandbox({ profile, frame, onCalibrate, onChange }: {
  profile: CalibrationProfile;
  frame: VisionFrameData | null;
  onCalibrate: () => void;
  onChange: (profile: CalibrationProfile) => void;
}) {
  const controller = useRef(new TorsoLeanController());
  const cameraController = useRef(new LeftHandCameraController());
  const moved = useRef(false);
  const [intent, setIntent] = useState({ moveX: 0, moveZ: 0 });
  const [camIntent, setCamIntent] = useState<CameraTurnIntent>({ turnDir: 0, tilt: 0, active: false });
  const [completed, setCompleted] = useState<Direction[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [recentering, setRecentering] = useState(false);
  const [recenterMessage, setRecenterMessage] = useState('');
  const recenterCapture = useRef(new BodyCalibrationCapture(20));
  const [recenteringHand, setRecenteringHand] = useState(false);
  const [recenterHandMessage, setRecenterHandMessage] = useState('');
  const recenterHandCapture = useRef(new LeftHandCalibrationCapture(15));
  const ready = Boolean(profile.bodyCalibrated && profile.bodyBaseline);
  const tracked = Boolean(bodyMetrics(frame?.pose ?? null));

  useEffect(() => {
    if (!recentering) return;
    const timeout = window.setTimeout(() => {
      setRecentering(false);
      setRecenterMessage('Tracking was insufficient. Keep face and shoulders visible, then retry.');
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [recentering]);

  useEffect(() => {
    if (!recenteringHand) return;
    const timeout = window.setTimeout(() => {
      setRecenteringHand(false);
      setRecenterHandMessage('Hand tracking was insufficient. Hold left hand open with 5 fingers pointing at camera in view.');
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [recenteringHand]);

  useEffect(() => {
    controller.current.reset();
    cameraController.current.reset();
    moved.current = false;
    setCompleted([]);
    setIntent({ moveX: 0, moveZ: 0 });
  }, [profile.bodyBaseline, profile.movementSensitivity, profile.cameraBaselineTilt, ready, attempt]);

  useEffect(() => {
    if (!frame) return;
    if (recentering) {
      const result = recenterCapture.current.update(frame.pose, frame.timestamp);
      if (result) {
        setRecentering(false);
        if (result.error) setRecenterMessage('Stance moved too much. Hold still and retry.');
        else {
          setRecenterMessage('Neutral stance updated for this room.');
          onChange({ ...profile, bodyBaseline: result.baseline, neutralTorsoCenter: result.center, shoulderWidth: result.baseline.shoulderWidth, bodyCalibrated: true });
        }
      }
      return;
    }
    if (recenteringHand) {
      const result = recenterHandCapture.current.update(frame.hands, frame.pose, frame.timestamp);
      if (result) {
        setRecenteringHand(false);
        if (result.error) setRecenterHandMessage('Hand moved too much or 5 fingers not open. Hold steady and retry.');
        else {
          setRecenterHandMessage('Left hand neutral position (5 fingers open pointing at camera) calibrated.');
          onChange({ ...profile, cameraBaselineTilt: result.cameraBaselineTilt });
        }
      }
    }
    const movement = controller.current.update(frame.pose, profile, frame.timestamp);
    setIntent(movement);
    const cam = cameraController.current.update(frame.hands, frame.pose, frame.timestamp, profile);
    setCamIntent(cam);
    if (!ready || !bodyMetrics(frame.pose)) return;
    const detected: Direction[] = [];
    if (movement.moveZ < 0) detected.push('Forward');
    if (movement.moveZ > 0) detected.push('Backward');
    if (movement.moveX < 0) detected.push('Left');
    if (movement.moveX > 0) detected.push('Right');
    if (detected.length) moved.current = true;
    else if (moved.current) detected.push('Stop');
    setCompleted(previous => [...new Set([...previous, ...detected])]);
  }, [frame, ready, profile.bodyBaseline, profile.movementSensitivity, profile.cameraBaselineTilt, attempt, recentering, recenteringHand]);

  const active: Direction[] = [];
  if (intent.moveZ < 0) active.push('Forward');
  if (intent.moveZ > 0) active.push('Backward');
  if (intent.moveX < 0) active.push('Left');
  if (intent.moveX > 0) active.push('Right');
  const status = !ready ? 'Calibrate your neutral stance first' : !tracked ? 'Tracking lost — movement stopped' : active.length ? active.join(' + ') : 'Neutral — stopped';
  const thresholds = movementThresholds(profile.movementSensitivity);
  const sensitivity = { ...DEFAULT_MOVEMENT_SENSITIVITY, ...profile.movementSensitivity };
  return <section aria-label="Movement gesture sandbox" style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '0.8rem', marginBottom: '1rem', color: '#e2e8f0' }}>
    <strong>Movement Sandbox</strong>
    <p style={{ fontSize: '0.83rem', color: '#94a3b8' }}>Step forward, backward, left, and right. Return to your calibrated stance to stop. Try diagonals too. This preview does not move your fighter.</p>
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
        <div role="status">{status}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {directions.map(direction => <span key={direction} style={{ padding: '4px 6px', borderRadius: 4, fontSize: 12, background: completed.includes(direction) ? '#065f46' : '#334155' }}>{completed.includes(direction) ? '✓ ' : '○ '}{direction}</span>)}
        </div>
        <p style={{ fontSize: 12 }}>{completed.length === directions.length ? 'All movement checks complete. Keep practicing or enter the match.' : 'Checks are optional. Stop is checked after moving and returning to neutral.'}</p>
        <div style={{ marginBottom: 8 }}>
          {(['forward', 'backward', 'left', 'right', 'camera'] as const).map(direction => <label key={direction} style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {direction[0].toUpperCase() + direction.slice(1)} sensitivity — {sensitivity[direction].toFixed(2)}×
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span>Less movement needed</span>
              <input aria-label={`${direction} movement sensitivity`} type="range" min="0.05" max="3" step="0.05" value={sensitivity[direction]}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...profile, movementSensitivity: { ...sensitivity, [direction]: Number(event.target.value) } })}/>
              <span>More movement needed</span></div>
          </label>)}
          <div style={{ fontSize: 11, color: '#93c5fd' }}>Zones: forward ≥ {thresholds.forward.toFixed(2)}× · backward ≤ {thresholds.backward.toFixed(2)}× · left ≥ {thresholds.left.toFixed(2)}× · right ≥ {thresholds.right.toFixed(2)}× · camera tilt ≥ {Math.round(Math.asin(Math.min(1, thresholds.camera)) * 180 / Math.PI)}° (tilt left/right with 5 fingers open)</div>
        </div>
        <button onClick={() => onChange({ ...profile, movementSensitivity: { ...DEFAULT_MOVEMENT_SENSITIVITY } })}>Reset sensitivity</button>{' '}
        <button disabled={recentering} onClick={() => { recenterCapture.current = new BodyCalibrationCapture(20); setRecenterMessage('Stand comfortably still while recentering…'); setRecentering(true); }}>Recenter now</button>{' '}
        <button disabled={recenteringHand} onClick={() => { recenterHandCapture.current = new LeftHandCalibrationCapture(15); setRecenterHandMessage('Hold 5 fingers open pointing steady at camera…'); setRecenteringHand(true); }}>Recenter Left Hand (5 Fingers Open)</button>{' '}
        <span role="status">{recentering ? `${recenterCapture.current.samples.length}/20 frames` : recenteringHand ? `${recenterHandCapture.current.sampleCount}/15 frames` : recenterMessage || recenterHandMessage}</span><br/>
        <button onClick={() => setAttempt(value => value + 1)}>Reset movement practice</button>{' '}
        <button onClick={onCalibrate}>Recalibrate body</button>
      </div>
    </div>
  </section>;
}
