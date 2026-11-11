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

    in vec2 v_uv;
    out vec4 outColor;

    float stripeField(float x, float motion) {
      /*
        Stage 3.1 composition correction:
        the source loop's apparent zoom origin sits well left of screen
        centre, closer to the original reference. We keep the stripe
        geometry itself simple here; the strong diagonal fan / corner-pin
        perspective belongs to Stage 3.
      */
      const float sourceOriginX = 0.14;

      float d =
        max(
          abs(x - sourceOriginX),
          0.0007
        );

      float stripeDensity =
        mix(
          1.72,
          1.38,
          u_zoomMode
        );

      float zoomCoord =
        log2(d) * stripeDensity -
        motion;

      float cell =
        fract(zoomCoord);

      /*
        This is still the exact Stage 1 stripe source. Stage 3 changes
        only duplication, colour and blend behavior.
      */
      float stripe =
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

      return stripe;
    }

    vec2 cornerPinApprox(
      vec2 uv,
      float topShift,
      float bottomShift,
      float topScale,
      float bottomScale
    ) {
      /*
        WebGL equivalent of the creator's AE Corner Pin idea:
        each horizontal row is shifted and scaled differently from top
        to bottom, turning a flat rectangle into an off-axis trapezoid /
        fan. Because we calculate the inverse sample coordinate here,
        the stripe source itself stays exactly the approved Stage 1 loop.
      */
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

    vec2 rippleLayer(
      vec2 uv,
      float phase,
      float amount,
      float motion
    ) {
      /*
        Stage 3.4: keep the ordinary ripple readable but restrained.
        The heavier right-side distortion now comes from a separate
        funhouse-mirror remap instead of simply increasing sine wobble.
      */
      uv.x +=
        sin(
          uv.y * 15.0 +
          motion * 2.15 +
          phase
        ) *
        amount;

      uv.x +=
        sin(
          uv.y * 33.0 -
          motion * 1.35 +
          phase * 1.7
        ) *
        amount *
        0.28;

      return uv;
    }

    vec2 funhouseRight(
      vec2 uv,
      float phase,
      float motion
    ) {
      /*
        Broad row-by-row magnification + nonlinear stretch on the right.
        This is intentionally more "house of mirrors" than "wavy".
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

    float runnerStripeField(
      vec2 uv,
      float motion,
      float phase
    ) {
      /*
        Stage 3.1 overlay duplicate:
        a flatter diagonal band system with steady leftward travel.
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

    float rippledRunnerStripeField(
      vec2 uv,
      float motion,
      float phase
    ) {
      /*
        Stage 3.4: a second runner duplicate, same /// vocabulary but
        moving at nearly twice the speed and carrying its own waviness.
      */
      float fastMotion =
        motion * 3.55;

      /*
        The fast runner is most distorted around the centre and becomes
        much calmer toward the far-left edge, matching the reference.
      */
      float centreWarpWeight =
        mix(
          0.14,
          1.0,
          smoothstep(
            0.02,
            0.48,
            uv.x
          )
        );

      float wave =
        sin(
          uv.y * 16.0 -
          fastMotion * 2.45 +
          phase
        ) *
        0.050 *
        centreWarpWeight;

      wave +=
        sin(
          uv.y * 37.0 +
          fastMotion * 1.35 +
          phase * 1.9
        ) *
        0.018 *
        centreWarpWeight;

      vec2 q = uv;
      q.x += wave;

      float coord =
        (
          q.x -
          q.y * 0.34
        ) * 6.15 +
        fastMotion * 1.05 +
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

    vec3 persistentField(
      vec2 screenUV
    ) {
      /*
        Stage 3.17:
        fixed composition fields. These DO NOT MOVE.

        Approximation follows Joyce's persistent visual read:
        black upper-left, magenta across left/middle, cobalt on right.
      */
      vec3 magenta =
        vec3(
          0.98,
          0.035,
          0.73
        );

      vec3 cobalt =
        vec3(
          0.02,
          0.16,
          1.00
        );

      vec3 black =
        vec3(0.0);

      float blueMask =
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

      float blackMask =
        insideQuad(
          screenUV,
          vec2(
            0.00,
            0.00
          ),
          vec2(
            0.27,
            0.00
          ),
          vec2(
            0.06,
            0.43
          ),
          vec2(
            0.00,
            0.23
          )
        );

      vec3 field =
        mix(
          magenta,
          cobalt,
          blueMask
        );

      field =
        mix(
          field,
          black,
          blackMask
        );

      return field;
    }

    void main() {
      /*
        Stage 3.17:
        moving Stage 3 geometry is panned off the left edge, but the
        persistent colour fields stay screen-fixed.
      */
      vec2 uv =
        vec2(
          v_uv.x + 0.18,
          v_uv.y
        );

      float motion =
        reducedMotionPlaceholder; // replaced in JS before compilation

      /*
        Stage 3.17:
        keep the persistent composition screen-fixed and expose its black
        region as a real negative-space control, not a black overlay.
      */
      vec2 screenUV =
        vec2(
          v_uv.x,
          1.0 - v_uv.y
        );

      float blackRegion =
        insideQuad(
          screenUV,
          vec2(
            0.00,
            0.00
          ),
          vec2(
            0.27,
            0.00
          ),
          vec2(
            0.06,
            0.43
          ),
          vec2(
            0.00,
            0.23
          )
        );

      /*
        Stage 3.4: apply a DIFFERENT corner-pin transform to each approved
        Stage 2 colour duplicate.

        Red leans into the left-side V / funnel.
        Blue opens more aggressively toward the right.
        Violet sits between them as a softer support plane.
      */
      vec2 redUV =
        cornerPinApprox(
          uv,
          0.055,
          -0.105,
          0.88,
          1.18
        );

      redUV =
        funhouseRight(
          redUV,
          0.8,
          motion
        );

      redUV =
        rippleLayer(
          redUV,
          0.8,
          0.011,
          motion
        );

      vec2 blueUV =
        cornerPinApprox(
          uv,
          -0.035,
          0.115,
          1.16,
          0.86
        );

      blueUV =
        funhouseRight(
          blueUV,
          2.4,
          motion
        );

      /*
        Blue keeps only a small fine ripple after the broad mirror warp.
      */
      blueUV.x +=
        sin(
          blueUV.y * 17.0 -
          motion * 1.55 +
          2.4
        ) * 0.0032;

      vec2 violetUV =
        cornerPinApprox(
          uv,
          0.020,
          -0.028,
          0.98,
          1.08
        );

      violetUV =
        funhouseRight(
          violetUV,
          4.1,
          motion
        );

      violetUV =
        rippleLayer(
          violetUV,
          4.1,
          0.0065,
          motion
        );

      float redStripe =
        stripeField(
          redUV.x - 0.018,
          motion + 0.018
        );

      float blueStripe =
        stripeField(
          blueUV.x + 0.026,
          motion - 0.024
        );

      float supportStripe =
        stripeField(
          violetUV.x + 0.004,
          motion + 0.055
        );

      vec3 redLayer =
        redStripe *
        vec3(
          1.00,
          0.045,
          0.27
        );

      vec3 blueLayer =
        blueStripe *
        vec3(
          0.035,
          0.23,
          1.00
        );

      vec3 violetLayer =
        supportStripe *
        vec3(
          0.46,
          0.08,
          0.78
        ) *
        0.58;

      /*
        Flatter runner duplicate. Unlike the large fanned copies, this
        layer keeps a regular diagonal rhythm and simply travels leftward.
        A cool tint lets it read as a distinct plane while Lighten keeps
        the intersections luminous.
      */
      float runnerStripe =
        runnerStripeField(
          uv,
          motion,
          0.72
        );

      /*
        Stage 3.4 colour rebalance:
        preserve the runner geometry exactly, but stop the upper planes
        from collapsing the whole frame into blue. The clean runner shifts
        from magenta on the left toward electric blue on the right.
      */
      float runnerColourMix =
        smoothstep(
          0.24,
          0.82,
          uv.x
        );

      vec3 runnerTint =
        mix(
          vec3(
            1.00,
            0.07,
            0.40
          ),
          vec3(
            0.06,
            0.34,
            1.00
          ),
          runnerColourMix
        );

      vec3 runnerLayer =
        runnerStripe *
        runnerTint *
        0.91;

      float rippledRunnerStripe =
        rippledRunnerStripeField(
          uv,
          motion,
          2.35
        );

      /*
        Keep the fast runner hotter / more magenta so it counterbalances
        the clean blue runner without changing its motion at all.
      */
      vec3 rippledRunnerTint =
        mix(
          vec3(
            1.00,
            0.045,
            0.30
          ),
          vec3(
            0.62,
            0.10,
            1.00
          ),
          smoothstep(
            0.42,
            0.92,
            uv.x
          )
        );

      vec3 rippledRunnerLayer =
        rippledRunnerStripe *
        rippledRunnerTint *
        0.72;

      /*
        The upper runner planes obscure the underlying convergence point
        across the left/centre instead of letting the base fan dominate.
      */
      float runnerCoverZone =
        1.0 -
        smoothstep(
          0.50,
          0.78,
          uv.x
        );

      float baseVisibility =
        mix(
          1.0,
          0.54,
          runnerCoverZone
        );

      redLayer *= baseVisibility;
      blueLayer *= baseVisibility;
      violetLayer *= baseVisibility;

      /*
        Make the upper-left black field legible by asking the smaller
        moving duplicates to back off there.

        This is intentionally graded:
        - base/fan layers back off strongly
        - clean runner can still cross
        - fast runner crosses most freely
      */
      float blackBaseVisibility =
        mix(
          1.0,
          0.14,
          blackRegion
        );

      float blackRunnerVisibility =
        mix(
          1.0,
          0.42,
          blackRegion
        );

      float blackFastRunnerVisibility =
        mix(
          1.0,
          0.62,
          blackRegion
        );

      redLayer *= blackBaseVisibility;
      blueLayer *= blackBaseVisibility;
      violetLayer *= blackBaseVisibility;
      runnerLayer *= blackRunnerVisibility;
      rippledRunnerLayer *= blackFastRunnerVisibility;

      /*
        First preserve the exact Stage 3 Lighten stack.
      */
      vec3 movingColor =
        max(
          max(
            max(
              max(
                redLayer,
                blueLayer
              ),
              violetLayer
            ),
            runnerLayer
          ),
          rippledRunnerLayer
        );

      /*
        Fixed persistent composition field. It stays completely still.
      */
      vec3 field =
        persistentField(
          screenUV
        );

      /*
        Stage 3.17 blend correction:
        NO Screen blend.

        The fixed field is now a literal dimmer base plane, and the moving
        Stage 3 stack Lightens over it. This removes the fluorescent pink
        wash while keeping magenta/cobalt zoning visible.

        Black remains exactly black underneath.
      */
      vec3 fieldBase =
        field *
        0.54;

      vec3 color =
        max(
          fieldBase,
          movingColor
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

    gl.drawArrays(
      gl.TRIANGLES,
      0,
      6
    );
  }

  requestAnimationFrame(frame);
})();
