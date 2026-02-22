const videoElement = document.getElementById("webcam");
const canvasElement = document.getElementById("overlay");
const canvasCtx = canvasElement.getContext("2d");

let pinchActive = false;

const PINCH_START_THRESHOLD = 0.045;
const PINCH_RELEASE_THRESHOLD = 0.065;

canvasElement.width = window.innerWidth;
canvasElement.height = window.innerHeight;

let path = [];
let drawing = false;

// Improved Smoothing Constants
const MOVEMENT_THRESHOLD = 0.002; // Reduced for finer detail

// One Euro Filter Implementation
class LowPassFilter {
    constructor(alpha) {
        this.alpha = alpha;
        this.y = null;
    }
    filter(value) {
        if (this.y === null) this.y = value;
        else this.y = this.alpha * value + (1.0 - this.alpha) * this.y;
        return this.y;
    }
}

class OneEuroFilter {
    constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.xFilter = new LowPassFilter(this.alpha(minCutoff));
        this.dxFilter = new LowPassFilter(this.alpha(dCutoff));
        this.lastValue = null;
    }
    alpha(cutoff) {
        const te = 1.0 / 30; // Assuming ~30fps from MediaPipe
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / te);
    }
    filter(value) {
        const dx = this.lastValue === null ? 0 : value - this.lastValue;
        const edx = this.dxFilter.filter(dx);
        const cutoff = this.minCutoff + this.beta * Math.abs(edx);
        this.lastValue = value;
        return this.xFilter.filter(value, this.alpha(cutoff));
    }
}

const filterX = new OneEuroFilter(0.5, 0.05); // Tweakable: minCutoff, beta
const filterY = new OneEuroFilter(0.5, 0.05);

let onDrawingComplete = null;

export function setDrawingCompleteCallback(callback) {
    onDrawingComplete = callback;
}

/* ---------------- UTILS ---------------- */

function distance(a, b) {
    return Math.sqrt(
        Math.pow(a.x - b.x, 2) +
        Math.pow(a.y - b.y, 2)
    );
}

function clearCanvas() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
}

function drawTrail() {
    if (path.length < 2) return;

    canvasCtx.strokeStyle = "cyan";
    canvasCtx.lineWidth = 5;
    canvasCtx.lineCap = "round";
    canvasCtx.lineJoin = "round";
    
    // Shadow for better visibility
    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = "rgba(0, 255, 255, 0.5)";

    canvasCtx.beginPath();
    canvasCtx.moveTo(path[0].x * canvasElement.width, path[0].y * canvasElement.height);

    for (let i = 1; i < path.length - 2; i++) {
        const xc = (path[i].x + path[i + 1].x) / 2 * canvasElement.width;
        const yc = (path[i].y + path[i + 1].y) / 2 * canvasElement.height;
        canvasCtx.quadraticCurveTo(
            path[i].x * canvasElement.width, 
            path[i].y * canvasElement.height, 
            xc, yc
        );
    }

    // Connect last few points
    if (path.length > 2) {
        const last = path.length - 1;
        canvasCtx.quadraticCurveTo(
            path[last - 1].x * canvasElement.width,
            path[last - 1].y * canvasElement.height,
            path[last].x * canvasElement.width,
            path[last].y * canvasElement.height
        );
    }

    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0; // Reset shadow
}

/* ---------------- MEDIAPIPE ---------------- */

const hands = new Hands({
    locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(results => {
    clearCanvas();

    if (!results.multiHandLandmarks.length) {
        drawing = false;
        return;
    }

    const landmarks = results.multiHandLandmarks[0];

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];

    const pinchDist = distance(thumbTip, indexTip);

    // Hysteresis pinch logic
    if (!pinchActive && pinchDist < PINCH_START_THRESHOLD) {
        pinchActive = true;
    } 
    else if (pinchActive && pinchDist > PINCH_RELEASE_THRESHOLD) {
        pinchActive = false;
    }

    const isPinching = pinchActive;

    const smooth = {
        x: filterX.filter(indexTip.x),
        y: filterY.filter(indexTip.y)
    };

    if (isPinching) {

        if (!drawing) {
            drawing = true;
            path = [];
        }

        if (
            path.length === 0 ||
            distance(path[path.length - 1], smooth) > MOVEMENT_THRESHOLD
        ) {
            path.push(smooth);
        }

    } 
    else {

        // Drawing complete event
        if (drawing && path.length > 10) {
            if (onDrawingComplete) {
                onDrawingComplete([...path]);
            }
        }

        drawing = false;
    }

    drawTrail();
});

/* ---------------- CAMERA ---------------- */

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720
});

camera.start();

/* ---------------- EXPORT API ---------------- */

export function getCurrentPath() {
    return path;
}

export function clearPath() {
    path = [];
}