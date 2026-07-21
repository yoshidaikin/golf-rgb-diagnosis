const CACHE = "turf-rgb-v066-field-modes";
const ASSETS = ["./", "./index.html", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, {cache:"no-store"})
        .then(response => {
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put("./index.html",copy));
          return response;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }
  const url=new URL(request.url);
  if(url.pathname.endsWith("/app.js") || url.pathname.endsWith("/manifest.json") || url.pathname.endsWith("/sw.js")){
    event.respondWith(
      fetch(request,{cache:"no-store"})
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(request,copy));
          return response;
        })
        .catch(()=>caches.match(request))
    );
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
