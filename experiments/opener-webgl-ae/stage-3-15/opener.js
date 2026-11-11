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

    float macroStripeField(
      float x,
      float motion,
      float phase
    ) {
      /*
        Stage 3.15:
        same zooming stripe-precomp idea, but at a MUCH lower frequency
        and with a much wider duty cycle.

        This creates one or two huge persistent bands/planes instead of
        another family of narrow ribbons.
      */
      const float sourceOriginX = 0.14;

      float d =
        max(
          abs(
            x -
            sourceOriginX
          ),
          0.0007
        );

      float coord =
        log2(d) * 0.76 -
        motion +
        phase;

      float cell =
        fract(coord);

      return
        smoothstep(
          0.18,
          0.23,
          cell
        ) *
        (
          1.0 -
          smoothstep(
            0.70,
            0.76,
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

    void main() {
      /*
        Stage 3.15:
        preserve Stage 3 mechanics/colour separation, but pan the moving
        stack so its convergence point stays just off the left edge.
      */
      vec2 uv =
        vec2(
          v_uv.x + 0.18,
          v_uv.y
        );

      float motion =
        reducedMotionPlaceholder; // replaced in JS before compilation

      /*
        Persistent composition zones inferred from Joyce's block sketch
        and checked against the original GIF:
        magenta holds through left/middle, cobalt dominates middle/right,
        and the upper-left has persistent negative-space potential.

        IMPORTANT: these masks are NOT rendered as a background plate.
        They only decide where the new broad duplicate layers are allowed
        to contribute.
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
            0.0,
            0.0
          ),
          vec2(
            262.0 / 956.0,
            0.0
          ),
          vec2(
            59.0 / 956.0,
            233.0 / 547.0
          ),
          vec2(
            0.0,
            127.0 / 547.0
          )
        );

      /*
        Soft diagonal handoff instead of a hard triangle edge. This keeps
        the broad duplicates feeling like overlapping AE layers rather than
        a visible geometric matte.
      */
      float blueRegion =
        smoothstep(
          -0.10,
          0.12,
          screenUV.x -
          (
            0.48 +
            screenUV.y * 0.46
          )
        );

      blueRegion *=
        (
          1.0 -
          blackRegion
        );

      float magentaRegion =
        clamp(
          (
            1.0 -
            blueRegion
          ) *
          (
            1.0 -
            blackRegion
          ),
          0.0,
          1.0
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

      /*
        MACRO PERSISTENT DUPLICATES
        --------------------------------
        Same source logic, but genuinely macro-scale now:
        - much lower stripe frequency
        - very wide duty cycle
        - slower motion
        - stronger corner-pin stretch

        These should read as persistent coloured planes/masses rather than
        clipped ribbons.
      */
      vec2 broadMagentaUV =
        cornerPinApprox(
          uv,
          0.10,
          -0.14,
          2.10,
          2.70
        );

      broadMagentaUV =
        rippleLayer(
          broadMagentaUV,
          1.55,
          0.0035,
          motion * 0.26
        );

      vec2 broadBlueUV =
        cornerPinApprox(
          uv,
          -0.13,
          0.10,
          2.55,
          1.95
        );

      broadBlueUV =
        funhouseRight(
          broadBlueUV,
          3.15,
          motion * 0.30
        );

      float broadMagentaStripe =
        macroStripeField(
          broadMagentaUV.x - 0.010,
          motion * 0.11,
          0.18
        );

      float broadBlueStripe =
        macroStripeField(
          broadBlueUV.x + 0.018,
          motion * 0.09,
          -0.08
        );

      /*
        Keep the macro planes persistent in their large colour territories,
        but still let them breathe internally because they remain stripe
        duplicates, not static colour fills.
      */
      vec3 broadMagentaLayer =
        broadMagentaStripe *
        vec3(
          1.00,
          0.030,
          0.70
        ) *
        magentaRegion *
        0.72;

      vec3 broadBlueLayer =
        broadBlueStripe *
        vec3(
          0.020,
          0.25,
          1.00
        ) *
        blueRegion *
        0.78;

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
        Stage 3.15 negative-space protection:
        the original keeps a broad dark upper-left territory.

        We do NOT paint black on top. Instead, the smaller duplicate stack
        simply contributes less there. A few runner/glitch planes can still
        cross it, which keeps the region alive instead of looking masked.
      */
      float baseBlackProtection =
        1.0 -
        blackRegion * 0.82;

      float runnerBlackProtection =
        1.0 -
        blackRegion * 0.42;

      float fastRunnerBlackProtection =
        1.0 -
        blackRegion * 0.28;

      redLayer *= baseBlackProtection;
      blueLayer *= baseBlackProtection;
      violetLayer *= baseBlackProtection;

      runnerLayer *= runnerBlackProtection;
      rippledRunnerLayer *= fastRunnerBlackProtection;

      /*
        AE-style Lighten approximation:
        each output channel keeps the brighter value from the duplicates.
        Where red and blue overlap, both channels survive and naturally
        create hot magenta / violet mixtures.
      */
      vec3 color =
        max(
          max(
            max(
              max(
                max(
                  max(
                    redLayer,
                    blueLayer
                  ),
                  violetLayer
                ),
                broadMagentaLayer
              ),
              broadBlueLayer
            ),
            runnerLayer
          ),
          rippledRunnerLayer
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
