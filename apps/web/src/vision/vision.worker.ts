/**
 * MediaPipe vision worker: runs HandLandmarker + PoseLandmarker off the main
 * thread so inference never stalls React / Three.js rendering.
 *
 * The Wasm loader + binary are imported from the installed npm package (ES
 * module variant, required inside module workers), so the JS API and the Wasm
 * runtime can never drift to different versions.
 */
import { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type {
  Landmark3D,
  VisionDelegate,
  VisionMode,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './visionTypes.ts';

const HAND_MODEL_PATH = '/mediapipe/hand_landmarker.task';
const POSE_MODEL_PATH = '/mediapipe/pose_landmarker_lite.task';
const HAND_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Sample ambient brightness every N frames (~0.4s at 60 FPS) instead of every frame. */
const BRIGHTNESS_SAMPLE_EVERY = 24;
const LOW_LIGHT_THRESHOLD = 38;

const ctx = self as unknown as {
  postMessage(message: VisionWorkerResponse): void;
  onmessage: ((event: MessageEvent<VisionWorkerRequest>) => void) | null;
};

/** One HandLandmarker + PoseLandmarker pair running on a given delegate. */
interface LandmarkerSet {
  delegate: VisionDelegate;
  hand: HandLandmarker | null;
  pose: PoseLandmarker | null;
}

let active: LandmarkerSet | null = null;
let currentMode: VisionMode = 'duel_full';
let lastTimestampMs = 0;
let frameCount = 0;
let isLowLight = false;
let brightnessCtx: OffscreenCanvasRenderingContext2D | null = null;
let cachedHands: Landmark3D[][] = [];
let lastHandsAt = -Infinity;
let rollingInferenceMs = 10;

function post(message: VisionWorkerResponse): void {
  ctx.postMessage(message);
}

function mirrorLandmarks(landmarks: Landmark3D[] | null | undefined): Landmark3D[] | null {
  if (!landmarks || !Array.isArray(landmarks)) return null;
  return landmarks.map(lm => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

/** Create a landmarker on one delegate, trying the bundled model then the CDN copy. */
async function createWithFallback<T>(
  label: string,
  create: (modelAssetPath: string) => Promise<T>,
  localPath: string,
  cdnPath: string,
  delegate: VisionDelegate
): Promise<T | null> {
  for (const modelPath of [localPath, cdnPath]) {
    try {
      return await create(modelPath);
    } catch (err) {
      console.warn(`[VisionWorker] ${label} (${delegate}, ${modelPath}) failed:`, err);
    }
  }
  return null;
}

/**
 * MediaPipe reads `self.ModuleFactory` (set by the Wasm loader script) and then
 * clears it after creating each task. In a module worker the loader is pulled in
 * with import(), which only evaluates once, so the second landmarker would fail
 * with "ModuleFactory not set". Load it once here and restore it before each create.
 */
async function loadModuleFactory(): Promise<unknown> {
  const loader = await import(/* @vite-ignore */ wasmLoaderPath);
  return loader.default ?? (self as unknown as { ModuleFactory?: unknown }).ModuleFactory;
}

async function init(preferredDelegate: VisionDelegate): Promise<void> {
  post({ type: 'status', status: 'loading' });
  try {
    const moduleFactory = await loadModuleFactory();
    const fileset = { wasmLoaderPath, wasmBinaryPath };
    const withFactory = <T>(create: () => Promise<T>): Promise<T> => {
      (self as unknown as { ModuleFactory?: unknown }).ModuleFactory = moduleFactory;
      return create();
    };

    // Sequential (not Promise.all): each create re-arms the shared ModuleFactory global.
    const createSet = async (delegate: VisionDelegate): Promise<LandmarkerSet> => {
      const hand = await createWithFallback(
        'HandLandmarker',
        modelAssetPath =>
          withFactory(() =>
            HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              numHands: 2,
              runningMode: 'VIDEO',
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            })
          ),
        HAND_MODEL_PATH,
        HAND_MODEL_CDN,
        delegate
      );
      const pose = await createWithFallback(
        'PoseLandmarker',
        modelAssetPath =>
          withFactory(() =>
            PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            })
          ),
        POSE_MODEL_PATH,
        POSE_MODEL_CDN,
        delegate
      );
      const set = { delegate, hand, pose };
      if (hand || pose) warmUp(set);
      return set;
    };

    let set = await createSet(preferredDelegate);
    if (!set.hand && !set.pose && preferredDelegate === 'GPU') {
      // Only when the browser has no usable WebGL2 at all; otherwise inference stays on GPU.
      console.warn('[VisionWorker] GPU delegate unavailable, using CPU.');
      set = await createSet('CPU');
    }
    active = set;
    const success = Boolean(set.hand || set.pose);
    post({
      type: 'init_complete',
      success,
      hasHandModel: Boolean(set.hand),
      hasPoseModel: Boolean(set.pose),
      delegate: set.delegate,
      error: success ? undefined : 'Could not initialize MediaPipe vision models.',
    });
  } catch (err) {
    post({
      type: 'init_complete',
      success: false,
      hasHandModel: false,
      hasPoseModel: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run one inference on a blank frame so GPU shader compilation (~1s) happens
 * while the UI still shows "loading", not as a hitch on the first live frame.
 */
function warmUp(set: LandmarkerSet): void {
  try {
    const canvas = new OffscreenCanvas(640, 480);
    canvas.getContext('2d')?.fillRect(0, 0, 640, 480);
    const frame = canvas.transferToImageBitmap();
    const ts = ++lastTimestampMs;
    set.hand?.detectForVideo(frame, ts);
    set.pose?.detectForVideo(frame, ts);
    frame.close();
  } catch (err) {
    console.warn('[VisionWorker] Warm-up failed (non-fatal):', err);
  }
}

function sampleBrightness(frame: ImageBitmap): void {
  if (!brightnessCtx) {
    brightnessCtx = new OffscreenCanvas(64, 48).getContext('2d', { willReadFrequently: true });
    if (!brightnessCtx) return;
  }
  brightnessCtx.drawImage(frame, 0, 0, 64, 48);
  const data = brightnessCtx.getImageData(0, 0, 64, 48).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  isLowLight = sum / (data.length / 4) < LOW_LIGHT_THRESHOLD;
}

function processFrame(frame: ImageBitmap, timestamp: number, mode?: VisionMode): void {
  if (mode) currentMode = mode;
  const startMs = performance.now();
  let hands: Landmark3D[][] = [];
  let pose: Landmark3D[] | null = null;

  // MediaPipe VIDEO mode requires strictly increasing integer timestamps.
  const frameTs = Math.max(lastTimestampMs + 1, Math.floor(timestamp));
  lastTimestampMs = frameTs;
  const frameIdx = frameCount++;

  const set = active;
  try {
    const runPose = currentMode !== 'chess' && Boolean(set?.pose);
    const interleaveHands =
      currentMode === 'duel_full' &&
      rollingInferenceMs > 16 &&
      frameIdx % 2 === 1 &&
      frameTs - lastHandsAt < 60;
    const runHands =
      currentMode !== 'duel_pose_only' && Boolean(set?.hand) && !interleaveHands;

    if (runPose && set?.pose) {
      const res = set.pose.detectForVideo(frame, frameTs);
      if (res?.landmarks?.[0]) {
        pose = mirrorLandmarks(res.landmarks[0]);
      }
    }

    if (runHands && set?.hand) {
      const res = set.hand.detectForVideo(frame, frameTs);
      if (res?.landmarks) {
        hands = res.landmarks.map(h => mirrorLandmarks(h)).filter(Boolean) as Landmark3D[][];
      }
      cachedHands = hands;
      lastHandsAt = frameTs;
    } else if (interleaveHands) {
      hands = cachedHands;
    }

    if (frameIdx % BRIGHTNESS_SAMPLE_EVERY === 0) {
      sampleBrightness(frame);
    }
  } catch (err) {
    console.warn('[VisionWorker] detectForVideo warning:', err);
  } finally {
    frame.close();
  }

  const inferenceMs = performance.now() - startMs;
  if (currentMode === 'duel_full') {
    rollingInferenceMs = rollingInferenceMs * 0.8 + inferenceMs * 0.2;
  }

  post({
    type: 'landmarks',
    hands,
    pose,
    timestamp: frameTs,
    inferenceMs,
    isLowLight,
    delegate: set?.delegate ?? 'CPU',
  });
}

ctx.onmessage = event => {
  const msg = event.data;
  if (msg.type === 'init') {
    void init(msg.delegate);
  } else if (msg.type === 'set_mode') {
    currentMode = msg.mode;
  } else if (msg.type === 'frame') {
    processFrame(msg.frame, msg.timestamp, msg.mode);
  } else if (msg.type === 'close') {
    active?.hand?.close();
    active?.pose?.close();
    active = null;
  }
};
