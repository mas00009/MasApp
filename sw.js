/* MásGains service worker - offline shell + runtime asset cache */
var VERSION = "mg-v8";
var CORE = [
  "./", "index.html", "manifest.webmanifest",
  "assets/icon.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-180.png",
  "assets/brand/badge-electric.png", "assets/brand/wordmark-electric.png",
  "assets/brand/badge-crimson.png", "assets/brand/wordmark-crimson.png",
  "assets/brand/badge-blue.png", "assets/brand/wordmark-blue.png",
  "assets/brand/badge-violet.png", "assets/brand/wordmark-violet.png",
  "assets/brand/badge-gold.png", "assets/brand/wordmark-gold.png",
  "assets/body-figure-male.png", "assets/body-figure-female.jpg"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(CORE).catch(function () {}); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // The HTML document: network-first so new versions show when online,
  // fall back to the cached shell when offline.
  if (req.mode === "navigate" || (url.origin === location.origin && url.pathname.endsWith("index.html"))) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put("index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("index.html").then(function (m) { return m || caches.match("./"); });
      })
    );
    return;
  }

  // Everything else (brand art, exercise images/gifs, fonts): serve from cache,
  // update it in the background (stale-while-revalidate).
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
