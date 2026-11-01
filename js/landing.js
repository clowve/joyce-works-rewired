/* ==========================================================================
   JOYCE.WORKS — REWIRED
   Staging JS foundation.

   Keep this file intentionally small.
   Scroll choreography will be introduced scene-by-scene.
   ========================================================================== */

(function () {
  "use strict";

  var menuToggle = document.getElementById("ShowMenu");
  var menu = document.getElementById("menu");

  if (!menuToggle || !menu) return;

  /*
    Close the staging menu after choosing an in-page link.
    Tumblr migration can keep or remove this nicety later.
  */
  menu.addEventListener("click", function (event) {
    var link = event.target.closest("a");

    if (!link) return;

    menuToggle.checked = false;
  });

  /*
    Preserve the familiar ESC-to-close behaviour.
  */
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;

    menuToggle.checked = false;
  });
})();
