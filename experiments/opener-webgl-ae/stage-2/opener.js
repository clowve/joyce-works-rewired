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
        Stage 2.1 composition correction:
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
        This is still the exact Stage 1 stripe source. Stage 2 changes
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

    void main() {
      vec2 uv = v_uv;

      /*
        Keep every duplicate intentionally flat. Perspective/corner-pin
        distortion belongs to Stage 3, not here.
      */
      float motion =
        reducedMotionPlaceholder; // replaced in JS before compilation

      /*
        Stage 2: duplicate the SAME simple stripe source, tint each copy,
        and combine with a per-channel Lighten blend (max).

        The tiny translations / phase offsets are ordinary layer offsets,
        not perspective warps. The dramatic corner-pin fan is reserved
        for Stage 3.
      */
      float redStripe =
        stripeField(
          uv.x - 0.018,
          motion + 0.018
        );

      float blueStripe =
        stripeField(
          uv.x + 0.026,
          motion - 0.024
        );

      float supportStripe =
        stripeField(
          uv.x + 0.004,
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
      "[JOYCE AE reconstruction / Stage 2] WebGL failed:",
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
      Stage 2 is trivial enough that 1.5 DPR gives a clean preview while
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
      centre, reading as a continuous zoom-in.
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
