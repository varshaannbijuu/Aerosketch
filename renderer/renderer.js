import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';

/* ===== SETUP ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 12;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Added a PointLight so shapes have depth/shading
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const light = new THREE.PointLight(0xffffff, 100);
light.position.set(5, 5, 15);
scene.add(light);

const objects = [];

/* ===== DRAW LOGIC (Handled by tracking.js in final implementation) ===== */
let isDrawing = false;
let path = [];

/* ===== HELPERS ===== */

function screenToWorld(x, y) {
    const ndc = new THREE.Vector3(
        (x / window.innerWidth) * 2 - 1,
        -(y / window.innerHeight) * 2 + 1,
        0 // Project from near plane
    );
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    // Calculate distance to the Z=0 plane (where we want to spawn)
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
    if (points.length < 2) return points;
    const resampled = [points[0]];
    const totalLen = points.reduce((acc, p, i) => i === 0 ? 0 : acc + getDistance(p, points[i - 1]), 0);
    const interval = totalLen / (n - 1);
    let distAccum = 0;
    
    for (let i = 1; i < points.length; i++) {
        let d = getDistance(points[i], points[i-1]);
        while (distAccum + d >= interval) {
            const ratio = (interval - distAccum) / d;
            const newPt = {
                x: points[i-1].x + ratio * (points[i].x - points[i-1].x),
                y: points[i-1].y + ratio * (points[i].y - points[i-1].y)
            };
            resampled.push(newPt);
            d -= (interval - distAccum);
            points[i-1] = newPt;
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

/* ===== PROCESS ===== */

function process(path) {
    const box = boundingBox(path);
    if (box.width < 20 || box.height < 20) return; // Ignore tiny accidental clicks

    const start = path[0], end = path[path.length - 1];
    const len = getPathLength(path);
    const closed = getDistance(start, end) < 60;
    
    const centerX = path.reduce((a, b) => a + b.x, 0) / path.length;
    const centerY = path.reduce((a, b) => a + b.y, 0) / path.length;
    const worldPos = screenToWorld(centerX, centerY);

    if (!closed && getDistance(start, end) / len > 0.85) {
        return spawn("line", box, worldPos, path);
    }

    // 1. Polygon Recognition
    const poly = simplifyPath(resamplePath(path, 100), 25);
    const vertices = poly.length - 1;

    // 2. Shape Analysis
    const area = getArea(path);
    const fillRatio = area / (box.width * box.height);
    const circularity = (4 * Math.PI * area) / (len * len);

    // FIX: Define and check circularity/fillRatio before spawning
    if (circularity > 0.75 && vertices > 6 && fillRatio > 0.5) {
        return spawn("circle", box, worldPos, path);
    }

    if (vertices >= 7 && fillRatio < 0.4) return spawn("star", box, worldPos, path);
    if (vertices === 3) return spawn("triangle", box, worldPos, path);
    
    if (vertices === 4) {
        const isDiamond = Math.abs(poly[0].x - poly[2].x) < (box.width * 0.3) || 
                          Math.abs(poly[1].y - poly[3].y) < (box.height * 0.3);
        if (isDiamond) return spawn("diamond", box, worldPos, path);
        
        return (Math.abs(box.width - box.height) < box.width * 0.3) ? 
                spawn("square", box, worldPos, path) : 
                spawn("rectangle", box, worldPos, path);
    }

    if (vertices === 5) return spawn("pentagon", box, worldPos, path);
    if (circularity > 0.65) return spawn("circle", box, worldPos, path);

    spawn("blob", box, worldPos, path);
}

/* ===== SPAWN ===== */

function spawn(type, box, center, path) {
    let geometry;
    const color = new THREE.Color().setHSL(Math.random(), 0.7, 0.6);
    const material = new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide, flatShading: true });
    
    // Correct scaling for PerspectiveCamera at Z=12
    const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * Math.abs(camera.position.z);
    const pixelScale = viewHeight / window.innerHeight;

    const createShape = (pts, depth = 0.5) => {
        const s = new THREE.Shape();
        s.moveTo(pts[0].x * pixelScale, -pts[0].y * pixelScale);
        for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x * pixelScale, -pts[i].y * pixelScale);
        s.closePath();
        return new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05 });
    };

    if (type === "line") {
        geometry = new THREE.BoxGeometry(box.width * pixelScale, 0.1, 0.1);
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
    } else if (type === "star") {
        const r1 = (box.width + box.height) / 4, r2 = r1 / 2.5, pts = [];
        for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? r1 : r2, angle = i * Math.PI / 5 - Math.PI / 2;
            pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
        }
        geometry = createShape(pts);
    } else {
        // Blob / Custom Path
        const cx = path.reduce((a, b) => a + b.x, 0) / path.length;
        const cy = path.reduce((a, b) => a + b.y, 0) / path.length;
        const pts = simplifyPath(path, 5).map(p => ({ x: p.x - cx, y: p.y - cy }));
        geometry = createShape(pts);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    
    // Rotate 2D extrusions to face camera
    if (["square", "rectangle", "diamond", "star", "blob"].includes(type)) {
        mesh.rotation.x = 0;
    } else if (type === "triangle") {
        mesh.rotation.x = Math.PI; // Flip cone
    }

    scene.add(mesh);
    objects.push(mesh);
}

/* ===== INTERACTION (Handled by final.js and hand gestures) ===== */

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selected = null;

/* ===== LOOP ===== */

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});