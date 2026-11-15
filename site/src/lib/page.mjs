// site/src/lib/page.mjs — one mount per host, across every navigation.
//
// Why this file has to exist. Astro's router swaps the body of the document and then decides which
// scripts to hand back to the browser, in astro/dist/transitions/swap-functions.js:
//
//   function detectScriptExecuted(script) {
//     const key = script.src ? new URL(script.src, location.href).href : script.textContent;
//     if (scriptsAlreadyRan.has(key)) return true;
//     scriptsAlreadyRan.add(key);
//     return false;
//   }
//   …
//   if (!s.hasAttribute("data-astro-rerun") && detectScriptExecuted(s)) s.dataset.astroExec = "";
//
// Every component here ships its client code as a hoisted module with a stable URL, so after the first
// navigation the key already exists and the incoming copy is stamped `data-astro-exec` — which means it
// never evaluates again. The naive expectation ("the new page runs its own scripts") is wrong in the
// direction that matters: click / → /menu and the menu explorer arrives as dead markup, because nothing
// initialises it a second time. `data-astro-rerun` is not the answer either; it re-evaluates the whole
// module, and every `document.addEventListener` inside it then binds a second copy of itself.
//
// So the rule this module enforces: code evaluates once, and the work is driven by events instead.
//
//   component(host, { mount, unmount })  — exactly one live instance per matching element, re-checked on
//                                          every swap. Use this for anything that owns a loop, a WebGL
//                                          context, or a listener: the door, the cursor, the dial, the
//                                          two islands. `host` may be a selector or a finder function.
//                                          Identity is the element, not its absence: a router swap does
//                                          not take the old body out and put the new one in as two
//                                          observable steps — after-swap fires once, with the incoming
//                                          document already installed. So "the element I mounted is not
//                                          the element at this selector now" is the disposal trigger, and
//                                          a rule that waited for `find()` to return null would leave the
//                                          instance wired to a detached node: a dead explorer one click
//                                          after it worked.
//   collection(host, { mount, unmount })  — the same contract for a host that appears more than once on a
//                                          page. The home hero carries a compact dial and the rig section
//                                          a full one, so a primitive that could only track one element
//                                          would leave the second dead or, worse, wire both to one
//                                          instance. Identity is the element, so a node that survives a
//                                          swap via `data-astro-transition-persist` is not remounted.
//   onPage(fn)                           — for rescans only. It calls fn once now and again on each page
//                                          load, so fn will run twice on the very first load whenever this
//                                          module evaluates before the router fires. That is a deliberate
//                                          trade: waiting for the event alone is what breaks lazily
//                                          fetched code. A rescan is cheap and idempotent (the reveal
//                                          observer keeps a WeakSet precisely so a second pass is a no-op);
//                                          anything with a teardown cost belongs in `component`.
//
// The lifecycle is bound to an injected document so tests/run.mjs can drive a fake one. Nothing in here
// touches the network, a timer, or a browser API beyond addEventListener/querySelector.

export function createPage(doc) {
  const loaders = new Set();
  const syncers = new Set();
  let wired = false;

  function wire() {
    if (wired) return;
    // One pair of listeners, however many components register. Each listener bound twice would mount
    // nothing twice — `inst` guards that — but it would also mean N handlers doing the same sweep,
    // which is precisely the kind of invisible extra work the frame-cost gate in verify-runtime.mjs
    // exists to catch.
    wired = true;
    doc.addEventListener("astro:page-load", () => {
      for (const fn of loaders) fn();
      for (const sync of syncers) sync();
    });
    // after-swap, not before: disposal has to be decided against the DOM that is now on screen, and the
    // incoming document has not been installed yet when before-swap fires.
    doc.addEventListener("astro:after-swap", () => {
      for (const sync of syncers) sync();
    });
  }

  function onPage(fn) {
    wire();
    loaders.add(fn);
    fn();
    return fn;
  }

  function component(host, { mount, unmount }) {
    wire();
    const find = typeof host === "function" ? host : () => doc.querySelector(host);
    // A wrapper object, not the instance: `mount` may legitimately return nothing, and `null`/`false`
    // as "not mounted" would then read as already-mounted or not, depending on what the author returned.
    // It carries `el` as well as `api` because the element is the thing that has to be compared — see the
    // header. Without it, a swap that replaces the host reads as "still there" and the old instance keeps
    // serving a node that is no longer in the document.
    let inst = null;

    const sync = () => {
      const el = find();
      if (inst !== null && inst.el === el) return;
      const previous = inst;
      inst = null;
      // Released before the replacement is built, for the same reason `collection` orders it that way:
      // on the door those two operations are "dispose a WebGL context" and "create one", and the peak has
      // to stay at one context on exactly the devices lib/gate.mjs exists to protect.
      if (previous && unmount) unmount(previous.api);
      if (el) inst = { el, api: mount(el) };
    };

    syncers.add(sync);
    sync();
    return { sync, isLive: () => inst !== null, instance: () => inst && inst.api, host: () => inst && inst.el };
  }

  function collection(host, { mount, unmount }) {
    wire();
    const findAll = typeof host === "function" ? host : () => Array.from(doc.querySelectorAll(host));
    // Keyed by element rather than by index: two dials swapping places between pages is a rename under an
    // index key and a no-op under an element key, and the element key is the one that matches what the
    // browser actually did to the DOM.
    const live = new Map();

    const sync = () => {
      const found = findAll();
      const list = found ? (Array.isArray(found) ? found : [found]) : [];
      const present = new Set(list);
      // Dispose before mounting. A swap from one WebGL host to another is the case this ordering is for:
      // releasing the old context first means the peak is one context, not two, on exactly the devices the
      // gate in lib/gate.mjs exists to protect.
      for (const [el, inst] of Array.from(live)) {
        if (present.has(el)) continue;
        live.delete(el);
        if (unmount) unmount(inst.api);
      }
      for (const el of list) {
        if (!live.has(el)) live.set(el, { api: mount(el) });
      }
    };

    syncers.add(sync);
    sync();
    return { sync, size: () => live.size, instances: () => Array.from(live.values(), (i) => i.api) };
  }

  return { onPage, component, collection, wired: () => wired };
}

let shared = null;
const singleton = () => (shared ??= createPage(document));

export const onPage = (...args) => singleton().onPage(...args);
export const component = (...args) => singleton().component(...args);
export const collection = (...args) => singleton().collection(...args);
