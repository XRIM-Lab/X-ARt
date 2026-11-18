import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeBrowser } from './fake-browser.mjs';
import { loadModuleFile } from './vm-modules.mjs';

const rendererPath = fileURLToPath(new URL('../../background3d.js', import.meta.url));
const shaderFiles = {
  'Fire2.vert': readFileSync(new URL('../../Fire2.vert', import.meta.url), 'utf8'),
  'Fire2.frag': readFileSync(new URL('../../Fire2.frag', import.meta.url), 'utf8')
};

export function createModel({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  order = 'XYZ',
  withMap = true
} = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -2, -3,
    1, -2, -3,
    -1, 2, -3,
    -1, -2, 3
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0, 1,
    1, 1
  ], 2));
  const texture = withMap ? new THREE.Texture() : null;
  if (texture) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.MirroredRepeatWrapping;
  }
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  const scene = new THREE.Group();
  scene.position.fromArray(position);
  scene.rotation.set(...rotation, order);
  scene.add(mesh);
  return { scene, mesh, geometry, material, texture };
}

export async function createBackgroundHarness({
  browser = new FakeBrowser(),
  models = new Map(),
  loadModel,
  shaderSources = shaderFiles
} = {}) {
  const state = {
    loadCalls: [],
    decoderPaths: [],
    fetchCalls: [],
    scenes: [],
    orientedGroups: [],
    boundsObjects: [],
    cameras: [],
    renderers: [],
    composers: [],
    bloomPasses: [],
    shaderMaterials: [],
    loopCallbacks: [],
    animationLoopRegistrations: 0,
    clockReads: 0
  };

  class Renderer {
    constructor(options) {
      this.options = options;
      this.domElement = { width: 0, height: 0, style: {} };
      this.pixelRatios = [];
      this.sizes = [];
      this.renderCalls = [];
      state.renderers.push(this);
    }

    setClearColor(color, alpha) {
      this.clearColor = [color, alpha];
    }

    setPixelRatio(value) {
      this.pixelRatio = value;
      this.pixelRatios.push(value);
    }

    setSize(width, height, updateStyle) {
      this.sizes.push([width, height, updateStyle]);
      this.domElement.width = width;
      this.domElement.height = height;
    }

    setAnimationLoop(callback) {
      state.animationLoopRegistrations++;
      state.loopCallbacks.push(callback);
    }

    render(scene, camera) {
      this.renderCalls.push({ scene, camera, position: camera.position.clone() });
    }
  }

  class CapturedScene extends THREE.Scene {
    constructor() {
      super();
      state.scenes.push(this);
    }
  }

  class CapturedCamera extends THREE.PerspectiveCamera {
    constructor(...args) {
      super(...args);
      state.cameras.push(this);
    }
  }

  class CapturedBox3 extends THREE.Box3 {
    setFromObject(object, precise) {
      state.boundsObjects.push(object);
      return super.setFromObject(object, precise);
    }
  }

  class OrientedGroup extends THREE.Group {
    constructor() {
      super();
      state.orientedGroups.push(this);
    }
  }

  class PMREMGenerator {
    constructor(renderer) {
      this.renderer = renderer;
    }

    fromScene() {
      return { texture: {} };
    }

    dispose() {}
  }

  class Clock {
    getElapsedTime() {
      state.clockReads++;
      return state.clockReads * 0.25;
    }
  }

  class Composer {
    constructor(renderer) {
      this.renderer = renderer;
      this.passes = [];
      this.sizes = [];
      this.pixelRatios = [];
      this.renderCalls = 0;
      state.composers.push(this);
    }

    addPass(pass) {
      this.passes.push(pass);
    }

    setPixelRatio(value) {
      this.pixelRatios.push(value);
    }

    setSize(width, height) {
      this.sizes.push([width, height]);
    }

    render() {
      this.renderCalls++;
    }
  }

  class BloomPass {
    constructor(size, strength, radius, threshold) {
      this.size = size;
      this.strength = strength;
      this.radius = radius;
      this.threshold = threshold;
      this.materialHighPassFilter = { fragmentShader: 'default high-pass', needsUpdate: false };
      this.bloomTintColors = [{ set: (...values) => { this.tint = values; } }];
      state.bloomPasses.push(this);
    }
  }

  class ShaderMaterial extends THREE.ShaderMaterial {
    constructor(options) {
      super(options);
      state.shaderMaterials.push(this);
    }
  }

  class Loader {
    setDRACOLoader(loader) {
      this.dracoLoader = loader;
    }

    loadAsync(src) {
      state.loadCalls.push(src);
      if (loadModel) return loadModel(src);
      if (models.has(src)) return models.get(src);
      return Promise.resolve(createModel());
    }
  }

  class DracoLoader {
    setDecoderPath(path) {
      state.decoderPaths.push(path);
    }
  }

  const three = {
    WebGLRenderer: Renderer,
    ACESFilmicToneMapping: THREE.ACESFilmicToneMapping,
    Scene: CapturedScene,
    PMREMGenerator,
    PerspectiveCamera: CapturedCamera,
    Vector2: THREE.Vector2,
    Color: THREE.Color,
    Clock,
    Vector3: THREE.Vector3,
    Box3: CapturedBox3,
    Sphere: THREE.Sphere,
    Float32BufferAttribute: THREE.Float32BufferAttribute,
    MathUtils: THREE.MathUtils,
    Group: OrientedGroup,
    GLSL3: THREE.GLSL3,
    ShaderMaterial,
    Vector4: THREE.Vector4,
    DoubleSide: THREE.DoubleSide,
    NormalBlending: THREE.NormalBlending,
    ClampToEdgeWrapping: THREE.ClampToEdgeWrapping
  };

  browser.context.fetch = async url => {
    const request = String(url);
    state.fetchCalls.push(request);
    const filename = request.split('/').at(-1);
    return { text: async () => shaderSources[filename] ?? '' };
  };
  const modules = {
    three: { exports: three },
    'three/addons/loaders/GLTFLoader.js': { exports: { GLTFLoader: Loader } },
    'three/addons/loaders/DRACOLoader.js': { exports: { DRACOLoader: DracoLoader } },
    'three/addons/environments/RoomEnvironment.js': {
      exports: { RoomEnvironment: class { dispose() {} } }
    },
    'three/addons/postprocessing/EffectComposer.js': { exports: { EffectComposer: Composer } },
    'three/addons/postprocessing/RenderPass.js': {
      exports: { RenderPass: class { constructor(scene, camera) { this.scene = scene; this.camera = camera; } } }
    },
    'three/addons/postprocessing/UnrealBloomPass.js': { exports: { UnrealBloomPass: BloomPass } },
    'three/addons/postprocessing/OutputPass.js': { exports: { OutputPass: class {} } }
  };
  const { initBackground3D } = await loadModuleFile(rendererPath, { context: browser.context, modules });
  return { initBackground3D, browser, state };
}
