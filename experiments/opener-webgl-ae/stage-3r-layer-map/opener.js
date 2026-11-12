(() => {
  "use strict";

  const root = document.querySelector("[data-stage-root]");
  const canvas = document.querySelector("[data-stage-canvas]");

  if (!root || !canvas) return;

  const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /*
    Stage 3 comparison:
      default          -> current pulled-back stripe scale
      ?zoom=original   -> closer / larger stripe scale, closer to GIF
  */
  const zoomMode =
    new URLSearchParams(window.location.search)
      .get("zoom") === "original"
      ? 1
      : 0;

  const soloMode =
    new URLSearchParams(window.location.search)
      .get("solo") || "";

  const debugView =
    soloMode === "base"
      ? 1
      : soloMode === "backslash"
        ? 2
        : soloMode === "blue-runner"
          ? 3
          : soloMode === "dark-runner"
            ? 4
            : 0;

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance"
  });

  if (!gl) {
    root.classList.add("no-webgl");
    return;
  }

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

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_motion;
    uniform float u_zoomMode;
    uniform float u_debugView;

    in vec2 v_uv;
    out vec4 outColor;

    float stripeField(
      float x,
      float motion
    ) {
      const float sourceOriginX = 0.14;

      float d =
        max(
          abs(
            x -
            sourceOriginX
          ),
          0.0007
        );

      float stripeDensity =
        mix(
          1.72,
          1.38,
          u_zoomMode
        );

      float zoomCoord =
        log2(d) *
        stripeDensity -
        motion;

      float cell =
        fract(zoomCoord);

      return
        smoothstep(
          0.46,
          0.49,
          cell
        ) *
        (
          1.0 -
          smoothstep(
            0.91,
            0.94,
            cell
          )
        );
    }

    vec2 cornerPinApprox(
      vec2 uv,
      float topShift,
      float bottomShift,
      float topScale,
      float bottomScale
    ) {
      float rowShift =
        mix(
          bottomShift,
          topShift,
          uv.y
        );

      float rowScale =
        mix(
          bottomScale,
          topScale,
          uv.y
        );

      vec2 q = uv;

      q.x =
        (
          uv.x -
          0.5 -
          rowShift
        ) /
        max(
          rowScale,
          0.22
        ) +
        0.5;

      return q;
    }

    vec2 funhouseRight(
      vec2 uv,
      float phase,
      float motion
    ) {
      float rightMask =
        smoothstep(
          0.46,
          0.98,
          uv.x
        );

      float rowMagnification =
        1.0 +
        rightMask *
        (
          sin(
            uv.y * 4.6 +
            motion * 0.42 +
            phase
          ) * 0.58 +
          sin(
            uv.y * 9.4 -
            motion * 0.24 +
            phase * 1.7
          ) * 0.24
        );

      rowMagnification =
        clamp(
          rowMagnification,
          0.34,
          1.82
        );

      const float pivotX = 0.72;

      float dx =
        uv.x -
        pivotX;

      uv.x =
        pivotX +
        dx /
        rowMagnification;

      float curvedDx =
        uv.x -
        pivotX;

      uv.x +=
        rightMask *
        curvedDx *
        abs(curvedDx) *
        (
          0.72 +
          0.18 *
          sin(
            uv.y * 6.2 +
            phase
          )
        );

      return uv;
    }

    float forwardBackslashBars(
      vec2 uv,
      float motion,
      float phase
    ) {
      /*
        \\\ family moving >>.
        Constant-phase lines use x + y*slope, producing a backslash lean.
        Negative time term moves the family toward the right.
      */
      float coord =
        (
          uv.x +
          uv.y * 0.34
        ) * 4.85 -
        motion * 0.82 +
        phase;

      float cell =
        fract(coord);

      return
        smoothstep(
          0.06,
          0.085,
          cell
        ) *
        (
          1.0 -
          smoothstep(
            0.47,
            0.50,
            cell
          )
        );
    }

    float leftSlashBars(
      vec2 uv,
      float motion,
      float phase
    ) {
      /*
        /// family moving <<.
        Positive time term moves the bands toward the left.
      */
      float coord =
        (
          uv.x -
          uv.y * 0.34
        ) * 6.15 +
        motion * 1.05 +
        phase;

      float cell =
        fract(coord);

      return
        smoothstep(
          0.06,
          0.08,
          cell
        ) *
        (
          1.0 -
          smoothstep(
            0.56,
            0.58,
            cell
          )
        );
    }

    float syncedDarkRipple(
      vec2 uv,
      float motion,
      float phase
    ) {
      /*
        Same /// runner timing and phase, but its sampling geometry ripples.
        This is intentionally phase-locked to the black runner so the two
        can appear to morph into one another.
      */
      float leftWarp =
        mix(
          0.88,
          1.0,
          smoothstep(
            0.03,
            0.46,
            uv.x
          )
        );

      vec2 q = uv;

      q.x +=
        sin(
          uv.y * 15.5 -
          motion * 2.15 +
          phase
        ) *
        0.046 *
        leftWarp;

      q.x +=
        sin(
          uv.y * 34.0 +
          motion * 1.20 +
          phase * 1.7
        ) *
        0.015 *
        leftWarp;

      return
        leftSlashBars(
          q,
          motion,
          phase
        );
    }

    float cross2d(
      vec2 a,
      vec2 b,
      vec2 p
    ) {
      vec2 ab = b - a;
      vec2 ap = p - a;

      return
        ab.x * ap.y -
        ab.y * ap.x;
    }

    float insideTriangle(
      vec2 p,
      vec2 a,
      vec2 b,
      vec2 c
    ) {
      float c1 =
        cross2d(
          a,
          b,
          p
        );

      float c2 =
        cross2d(
          b,
          c,
          p
        );

      float c3 =
        cross2d(
          c,
          a,
          p
        );

      bool hasNeg =
        (c1 < 0.0) ||
        (c2 < 0.0) ||
        (c3 < 0.0);

      bool hasPos =
        (c1 > 0.0) ||
        (c2 > 0.0) ||
        (c3 > 0.0);

      return
        (
          hasNeg &&
          hasPos
        )
          ? 0.0
          : 1.0;
    }

    float insideQuad(
      vec2 p,
      vec2 a,
      vec2 b,
      vec2 c,
      vec2 d
    ) {
      float c1 =
        cross2d(
          a,
          b,
          p
        );

      float c2 =
        cross2d(
          b,
          c,
          p
        );

      float c3 =
        cross2d(
          c,
          d,
          p
        );

      float c4 =
        cross2d(
          d,
          a,
          p
        );

      bool hasNeg =
        (c1 < 0.0) ||
        (c2 < 0.0) ||
        (c3 < 0.0) ||
        (c4 < 0.0);

      bool hasPos =
        (c1 > 0.0) ||
        (c2 > 0.0) ||
        (c3 > 0.0) ||
        (c4 > 0.0);

      return
        (
          hasNeg &&
          hasPos
        )
          ? 0.0
          : 1.0;
    }

    vec3 diagnosticBasePlate(
      vec2 screenUV
    ) {
      /*
        Persistent composition from Joyce's visual read:
        - magenta through left/middle
        - cobalt on the right
        - real dark triangle/quad territory upper-left

        This is deliberately simple for the layer-map reset.
      */
      vec3 magenta =
        vec3(
          0.86,
          0.015,
          0.55
        );

      vec3 cobalt =
        vec3(
          0.015,
          0.18,
          0.96
        );

      float blueRegion =
        insideTriangle(
          screenUV,
          vec2(
            0.50,
            0.00
          ),
          vec2(
            1.00,
            0.00
          ),
          vec2(
            1.00,
            0.93
          )
        );

      float darkRegion =
        insideQuad(
          screenUV,
          vec2(
            0.00,
            0.00
          ),
          vec2(
            0.275,
            0.00
          ),
          vec2(
            0.060,
            0.43
          ),
          vec2(
            0.00,
            0.23
          )
        );

      vec3 plate =
        mix(
          magenta,
          cobalt,
          blueRegion
        );

      plate =
        mix(
          plate,
          vec3(0.0),
          darkRegion
        );

      return plate;
    }

    void main() {
      float motion =
        reducedMotionPlaceholder;

      vec2 uv =
        vec2(
          v_uv.x + 0.18,
          v_uv.y
        );

      vec2 screenUV =
        vec2(
          v_uv.x,
          1.0 -
          v_uv.y
        );

      /*
        BASE PLATE
      */
      vec3 basePlate =
        diagnosticBasePlate(
          screenUV
        );

      /*
        SYSTEM A:
        \\\ family moving >>.

        We reuse the approved fan/funhouse machinery for its blue copy,
        plus a dark companion offset in phase. The goal here is mapping,
        not final blend fidelity.
      */
      vec2 backslashUV =
        cornerPinApprox(
          uv,
          -0.040,
          0.090,
          1.16,
          0.88
        );

      backslashUV =
        funhouseRight(
          backslashUV,
          2.4,
          motion
        );

      float backslashBlue =
        forwardBackslashBars(
          backslashUV,
          motion,
          0.20
        );

      float backslashDark =
        forwardBackslashBars(
          backslashUV,
          motion,
          0.66
        );

      /*
        SYSTEM B:
        clean blue /// moving <<.
        Fixed left cutoff: it does not enter the extreme-left territory.
      */
      float blueRunner =
        leftSlashBars(
          uv,
          motion,
          0.72
        );

      float blueRunnerCutoff =
        smoothstep(
          0.065,
          0.105,
          v_uv.x
        );

      blueRunner *=
        blueRunnerCutoff;

      /*
        SYSTEM C:
        black /// runner + phase-locked distorted copy.
        Unlike the blue runner, neither gets the left cutoff.
      */
      const float darkRunnerPhase = 2.35;

      float blackRunner =
        leftSlashBars(
          uv,
          motion,
          darkRunnerPhase
        );

      float blackRipple =
        syncedDarkRipple(
          uv,
          motion,
          darkRunnerPhase
        );

      /*
        DIAGNOSTIC COLOURS / COMPOSITE
        --------------------------------
        Default view intentionally prioritises legibility of the systems.

        - persistent plate: actual magenta/cobalt/black
        - \\\ >>: electric blue + charcoal companion
        - clean /// <<: cyan-blue
        - black /// + ripple: true black

        No attempt at the final creator blend yet.
      */
      vec3 backslashView =
        basePlate;

      backslashView =
        mix(
          backslashView,
          vec3(
            0.02,
            0.44,
            1.00
          ),
          backslashBlue * 0.92
        );

      backslashView =
        mix(
          backslashView,
          vec3(0.0),
          backslashDark * 0.86
        );

      vec3 blueRunnerView =
        mix(
          basePlate,
          vec3(
            0.02,
            0.62,
            1.00
          ),
          blueRunner * 0.92
        );

      vec3 darkRunnerView =
        basePlate;

      darkRunnerView =
        mix(
          darkRunnerView,
          vec3(0.0),
          blackRunner * 0.88
        );

      darkRunnerView =
        mix(
          darkRunnerView,
          vec3(
            0.03,
            0.03,
            0.05
          ),
          blackRipple * 0.94
        );

      vec3 composite =
        basePlate;

      composite =
        mix(
          composite,
          vec3(
            0.02,
            0.42,
            1.00
          ),
          backslashBlue * 0.86
        );

      composite =
        mix(
          composite,
          vec3(0.0),
          backslashDark * 0.78
        );

      composite =
        mix(
          composite,
          vec3(
            0.02,
            0.58,
            1.00
          ),
          blueRunner * 0.88
        );

      composite =
        mix(
          composite,
          vec3(0.0),
          blackRunner * 0.84
        );

      composite =
        mix(
          composite,
          vec3(
            0.02,
            0.02,
            0.04
          ),
          blackRipple * 0.92
        );

      vec3 color =
        composite;

      if (
        u_debugView >
        0.5 &&
        u_debugView <
        1.5
      ) {
        color =
          basePlate;
      } else if (
        u_debugView >
        1.5 &&
        u_debugView <
        2.5
      ) {
        color =
          backslashView;
      } else if (
        u_debugView >
        2.5 &&
        u_debugView <
        3.5
      ) {
        color =
          blueRunnerView;
      } else if (
        u_debugView >
        3.5
      ) {
        color =
          darkRunnerView;
      }

      outColor =
        vec4(
          color,
          1.0
        );
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

  const resolvedFragmentSource =
    fragmentSource.replace(
      "reducedMotionPlaceholder",
      reducedMotion
        ? "0.0"
        : "u_motion"
    );

  let program;

  try {
    program = gl.createProgram();

    gl.attachShader(
      program,
      compile(
        gl.VERTEX_SHADER,
        vertexSource
      )
    );

    gl.attachShader(
      program,
      compile(
        gl.FRAGMENT_SHADER,
        resolvedFragmentSource
      )
    );

    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        gl.getProgramInfoLog(program) ||
        "Program link failed."
      );
    }
  } catch (error) {
    console.warn(
      "[JOYCE AE reconstruction / Stage 3] WebGL failed:",
      error
    );
    return;
  }

  gl.useProgram(program);

  const positionLocation =
    gl.getAttribLocation(
      program,
      "a_position"
    );

  const buffer =
    gl.createBuffer();

  gl.bindBuffer(
    gl.ARRAY_BUFFER,
    buffer
  );

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

  gl.enableVertexAttribArray(
    positionLocation
  );

  gl.vertexAttribPointer(
    positionLocation,
    2,
    gl.FLOAT,
    false,
    0,
    0
  );

  const uResolution =
    gl.getUniformLocation(
      program,
      "u_resolution"
    );

  const uTime =
    gl.getUniformLocation(
      program,
      "u_time"
    );

  const uMotion =
    gl.getUniformLocation(
      program,
      "u_motion"
    );

  const uZoomMode =
    gl.getUniformLocation(
      program,
      "u_zoomMode"
    );

  const uDebugView =
    gl.getUniformLocation(
      program,
      "u_debugView"
    );

  function resize() {
    /*
      Stage 3 is trivial enough that 1.5 DPR gives a clean preview while
      staying conservative on the same machine that exposed V30's cost.
    */
    const dpr =
      Math.min(
        window.devicePixelRatio || 1,
        1.5
      );

    const width =
      Math.max(
        1,
        Math.round(
          window.innerWidth * dpr
        )
      );

    const height =
      Math.max(
        1,
        Math.round(
          window.innerHeight * dpr
        )
      );

    if (
      canvas.width !== width ||
      canvas.height !== height
    ) {
      canvas.width = width;
      canvas.height = height;

      gl.viewport(
        0,
        0,
        width,
        height
      );
    }
  }

  window.addEventListener(
    "resize",
    resize,
    { passive: true }
  );

  resize();

  const start =
    performance.now();

  let visible = true;

  const observer =
    new IntersectionObserver(
      entries => {
        visible =
          Boolean(
            entries[0] &&
            entries[0].isIntersecting
          );
      },
      {
        threshold: 0.01
      }
    );

  observer.observe(root);

  function frame(now) {
    requestAnimationFrame(frame);

    if (!visible) return;

    resize();

    const elapsed =
      (now - start) / 1000;

    /*
      Positive motion makes the stripe bands expand outward from the
      approved off-axis origin; Stage 3 then fans each coloured duplicate
      through its own corner-pin transform.
    */
    const motion =
      elapsed * 0.72;

    gl.useProgram(program);

    gl.uniform2f(
      uResolution,
      canvas.width,
      canvas.height
    );

    gl.uniform1f(
      uTime,
      elapsed
    );

    if (uMotion) {
      gl.uniform1f(
        uMotion,
        motion
      );
    }

    if (uZoomMode) {
      gl.uniform1f(
        uZoomMode,
        zoomMode
      );
    }

    if (uDebugView) {
      gl.uniform1f(
        uDebugView,
        debugView
      );
    }

    gl.drawArrays(
      gl.TRIANGLES,
      0,
      6
    );
  }

  requestAnimationFrame(frame);
})();
