import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';

export interface Landmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface VisionDiagnostics {
  fps: number;
  inferenceMs: number;
  isLowLight: boolean;
  isCroppedBody: boolean;
  isCroppedHands: boolean;
  isTrackingLost: boolean;
  workerStatus?: 'loading' | 'ready' | 'error';
  workerError?: string;
  hasHandModel?: boolean;
  hasPoseModel?: boolean;
}

export interface VisionFrameData {
  hands: Landmark3D[][];
  pose: Landmark3D[] | null;
  timestamp: number;
  diagnostics: VisionDiagnostics;
}

export type VisionFrameCallback = (data: VisionFrameData) => void;

function mirrorLandmarks(landmarks: Landmark3D[] | null | undefined): Landmark3D[] | null {
  if (!landmarks || !Array.isArray(landmarks)) return null;
  return landmarks.map(lm => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

export class VisionManager {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private poseLandmarker: PoseLandmarker | null = null;
  private workerReady: boolean = false;
  private workerStatus: 'loading' | 'ready' | 'error' = 'loading';
  private workerError?: string;
  private hasHandModel: boolean = false;
  private hasPoseModel: boolean = false;
  private animFrameId: number | null = null;
  private isProcessingFrame: boolean = false;
  private lastFrameTime: number = 0;
  private lastFrameTs: number = 0;
  private lastOutputTime: number = 0;
  private lastTrackedAt: number = 0;
  private rollingFps: number = 24;
  private callbacks: Set<VisionFrameCallback> = new Set();
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleCtx: CanvasRenderingContext2D | null = null;

  public subscribe(cb: VisionFrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  public getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  public isActive(): boolean {
    return Boolean(this.stream && this.video);
  }

  public async start(videoElement: HTMLVideoElement): Promise<void> {
    if (this.stream && this.video === videoElement) {
      return;
    }

    this.video = videoElement;
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = 64;
    this.sampleCanvas.height = 48;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });

    // 1. Request webcam stream
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: false,
        });
        this.video.srcObject = this.stream;
        await this.video.play().catch(err => {
          console.warn('[VisionManager] video.play() warning:', err);
        });
      } catch (camErr) {
        this.workerStatus = 'error';
        this.workerError =
          camErr instanceof Error
            ? `Camera access error: ${camErr.message}`
            : 'Camera permission denied or camera in use.';
        console.error('[VisionManager] Camera getUserMedia failed:', camErr);
        this.emitStatusFrame();
        return;
      }
    } else {
      this.workerStatus = 'error';
      this.workerError = 'Camera API unavailable (requires localhost or HTTPS).';
      this.emitStatusFrame();
      return;
    }

    // 2. Initialize MediaPipe Models directly
    this.workerStatus = 'loading';
    this.workerReady = false;
    this.emitStatusFrame();

    try {
      let visionFileset = null;
      try {
        visionFileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      } catch (wasmErr) {
        console.warn('[VisionManager] Local wasm failed, trying CDN fallback:', wasmErr);
        visionFileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
      }

      const [handInstance, poseInstance] = await Promise.all([
        HandLandmarker.createFromOptions(visionFileset, {
          baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task' },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }).catch(err => {
          console.warn('[VisionManager] Local hand model failed, retrying CDN:', err);
          return HandLandmarker.createFromOptions(visionFileset, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            },
            numHands: 2,
            runningMode: 'VIDEO',
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }).catch(cdnErr => {
            console.error('[VisionManager] HandLandmarker CDN failed:', cdnErr);
            return null;
          });
        }),
        PoseLandmarker.createFromOptions(visionFileset, {
          baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_lite.task' },
          runningMode: 'VIDEO',
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }).catch(err => {
          console.warn('[VisionManager] Local pose model failed, retrying CDN:', err);
          return PoseLandmarker.createFromOptions(visionFileset, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            },
            runningMode: 'VIDEO',
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }).catch(cdnErr => {
            console.error('[VisionManager] PoseLandmarker CDN failed:', cdnErr);
            return null;
          });
        }),
      ]);

      this.handLandmarker = handInstance;
      this.poseLandmarker = poseInstance;
      this.hasHandModel = Boolean(handInstance);
      this.hasPoseModel = Boolean(poseInstance);

      if (this.handLandmarker || this.poseLandmarker) {
        this.workerReady = true;
        this.workerStatus = 'ready';
        this.workerError = undefined;
        console.log('[VisionManager] MediaPipe initialized directly in browser:', {
          hasHandModel: this.hasHandModel,
          hasPoseModel: this.hasPoseModel,
        });
      } else {
        this.workerReady = false;
        this.workerStatus = 'error';
        this.workerError = 'Could not initialize MediaPipe vision models.';
      }
      this.emitStatusFrame();
    } catch (err) {
      console.error('[VisionManager] MediaPipe initialization error:', err);
      this.workerReady = false;
      this.workerStatus = 'error';
      this.workerError = err instanceof Error ? err.message : String(err);
      this.emitStatusFrame();
    }

    this.startLoop();
  }

  private emitStatusFrame(): void {
    const frameData: VisionFrameData = {
      hands: [],
      pose: null,
      timestamp: performance.now(),
      diagnostics: {
        fps: Math.round(this.rollingFps),
        inferenceMs: 0,
        isLowLight: false,
        isCroppedBody: false,
        isCroppedHands: false,
        isTrackingLost: true,
        workerStatus: this.workerStatus,
        workerError: this.workerError,
        hasHandModel: this.hasHandModel,
        hasPoseModel: this.hasPoseModel,
      },
    };
    for (const cb of this.callbacks) {
      cb(frameData);
    }
  }

  private startLoop(): void {
    const targetIntervalMs = 1000 / 24; // Cap at 24 FPS

    const loop = (now: number) => {
      this.animFrameId = requestAnimationFrame(loop);

      if (
        !this.video ||
        this.video.readyState < 2 ||
        this.video.videoWidth <= 0 ||
        this.video.videoHeight <= 0 ||
        this.isProcessingFrame ||
        !this.workerReady
      ) {
        return;
      }

      if (now - this.lastFrameTime < targetIntervalMs) {
        return;
      }

      this.lastFrameTime = now;
      this.isProcessingFrame = true;

      const frameTs = Math.max(this.lastFrameTs + 1, Math.floor(now));
      this.lastFrameTs = frameTs;
      const startMs = performance.now();

      let hands: Landmark3D[][] = [];
      let pose: Landmark3D[] | null = null;

      try {
        if (this.handLandmarker && this.video) {
          const res = this.handLandmarker.detectForVideo(this.video, frameTs);
          if (res?.landmarks) {
            hands = res.landmarks.map(h => mirrorLandmarks(h)).filter(Boolean) as Landmark3D[][];
          }
        }
        if (this.poseLandmarker && this.video) {
          const res = this.poseLandmarker.detectForVideo(this.video, frameTs);
          if (res?.landmarks?.[0]) {
            pose = mirrorLandmarks(res.landmarks[0]);
          }
        }
      } catch (err) {
        console.warn('[VisionManager] detectForVideo warning:', err);
      }

      const inferenceMs = performance.now() - startMs;
      this.handleOutput(hands, pose, frameTs, inferenceMs);
      this.isProcessingFrame = false;
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  private handleOutput(
    hands: Landmark3D[][],
    pose: Landmark3D[] | null,
    timestamp: number,
    inferenceMs: number
  ): void {
    const now = performance.now();
    if (this.lastOutputTime > 0) {
      const dt = Math.max(16, now - this.lastOutputTime);
      const instantFps = Math.min(60, 1000 / dt);
      this.rollingFps = this.rollingFps * 0.85 + instantFps * 0.15;
    }
    this.lastOutputTime = now;

    const hasPose = Boolean(pose && pose.length > 0);
    const hasHands = Boolean(hands && hands.length > 0);

    if (hasPose || hasHands) {
      this.lastTrackedAt = now;
    }

    const isTrackingLost = this.lastTrackedAt === 0 || now - this.lastTrackedAt > 350;

    // Diagnostic checks: ambient brightness
    let isLowLight = false;
    if (this.sampleCtx && this.video && this.video.videoWidth > 0) {
      try {
        this.sampleCtx.drawImage(this.video, 0, 0, 64, 48);
        const imgData = this.sampleCtx.getImageData(0, 0, 64, 48).data;
        let brightnessSum = 0;
        for (let i = 0; i < imgData.length; i += 4) {
          brightnessSum += (imgData[i] + imgData[i + 1] + imgData[i + 2]) / 3;
        }
        const avgBrightness = brightnessSum / (imgData.length / 4);
        isLowLight = avgBrightness < 38;
      } catch {
        // Ignore canvas security errors
      }
    }

    // Check cropped upper body (landmarks 11, 12 are left/right shoulders)
    let isCroppedBody = false;
    if (pose) {
      const leftShoulder = pose[11];
      const rightShoulder = pose[12];
      if (
        !leftShoulder ||
        !rightShoulder ||
        (leftShoulder.visibility !== undefined && leftShoulder.visibility < 0.35) ||
        (rightShoulder.visibility !== undefined && rightShoulder.visibility < 0.35)
      ) {
        isCroppedBody = true;
      }
    } else {
      isCroppedBody = true;
    }

    const isCroppedHands = !hasHands;

    const diagnostics: VisionDiagnostics = {
      fps: Math.round(this.rollingFps),
      inferenceMs: Math.round(inferenceMs),
      isLowLight,
      isCroppedBody,
      isCroppedHands,
      isTrackingLost,
      workerStatus: this.workerStatus,
      workerError: this.workerError,
      hasHandModel: this.hasHandModel,
      hasPoseModel: this.hasPoseModel,
    };

    const frameData: VisionFrameData = {
      hands,
      pose,
      timestamp,
      diagnostics,
    };

    for (const cb of this.callbacks) {
      cb(frameData);
    }
  }

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    try {
      (this.handLandmarker as any)?.close?.();
    } catch {
      // Ignore cleanup error
    }
    this.handLandmarker = null;
    try {
      (this.poseLandmarker as any)?.close?.();
    } catch {
      // Ignore cleanup error
    }
    this.poseLandmarker = null;
    this.workerReady = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.callbacks.clear();
  }
}
