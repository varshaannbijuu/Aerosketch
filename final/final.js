import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';
import { setDrawingCompleteCallback } from '../tracking/tracking.js';

const objects = [];

/* =========================
   BASIC SETUP
========================= */

const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

overlay.width = window.innerWidth;
overlay.height = window.innerHeight;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.domElement.style.position = "absolute";
renderer.domElement.style.zIndex = "1";
document.body.appendChild(renderer.domElement);

overlay.style.position = "absolute";
overlay.style.zIndex = "2";
overlay.style.pointerEvents = "none";

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const light = new THREE.PointLight(0xffffff, 100);
light.position.set(5, 5, 15);
scene.add(light);

/* =========================
   VIDEO BACKGROUND
========================= */

// Handled by CSS on the video element now for better performance and alignment
video.addEventListener("loadedmetadata", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("resize", () => {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

/* =========================
   RECORDING
========================= */

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

const recordBtn = document.getElementById("recordBtn");

recordBtn.addEventListener("click", () => {

    if (!isRecording) {

        const stream = renderer.domElement.captureStream(60);

        let options = {};
        if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9"))
            options.mimeType = "video/webm;codecs=vp9";
        else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8"))
            options.mimeType = "video/webm;codecs=vp8";

        mediaRecorder = new MediaRecorder(stream, options);
        recordedChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: "video/webm" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "AirSketchRecording.webm";
            a.click();
            URL.revokeObjectURL(url);
        };

        mediaRecorder.start();
        isRecording = true;
        recordBtn.textContent = "Stop Recording";
        recordBtn.style.background = "black";

    } else {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.textContent = "Start Recording";
        recordBtn.style.background = "red";
    }
});

/* =========================
   DRAW CYAN TRAIL
========================= */

function drawPath(path) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (path.length < 2) return;

    ctx.strokeStyle = "cyan";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);

    for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
    }

    ctx.stroke();
}

/* =========================
   SHAPE RECOGNITION HELPERS
========================= */

function boundingBox(path) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    path.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function resamplePath(points, n) {
    if (points.length < 2) return points;
    const resampled = [points[0]];
    const totalLen = points.reduce((acc, p, i) => i === 0 ? 0 : acc + getDistance(p, points[i - 1]), 0);
    const interval = totalLen / (n - 1);
    let distAccum = 0;

    // Create a working copy
    const pts = points.map(p => ({ ...p }));

    for (let i = 1; i < pts.length; i++) {
        let d = getDistance(pts[i], pts[i - 1]);
        while (distAccum + d >= interval) {
            const ratio = (interval - distAccum) / d;
            const newPt = {
                x: pts[i - 1].x + ratio * (pts[i].x - pts[i - 1].x),
                y: pts[i - 1].y + ratio * (pts[i].y - pts[i - 1].y)
            };
            resampled.push(newPt);
            d -= (interval - distAccum);
            pts[i - 1] = newPt;
            distAccum = 0;
        }
        distAccum += d;
    }
    return resampled;
}

function simplifyPath(points, epsilon) {
    if (points.length <= 2) return points;
    let maxDist = 0, index = 0;
    const start = points[0], end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const area = Math.abs(0.5 * (start.x * (end.y - p.y) + end.x * (p.y - start.y) + p.x * (start.y - end.y)));
        const bottom = getDistance(start, end);
        const dist = bottom === 0 ? getDistance(p, start) : (area * 2) / bottom;
        if (dist > maxDist) { maxDist = dist; index = i; }
    }

    if (maxDist > epsilon) {
        const left = simplifyPath(points.slice(0, index + 1), epsilon);
        const right = simplifyPath(points.slice(index), epsilon);
        return left.slice(0, left.length - 1).concat(right);
    } else return [start, end];
}

function getArea(path) {
    let area = 0;
    for (let i = 0; i < path.length; i++) {
        const p1 = path[i], p2 = path[(i + 1) % path.length];
        area += (p1.x * p2.y - p2.x * p1.y);
    }
    return Math.abs(area) / 2;
}

function getPathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += getDistance(path[i], path[i - 1]);
    return len;
}

/* =========================
   SHAPE SPAWNING ENGINE
========================= */

function screenToWorld(x, y) {
    const ndc = new THREE.Vector3(
        (x / window.innerWidth) * 2 - 1,
        -(y / window.innerHeight) * 2 + 1,
        0
    );
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const dist = -camera.position.z / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(dist));
}

function process(path) {
    const box = boundingBox(path);
    if (box.width < 10 || box.height < 10) return;

    const start = path[0], end = path[path.length - 1];
    const len = getPathLength(path);
    const closed = getDistance(start, end) < 120;

    const centerX = path.reduce((a, b) => a + b.x, 0) / path.length;
    const centerY = path.reduce((a, b) => a + b.y, 0) / path.length;
    const worldPos = screenToWorld(centerX, centerY);

    // 1. Line detection (High linearity)
    const lineRatio = getDistance(start, end) / len;
    if (!closed && lineRatio > 0.85) {
        return spawn("line", box, worldPos, path);
    }

    // 2. Geometric Shape Recognition
    const resampled = resamplePath(path, 100);
    const poly = simplifyPath(resampled, 25);
    const vertices = poly.length - 1;

    const area = getArea(path);
    const hullArea = box.width * box.height;
    const fillRatio = area / hullArea;
    const circularity = (4 * Math.PI * area) / (len * len);

    // Circle check (Highest priority for closed round shapes)
    if (circularity > 0.75 && vertices > 6) {
        return spawn("circle", box, worldPos, path);
    }

    // Triangle check
    if (vertices === 3 || (vertices === 4 && circularity < 0.6 && fillRatio < 0.6)) {
        return spawn("triangle", box, worldPos, path);
    }

    // Quadrilaterals (Square vs Rectangle)
    if (vertices === 4 || vertices === 5) {
        const isDiamond = Math.abs(poly[0].x - poly[2].x) < (box.width * 0.25) ||
            Math.abs(poly[1].y - poly[3].y) < (box.height * 0.25);
        if (isDiamond && vertices === 4) return spawn("diamond", box, worldPos, path);

        const aspect = box.width / box.height;
        if (aspect > 0.75 && aspect < 1.35) return spawn("square", box, worldPos, path);
        return spawn("rectangle", box, worldPos, path);
    }

    // Fallback logic
    if (circularity > 0.65) return spawn("circle", box, worldPos, path);
    if (vertices >= 7 && fillRatio < 0.4) return spawn("star", box, worldPos, path);

    // Default to Blob for anything else closed
    if (closed) {
        return spawn("blob", box, worldPos, path);
    }

    // Final fallback for open/messy drawings
    spawn("line", box, worldPos, path);
}

function spawn(type, box, center, path) {
    let geometry;
    const color = new THREE.Color().setHSL(Math.random(), 0.7, 0.6);
    const material = new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide, flatShading: true });

    const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * Math.abs(camera.position.z);
    const pixelScale = viewHeight / window.innerHeight;

    const createShape = (pts, depth = 0.5) => {
        const s = new THREE.Shape();
        if (pts.length === 0) return new THREE.BoxGeometry(0.1, 0.1, 0.1);
        s.moveTo(pts[0].x * pixelScale, -pts[0].y * pixelScale);
        for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x * pixelScale, -pts[i].y * pixelScale);
        s.closePath();
        return new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05 });
    };

    if (type === "line") {
        geometry = new THREE.BoxGeometry(box.width * pixelScale, 0.15, 0.15);
    } else if (type === "circle") {
        geometry = new THREE.SphereGeometry((box.width + box.height) / 4 * pixelScale, 32, 32);
    } else if (type === "triangle") {
        geometry = new THREE.ConeGeometry(box.width / 2 * pixelScale, box.height * pixelScale, 3);
    } else if (type === "square" || type === "rectangle") {
        const w = box.width / 2, h = box.height / 2;
        geometry = createShape([{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }]);
    } else if (type === "diamond") {
        const w = box.width / 2, h = box.height / 2;
        geometry = createShape([{ x: 0, y: -h }, { x: w, y: 0 }, { x: 0, y: h }, { x: -w, y: 0 }]);
    } else if (type === "pentagon") {
        const r = (box.width + box.height) / 4, pts = [];
        for (let i = 0; i < 5; i++) {
            const angle = i * 2 * Math.PI / 5 - Math.PI / 2;
            pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
        }
        geometry = createShape(pts);
    } else if (type === "star") {
        const r1 = (box.width + box.height) / 4, r2 = r1 / 2.5, pts = [];
        for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? r1 : r2, angle = i * Math.PI / 5 - Math.PI / 2;
            pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
        }
        geometry = createShape(pts);
    } else {
        const cx = path.reduce((a, b) => a + b.x, 0) / path.length;
        const cy = path.reduce((a, b) => a + b.y, 0) / path.length;

        // Final Submission Polish: Use CatmullRom smoothing for high-fidelity blobs with safety fallback
        const simplified = simplifyPath(path, 1.5);
        let finalPts;

        try {
            if (simplified.length < 2) throw new Error("Path too short");

            const pts3d = simplified.map(p => new THREE.Vector3(p.x - cx, p.y - cy, 0));
            // Ensure the curve is closed properly for the spline if it's a loop
            if (getDistance(simplified[0], simplified[simplified.length - 1]) < 80) {
                pts3d.push(pts3d[0].clone());
            }

            const curve = new THREE.CatmullRomCurve3(pts3d);
            finalPts = curve.getPoints(Math.max(simplified.length * 4, 100));
        } catch (e) {
            // Robust fallback if spline fails
            finalPts = simplified.map(p => ({ x: p.x - cx, y: p.y - cy }));
        }

        geometry = createShape(finalPts.map(p => ({ x: p.x, y: p.y })));
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);

    if (["square", "rectangle", "diamond", "star", "pentagon", "blob"].includes(type)) {
        mesh.rotation.x = 0;
    } else if (type === "triangle") {
        mesh.rotation.x = Math.PI;
    }

    scene.add(mesh);
    objects.push(mesh);
}

/* =========================
   USER INTERACTION
========================= */

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selected = null;

// Use mousedown/mousemove for selection to work with potential overlay blocking
// But click is cleaner for select.
window.addEventListener("click", (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(objects);

    if (hits.length > 0) {
        const clicked = hits[0].object;
        if (selected === clicked) {
            selected = null; // Toggle off
        } else {
            selected = clicked; // Select new
        }
    } else {
        selected = null; // Clicked background
    }
});

window.addEventListener("mousemove", (e) => {
    if (!selected) return;
    // Rotate selected object on mouse move with snappier sensitivity
    selected.rotation.y += e.movementX * 0.012;
    selected.rotation.x += e.movementY * 0.012;
});

window.addEventListener("dblclick", (e) => {
    // Independent raycast for deletion to avoid selection conflicts
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(objects);

    if (hits.length > 0) {
        const toDelete = hits[0].object;
        scene.remove(toDelete);
        objects.splice(objects.indexOf(toDelete), 1);
        if (selected === toDelete) selected = null;
    }
});

/* =========================
   RENDER LOOP
========================= */

function animate() {
    requestAnimationFrame(animate);
    // Removed ambient floating/rotation as per user request
    renderer.render(scene, camera);
}
animate();

/* =========================
   TRACKING CALLBACK
========================= */

setDrawingCompleteCallback((normalizedPath) => {
    console.log("Gesture complete. Points:", normalizedPath.length);

    // Standardized coordinates: Mirroring already handled by tracking.js
    const pixelPath = normalizedPath.map(p => ({
        x: p.x * window.innerWidth,
        y: p.y * window.innerHeight
    }));

    drawPath(pixelPath);   // Draw temporary cyan trail
    process(pixelPath);    // Run recognition and spawn
});
