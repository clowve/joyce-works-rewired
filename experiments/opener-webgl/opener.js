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

  /*
    V29 grading is intentionally independent from all motion grammar.
    URL options:
      default     -> raw V30 procedural source
      ?grade=a    -> restrained vibrancy lift
      ?grade=b    -> bolder reference-seeking lift
  */
  const gradeParam =
    new URLSearchParams(window.location.search)
      .get("grade")
      ?.toLowerCase();

  const gradeMode =
    gradeParam === "a"
      ? 1
      : gradeParam === "b"
        ? 2
        : 0;

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
    uniform float u_gradeMode;

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

    vec3 gradeVibrance(
      vec3 c,
      float saturation,
      float contrast,
      float highlightLift,
      float cyanBias,
      float magentaBias
    ) {
      float luma =
        dot(
          c,
          vec3(0.2126, 0.7152, 0.0722)
        );

      /*
        Saturation is anchored to luminance so the grade enriches the
        source rather than simply multiplying channel values.
      */
      c =
        mix(
          vec3(luma),
          c,
          saturation
        );

      /*
        Soft contrast around a slightly lowered pivot keeps the dark
        field deep while allowing the electric colors to separate.
      */
      c =
        (c - 0.46) *
        contrast +
        0.46;

      /*
        Luma-driven highlight energy: not a blur/bloom pass, but enough
        emissive lift to recover some of the luminous GIF character.
      */
      float highlight =
        smoothstep(
          0.48,
          0.94,
          luma
        );

      c +=
        c *
        highlight *
        highlightLift;

      /*
        Small palette bias toward the cyan / magenta energy visible in
        the original opener language. Kept luma-weighted so neutrals do
        not become globally tinted.
      */
      float chroma =
        max(c.r, max(c.g, c.b)) -
        min(c.r, min(c.g, c.b));

      float colorGate =
        smoothstep(
          0.08,
          0.46,
          chroma
        );

      c.gb +=
        vec2(0.50, 0.82) *
        cyanBias *
        colorGate;

      c.rb +=
        vec2(0.86, 0.48) *
        magentaBias *
        colorGate;

      return clamp(c, 0.0, 1.0);
    }

    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);

      f =
        f * f *
        (3.0 - 2.0 * f);

      float a =
        hash21(i);

      float b =
        hash21(
          i + vec2(1.0, 0.0)
        );

      float c =
        hash21(
          i + vec2(0.0, 1.0)
        );

      float d =
        hash21(
          i + vec2(1.0, 1.0)
        );

      return mix(
        mix(a, b, f.x),
        mix(c, d, f.x),
        f.y
      );
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amp = 0.52;

      for (int i = 0; i < 4; i++) {
        value +=
          noise2(p) * amp;

        p =
          mat2(
            1.62, -1.18,
            1.18,  1.62
          ) *
          p +
          vec2(2.13, 1.37);

        amp *= 0.48;
      }

      return value;
    }

    float shardMask(
      vec2 q,
      float count,
      float slant,
      float seed,
      float minWidth,
      float maxWidth
    ) {
      float bend =
        (
          noise2(
            vec2(
              q.y * 3.6,
              seed * 0.37
            )
          ) - 0.5
        ) * 0.16;

      float coord =
        (
          q.x +
          q.y * slant +
          bend
        ) *
        count;

      float id =
        floor(coord);

      float cell =
        fract(coord);

      float center =
        0.50 +
        (
          hash11(
            id * 1.71 + seed
          ) - 0.5
        ) * 0.34;

      float width =
        mix(
          minWidth,
          maxWidth,
          hash11(
            id * 2.19 + seed * 1.83
          )
        );

      /*
        Low-frequency edge wander makes the silhouettes crystalline and
        irregular rather than perfectly striped.
      */
      float edgeWarp =
        (
          noise2(
            vec2(
              q.y * 8.0 +
                id * 0.17,
              seed
            )
          ) - 0.5
        ) * 0.085;

      float dist =
        abs(
          cell -
          center +
          edgeWarp
        );

      float ribbon =
        1.0 -
        smoothstep(
          width,
          width + 0.028,
          dist
        );

      /*
        Segment/taper the long ribbons so they form overlapping shard
        masses instead of running uninterrupted through the whole frame.
      */
      float segmentScale =
        mix(
          1.45,
          2.65,
          hash11(
            id + seed * 3.1
          )
        );

      float yCell =
        fract(
          q.y * segmentScale +
          hash11(
            id * 4.3 + seed
          )
        );

      float taper =
        1.0 -
        smoothstep(
          0.33,
          0.50,
          abs(
            yCell - 0.5
          )
        );

      return ribbon *
        mix(
          0.42,
          1.0,
          taper
        );
    }

    vec3 proceduralSource(vec2 q) {
      /*
        V30 PROCEDURAL SOURCE FIELD.
        Reference-driven palette, but no sampled artwork:
        near-black violet, cobalt/electric blue, violet, hot magenta
        and pink-red shard cores.
      */
      vec3 ink =
        vec3(
          0.018,
          0.004,
          0.030
        );

      vec3 deepBlue =
        vec3(
          0.035,
          0.105,
          0.52
        );

      vec3 electricBlue =
        vec3(
          0.055,
          0.32,
          0.96
        );

      vec3 violet =
        vec3(
          0.46,
          0.22,
          0.92
        );

      vec3 purple =
        vec3(
          0.55,
          0.08,
          0.64
        );

      vec3 magenta =
        vec3(
          0.985,
          0.075,
          0.67
        );

      vec3 hotPink =
        vec3(
          1.00,
          0.075,
          0.34
        );

      vec3 lavender =
        vec3(
          0.55,
          0.42,
          1.00
        );

      float broad =
        fbm(
          q * vec2(2.15, 1.55) +
          vec2(3.7, 8.2)
        );

      float fine =
        fbm(
          q * vec2(5.8, 4.1) +
          vec2(11.3, 2.9)
        );

      /*
        Broad chromatic atmosphere: magenta-biased centre/left, blue
        weight toward the right, and violet where those fields overlap.
      */
      float blueField =
        smoothstep(
          0.18,
          0.92,
          q.x +
          (broad - 0.5) * 0.34
        );

      vec3 color =
        mix(
          purple * 0.62,
          deepBlue,
          blueField
        );

      float centerHaze =
        exp(
          -dot(
            (q - vec2(0.47, 0.50)) *
              vec2(1.10, 0.82),
            (q - vec2(0.47, 0.50)) *
              vec2(1.10, 0.82)
          ) * 4.7
        );

      color +=
        mix(
          magenta,
          violet,
          blueField
        ) *
        centerHaze *
        0.24;

      /*
        Three overlapping crystalline families. Their slants stay close
        enough to feel like one visual language, but their widths and
        segmentation create the layered shard density in the GIF.
      */
      float shardA =
        shardMask(
          q,
          6.2,
          -0.16,
          12.7,
          0.075,
          0.155
        );

      float shardB =
        shardMask(
          q + vec2(0.04, -0.02),
          8.4,
          -0.11,
          41.9,
          0.045,
          0.105
        );

      float shardC =
        shardMask(
          q + vec2(-0.03, 0.01),
          5.1,
          -0.22,
          83.1,
          0.090,
          0.185
        );

      float idA =
        floor(
          (
            q.x +
            q.y * -0.16
          ) * 6.2
        );

      float idB =
        floor(
          (
            q.x +
            q.y * -0.11
          ) * 8.4
        );

      float idC =
        floor(
          (
            q.x +
            q.y * -0.22
          ) * 5.1
        );

      vec3 shardColorA =
        mix(
          magenta,
          electricBlue,
          step(
            0.52,
            hash11(idA + 17.0)
          )
        );

      shardColorA =
        mix(
          shardColorA,
          lavender,
          step(
            0.84,
            hash11(idA * 2.4 + 5.0)
          )
        );

      vec3 shardColorB =
        mix(
          violet,
          hotPink,
          step(
            0.60,
            hash11(idB + 23.0)
          )
        );

      shardColorB =
        mix(
          shardColorB,
          electricBlue,
          step(
            0.78,
            hash11(idB * 1.9 + 11.0)
          )
        );

      vec3 shardColorC =
        mix(
          purple,
          magenta,
          step(
            0.47,
            hash11(idC + 37.0)
          )
        );

      shardColorC =
        mix(
          shardColorC,
          deepBlue,
          step(
            0.76,
            hash11(idC * 2.7 + 3.0)
          )
        );

      color =
        mix(
          color,
          shardColorC,
          shardC * 0.68
        );

      color =
        mix(
          color,
          shardColorA,
          shardA * 0.82
        );

      color =
        mix(
          color,
          shardColorB,
          shardB * 0.72
        );

      /*
        Internal luminous variation keeps large shards from reading as
        flat vector polygons.
      */
      float innerGlow =
        smoothstep(
          0.34,
          0.90,
          broad * 0.62 +
          fine * 0.38
        );

      color +=
        (
          vec3(0.28, 0.10, 0.38) +
          vec3(0.04, 0.16, 0.34) *
            blueField
        ) *
        innerGlow *
        (
          0.13 +
          max(
            shardA,
            max(shardB, shardC)
          ) * 0.18
        );

      /*
        Irregular near-black negative-space pockets, strongest at the
        top-left and outer edges like the original reference.
      */
      float topLeft =
        1.0 -
        smoothstep(
          0.10,
          0.60,
          distance(
            q,
            vec2(0.0, 1.0)
          )
        );

      vec2 centered =
        (q - 0.5) *
        vec2(1.03, 0.82);

      float edgeFalloff =
        smoothstep(
          0.39,
          0.76,
          length(centered)
        );

      float darkPocket =
        smoothstep(
          0.56,
          0.82,
          fbm(
            q * vec2(3.1, 2.4) +
            vec2(-4.0, 9.0)
          )
        );

      float darken =
        clamp(
          topLeft * 0.88 +
          edgeFalloff * 0.36 +
          darkPocket * 0.20,
          0.0,
          0.94
        );

      color =
        mix(
          color,
          ink,
          darken
        );

      /*
        Fine source-locked stipple + subtle line texture. Unlike the
        existing final-frame grain, this texture travels with the source
        through every refraction sample.
      */
      vec2 texel =
        floor(
          q *
          vec2(1137.0, 540.0) *
          0.44
        );

      float stipple =
        hash21(
          texel + 91.7
        );

      float micro =
        (
          stipple - 0.5
        ) * 0.055;

      float lineTexture =
        sin(
          q.y * 540.0 * 0.52
        ) * 0.010;

      color +=
        vec3(
          micro + lineTexture
        );

      /*
        Small hot-core lift on bright magenta regions. This is what gives
        the reference its fluorescent pink centres without globally
        lifting the whole image.
      */
      float pinkCore =
        shardA *
        smoothstep(
          0.62,
          0.92,
          1.0 - blueField
        );

      color +=
        hotPink *
        pinkCore *
        0.12;

      return clamp(
        color,
        0.0,
        1.0
      );
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
        V28 SECONDARY REFRACTION TUNING:
        the smooth refraction grid now shares the SAME visual diagonal
        axis as the hard-slice/glitch bars. The layers remain functionally
        separate, but there is only one visible angle family.

        Main bands use one fixed width and one fixed gap. Hairlines sit
        inside those gaps and never change the underlying cadence.
      */
      float diagonalCoord =
        (uv.x - uv.y * 0.37) * 5.6 +
        t * 2.18;

      float diagonalId =
        floor(
          diagonalCoord
        );

      float diagonalCell =
        fract(
          diagonalCoord
        );

      float diagonalPhase =
        sin(
          diagonalCoord * 6.28318
        );

      float diagonalGate =
        0.5 +
        0.5 *
        cos(
          diagonalCoord * 6.28318
        );

      vec2 diagonalUV =
        signalUV +
        vec2(
          -0.034 -
            diagonalGate * 0.028 +
            diagonalPhase * 0.014,
          diagonalPhase * 0.0065
        );

      /*
        Truly standardized cadence:
        main band = fixed ~20% of each cell;
        gap = fixed ~80% of each cell.
        Only a narrow feather softens the edges.
      */
      float diagonalMainMask =
        smoothstep(
          0.045,
          0.070,
          diagonalCell
        ) *
        (
          1.0 -
          smoothstep(
            0.245,
            0.270,
            diagonalCell
          )
        );

      /*
        Intermittent hairlines are peppered only inside the fixed gap.
        Their presence varies, but their existence never shifts either
        edge of the main band or changes main-band spacing.
      */
      float diagonalHairSeed =
        hash11(
          diagonalId * 2.37 + 61.0
        );

      float diagonalHairCenter =
        0.53 +
        (diagonalHairSeed - 0.5) * 0.20;

      float diagonalHairMask =
        smoothstep(
          diagonalHairCenter - 0.018,
          diagonalHairCenter - 0.006,
          diagonalCell
        ) *
        (
          1.0 -
          smoothstep(
            diagonalHairCenter + 0.006,
            diagonalHairCenter + 0.018,
            diagonalCell
          )
        );

      float diagonalHairPulse =
        smoothstep(
          0.72,
          0.92,
          0.5 +
          0.5 *
          sin(
            t * (2.4 + diagonalHairSeed * 1.55) +
            diagonalHairSeed * 6.28318
          )
        );

      diagonalHairMask *=
        step(
          0.30,
          diagonalHairSeed
        ) *
        diagonalHairPulse;

      float diagonalMix =
        max(
          diagonalMainMask,
          diagonalHairMask * 0.54
        );

      signalUV =
        mix(
          signalUV,
          diagonalUV,
          diagonalMix * 0.54
        );

      /*
        V23 HARD-SLICE LAYER:
        preserve the approved V17/V18 angle and continuous bars, but make
        spacing variation visibly structural instead of only changing
        width inside an evenly repeated grid.

        Outside the center, the coordinate itself is gently warped so
        bar-to-bar distance genuinely changes, with skipped cells creating
        occasional larger negative-space breaks.

        The horizontal middle is the safe-ish zone: fewer bars, thinner
        bars, wider spacing and reduced autonomous shear intensity.
      */
      float sliceTravel =
        uv.x -
        uv.y * 0.37 +
        t * 0.30;

      /*
        OUTER RHYTHM:
        warped scalar coordinate = visibly uneven spacing while every bar
        remains straight and continuous along the approved diagonal.
      */
      float outerWarp =
        sin(
          sliceTravel * 8.6 + 0.7
        ) * 0.22 +
        sin(
          sliceTravel * 3.15 - 1.1
        ) * 0.18;

      float outerCoord =
        sliceTravel * 5.7 +
        outerWarp;

      float outerId =
        floor(outerCoord);

      float outerCell =
        fract(outerCoord);

      float outerRand =
        hash11(
          outerId + 13.7
        );

      float outerRandB =
        hash11(
          outerId * 1.73 + 31.1
        );

      float outerWidth =
        mix(
          0.20,
          0.34,
          outerRand
        ) +
        step(
          0.88,
          outerRandB
        ) * 0.14;

      float outerStart =
        0.045 +
        outerRandB * 0.08;

      float outerEnd =
        min(
          0.95,
          outerStart + outerWidth
        );

      float outerBand =
        step(
          outerStart,
          outerCell
        ) *
        (
          1.0 -
          step(
            outerEnd,
            outerCell
          )
        );

      /*
        Skip enough cells that the negative space changes at a glance:
        some ordinary gaps, some doubled gaps, then occasional heavy bars.
      */
      float outerKeep =
        step(
          0.22,
          hash11(
            outerId * 2.11 + 5.0
          )
        );

      outerBand *=
        outerKeep;

      /*
        CENTER SAFE ZONE:
        the middle is deliberately calmer, not denser. Lower frequency +
        more skipped cells + thinner widths means fewer interruptions and
        visibly wider breathing room through the logo area.
      */
      float centerDistance =
        abs(
          uv.y - 0.5
        );

      float centerQuiet =
        1.0 -
        smoothstep(
          0.105,
          0.235,
          centerDistance
        );

      float centerWarp =
        sin(
          sliceTravel * 5.1 + 2.4
        ) * 0.16;

      float fineCoord =
        sliceTravel * 4.35 +
        centerWarp;

      float fineId =
        floor(fineCoord);

      float fineCell =
        fract(fineCoord);

      float fineRand =
        hash11(
          fineId + 51.0
        );

      float fineRandB =
        hash11(
          fineId * 2.31 + 8.0
        );

      float fineWidth =
        mix(
          0.090,
          0.155,
          fineRand
        );

      float fineStart =
        0.055 +
        fineRandB * 0.075;

      float fineEnd =
        min(
          0.92,
          fineStart + fineWidth
        );

      float fineBand =
        step(
          fineStart,
          fineCell
        ) *
        (
          1.0 -
          step(
            fineEnd,
            fineCell
          )
        );

      float fineKeep =
        step(
          0.43,
          hash11(
            fineId * 2.77 + 19.0
          )
        );

      fineBand *=
        fineKeep;

      /*
        V23 INTERMITTENT HAIRLINES:
        a second, much finer glitch family adds brief periods of extra
        activity without increasing the number of substantial bars.
        These lines share the hard-slice angle but remain visually tiny.
      */
      float hairCoord =
        sliceTravel * 18.0 +
        sin(
          sliceTravel * 6.4 + 1.8
        ) * 0.10;

      float hairId =
        floor(hairCoord);

      float hairCell =
        fract(hairCoord);

      float hairSeed =
        hash11(
          hairId * 1.91 + 83.0
        );

      float hairBand =
        step(
          0.035,
          hairCell
        ) *
        (
          1.0 -
          step(
            0.082,
            hairCell
          )
        );

      float hairKeep =
        step(
          0.46,
          hairSeed
        );

      float hairPulse =
        smoothstep(
          0.57,
          0.88,
          noise1(
            t * 3.35 + 41.0
          )
        );

      float hairMask =
        hairBand *
        hairKeep *
        hairPulse *
        mix(
          1.0,
          0.24,
          centerQuiet
        );

      /*
        Keep every slice continuous along its length. The center replaces
        the outer pattern with the quieter fine family through a soft
        transition, avoiding an obvious rectangular cutout.
      */
      float sliceMask =
        mix(
          outerBand,
          fineBand,
          centerQuiet
        );

      float outerJitter =
        hash11(
          outerId
        );

      float fineJitter =
        hash11(
          fineId + 71.0
        );

      float sliceJitter =
        mix(
          outerJitter,
          fineJitter,
          centerQuiet
        );

      /*
        V18 AUTONOMOUS SIGNAL SPIKES:
        revive the original V1 intermittent horizontal stripe-shear
        vocabulary as a separate, cursor-independent layer.

        V1 used a single sparse clock. Here a primary spike clock plus a
        smaller secondary clock reduce long dead gaps without making the
        image permanently glitchy.
      */
      float legacyClock =
        floor(t * 1.55);

      float legacySeed =
        hash11(
          legacyClock * 4.71 +
          17.0
        );

      float legacyGate =
        smoothstep(
          0.66,
          0.94,
          legacySeed
        );

      float legacyStripe =
        floor(
          (uv.y + t * 0.012) * 21.0
        );

      float legacyStripeSeed =
        hash11(
          legacyStripe +
          legacyClock * 13.0
        );

      float legacyShear =
        (legacyStripeSeed - 0.5) *
        legacyGate *
        mix(
          1.0,
          0.34,
          centerQuiet
        ) *
        (
          0.026 +
          0.040 *
          hash11(
            legacyStripe + 2.0
          )
        );

      float legacyClockB =
        floor(
          t * 2.25 +
          9.0
        );

      float legacySeedB =
        hash11(
          legacyClockB * 7.13 +
          31.0
        );

      float legacyGateB =
        smoothstep(
          0.79,
          0.97,
          legacySeedB
        );

      float legacyStripeB =
        floor(
          (uv.y - t * 0.016) * 31.0
        );

      float legacyStripeSeedB =
        hash11(
          legacyStripeB +
          legacyClockB * 17.0
        );

      float legacyShearB =
        (legacyStripeSeedB - 0.5) *
        legacyGateB *
        mix(
          1.0,
          0.42,
          centerQuiet
        ) *
        (
          0.010 +
          0.022 *
          hash11(
            legacyStripeB + 5.0
          )
        );

      float autonomousGlitch =
        clamp(
          legacyGate +
          legacyGateB * 0.72,
          0.0,
          1.0
        );

      /*
        V21 LAYER ISOLATION:
        signalUV is now frozen as the approved base + smooth secondary
        refraction coordinate. All autonomous, cursor and memory glitch
        displacement happens on a clone so hard-glitch tuning cannot
        alter the underlying diagonal shard/refraction plane.
      */
      vec2 glitchUV =
        signalUV;

      glitchUV.x +=
        legacyShear +
        legacyShearB;

      vec2 sliceUV =
        glitchUV +
        vec2(
          -0.080 -
            sliceJitter * 0.036,
          (sliceJitter - 0.5) * 0.014
        );

      vec2 hairUV =
        glitchUV +
        vec2(
          -0.034 -
            hairSeed * 0.016,
          (hairSeed - 0.5) * 0.006
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

      glitchUV.x +=
        signedShear *
        (
          ambientArtifact * 0.018 +
          liveArtifact * (0.028 + activeEnergy * 0.030) +
          memoryArtifact * 0.032
        );

      glitchUV.y +=
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
      glitchUV -=
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
        autonomousGlitch * 0.0075 +
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
        coverUV(glitchUV);

      vec2 sampleEcho =
        coverUV(
          glitchUV +
          vec2(
            signedShear * artifact * 0.026,
            0.0
          )
        );

      vec3 leftColor =
        proceduralSource(
          coverUV(uvLeft)
        );

      vec3 rightColor =
        proceduralSource(
          coverUV(uvRight)
        );

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
          proceduralSource(
            coverUV(
              diagonalUV +
              diagonalChroma
            )
          ).r,
          proceduralSource(
            coverUV(diagonalUV)
          ).g,
          proceduralSource(
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
          proceduralSource(
            coverUV(
              sliceUV +
              sliceChroma
            )
          ).r,
          proceduralSource(
            coverUV(sliceUV)
          ).g,
          proceduralSource(
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

      vec2 hairChroma =
        vec2(
          0.008 + hairSeed * 0.004,
          -0.002
        );

      vec3 hairColor =
        vec3(
          proceduralSource(
            coverUV(
              hairUV +
              hairChroma
            )
          ).r,
          proceduralSource(
            coverUV(hairUV)
          ).g,
          proceduralSource(
            coverUV(
              hairUV -
              hairChroma
            )
          ).b
        );

      baseColor =
        mix(
          baseColor,
          hairColor,
          hairMask * 0.46
        );

      float r =
        proceduralSource(
          coverUV(glitchUV + cOffset)
        ).r;

      float g =
        proceduralSource(
          sampleBase
        ).g;

      float b =
        proceduralSource(
          coverUV(glitchUV - cOffset)
        ).b;

      vec3 splitColor =
        vec3(r, g, b);

      vec3 echoColor =
        proceduralSource(
          sampleEcho
        );

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
          glitchUV -
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
          proceduralSource(
            coverUV(smearUV)
          );
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

      /*
        V29 COLOR-RICHNESS PASS.
        IMPORTANT: this is downstream of every UV/motion calculation.
        It cannot alter V28 motion grammar, slice spacing, diagonal
        cadence, cursor behavior or logo choreography.

        mode 0 = V28 untouched
        mode 1 = A / restrained vibrancy
        mode 2 = B / bolder, more luminous
      */
      if (u_gradeMode > 0.5) {
        if (u_gradeMode > 1.5) {
          color =
            gradeVibrance(
              color,
              1.34,
              1.16,
              0.18,
              0.030,
              0.025
            );

          /*
            Slight black-floor shaping for B: retain deep blacks while
            allowing colored mids/highlights to feel more electric.
          */
          color =
            pow(
              max(color, vec3(0.0)),
              vec3(0.94)
            );
        } else {
          color =
            gradeVibrance(
              color,
              1.18,
              1.09,
              0.095,
              0.014,
              0.012
            );
        }
      }

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
    scroll: loc("u_scroll"),
    gradeMode: loc("u_gradeMode")
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

  /*
    V30 is fully procedural: no source artwork is loaded.
    The 1137x540 reference dimensions remain only as the canonical
    aspect ratio used by coverUV(), matching the original GIF framing.
  */
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255])
  );

  let textureReady = true;
  root.classList.add("webgl-ready");

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

    gl.uniform1f(
      u.gradeMode,
      gradeMode
    );

    gl.drawArrays(
      gl.TRIANGLES,
      0,
      6
    );
  }

  requestAnimationFrame(frame);
})();
