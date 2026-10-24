import React from 'react';
import { bodyMetrics, type CalibrationProfile } from '../gestures/calibration.ts';
import type { Landmark3D } from '../vision/visionManager.ts';
import { movementThresholds } from '../gestures/combatGestures.ts';
export function BodyMovementGuide({profile,pose}:{profile:CalibrationProfile;pose:Landmark3D[]|null}) {
 const m=bodyMetrics(pose), b=profile.bodyBaseline;
 if(!profile.bodyCalibrated || !b) return <div>Calibrate your standing position to enable body movement.</div>;
 const dx=m?(m.noseX-b.noseX)/b.shoulderWidth:0, ratio=m?m.width/b.shoulderWidth:1;
 const thresholds=movementThresholds(profile.movementSensitivity);
 return <div style={{fontSize:12,color:'#e2e8f0',background:'#0f172a',padding:8}}>
   <div>{m?'Return to neutral to stop':'Face and shoulders not tracked — movement stopped'}</div>
   <div>Left ← Neutral → Right <meter min={-1.2} max={1.2} value={dx}/></div>
   <div>Back ← Neutral → Forward <meter min={0.5} max={1.5} value={ratio}/></div>
   <div>Start zones: left ≤ −{thresholds.left.toFixed(2)} · right ≥ {thresholds.right.toFixed(2)} · back ≤ {thresholds.backward.toFixed(2)} · forward ≥ {thresholds.forward.toFixed(2)}</div>
   <div>Current depth: {ratio.toFixed(2)} · Return to neutral to stop</div>
 </div>;
}
