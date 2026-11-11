(() => {
  "use strict";

  const root = document.querySelector("[data-stage-root]");
  const canvas = document.querySelector("[data-stage-canvas]");

  if (!root || !canvas) return;

  const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

      float zoomCoord =
        log2(d) * 1.72 -
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
        Ripple is kept subtle and layer-specific, matching the original
        workflow where only some duplicates received extra deformation.
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
        0.34;

      return uv;
    }

    void main() {
      vec2 uv = v_uv;

      float motion =
        reducedMotionPlaceholder; // replaced in JS before compilation

      /*
        Stage 3: apply a DIFFERENT corner-pin transform to each approved
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
          0.78,
          1.34
        );

      redUV =
        rippleLayer(
          redUV,
          0.8,
          0.014,
          motion
        );

      vec2 blueUV =
        cornerPinApprox(
          uv,
          -0.035,
          0.115,
          1.28,
          0.74
        );

      /*
        Blue keeps a cleaner geometry so the layer contrast stays legible.
      */
      blueUV.x +=
        sin(
          blueUV.y * 17.0 -
          motion * 1.55 +
          2.4
        ) * 0.0045;

      vec2 violetUV =
        cornerPinApprox(
          uv,
          0.020,
          -0.028,
          0.96,
          1.12
        );

      violetUV =
        rippleLayer(
          violetUV,
          4.1,
          0.008,
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
        AE-style Lighten approximation:
        each output channel keeps the brighter value from the duplicates.
        Where red and blue overlap, both channels survive and naturally
        create hot magenta / violet mixtures.
      */
      vec3 color =
        max(
          max(
            redLayer,
            blueLayer
          ),
          violetLayer
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

    gl.drawArrays(
      gl.TRIANGLES,
      0,
      6
    );
  }

  requestAnimationFrame(frame);
})();
