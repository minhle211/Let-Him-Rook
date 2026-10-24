import {
  LEAN_DEADZONE,
  type AbilityType,
  type PieceClass,
} from '@let-him-rook/shared';
import type { Landmark3D } from '../vision/visionManager.ts';
import {
  bodyMetrics,
  computeTorsoMetrics,
  computeWholeHandTilt,
  findLeftHand,
  findRightHand,
  DEFAULT_MOVEMENT_SENSITIVITY,
  isOpenPalm,
  type CalibrationProfile,
} from './calibration.ts';

export interface CombatMovementIntent {
  moveX: number;
  moveZ: number;
}

export interface CombatAbilityIntent {
  ability: AbilityType;
  parryHolding?: boolean;
}

export interface CameraTurnIntent {
  turnDir: -1 | 0 | 1;
  tilt: number;
  active: boolean;
}

export const LEFT_CAMERA_GESTURE = {
  tiltActivate: 0.45,
  tiltRelease: 0.26,
  smoothingMs: 90,
  activationMs: 120,
};

export class LeftHandCameraController {
  private lastTime = -Infinity;
  private smoothedTilt = 0;
  private turnDir: -1 | 0 | 1 = 0;
  private candidateDir: -1 | 0 | 1 = 0;
  private candidateSince = 0;

  public reset(): void {
    this.lastTime = -Infinity;
    this.smoothedTilt = 0;
    this.turnDir = 0;
    this.candidateDir = 0;
    this.candidateSince = 0;
  }

  public update(
    hands: Landmark3D[][],
    pose: Landmark3D[] | null,
    now = performance.now(),
    calibration?: CalibrationProfile
  ): CameraTurnIntent {
    // 1. Guard against two-handed abilities (crossed/clasped wrists)
    if (pose && pose[15] && pose[16]) {
      const wristDist = Math.hypot(pose[15].x - pose[16].x, pose[15].y - pose[16].y);
      if (wristDist < 0.14) {
        this.reset();
        return { turnDir: 0, tilt: 0, active: false };
      }
    }

    // 2. Find left hand
    const leftHand = findLeftHand(hands, pose);
    if (!leftHand) {
      if (now - this.lastTime > 250) {
        this.reset();
      }
      return { turnDir: 0, tilt: 0, active: false };
    }

    // 3. Compute whole-hand tilt
    const rawTiltValue = computeWholeHandTilt(leftHand);
    if (rawTiltValue === null) {
      if (now - this.lastTime > 250) {
        this.reset();
      }
      return { turnDir: 0, tilt: 0, active: false };
    }

    // 4. Subtract calibrated baseline tilt and clamp to [-1, 1]
    const baseline = calibration?.cameraBaselineTilt ?? 0;
    const rawTilt = Math.max(-1, Math.min(1, rawTiltValue - baseline));

    if (now - this.lastTime > 300) {
      this.smoothedTilt = rawTilt;
    } else {
      const alpha = 1 - Math.exp(-(now - this.lastTime) / LEFT_CAMERA_GESTURE.smoothingMs);
      this.smoothedTilt += alpha * (rawTilt - this.smoothedTilt);
    }
    this.lastTime = now;

    // 5. Sensitivity-scaled thresholds
    const thresholds = movementThresholds(calibration?.movementSensitivity);
    const tiltActivate = thresholds.camera;
    const tiltRelease = thresholds.cameraRelease;

    // Desired turn direction with hysteresis
    let desired: -1 | 0 | 1 = 0;
    if (this.turnDir === -1) {
      desired = this.smoothedTilt >= -tiltRelease ? 0 : -1;
    } else if (this.turnDir === 1) {
      desired = this.smoothedTilt <= tiltRelease ? 0 : 1;
    } else {
      if (this.smoothedTilt <= -tiltActivate) {
        desired = -1;
      } else if (this.smoothedTilt >= tiltActivate) {
        desired = 1;
      }
    }

    // Debounce
    if (desired !== this.candidateDir) {
      this.candidateDir = desired;
      this.candidateSince = now;
    }

    if (desired === 0) {
      this.turnDir = 0;
    } else if (now - this.candidateSince >= LEFT_CAMERA_GESTURE.activationMs) {
      this.turnDir = desired;
    }

    return {
      turnDir: this.turnDir,
      tilt: this.smoothedTilt,
      active: true,
    };
  }
}

export const BODY_MOVEMENT = { forward:1.20, forwardRelease:1.08, backward:0.85, backwardRelease:0.94, lateral:0.60, lateralRelease:0.40, smoothingMs:100, activationMs:100 };
export function movementThresholds(sensitivity: CalibrationProfile['movementSensitivity']) {
  const s = { ...DEFAULT_MOVEMENT_SENSITIVITY, ...sensitivity };
  const cameraSens = typeof s.camera === 'number' && Number.isFinite(s.camera) ? s.camera : 1;
  const camera = Math.max(0.12, Math.min(0.75, LEFT_CAMERA_GESTURE.tiltActivate * cameraSens));
  const cameraRelease = Math.max(0.06, Math.min(camera - 0.05, LEFT_CAMERA_GESTURE.tiltRelease * cameraSens));
  return {
    forward: 1 + 0.20 * s.forward,
    forwardRelease: 1 + 0.08 * s.forward,
    backward: Math.max(0.40, Math.min(0.95, 1 - 0.15 * s.backward)),
    backwardRelease: Math.max(0.50, Math.min(0.98, 1 - 0.06 * s.backward)),
    left: 0.60 * s.left,
    leftRelease: 0.40 * s.left,
    right: 0.60 * s.right,
    rightRelease: 0.40 * s.right,
    camera,
    cameraRelease,
  };
}
export class TorsoLeanController {
  private last = -Infinity;
  private x = 0;
  private width = 0;
  private axes = [0,0];
  private candidates = [0,0];
  private since = [0,0];
  private profile = '';
  reset() { this.last=-Infinity; this.axes=[0,0]; this.candidates=[0,0]; }
  update(pose: Landmark3D[] | null, calibration: CalibrationProfile, now = performance.now()): CombatMovementIntent {
    const key = JSON.stringify([calibration.bodyBaseline, calibration.movementSensitivity]);
    if (key !== this.profile) { this.reset(); this.profile=key; }
    const m = bodyMetrics(pose), base = calibration.bodyBaseline;
    if (!m || !base || !calibration.bodyCalibrated) { this.reset(); return {moveX:0,moveZ:0}; }
    if (now-this.last>300) { this.reset(); this.x=m.noseX; this.width=m.width; }
    const alpha=1-Math.exp(-(now-this.last)/BODY_MOVEMENT.smoothingMs);
    this.x+=alpha*(m.noseX-this.x); this.width+=alpha*(m.width-this.width); this.last=now;
    const x=(this.x-base.noseX)/base.shoulderWidth, r=this.width/base.shoulderWidth;
    const t = movementThresholds(calibration.movementSensitivity);
    const desired=[x>=t.right?1:x<=-t.left?-1:0,r>=t.forward?-1:r<=t.backward?1:0];
    const release=[this.axes[0]>0?x<=t.rightRelease:this.axes[0]<0?x>=-t.leftRelease:true,this.axes[1]<0?r<=t.forwardRelease:this.axes[1]>0?r>=t.backwardRelease:true];
    for(let i=0;i<2;i++) {
      if(release[i]) this.axes[i]=0;
      if(desired[i]!==this.candidates[i]) {this.candidates[i]=desired[i];this.since[i]=now;}
      if(desired[i] && now-this.since[i]>=BODY_MOVEMENT.activationMs) this.axes[i]=desired[i];
    }
    const length=Math.max(1,Math.hypot(...this.axes));
    return {moveX:this.axes[0]/length,moveZ:this.axes[1]/length};
  }
}

export class CombatGestureDetector {
  private state: 'IDLE' | 'CANDIDATE' | 'ACTIVE' | 'WAIT_RELEASE' = 'IDLE';
  private candidateFrames: number = 0;
  private candidateStartedAt: number = 0;
  private isParryActive: boolean = false;
  private lastSlashAt: number = 0;
  private prevWristPos: { x: number; y: number } | null = null;
  private prevWristTime: number = 0;

  public update(
    pieceClass: PieceClass,
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    calibration: CalibrationProfile,
    now = performance.now()
  ): CombatAbilityIntent | null {
    switch (pieceClass) {
      case 'pawn':
        return this.updatePawn(pose, hands, now);
      case 'rook':
        return this.updateRook(pose, hands, now);
      case 'knight':
        return this.updateKnight(pose, hands, now);
      case 'bishop':
        return this.updateBishop(pose, hands, now);
      case 'queen':
        return this.updateQueen(pose, hands, now);
      case 'king':
        return this.updateKing(pose, hands, now);
      default:
        return null;
    }
  }

  private updatePawn(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[16]) {
      if (this.isParryActive) {
        this.isParryActive = false;
        return { ability: 'pawn_parry', parryHolding: false };
      }
      return null;
    }

    const wrist = pose[16];
    let vx = 0;
    if (this.prevWristPos) {
      const dt = this.prevWristTime > 0 && now - this.prevWristTime <= 300
        ? (now - this.prevWristTime) / 1000
        : 0.05;
      vx = (wrist.x - this.prevWristPos.x) / (dt || 0.05);
    }
    this.prevWristPos = { x: wrist.x, y: wrist.y };
    this.prevWristTime = now;

    const rightHand = findRightHand(hands, pose);
    const isRightPalmOpen = rightHand ? isOpenPalm(rightHand) : false;

    // 1. If currently parrying
    if (this.isParryActive) {
      if (!isRightPalmOpen || Math.abs(vx) >= 1.2) {
        this.isParryActive = false;
        return { ability: 'pawn_parry', parryHolding: false };
      }
      return null;
    }

    // 2. Parry activation: stationary open right palm, IDLE state, >= 200ms after last slash
    if (isRightPalmOpen && Math.abs(vx) < 1.2 && this.state === 'IDLE' && now - this.lastSlashAt >= 200) {
      this.isParryActive = true;
      return { ability: 'pawn_parry', parryHolding: true };
    }

    // 3. Slash activation: rapid horizontal right wrist sweep while NOT parrying
    if (Math.abs(vx) > 3.0) {
      if (this.state === 'IDLE') {
        this.state = 'WAIT_RELEASE';
        this.lastSlashAt = now;
        return { ability: 'pawn_sweep' };
      }
    } else if (Math.abs(vx) < 1.0) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateRook(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[14] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rElbow = pose[14];
    const rWrist = pose[16];

    // Arm extended forward: distance from shoulder to wrist is near full extension
    const armLen =
      Math.hypot(rShoulder.x - rElbow.x, rShoulder.y - rElbow.y) +
      Math.hypot(rElbow.x - rWrist.x, rElbow.y - rWrist.y);
    const directDist = Math.hypot(rShoulder.x - rWrist.x, rShoulder.y - rWrist.y);
    const isExtended = directDist / (armLen || 1) > 0.85;

    if (this.state === 'IDLE' && isExtended) {
      this.candidateFrames++;
      if (this.candidateFrames >= 3) {
        this.state = 'WAIT_RELEASE';
        this.candidateFrames = 0;
        return { ability: 'rook_shot' };
      }
    } else if (this.state === 'WAIT_RELEASE' && !isExtended) {
      this.state = 'IDLE';
    } else if (!isExtended) {
      this.candidateFrames = 0;
    }

    return null;
  }

  private updateKnight(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rWrist = pose[16];

    // Arm (CANDIDATE) when right wrist is raised above right shoulder (wrist.y < shoulder.y - 0.05)
    if (this.state === 'IDLE' && rWrist.y < rShoulder.y - 0.05) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      // Rapid downward chop: rWrist chops below shoulder (wrist.y > shoulder.y + 0.18) within 600ms
      if (rWrist.y > rShoulder.y + 0.18 && now - this.candidateStartedAt < 600) {
        this.state = 'WAIT_RELEASE';
        return { ability: 'knight_cleave' };
      } else if (now - this.candidateStartedAt >= 600) {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && rWrist.y <= rShoulder.y + 0.12) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateBishop(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rWrist = pose[16];
    const distToShoulder = Math.hypot(rWrist.x - rShoulder.x, rWrist.y - rShoulder.y);

    // Palm cocked near shoulder: dist < 0.15
    if (this.state === 'IDLE' && distToShoulder < 0.15) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      // Forward thrust: rWrist moves down/forward away from shoulder (dist > 0.35) within 500ms
      if (distToShoulder > 0.35 && now - this.candidateStartedAt < 500) {
        this.state = 'WAIT_RELEASE';
        return { ability: 'bishop_ice_bolt' };
      } else if (now - this.candidateStartedAt >= 500) {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && distToShoulder < 0.25) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateQueen(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rWrist = pose[16];
    const rightHand = findRightHand(hands, pose);
    const isRightPalm = rightHand ? isOpenPalm(rightHand) : false;

    // Raised right wrist near/above right shoulder with open palm
    const isRaised = rWrist.y <= rShoulder.y + 0.10 && isRightPalm;

    if (this.state === 'IDLE' && isRaised) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
      this.candidateFrames = 1;
    } else if (this.state === 'CANDIDATE') {
      if (isRaised) {
        this.candidateFrames++;
        if (this.candidateFrames >= 3 && now - this.candidateStartedAt < 700) {
          this.state = 'WAIT_RELEASE';
          return { ability: 'queen_volley' };
        } else if (now - this.candidateStartedAt >= 700) {
          this.state = 'IDLE';
        }
      } else {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && !isRaised) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateKing(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[11] || !pose[12] || !pose[16]) return null;
    const chestCenter = {
      x: (pose[11].x + pose[12].x) / 2,
      y: (pose[11].y + pose[12].y) / 2 + 0.06,
    };
    const dist = Math.hypot(pose[16].x - chestCenter.x, pose[16].y - chestCenter.y);
    const rightHand = findRightHand(hands, pose);
    const isFist = !rightHand || !isOpenPalm(rightHand);

    // Hold closed right fist steady at chest center (< 0.15) for 400ms
    if (this.state === 'IDLE' && dist < 0.15 && isFist) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      if (dist < 0.15 && isFist) {
        if (now - this.candidateStartedAt >= 400) {
          this.state = 'WAIT_RELEASE';
          return { ability: 'king_summon' };
        }
      } else {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && dist > 0.22) {
      this.state = 'IDLE';
    }

    return null;
  }

  public reset(): void {
    this.state = 'IDLE';
    this.candidateFrames = 0;
    this.candidateStartedAt = 0;
    this.isParryActive = false;
    this.lastSlashAt = 0;
    this.prevWristPos = null;
    this.prevWristTime = 0;
  }
}
