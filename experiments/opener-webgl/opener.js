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
     0.00–0.12 ambient/interactive field
     0.12–0.72 JOYCE + WORKS draw together as one object
     0.54–0.80 white solid fill resolves underneath
     0.76–1.00 black veil prepares Card 2
     --------------------------------------------------------------------- */

  let paths = [];
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

      paths.forEach(path => {
        const length = path.getTotalLength();
        path.dataset.length = String(length);
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

    const drawProgress = smooth(0.12, 0.72, progress);
    const fillProgress = smooth(0.54, 0.80, progress);
    const veilProgress = smooth(0.76, 1.00, progress);

    /*
      JOYCE and WORKS are one identity object. Both compound paths draw
      through the same normalized progress instead of one waiting for
      the other to finish.
    */
    if (paths.length) {
      paths.forEach(path => {
        const length = Number(path.dataset.length) || 1;
        path.style.strokeDashoffset =
          String(length * (1 - drawProgress));
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
      float velocityMag = min(1.0, length(u_pointerVelocity) * 28.0);
      float activeEnergy = max(u_pointerEnergy, velocityMag);

      /*
        Larger cursor field than V1. This is intentionally broad so the
        interaction reads as a disruption in the image rather than a
        small lens/pinch.
      */
      float radius = mix(0.34, 0.46, activeEnergy);
      float influence = smoothstep(radius, radius * 0.16, dist);

      /*
        Continuous ambient motion:
        several independently moving vertical/diagonal shard systems.
        Nothing waits for a discrete glitch event; the image is always
        sliding, shearing and misregistering a little.
      */
      float bandA = floor(uv.x * 11.0);
      float bandB = floor((uv.x + uv.y * 0.22) * 19.0);
      float stripe = floor(uv.y * 17.0);

      float seedA = hash11(bandA + 3.7);
      float seedB = hash11(bandB + 11.2);
      float seedS = hash11(stripe + 29.4);

      float driftA =
        sin(u_time * (0.42 + seedA * 0.24) + seedA * 6.28318);
      float driftB =
        sin(u_time * (0.28 + seedB * 0.31) + seedB * 9.73);
      float driftS =
        sin(u_time * (0.55 + seedS * 0.20) + seedS * 5.11);

      vec2 ambientOffset = vec2(
        driftB * (0.004 + seedB * 0.010) +
        driftS * (0.002 + seedS * 0.006),
        driftA * (0.006 + seedA * 0.013)
      );

      /*
        Smooth glitch surges ride on top of the continuous movement.
        They ramp in/out rather than popping between static states.
      */
      float surgeA =
        smoothstep(
          0.62,
          0.98,
          0.5 + 0.5 * sin(u_time * 1.13 + bandB * 0.91)
        );

      float surgeB =
        smoothstep(
          0.76,
          0.995,
          0.5 + 0.5 * sin(u_time * 0.73 + stripe * 1.37 + 1.4)
        );

      ambientOffset.x +=
        (seedS - 0.5) *
        surgeA *
        (0.008 + seedS * 0.014);

      ambientOffset.y +=
        (seedB - 0.5) *
        surgeB *
        (0.004 + seedB * 0.009);

      uv += ambientOffset;

      /*
        Cursor disruption:
        use local horizontal slices + directional shear, not radial
        refraction. Fast motion increases the displacement and gives
        the cursor a sharper tearing quality.
      */
      float localStripe =
        floor((uv.y + u_time * 0.018) * 24.0);

      float localSeed =
        hash11(localStripe + floor(u_pointer.y * 37.0));

      float sliceMotion =
        sin(
          u_time * (1.10 + localSeed * 0.90) +
          localStripe * 0.77
        );

      vec2 velocityDir =
        normalize(u_pointerVelocity + vec2(0.0001, 0.0001));

      vec2 perpendicular =
        vec2(-velocityDir.y, velocityDir.x);

      float tearStrength =
        influence *
        (0.018 + activeEnergy * 0.050);

      uv.x +=
        (localSeed - 0.5) *
        sliceMotion *
        tearStrength;

      uv +=
        velocityDir *
        influence *
        activeEnergy *
        0.024;

      uv +=
        perpendicular *
        influence *
        (localSeed - 0.5) *
        activeEnergy *
        0.018;

      /*
        Drag the sampled texture behind cursor motion. This creates the
        light-smear feeling without turning the whole field into liquid.
      */
      uv -=
        u_pointerVelocity *
        influence *
        (0.30 + activeEnergy * 0.58);

      vec2 texUV = coverUV(uv);

      /*
        Chromatic misregistration is always faintly present, then grows
        through ambient surges and cursor velocity.
      */
      float ambientChroma =
        0.0022 +
        surgeA * 0.0026 +
        abs(driftB) * 0.0017;

      float pointerChroma =
        influence *
        (0.0045 + activeEnergy * 0.020);

      float chroma =
        ambientChroma + pointerChroma;

      vec2 chromaDir =
        normalize(
          u_pointerVelocity +
          vec2(
            0.18 + driftB * 0.12,
            0.04 + driftA * 0.07
          )
        );

      vec2 cOffset = chromaDir * chroma;

      float r = texture(u_texture, coverUV(uv + cOffset)).r;
      float g = texture(u_texture, texUV).g;
      float b = texture(u_texture, coverUV(uv - cOffset)).b;

      vec3 color = vec3(r, g, b);

      /*
        Directional light smear. Strongest with faster cursor movement;
        the background animation still runs independently underneath.
      */
      vec3 smear = vec3(0.0);
      for (int i = 1; i <= 6; i++) {
        float fi = float(i);
        vec2 smearUV =
          uv -
          u_pointerVelocity *
          influence *
          (0.13 * fi);

        smear +=
          texture(
            u_texture,
            coverUV(smearUV)
          ).rgb;
      }

      smear *= 1.0 / 6.0;

      float smearMix =
        influence *
        activeEnergy *
        0.58;

      color =
        mix(
          color,
          max(color, smear * 1.14),
          smearMix
        );

      /* Fine print/noise character. */
      float grain =
        hash21(
          gl_FragCoord.xy +
          vec2(
            floor(u_time * 16.0),
            floor(u_time * 11.0)
          )
        ) - 0.5;

      color += grain * 0.015;

      /* Keep the already-approved handoff timing unchanged. */
      color *=
        mix(
          1.0,
          0.88,
          smoothstep(0.76, 1.0, u_scroll)
        );

      outColor = vec4(color, 1.0);
    }
  `

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

    const speed = Math.hypot(vx, vy) * 980;
    uniforms.energy = Math.min(1, 0.22 + speed);

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

    uniforms.energy *= 0.952;
    uniforms.velocityX *= 0.90;
    uniforms.velocityY *= 0.90;

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
