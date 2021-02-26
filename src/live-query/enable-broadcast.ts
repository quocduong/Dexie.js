import { globalEvents } from "../globals/global-events";
import { propagateLocally, propagatingLocally } from "./propagate-locally";

if (typeof BroadcastChannel !== "undefined") {
  const bc = new BroadcastChannel("dexie-txcommitted");

  //
  // Propagate local changes to remote tabs, windows and workers via BroadcastChannel
  //
  globalEvents("txcommitted", (changedParts) => {
    if (!propagatingLocally) {
      bc.postMessage(changedParts);
    }
  });

  //
  // Propagate remote changes locally via storage event:
  //
  bc.onmessage = (ev) => {
    if (ev.data) propagateLocally(ev.data);
  };
} else if (typeof self !== "undefined" && typeof navigator !== "undefined") {
  // DOM verified - when typeof self !== "undefined", we are a window or worker. Not a Node process.

  // Once wait for service worker registration and keep a lazy reference to it.
  const swHolder: {registration?: ServiceWorkerRegistration} = {};
  const swContainer = self.document && navigator.serviceWorker; // self.document is to verify we're not the SW ourself
  if (swContainer) swContainer.ready.then(registration => swHolder.registration = registration);

  //
  // Propagate local changes to remote tabs/windows via storage event and service worker
  // via messages. We have this code here because of https://bugs.webkit.org/show_bug.cgi?id=161472.
  //
  globalEvents("txcommitted", (changedParts) => {
    try {
      if (!propagatingLocally) {
        if (typeof localStorage !== "undefined") {
          // We're a browsing window or tab. Propagate to other windows/tabs via storage event:
          localStorage.setItem(
            "dexie-txcommitted",
            JSON.stringify({
              trig: Math.random(),
              changedParts,
            })
          );
        }
        if (self.document) {
          // We're a browser window...
          if (swHolder.registration) {
            // ...and there's a service worker ready. Propagate to service worker:
            swHolder.registration.active.postMessage({
              type: "dexie-txcommitted",
              changedParts,
            });
          }
        } else if (typeof self["clients"] === "object") {
          // We're a service worker. Propagate to our browser clients.
          [...self["clients"].matchAll({ includeUncontrolled: true })].forEach(
            (client) =>
              client.postMessage({
                type: "dexie-txcommitted",
                changedParts,
              })
          );
        }
      }
    } catch {}
  });

  //
  // Propagate remote changes locally via storage event:
  //
  addEventListener("storage", (ev: StorageEvent) => {
    if (ev.key === "dexie-txcommitted") {
      const data = JSON.parse(ev.newValue);
      if (data) propagateLocally(data.changedParts);
    }
  });

  //
  // Propagate messages from service worker
  //
  if (swContainer) {
    // We're a browser window and want to propagate message from the SW:
    swContainer.addEventListener('message', propagateMessageLocally);
  } else if (!self.document) {
    // We're the SW and want to propagate messages from our clients
    self.addEventListener('message', propagateMessageLocally);
  }
}

function propagateMessageLocally({data}: MessageEvent) {
  if (data && data.type === "dexie-txcommitted") {
    propagateLocally(data.changedParts);
  }
}
