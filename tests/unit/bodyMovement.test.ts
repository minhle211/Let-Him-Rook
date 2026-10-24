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

test('movementThresholds scales camera sensitivity across 0.05x to 3.0x and safely clamps backward', async () => {
  const { movementThresholds } = await import('../../apps/web/src/gestures/combatGestures.ts');
  const lowSens = movementThresholds({ camera: 0.05, backward: 0.05 });
  const midSens = movementThresholds({ camera: 1.0, backward: 1.0 });
  const highSens = movementThresholds({ camera: 3.0, backward: 3.0 });

  assert.ok(lowSens.camera < midSens.camera);
  assert.ok(midSens.camera < highSens.camera);
  assert.ok(lowSens.cameraRelease < lowSens.camera);
  assert.ok(midSens.cameraRelease < midSens.camera);
  assert.ok(highSens.cameraRelease < highSens.camera);

  // Backward clamping safety across full 0.05x to 3.0x range
  assert.ok(lowSens.backward < lowSens.backwardRelease);
  assert.ok(midSens.backward < midSens.backwardRelease);
  assert.ok(highSens.backward < highSens.backwardRelease);
  assert.ok(highSens.backward >= 0.40);
  assert.ok(lowSens.backward <= 0.95);
});

test('LeftHandCalibrationCapture captures 15 steady frames with 5 fingers open and rejects curled or unstable hand', async () => {
  const { LeftHandCalibrationCapture } = await import('../../apps/web/src/gestures/calibration.ts');
  const capture = new LeftHandCalibrationCapture(15);

  const makeLeftHand = (tiltX: number, open = true) => {
    const hand = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.6, z: 0 }));
    hand[0] = { x: 0.3, y: 0.75, z: 0 }; // Wrist
    hand[2] = { x: 0.25 + tiltX * 0.4, y: 0.65, z: 0 }; // Thumb MCP
    hand[5] = { x: 0.28 + tiltX * 0.5, y: 0.60, z: 0 }; // Index MCP
    hand[9] = { x: 0.30 + tiltX * 0.5, y: 0.58, z: 0 }; // Middle MCP
    hand[13] = { x: 0.33 + tiltX * 0.5, y: 0.60, z: 0 };// Ring MCP
    hand[17] = { x: 0.35 + tiltX * 0.5, y: 0.62, z: 0 };// Pinky MCP

    if (open) {
      hand[4] = { x: 0.22 + tiltX, y: 0.50, z: 0 }; // Thumb tip
      hand[8] = { x: 0.27 + tiltX, y: 0.38, z: 0 }; // Index tip
      hand[12] = { x: 0.30 + tiltX, y: 0.35, z: 0 };// Middle tip
      hand[16] = { x: 0.33 + tiltX, y: 0.38, z: 0 };// Ring tip
      hand[20] = { x: 0.36 + tiltX, y: 0.42, z: 0 };// Pinky tip
    } else {
      hand[4] = { x: 0.3, y: 0.68, z: 0 };
      hand[8] = { x: 0.3, y: 0.68, z: 0 };
      hand[12] = { x: 0.3, y: 0.68, z: 0 };
      hand[16] = { x: 0.3, y: 0.68, z: 0 };
      hand[20] = { x: 0.3, y: 0.68, z: 0 };
    }
    return hand;
  };

  // Curled hand (not 5 fingers open) is rejected (returns null)
  assert.equal(capture.update([makeLeftHand(0.02, false)], null, 500), null);

  // Steady 5-finger open hand: tiltX = 0.02
  let result = null;
  for (let i = 0; i < 15; i++) {
    result = capture.update([makeLeftHand(0.02)], null, 1000 + i * 50);
  }
  assert.ok(result && !result.error);
  if (result && !result.error) {
    assert.ok(typeof result.cameraBaselineTilt === 'number');
    assert.ok(Math.abs(result.cameraBaselineTilt) < 0.2);
  }

  // Unstable wobbling hand (std > 0.15)
  const unstableCapture = new LeftHandCalibrationCapture(15);
  let unstableResult = null;
  for (let i = 0; i < 15; i++) {
    unstableResult = unstableCapture.update([makeLeftHand(i % 2 === 0 ? -0.15 : 0.15)], null, 2000 + i * 50);
  }
  assert.deepEqual(unstableResult, { error: true });
});

test('CombinedCalibrationCapture rejects unstable left hand tilt when hand moves excessively', async () => {
  const { CombinedCalibrationCapture } = await import('../../apps/web/src/gestures/calibration.ts');
  const capture = new CombinedCalibrationCapture();

  const makeLeftTiltHand = (tiltX: number) => {
    const hand = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.6, z: 0 }));
    hand[0] = { x: 0.3, y: 0.75, z: 0 }; // Wrist
    hand[2] = { x: 0.25 + tiltX * 0.4, y: 0.65, z: 0 };
    hand[5] = { x: 0.28 + tiltX * 0.5, y: 0.60, z: 0 };
    hand[9] = { x: 0.30 + tiltX * 0.5, y: 0.58, z: 0 };
    hand[13] = { x: 0.33 + tiltX * 0.5, y: 0.60, z: 0 };
    hand[17] = { x: 0.35 + tiltX * 0.5, y: 0.62, z: 0 };
    hand[4] = { x: 0.22 + tiltX, y: 0.50, z: 0 };
    hand[8] = { x: 0.27 + tiltX, y: 0.38, z: 0 };
    hand[12] = { x: 0.30 + tiltX, y: 0.35, z: 0 };
    hand[16] = { x: 0.33 + tiltX, y: 0.38, z: 0 };
    hand[20] = { x: 0.36 + tiltX, y: 0.42, z: 0 };
    return hand;
  };

  const pinchHand = (ratio: number) => Array.from({ length: 21 }, (_, i) => ({
    x: i === 0 ? .7 : i === 5 ? .75 : i === 4 ? .8 : i === 8 ? .8 + ratio * .1 : .78,
    y: .5, z: 0, visibility: 1,
  }));

  for (let i = 0; i < 100; i++) {
    // Wobble left hand wildly between -0.35 and +0.35
    const tilt = i % 2 === 0 ? -0.35 : 0.35;
    const testPose = pose();
    testPose[15] = { x: 0.3, y: 0.7, z: 0, visibility: 1 };
    testPose[16] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
    capture.update(
      { pose: testPose, hands: [makeLeftTiltHand(tilt), pinchHand(i < 50 ? 1 : .1)] },
      i * 50,
      i * 50
    );
  }

  const result = capture.finish();
  assert.ok(result.errors.length > 0);
  assert.match(result.errors.join(' '), /Left hand moved too much/);
});


