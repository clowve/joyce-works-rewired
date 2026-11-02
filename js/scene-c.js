/* ==========================================================================
   JOYCE.WORKS — REWIRED
   Scene C only.
   ========================================================================== */

(function () {
  "use strict";

  var clientsScene =
    document.querySelector("[data-clients-scene]");

  var clientsStage =
    clientsScene
      ? clientsScene.querySelector(".clients-stage")
      : null;

  if (!clientsScene || !clientsStage) return;

  var clientsFrame = null;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function renderClientsScene() {
    clientsFrame = null;

    var rect = clientsScene.getBoundingClientRect();
    var viewportHeight = window.innerHeight || 1;

    var scrollDistance =
      Math.max(1, clientsScene.offsetHeight - viewportHeight);

    var progress =
      clamp01((-rect.top) / scrollDistance);

    /*
      Scene C is 300dvh:
      first 100dvh = wipe in over held Art
      next 100dvh = fully settled Clients card
    */
    var entranceProgress =
      clamp01(progress / 0.5);

    var hiddenFromTop =
      (1 - entranceProgress) * 100;

    if (entranceProgress > 0 && entranceProgress < 1) {
      hiddenFromTop =
        Math.max(0, hiddenFromTop - (100 / viewportHeight));
    }

    var clipValue =
      "inset(" + hiddenFromTop + "% 0 0 0)";

    clientsStage.style.webkitClipPath = clipValue;
    clientsStage.style.clipPath = clipValue;
  }

  function requestClientsRender() {
    if (clientsFrame) return;

    clientsFrame =
      requestAnimationFrame(renderClientsScene);
  }

  window.addEventListener(
    "scroll",
    requestClientsRender,
    { passive: true }
  );

  window.addEventListener(
    "resize",
    requestClientsRender
  );

  renderClientsScene();
})();
