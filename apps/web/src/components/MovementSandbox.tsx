import React, { useEffect, useRef, useState } from 'react';
import { bodyMetrics, type CalibrationProfile } from '../gestures/calibration.ts';
import { TorsoLeanController } from '../gestures/combatGestures.ts';
import type { VisionFrameData } from '../vision/visionManager.ts';

type Direction = 'Forward' | 'Backward' | 'Left' | 'Right' | 'Stop';
const directions: Direction[] = ['Forward', 'Backward', 'Left', 'Right', 'Stop'];

/** Uses the real movement controller without sending any game intents. */
export function MovementSandbox({ profile, frame, onCalibrate }: {
  profile: CalibrationProfile;
  frame: VisionFrameData | null;
  onCalibrate: () => void;
}) {
  const controller = useRef(new TorsoLeanController());
  const moved = useRef(false);
  const [intent, setIntent] = useState({ moveX: 0, moveZ: 0 });
  const [completed, setCompleted] = useState<Direction[]>([]);
  const [attempt, setAttempt] = useState(0);
  const ready = Boolean(profile.bodyCalibrated && profile.bodyBaseline);
  const tracked = Boolean(bodyMetrics(frame?.pose ?? null));

  useEffect(() => {
    controller.current.reset();
    moved.current = false;
    setCompleted([]);
    setIntent({ moveX: 0, moveZ: 0 });
  }, [profile.bodyBaseline, ready, attempt]);

  useEffect(() => {
    if (!frame) return;
    const movement = controller.current.update(frame.pose, profile, frame.timestamp);
    setIntent(movement);
    if (!ready || !bodyMetrics(frame.pose)) return;
    const detected: Direction[] = [];
    if (movement.moveZ < 0) detected.push('Forward');
    if (movement.moveZ > 0) detected.push('Backward');
    if (movement.moveX < 0) detected.push('Left');
    if (movement.moveX > 0) detected.push('Right');
    if (detected.length) moved.current = true;
    else if (moved.current) detected.push('Stop');
    setCompleted(previous => [...new Set([...previous, ...detected])]);
  }, [frame, ready, profile.bodyBaseline, attempt]);

  const active: Direction[] = [];
  if (intent.moveZ < 0) active.push('Forward');
  if (intent.moveZ > 0) active.push('Backward');
  if (intent.moveX < 0) active.push('Left');
  if (intent.moveX > 0) active.push('Right');
  const status = !ready ? 'Calibrate your neutral stance first' : !tracked ? 'Tracking lost — movement stopped' : active.length ? active.join(' + ') : 'Neutral — stopped';
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
      <div>
        <div role="status">{status}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {directions.map(direction => <span key={direction} style={{ padding: '4px 6px', borderRadius: 4, fontSize: 12, background: completed.includes(direction) ? '#065f46' : '#334155' }}>{completed.includes(direction) ? '✓ ' : '○ '}{direction}</span>)}
        </div>
        <p style={{ fontSize: 12 }}>{completed.length === directions.length ? 'All movement checks complete. Keep practicing or enter the match.' : 'Checks are optional. Stop is checked after moving and returning to neutral.'}</p>
        <button onClick={() => setAttempt(value => value + 1)}>Reset movement practice</button>{' '}
        <button onClick={onCalibrate}>Recalibrate body</button>
      </div>
    </div>
  </section>;
}
