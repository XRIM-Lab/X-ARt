import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { applyBloomTint } from '../fire-effect.js';
import { FIRE_EFFECT_OPTIONS } from '../fire-effect-options.js';

const FIRE_LAYER = 1;

const COMPOSITE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uFade;
  varying vec2 vUv;

  #include <tonemapping_pars_fragment>

  void main() {
    vec4 fire = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(linearToOutputTexel(vec4(ACESFilmicToneMapping(fire.rgb + texture2D(tBloom, vUv).rgb), 1.0)).rgb, fire.a) * uFade;
  }
`;

export function createFireOverlay({ renderer, scene, camera, occluders, bloomTint = FIRE_EFFECT_OPTIONS.bloom.tint, reducedMotion, onFrame }) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;

  const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const capture = new THREE.WebGLRenderTarget(bufferSize.x, bufferSize.y, {
    type: THREE.HalfFloatType,
    depthBuffer: true
  });

  const bloom = new UnrealBloomPass(
    bufferSize.clone(),
    FIRE_EFFECT_OPTIONS.bloom.strength,
    FIRE_EFFECT_OPTIONS.bloom.radius,
    FIRE_EFFECT_OPTIONS.bloom.threshold
  );
  applyBloomTint(bloom, bloomTint);
  bloom.renderToScreen = false;
  bloom.blendMaterial.visible = false;

  const compositeQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: capture.texture },
      tBloom: { value: bloom.renderTargetsHorizontal[0].texture },
      uFade: { value: 1 },
      toneMappingExposure: { value: 1 }
    },
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    transparent: true,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor
  }));

  const clock = new THREE.Clock();
  let fireRoot;
  let fireMaterial;
  let pendingFrame = 0;

  function cancelFrame() {
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
    }
  }

  function schedule() {
    if (pendingFrame || document.hidden || reducedMotion.matches) return;
    pendingFrame = requestAnimationFrame(tick);
  }

  function tick() {
    pendingFrame = 0;
    if (document.hidden || reducedMotion.matches) return;
    onFrame();
  }

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) cancelFrame();
    else onFrame();
  });

  return {
    attach(root, material) {
      fireRoot = root;
      fireMaterial = material;
      root.traverse(object => {
        if (object.isMesh) object.layers.set(FIRE_LAYER);
      });
    },
    setSize() {
      renderer.getDrawingBufferSize(bufferSize);
      capture.setSize(bufferSize.x, bufferSize.y);
      bloom.setSize(bufferSize.x, bufferSize.y);
    },
    cancel: cancelFrame,
    render(fade) {
      if (!fireRoot || fade <= 0 || document.hidden) {
        cancelFrame();
        return;
      }
      if (!reducedMotion.matches) fireMaterial.uniforms.uTime.value = clock.getElapsedTime();
      compositeQuad.material.uniforms.uFade.value = fade;

      const layerMask = camera.layers.mask;
      const previousTarget = renderer.getRenderTarget();
      const colorWrites = occluders.map(occluder => occluder.material.colorWrite);
      try {
        camera.layers.enable(FIRE_LAYER);
        for (const occluder of occluders) occluder.material.colorWrite = false;
        renderer.setRenderTarget(capture);
        renderer.render(scene, camera);
      } finally {
        camera.layers.mask = layerMask;
        occluders.forEach((occluder, index) => {
          occluder.material.colorWrite = colorWrites[index];
        });
        renderer.setRenderTarget(previousTarget);
      }

      const autoClear = renderer.autoClear;
      try {
        bloom.render(renderer, null, capture);
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = false;
        compositeQuad.render(renderer);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = autoClear;
      }
      schedule();
    }
  };
}
