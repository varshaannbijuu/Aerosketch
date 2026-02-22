import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';
import { setDrawingCompleteCallback } from '../tracking/tracking.js';

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

scene.add(new THREE.AmbientLight(0xffffff, 1));

/* =========================
   VIDEO BACKGROUND
========================= */

const videoTexture = new THREE.VideoTexture(video);
const bgMaterial = new THREE.MeshBasicMaterial({ map: videoTexture });
const bgGeometry = new THREE.PlaneGeometry(1, 1);
const backgroundMesh = new THREE.Mesh(bgGeometry, bgMaterial);
backgroundMesh.position.z = -10;
scene.add(backgroundMesh);

function updateBackgroundScale() {
    const dist = camera.position.z + 10;
    const vFov = (camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * dist;
    const width = height * camera.aspect;
    backgroundMesh.scale.set(width, height, 1);
}

video.addEventListener("loadedmetadata", updateBackgroundScale);

window.addEventListener("resize", () => {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateBackgroundScale();
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
   SHAPE SPAWNING
========================= */

const objects = [];

function screenToWorld(x, y) {
    const ndc = new THREE.Vector3(
        (x / window.innerWidth) * 2 - 1,
        -(y / window.innerHeight) * 2 + 1,
        0.5
    );
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    const dist = -camera.position.z / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(dist));
}

function process(path) {

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!path || path.length < 5) return;   // lowered threshold

    const centerX = path.reduce((a, b) => a + b.x, 0) / path.length;
    const centerY = path.reduce((a, b) => a + b.y, 0) / path.length;

    const worldPos = screenToWorld(centerX, centerY);

    const geometry = new THREE.SphereGeometry(1, 32, 32);

    const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.6)
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(worldPos);

    scene.add(mesh);
    objects.push(mesh);
}

/* =========================
   RENDER LOOP
========================= */

function animate() {
    requestAnimationFrame(animate);

    objects.forEach((obj, i) => {
        obj.rotation.y += 0.01;
        obj.position.y += Math.sin(Date.now() * 0.001 + i) * 0.002;
    });

    renderer.render(scene, camera);
}
animate();

/* =========================
   TRACKING CALLBACK
========================= */

setDrawingCompleteCallback((normalizedPath) => {

    console.log("CALLBACK WORKING", normalizedPath.length);

    const pixelPath = normalizedPath.map(p => ({
        x: p.x * window.innerWidth,
        y: p.y * window.innerHeight
    }));

    drawPath(pixelPath);   // cyan
    process(pixelPath);    // spawn
});