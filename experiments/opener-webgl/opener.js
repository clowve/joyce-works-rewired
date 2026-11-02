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
     0.02–0.985 JOYCE + WORKS draw together, strongly back-loaded
     0.82–0.965 white solid fill resolves underneath
     0.90–1.00 black veil prepares Card 2
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

    const drawLinear = smooth(0.02, 0.985, progress);
    const drawProgress = Math.pow(drawLinear, 4);
    const fillProgress = smooth(0.82, 0.965, progress);
    const veilProgress = smooth(0.90, 1.00, progress);

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
    uniform vec2 u_trailPoints[12];
    uniform float u_trailStrengths[12];
    uniform float u_time;
    uniform float u_scroll;

    in vec2 v_uv;
    out vec4 outColor;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
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

    float softBand(float value, float center, float width) {
      float d = abs(value - center);
      return 1.0 - smoothstep(width * 0.35, width, d);
    }

    void main() {
      vec2 uv = v_uv;

      float aspect = u_resolution.x / max(1.0, u_resolution.y);

      vec2 p = uv;
      p.x *= aspect;

      vec2 mp = u_pointer;
      mp.x *= aspect;

      float velocityMag = min(1.0, length(u_pointerVelocity) * 24.0);
      float activeEnergy = max(u_pointerEnergy, velocityMag);

      /*
        Cursor stays concentrated and feathered. V5 deliberately avoids
        broad liquid displacement.
      */
      float radius = mix(0.105, 0.145, activeEnergy);
      float dist = distance(p, mp);
      float influence =
        1.0 - smoothstep(radius * 0.18, radius, dist);

      /*
        High-tempo base signal:
        continuous directional shears and phase offsets, no tiled cells.
        This is meant to feel busy even with no pointer input.
      */
      float t = u_time;

      float wave1 =
        sin(uv.y * 11.0 + t * 2.20) * 0.018;

      float wave2 =
        sin(
          uv.y * 24.0 -
          t * 3.40 +
          sin(uv.x * 5.0 + t * 1.35) * 0.9
        ) * 0.009;

      float wave3 =
        sin(
          (uv.x + uv.y * 0.58) * 17.0 +
          t * 2.85
        ) * 0.007;

      uv.x += wave1 + wave2;
      uv.y += wave3;

      /*
        Frequent smooth glitch pulses. These are never isolated "events";
        several overlapping pulses keep the signal restless.
      */
      float pulseA =
        smoothstep(
          0.54,
          0.98,
          0.5 + 0.5 * sin(t * 6.6)
        );

      float pulseB =
        smoothstep(
          0.60,
          0.995,
          0.5 + 0.5 * sin(t * 8.9 + 1.8)
        );

      float pulseC =
        smoothstep(
          0.64,
          0.99,
          0.5 + 0.5 * sin(t * 5.7 + 4.2)
        );

      /*
        Long feathered glitch bands. Their positions drift continuously,
        so they read as unstable signal streaks rather than windows.
      */
      float bandA =
        softBand(
          0.5 + 0.5 * sin(uv.y * 7.5 + t * 0.78),
          0.78,
          0.22
        );

      float bandB =
        softBand(
          0.5 + 0.5 * sin(
            (uv.y + uv.x * 0.22) * 10.0 -
            t * 0.92
          ),
          0.72,
          0.20
        );

      float bandC =
        softBand(
          0.5 + 0.5 * sin(
            (uv.y - uv.x * 0.16) * 13.0 +
            t * 1.08
          ),
          0.76,
          0.18
        );

      uv.x +=
        (bandA * pulseA * 0.020) -
        (bandB * pulseB * 0.014) +
        (bandC * pulseC * 0.010);

      /*
        Localized pointer glitch. The cursor magnifies the same visual
        language already present in the background instead of turning
        into a separate lens/liquid effect.
      */
      float localSignal =
        sin(
          uv.y * 34.0 +
          t * 5.4 +
          sin(uv.x * 10.0 - t * 2.1)
        );

      float localPulse =
        0.52 * pulseA +
        0.31 * pulseB +
        0.17 * pulseC;

      /*
        Thin geometric signal artifacts around the cursor. These are
        directional lines/fragments, not a grid, so they add a synthetic
        glitch vocabulary without bringing back the old tiled windows.
      */
      float cursorLineA =
        pow(
          max(
            0.0,
            sin(
              uv.y * 86.0 +
              uv.x * 7.0 +
              t * 6.3
            )
          ),
          18.0
        );

      float cursorLineB =
        pow(
          max(
            0.0,
            sin(
              (uv.y - uv.x * 0.34) * 61.0 -
              t * 5.1 +
              1.7
            )
          ),
          22.0
        );

      float cursorArtifact =
        influence *
        min(
          1.0,
          cursorLineA * (0.45 + pulseA) +
          cursorLineB * (0.35 + pulseB)
        );

      uv.x +=
        cursorArtifact *
        (0.018 + activeEnergy * 0.036);

      uv.y +=
        cursorArtifact *
        sin(t * 7.2 + uv.x * 31.0) *
        0.006;

      uv.x +=
        localSignal *
        influence *
        (0.024 + activeEnergy * 0.050) *
        (0.70 + localPulse);

      uv.y +=
        sin(uv.x * 27.0 - t * 4.2) *
        influence *
        activeEnergy *
        0.014;

      vec2 velDir =
        normalize(u_pointerVelocity + vec2(0.0001));

      uv -=
        u_pointerVelocity *
        influence *
        (0.34 + activeEnergy * 0.50);

      /*
        Cursor-memory trail:
        six historical positions persist and decay independently.
        The image remains "scarred" briefly after the cursor leaves.
      */
      float memory = 0.0;
      vec2 memoryShift = vec2(0.0);

      for (int i = 0; i < 12; i++) {
        vec2 hp = u_trailPoints[i];
        hp.x *= aspect;

        float hd = distance(p, hp);
        float hs = u_trailStrengths[i];

        float hr = radius * (0.72 + float(i) * 0.045);
        float hi =
          (1.0 - smoothstep(hr * 0.14, hr, hd)) *
          hs;

        float phase =
          sin(
            uv.y * (29.0 + float(i) * 2.0) +
            t * (3.2 + float(i) * 0.13) +
            float(i) * 1.9
          );

        memory += hi;

        memoryShift.x +=
          phase *
          hi *
          (0.020 + hs * 0.030);

        memoryShift.y +=
          sin(
            uv.x * (19.0 + float(i)) -
            t * 2.7 +
            float(i)
          ) *
          hi *
          0.008;
      }

      memory = min(1.0, memory);
      uv += memoryShift;

      vec2 texUV = coverUV(uv);

      /*
        RGB split is permanently present at a low level, then increases
        with periodic glitches, cursor speed and lingering memory.
      */
      float ambientChroma =
        0.0024 +
        pulseA * 0.0020 +
        pulseB * 0.0016 +
        pulseC * 0.0012;

      float pointerChroma =
        influence *
        (0.008 + activeEnergy * 0.032) +
        cursorArtifact * 0.018;

      float memoryChroma =
        memory * 0.020;

      float chroma =
        ambientChroma +
        pointerChroma +
        memoryChroma;

      vec2 chromaDir =
        normalize(
          velDir * 0.82 +
          vec2(
            0.32 + sin(t * 1.4) * 0.12,
            0.06 + cos(t * 1.1) * 0.06
          )
        );

      vec2 cOffset =
        chromaDir * chroma;

      float r =
        texture(
          u_texture,
          coverUV(uv + cOffset)
        ).r;

      float g =
        texture(
          u_texture,
          texUV
        ).g;

      float b =
        texture(
          u_texture,
          coverUV(uv - cOffset)
        ).b;

      vec3 color =
        vec3(r, g, b);

      /*
        Brighter light smear around the active cursor and the persisted
        memory path.
      */
      vec3 smear = vec3(0.0);

      for (int i = 1; i <= 8; i++) {
        float fi = float(i);

        vec2 smearUV =
          uv -
          velDir *
          (
            influence * activeEnergy * 0.0075 * fi +
            memory * 0.0028 * fi
          );

        smear +=
          texture(
            u_texture,
            coverUV(smearUV)
          ).rgb;
      }

      smear *= 0.125;

      float smearMix =
        min(
          0.82,
          influence * activeEnergy * 0.74 +
          memory * 0.46
        );

      color =
        mix(
          color,
          max(color, smear * 1.28),
          smearMix
        );

      /*
        A few hard-edged luminous fragments make the cursor read as an
        actual glitch source instead of only a distortion source.
      */
      float artifactBrightness =
        cursorArtifact * (0.12 + activeEnergy * 0.16) +
        memory * 0.045;

      color +=
        vec3(
          artifactBrightness * 0.82,
          artifactBrightness * 0.92,
          artifactBrightness
        );

      float grain =
        hash21(
          gl_FragCoord.xy +
          vec2(
            floor(t * 21.0),
            floor(t * 17.0)
          )
        ) - 0.5;

      color += grain * 0.014;

      /* Handoff remains compressed at the end so the slower trace has room. */
      color *=
        mix(
          1.0,
          0.88,
          smoothstep(0.90, 1.0, u_scroll)
        );

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
    trailPoints: loc("u_trailPoints[0]"),
    trailStrengths: loc("u_trailStrengths[0]"),
    time: loc("u_time"),
    scroll: loc("u_scroll")
  };

  uniforms = {
    targetPointerX: 0.5,
    targetPointerY: 0.5,
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

  const TRAIL_COUNT = 12;
  const trailPoints = new Float32Array(TRAIL_COUNT * 2);
  const trailStrengths = new Float32Array(TRAIL_COUNT);

  for (let i = 0; i < TRAIL_COUNT; i++) {
    trailPoints[i * 2] = 0.5;
    trailPoints[i * 2 + 1] = 0.5;
    trailStrengths[i] = 0;
  }

  let lastTrailStamp = 0;

  function pushTrailPoint(x, y, strength, now) {
    if (now - lastTrailStamp < 92) return;

    for (let i = TRAIL_COUNT - 1; i > 0; i--) {
      trailPoints[i * 2] = trailPoints[(i - 1) * 2];
      trailPoints[i * 2 + 1] = trailPoints[(i - 1) * 2 + 1];
      trailStrengths[i] = trailStrengths[i - 1];
    }

    trailPoints[0] = x;
    trailPoints[1] = y;
    trailStrengths[0] = strength;
    lastTrailStamp = now;
  }

  window.addEventListener("pointermove", event => {
    const now = performance.now();
    const dt = Math.max(8, now - lastPointerTime);

    const x = event.clientX / Math.max(1, window.innerWidth);
    const y = 1 - event.clientY / Math.max(1, window.innerHeight);

    const vx = (x - previousPointerX) / dt;
    const vy = (y - previousPointerY) / dt;

    uniforms.targetPointerX = x;
    uniforms.targetPointerY = y;
    uniforms.velocityX = vx * 15;
    uniforms.velocityY = vy * 15;

    const speed = Math.hypot(vx, vy) * 980;
    uniforms.energy = Math.min(1, 0.24 + speed);

    pushTrailPoint(
      x,
      y,
      Math.min(1, 0.34 + speed * 0.72),
      now
    );

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

    uniforms.energy *= 0.958;

    /*
      Smooth the live cursor so the disturbance never snaps to raw input.
    */
    uniforms.pointerX +=
      (uniforms.targetPointerX - uniforms.pointerX) * 0.20;
    uniforms.pointerY +=
      (uniforms.targetPointerY - uniforms.pointerY) * 0.20;

    /*
      Historical disturbance points persist for roughly a second-plus
      before fading, giving the image a real memory of the cursor path.
    */
    for (let i = 0; i < TRAIL_COUNT; i++) {
      trailStrengths[i] *= 0.998;
      if (trailStrengths[i] < 0.004) {
        trailStrengths[i] = 0;
      }
    }

    uniforms.velocityX *= 0.93;
    uniforms.velocityY *= 0.93;

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.uniform1i(u.texture, 0);
    gl.uniform2f(u.resolution, canvas.width, canvas.height);
    gl.uniform2f(u.textureResolution, uniforms.textureWidth, uniforms.textureHeight);
    gl.uniform2f(u.pointer, uniforms.pointerX, uniforms.pointerY);
    gl.uniform2f(u.pointerVelocity, uniforms.velocityX, uniforms.velocityY);
    gl.uniform1f(u.pointerEnergy, uniforms.energy);
    gl.uniform2fv(u.trailPoints, trailPoints);
    gl.uniform1fv(u.trailStrengths, trailStrengths);
    gl.uniform1f(u.time, (now - start) / 1000);
    gl.uniform1f(u.scroll, uniforms.scroll);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  requestAnimationFrame(frame);
})();
