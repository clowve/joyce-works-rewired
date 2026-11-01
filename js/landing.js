/* ==========================================================================
   JOYCE.WORKS — REWIRED
   Native landing interaction.

   No Skrollr.
   Scroll choreography is introduced scene-by-scene.
   ========================================================================== */

(function () {
  "use strict";

  var menuToggle = document.getElementById("ShowMenu");
  var menu = document.getElementById("menu");

  /* -----------------------------------------------------------------------
     Persistent menu
     ----------------------------------------------------------------------- */

  if (menuToggle && menu) {
    menu.addEventListener("click", function (event) {
      var link = event.target.closest("a");

      if (!link) return;

      menuToggle.checked = false;
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;

      menuToggle.checked = false;
    });
  }

  /* -----------------------------------------------------------------------
     Scene A — identity

     The stage stays sticky while multiple stationary states are
     revealed by moving only their clipping edges.

     Each wipe declares its own start/end point across the scene:
     0.00 → 0.50 : psychedelic → black/pink wordmark
     0.50 → 1.00 : black/pink wordmark → portrait mask

     This recreates the old card-to-card reveal without:
     - duplicate .gap elements
     - fixed wrapper copies
     - data-anchor-target
     - Skrollr
     ----------------------------------------------------------------------- */

  var identityScene =
    document.querySelector("[data-identity-scene]");

  var identityWipes =
    Array.prototype.slice.call(
      document.querySelectorAll("[data-identity-wipe]")
    );

  if (!identityScene || !identityWipes.length) return;

  var identityFrame = null;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function renderIdentityScene() {
    identityFrame = null;

    var rect = identityScene.getBoundingClientRect();
    var viewportHeight = window.innerHeight || 1;

    var scrollDistance =
      Math.max(1, identityScene.offsetHeight - viewportHeight);

    var progress =
      clamp01((-rect.top) / scrollDistance);

    identityWipes.forEach(function (wipe) {
      var start =
        parseFloat(wipe.getAttribute("data-wipe-start")) || 0;

      var end =
        parseFloat(wipe.getAttribute("data-wipe-end")) || 1;

      var localProgress =
        clamp01((progress - start) / Math.max(0.0001, end - start));

      var hiddenFromTop =
        (1 - localProgress) * 100;

      var clipValue =
        "inset(" + hiddenFromTop + "% 0 0 0)";

      wipe.style.webkitClipPath = clipValue;
      wipe.style.clipPath = clipValue;
    });
  }

  function requestIdentityRender() {
    if (identityFrame) return;

    identityFrame =
      requestAnimationFrame(renderIdentityScene);
  }

  window.addEventListener(
    "scroll",
    requestIdentityRender,
    { passive: true }
  );

  window.addEventListener(
    "resize",
    requestIdentityRender
  );

  renderIdentityScene();
})();
