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

export class VisionManager {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
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
  private lastBrightnessCheck = 0;
  private cachedLowLight = false;

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
            frameRate: { ideal: 60, max: 60 },
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

    // 2. Initialize MediaPipe in a worker so inference never blocks WebGL.
    this.workerStatus = 'loading';
    this.workerReady = false;
    this.emitStatusFrame();

    try {
      this.worker = new Worker('/vision-worker.js');
      this.worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'init_complete') {
          this.workerReady = Boolean(message.success);
          this.workerStatus = message.success ? 'ready' : 'error';
          this.workerError = message.error;
          this.hasHandModel = Boolean(message.hasHandModel);
          this.hasPoseModel = Boolean(message.hasPoseModel);
          this.emitStatusFrame();
          return;
        }
        if (message.type === 'landmarks') {
          const data = message.data;
          this.handleOutput(data.hands || [], data.pose || null, data.timestamp, data.inferenceMs);
          this.isProcessingFrame = false;
        }
      };
      this.worker.onerror = event => {
        this.isProcessingFrame = false;
        this.workerReady = false;
        this.workerStatus = 'error';
        this.workerError = event.message || 'Vision worker failed.';
        this.emitStatusFrame();
      };
      this.worker.postMessage({ type: 'init' });
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
    const targetIntervalMs = 1000 / 30; // Hand tracking cap; pose runs at 15 FPS in the worker.

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
      createImageBitmap(this.video)
        .then(imageBitmap => {
          if (!this.worker || !this.workerReady) {
            imageBitmap.close();
            this.isProcessingFrame = false;
            return;
          }
          this.worker.postMessage(
            { type: 'process_frame', data: { imageBitmap, timestamp: frameTs } },
            [imageBitmap]
          );
        })
        .catch(err => {
          console.warn('[VisionManager] Could not capture video frame:', err);
          this.isProcessingFrame = false;
        });
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
    if (now - this.lastBrightnessCheck > 1000 && this.sampleCtx && this.video && this.video.videoWidth > 0) {
      this.lastBrightnessCheck = now;
      try {
        this.sampleCtx.drawImage(this.video, 0, 0, 64, 48);
        const imgData = this.sampleCtx.getImageData(0, 0, 64, 48).data;
        let brightnessSum = 0;
        for (let i = 0; i < imgData.length; i += 4) {
          brightnessSum += (imgData[i] + imgData[i + 1] + imgData[i + 2]) / 3;
        }
        const avgBrightness = brightnessSum / (imgData.length / 4);
        this.cachedLowLight = avgBrightness < 38;
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
      isLowLight: this.cachedLowLight,
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
    this.worker?.terminate();
    this.worker = null;
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
