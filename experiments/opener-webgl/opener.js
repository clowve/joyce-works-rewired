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
     0.03–0.965 JOYCE + WORKS draw across a much longer scroll
     0.86–0.975 white solid fill resolves underneath
     0.92–1.00 black veil prepares Card 2
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

      const importedSvg = document.importNode(svg, true);

      /*
        The canonical logo uses compound paths. Stroke dashes restart at
        each subpath, which can make the mark LOOK finished long before
        numeric progress reaches 1. Split every M... contour into its own
        path so all visible contours truly share one slow progression.
      */
      Array.from(importedSvg.querySelectorAll("path")).forEach(sourcePath => {
        const d = sourcePath.getAttribute("d") || "";
        const contours = d
          .split(/(?=[Mm])/)
          .map(part => part.trim())
          .filter(Boolean);

        if (contours.length <= 1) return;

        const parent = sourcePath.parentNode;

        contours.forEach(contour => {
          const child = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
          );

          for (const attr of sourcePath.attributes) {
            if (attr.name !== "d" && attr.name !== "id") {
              child.setAttribute(attr.name, attr.value);
            }
          }

          child.setAttribute("d", contour);
          parent.insertBefore(child, sourcePath);
        });

        sourcePath.remove();
      });

      drawHost.replaceChildren(importedSvg);
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

    const drawLinear =
      clamp01((progress - 0.02) / (0.975 - 0.02));

    /*
      Nearly even speed all the way through, with only a modest
      deceleration near the end. The long physical scroll distance does
      the heavy lifting; the easing should never create a late sprint.
    */
    const drawProgress =
      clamp01(
        (
          drawLinear -
          0.12 * drawLinear * drawLinear
        ) / 0.88
      );

    /*
      Tie the fill to the REAL trace progression so there is no giant
      fully-outlined waiting state. It begins as the final contours are
      still resolving.
    */
    const fillProgress =
      smooth(0.56, 0.84, drawProgress);

    const veilProgress =
      smooth(0.91, 1.00, progress);

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

    /*
      Crossfade the drawn outline into the solid mark. This removes the
      visual "full outline hold" even though the actual trace speed stays
      exactly the same.
    */
    drawHost.style.opacity =
      String(1 - smooth(0.18, 0.92, fillProgress));

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
    uniform sampler2D u_memoryTexture;
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
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise1(float x) {
      float i = floor(x);
      float f = fract(x);
      float u = f * f * (3.0 - 2.0 * f);
      return mix(hash11(i), hash11(i + 1.0), u);
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
      float t = u_time;

      float aspect = u_resolution.x / max(1.0, u_resolution.y);

      vec2 p = uv;
      p.x *= aspect;

      vec2 mp = u_pointer;
      mp.x *= aspect;

      float velocityMag =
        min(1.0, length(u_pointerVelocity) * 24.0);

      float activeEnergy =
        max(u_pointerEnergy, velocityMag);

      /*
        Tight, feathered cursor field. The actual visual glitch comes
        from displaced source pixels rather than drawn geometry.
      */
      float radius =
        mix(0.11, 0.15, activeEnergy);

      float dist =
        distance(p, mp);

      float cursorInfluence =
        1.0 - smoothstep(
          radius * 0.18,
          radius,
          dist
        );

      /*
        Persistent memory painted by the cursor in JavaScript.
        Smooth continuous path, slow decay, no sampled-point hiccups.
      */
      float memory =
        texture(
          u_memoryTexture,
          v_uv
        ).a;

      memory =
        smoothstep(0.085, 0.76, memory);

      /*
        TWO OPPOSING CURRENTS.
        Their phase travels in opposite horizontal directions and each
        shears the source differently. This keeps the field active
        without turning it into a liquid warp.
      */
      float currentLeft =
        sin(
          (uv.x + t * 0.42) * 10.6 +
          uv.y * 5.8 +
          sin(uv.y * 8.8 - t * 2.4) * 0.72
        );

      float currentRight =
        sin(
          (uv.x - t * 0.39) * 9.7 -
          uv.y * 6.5 +
          cos(uv.y * 7.7 + t * 2.6) * 0.70
        );

      vec2 uvLeft =
        uv +
        vec2(
          currentLeft * 0.038,
          sin(uv.x * 7.8 + t * 3.55) * 0.0080
        );

      vec2 uvRight =
        uv +
        vec2(
          currentRight * -0.037,
          cos(uv.x * 8.6 - t * 3.35) * 0.0075
        );

      float currentMix =
        0.5 +
        0.24 *
        sin(
          uv.y * 3.1 +
          uv.x * 1.7 +
          t * 1.15
        );

      vec2 signalUV =
        mix(
          uvLeft,
          uvRight,
          currentMix
        );

      /*
        SECONDARY REFRACTION LAYER:
        an independent set of diagonal source refractions travels
        leftward across the field. This sits behind cursor interaction
        and gives the background another motion plane, closer to the OG's
        layered counter-moving shards.
      */
      /*
        SECONDARY REFRACTION LAYER:
        restore the V12 smooth counter-moving plane exactly as approved.
        This remains visually part of the living background.
      */
      float diagonalPhase =
        sin(
          (uv.x * 0.78 + uv.y) * 18.0 +
          t * 3.15
        );

      float diagonalGate =
        0.5 +
        0.5 *
        sin(
          (uv.x * 0.38 + uv.y) * 7.0 +
          t * 1.85
        );

      vec2 diagonalUV =
        signalUV +
        vec2(
          -0.034 -
            diagonalGate * 0.028 +
            diagonalPhase * 0.014,
          diagonalPhase * 0.0065
        );

      float diagonalMix =
        smoothstep(
          0.44,
          0.86,
          0.5 +
          0.5 *
          sin(
            (uv.x - uv.y * 0.62) * 9.0 -
            t * 2.25
          )
        );

      signalUV =
        mix(
          signalUV,
          diagonalUV,
          diagonalMix * 0.54
        );

      /*
        V15 HARD-SLICE LAYER:
        only this plane changes. The approved smooth background and
        smooth diagonal refraction layers remain untouched.

        Continuous hard bars, rotated ~7 degrees counter-clockwise from
        V14 and packed closer together.
      */
      float sliceTravel =
        uv.x -
        uv.y * 0.37 +
        t * 0.30;

      float sliceCell =
        fract(
          sliceTravel * 5.0
        );

      float sliceBand =
        step(
          0.06,
          sliceCell
        ) *
        (
          1.0 -
          step(
            0.40,
            sliceCell
          )
        );

      /*
        Keep the slice bars continuous along their length. V14 multiplied
        by a second along-strip gate, which is what made them read as
        dashes rather than uninterrupted refractive bars.
      */
      float sliceMask =
        sliceBand;

      float sliceJitter =
        hash11(
          floor(
            sliceTravel * 5.0
          )
        );

      vec2 sliceUV =
        signalUV +
        vec2(
          -0.080 -
            sliceJitter * 0.036,
          (sliceJitter - 0.5) * 0.014
        );

      /*
        Frequent but smoothly entering/exiting glitch activity.
        Three irregular temporal signals overlap so there is rarely a
        long dead gap, but no hard on/off jump.
      */
      float glitchA =
        smoothstep(
          0.58,
          0.88,
          noise1(t * 4.7 + 1.2)
        );

      float glitchB =
        smoothstep(
          0.60,
          0.90,
          noise1(t * 6.1 + 11.7)
        );

      float glitchC =
        smoothstep(
          0.64,
          0.91,
          noise1(t * 3.8 + 27.3)
        );

      float ambientGlitch =
        min(
          1.0,
          glitchA * 0.56 +
          glitchB * 0.48 +
          glitchC * 0.42
        );

      /*
        Signal artifacts now use rectangular source regions and scanline
        fragments instead of diagonal crosshatching. These masks NEVER
        draw visible geometry; they only decide which source pixels get
        displaced/refracted.
      */
      vec2 blockGrid =
        floor(
          vec2(
            uv.x * 22.0,
            uv.y * 30.0
          )
        );

      float blockSeed =
        hash21(blockGrid + 19.7);

      float blockPulse =
        0.5 +
        0.5 *
        sin(
          t * (4.6 + blockSeed * 2.8) +
          blockSeed * 6.28318
        );

      float blockMask =
        smoothstep(
          0.78,
          0.94,
          blockPulse
        ) *
        step(
          0.58,
          blockSeed
        );

      float scanLine =
        pow(
          abs(
            sin(
              uv.y * 118.0 +
              t * 7.1
            )
          ),
          34.0
        );

      float shortLineGate =
        smoothstep(
          0.52,
          0.94,
          0.5 +
          0.5 *
          sin(
            uv.x * 19.0 -
            t * 4.3 +
            hash11(
              floor(uv.y * 22.0)
            ) * 6.28318
          )
        );

      float lineFragment =
        scanLine *
        shortLineGate;

      /*
        Ambient glitches remain broad signal shears; the cursor gets a
        more recognisable square/line glitch vocabulary.
      */
      float ambientArtifact =
        clamp(
          glitchA * lineFragment * 0.42 +
          glitchB * blockMask * 0.24 +
          glitchC * scanLine * 0.22,
          0.0,
          1.0
        );

      float liveArtifact =
        cursorInfluence *
        clamp(
          blockMask *
            (0.58 + activeEnergy * 0.68) +
          lineFragment *
            (0.52 + activeEnergy * 0.74),
          0.0,
          1.0
        );

      float memoryArtifact =
        memory *
        clamp(
          blockMask * 0.68 +
          lineFragment * 0.62,
          0.0,
          1.0
        );

      float artifact =
        clamp(
          ambientArtifact +
          liveArtifact +
          memoryArtifact,
          0.0,
          1.0
        );

      /*
        The glitch itself is a SOURCE-IMAGE shear / echo.
      */
      float signedShear =
        sin(
          uv.y * 17.0 +
          t * 6.0 +
          sin(uv.x * 13.0 - t * 2.7)
        );

      signalUV.x +=
        signedShear *
        (
          ambientArtifact * 0.018 +
          liveArtifact * (0.028 + activeEnergy * 0.030) +
          memoryArtifact * 0.032
        );

      signalUV.y +=
        sin(
          uv.x * 21.0 -
          t * 4.6
        ) *
        (
          liveArtifact * 0.008 +
          memoryArtifact * 0.006
        );

      /*
        Fast pointer motion drags nearby source pixels; retained memory
        continues to glitch after the cursor leaves.
      */
      signalUV -=
        u_pointerVelocity *
        cursorInfluence *
        (0.24 + activeEnergy * 0.42);

      vec2 velDir =
        normalize(
          u_pointerVelocity +
          vec2(0.0001)
        );

      /*
        RGB misregistration is always present and ramps up around
        ambient pulses, the live cursor and the persistent wake.
      */
      float chroma =
        0.0038 +
        ambientGlitch * 0.0046 +
        diagonalMix * 0.0046 +
        sliceMask * 0.0030 +
        cursorInfluence *
          (0.016 + activeEnergy * 0.042) +
        memory * 0.026 +
        artifact * 0.010;

      vec2 chromaDir =
        normalize(
          velDir * 0.74 +
          vec2(
            0.38 +
              currentLeft * 0.14 -
              diagonalMix * 0.10,
            0.08 +
              currentRight * 0.08 +
              diagonalMix * 0.05
          )
        );

      vec2 cOffset =
        chromaDir * chroma;

      /*
        Two-current base image. Each color channel gets slightly
        different current weighting to keep the field electrically alive.
      */
      vec2 sampleBase =
        coverUV(signalUV);

      vec2 sampleEcho =
        coverUV(
          signalUV +
          vec2(
            signedShear * artifact * 0.026,
            0.0
          )
        );

      vec3 leftColor =
        texture(
          u_texture,
          coverUV(uvLeft)
        ).rgb;

      vec3 rightColor =
        texture(
          u_texture,
          coverUV(uvRight)
        ).rgb;

      vec3 baseColor =
        mix(
          leftColor,
          rightColor,
          currentMix
        );

      /*
        Explicit secondary refraction plane. Previously diagonalUV only
        influenced signalUV, then got diluted by the left/right rebuild.
        Sampling it as its own layer makes the counter-moving diagonal
        refraction visibly distinct.
      */
      /*
        Smooth secondary refraction plane (V12 behavior restored).
      */
      vec2 diagonalChroma =
        vec2(
          0.010 + diagonalMix * 0.008,
          -0.003
        );

      vec3 diagonalColor =
        vec3(
          texture(
            u_texture,
            coverUV(
              diagonalUV +
              diagonalChroma
            )
          ).r,
          texture(
            u_texture,
            coverUV(diagonalUV)
          ).g,
          texture(
            u_texture,
            coverUV(
              diagonalUV -
              diagonalChroma
            )
          ).b
        );

      baseColor =
        mix(
          baseColor,
          diagonalColor,
          diagonalMix * 0.34
        );

      /*
        Separate hard-slice plane. The mask itself is binary, so the
        boundary stays crisp instead of feathering into the smooth field.
        RGB channels are offset independently inside the slice only.
      */
      vec2 sliceChroma =
        vec2(
          0.018 + sliceJitter * 0.008,
          -0.004 + sliceJitter * 0.004
        );

      vec3 sliceColor =
        vec3(
          texture(
            u_texture,
            coverUV(
              sliceUV +
              sliceChroma
            )
          ).r,
          texture(
            u_texture,
            coverUV(sliceUV)
          ).g,
          texture(
            u_texture,
            coverUV(
              sliceUV -
              sliceChroma
            )
          ).b
        );

      baseColor =
        mix(
          baseColor,
          sliceColor,
          sliceMask * 0.72
        );

      float r =
        texture(
          u_texture,
          coverUV(signalUV + cOffset)
        ).r;

      float g =
        texture(
          u_texture,
          sampleBase
        ).g;

      float b =
        texture(
          u_texture,
          coverUV(signalUV - cOffset)
        ).b;

      vec3 splitColor =
        vec3(r, g, b);

      vec3 echoColor =
        texture(
          u_texture,
          sampleEcho
        ).rgb;

      vec3 color =
        mix(
          baseColor,
          splitColor,
          0.62 + artifact * 0.24
        );

      color =
        mix(
          color,
          echoColor,
          artifact * 0.34
        );

      /*
        Light smear follows movement and persisted memory, but stays
        subordinate to the harder signal/shear treatment.
      */
      vec3 smear = vec3(0.0);

      for (int i = 1; i <= 6; i++) {
        float fi = float(i);

        vec2 smearUV =
          signalUV -
          velDir *
          (
            cursorInfluence *
              activeEnergy *
              0.006 *
              fi +
            memory *
              0.0028 *
              fi
          );

        smear +=
          texture(
            u_texture,
            coverUV(smearUV)
          ).rgb;
      }

      smear *= 1.0 / 6.0;

      float smearMix =
        min(
          0.62,
          cursorInfluence *
            activeEnergy *
            0.48 +
          memory *
            0.34
        );

      /*
        Smear should displace/echo color, not brighten the disturbed area.
        Blending directly prevents the lingering white cast from V8.
      */
      color =
        mix(
          color,
          smear,
          smearMix * 0.78
        );

      float grain =
        hash21(
          gl_FragCoord.xy +
          vec2(
            floor(t * 23.0),
            floor(t * 19.0)
          )
        ) - 0.5;

      color += grain * 0.014;

      color *=
        mix(
          1.0,
          0.88,
          smoothstep(
            0.91,
            1.0,
            u_scroll
          )
        );

      outColor =
        vec4(color, 1.0);
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
    memoryTexture: loc("u_memoryTexture"),
    resolution: loc("u_resolution"),
    textureResolution: loc("u_textureResolution"),
    pointer: loc("u_pointer"),
    pointerVelocity: loc("u_pointerVelocity"),
    pointerEnergy: loc("u_pointerEnergy"),
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

  window.addEventListener("pointermove", event => {
    const now = performance.now();
    const dt = Math.max(8, now - lastPointerTime);

    const x =
      event.clientX /
      Math.max(1, window.innerWidth);

    const y =
      1 -
      event.clientY /
      Math.max(1, window.innerHeight);

    const vx =
      (x - previousPointerX) / dt;

    const vy =
      (y - previousPointerY) / dt;

    uniforms.targetPointerX = x;
    uniforms.targetPointerY = y;
    uniforms.velocityX = vx * 15;
    uniforms.velocityY = vy * 15;

    const speed =
      Math.hypot(vx, vy) * 980;

    uniforms.energy =
      Math.min(
        1,
        0.22 + speed
      );

    previousPointerX = x;
    previousPointerY = y;
    lastPointerTime = now;
  }, { passive: true });

  /*
    Persistent disturbance memory.
    The cursor paints a continuous blurred stroke into this tiny canvas;
    it fades slowly instead of being represented by discrete trail points.
  */
  const memoryCanvas =
    document.createElement("canvas");

  memoryCanvas.width = 320;
  memoryCanvas.height = 180;

  const memoryCtx =
    memoryCanvas.getContext("2d", {
      alpha: true
    });

  const memoryTexture =
    gl.createTexture();

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(
    gl.TEXTURE_2D,
    memoryTexture
  );

  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    gl.CLAMP_TO_EDGE
  );

  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    gl.CLAMP_TO_EDGE
  );

  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR
  );

  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    gl.LINEAR
  );

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    memoryCanvas.width,
    memoryCanvas.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );

  gl.activeTexture(gl.TEXTURE0);

  let lastMemoryX = 0.5;
  let lastMemoryY = 0.5;

  function updateMemoryTexture() {
    if (!memoryCtx) return;

    /*
      7/10 stickiness: very slow decay. Old disturbances remain visible
      for several seconds before returning to the base signal.
    */
    memoryCtx.save();
    memoryCtx.globalCompositeOperation =
      "destination-out";
    memoryCtx.fillStyle =
      "rgba(0,0,0,0.010)";
    memoryCtx.fillRect(
      0,
      0,
      memoryCanvas.width,
      memoryCanvas.height
    );
    memoryCtx.restore();

    const x =
      uniforms.pointerX *
      memoryCanvas.width;

    const y =
      (1 - uniforms.pointerY) *
      memoryCanvas.height;

    const lastX =
      lastMemoryX *
      memoryCanvas.width;

    const lastY =
      (1 - lastMemoryY) *
      memoryCanvas.height;

    const motion =
      Math.hypot(
        uniforms.pointerX - lastMemoryX,
        uniforms.pointerY - lastMemoryY
      );

    if (motion > 0.00012) {
      memoryCtx.save();
      memoryCtx.globalCompositeOperation =
        "source-over";

      const strength =
        Math.min(
          0.58,
          0.14 +
          uniforms.energy * 0.34
        );

      memoryCtx.strokeStyle =
        "rgba(255,255,255," +
        strength.toFixed(3) +
        ")";

      memoryCtx.lineWidth =
        18 +
        uniforms.energy * 18;

      memoryCtx.lineCap = "round";
      memoryCtx.lineJoin = "round";
      memoryCtx.shadowColor =
        "rgba(255,255,255,0.42)";
      memoryCtx.shadowBlur =
        9 + uniforms.energy * 9;

      memoryCtx.beginPath();
      memoryCtx.moveTo(
        lastX,
        lastY
      );
      memoryCtx.lineTo(
        x,
        y
      );
      memoryCtx.stroke();
      memoryCtx.restore();
    }

    lastMemoryX =
      uniforms.pointerX;

    lastMemoryY =
      uniforms.pointerY;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(
      gl.TEXTURE_2D,
      memoryTexture
    );

    gl.pixelStorei(
      gl.UNPACK_FLIP_Y_WEBGL,
      true
    );

    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      memoryCanvas
    );

    gl.activeTexture(gl.TEXTURE0);
  }

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

    uniforms.pointerX +=
      (
        uniforms.targetPointerX -
        uniforms.pointerX
      ) * 0.22;

    uniforms.pointerY +=
      (
        uniforms.targetPointerY -
        uniforms.pointerY
      ) * 0.22;

    uniforms.velocityX *= 0.93;
    uniforms.velocityY *= 0.93;

    updateMemoryTexture();

    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(
      gl.TEXTURE_2D,
      texture
    );

    gl.uniform1i(
      u.texture,
      0
    );

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(
      gl.TEXTURE_2D,
      memoryTexture
    );

    gl.uniform1i(
      u.memoryTexture,
      1
    );

    gl.uniform2f(
      u.resolution,
      canvas.width,
      canvas.height
    );

    gl.uniform2f(
      u.textureResolution,
      uniforms.textureWidth,
      uniforms.textureHeight
    );

    gl.uniform2f(
      u.pointer,
      uniforms.pointerX,
      uniforms.pointerY
    );

    gl.uniform2f(
      u.pointerVelocity,
      uniforms.velocityX,
      uniforms.velocityY
    );

    gl.uniform1f(
      u.pointerEnergy,
      uniforms.energy
    );

    gl.uniform1f(
      u.time,
      (now - start) / 1000
    );

    gl.uniform1f(
      u.scroll,
      uniforms.scroll
    );

    gl.drawArrays(
      gl.TRIANGLES,
      0,
      6
    );
  }

  requestAnimationFrame(frame);
})();
