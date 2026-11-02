(() => {
  "use strict";

  const root = document.querySelector("[data-opener-prototype]");
  const scrollSection = document.querySelector(".opener-scroll");
  const canvas = document.querySelector("[data-opener-canvas]");
  const drawHost = document.querySelector("[data-brand-draw]");
  const fillMark = document.querySelector("[data-brand-fill]");
  const veil = document.querySelector("[data-black-veil]");

  if (!root || !scrollSection || !canvas || !drawHost || !fillMark || !veil) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) return;

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => {
    const t = clamp01((v - a) / Math.max(0.00001, b - a));
    return t * t * (3 - 2 * t);
  };

  /* ---------------------------------------------------------------------
     Scroll choreography
     0.00–0.18 ambient/interactive field
     0.18–0.68 white line draw
     0.54–0.80 white solid fill resolves underneath
     0.76–1.00 black veil prepares Card 2
     --------------------------------------------------------------------- */

  let paths = [];
  let totalLength = 0;
  let uniforms = null;

  fetch("../../assets/identity/joyce-works-outline.svg?v=20261103-pad1")
    .then(r => r.text())
    .then(text => {
      const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = parsed.documentElement;

      svg.removeAttribute("style");
      svg.removeAttribute("aria-labelledby");
      svg.querySelectorAll("title").forEach(node => node.remove());

      drawHost.replaceChildren(document.importNode(svg, true));
      paths = Array.from(drawHost.querySelectorAll("path"));

      totalLength = 0;
      paths.forEach(path => {
        const length = path.getTotalLength();
        path.dataset.length = String(length);
        totalLength += length;
        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
      });

      renderScrollState();
    })
    .catch(() => {
      drawHost.style.display = "none";
    });

  function renderScrollState() {
    const rect = scrollSection.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    const distance = Math.max(1, scrollSection.offsetHeight - vh);
    const progress = clamp01(-rect.top / distance);

    const drawProgress = smooth(0.18, 0.68, progress);
    const fillProgress = smooth(0.54, 0.80, progress);
    const veilProgress = smooth(0.76, 1.00, progress);

    if (paths.length && totalLength > 0) {
      let remaining = totalLength * drawProgress;

      paths.forEach(path => {
        const length = Number(path.dataset.length) || 1;
        const shown = Math.min(length, Math.max(0, remaining));
        path.style.strokeDashoffset = String(length - shown);
        remaining -= length;
      });
    }

    fillMark.style.opacity = String(fillProgress);
    veil.style.opacity = String(veilProgress * 0.98);

    if (uniforms) {
      uniforms.scroll = progress;
    }
  }

  let scrollRAF = 0;
  function requestScrollRender() {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollRAF = 0;
      renderScrollState();
    });
  }

  window.addEventListener("scroll", requestScrollRender, { passive: true });
  window.addEventListener("resize", requestScrollRender);
  renderScrollState();

  /* ---------------------------------------------------------------------
     WebGL2
     Single textured quad. The shader keeps ambient glitches alive and
     layers local pointer distortion / RGB split / light smear on top.
     --------------------------------------------------------------------- */

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance"
  });

  if (!gl) return;

  const vertexSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `#version 300 es
    precision highp float;

    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform vec2 u_textureResolution;
    uniform vec2 u_pointer;
    uniform vec2 u_pointerVelocity;
    uniform float u_pointerEnergy;
    uniform float u_time;
    uniform float u_scroll;

    in vec2 v_uv;
    out vec4 outColor;

    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    float hash21(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec2 coverUV(vec2 uv) {
      float screenAspect = u_resolution.x / max(1.0, u_resolution.y);
      float texAspect = u_textureResolution.x / max(1.0, u_textureResolution.y);

      if (screenAspect > texAspect) {
        float scale = texAspect / screenAspect;
        uv.y = (uv.y - 0.5) * scale + 0.5;
      } else {
        float scale = screenAspect / texAspect;
        uv.x = (uv.x - 0.5) * scale + 0.5;
      }

      return uv;
    }

    void main() {
      vec2 uv = v_uv;

      float aspect = u_resolution.x / max(1.0, u_resolution.y);
      vec2 p = uv;
      p.x *= aspect;

      vec2 mp = u_pointer;
      mp.x *= aspect;

      float dist = distance(p, mp);
      float radius = mix(0.19, 0.28, min(1.0, u_pointerEnergy));
      float influence = smoothstep(radius, 0.0, dist);

      /* Ambient crystalline movement: mostly vertical shard offsets. */
      float bandCount = 13.0;
      float band = floor(uv.x * bandCount);
      float bandSeed = hash11(band + 17.0);

      float wave =
        sin(u_time * (0.32 + bandSeed * 0.38) + band * 1.71) *
        (0.003 + bandSeed * 0.007);

      uv.y += wave;

      /* Rare glitch spikes are already present before interaction. */
      float glitchClock = floor(u_time * 1.15);
      float glitchSeed = hash11(glitchClock * 4.71);
      float glitchGate = smoothstep(0.82, 0.97, glitchSeed);
      float stripe = floor(uv.y * 19.0);
      float stripeSeed = hash11(stripe + glitchClock * 13.0);

      uv.x +=
        (stripeSeed - 0.5) *
        glitchGate *
        (0.008 + 0.018 * hash11(stripe + 2.0));

      /* Local pointer refraction + velocity smear. */
      vec2 pointerDelta = uv - u_pointer;
      vec2 radial = normalize(pointerDelta + vec2(0.00001));

      float velocityMag = min(1.0, length(u_pointerVelocity) * 24.0);
      float activeEnergy = max(u_pointerEnergy, velocityMag);

      uv += radial * influence * (0.010 + activeEnergy * 0.018);
      uv -= u_pointerVelocity * influence * (0.20 + activeEnergy * 0.32);

      vec2 texUV = coverUV(uv);

      /* Chromatic aberration grows with pointer speed and ambient spikes. */
      float chroma =
        0.0015 +
        glitchGate * 0.003 +
        influence * (0.003 + activeEnergy * 0.012);

      vec2 chromaDir =
        normalize(u_pointerVelocity + vec2(0.0001, 0.0001));

      vec2 cOffset = chromaDir * chroma;

      float r = texture(u_texture, coverUV(uv + cOffset)).r;
      float g = texture(u_texture, texUV).g;
      float b = texture(u_texture, coverUV(uv - cOffset)).b;

      vec3 color = vec3(r, g, b);

      /* Light smear: a few samples dragged along the movement vector. */
      vec3 smear = vec3(0.0);
      for (int i = 1; i <= 4; i++) {
        float fi = float(i);
        vec2 smearUV =
          uv -
          u_pointerVelocity *
          influence *
          (0.16 * fi);

        smear += texture(u_texture, coverUV(smearUV)).rgb;
      }
      smear *= 0.25;

      float smearMix =
        influence *
        activeEnergy *
        0.42;

      color = mix(color, max(color, smear * 1.10), smearMix);

      /* Tiny print/noise character so the image never feels perfectly digital. */
      float grain =
        hash21(gl_FragCoord.xy + floor(u_time * 18.0)) - 0.5;

      color += grain * 0.018;

      /* Slightly deepen contrast as the black handoff approaches. */
      color *= mix(1.0, 0.88, smoothstep(0.76, 1.0, u_scroll));

      outColor = vec4(color, 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log || "Shader compilation failed.");
    }

    return shader;
  }

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Program link failed.");
    }
  } catch (error) {
    console.warn("[JOYCE opener prototype] WebGL shader failed:", error);
    return;
  }

  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]),
    gl.STATIC_DRAW
  );

  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const loc = name => gl.getUniformLocation(program, name);

  const u = {
    texture: loc("u_texture"),
    resolution: loc("u_resolution"),
    textureResolution: loc("u_textureResolution"),
    pointer: loc("u_pointer"),
    pointerVelocity: loc("u_pointerVelocity"),
    pointerEnergy: loc("u_pointerEnergy"),
    time: loc("u_time"),
    scroll: loc("u_scroll")
  };

  uniforms = {
    pointerX: 0.5,
    pointerY: 0.5,
    velocityX: 0,
    velocityY: 0,
    energy: 0,
    scroll: 0,
    textureWidth: 1137,
    textureHeight: 540
  };

  let previousPointerX = 0.5;
  let previousPointerY = 0.5;
  let lastPointerTime = performance.now();

  window.addEventListener("pointermove", event => {
    const now = performance.now();
    const dt = Math.max(8, now - lastPointerTime);

    const x = event.clientX / Math.max(1, window.innerWidth);
    const y = 1 - event.clientY / Math.max(1, window.innerHeight);

    const vx = (x - previousPointerX) / dt;
    const vy = (y - previousPointerY) / dt;

    uniforms.pointerX = x;
    uniforms.pointerY = y;
    uniforms.velocityX = vx * 16;
    uniforms.velocityY = vy * 16;

    const speed = Math.hypot(vx, vy) * 850;
    uniforms.energy = Math.min(1, 0.18 + speed);

    previousPointerX = x;
    previousPointerY = y;
    lastPointerTime = now;
  }, { passive: true });

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const image = new Image();
  image.decoding = "async";
  image.src = "../../assets/identity/landing-opener-placeholder.webp?v=20261103-valid2";

  let textureReady = false;

  image.onload = () => {
    uniforms.textureWidth = image.naturalWidth || 1137;
    uniforms.textureHeight = image.naturalHeight || 540;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image
    );

    textureReady = true;
    root.classList.add("webgl-ready");
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  window.addEventListener("resize", resize);
  resize();

  let visible = true;
  const observer = new IntersectionObserver(entries => {
    visible = Boolean(entries[0] && entries[0].isIntersecting);
  }, { threshold: 0.01 });
  observer.observe(scrollSection);

  const start = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);

    if (!visible || !textureReady) return;

    resize();

    uniforms.energy *= 0.935;
    uniforms.velocityX *= 0.88;
    uniforms.velocityY *= 0.88;

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.uniform1i(u.texture, 0);
    gl.uniform2f(u.resolution, canvas.width, canvas.height);
    gl.uniform2f(u.textureResolution, uniforms.textureWidth, uniforms.textureHeight);
    gl.uniform2f(u.pointer, uniforms.pointerX, uniforms.pointerY);
    gl.uniform2f(u.pointerVelocity, uniforms.velocityX, uniforms.velocityY);
    gl.uniform1f(u.pointerEnergy, uniforms.energy);
    gl.uniform1f(u.time, (now - start) / 1000);
    gl.uniform1f(u.scroll, uniforms.scroll);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  requestAnimationFrame(frame);
})();
