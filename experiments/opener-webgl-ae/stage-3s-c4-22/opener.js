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
          : soloMode === "blue-runner"
            ? 4
            : soloMode === "blue-fan"
              ? 5
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

    float fannedStripeField(
      float x,
      float motion
    ) {
      /*
        Stage 3S-C.4.22:
        logarithmic blue-fan source moved to the left canvas edge so the
        convergence / middle no longer sits visibly inside the frame.
      */
      const float sourceOriginX = 0.00;

      float d =
        max(
          abs(
            x -
            sourceOriginX
          ),
          0.0007
        );

      float zoomCoord =
        log2(d) *
        1.72 -
        motion;

      float cell =
        fract(
          zoomCoord
        );

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

    vec2 chromaticFunhouseRight(
      vec2 uv,
      float phase,
      float motion
    ) {
      /*
        Stronger Stage-3.16-style right-side mirror warp.
        Kept separate from restrainedRightWarp so C.1 geometry stays frozen.
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

    vec3 screenBlend(
      vec3 base,
      vec3 blend
    ) {
      return
        1.0 -
        (
          1.0 -
          clamp(
            base,
            0.0,
            1.0
          )
        ) *
        (
          1.0 -
          clamp(
            blend,
            0.0,
            1.0
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
        Positive time advances the bands toward the left.
      */
      float coord =
        (
          uv.x -
          uv.y * 0.34
        ) * 6.10 +
        motion * 1.08 +
        phase;

      float cell =
        fract(coord);

      return
        smoothstep(
          0.07,
          0.09,
          cell
        ) *
        (
          1.0 -
          smoothstep(
            0.56,
            0.59,
            cell
          )
        );
    }

    float syncedFunhouseRipple(
      vec2 uv,
      float motion,
      float phase
    ) {
      /*
        Phase-locked funhouse distortion of the black /// runner.

        Same timing, but the sampling geometry pinches / bulges row by row
        so the runner and ripple can visually morph into one another.
      */
      vec2 q = uv;

      float leftWeight =
        1.0 -
        smoothstep(
          0.30,
          0.80,
          uv.x
        );

      float rowMagnification =
        1.0 +
        leftWeight *
        (
          sin(
            uv.y * 5.6 -
            motion * 1.34 +
            phase
          ) * 0.32 +
          sin(
            uv.y * 11.2 +
            motion * 0.76 +
            phase * 1.65
          ) * 0.12
        );

      rowMagnification =
        clamp(
          rowMagnification,
          0.68,
          1.38
        );

      const float pivotX = 0.18;

      q.x =
        pivotX +
        (
          q.x -
          pivotX
        ) /
        rowMagnification;

      q.x +=
        sin(
          uv.y * 17.0 -
          motion * 2.02 +
          phase
        ) *
        0.022 *
        leftWeight;

      q.x +=
        sin(
          uv.y * 31.0 +
          motion * 1.14 +
          phase * 1.8
        ) *
        0.008 *
        leftWeight;

      return
        leftSlashBars(
          q,
          motion,
          phase
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
        Stage 3S-C.4.22:
        restore ONE missing chromatic plane from Stage 3.16:
        the independently warped BLUE fan.

        This is deliberately separate from the softened \\\ mask.
      */
      /*
        Stage 3S-C.4.22:
        the entire angled blue fan plane runs at 1.5x its previous speed.
        Keep its warp, fine ripple, and logarithmic stripe travel locked
        together by driving all three from the same accelerated motion.
      */
      float blueFanMotion =
        motion * 1.50;

      vec2 blueFanUV =
        cornerPinApprox(
          v_uv,
          -0.035,
          0.115,
          1.16,
          0.86
        );

      blueFanUV =
        chromaticFunhouseRight(
          blueFanUV,
          2.4,
          blueFanMotion
        );

      blueFanUV.x +=
        sin(
          blueFanUV.y * 17.0 -
          blueFanMotion * 1.55 +
          2.4
        ) *
        0.0032;

      float blueFanStripe =
        fannedStripeField(
          blueFanUV.x +
          0.026,
          blueFanMotion -
          0.024
        );

      /*
        Stage 3S-C.4.22:
        add the full-width black /// runner and its phase-locked funhouse
        copy. Neither has a left cutoff.
      */
      const float darkRunnerPhase = 2.34;

      float blackRunnerMask =
        leftSlashBars(
          v_uv,
          motion,
          darkRunnerPhase
        );

      /*
        Stage 3S-C.4.22:
        apex behavior belongs ONLY to the black ripple.

        Left side:
        original /// ripple behavior.

        Right side:
        mirrored sampling around the apex keeps the opposite slant/direction,
        but uses the CLEAN straight-bar source instead of the ripple.

        The straight black /// runner above remains completely normal.
      */
      const float darkRippleApexX = 0.80;

      /*
        Left side keeps the funhouse ripple, now at 3x speed.
      */
      float blackRippleLeftMask =
        syncedFunhouseRipple(
          v_uv,
          motion * 3.0,
          darkRunnerPhase
        );

      /*
        Right side keeps the mirrored opposite-direction geometry,
        but drops the ripple distortion completely.

        C.4.16 promotes ONLY this mirrored right piece to the foreground,
        so it is no longer folded into the background dark-system mask.
      */
      vec2 mirroredRightUV =
        v_uv;

      mirroredRightUV.x =
        2.0 * darkRippleApexX -
        mirroredRightUV.x;

      /*
        Stage 3S-C.4.22:
        nudge ONLY the mirrored right apex foreground piece downward by
        ~15% of canvas height to realign it with the left-side structure.
      */
      mirroredRightUV.y +=
        0.15;

      float blackRightCleanMask =
        leftSlashBars(
          mirroredRightUV,
          motion,
          darkRunnerPhase
        );

      float darkRippleSideBlend =
        smoothstep(
          0.77,
          0.81,
          v_uv.x
        );

      /*
        Stage 3S-C.4.22:
        keep the long gradual left->right transparency ramp from C.4.19,
        then introduce an additional MID-SECTION translucency treatment.

        The ripple remains close to its current strength on the left.
        Across the middle, it becomes much more ghosted / semi-transparent.
        The separate blue-intersection pass below will selectively restore
        black only where this ripple actually crosses visible blue stripes.
      */
      float blackRippleTransparencyRamp =
        mix(
          0.34,
          1.0,
          1.0 -
          smoothstep(
            0.20,
            0.92,
            v_uv.x
          )
        );

      float blackRippleMiddleZone =
        smoothstep(
          0.24,
          0.38,
          v_uv.x
        ) *
        (
          1.0 -
          smoothstep(
            0.66,
            0.82,
            v_uv.x
          )
        );

      float blackRippleMiddleOpacity =
        mix(
          1.0,
          0.30,
          blackRippleMiddleZone
        );

      /*
        Background ripple contains only the left rippled half, retaining
        the existing broad transparency ramp plus the new middle ghosting.
      */
      float blackRippleMask =
        blackRippleLeftMask *
        (
          1.0 -
          darkRippleSideBlend
        ) *
        blackRippleTransparencyRamp *
        blackRippleMiddleOpacity;

      float blackRightForegroundMask =
        blackRightCleanMask *
        darkRippleSideBlend;

      /*
        Stage 3S-C.4.22:
        add the clean BLUE /// << companion.

        It shares the same overall leftward family, but has its own phase
        and a fixed left cutoff so it never invades the extreme-left dark
        territory. No ripple on this layer.
      */
      const float blueRunnerPhase = 0.72;

      float blueRunnerMask =
        leftSlashBars(
          v_uv,
          motion,
          blueRunnerPhase
        );

      float blueRunnerCutoff =
        smoothstep(
          0.18,
          0.22,
          v_uv.x
        );

      blueRunnerMask *=
        blueRunnerCutoff;

      /*
        Stage 3S-C.4.22 — REGION-COLOURED BAR.

        The persistent artwork stays untouched.

        The moving mask now owns a BAR APPEARANCE chosen by the territory
        underneath it:
        - magenta -> saturated red bar
        - cobalt  -> electric-blue bar
        - black   -> leave the supplied black territory untouched

        This fixes the previous "bar looks underneath cobalt" behavior.
      */
      vec3 magentaBarColor =
        vec3(
          0.92,
          0.018,
          0.055
        );

      vec3 cobaltBarColor =
        vec3(
          0.045,
          0.46,
          0.92
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
          magentaRegion * 0.50 +
          cobaltRegion * 0.56
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
        Preserve the exact supplied black territory as the persistent base.
        The black /// system will merge into / extend that darkness later.
      */
      interaction =
        mix(
          interaction,
          baseColor,
          blackRegion
        );

      /*
        RESTORED FANNED BLUE CHROMATIC PLANE
        -------------------------------------

        Use the old electric-blue tint, but do NOT merely add it to
        magenta. Partially preserve the moving plane's own low-red colour
        before blending with the exact static base. This is what lets the
        restored plane read BLUE instead of lavender.

        It is masked out of the persistent black territory.
      */
      vec3 blueFanColor =
        vec3(
          0.035,
          0.23,
          1.00
        );

      vec3 blueFanScreened =
        1.0 -
        (
          1.0 -
          clamp(
            interaction,
            0.0,
            1.0
          )
        ) *
        (
          1.0 -
          blueFanColor
        );

      float centerBlueBias =
        smoothstep(
          0.18,
          0.36,
          v_uv.x
        ) *
        (
          1.0 -
          smoothstep(
            0.70,
            0.88,
            v_uv.x
          )
        );

      vec3 blueFanTarget =
        mix(
          blueFanColor,
          blueFanScreened,
          0.24
        );

      float blueFanOpacity =
        blueFanStripe *
        (
          magentaRegion * 0.86 +
          cobaltRegion * 0.50
        ) *
        mix(
          1.0,
          1.30,
          centerBlueBias
        );

      vec3 fanInteraction =
        mix(
          interaction,
          blueFanTarget,
          clamp(
            blueFanOpacity,
            0.0,
            1.0
          )
        );

      fanInteraction =
        mix(
          fanInteraction,
          interaction,
          blackRegion
        );

      /*
        CLEAN BLUE /// INTERACTION
        --------------------------------
        This is intentionally quieter than the dominant black/ripple
        system and sits UNDER it in the stack.

        It behaves like a blue-light treatment rather than a solid cyan
        slab. The fixed left cutoff remains intact.
      */
      /*
        Stage 3S-C.4.22:
        the clean blue /// runner is now a CHROMATIC PLANE, not an
        additive highlight.

        Mixing toward a dense cobalt target prevents the old
        magenta + blue-light = pale lavender/cyan wash.
      */
      /*
        Stage 3S-C.4.22:
        pull the CLEAN blue /// << runner out of the middle of the stack.

        We only prepare its colour/mask here. It will be composited later,
        AFTER the black runner/ripple system, so it behaves as a genuine
        foreground optical layer.

        The fanned blue chromatic plane above stays embedded underneath.
      */
      vec3 blueRunnerColor =
        vec3(
          0.018,
          0.18,
          0.96
        );

      vec3 blueRunnerCobaltColor =
        vec3(
          0.02,
          0.24,
          1.00
        );

      vec3 blueRunnerTarget =
        mix(
          blueRunnerColor,
          blueRunnerCobaltColor,
          cobaltRegion
        );

      float blueRunnerOpacity =
        blueRunnerMask *
        (
          magentaRegion * 0.78 +
          cobaltRegion * 0.62
        ) *
        mix(
          1.0,
          1.12,
          centerBlueBias
        );

      float rightDetailMask =
        smoothstep(
          0.70,
          0.84,
          v_uv.x
        ) *
        cobaltRegion;

      /*
        BLACK /// INTERACTION MAP

        Runner behavior:
        - over magenta -> strong dark / near-black structural band
        - over cobalt  -> deep navy / near-black blue
        - over the existing black triangle -> visually merges into black

        The ripple uses the SAME interaction colors and phase, only a
        distorted mask.
      */
      vec3 darkRunnerColor =
        magentaRegion *
        vec3(
          0.010,
          0.004,
          0.020
        ) +
        cobaltRegion *
        vec3(
          0.008,
          0.035,
          0.110
        ) +
        blackRegion *
        vec3(0.0);

      /*
        Stage 3S-C.4.22 — ONE MORPHING DARK SYSTEM

        Stop compositing clean runner + ripple as two separate stripe
        families. Instead, interpolate them into one mask.

        Ripple dominates the visible form; the clean runner is only a faint
        structural spine that comes and goes inside the same system.
      */
      float morphAmount =
        clamp(
          0.82 +
          sin(
            v_uv.y * 4.4 -
            motion * 0.34 +
            v_uv.x * 1.25
          ) * 0.10,
          0.72,
          0.92
        );

      /*
        Stage 3S-C.4.22:
        preserve the existing ONE morphing dark-system animation, but track
        how much of that local shape comes from the straight runner versus
        the fast ripple.

        This lets us recolor ONLY the ripple contribution without turning
        the straight black runner blue.
      */
      float darkRunnerComponent =
        blackRunnerMask *
        (
          1.0 -
          morphAmount
        );

      float darkRippleComponent =
        blackRippleMask *
        morphAmount;

      float darkMorphMask =
        darkRunnerComponent +
        darkRippleComponent;

      float darkRippleShare =
        clamp(
          darkRippleComponent /
          max(
            darkMorphMask,
            0.0001
          ),
          0.0,
          1.0
        );

      /*
        Exact requested ripple source color: #000092.
        Straight-runner contribution keeps the existing dark/black color.
      */
      vec3 darkRippleBlue =
        vec3(
          0.0,
          0.0,
          0.57255
        );

      vec3 darkSystemColor =
        mix(
          darkRunnerColor,
          darkRippleBlue,
          darkRippleShare
        );

      /*
        Break the clean regularity further without introducing another
        moving stripe family: the whole dark system subtly breathes in
        strength across the frame.
      */
      float darkPresence =
        0.92 +
        0.08 *
        (
          0.5 +
          0.5 *
          sin(
            v_uv.y * 3.1 +
            v_uv.x * 1.8 -
            motion * 0.22
          )
        );

      darkMorphMask *=
        darkPresence;

      float darkMorphOpacity =
        darkMorphMask *
        (
          magentaRegion * 0.96 +
          cobaltRegion * 0.90 +
          blackRegion * 0.99
        );

      float centerBlueRelief =
        1.0 -
        centerBlueBias *
        (
          magentaRegion * 0.10 +
          cobaltRegion * 0.14
        );

      darkMorphOpacity *=
        centerBlueRelief;

      vec3 darkInteraction =
        mix(
          fanInteraction,
          darkSystemColor,
          clamp(
            darkMorphOpacity,
            0.0,
            1.0
          )
        );

      /*
        FOREGROUND BLUE /// SCREEN PASS
        -------------------------------

        The clean blue runner now truly sits above the entire dark composite,
        including the supplied black triangle.

        Screen makes the layer read more like luminous/translucent material
        on the surface rather than another embedded colour mix.
      */
      vec3 blueForegroundBase =
        screenBlend(
          clamp(
            darkInteraction,
            0.0,
            1.0
          ),
          blueRunnerTarget
        );

      /*
        Give the screen pass enough punch to remain visibly distinct from
        the embedded blue fan and the cobalt base.
      */
      vec3 blueForegroundTreatment =
        mix(
          blueForegroundBase,
          clamp(
            blueForegroundBase *
            1.12,
            0.0,
            1.0
          ),
          0.22
        );

      /*
        Preserve the brighter / glassier far-right cobalt recovery, but
        apply it after the foreground Screen treatment.
      */
      vec3 blueForegroundRightDetail =
        clamp(
          (
            blueForegroundTreatment -
            vec3(0.16)
          ) *
          1.16 +
          vec3(0.20),
          0.0,
          1.0
        );

      blueForegroundTreatment =
        mix(
          blueForegroundTreatment,
          blueForegroundRightDetail,
          rightDetailMask *
          0.50
        );

      /*
        True foreground opacity:
        unlike C.4.13, blackRegion is explicitly INCLUDED rather than
        suppressing the layer. This lets the clean blue runner cross over
        the left black triangle as a visible translucent foreground pass.
      */
      float blueForegroundOpacity =
        clamp(
          blueRunnerMask *
          (
            magentaRegion * 0.90 +
            cobaltRegion * 0.84 +
            blackRegion * 0.74
          ) *
          mix(
            1.04,
            1.14,
            centerBlueBias
          ),
          0.0,
          0.96
        );

      vec3 color =
        mix(
          darkInteraction,
          blueForegroundTreatment,
          blueForegroundOpacity
        );

      /*
        MID-SECTION RIPPLE × BLUE INTERSECTION
        --------------------------------------

        The fast black ripple is deliberately translucent in the middle.
        Only where that ripple crosses one of the two blue systems do we
        reintroduce a strong black hit.

        This pass happens AFTER the blue Screen foreground treatment, so
        the crossings can genuinely read black instead of merely sitting
        beneath the blue. It happens BEFORE the mirrored-right apex pass,
        preserving that piece as the absolute foreground.
      */
      float visibleBlueOverlapMask =
        max(
          blueRunnerMask,
          blueFanStripe
        );

      float blackRippleBlueIntersection =
        blackRippleLeftMask *
        visibleBlueOverlapMask *
        blackRippleMiddleZone *
        (
          1.0 -
          darkRippleSideBlend
        );

      color =
        mix(
          color,
          vec3(0.0),
          clamp(
            blackRippleBlueIntersection *
            0.86,
            0.0,
            0.86
          )
        );

      /*
        Stage 3S-C.4.22:
        BLUE \\\ >> × BLUE-LINE COLLISION
        ------------------------------------

        The region-aware \\\ >> bar stays red over magenta and blue over
        cobalt. Inside the cobalt territory ONLY, detect where that blue
        bar crosses either of the two visible blue-line systems.

        Those overlap pixels get their own black hit, mirroring the
        interaction logic used for the fast black ripple above.
      */
      float blueBackslashBlueIntersection =
        mask *
        cobaltRegion *
        visibleBlueOverlapMask;

      color =
        mix(
          color,
          vec3(0.0),
          clamp(
            blueBackslashBlueIntersection *
            0.88,
            0.0,
            0.88
          )
        );

      /*
        ABSOLUTE FOREGROUND: MIRRORED RIGHT APEX ONLY
        ----------------------------------------------

        Stage 3S-C.4.22:
        simplify this piece back to black, but at ~40% opacity so it remains
        clearly foregrounded without reading as a heavy graphic slab.
      */
      float blackRightForegroundOpacity =
        clamp(
          blackRightForegroundMask *
          0.40,
          0.0,
          0.40
        );

      color =
        mix(
          color,
          vec3(0.0),
          blackRightForegroundOpacity
        );

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
        2.5 &&
        u_debugView <
        3.5
      ) {
        color =
          magentaRegion * vec3(1.0, 0.0, 0.55) +
          cobaltRegion * vec3(0.0, 0.35, 1.0) +
          blackRegion * vec3(0.0);
      } else if (
        u_debugView >
        3.5 &&
        u_debugView <
        4.5
      ) {
        color =
          mix(
            baseColor,
            vec3(
              0.018,
              0.18,
              0.96
            ),
            blueRunnerMask *
            0.82
          );
      } else if (
        u_debugView >
        4.5
      ) {
        color =
          mix(
            baseColor,
            blueFanColor,
            blueFanStripe *
            (
              1.0 -
              blackRegion
            )
          );
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
      "[JOYCE reconstruction / Stage 3S-B] WebGL failed:",
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
