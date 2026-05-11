/**
 * hands.js — MediaPipe Hand Landmarker integration (AR / rear camera)
 *
 * Handles:
 *  - Rear camera stream acquisition (facingMode: 'environment')
 *  - Hand Landmarker model loading & inference
 *  - Exponential smoothing of landmark positions
 *  - Pinch detection (thumb tip ↔ index finger tip distance)
 *  - navigator.vibrate feedback on pinch start
 */

const MEDIAPIPE_VISION_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Exponential smoothing factor (0=no smoothing, 1=frozen)
const SMOOTH_ALPHA = 0.55;

// Pinch distance threshold (normalised units)
const PINCH_THRESHOLD_CLOSE = 0.07;
const PINCH_THRESHOLD_OPEN  = 0.11;

export class HandTracker {
  constructor(videoEl) {
    this.video = videoEl;
    this.landmarker = null;
    this.running = false;

    // Smoothed positions for each landmark [21] per hand [2]
    this._smoothed = [];
    this._lastPinchState = false;

    // Callbacks
    this.onPinchStart = null;
    this.onPinchEnd   = null;
    this.onPinchMove  = null;
    this.onHandMove   = null;
  }

  async init(onProgress) {
    onProgress?.('カメラ起動中...');
    await this._startCamera();

    onProgress?.('AIモデル読み込み中...');
    const { HandLandmarker, FilesetResolver } =
      await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs');

    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_VISION_URL);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  }

  async _startCamera() {
    // Use the rear (environment-facing) camera for AR
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = stream;
    await new Promise(res => { this.video.onloadedmetadata = res; });
    await this.video.play();
  }

  start() {
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
  }

  _loop() {
    if (!this.running) return;

    if (this.video.readyState >= 2 && this.landmarker) {
      const now = performance.now();
      const result = this.landmarker.detectForVideo(this.video, now);

      if (result.landmarks && result.landmarks.length > 0) {
        const raw = result.landmarks[0]; // first hand
        const smoothed = this._smooth(raw, 0);

        const thumb  = smoothed[4];  // thumb tip
        const index  = smoothed[8];  // index finger tip
        const midX   = (thumb.x + index.x) / 2;
        const midY   = (thumb.y + index.y) / 2;

        // Hand scale: wrist → middle-finger MCP distance in normalised screen
        // coords. Larger value = hand is closer to the camera.
        const wrist  = smoothed[0];
        const midMcp = smoothed[9];
        const handScale = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y);

        const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        const pinching = dist < PINCH_THRESHOLD_CLOSE;
        const released = !pinching && dist > PINCH_THRESHOLD_OPEN;

        // Hand roll: angle of the wrist→middle-MCP direction relative to
        // screen vertical.
        const rollDx = midMcp.x - wrist.x;
        const rollDy = midMcp.y - wrist.y;
        const handRoll = Math.atan2(rollDx, -rollDy);

        if (pinching && !this._lastPinchState) {
          this._lastPinchState = true;
          navigator.vibrate?.(40);
          this.onPinchStart?.({ nx: midX, ny: midY, handScale, handRoll });
        } else if (released && this._lastPinchState) {
          this._lastPinchState = false;
          this.onPinchEnd?.({ nx: midX, ny: midY, handScale, handRoll });
        }

        if (this._lastPinchState) {
          this.onPinchMove?.({ nx: midX, ny: midY, dist, handScale, handRoll });
        }

        // Expose for HUD / calibration
        this.lastMidpoint = { nx: midX, ny: midY };
        this.lastHandScale = handScale;
        this.isPinching = this._lastPinchState;
        this.detected = true;

        // Fire every frame when hand is detected (regardless of pinch state)
        this.onHandMove?.({ nx: midX, ny: midY, handScale, handRoll });
      } else {
        this.detected = false;
        if (this._lastPinchState) {
          this._lastPinchState = false;
          this.onPinchEnd?.({ nx: 0.5, ny: 0.5 });
        }
      }
    }

    requestAnimationFrame(() => this._loop());
  }

  /**
   * Exponential smoothing over hand landmarks.
   * @param {Array<{x,y,z}>} raw
   * @param {number} handIdx
   * @returns {Array<{x,y,z}>}
   */
  _smooth(raw, handIdx) {
    if (!this._smoothed[handIdx]) {
      this._smoothed[handIdx] = raw.map(lm => ({ ...lm }));
      return this._smoothed[handIdx];
    }
    const prev = this._smoothed[handIdx];
    for (let i = 0; i < raw.length; i++) {
      prev[i].x = SMOOTH_ALPHA * prev[i].x + (1 - SMOOTH_ALPHA) * raw[i].x;
      prev[i].y = SMOOTH_ALPHA * prev[i].y + (1 - SMOOTH_ALPHA) * raw[i].y;
      prev[i].z = SMOOTH_ALPHA * prev[i].z + (1 - SMOOTH_ALPHA) * raw[i].z;
    }
    return prev;
  }
}
