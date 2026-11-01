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

     The scene is 200dvh tall.
     Its stage remains sticky for 100dvh while the second state
     travels from 100% below the viewport to its resting position.

     This recreates the old card-to-card reveal without:
     - duplicate .gap elements
     - fixed wrapper copies
     - data-anchor-target
     - Skrollr
     ----------------------------------------------------------------------- */

  var identityScene =
    document.querySelector("[data-identity-scene]");

  var identityWipe =
    document.querySelector("[data-identity-wipe]");

  var identityWipeContent =
    document.querySelector("[data-identity-wipe-content]");

  if (
    !identityScene ||
    !identityWipe ||
    !identityWipeContent
  ) return;

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

    var maskTranslateY =
      (1 - progress) * 100;

    var contentTranslateY =
      -maskTranslateY;

    identityWipe.style.transform =
      "translate3d(0, " + maskTranslateY + "%, 0)";

    identityWipeContent.style.transform =
      "translate3d(0, " + contentTranslateY + "%, 0)";
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
