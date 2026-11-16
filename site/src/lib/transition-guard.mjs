// site/src/lib/transition-guard.mjs — the one rejection a guest's impatience is allowed to make.
//
// What this is for. `<ClientRouter />` (layouts/Base.astro) makes a click a swap instead of a reload, and
// it implements the swap with the browser's View Transitions API. When a second navigation begins while the
// first transition is still painting, the router aborts the old one — astro/dist/transitions/router.js:
//
//   mostRecentTransition.viewTransition.skipTransition();          // line 310
//   …
//   currentTransition.viewTransition?.finished.finally(() => {     // line 359
//
// `skipTransition()` rejects the transition's `finished` promise with an `AbortError` ("Transition was
// skipped. skipTransition() called"), and `.finally()` hands that rejection to a derived promise nobody
// awaits. The rejection is therefore unhandled, and Chrome reports it as an uncaught error.
//
// It is not a broken swap. Measured, not assumed (the probe in this project's scratch directory, and the
// same behaviour `scripts/verify-runtime.mjs` catches): the incoming document is installed, the update
// callback resolves, `astro:page-load` fires, and the guest lands where they tapped — the transition was
// skipped, which is exactly what "the visitor changed their mind mid-animation" is supposed to do. What is
// broken is that the router never attaches a handler to a promise it knows can reject. That is upstream's
// omission, so the fix has to live here and be honest about being a listener rather than a repair.
//
// Why a listener beats the obvious alternative. Attaching our own `.catch()` to `finished` — or shadowing
// the property with an already-handled promise, or wrapping `Document.prototype.startViewTransition` —
// leaves the rejection in place: it is the promise Astro derives with `.finally()` that goes unhandled, and
// a handler on the source cannot reach it. Cancelling the `unhandledrejection` event does work, and it is
// the only mechanism here that is not fighting the browser's own reporting.
//
// The narrowness is the safety of this file. `scripts/verify-runtime.mjs` fails the build on any uncaught
// exception, and a guard that swallowed broadly would turn that gate off. So it matches the abort by name
// *and* message, and it is tested both ways in `tests/run.mjs`: a `TypeError`, and the other AbortError a
// page of ours can produce (a superseded `fetch`, whose message is "The user aborted a request."), pass
// straight through untouched.

const SKIPPED = "Transition was skipped";

export function isSkippedTransition(reason) {
  return (
    typeof reason === "object" &&
    reason !== null &&
    reason.name === "AbortError" &&
    typeof reason.message === "string" &&
    reason.message.includes(SKIPPED)
  );
}

// Idempotent by design: module bodies here evaluate once per document (lib/page.mjs explains the
// `data-astro-exec` dedupe), but a guard bound twice is a listener that runs twice per rejection for no
// benefit. Returns true when this call is the one that installed it.
export function installTransitionGuard(scope = globalThis) {
  if (scope.__hhTransitionGuard) return false;
  scope.__hhTransitionGuard = true;
  scope.addEventListener("unhandledrejection", (event) => {
    if (isSkippedTransition(event.reason)) event.preventDefault();
  });
  return true;
}
