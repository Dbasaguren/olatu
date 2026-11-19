// Service worker d'Olatuak : l'appli s'ouvre même sans réseau, avec les dernières prévisions téléchargées.
// Changer VERSION à chaque mise en ligne qui touche ce fichier (les fichiers de /_astro/ ont déjà un nom unique par version).
const VERSION = "olatu-v41";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/favicon.png"];

// À l'installation : la page d'accueil, puis les scripts et styles qu'elle utilise (noms générés par Astro)
async function precache(){
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL);
  const html = await (await cache.match("/")).text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map(m => m[1]))];
  await cache.addAll(assets);
}
self.addEventListener("install", e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
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
    // no-cache : on redemande toujours au serveur si la page a changé (sinon le navigateur garde l'ancienne version 10 min)
    const res = await fetch(req, new URL(req.url).origin === location.origin ? {cache:"no-cache"} : {});
    if(res.ok) cache.put(req, res.clone());
    return res;
  }catch(err){
    const hit = await cache.match(req, {ignoreSearch: req.mode === "navigate"});
    if(hit) return hit;
    // Page de spot jamais ouverte hors ligne : l'accueil contient la même appli
    if(req.mode === "navigate"){ const home = await cache.match("/"); if(home) return home; }
    throw err;
  }
}
// Cache d'abord : polices, bibliothèques à version figée et fichiers /_astro/ (leur nom change à chaque version)
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
  if(url.origin === location.origin && url.pathname.startsWith("/_astro/")) return e.respondWith(cacheFirst(req));
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "cdn.jsdelivr.net" || url.hostname === "cdnjs.cloudflare.com") return e.respondWith(cacheFirst(req));
  if(url.origin === location.origin || url.hostname.endsWith("open-meteo.com") || url.hostname === "raw.githubusercontent.com") return e.respondWith(networkFirst(req));
});
