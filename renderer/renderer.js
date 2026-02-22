import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';

/* ===== SETUP ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.z = 12;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1));

const objects = [];

/* ===== DRAW ===== */
let isDrawing = false;
let path = [];

window.addEventListener("mousedown", () => {
    isDrawing = true;
    path = [];
});

window.addEventListener("mouseup", () => {
    isDrawing = false;
    if (path.length > 15) process(path); // lowered threshold
});

window.addEventListener("mousemove", (e) => {
    if (!isDrawing) return;
    path.push({ x: e.clientX, y: e.clientY });
});

/* ===== HELPERS ===== */

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

function boundingBox(path) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    path.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });
    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX,
        height: maxY - minY
    };
}

function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function getArea(path) {
    let area = 0;
    for (let i = 0; i < path.length; i++) {
        const p1 = path[i];
        const p2 = path[(i + 1) % path.length];
        area += (p1.x * p2.y - p2.x * p1.y);
    }
    return Math.abs(area) / 2;
}

function getPathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) {
        len += getDistance(path[i], path[i - 1]);
    }
    return len;
}

/* ===== PROCESS ===== */

function process(path) {

    const box = boundingBox(path);

    // Prevent tiny accidental shapes
    if (box.width < 30 || box.height < 30) return;

    const start = path[0];
    const end = path[path.length - 1];

    const closed = getDistance(start, end) < 60;

    const centerX = path.reduce((a, b) => a + b.x, 0) / path.length;
    const centerY = path.reduce((a, b) => a + b.y, 0) / path.length;

    const worldPos = screenToWorld(centerX, centerY);

    const len = getPathLength(path);
    const area = getArea(path);
    const circularity = (4 * Math.PI * area) / (len * len);
    const fillRatio = area / (box.width * box.height);

    // Line
    if (!closed && getDistance(start, end) / len > 0.85) {
        return spawn("line", box, worldPos, path);
    }

    // Circle
    if (circularity > 0.75 && fillRatio > 0.6) {
        return spawn("circle", box, worldPos, path);
    }

    // Star
    if (fillRatio < 0.4) {
        return spawn("star", box, worldPos, path);
    }

    // Square / Rectangle
    if (Math.abs(box.width - box.height) < box.width * 0.2) {
        return spawn("square", box, worldPos, path);
    }

    return spawn("rectangle", box, worldPos, path);
}

/* ===== SPAWN ===== */

function spawn(type, box, center, path) {

    let geometry;
    const color = new THREE.Color().setHSL(Math.random(), 0.7, 0.6);
    const material = new THREE.MeshPhongMaterial({
        color,
        flatShading: true
    });

    const viewHeight = 2 * Math.tan((75 * Math.PI) / 360) * 12;
    const pixelScale = viewHeight / window.innerHeight;

    if (type === "line") {
        geometry = new THREE.BoxGeometry(box.width * pixelScale, 0.2, 0.2);
    }
    else if (type === "circle") {
        geometry = new THREE.SphereGeometry(
            (box.width + box.height) / 4 * pixelScale,
            32,
            32
        );
    }
    else if (type === "square") {
        geometry = new THREE.BoxGeometry(
            box.width * pixelScale,
            box.height * pixelScale,
            0.5
        );
    }
    else if (type === "rectangle") {
        geometry = new THREE.BoxGeometry(
            box.width * pixelScale,
            box.height * pixelScale,
            0.5
        );
    }
    else if (type === "star") {
        geometry = new THREE.ConeGeometry(
            (box.width + box.height) / 4 * pixelScale,
            box.height * pixelScale,
            5
        );
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);

    scene.add(mesh);
    objects.push(mesh);
}

/* ===== ROTATE & DELETE ===== */

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selected = null;

window.addEventListener("click", (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(objects);

    selected = hits.length ? hits[0].object : null;
});

window.addEventListener("mousemove", (e) => {
    if (!selected || isDrawing) return;

    selected.rotation.y += e.movementX * 0.01;
    selected.rotation.x += e.movementY * 0.01;
});

window.addEventListener("dblclick", () => {
    if (!selected) return;

    scene.remove(selected);
    objects.splice(objects.indexOf(selected), 1);
    selected = null;
});

/* ===== LOOP ===== */

function animate() {
    requestAnimationFrame(animate);

    objects.forEach((obj) => {
        obj.rotation.y += 0.01;
    });

    renderer.render(scene, camera);
}

animate();