import type {
  Landmark3D,
  VisionDelegate,
  VisionDiagnostics,
  VisionFrameData,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './visionTypes.ts';

export type { Landmark3D, VisionDelegate, VisionDiagnostics, VisionFrameData } from './visionTypes.ts';

export type VisionFrameCallback = (data: VisionFrameData) => void;

export interface VisionManagerOptions {
  /** Preferred inference backend; GPU falls back to CPU automatically. */
  delegate?: VisionDelegate;
}

/** If the worker never answers a frame (e.g. GPU context loss), stop waiting after this long. */
const FRAME_STALL_TIMEOUT_MS = 2000;

/**
 * Owns the webcam stream and feeds frames to the MediaPipe worker
 * (vision.worker.ts). Inference runs off the main thread, so the render loop
 * only pays for a non-blocking createImageBitmap + postMessage per frame.
 */
export class VisionManager {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private readonly preferredDelegate: VisionDelegate;
  private workerReady: boolean = false;
  private workerStatus: 'loading' | 'ready' | 'error' = 'loading';
  private workerError?: string;
  private hasHandModel: boolean = false;
  private hasPoseModel: boolean = false;
  private delegate?: VisionDelegate;
  private animFrameId: number | null = null;
  private frameInFlight: boolean = false;
  private frameSentAt: number = 0;
  private lastFrameTime: number = 0;
  private lastOutputTime: number = 0;
  private lastTrackedAt: number = 0;
  private rollingFps: number = 24;
  private callbacks: Set<VisionFrameCallback> = new Set();

  constructor(options: VisionManagerOptions = {}) {
    this.preferredDelegate = options.delegate ?? 'GPU';
  }

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

    // Start loading models in parallel with the camera permission prompt.
    this.workerStatus = 'loading';
    this.workerReady = false;
    this.startWorker();

    // 1. Request webcam stream
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (this.video !== videoElement) {
          // stop() was called while the permission prompt was open.
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        this.stream = stream;
        this.video.srcObject = stream;
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
        this.terminateWorker();
        this.emitStatusFrame();
        return;
      }
    } else {
      this.workerStatus = 'error';
      this.workerError = 'Camera API unavailable (requires localhost or HTTPS).';
      this.terminateWorker();
      this.emitStatusFrame();
      return;
    }

    this.emitStatusFrame();
    this.startLoop();
  }

  private startWorker(): void {
    try {
      this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      this.failWorker(err instanceof Error ? err.message : String(err));
      return;
    }
    this.worker.onmessage = (event: MessageEvent<VisionWorkerResponse>) => this.onWorkerMessage(event.data);
    this.worker.onerror = event => {
      console.error('[VisionManager] Vision worker error:', event.message);
      this.failWorker(event.message || 'Vision worker crashed.');
    };
    this.postToWorker({ type: 'init', delegate: this.preferredDelegate });
  }

  private postToWorker(message: VisionWorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private onWorkerMessage(msg: VisionWorkerResponse): void {
    if (msg.type === 'landmarks') {
      this.frameInFlight = false;
      this.delegate = msg.delegate;
      this.handleOutput(msg.hands, msg.pose, msg.timestamp, msg.inferenceMs, msg.isLowLight);
    } else if (msg.type === 'init_complete') {
      this.hasHandModel = msg.hasHandModel;
      this.hasPoseModel = msg.hasPoseModel;
      this.delegate = msg.delegate;
      if (msg.success) {
        this.workerReady = true;
        this.workerStatus = 'ready';
        this.workerError = undefined;
        console.log('[VisionManager] MediaPipe worker ready:', {
          delegate: this.delegate,
          hand: this.hasHandModel,
          pose: this.hasPoseModel,
        });
        this.emitStatusFrame();
      } else {
        this.failWorker(msg.error ?? 'Could not initialize MediaPipe vision models.');
      }
    }
  }

  private failWorker(error: string): void {
    this.workerReady = false;
    this.workerStatus = 'error';
    this.workerError = error;
    this.terminateWorker();
    this.emitStatusFrame();
  }

  private terminateWorker(): void {
    if (!this.worker) return;
    this.postToWorker({ type: 'close' });
    this.worker.terminate();
    this.worker = null;
    this.frameInFlight = false;
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
        delegate: this.delegate,
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

      if (this.frameInFlight && now - this.frameSentAt > FRAME_STALL_TIMEOUT_MS) {
        console.warn('[VisionManager] Vision worker stalled; resuming frame pump.');
        this.frameInFlight = false;
      }

      const video = this.video;
      if (
        !video ||
        !this.worker ||
        video.readyState < 2 ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0 ||
        this.frameInFlight ||
        !this.workerReady
      ) {
        return;
      }

      if (now - this.lastFrameTime < targetIntervalMs) {
        return;
      }

      this.lastFrameTime = now;
      this.frameInFlight = true;
      this.frameSentAt = now;

      // One frame in flight at a time: the worker always gets the freshest frame
      // and never builds a backlog (which would add latency).
      createImageBitmap(video)
        .then(frame => {
          if (!this.worker) {
            frame.close();
            return;
          }
          this.postToWorker({ type: 'frame', frame, timestamp: now }, [frame]);
        })
        .catch(err => {
          console.warn('[VisionManager] createImageBitmap warning:', err);
          this.frameInFlight = false;
        });
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  private handleOutput(
    hands: Landmark3D[][],
    pose: Landmark3D[] | null,
    timestamp: number,
    inferenceMs: number,
    isLowLight: boolean
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
      delegate: this.delegate,
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
    this.terminateWorker();
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
