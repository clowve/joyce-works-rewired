/* Staging-only helper: keep browser scroll restoration from making
   iterative animation tests look like layout regressions. */
(function () {
  "use strict";

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  window.addEventListener("load", function () {
    if (window.location.hash) return;

    window.requestAnimationFrame(function () {
      window.scrollTo(0, 0);
    });
  });
})();
