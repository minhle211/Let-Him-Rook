import {
  LEAN_DEADZONE,
  type AbilityType,
  type PieceClass,
} from '@let-him-rook/shared';
import type { Landmark3D } from '../vision/visionManager.ts';
import { bodyMetrics, computeTorsoMetrics, isOpenPalm, type CalibrationProfile } from './calibration.ts';

export interface CombatMovementIntent {
  moveX: number;
  moveZ: number;
}

export interface CombatAbilityIntent {
  ability: AbilityType;
  parryHolding?: boolean;
}

export const BODY_MOVEMENT = { forward:1.20, forwardRelease:1.08, backward:0.85, backwardRelease:0.94, lateral:0.60, lateralRelease:0.40, smoothingMs:100, activationMs:100 };
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
    const key = JSON.stringify(calibration.bodyBaseline);
    if (key !== this.profile) { this.reset(); this.profile=key; }
    const m = bodyMetrics(pose), base = calibration.bodyBaseline;
    if (!m || !base || !calibration.bodyCalibrated) { this.axes=[0,0]; this.candidates=[0,0]; return {moveX:0,moveZ:0}; }
    if (now-this.last>300) { this.reset(); this.x=m.noseX; this.width=m.width; }
    const alpha=1-Math.exp(-(now-this.last)/BODY_MOVEMENT.smoothingMs);
    this.x+=alpha*(m.noseX-this.x); this.width+=alpha*(m.width-this.width); this.last=now;
    const x=(this.x-base.noseX)/base.shoulderWidth, r=this.width/base.shoulderWidth;
    const desired=[x>=BODY_MOVEMENT.lateral?1:x<=-BODY_MOVEMENT.lateral?-1:0,r>=BODY_MOVEMENT.forward?-1:r<=BODY_MOVEMENT.backward?1:0];
    const release=[Math.abs(x)<=BODY_MOVEMENT.lateralRelease || x*this.axes[0]<0,this.axes[1]<0?r<=BODY_MOVEMENT.forwardRelease:r>=BODY_MOVEMENT.backwardRelease];
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
  private prevWristPos: { x: number; y: number } | null = null;

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
    // 1. Parry check: Left upright open palm held at chest height
    const leftHand = hands.find(h => h.length > 0 && h[0].x < 0.5); // screen left
    if (leftHand && isOpenPalm(leftHand)) {
      if (!this.isParryActive) {
        this.isParryActive = true;
        return { ability: 'pawn_parry', parryHolding: true };
      }
    } else {
      if (this.isParryActive) {
        this.isParryActive = false;
        return { ability: 'pawn_parry', parryHolding: false };
      }
    }

    // 2. Right wrist horizontal sweep across torso
    if (pose && pose[16]) {
      // 16 is right wrist
      const wrist = pose[16];
      if (this.prevWristPos) {
        const vx = (wrist.x - this.prevWristPos.x) / 0.05;
        if (Math.abs(vx) > 3.0) {
          if (this.state === 'IDLE') {
            this.state = 'WAIT_RELEASE';
            this.prevWristPos = { x: wrist.x, y: wrist.y };
            return { ability: 'pawn_sweep' };
          }
        } else if (Math.abs(vx) < 1.0) {
          this.state = 'IDLE';
        }
      }
      this.prevWristPos = { x: wrist.x, y: wrist.y };
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
    if (!pose || !pose[15] || !pose[16]) return null;
    const lWrist = pose[15];
    const rWrist = pose[16];
    const wristDist = Math.hypot(lWrist.x - rWrist.x, lWrist.y - rWrist.y);

    // Crossed wrists: wristDist < 0.12
    if (this.state === 'IDLE' && wristDist < 0.12) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      // Rapid separation: wristDist > 0.35 within 600ms
      if (wristDist > 0.35 && now - this.candidateStartedAt < 600) {
        this.state = 'WAIT_RELEASE';
        return { ability: 'knight_cleave' };
      } else if (now - this.candidateStartedAt >= 600) {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && wristDist < 0.28) {
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
    if (!pose || !pose[11] || !pose[12] || !pose[15] || !pose[16]) return null;
    const lWrist = pose[15];
    const rWrist = pose[16];
    const shouldersY = (pose[11].y + pose[12].y) / 2;

    // Both palms raised near shoulder height
    const bothRaised = lWrist.y <= shouldersY + 0.1 && rWrist.y <= shouldersY + 0.1;

    if (this.state === 'IDLE' && bothRaised && hands.length >= 2) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
      this.candidateFrames = 0;
    } else if (this.state === 'CANDIDATE') {
      this.candidateFrames++;
      if (this.candidateFrames >= 3 && now - this.candidateStartedAt < 700) {
        this.state = 'WAIT_RELEASE';
        return { ability: 'queen_volley' };
      } else if (now - this.candidateStartedAt >= 700) {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && !bothRaised) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateKing(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[15] || !pose[16]) return null;
    const lWrist = pose[15];
    const rWrist = pose[16];
    const wristDist = Math.hypot(lWrist.x - rWrist.x, lWrist.y - rWrist.y);

    // Hands clasped together at chest center (< 0.10)
    if (this.state === 'IDLE' && wristDist < 0.10) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      if (wristDist < 0.10) {
        if (now - this.candidateStartedAt >= 400) {
          // Held for 400ms steady!
          this.state = 'WAIT_RELEASE';
          return { ability: 'king_summon' };
        }
      } else {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && wristDist > 0.20) {
      this.state = 'IDLE';
    }

    return null;
  }

  public reset(): void {
    this.state = 'IDLE';
    this.candidateFrames = 0;
    this.candidateStartedAt = 0;
    this.isParryActive = false;
    this.prevWristPos = null;
  }
}
