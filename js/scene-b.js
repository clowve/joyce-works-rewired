/* ==========================================================================
   JOYCE.WORKS — REWIRED
   Scene B only. Kept separate so Scene A remains frozen.
   ========================================================================== */

(function () {
  "use strict";

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  /* -----------------------------------------------------------------------
     Scene B — disciplines

     The rail and outline mark stay fixed on the artboard.
     Advertising, Strategy and Art reveal upward one panel at a time.
     ----------------------------------------------------------------------- */

  var disciplinesScene =
    document.querySelector("[data-disciplines-scene]");

  var disciplinesStage =
    disciplinesScene
      ? disciplinesScene.querySelector(".disciplines-stage")
      : null;

  var disciplineWipes =
    Array.prototype.slice.call(
      document.querySelectorAll("[data-disciplines-wipe]")
    );

  var disciplinesFrame = null;

  function renderDisciplinesScene() {
    disciplinesFrame = null;

    if (!disciplinesScene || !disciplineWipes.length) return;

    var rect = disciplinesScene.getBoundingClientRect();
    var viewportHeight = window.innerHeight || 1;

    var scrollDistance =
      Math.max(1, disciplinesScene.offsetHeight - viewportHeight);

    var progress =
      clamp01((-rect.top) / scrollDistance);

    if (disciplinesStage) {
      var entranceProgress =
        clamp01(progress / 0.2);

      var entranceHidden =
        (1 - entranceProgress) * 100;

      if (entranceProgress > 0 && entranceProgress < 1) {
        entranceHidden =
          Math.max(0, entranceHidden - (100 / viewportHeight));
      }

      var entranceClip =
        "inset(" + entranceHidden + "% 0 0 0)";

      disciplinesStage.style.webkitClipPath = entranceClip;
      disciplinesStage.style.clipPath = entranceClip;
    }

    disciplineWipes.forEach(function (wipe) {
      var start =
        parseFloat(wipe.getAttribute("data-wipe-start")) || 0;

      var end =
        parseFloat(wipe.getAttribute("data-wipe-end")) || 1;

      var localProgress =
        clamp01((progress - start) / Math.max(0.0001, end - start));

      var hiddenFromTop =
        (1 - localProgress) * 100;

      if (localProgress > 0 && localProgress < 1) {
        hiddenFromTop =
          Math.max(0, hiddenFromTop - (100 / viewportHeight));
      }

      var clipValue =
        "inset(" + hiddenFromTop + "% 0 0 0)";

      wipe.style.webkitClipPath = clipValue;
      wipe.style.clipPath = clipValue;
    });
  }

  function requestDisciplinesRender() {
    if (disciplinesFrame) return;

    disciplinesFrame =
      requestAnimationFrame(renderDisciplinesScene);
  }

  window.addEventListener(
    "scroll",
    requestDisciplinesRender,
    { passive: true }
  );

  window.addEventListener(
    "resize",
    requestDisciplinesRender
  );

  renderDisciplinesScene();

})();
