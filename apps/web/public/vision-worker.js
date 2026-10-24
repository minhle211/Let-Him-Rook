/**
 * Dedicated MediaPipe Vision Worker for Let Him Rook.
 * Processes ImageBitmap frames and computes 2-hand + upper-body pose landmarks
 * without blocking the main React/Three.js rendering thread.
 */

let handLandmarker = null;
let poseLandmarker = null;
let isInitialized = false;
let lastTimestampMs = 0;

const CDN_VISION_BUNDLE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const CDN_WASM_DIR =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const CDN_HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CDN_POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

function mirrorLandmarks(landmarks) {
  if (!landmarks || !Array.isArray(landmarks)) return null;
  return landmarks.map(lm => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

self.onmessage = async event => {
  const { type, data } = event.data;

  if (type === 'init') {
    try {
      self.postMessage({ type: 'status', status: 'loading_models' });

      let visionModule = null;
      try {
        visionModule = await import('/mediapipe/vision_bundle.mjs');
      } catch (err) {
        console.warn('[VisionWorker] Local vision_bundle.mjs import failed, trying CDN fallback:', err);
        visionModule = await import(CDN_VISION_BUNDLE);
      }

      const { FilesetResolver, HandLandmarker, PoseLandmarker } = visionModule;

      let visionFileset = null;
      try {
        visionFileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      } catch (err) {
        console.warn('[VisionWorker] Local wasm failed, trying CDN fallback:', err);
        visionFileset = await FilesetResolver.forVisionTasks(CDN_WASM_DIR);
      }

      // 1. Initialize HandLandmarker (try local bundle first, fallback to CDN)
      let handInstance = null;
      try {
        handInstance = await HandLandmarker.createFromOptions(visionFileset, {
          baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task' },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (localErr) {
        console.warn('[VisionWorker] Local hand_landmarker.task failed, attempting CDN:', localErr);
        try {
          handInstance = await HandLandmarker.createFromOptions(visionFileset, {
            baseOptions: { modelAssetPath: CDN_HAND_MODEL },
            numHands: 2,
            runningMode: 'VIDEO',
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch (cdnErr) {
          console.error('[VisionWorker] HandLandmarker CDN failed:', cdnErr);
        }
      }

      // 2. Initialize PoseLandmarker (try local bundle first, fallback to CDN)
      let poseInstance = null;
      try {
        poseInstance = await PoseLandmarker.createFromOptions(visionFileset, {
          baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_lite.task' },
          runningMode: 'VIDEO',
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (localErr) {
        console.warn('[VisionWorker] Local pose_landmarker_lite.task failed, attempting CDN:', localErr);
        try {
          poseInstance = await PoseLandmarker.createFromOptions(visionFileset, {
            baseOptions: { modelAssetPath: CDN_POSE_MODEL },
            runningMode: 'VIDEO',
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch (cdnErr) {
          console.error('[VisionWorker] PoseLandmarker CDN failed:', cdnErr);
        }
      }

      handLandmarker = handInstance;
      poseLandmarker = poseInstance;
      isInitialized = Boolean(handLandmarker || poseLandmarker);

      self.postMessage({
        type: 'init_complete',
        success: isInitialized,
        hasHandModel: Boolean(handLandmarker),
        hasPoseModel: Boolean(poseLandmarker),
        error: isInitialized
          ? undefined
          : 'Could not load MediaPipe models. Ensure webcam and assets are available.',
      });
    } catch (err) {
      isInitialized = false;
      self.postMessage({
        type: 'init_complete',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (type === 'process_frame') {
    const { imageBitmap, timestamp } = data;
    const startMs = performance.now();

    let hands = [];
    let pose = null;

    // Ensure strictly monotonic integer timestamp for MediaPipe VIDEO mode
    const frameTs = Math.max(lastTimestampMs + 1, Math.floor(timestamp || startMs));
    lastTimestampMs = frameTs;

    try {
      if (handLandmarker && imageBitmap) {
        const handResult = handLandmarker.detectForVideo(imageBitmap, frameTs);
        if (handResult?.landmarks) {
          hands = handResult.landmarks.map(h => mirrorLandmarks(h)).filter(Boolean);
        }
      }
      if (poseLandmarker && imageBitmap) {
        const poseResult = poseLandmarker.detectForVideo(imageBitmap, frameTs);
        if (poseResult?.landmarks?.[0]) {
          pose = mirrorLandmarks(poseResult.landmarks[0]);
        }
      }
    } catch (err) {
      console.warn('[VisionWorker] Inference warning:', err);
    } finally {
      if (imageBitmap && typeof imageBitmap.close === 'function') {
        imageBitmap.close();
      }
    }

    const inferenceMs = performance.now() - startMs;
    self.postMessage({
      type: 'landmarks',
      data: {
        hands,
        pose,
        timestamp: frameTs,
        inferenceMs,
      },
    });
  }
};
