/* ==========================================================================
   JOYCE.WORKS — REWIRED
   Scene D only.
   ========================================================================== */

(function () {
  "use strict";

  var ctaScene =
    document.querySelector("[data-cta-scene]");

  var ctaStage =
    ctaScene
      ? ctaScene.querySelector(".cta-stage")
      : null;

  if (!ctaScene || !ctaStage) return;

  var ctaFrame = null;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function renderCtaScene() {
    ctaFrame = null;

    var rect = ctaScene.getBoundingClientRect();
    var viewportHeight = window.innerHeight || 1;

    var scrollDistance =
      Math.max(1, ctaScene.offsetHeight - viewportHeight);

    var progress =
      clamp01((-rect.top) / scrollDistance);

    var hiddenFromTop =
      (1 - progress) * 100;

    var clipValue =
      "inset(" + hiddenFromTop + "% 0 0 0)";

    ctaStage.style.webkitClipPath = clipValue;
    ctaStage.style.clipPath = clipValue;
  }

  function requestCtaRender() {
    if (ctaFrame) return;

    ctaFrame =
      requestAnimationFrame(renderCtaScene);
  }

  window.addEventListener(
    "scroll",
    requestCtaRender,
    { passive: true }
  );

  window.addEventListener(
    "resize",
    requestCtaRender
  );

  renderCtaScene();
})();
