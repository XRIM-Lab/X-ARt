import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { applyBloomTint, createFireMaterialApplier } from './fire-effect.js';

export function initBackground3D(viewer, mobileLayout, {
  desktopBloomStrength = 250,
  mobileBloomStrength = desktopBloomStrength,
  bloomThreshold = 0.1,
  bloomRadius = 0.15,
  mobileBloomRadius = bloomRadius,
  bloomTint = null,
  modelScale = 1,
  modelRotation = null,
  cameraElevation = 50,
  cameraAzimuthStart = 45,
  cameraAzimuthMid = null,
  cameraAzimuthRange = 180,
  cameraOscillates = false,
  lightIntensity = 1,
  fireMaterial = null
}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewer.append(renderer.domElement);

  const scene = new THREE.Scene();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment).texture;
  scene.environmentIntensity = lightIntensity;
  environment.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), desktopBloomStrength, bloomRadius, bloomThreshold);
  if (bloomTint) applyBloomTint(bloom, bloomTint);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);
  const models = new Map();
  const applyFireMaterial = fireMaterial && createFireMaterialApplier(fireMaterial);
  const clock = new THREE.Clock();
  let fireShaderMaterial;
  const center = new THREE.Vector3();
  let distance = 6;
  let modelRadius = 0;
  let progress = 0;
  let currentModel;
  let loadSequence = 0;

  function render() {
    if (!currentModel || document.hidden) return;
    const rotationProgress = cameraOscillates ? Math.sin(progress * Math.PI * 2) : progress;
    const azimuthDegrees = cameraAzimuthMid === null
      ? cameraAzimuthStart + rotationProgress * cameraAzimuthRange
      : progress <= 0.5
        ? THREE.MathUtils.lerp(cameraAzimuthStart, cameraAzimuthMid, progress * 2)
        : THREE.MathUtils.lerp(cameraAzimuthMid, cameraAzimuthStart + cameraAzimuthRange, (progress - 0.5) * 2);
    const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
    const elevation = THREE.MathUtils.degToRad(cameraElevation);
    camera.position.set(
      center.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      center.y + distance * Math.sin(elevation),
      center.z + distance * Math.cos(elevation) * Math.cos(azimuth)
    );
    camera.lookAt(center);
    if ((mobileLayout.matches ? mobileBloomStrength : desktopBloomStrength) <= 0) {
      renderer.render(scene, camera);
    } else {
      composer.render();
    }
  }

  function renderLoop() {
    if (fireShaderMaterial) fireShaderMaterial.uniforms.uTime.value = clock.getElapsedTime();
    render();
  }

  function resize() {
    const width = Math.max(1, viewer.clientWidth);
    const height = Math.max(1, viewer.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, mobileLayout.matches ? 1.5 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloom.strength = mobileLayout.matches ? mobileBloomStrength : desktopBloomStrength;
    bloom.radius = mobileLayout.matches ? mobileBloomRadius : bloomRadius;
    camera.aspect = width / height;
    if (modelRadius) {
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      distance = Math.max(0.1, modelRadius * 1.3 / Math.sin(Math.min(verticalFov, horizontalFov) / 2) / modelScale);
      camera.near = Math.max(0.01, distance / 1000);
      camera.far = Math.max(1000, distance * 4);
    }
    camera.updateProjectionMatrix();
    render();
  }

  async function loadVariant() {
    const sequence = ++loadSequence;
    const src = mobileLayout.matches ? viewer.dataset.mobileSrc : viewer.dataset.src;
    if (!models.has(src)) {
      models.set(src, loader.loadAsync(src).then(gltf => {
        if (!modelRotation) return gltf;
        const orientedModel = new THREE.Group();
        orientedModel.rotation.set(
          THREE.MathUtils.degToRad(modelRotation.x ?? 0),
          THREE.MathUtils.degToRad(modelRotation.y ?? 0),
          THREE.MathUtils.degToRad(modelRotation.z ?? 0),
          'ZYX'
        );
        orientedModel.add(gltf.scene);
        return { ...gltf, scene: orientedModel };
      }));
    }
    const gltf = await models.get(src);
    if (sequence !== loadSequence) return;

    if (currentModel) scene.remove(currentModel);
    currentModel = gltf.scene;
    scene.add(currentModel);
    if (applyFireMaterial) {
      const material = await applyFireMaterial(currentModel);
      if (material && !fireShaderMaterial) {
        fireShaderMaterial = material;
        renderer.setAnimationLoop(renderLoop);
      }
      if (sequence !== loadSequence) return;
    }
    const bounds = new THREE.Box3().setFromObject(currentModel);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    center.copy(sphere.center);
    modelRadius = sphere.radius;
    resize();
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', render);
  mobileLayout.addEventListener('change', () => {
    resize();
    loadVariant().catch(error => console.error('Could not load 3D background', error));
  });
  resize();

  return {
    ready: loadVariant(),
    setProgress(value) {
      progress = THREE.MathUtils.clamp(value, 0, 1);
      render();
    }
  };
}
