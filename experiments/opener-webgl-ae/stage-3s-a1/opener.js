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
  const soloMode =
    new URLSearchParams(window.location.search)
      .get("solo") || "";

  const debugView =
    soloMode === "base"
      ? 1
      : soloMode === "mask"
        ? 2
        : soloMode === "regions"
          ? 3
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
    uniform float u_motion;
    uniform float u_debugView;

    in vec2 v_uv;
    out vec4 outColor;

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
      float c1 = cross2d(a, b, p);
      float c2 = cross2d(b, c, p);
      float c3 = cross2d(c, a, p);

      bool hasNeg =
        (c1 < 0.0) ||
        (c2 < 0.0) ||
        (c3 < 0.0);

      bool hasPos =
        (c1 > 0.0) ||
        (c2 > 0.0) ||
        (c3 > 0.0);

      return
        (hasNeg && hasPos)
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
      float c1 = cross2d(a, b, p);
      float c2 = cross2d(b, c, p);
      float c3 = cross2d(c, d, p);
      float c4 = cross2d(d, a, p);

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
        (hasNeg && hasPos)
          ? 0.0
          : 1.0;
    }

    vec3 exactBasePlate(
      vec2 screenUV,
      out float blackRegion,
      out float magentaRegion,
      out float cobaltRegion
    ) {
      /*
        Exact geometry recovered from Joyce's supplied 956×547 artwork.

        black:
          (0,0) → (262,0) → (59,233) → (0,127)

        cobalt:
          (499,0) → (956,0) → (956,508)

        magenta:
          everything else
      */
      vec2 p =
        vec2(
          screenUV.x * 956.0,
          screenUV.y * 547.0
        );

      blackRegion =
        insideQuad(
          p,
          vec2(0.0, 0.0),
          vec2(262.0, 0.0),
          vec2(59.0, 233.0),
          vec2(0.0, 127.0)
        );

      cobaltRegion =
        insideTriangle(
          p,
          vec2(499.0, 0.0),
          vec2(956.0, 0.0),
          vec2(956.0, 508.0)
        );

      magentaRegion =
        clamp(
          1.0 -
          max(
            blackRegion,
            cobaltRegion
          ),
          0.0,
          1.0
        );

      vec3 magenta =
        vec3(
          250.0 / 255.0,
          24.0 / 255.0,
          209.0 / 255.0
        );

      vec3 cobalt =
        vec3(
          0.0,
          0.0,
          254.0 / 255.0
        );

      vec3 color =
        magenta;

      color =
        mix(
          color,
          cobalt,
          cobaltRegion
        );

      color =
        mix(
          color,
          vec3(0.0),
          blackRegion
        );

      return color;
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

    vec2 restrainedRightWarp(
      vec2 uv,
      float motion
    ) {
      /*
        Reuse the useful "house of mirrors" idea, but restrained enough
        that this diagnostic mask cannot fold into D-shapes.
      */
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
            uv.y * 4.8 +
            motion * 0.36
          ) * 0.22 +
          sin(
            uv.y * 9.2 -
            motion * 0.21 +
            1.2
          ) * 0.09
        );

      rowMagnification =
        clamp(
          rowMagnification,
          0.72,
          1.28
        );

      const float pivotX = 0.72;

      uv.x =
        pivotX +
        (
          uv.x -
          pivotX
        ) /
        rowMagnification;

      return uv;
    }

    float backslashMask(
      vec2 uv,
      float motion
    ) {
      /*
        \\\ bars moving >>.

        This mask has NO colour of its own. Its only job is to trigger
        different interactions depending on which static base territory
        it crosses.
      */
      float coord =
        (
          uv.x +
          uv.y * 0.34
        ) * 5.05 -
        motion * 0.84 +
        0.18;

      float cell =
        fract(coord);

      return
        smoothstep(
          0.075,
          0.095,
          cell
        ) *
        (
          1.0 -
          smoothstep(
            0.46,
            0.49,
            cell
          )
        );
    }

    void main() {
      float motion =
        reducedMotionPlaceholder;

      vec2 screenUV =
        vec2(
          v_uv.x,
          1.0 - v_uv.y
        );

      float blackRegion;
      float magentaRegion;
      float cobaltRegion;

      vec3 baseColor =
        exactBasePlate(
          screenUV,
          blackRegion,
          magentaRegion,
          cobaltRegion
        );

      /*
        Keep the source/pan behavior we already solved, but only for the
        moving mask. The persistent artwork never moves.
      */
      vec2 movingUV =
        vec2(
          v_uv.x + 0.18,
          v_uv.y
        );

      movingUV =
        cornerPinApprox(
          movingUV,
          -0.035,
          0.075,
          1.12,
          0.90
        );

      movingUV =
        restrainedRightWarp(
          movingUV,
          motion
        );

      float mask =
        backslashMask(
          movingUV,
          motion
        );

      /*
        Stage 3S-A.1.1 — REGION-COLOURED BAR.

        The persistent artwork stays untouched.

        The moving mask now owns a BAR APPEARANCE chosen by the territory
        underneath it:
        - magenta -> near-black / deep plum bar
        - cobalt  -> electric-blue bar
        - black   -> leave the supplied black territory untouched

        This fixes the previous "bar looks underneath cobalt" behavior.
      */
      vec3 magentaBarColor =
        vec3(
          0.018,
          0.006,
          0.026
        );

      vec3 cobaltBarColor =
        vec3(
          0.025,
          0.34,
          1.00
        );

      vec3 regionBarColor =
        magentaBarColor *
        magentaRegion +
        cobaltBarColor *
        cobaltRegion +
        baseColor *
        blackRegion;

      /*
        Keep a little translucency so the bar reads as an optical
        interaction rather than a flat opaque vector slab.
      */
      float barOpacity =
        mask *
        (
          magentaRegion * 0.88 +
          cobaltRegion * 0.84
        );

      vec3 interaction =
        mix(
          baseColor,
          regionBarColor,
          clamp(
            barOpacity,
            0.0,
            1.0
          )
        );

      /*
        Preserve the supplied black territory completely in this test.
      */
      interaction =
        mix(
          interaction,
          baseColor,
          blackRegion
        );

      vec3 color =
        interaction;

      if (
        u_debugView >
        0.5 &&
        u_debugView <
        1.5
      ) {
        color =
          baseColor;
      } else if (
        u_debugView >
        1.5 &&
        u_debugView <
        2.5
      ) {
        color =
          vec3(mask);
      } else if (
        u_debugView >
        2.5
      ) {
        color =
          magentaRegion * vec3(1.0, 0.0, 0.55) +
          cobaltRegion * vec3(0.0, 0.35, 1.0) +
          blackRegion * vec3(0.0);
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
      "[JOYCE reconstruction / Stage 3S-A.1] WebGL failed:",
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

  const uMotion =
    gl.getUniformLocation(
      program,
      "u_motion"
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

    if (uMotion) {
      gl.uniform1f(
        uMotion,
        motion
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
