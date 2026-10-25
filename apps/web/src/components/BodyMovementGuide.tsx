import React from 'react';
import { bodyMetrics, computeEffectiveDepthRatio, type CalibrationProfile } from '../gestures/calibration.ts';
import type { Landmark3D } from '../vision/visionManager.ts';
import { movementThresholds, type CameraTurnIntent } from '../gestures/combatGestures.ts';

export function BodyMovementGuide({
  profile,
  pose,
  cameraTurn,
}: {
  profile: CalibrationProfile;
  pose: Landmark3D[] | null;
  cameraTurn?: CameraTurnIntent;
}) {
  const m = bodyMetrics(pose), b = profile.bodyBaseline;
  if (!profile.bodyCalibrated || !b) return <div style={{fontSize:12,color:'#e2e8f0',background:'#0f172a',padding:8}}>Calibrate your standing position to enable body movement.</div>;
  const dx = m ? (m.noseX - b.noseX) / b.shoulderWidth : 0, ratio = m ? computeEffectiveDepthRatio(m, b) : 1;
  const thresholds = movementThresholds(profile.movementSensitivity);

  const turnLabel = !cameraTurn || !cameraTurn.active
    ? '5 fingers not open / lowered'
    : cameraTurn.turnDir === -1
    ? '⟲ TURNING LEFT'
    : cameraTurn.turnDir === 1
    ? '⟳ TURNING RIGHT'
    : 'Aiming steady (neutral)';

  const turnColor = !cameraTurn || !cameraTurn.active
    ? '#94a3b8'
    : cameraTurn.turnDir !== 0
    ? '#38bdf8'
    : '#4ade80';

  return (
    <div style={{ fontSize: 12, color: '#e2e8f0', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 8 }}>
      <div>{m ? 'Return to neutral to stop' : 'Face and shoulders not tracked — movement stopped'}</div>
      <div>Left ← Neutral → Right <meter min={-1.2} max={1.2} value={dx} /></div>
      <div>Back ← Neutral → Forward <meter min={0.5} max={1.5} value={ratio} /></div>
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #1e293b' }}>
        <span>Camera Direction: </span>
        <strong style={{ color: turnColor }}>{turnLabel}</strong>
        {cameraTurn?.active && (
          <div>Tilt: Left ← <meter min={-1} max={1} value={cameraTurn.tilt} /> → Right</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
        Open 5 fingers pointing at camera (neutral); tilt left/right to steer • Q / E keys
      </div>
    </div>
  );
}
