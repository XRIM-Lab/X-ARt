import * as THREE from 'three';
import { FIRE_EFFECT_OPTIONS } from './fire-effect-options.js';

export { FIRE_EFFECT_OPTIONS };

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
  textureCropX: 0,
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

async function fetchShaderSource(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load fire shader ${url}: HTTP ${response.status}`);
  return response.text();
}

export function applyBloomTint(bloom, bloomTint) {
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

export function createFireMaterialApplier(options = {}) {
  const fireConfig = { ...DEFAULT_FIRE_MATERIAL, ...options };
  let fireShaderPromise;
  let fireShaderMaterial;

  async function getFireShaderMaterial(sourceMap) {
    if (!fireShaderPromise) {
      fireShaderPromise = Promise.all([
        fetchShaderSource(fireConfig.vertexUrl),
        fetchShaderSource(fireConfig.fragmentUrl)
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
          _TextureCropX: { value: fireConfig.textureCropX },
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
    }
    return fireShaderMaterial;
  }

  return async model => {
    let sourceMap;
    const vertexColor = new THREE.Color(fireConfig.color);
    model.traverse(object => {
      if (object.isMesh) {
        ensureFireAttributes(object.geometry, vertexColor);
        sourceMap ??= object.material.map;
      }
    });
    if (!sourceMap) return null;
    const material = await getFireShaderMaterial(sourceMap);
    model.traverse(object => {
      if (object.isMesh) object.material = material;
    });
    return material;
  };
}
