import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';

/* ===== SETUP ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 12;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1));

const objects = [];

/* ===== DRAW ===== */
let isDrawing = false;
let path = [];

window.addEventListener("mousedown", () => { isDrawing = true; path = []; });
window.addEventListener("mouseup", () => {
    isDrawing = false;
    if (path.length > 20) process(path);
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
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function resamplePath(points, n) {
    if (points.length === 0) return [];
    const resampled = [points[0]];
    const totalLen = points.reduce((acc, p, i) => i === 0 ? 0 : acc + getDistance(p, points[i - 1]), 0);
    const interval = totalLen / (n - 1);
    let distAccum = 0;
    const pts = [...points];

    for (let i = 1; i < pts.length; i++) {
        let d = getDistance(pts[i], pts[i - 1]);
        if (distAccum + d >= interval) {
            const ratio = (interval - distAccum) / d;
            const newPoint = {
                x: pts[i - 1].x + ratio * (pts[i].x - pts[i - 1].x),
                y: pts[i - 1].y + ratio * (pts[i].y - pts[i - 1].y)
            };
            resampled.push(newPoint);
            pts.splice(i, 0, newPoint);
            distAccum = 0;
        } else {
            distAccum += d;
        }
    }
    while (resampled.length < n) resampled.push(pts[pts.length - 1]);
    return resampled.slice(0, n);
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

/* ===== PROCESS ===== */

function process(path) {
    const box = boundingBox(path);
    const start = path[0], end = path[path.length - 1];
    const closed = getDistance(start, end) < 60;
    const centerX = path.reduce((a, b) => a + b.x, 0) / path.length;
    const centerY = path.reduce((a, b) => a + b.y, 0) / path.length;
    const worldPos = screenToWorld(centerX, centerY);

    const len = getPathLength(path);
    if (!closed && getDistance(start, end) / len > 0.85) return spawn("line", box, worldPos, path);

    // 1. Polygon Recognition (High resolution priority)
    const poly = simplifyPath(resamplePath(path, 100), 25);
    const vertices = poly.length - 1;

    // 2. Area/Perimeter analysis for special shapes
    const area = getArea(path);
    const hullArea = box.width * box.height;
    const circularity = (4 * Math.PI * area) / (len * len);

    // Highly circular shapes are always circles
    if (circularity > 0.82) return spawn("circle", box, worldPos, path);

    // Spiky shapes are stars
    if (area / hullArea < 0.45 && vertices >= 5) return spawn("star", box, worldPos, path);

    if (vertices === 3) return spawn("triangle", box, worldPos, path);
    if (vertices === 4) {
        // Distinguish Diamond vs Rectangle
        const isDiamond = Math.abs(poly[0].x - poly[2].x) < (box.width * 0.25) || Math.abs(poly[1].y - poly[3].y) < (box.height * 0.25);
        if (isDiamond) return spawn("diamond", box, worldPos, path);

        return (Math.abs(box.width - box.height) < box.width * 0.3) ? spawn("square", box, worldPos, path) : spawn("rectangle", box, worldPos, path);
    }
    if (vertices === 5) return spawn("pentagon", box, worldPos, path);

    // Fallback for imperfect circles
    if (circularity > 0.7) return spawn("circle", box, worldPos, path);

    spawn("blob", box, worldPos, path);
}

/* ===== SPAWN ===== */

function spawn(type, box, center, path) {
    let geometry;
    const color = new THREE.Color().setHSL(Math.random(), 0.7, 0.6);
    const material = new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide, flatShading: true });
    const viewHeight = 2 * Math.tan((75 * Math.PI) / 360) * 12;
    const pixelScale = viewHeight / window.innerHeight;

    const createShape = (pts, depth = 0.5) => {
        const s = new THREE.Shape();
        s.moveTo(pts[0].x * pixelScale, -pts[0].y * pixelScale);
        for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x * pixelScale, -pts[i].y * pixelScale);
        s.closePath();
        return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1 });
    };

    if (type === "line") geometry = new THREE.BoxGeometry(box.width * pixelScale, 0.2, 0.2);
    else if (type === "circle") geometry = new THREE.SphereGeometry((box.width + box.height) / 4 * pixelScale, 32, 32);
    else if (type === "triangle") geometry = new THREE.ConeGeometry(box.width / 2 * pixelScale, box.height * pixelScale, 3);
    else if (type === "square" || type === "rectangle") {
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
        const cx = path.reduce((a, b) => a + b.x, 0) / path.length, cy = path.reduce((a, b) => a + b.y, 0) / path.length;
        const pts = simplifyPath(path, 2).map(p => ({ x: p.x - cx, y: p.y - cy }));
        geometry = createShape(pts);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    if (["square", "rectangle", "triangle", "diamond", "pentagon", "star"].includes(type)) mesh.rotation.x = 0;
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
    renderer.render(scene, camera);
}
animate();