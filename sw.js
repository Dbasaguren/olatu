// Service worker d'Olatu : l'appli s'ouvre même sans réseau, avec les dernières prévisions téléchargées.
// Changer VERSION à chaque mise en ligne pour forcer la mise à jour du cache.
const VERSION = "olatu-v3";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (données toujours fraîches), cache en secours (hors ligne)
async function networkFirst(req){
  const cache = await caches.open(VERSION);
  try{
    const res = await fetch(req);
    if(res.ok) cache.put(req, res.clone());
    return res;
  }catch(err){
    const hit = await cache.match(req, {ignoreSearch: req.mode === "navigate"});
    if(hit) return hit;
    throw err;
  }
}
// Cache d'abord pour les polices (elles ne changent jamais)
async function cacheFirst(req){
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  // Polices et bibliothèque Supabase (version figée) : ne changent jamais
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "cdn.jsdelivr.net") return e.respondWith(cacheFirst(req));
  if(url.origin === location.origin || url.hostname.endsWith("open-meteo.com")) return e.respondWith(networkFirst(req));
});
