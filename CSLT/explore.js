const MOBILE_LAYOUT_QUERY = '(max-width: 767px), (pointer: coarse)';
const DESKTOP_POINT_SIZE = 0.0055;
const MOBILE_POINT_SIZE = 0.0065;
const SCAN_ROTATION_DEGREES = [30.3, -0.1, 16.7];
const CAMERA_AZIMUTH_DEGREES = 165;
const CAMERA_ELEVATION_DEGREES = 12;
const CAMERA_ROLL_DEGREES = 90;
const VIEW_Z_ROTATION_DEGREES = -8;
const VIEW_Y_ROTATION_DEGREES = -20;
const VIEW_X_ROTATION_DEGREES = -6;
const ARTWORK_SCAN_POSITION = [0.775, 1.024, 0.745];
const ARTWORK_RADIUS = 1.5;
const SPAWN_DISTANCE = 4.5;
const MOVE_SPEED = 1.6;
const SPRINT_FACTOR = 3;
const LOOK_SENSITIVITY = 0.0022;
const PITCH_LIMIT = 85 * Math.PI / 180;
const FRAME_DT_CAP = 0.05;
const MOVE_BOUNDS = {
  right: [-6.5, 3],
  up: [-3, 3],
  back: [-6, 6]
};
const KEY_ACTIONS = {
  w: 'forward', s: 'back', a: 'left', d: 'right', q: 'lower', e: 'rise', shift: 'sprint',
  arrowup: 'forward', arrowdown: 'back', arrowleft: 'left', arrowright: 'right'
};

const canvas = document.getElementById('view');
const statusText = document.getElementById('status');
const lookButton = document.getElementById('lookButton');
const resetButton = document.getElementById('resetButton');
const mobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let THREE;
let renderer;
let scene;
let camera;
let points;
let fireOverlay;
let direction;
let viewUp;
let right;
let artworkWorld;
let spawnPosition;
let baseQuaternion;
let yaw = 0;
let pitch = 0;
let pendingFrame = 0;
let lastTime = 0;
let pointerLocked = false;
let dragPointer = null;
let dragX = 0;
let dragY = 0;
const held = new Set();
let yawQuaternion;
let pitchQuaternion;
let xAxis;
let moveForward;
let moveRight;
let moveOffset;
let moveRelative;

function setStatus(message) {
  statusText.textContent = message;
}

function releaseAll() {
  held.clear();
  dragPointer = null;
}

function cancelFrame() {
  if (pendingFrame) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
}

function requestRender() {
  if (pendingFrame || document.hidden || !renderer) return;
  pendingFrame = requestAnimationFrame(tick);
}

function tick(now) {
  pendingFrame = 0;
  if (document.hidden || !renderer) return;
  const dt = lastTime ? Math.min(FRAME_DT_CAP, (now - lastTime) / 1000) : 0;
  lastTime = now;
  applyOrientation();
  if (held.size) move(dt);
  draw();
  if (held.size) requestRender();
}

function applyOrientation() {
  yawQuaternion.setFromAxisAngle(viewUp, yaw);
  pitchQuaternion.setFromAxisAngle(xAxis, pitch);
  camera.quaternion.copy(yawQuaternion).multiply(baseQuaternion).multiply(pitchQuaternion);
}

function move(dt) {
  let x = 0;
  let y = 0;
  let z = 0;
  if (held.has('forward')) z += 1;
  if (held.has('back')) z -= 1;
  if (held.has('right')) x += 1;
  if (held.has('left')) x -= 1;
  if (held.has('rise')) y += 1;
  if (held.has('lower')) y -= 1;
  moveForward.copy(direction).negate().applyQuaternion(yawQuaternion);
  moveRight.copy(right).applyQuaternion(yawQuaternion);
  moveOffset.set(0, 0, 0)
    .addScaledVector(moveForward, z)
    .addScaledVector(moveRight, x)
    .addScaledVector(viewUp, y);
  if (moveOffset.lengthSq() === 0) return;
  moveOffset.normalize().multiplyScalar(MOVE_SPEED * (held.has('sprint') ? SPRINT_FACTOR : 1) * dt);
  moveRelative.copy(camera.position).add(moveOffset).sub(artworkWorld);
  const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
  camera.position.copy(artworkWorld)
    .addScaledVector(right, clamp(moveRelative.dot(right), MOVE_BOUNDS.right))
    .addScaledVector(viewUp, clamp(moveRelative.dot(viewUp), MOVE_BOUNDS.up))
    .addScaledVector(direction, clamp(moveRelative.dot(direction), MOVE_BOUNDS.back));
}

function draw() {
  renderer.render(scene, camera);
  fireOverlay?.render(1);
}

function applyLook(dx, dy) {
  yaw -= dx * LOOK_SENSITIVITY;
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dy * LOOK_SENSITIVITY));
  requestRender();
}

function reset() {
  releaseAll();
  yaw = 0;
  pitch = 0;
  camera?.position.copy(spawnPosition);
  requestRender();
}

function resize() {
  if (!renderer) return;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileLayout.matches ? 1.5 : 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  fireOverlay?.setSize();
  requestRender();
}

async function loadArtwork(artworkRotation) {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js')
  ]);
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/draco/');
  try {
    const src = mobileLayout.matches ? 'Artwork.mobile.glb' : 'Artwork.glb';
    const [{ scene: model }, { createFireMaterialApplier }, { FIRE_EFFECT_OPTIONS }, { createFireOverlay }] = await Promise.all([
      new GLTFLoader().setDRACOLoader(draco).loadAsync(src),
      import('../fire-effect.js'),
      import('../fire-effect-options.js'),
      import('./fire-overlay.js')
    ]);
    const bounds = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
    if (bounds.radius <= 0) return;
    const applyFire = createFireMaterialApplier({
      ...FIRE_EFFECT_OPTIONS.material,
      vertexUrl: '../Fire2.vert',
      fragmentUrl: '../Fire2.frag'
    });
    const material = await applyFire(model);
    if (!material) return;
    fireOverlay = createFireOverlay({
      renderer,
      scene,
      camera,
      occluders: [points],
      reducedMotion,
      onFrame: requestRender
    });
    if (!fireOverlay) return;
    const artwork = new THREE.Group();
    model.position.sub(bounds.center);
    artwork.add(model);
    artwork.scale.setScalar(ARTWORK_RADIUS / bounds.radius);
    artwork.rotateOnWorldAxis(right, THREE.MathUtils.degToRad(artworkRotation.x));
    artwork.rotateOnWorldAxis(viewUp, THREE.MathUtils.degToRad(artworkRotation.y));
    artwork.rotateOnWorldAxis(direction, THREE.MathUtils.degToRad(artworkRotation.z));
    artwork.position.copy(artworkWorld);
    scene.add(artwork);
    fireOverlay.attach(artwork, material);
    requestRender();
  } finally {
    draco.dispose();
  }
}

async function start(artworkRotation) {
  setStatus('Loading scan…');
  const mobile = mobileLayout.matches;
  const [threeModule, { PLYLoader }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/PLYLoader.js')
  ]);
  THREE = threeModule;
  xAxis = new THREE.Vector3(1, 0, 0);
  yawQuaternion = new THREE.Quaternion();
  pitchQuaternion = new THREE.Quaternion();
  moveForward = new THREE.Vector3();
  moveRight = new THREE.Vector3();
  moveOffset = new THREE.Vector3();
  moveRelative = new THREE.Vector3();
  const geometry = await new PLYLoader().loadAsync(mobile ? 'pointcloud/shop.mobile.ply' : 'pointcloud/shop.ply');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  points = new THREE.Points(geometry, new THREE.PointsMaterial({
    vertexColors: true,
    size: mobile ? MOBILE_POINT_SIZE : DESKTOP_POINT_SIZE,
    sizeAttenuation: true
  }));
  points.rotation.set(
    THREE.MathUtils.degToRad(SCAN_ROTATION_DEGREES[0]),
    THREE.MathUtils.degToRad(SCAN_ROTATION_DEGREES[1]),
    THREE.MathUtils.degToRad(SCAN_ROTATION_DEGREES[2])
  );
  const azimuth = THREE.MathUtils.degToRad(CAMERA_AZIMUTH_DEGREES);
  const elevation = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEGREES);
  direction = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth)
  );
  const up = direction.clone().cross(new THREE.Vector3(0, 1, 0)).cross(direction).normalize();
  viewUp = up.applyAxisAngle(direction, THREE.MathUtils.degToRad(CAMERA_ROLL_DEGREES));
  right = viewUp.clone().cross(direction).normalize();
  points.rotateOnWorldAxis(viewUp, THREE.MathUtils.degToRad(VIEW_Z_ROTATION_DEGREES));
  points.rotateOnWorldAxis(right, THREE.MathUtils.degToRad(VIEW_Y_ROTATION_DEGREES));
  points.rotateOnWorldAxis(direction, THREE.MathUtils.degToRad(VIEW_X_ROTATION_DEGREES));
  scene.add(points);
  artworkWorld = new THREE.Vector3(...ARTWORK_SCAN_POSITION).applyQuaternion(points.quaternion);
  spawnPosition = artworkWorld.clone().addScaledVector(direction, SPAWN_DISTANCE);
  camera.up.copy(viewUp);
  camera.position.copy(spawnPosition);
  camera.lookAt(artworkWorld);
  baseQuaternion = camera.quaternion.clone();
  resize();
  lookButton.disabled = false;
  resetButton.disabled = false;
  setStatus('Ready — free-fly through the scan (no collisions)');
  requestRender();
  loadArtwork(artworkRotation).catch(error => console.warn('Could not load CSLT artwork', error));
}

lookButton.addEventListener('click', () => {
  try {
    const request = canvas.requestPointerLock();
    if (request && typeof request.catch === 'function') {
      request.catch(() => setStatus('Pointer lock unavailable — drag on the view to look around'));
    }
  } catch {
    setStatus('Pointer lock unavailable — drag on the view to look around');
  }
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) releaseAll();
  setStatus(pointerLocked ? 'Looking — press Esc to release' : 'Ready — free-fly through the scan (no collisions)');
});
document.addEventListener('pointerlockerror', () => {
  setStatus('Pointer lock unavailable — drag on the view to look around');
});
document.addEventListener('mousemove', event => {
  if (pointerLocked) applyLook(event.movementX, event.movementY);
});
canvas.addEventListener('pointerdown', event => {
  if (pointerLocked) return;
  event.preventDefault();
  dragPointer = event.pointerId;
  dragX = event.clientX;
  dragY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (pointerLocked || event.pointerId !== dragPointer) return;
  applyLook(event.clientX - dragX, event.clientY - dragY);
  dragX = event.clientX;
  dragY = event.clientY;
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, event => {
    if (event.pointerId === dragPointer) dragPointer = null;
  });
}
for (const button of document.querySelectorAll('[data-move]')) {
  const action = button.dataset.move;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    held.add(action);
    button.setPointerCapture(event.pointerId);
    requestRender();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, () => held.delete(action));
  }
}
resetButton.addEventListener('click', reset);
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'r') {
    event.preventDefault();
    reset();
    return;
  }
  const action = KEY_ACTIONS[key];
  if (!action) return;
  event.preventDefault();
  held.add(action);
  requestRender();
});
window.addEventListener('keyup', event => {
  const action = KEY_ACTIONS[event.key.toLowerCase()];
  if (action) held.delete(action);
});
window.addEventListener('blur', releaseAll);
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseAll();
    cancelFrame();
    fireOverlay?.cancel();
  } else {
    requestRender();
  }
});

export function startExplorer(artworkRotation) {
  start(artworkRotation).catch(error => {
    console.error('Could not load the CSLT scan', error);
    setStatus('Could not load the scan — use the link to go back');
  });
}
