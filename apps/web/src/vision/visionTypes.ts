export interface Landmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type VisionDelegate = 'GPU' | 'CPU';
export type VisionMode = 'chess' | 'duel_pose_only' | 'duel_full';

export interface VisionDiagnostics {
  fps: number;
  inferenceMs: number;
  gestureLatencyMs?: number;
  visionMode?: VisionMode;
  isLowLight: boolean;
  isCroppedBody: boolean;
  isCroppedHands: boolean;
  isTrackingLost: boolean;
  workerStatus?: 'loading' | 'ready' | 'error';
  workerError?: string;
  hasHandModel?: boolean;
  hasPoseModel?: boolean;
  /** Backend running inference: GPU, or CPU only if the browser has no usable WebGL2. */
  delegate?: VisionDelegate;
}

export interface VisionFrameData {
  hands: Landmark3D[][];
  pose: Landmark3D[] | null;
  timestamp: number;
  diagnostics: VisionDiagnostics;
}

export type VisionWorkerRequest =
  | { type: 'init'; delegate: VisionDelegate }
  | { type: 'set_mode'; mode: VisionMode }
  | { type: 'frame'; frame: ImageBitmap; timestamp: number; mode?: VisionMode }
  | { type: 'close' };

export type VisionWorkerResponse =
  | { type: 'status'; status: 'loading' }
  | {
      type: 'init_complete';
      success: boolean;
      hasHandModel: boolean;
      hasPoseModel: boolean;
      delegate?: VisionDelegate;
      error?: string;
    }
  | {
      type: 'landmarks';
      hands: Landmark3D[][];
      pose: Landmark3D[] | null;
      timestamp: number;
      inferenceMs: number;
      isLowLight: boolean;
      delegate: VisionDelegate;
    };
