import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DEFAULT_FIRE_MATERIAL = {
  vertexUrl: 'Fire2.vert',
  fragmentUrl: 'Fire2.frag',
  color: '#ffae00',
  emissionGain: 1,
  scroll1: 2,
  scroll2: 0,
  displacementIntensity: 1,
  textureScaleX: 1,
  textureOffsetX: 0,
  clampTextureX: false
};

function prepareFireVertexShader(source) {
  return source
    .replace(/#version[^\n]*\n/, '')
    .replace(/precision[^;]+;\n/, '')
    .replace(/layout\(location = \d+\)\s*/g, '')
    .replace('uniform mat4 uModelViewProjection;', '')
    .replace(/uModelViewProjection\s*\*\s*vec4\(aPosition,\s*1\.0\)/, 'projectionMatrix * modelViewMatrix * vec4(aPosition, 1.0)');
}

function prepareFireFragmentShader(source) {
  return source
    .replace(/#version[^\n]*\n/, '')
    .replace(/precision[^;]+;\n/, '');
}

function ensureFireAttributes(geometry, vertexColor) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const color = geometry.getAttribute('color');
  if (position && !geometry.getAttribute('aPosition')) geometry.setAttribute('aPosition', position);
  if (uv && !geometry.getAttribute('aTexcoord')) geometry.setAttribute('aTexcoord', uv);
  if (color?.itemSize === 4 && !geometry.getAttribute('aColor')) {
    geometry.setAttribute('aColor', color);
  } else if (!geometry.getAttribute('aColor') && position) {
    const colorValues = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      colorValues.set([vertexColor.r, vertexColor.g, vertexColor.b, 1], i * 4);
    }
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colorValues, 4));
  }
}

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
  environment.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), desktopBloomStrength, bloomRadius, bloomThreshold);
  if (bloomTint) {
    bloom.materialHighPassFilter.fragmentShader = `
      uniform vec3 defaultColor;
      uniform float defaultOpacity;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        float bloomMask = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance);
        gl_FragColor = mix(vec4(defaultColor, defaultOpacity), vec4(1.0), bloomMask);
      }`;
    bloom.materialHighPassFilter.needsUpdate = true;
    const tint = new THREE.Color(bloomTint);
    bloom.bloomTintColors.forEach(color => color.set(tint.r, tint.g, tint.b));
  }
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);
  const models = new Map();
  const fireConfig = fireMaterial && { ...DEFAULT_FIRE_MATERIAL, ...fireMaterial };
  const clock = new THREE.Clock();
  let fireShaderPromise;
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

  async function getFireShaderMaterial(sourceMap) {
    if (!fireShaderPromise) {
      fireShaderPromise = Promise.all([
        fetch(fireConfig.vertexUrl).then(response => response.text()),
        fetch(fireConfig.fragmentUrl).then(response => response.text())
      ]);
    }
    const [vertexSource, fragmentSource] = await fireShaderPromise;
    if (!fireShaderMaterial) {
      if (fireConfig.clampTextureX) {
        sourceMap.wrapS = THREE.ClampToEdgeWrapping;
        sourceMap.needsUpdate = true;
      }
      fireShaderMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: prepareFireVertexShader(vertexSource),
        fragmentShader: prepareFireFragmentShader(fragmentSource),
        uniforms: {
          _MainTex: { value: sourceMap },
          uTime: { value: 0 },
          _Scroll1: { value: fireConfig.scroll1 },
          _Scroll2: { value: fireConfig.scroll2 },
          _DisplacementIntensity: { value: fireConfig.displacementIntensity },
          _Dissolve: { value: 1 },
          _ClipStart: { value: 0 },
          _ClipEnd: { value: 0 },
          _MainTex_ST: { value: new THREE.Vector4(fireConfig.textureScaleX, 1, fireConfig.textureOffsetX, 0) },
          _Color: { value: new THREE.Color(fireConfig.color) },
          _EmissionGain: { value: fireConfig.emissionGain }
        },
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.NormalBlending
      });
      renderer.setAnimationLoop(renderLoop);
    }
    return fireShaderMaterial;
  }

  async function applyFireMaterial(model) {
    let sourceMap;
    const vertexColor = new THREE.Color(fireConfig.color);
    model.traverse(object => {
      if (object.isMesh) {
        ensureFireAttributes(object.geometry, vertexColor);
        sourceMap ??= object.material.map;
      }
    });
    if (!sourceMap) return;
    const material = await getFireShaderMaterial(sourceMap);
    model.traverse(object => {
      if (object.isMesh) object.material = material;
    });
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
    if (fireConfig) {
      await applyFireMaterial(currentModel);
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
