import React from 'react';
import { bodyMetrics, type CalibrationProfile } from '../gestures/calibration.ts';
import type { Landmark3D } from '../vision/visionManager.ts';
export function BodyMovementGuide({profile,pose}:{profile:CalibrationProfile;pose:Landmark3D[]|null}) {
 const m=bodyMetrics(pose), b=profile.bodyBaseline;
 if(!profile.bodyCalibrated || !b) return <div>Calibrate your standing position to enable body movement.</div>;
 const dx=m?(m.noseX-b.noseX)/b.shoulderWidth:0, ratio=m?m.width/b.shoulderWidth:1;
 return <div style={{fontSize:12,color:'#e2e8f0',background:'#0f172a',padding:8}}>
   <div>{m?'Return to neutral to stop':'Face and shoulders not tracked — movement stopped'}</div>
   <div>Left ← Neutral → Right <meter min={-1.2} max={1.2} value={dx}/></div>
   <div>Back ← Neutral → Forward <meter min={0.5} max={1.5} value={ratio}/></div>
   <div>Neutral depth: 0.94–1.08 · Current: {ratio.toFixed(2)}</div>
 </div>;
}
