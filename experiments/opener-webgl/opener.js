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
     0.08–0.94 JOYCE + WORKS draw together as one object
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

    const drawProgress = smooth(0.08, 0.94, progress);
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
    uniform vec2 u_pointerTrail;
    uniform vec2 u_pointerVelocity;
    uniform float u_pointerEnergy;
    uniform float u_trailEnergy;
    uniform float u_time;
    uniform float u_scroll;

    in vec2 v_uv;
    out vec4 outColor;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));

      return mix(
        mix(a, b, u.x),
        mix(c, d, u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amp = 0.5;

      for (int i = 0; i < 5; i++) {
        value += amp * noise2(p);
        p = p * 2.03 + vec2(13.17, 7.91);
        amp *= 0.5;
      }

      return value;
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

      vec2 tp = u_pointerTrail;
      tp.x *= aspect;

      float velocityMag = min(1.0, length(u_pointerVelocity) * 22.0);
      float activeEnergy = max(u_pointerEnergy, velocityMag);

      /*
        Smaller radius than V3, with broad feathering.
        The trail has its own independent field so it can read as a wake.
      */
      float radius = mix(0.17, 0.24, activeEnergy);
      float dist = distance(p, mp);
      float influence =
        1.0 - smoothstep(radius * 0.12, radius, dist);

      float trailRadius = radius * 1.08;
      float trailDist = distance(p, tp);
      float trailInfluence =
        (1.0 - smoothstep(trailRadius * 0.10, trailRadius, trailDist)) *
        u_trailEnergy;

      /*
        Continuous flow field.
        Two evolving FBM fields create a smooth vector current with no
        visible tiled/banded cell boundaries.
      */
      vec2 flowP = vec2(
        uv.x * 3.1,
        uv.y * 2.6
      );

      float n1 = fbm(
        flowP +
        vec2(u_time * 0.075, -u_time * 0.052)
      );

      float n2 = fbm(
        flowP.yx * 1.13 +
        vec2(-u_time * 0.061, u_time * 0.083) +
        17.0
      );

      vec2 flow = vec2(
        n1 - 0.5,
        n2 - 0.5
      );

      /*
        Rotate the field a little so it feels like current rather than
        simple zoom/noise displacement.
      */
      flow = vec2(
        flow.x - flow.y * 0.42,
        flow.y + flow.x * 0.28
      );

      /*
        Stronger ambient current than V3.
      */
      uv += flow * 0.042;

      /*
        Secondary slow rolling current for visible large-scale movement.
      */
      uv += vec2(
        sin(uv.y * 5.0 + u_time * 0.31) * 0.010,
        cos(uv.x * 4.2 - u_time * 0.27) * 0.012
      );

      /*
        Soft elongated glitch slices. These are intentionally sparse,
        wide and continuously evolving instead of grid-like cells.
      */
      float sliceCoord =
        uv.y * 6.5 +
        fbm(vec2(uv.x * 1.4, u_time * 0.08)) * 1.8;

      float sliceId = floor(sliceCoord);
      float sliceNoise = hash21(vec2(sliceId, 9.3));

      float slicePulse =
        0.5 + 0.5 *
        sin(
          u_time * (0.42 + sliceNoise * 0.33) +
          sliceNoise * 6.2831
        );

      float sliceGate =
        smoothstep(0.72, 0.98, slicePulse);

      float sliceEdge =
        smoothstep(
          0.02,
          0.18,
          fract(sliceCoord)
        ) *
        (1.0 - smoothstep(
          0.78,
          0.98,
          fract(sliceCoord)
        ));

      uv.x +=
        (sliceNoise - 0.5) *
        sliceGate *
        sliceEdge *
        0.020;

      /*
        Cursor disruption is continuous and interpolated.
        No per-pointer-position random seed changes.
      */
      vec2 velDir =
        normalize(u_pointerVelocity + vec2(0.0001));

      vec2 perp =
        vec2(-velDir.y, velDir.x);

      float cursorNoise =
        fbm(
          vec2(
            uv.y * 8.0 + u_time * 0.18,
            uv.x * 5.0 - u_time * 0.11
          )
        );

      float cursorShear =
        (cursorNoise - 0.5) *
        influence *
        (0.050 + activeEnergy * 0.060);

      uv.x += cursorShear;

      uv +=
        velDir *
        influence *
        activeEnergy *
        0.028;

      uv +=
        perp *
        (cursorNoise - 0.5) *
        influence *
        activeEnergy *
        0.020;

      /*
        Stronger delayed wake. Because its center lags behind the cursor,
        it stays visible after the live distortion has moved on.
      */
      float trailNoise =
        fbm(
          vec2(
            uv.y * 6.0 - u_time * 0.10,
            uv.x * 4.0 + u_time * 0.07
          ) + 23.0
        );

      uv.x +=
        (trailNoise - 0.5) *
        trailInfluence *
        (0.038 + u_trailEnergy * 0.040);

      uv -=
        u_pointerVelocity *
        (
          influence * (0.42 + activeEnergy * 0.72) +
          trailInfluence * 0.52
        );

      vec2 texUV = coverUV(uv);

      /*
        Continuous chromatic misregistration from the field itself.
      */
      float ambientChroma =
        0.0027 +
        length(flow) * 0.004 +
        sliceGate * sliceEdge * 0.003;

      float pointerChroma =
        influence *
        (0.006 + activeEnergy * 0.024);

      float trailChroma =
        trailInfluence *
        (0.005 + u_trailEnergy * 0.014);

      float chroma =
        ambientChroma +
        pointerChroma +
        trailChroma;

      vec2 chromaDir =
        normalize(
          velDir * 0.72 +
          flow * 0.85 +
          vec2(0.22, 0.04)
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
        More visible smear, including a separate lagging wake.
      */
      vec3 smear = vec3(0.0);

      for (int i = 1; i <= 8; i++) {
        float fi = float(i);

        vec2 smearUV =
          uv -
          u_pointerVelocity *
          (
            influence * 0.16 +
            trailInfluence * 0.12
          ) *
          fi;

        smear +=
          texture(
            u_texture,
            coverUV(smearUV)
          ).rgb;
      }

      smear *= 0.125;

      float smearMix =
        min(
          0.78,
          influence * activeEnergy * 0.70 +
          trailInfluence * u_trailEnergy * 0.56
        );

      color =
        mix(
          color,
          max(color, smear * 1.22),
          smearMix
        );

      /*
        Very fine animated grain, no visible checker/cell pattern.
      */
      float grain =
        hash21(
          gl_FragCoord.xy +
          vec2(
            floor(u_time * 17.0),
            floor(u_time * 13.0)
          )
        ) - 0.5;

      color += grain * 0.014;

      /* Approved handoff timing stays unchanged. */
      color *=
        mix(
          1.0,
          0.88,
          smoothstep(0.76, 1.0, u_scroll)
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
    pointerTrail: loc("u_pointerTrail"),
    pointerVelocity: loc("u_pointerVelocity"),
    pointerEnergy: loc("u_pointerEnergy"),
    trailEnergy: loc("u_trailEnergy"),
    time: loc("u_time"),
    scroll: loc("u_scroll")
  };

  uniforms = {
    targetPointerX: 0.5,
    targetPointerY: 0.5,
    pointerX: 0.5,
    pointerY: 0.5,
    trailX: 0.5,
    trailY: 0.5,
    velocityX: 0,
    velocityY: 0,
    energy: 0,
    trailEnergy: 0,
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

    uniforms.targetPointerX = x;
    uniforms.targetPointerY = y;
    uniforms.velocityX = vx * 15;
    uniforms.velocityY = vy * 15;

    const speed = Math.hypot(vx, vy) * 980;
    uniforms.energy = Math.min(1, 0.22 + speed);
    uniforms.trailEnergy =
      Math.max(
        uniforms.trailEnergy,
        Math.min(1, 0.16 + speed * 0.82)
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

    uniforms.energy *= 0.956;
    uniforms.trailEnergy *= 0.982;

    /*
      Smooth the live disruption itself so it never snaps directly to the
      raw mouse coordinate, then make the wake follow much more slowly.
    */
    uniforms.pointerX +=
      (uniforms.targetPointerX - uniforms.pointerX) * 0.18;
    uniforms.pointerY +=
      (uniforms.targetPointerY - uniforms.pointerY) * 0.18;

    uniforms.trailX +=
      (uniforms.pointerX - uniforms.trailX) * 0.032;
    uniforms.trailY +=
      (uniforms.pointerY - uniforms.trailY) * 0.032;

    uniforms.velocityX *= 0.925;
    uniforms.velocityY *= 0.925;

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.uniform1i(u.texture, 0);
    gl.uniform2f(u.resolution, canvas.width, canvas.height);
    gl.uniform2f(u.textureResolution, uniforms.textureWidth, uniforms.textureHeight);
    gl.uniform2f(u.pointer, uniforms.pointerX, uniforms.pointerY);
    gl.uniform2f(u.pointerTrail, uniforms.trailX, uniforms.trailY);
    gl.uniform2f(u.pointerVelocity, uniforms.velocityX, uniforms.velocityY);
    gl.uniform1f(u.pointerEnergy, uniforms.energy);
    gl.uniform1f(u.trailEnergy, uniforms.trailEnergy);
    gl.uniform1f(u.time, (now - start) / 1000);
    gl.uniform1f(u.scroll, uniforms.scroll);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  requestAnimationFrame(frame);
})();
