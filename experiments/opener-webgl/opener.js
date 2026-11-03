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
    V32 source switch:
      default             -> protected V28 placeholder baseline
      ?source=procedural  -> one-time generated source texture

    The procedural artwork is generated once on load, then sampled by the
    exact same V28 motion shader. No per-frame procedural field synthesis.
  */
  const sourceMode =
    new URLSearchParams(window.location.search)
      .get("source") === "procedural"
      ? "procedural"
      : "baseline";

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

      vec2 hairChroma =
        vec2(
          0.008 + hairSeed * 0.004,
          -0.002
        );

      vec3 hairColor =
        vec3(
          texture(
            u_texture,
            coverUV(
              hairUV +
              hairChroma
            )
          ).r,
          texture(
            u_texture,
            coverUV(hairUV)
          ).g,
          texture(
            u_texture,
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
        texture(
          u_texture,
          coverUV(glitchUV + cOffset)
        ).r;

      float g =
        texture(
          u_texture,
          sampleBase
        ).g;

      float b =
        texture(
          u_texture,
          coverUV(glitchUV - cOffset)
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

  function createSeededRandom(seed = 0x4a4f5943) {
    let state = seed >>> 0;

    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;

      return (
        (state >>> 0) /
        4294967296
      );
    };
  }

  function buildProceduralSourceCanvas() {
    const width = 1137;
    const height = 540;

    const sourceCanvas =
      document.createElement("canvas");

    sourceCanvas.width = width;
    sourceCanvas.height = height;

    const ctx =
      sourceCanvas.getContext("2d", {
        alpha: false
      });

    if (!ctx) return sourceCanvas;

    const rand =
      createSeededRandom();

    const palette = {
      ink: "#09000f",
      deepBlue: "#07155c",
      cobalt: "#0b43dc",
      electricBlue: "#1678ff",
      violet: "#7138e8",
      lavender: "#9e7cff",
      purple: "#8e168c",
      magenta: "#ff1594",
      hotPink: "#ff174f"
    };

    /*
      Base atmosphere: dark violet left, cobalt/blue right. This is a
      generated color field, not a sampled or traced frame from the GIF.
    */
    const base =
      ctx.createLinearGradient(
        0,
        height * 0.42,
        width,
        height * 0.58
      );

    base.addColorStop(
      0.00,
      palette.ink
    );

    base.addColorStop(
      0.18,
      "#32104f"
    );

    base.addColorStop(
      0.47,
      "#66236f"
    );

    base.addColorStop(
      0.72,
      "#173c9e"
    );

    base.addColorStop(
      1.00,
      palette.deepBlue
    );

    ctx.fillStyle = base;
    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    /*
      Central luminous haze. Large soft gradients make the field feel
      internally lit without requiring an expensive real-time bloom pass.
    */
    const haze =
      ctx.createRadialGradient(
        width * 0.47,
        height * 0.48,
        0,
        width * 0.47,
        height * 0.48,
        width * 0.55
      );

    haze.addColorStop(
      0.00,
      "rgba(255,45,171,0.36)"
    );

    haze.addColorStop(
      0.36,
      "rgba(164,66,230,0.22)"
    );

    haze.addColorStop(
      0.72,
      "rgba(31,79,214,0.09)"
    );

    haze.addColorStop(
      1.00,
      "rgba(0,0,0,0)"
    );

    ctx.fillStyle = haze;
    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    const shardPalettes = [
      [
        palette.magenta,
        palette.lavender,
        palette.hotPink
      ],
      [
        palette.cobalt,
        palette.electricBlue,
        palette.violet
      ],
      [
        palette.purple,
        palette.magenta,
        palette.cobalt
      ]
    ];

    function drawShardFamily(
      count,
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
      slope,
      opacity,
      familyIndex
    ) {
      const colors =
        shardPalettes[
          familyIndex %
          shardPalettes.length
        ];

      for (let i = 0; i < count; i++) {
        const shardWidth =
          minWidth +
          rand() *
          (maxWidth - minWidth);

        const shardHeight =
          minHeight +
          rand() *
          (maxHeight - minHeight);

        const baseX =
          -width * 0.06 +
          rand() * width * 1.12;

        const topY =
          -height * 0.16 +
          rand() *
          (
            height * 1.12 -
            shardHeight
          );

        const bottomY =
          topY +
          shardHeight;

        const topX =
          baseX +
          slope *
          (height - topY) +
          (rand() - 0.5) *
          shardWidth *
          0.7;

        const bottomX =
          baseX +
          slope *
          (height - bottomY);

        const midY1 =
          topY +
          shardHeight *
          (
            0.26 +
            rand() * 0.08
          );

        const midY2 =
          topY +
          shardHeight *
          (
            0.62 +
            rand() * 0.10
          );

        const wobbleA =
          (rand() - 0.5) *
          shardWidth *
          0.55;

        const wobbleB =
          (rand() - 0.5) *
          shardWidth *
          0.55;

        ctx.save();

        ctx.beginPath();
        ctx.moveTo(
          topX,
          topY
        );

        ctx.lineTo(
          topX + shardWidth * 0.34,
          midY1
        );

        ctx.lineTo(
          topX + shardWidth * 0.12 + wobbleA,
          midY2
        );

        ctx.lineTo(
          bottomX + shardWidth * 0.48,
          bottomY
        );

        ctx.lineTo(
          bottomX - shardWidth * 0.44,
          bottomY
        );

        ctx.lineTo(
          topX - shardWidth * 0.22 + wobbleB,
          midY2
        );

        ctx.lineTo(
          topX - shardWidth * 0.40,
          midY1
        );

        ctx.closePath();
        ctx.clip();

        const grad =
          ctx.createLinearGradient(
            topX - shardWidth,
            topY,
            bottomX + shardWidth,
            bottomY
          );

        const c0 =
          colors[
            Math.floor(
              rand() * colors.length
            )
          ];

        const c1 =
          colors[
            Math.floor(
              rand() * colors.length
            )
          ];

        const c2 =
          colors[
            Math.floor(
              rand() * colors.length
            )
          ];

        grad.addColorStop(
          0.00,
          c0
        );

        grad.addColorStop(
          0.48,
          c1
        );

        grad.addColorStop(
          1.00,
          c2
        );

        ctx.globalAlpha =
          opacity *
          (
            0.72 +
            rand() * 0.28
          );

        ctx.fillStyle = grad;
        ctx.fillRect(
          Math.min(
            topX,
            bottomX
          ) - shardWidth * 1.2,
          topY,
          shardWidth * 2.4,
          shardHeight
        );

        /*
          One brighter internal facet per selected shard. This adds the
          hot cores visible in the reference without copying its geometry.
        */
        if (rand() > 0.34) {
          const facet =
            ctx.createLinearGradient(
              topX,
              topY,
              bottomX,
              bottomY
            );

          facet.addColorStop(
            0.00,
            "rgba(255,255,255,0)"
          );

          facet.addColorStop(
            0.44,
            familyIndex === 1
              ? "rgba(111,188,255,0.34)"
              : "rgba(255,103,214,0.38)"
          );

          facet.addColorStop(
            0.62,
            "rgba(255,255,255,0)"
          );

          ctx.globalAlpha =
            opacity * 0.78;

          ctx.fillStyle = facet;
          ctx.fillRect(
            Math.min(
              topX,
              bottomX
            ) - shardWidth,
            topY,
            shardWidth * 2,
            shardHeight
          );
        }

        ctx.restore();
      }
    }

    /*
      Coarse / medium / fine shard families. They overlap but share a
      closely related diagonal direction so the composition stays coherent.
    */
    drawShardFamily(
      11,
      105,
      210,
      390,
      720,
      -0.18,
      0.86,
      0
    );

    drawShardFamily(
      17,
      54,
      122,
      250,
      560,
      -0.15,
      0.72,
      1
    );

    drawShardFamily(
      15,
      34,
      78,
      150,
      390,
      -0.21,
      0.58,
      2
    );

    /*
      A few cropped edge fragments keep the composition from looking like
      evenly distributed generative wallpaper.
    */
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = palette.hotPink;

    for (let i = 0; i < 7; i++) {
      const y =
        height *
        (
          0.18 +
          i * 0.095
        );

      ctx.fillRect(
        0,
        y,
        48 + rand() * 88,
        10 + rand() * 30
      );
    }

    ctx.restore();

    /*
      Fine source texture. Generated once, so this has effectively zero
      impact on animation/scroll performance after upload.
    */
    const imageData =
      ctx.getImageData(
        0,
        0,
        width,
        height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const n =
        (
          rand() - 0.5
        ) * 18;

      data[i] =
        Math.max(
          0,
          Math.min(
            255,
            data[i] + n
          )
        );

      data[i + 1] =
        Math.max(
          0,
          Math.min(
            255,
            data[i + 1] + n
          )
        );

      data[i + 2] =
        Math.max(
          0,
          Math.min(
            255,
            data[i + 2] + n
          )
        );
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    /*
      Dark edge falloff, particularly top-left, matching the reference's
      negative-space balance without tracing its exact shapes.
    */
    const vignette =
      ctx.createRadialGradient(
        width * 0.50,
        height * 0.50,
        width * 0.18,
        width * 0.50,
        height * 0.50,
        width * 0.72
      );

    vignette.addColorStop(
      0.00,
      "rgba(0,0,0,0)"
    );

    vignette.addColorStop(
      0.68,
      "rgba(0,0,0,0.04)"
    );

    vignette.addColorStop(
      1.00,
      "rgba(0,0,0,0.58)"
    );

    ctx.fillStyle = vignette;
    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    const topLeft =
      ctx.createRadialGradient(
        0,
        0,
        0,
        0,
        0,
        width * 0.46
      );

    topLeft.addColorStop(
      0.00,
      "rgba(0,0,0,0.86)"
    );

    topLeft.addColorStop(
      1.00,
      "rgba(0,0,0,0)"
    );

    ctx.fillStyle = topLeft;
    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    return sourceCanvas;
  }

  function uploadSourceTexture(
    source,
    width,
    height
  ) {
    uniforms.textureWidth =
      width || 1137;

    uniforms.textureHeight =
      height || 540;

    gl.bindTexture(
      gl.TEXTURE_2D,
      texture
    );

    gl.pixelStorei(
      gl.UNPACK_FLIP_Y_WEBGL,
      true
    );

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source
    );

    textureReady = true;
    root.classList.add("webgl-ready");
  }

  let textureReady = false;

  if (sourceMode === "procedural") {
    const sourceCanvas =
      buildProceduralSourceCanvas();

    uploadSourceTexture(
      sourceCanvas,
      sourceCanvas.width,
      sourceCanvas.height
    );
  } else {
    const image = new Image();
    image.decoding = "async";
    image.src = "../../assets/identity/landing-opener-placeholder.webp?v=20261103-valid2";

    image.onload = () => {
      uploadSourceTexture(
        image,
        image.naturalWidth || 1137,
        image.naturalHeight || 540
      );
    };
  }

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
