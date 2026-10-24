import test from 'node:test';
import assert from 'node:assert/strict';
import {BodyCalibrationCapture,DEFAULT_CALIBRATION} from '../../apps/web/src/gestures/calibration.ts';
import {TorsoLeanController} from '../../apps/web/src/gestures/combatGestures.ts';
const pose=(width=.3,x=.5,y=.5)=>Array.from({length:33},(_,i)=>({x:i===11?.5-width/2:i===12?.5+width/2:x,y,z:0,visibility:1}));
const profile={...DEFAULT_CALIBRATION,bodyCalibrated:true,bodyBaseline:{version:1 as const,noseX:.5,shoulderWidth:.3}};
test('body capture averages 75 frames and rejects unstable stance',()=>{
 const capture=new BodyCalibrationCapture(); let result;
 for(let i=0;i<75;i++) result=capture.update(pose(),i*50);
 assert.ok(result&&!result.error); if(result&&!result.error) assert.ok(Math.abs(result.baseline.shoulderWidth-.3)<1e-6);
 for(let i=0;i<75;i++) result=capture.update(pose(.3,i%2?.4:.6),5000+i*50);
 assert.deepEqual(result,{error:true});
});
test('depth movement persists, normalizes diagonals, ignores height and stops on tracking loss',()=>{
 const c=new TorsoLeanController();
 assert.deepEqual(c.update(pose(.3,.5,.7),profile,0),{moveX:0,moveZ:0});
 let move;
 for(let t=50;t<=1000;t+=50) move=c.update(pose(.4,.75),profile,t);
 assert.ok(move!.moveX>0&&move!.moveZ<0); assert.ok(Math.abs(Math.hypot(move!.moveX,move!.moveZ)-1)<1e-6);
 assert.deepEqual(c.update(null,profile,1050),{moveX:0,moveZ:0});
 c.reset(); assert.deepEqual(c.update(pose(),profile,2000),{moveX:0,moveZ:0});
 for(let t=2050;t<=3000;t+=50) move=c.update(pose(.2),profile,t);
 assert.equal(move!.moveZ,1);
 for(let t=3050;t<=4000;t+=50) move=c.update(pose(),profile,t);
 assert.deepEqual(move,{moveX:0,moveZ:0});
});

test('combined calibration uses five-second open then pinch window', async () => {
  const { CombinedCalibrationCapture } = await import('../../apps/web/src/gestures/calibration.ts');
  const capture = new CombinedCalibrationCapture();
  const hand = (ratio: number) => Array.from({ length: 21 }, (_, i) => ({
    x: i === 0 ? .3 : i === 5 ? .4 : i === 4 ? .5 : i === 8 ? .5 + ratio * .1 : .45,
    y: .5, z: 0, visibility: 1,
  }));
  for (let i = 0; i < 100; i++) capture.update({ pose: pose(), hands: [hand(i < 50 ? 1 : .1)] }, i * 50, i * 50);
  capture.update({ pose: pose(.7), hands: [hand(1)] }, 5100, 5100);
  const result = capture.finish();
  assert.deepEqual(result.errors, []);
  assert.ok(result.baseline && Math.abs(result.baseline.shoulderWidth - .3) < 1e-6);
  assert.ok(result.pinch && result.pinch.close < result.pinch.open);
});

test('combined calibration identifies bad stance and missing hand separately', async () => {
  const { CombinedCalibrationCapture } = await import('../../apps/web/src/gestures/calibration.ts');
  const capture = new CombinedCalibrationCapture();
  for (let i = 0; i < 100; i++) capture.update({ pose: pose(i % 2 ? .3 : .5), hands: [] }, i * 50, i * 50);
  const result = capture.finish();
  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join(' '), /stance moved|Hand tracking/);
});

test('direction-specific sensitivity changes only its threshold and resets active direction', async () => {
  const { movementThresholds } = await import('../../apps/web/src/gestures/combatGestures.ts');
  const defaultThresholds = movementThresholds(undefined);
  const tunedThresholds = movementThresholds({ forward: .5, backward: 1, left: 1, right: 1.5 });
  assert.ok(tunedThresholds.forward < defaultThresholds.forward);
  assert.ok(tunedThresholds.right > defaultThresholds.right);
  assert.equal(tunedThresholds.left, defaultThresholds.left);
  assert.equal(tunedThresholds.backward, defaultThresholds.backward);
  const controller = new TorsoLeanController();
  let intent;
  for (let t = 0; t <= 800; t += 50) intent = controller.update(pose(.4), profile, t);
  assert.equal(intent!.moveZ, -1);
  assert.deepEqual(controller.update(pose(.4), { ...profile, movementSensitivity: { forward: .5, backward: 1, left: 1, right: 1 } }, 850), { moveX: 0, moveZ: 0 });
  const recentered = { ...profile, bodyBaseline: { version: 1 as const, noseX: .5, shoulderWidth: .4 } };
  assert.deepEqual(controller.update(pose(.4), recentered, 900), { moveX: 0, moveZ: 0 });
});
