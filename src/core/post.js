import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CONFIG } from '../config.js';

// Single combined post pass: film grain + vignette + chromatic aberration.
// One pass = one extra draw call total.
const ComboShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grainStr: { value: 0 },
    grainSize: { value: 1.5 },
    vigOffset: { value: 0.4 },
    vigDark: { value: 0.7 },
    caStr: { value: 0 },
    redVignette: { value: 0 }, // 0..1, pulsed by entity warning
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grainStr;
    uniform float grainSize;
    uniform float vigOffset;
    uniform float vigDark;
    uniform float caStr;
    uniform float redVignette;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453 + time);
    }

    void main() {
      // Chromatic aberration: sample R, G, B at slightly offset coords.
      vec2 dir = vUv - 0.5;
      vec4 r = texture2D(tDiffuse, vUv + dir * caStr);
      vec4 g = texture2D(tDiffuse, vUv);
      vec4 b = texture2D(tDiffuse, vUv - dir * caStr);
      vec4 col = vec4(r.r, g.g, b.b, g.a);

      // Film grain.
      vec2 noiseUv = floor(vUv / grainSize * 1024.0) / 1024.0;
      float noise = rand(noiseUv) * 2.0 - 1.0;
      col.rgb += noise * grainStr;

      // Standard vignette.
      float dist = length(dir);
      float vig = smoothstep(0.8, vigOffset, dist * (vigDark + vigOffset));
      col.rgb *= vig;

      // Red vignette (entity warning) – additive tint at the edges.
      if (redVignette > 0.0) {
        float pulse = smoothstep(0.3, 0.8, dist);
        col.rgb += vec3(0.6, 0.0, 0.0) * pulse * redVignette;
      }

      gl_FragColor = col;
    }
  `,
};

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const pass = new ShaderPass(ComboShader);
  pass.renderToScreen = true;
  composer.addPass(pass);
  applyPostConfig(pass.uniforms);

  // Resize support.
  window.addEventListener('resize', () => {
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    composer,
    pass,
    tick(dt) {
      pass.uniforms.time.value += dt * 60; // grain shifts every frame
    },
    setRedVignette(v) {
      pass.uniforms.redVignette.value = v;
    },
    enabled: CONFIG.post.enabled,
  };
}

function applyPostConfig(uniforms) {
  const P = CONFIG.post;
  uniforms.grainStr.value = P.grainStrength;
  uniforms.grainSize.value = P.grainSize;
  uniforms.vigOffset.value = P.vignetteOffset;
  uniforms.vigDark.value = P.vignetteDarkness;
  uniforms.caStr.value = P.caStrength;
}
