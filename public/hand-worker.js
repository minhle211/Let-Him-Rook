let tracker;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      // Keep a classic worker for the WASM loader; import the published ESM bundle.
      const { HandLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
      tracker = await HandLandmarker.createFromOptions(
        await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'),
        { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.6 }
      );
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      try {
        const startedAt = performance.now();
        const result = tracker.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({ type: 'hand', landmarks: result.landmarks[0] || null, inferenceMs: performance.now() - startedAt });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
