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

const SMOOTHING_WINDOW = 5;
const MOVEMENT_THRESHOLD = 0.01;

let smoothingBuffer = [];

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

function smoothPoint(point) {
    smoothingBuffer.push(point);

    if (smoothingBuffer.length > SMOOTHING_WINDOW) {
        smoothingBuffer.shift();
    }

    const avg = smoothingBuffer.reduce((acc, p) => {
        acc.x += p.x;
        acc.y += p.y;
        return acc;
    }, { x: 0, y: 0 });

    avg.x /= smoothingBuffer.length;
    avg.y /= smoothingBuffer.length;

    return avg;
}

function clearCanvas() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
}

function drawTrail() {
    if (path.length < 2) return;

    canvasCtx.strokeStyle = "cyan";
    canvasCtx.lineWidth = 4;
    canvasCtx.lineCap = "round";
    canvasCtx.beginPath();

    for (let i = 0; i < path.length - 1; i++) {
        canvasCtx.moveTo(
            path[i].x * canvasElement.width,
            path[i].y * canvasElement.height
        );
        canvasCtx.lineTo(
            path[i + 1].x * canvasElement.width,
            path[i + 1].y * canvasElement.height
        );
    }

    canvasCtx.stroke();
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
        smoothingBuffer = [];
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

    const currentPoint = {
        x: indexTip.x,
        y: indexTip.y
    };

    if (isPinching) {

        if (!drawing) {
            drawing = true;
            path = [];
            smoothingBuffer = [];
        }

        const smooth = smoothPoint(currentPoint);

        if (
            path.length === 0 ||
            distance(path[path.length - 1], smooth) > MOVEMENT_THRESHOLD
        ) {
            path.push(smooth);
        }

    } 
    else {

        // Drawing complete event
        if (drawing && path.length > 15) {
            if (onDrawingComplete) {
                onDrawingComplete([...path]);
            }
        }

        drawing = false;
        smoothingBuffer = [];
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