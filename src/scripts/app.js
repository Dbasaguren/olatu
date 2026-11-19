// Olatuak : interface de l'appli. Les calculs purs sont dans src/lib/ (testés par npm test).
import { createClient } from "@supabase/supabase-js";
import { SPOTS, CAMS, SWELL } from "../lib/spots.js";
import { TZ, H, tp, nowNaive, hhmm, dayKey, DAYS, card, toNaive } from "../lib/time.js";
import { DEG, norm, inArc, arcGap, arcMid, clamp, angDiff, windComp, similarity, ENERGY } from "../lib/physics.js";
import { TIDE, tideAt, tideSeries, extremes, coefsByDay } from "../lib/tide.js";
import { rgbAt, hslRgb } from "../lib/colors.js";
import { baseScore } from "../lib/score.js";
import { spotTitle, spotPath } from "../lib/spot-info.js";
// ---------- Spots (orientation = direction vers laquelle la plage fait face, en degrés) ----------
const WIND_MODELS = [
  {id:"meteofrance_arome_france_hd", name:"AROME HD", info:"Météo-France · 1,3 km · 2 jours"},
  {id:"meteofrance_arpege_europe",   name:"ARPEGE",   info:"Météo-France · 10 km · 4 jours"},
  {id:"icon_eu",                     name:"ICON-EU",  info:"DWD · 7 km · 5 jours"},
  {id:"ecmwf_ifs",                   name:"ECMWF IFS",info:"ECMWF · 9 km · 10 jours"},
  {id:"gfs_seamless",                name:"GFS",      info:"NOAA · 13–25 km · 10 jours"},
];
const WAVE_MODELS = [
  {id:"meteofrance_wave", name:"MFWAM",     info:"Météo-France"},
  {id:"ecmwf_wam025",     name:"ECMWF WAM", info:"ECMWF"},
  {id:"ncep_gfswave016",  name:"GFS-Wave",  info:"NOAA · comme Windguru"},
];
const PHONE = matchMedia("(max-width:640px)");

// ---------- Préférences (confort uniquement) ----------
function load(k, d){ try{ const v = localStorage.getItem("olatu."+k); return v==null?d:JSON.parse(v);}catch(e){return d;} }
function save(k, v){ try{ localStorage.setItem("olatu."+k, JSON.stringify(v)); }catch(e){} }
// Lignes du tableau de synthèse, regroupées par thème
const GROUPS = [
  {id:"surf",  name:"Surf",   rows:[["note","Note /10"]]},
  {id:"houle", name:"Houle",  rows:[["houle","Hauteur"],["periode","Période"],["dirhoule","Direction"],["energie","Énergie (kJ)"]]},
  {id:"vent",  name:"Vent",   rows:[["vent","Vent moyen"],["rafales","Rafales"],["dirvent","Direction (off / on)"]]},
  {id:"maree", name:"Marée",  rows:[["courbe","Courbe de marée"]]},
  {id:"fun",   name:"Fun",    rows:[["bicho","Bichomètre"]]},
];
const BLOCKS = [["wavecmp","Houle · comparaison des modèles"], ...WIND_MODELS.map(m=>[m.id, m.name+" · "+m.info])];
const defaultPrefs = () => ({view:"fc", mapLayer:"swell", favs:["cenitz"], theme:"auto", sessions:[], spot:"cenitz", step:3, days:7, night:"hide", hidden:[], open:{}, blocks:{wavecmp:true, meteofrance_arome_france_hd:true, ecmwf_ifs:true}});
// Profils enregistrés sur cet appareil (la synchro entre appareils viendra avec la mise en ligne)
let store = load("profiles", null);
if(!store || !store.users || !store.users[store.current]){
  const me = {...defaultPrefs(), spot:load("spot","cotebasques"), step:load("step",3), days:load("days",7), night:load("night","hide")};
  store = {current:"Moi", users:{"Moi":me}};
}
let state;
// Spots créés par l'utilisateur (réglages perso, state.mySpots) ajoutés à la suite des spots officiels
const BASE_SPOTS = SPOTS.length;
function syncCustomSpots(){
  SPOTS.length = BASE_SPOTS; SPOTS.push(...(state.mySpots || []));
  if(!SPOTS.some(s=>s.id===state.spot)) state.spot = "cenitz";
}
function useProfile(name){
  store.current = name;
  state = store.users[name] = {...defaultPrefs(), ...store.users[name]};
  syncCustomSpots();
}
useProfile(store.current);
// Compte Supabase (clé publique : la sécurité est assurée par les règles d'accès de la base)
const SB_URL = "https://ednyjpdqbxfzbicbmieq.supabase.co", SB_KEY = "sb_publishable_2dGM071JZVxkA6rPuCHD_A_KNtLgJMy";
const sb = createClient(SB_URL, SB_KEY);
// Réglages de l'appli pour tout le monde (table app_config) ; copie locale pour l'affichage immédiat
const APP = {bicho:true, ...load("appcfg", {})};
let account = null;   // {id, email, ready}
// Compte déjà connecté sur cet appareil : on affiche tout de suite ses données en cache (utile hors ligne)
if(store.account && store.account.state){
  account = {id:store.account.id, email:store.account.email, ready:false};
  state = store.account.state = {...defaultPrefs(), ...store.account.state};
}
// Page d'un spot (/spots/<id>/) : on ouvre sur ce spot, même après la synchro du compte, tant que l'utilisateur n'en change pas
const PAGE_SPOT = document.body.dataset.spot || null;
let pageSpotActive = !!PAGE_SPOT;
function applyPageSpot(){ if(pageSpotActive && SPOTS.some(s=>s.id===PAGE_SPOT)) state.spot = PAGE_SPOT; }
// Sur une page de spot, l'adresse suit le spot choisi (lien à partager, rechargement)
function syncSpotUrl(){
  if(!PAGE_SPOT) return;
  if(state.spot !== PAGE_SPOT) pageSpotActive = false;
  const base = SPOTS.slice(0, BASE_SPOTS).find(s=>s.id===state.spot);
  const path = base ? spotPath(base) : "/";
  if(location.pathname !== path) history.replaceState(history.state, "", path + location.search + location.hash);
  if(base) document.title = spotTitle(base);
}
applyPageSpot();
let prefsTimer = null;
const prefsOf = st => { const {sessions, ...rest} = st; return rest; };
function syncPrefsSoon(){
  if(!account || !account.ready || !sb) return;
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(()=>{ sb.from("profiles").upsert({id:account.id, prefs:prefsOf(state), updated_at:new Date().toISOString()}).then(({error})=>{ if(error) console.warn("Réglages non synchronisés :", error.message); }); }, 800);
}
const persist = () => { save("profiles", store); syncPrefsSoon(); };
const shown = id => !state.hidden.includes(id);

// ---------- Temps (heures locales "naïves" traitées en UTC pour éviter les soucis de changement d'heure) ----------

// ---------- Récupération des données ----------
const cache = {};
async function getJSON(url){ const r = await fetch(url); if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }
const qs = o => Object.entries(o).map(([k,v])=>k+"="+encodeURIComponent(v)).join("&");

async function fetchSpot(spot, force){
  const c = cache[spot.id];
  if(c && !force && Date.now()-c.at < 15*60e3) return c;
  const common = {latitude:spot.lat, longitude:spot.lon, timezone:TZ};
  const wind = getJSON("https://api.open-meteo.com/v1/forecast?"+qs({...common, forecast_days:10, past_days:10,
    hourly:"wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,pressure_msl",
    daily:"sunrise,sunset", models:WIND_MODELS.map(m=>m.id).join(","), wind_speed_unit:"kn"}));
  const sea = getJSON("https://marine-api.open-meteo.com/v1/marine?"+qs({...common, forecast_days:10, past_days:10,
    hourly:"wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_peak_period,swell_wave_direction,sea_surface_temperature"}));
  // Point au large : la grille GFS-Wave (25 km) n'a pas de mer au ras de la côte
  const cmp = getJSON("https://marine-api.open-meteo.com/v1/marine?"+qs({...common, longitude:(spot.lon-0.2).toFixed(3), forecast_days:10, past_days:10,
    hourly:"wave_height,wave_period,wave_peak_period,wave_direction", models:WAVE_MODELS.map(m=>m.id).join(",")}));
  // Houle du tableau : GFS-Wave 0,16° (NOAA), le modèle affiché par Windguru ; Météo-France en secours
  const gfs = getJSON("https://marine-api.open-meteo.com/v1/marine?"+qs({...common, forecast_days:10, past_days:10,
    hourly:"wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction", models:"ncep_gfswave016"}));
  const [w, s, m, g] = await Promise.all([wind, sea, cmp, gfs]);
  const out = {at:Date.now(), w, s, m, g};
  cache[spot.id] = out;
  return out;
}

// Série horaire -> Map(temps -> valeur). Gère les clés suffixées par modèle.
function series(json, base, model){
  const h = json.hourly, k = model && (base+"_"+model) in h ? base+"_"+model : base;
  const map = new Map(); if(!h[k]) return map;
  h.time.forEach((t,i)=>{ const v=h[k][i]; if(v!=null) map.set(tp(t), v); });
  return map;
}

// ---------- Marée ----------

// ---------- Couleurs (échelles type Windguru) ----------
let dark = false;
// Clair : couleurs Windguru telles quelles. Sombre : même teinte, opacité selon l'intensité (le blanc devient transparent).
function cellStyle(scale, v){
  if(v==null || isNaN(v)) return "";
  const [r,g,b] = rgbAt(scale, v);
  if(!dark) return `background:rgb(${r},${g},${b});color:#122433`;
  if(r+g+b > 750) return "";
  return `background:rgb(${r},${g},${b});color:#122433`;
}
const color = (scale, v) => { const [r,g,b] = rgbAt(scale, v); return `rgb(${r},${g},${b})`; };
const bg = (scale,v) => { const c=cellStyle(scale,v); return c?` style="${c}"`:""; };
// Dégradé : chaque case se fond à mi-chemin avec ses voisines (si elles sont à un pas de temps d'écart)
const scaleRgb = scale => v => { const c = rgbAt(scale, v); return dark && c[0]+c[1]+c[2] > 750 ? null : c; };
const noteRgb = v => hslRgb(v*12, 0.72, 0.76);
function rowStyles(cols, vals, colorFn){
  const cs = vals.map(v => v==null || isNaN(v) ? null : colorFn(v));
  const mix = (a, b) => a.map((x, k) => Math.round((x + b[k]) / 2));
  return cs.map((c, i) => {
    if(!c) return "";
    const nb = j => j>=0 && j<cs.length && cs[j] && Math.abs(cols[j].t - cols[i].t) <= state.step*H ? cs[j] : c;
    return ` style="background:linear-gradient(90deg,rgb(${mix(nb(i-1), c)}),rgb(${c}) 50%,rgb(${mix(nb(i+1), c)}));color:#122433"`;
  });
}

// ---------- Relation vent / plage ----------
// Plages « bonne direction » (degrés, sens horaire de a à b) : réglage perso par spot, sinon par défaut
function defaultDirs(spot){
  if(spot.custom) return {sw:spot.sw, wi:spot.wi};
  const [best, win] = SWELL[spot.id] || [spot.face], g = (win || [20])[0];
  return {sw:[norm(best-g), norm(best+g)], wi:[norm(spot.face+135), norm(spot.face+225)]};
}
const spotDirs = spot => ({...defaultDirs(spot), ...((state.dirs||{})[spot.id] || {})});
function windRel(dir, spot){
  if(inArc(dir, spotDirs(spot).wi)) return "off";   // dans ta plage de bon vent
  return angDiff(dir, spot.face)<=45 ? "on" : "cross"; // 0 = vent venant de la mer
}
const REL_TXT = {off:"offshore", cross:"side-shore", on:"onshore"};
// Direction de houle idéale par spot (provenance, en degrés) et tolérance [bonne, moyenne].
// Les spots abrités (baie de Saint-Jean-de-Luz, Hendaye) ont une fenêtre plus étroite.
// Webcams en direct (liens : ces sites interdisent l'affichage dans une autre appli)
function renderCam(spot){
  const b = document.getElementById("camBtn"), c = CAMS[spot.id];
  b.hidden = !c;
  if(c){ b.href = c.url; b.title = "Webcam en direct : " + c.label + " (Quiksilver / Viewsurf, nouvel onglet)"; }
}
function swellFit(dir, spot){
  const arc = spotDirs(spot).sw, d = arcGap(dir, arc);
  return {cls: d===0 ? "sw-good" : d<=25 ? "sw-ok" : "sw-bad", txt: d===0 ? "bonne direction" : d<=25 ? "direction moyenne" : "mauvaise direction", best:arcMid(arc), arc};
}

// ---------- Note /10 ----------
// Conditions d'un créneau, comparables d'une session à l'autre
function feat(hs, per, dir, ws, wdir, tide, rising, spot){
  if(hs==null || per==null) return null;
  const w = ws!=null && wdir!=null ? windComp(ws, wdir, spot.face) : {on:0, side:0};
  return {hs, per, dir, ws, wdir, on:w.on, side:w.side, tide, rising, e:ENERGY(hs, per)};
}
// Note finale : moyenne pondérée entre la note de base et tes notes dans des conditions proches
function scoreFor(f, spot){
  const base = baseScore(f, spot, spotDirs(spot)); if(base==null) return null;
  let wsum = 0, rsum = 0, n = 0;
  for(const x of state.sessions){
    if(!x.f) continue;
    const k = similarity(f, x.f) * (x.spot===spot.id ? 1 : 0.3);
    if(k < 0.03) continue;
    wsum += k; rsum += k*x.rating; n++;
  }
  return {v:(base + rsum)/(1 + wsum), base, w:wsum, n};
}
const scoreBg = v => `background:hsl(${Math.round(v*12)} 72% 76%);color:#122433`;

// Flèche = sens de déplacement (vers où va la houle / le vent). En mode degrés : provenance en ° + point cardinal.
const arrow = (dir, title) => dir==null ? "–" : state.dirDeg
  ? `<span class="deg" title="${title}">${Math.round(dir)}°<span class="sub">${card(dir)}</span></span>`
  : `<svg class="arr" viewBox="0 0 20 20" style="transform:rotate(${(dir+180)%360}deg)" role="img" aria-label="${title}"><title>${title}</title><line x1="10" y1="19" x2="10" y2="7" stroke-width="2.2" stroke-linecap="round"/><path d="M10 0.8 L16 9 L10 7.2 L4 9 Z" stroke-width="0.6" stroke-linejoin="round"/></svg>`;
const fmt = (v, d=0) => v==null ? "–" : (d ? v.toFixed(d) : Math.round(v));

// ---------- Rendu ----------
function buildCols(w){
  const now = nowNaive(), step = state.step;
  const sun = {};
  const d = w.daily, srK = Object.keys(d).find(k=>k.startsWith("sunrise")), ssK = Object.keys(d).find(k=>k.startsWith("sunset"));
  d.time.forEach((day,i)=>{ sun[day] = [tp(d[srK][i]), tp(d[ssK][i])]; });
  // Prévisions : d'aujourd'hui à +N jours ; historique : les 10 derniers jours jusqu'à maintenant
  const today = tp(dayKey(now)), hist = state.view === "hist";
  const firstDay = hist ? today - 10*24*H : today, lastDay = hist ? now + step*H/2 : today + state.days*24*H;
  const cols = [];
  w.hourly.time.forEach(ts=>{
    const t = tp(ts), h = new Date(t).getUTCHours(), dk = ts.slice(0,10), [sr, ss] = sun[dk] || [t,t];
    if(h % step) return;
    if(t < firstDay || t >= lastDay) return;
    if(!hist && t + step*H/2 < now) return;
    const night = t < sr - 1.5*H || t > ss + 0.5*H;
    // Nuit masquée : on garde de 2 h avant le lever à 2 h après le coucher (marées du soir et du matin visibles)
    if(state.night==="hide" && (t + step*H/2 < sr - 2*H || t - step*H/2 > ss + 2*H)) return;
    cols.push({t, h, dk, night, now: now >= t - step*H/2 && now < t + step*H/2});
  });
  cols.sun = sun;
  return cols;
}

let lastCols = [];
const swTxt = x => x && x.h >= 0.1 ? `${x.h.toFixed(1)} m · ${Math.round(x.p)} s${x.d!=null ? ` · ${card(x.d)} (${Math.round(x.d)}°)` : ""}` : "–";
function showSwellPop(cell){
  const c = lastCols[+cell.dataset.i]; if(!c) return;
  let pop = document.getElementById("swPop");
  if(!pop){ pop = document.createElement("div"); pop.id = "swPop"; pop.className = "sw-pop"; document.body.appendChild(pop); }
  const dt = new Date(c.t);
  pop.innerHTML = `<b>${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} · ${c.h}h</b><div><span>Houle 1</span>${swTxt(c.s1)}</div><div><span>Houle 2</span>${swTxt(c.s2)}</div><div><span>Mer du vent</span>${swTxt(c.ww)}</div>`;
  const r = cell.getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width/2 - pop.offsetWidth/2)) + "px";
  pop.style.top = (r.bottom + window.scrollY + 6) + "px";
}
document.addEventListener("click", e=>{
  const cell = e.target.closest && e.target.closest("td.swc");
  if(cell) return showSwellPop(cell);
  const pop = document.getElementById("swPop"); if(pop && !e.target.closest("#swPop")) pop.hidden = true;
});
function render(spot, data){
  dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme!=="light" || document.documentElement.dataset.theme==="dark";
  const {w, s, m, g} = data;
  const GS = k => g ? series(g, k) : new Map();
  const s1H = GS("swell_wave_height"), s1P = GS("swell_wave_period"), s1D = GS("swell_wave_direction");
  const s2H = GS("secondary_swell_wave_height"), s2P = GS("secondary_swell_wave_period"), s2D = GS("secondary_swell_wave_direction");
  const wwH = GS("wind_wave_height"), wwP = GS("wind_wave_period"), wwD = GS("wind_wave_direction");
  const gH = g ? series(g, "wave_height") : new Map(), gP = g ? series(g, "wave_period") : new Map(), gD = g ? series(g, "wave_direction") : new Map();
  const cols = buildCols(w);
  if(!cols.length){ document.getElementById("out").innerHTML = `<div class="block"><div class="msg"><b>Aucun créneau à afficher.</b>Affiche la nuit ou augmente le nombre de jours.</div></div>`; return; }
  const step = state.step, phone = PHONE.matches, colW = step===3 ? (phone ? 42 : 46) : (phone ? 32 : 34), labW = phone ? 84 : 128;

  // Séries océan
  const S = k => series(s, k);
  const hs = S("wave_height"), tm = S("wave_period"), wd = S("wave_direction");
  const sh = S("swell_wave_height"), sp = S("swell_wave_period"), sd = S("swell_wave_direction");
  // Période de pic : Météo-France (houle) près des côtes, sinon ECMWF (vagues), sinon période moyenne
  const tpk = S("swell_wave_peak_period"), tpe = series(m, "wave_peak_period", "ecmwf_wam025");
  const sst = S("sea_surface_temperature");
  // Vent : séries par modèle
  const WM = {};
  WIND_MODELS.forEach(md => { WM[md.id] = {ws:series(w,"wind_speed_10m",md.id), wg:series(w,"wind_gusts_10m",md.id), wd:series(w,"wind_direction_10m",md.id), t:series(w,"temperature_2m",md.id), p:series(w,"pressure_msl",md.id)}; });
  const prio = ["meteofrance_arome_france_hd","meteofrance_arpege_europe","ecmwf_ifs","gfs_seamless"];
  const best = (key, t) => { for(const id of prio){ const v = WM[id][key].get(t); if(v!=null) return v; } return null; };

  // Valeurs dérivées par colonne
  cols.forEach(c=>{
    const H_ = gH.get(c.t) ?? hs.get(c.t), swH = sh.get(c.t);
    c.hs = H_; c.per = gP.get(c.t) ?? tpk.get(c.t) ?? tpe.get(c.t) ?? ((swH!=null && H_ && swH >= 0.5*H_ ? sp.get(c.t) : null) ?? tm.get(c.t) ?? sp.get(c.t));
    c.dir = gD.get(c.t) ?? sd.get(c.t) ?? wd.get(c.t);
    // Houle 1 (principale), houle 2 (secondaire), mer du vent ; l'énergie se calcule sur la houle 1, comme Windguru
    const sw = (H, P, D) => H.get(c.t)!=null ? {h:H.get(c.t), p:P.get(c.t), d:D.get(c.t)} : null;
    c.s1 = sw(s1H, s1P, s1D); c.s2 = sw(s2H, s2P, s2D); c.ww = sw(wwH, wwP, wwD);
    // Énergie totale = somme des composantes (houle 1 + houle 2 + mer du vent), comme une lecture du spectre
    const parts = [c.s1, c.s2, c.ww].filter(x=>x && x.h > 0 && x.p > 0);
    c.e = parts.length ? parts.reduce((a, x)=>a + ENERGY(x.h, x.p), 0) : H_!=null && c.per!=null ? ENERGY(H_, c.per) : null;
    c.ws = best("ws",c.t); c.wg = best("wg",c.t); c.wdir = best("wd",c.t);
    c.rel = c.wdir!=null ? windRel(c.wdir, spot) : null;
    c.sst = sst.get(c.t);
  });

  // Groupes de jours
  const days = []; cols.forEach((c,i)=>{ if(!days.length || days[days.length-1].dk!==c.dk) days.push({dk:c.dk, n:0, first:i}); days[days.length-1].n++; c.ds = days[days.length-1].first===i; });
  // Marée : prédiction harmonique Socoa (pas de 6 min) + surcote barométrique (-1 cm par hPa au-dessus de 1013 hPa)
  const u0 = tp(w.hourly.time[0]) - 26*H, u1 = tp(w.hourly.time[w.hourly.time.length-1]) + 26*H;
  const coefs = coefsByDay(u0, u1);
  let surgeOk = false;
  const lvl = tideSeries(TIDE.socoa, u0, u1, 6).map(([t,v])=>{
    const hr = Math.floor(t/H)*H, f = (t-hr)/H, pa = best("p",hr), pb = best("p",hr+H);
    const P = pa!=null && pb!=null ? pa+(pb-pa)*f : pa ?? pb;
    if(P!=null){ surgeOk = true; v += (1013.25-P)*0.01; }
    return [t, v];
  });
  const todayKey = dayKey(nowNaive());
  const lvlMap = new Map(lvl.map(([t,v])=>[Math.round(t/60e3)*60e3, v]));
  cols.forEach(c=>{
    c.tide = lvlMap.get(c.t);
    const up = lvlMap.get(c.t+30*60e3), dn = lvlMap.get(c.t-30*60e3);
    c.f = feat(c.hs, c.per, c.dir, c.ws, c.wdir, c.tide, up!=null && dn!=null ? up>dn : null, spot);
    if(c.f){ if(c.e!=null) c.f.e = c.e; c.f.s1 = c.s1; c.f.s2 = c.s2; }
    c.score = c.f ? scoreFor(c.f, spot) : null;
  });
  const mySess = state.sessions.filter(x=>x.f);

  const colgroup = `<colgroup><col style="width:${labW}px">${cols.map(()=>`<col style="width:${colW}px">`).join("")}</colgroup>`;
  const tblW = labW + cols.length*colW;
  const cls = (c, extra="") => { const k=[extra]; if(c.ds) k.push("ds"); if(c.night) k.push("n"); return k.join(" ").trim(); };
  const td = (c, inner, extra="", attr="") => `<td class="${cls(c,extra)}"${attr}>${inner}</td>`;
  const cRow = (scale, get, show) => { const vals = cols.map(get), st = rowStyles(cols, vals, scaleRgb(scale)); return cols.map((c, i)=>td(c, show(vals[i]), "", st[i])).join(""); };
  const lab = (t, sub) => `<th class="lab" scope="row">${t}${sub?`<small>${sub}</small>`:""}</th>`;
  const cfStyle = v => { const L = dark ? 30 : 86; const hue = v<45?205: v<70?180: v<95?40: 8; const sat = v<45?20:v<70?35:70; return `background:hsl(${hue} ${sat}% ${L}%)`; };

  const header = () => {
    const dayRow = `<tr class="day"><th class="lab"></th>${days.map(d=>{
      const dt = new Date(tp(d.dk)), name = `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()}`;
      const cf = coefs[d.dk] || [];
      const pmMax = ex.filter(e=>e.type==="PM" && dayKey(e.t)===d.dk).reduce((a, e)=>Math.max(a, e.v), -Infinity);
      const cfs = cf.length ? `<span class="coef">coef ${cf.map(v=>`<span class="cf" style="${cfStyle(v)}">${v}</span>`).join(" ")}${pmMax > -Infinity ? ` <span class="pmh" title="Hauteur de la plus haute pleine mer du jour (Socoa)">PM ${pmMax.toFixed(1)} m</span>` : ""}</span>` : "";
      const sn = cols.sun[d.dk], sun = sn ? `<span class="sun" title="Lever et coucher du soleil">☀ ${hhmm(sn[0])} – ${hhmm(sn[1])}</span>` : "";
      return `<th colspan="${d.n}" class="ds${d.dk===todayKey?" today":""}" scope="colgroup">${d.dk===todayKey?"Aujourd'hui":name}${cfs}${sun}</th>`;
    }).join("")}</tr>`;
    const hourRow = `<tr class="hour">${lab("")}${cols.map(c=>td(c, `${c.h}h`, "hcell"+(c.now?" now":""), ` data-t="${c.t}" title="Toucher pour passer en ${state.step===3?"1 h":"3 h"}"`)).join("")}</tr>`;
    return dayRow + hourRow;
  };

  // Courbe de marée, une cellule par jour
  const allLv = lvl.map(p=>p[1]), lmin = Math.min(...allLv), lmax = Math.max(...allLv);
  const ex = extremes(lvl);
  const tideRow = () => `${lab("Marée", surgeOk ? "m · Socoa + météo" : "m · Socoa")}${days.map(d=>{
    const dc = cols.slice(d.first, d.first+d.n), Wd = d.n*colW, Hh = 62, pad = 15;
    const t0 = dc[0].t - step*H/2, t1 = dc[dc.length-1].t + step*H/2;
    const X = t => (t-t0)/(t1-t0)*Wd, Y = v => pad + (1-(v-lmin)/((lmax-lmin)||1))*(Hh-2*pad);
    const pts = lvl.filter(([t])=>t>=t0-H && t<=t1+H);
    if(pts.length<3) return `<td colspan="${d.n}" class="tide ds dim">–</td>`;
    let path = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
    for(let i=0;i<pts.length-1;i++){ // Catmull-Rom -> Bézier
      const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
      const c1x=X(p1[0])+(X(p2[0])-X(p0[0]))/6, c1y=Y(p1[1])+(Y(p2[1])-Y(p0[1]))/6;
      const c2x=X(p2[0])-(X(p3[0])-X(p1[0]))/6, c2y=Y(p2[1])-(Y(p3[1])-Y(p1[1]))/6;
      path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${X(p2[0]).toFixed(1)},${Y(p2[1]).toFixed(1)}`;
    }
    const area = `${path} L${X(pts[pts.length-1][0]).toFixed(1)},${Hh} L${X(pts[0][0]).toFixed(1)},${Hh} Z`;
    const marks = ex.filter(e=>e.t>=t0 && e.t<=t1).map(e=>{
      const x = X(e.t), y = Y(e.v), up = e.type==="PM";
      const [tx, anc] = x < 18 ? [x+3,"start"] : x > Wd-18 ? [x-3,"end"] : [x,"middle"];
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="var(--tide-line)"/>`+
        `<text x="${tx.toFixed(1)}" y="${(up? y-5 : y+12).toFixed(1)}" text-anchor="${anc}">${hhmm(e.t)}</text>`+
        (Wd>=90 ? `<text class="h" x="${tx.toFixed(1)}" y="${(up? y+12 : y-5).toFixed(1)}" text-anchor="${anc}">${e.v.toFixed(1)}</text>` : "");
    }).join("");
    return `<td colspan="${d.n}" class="tide ds" style="padding:0"><svg width="${Wd}" height="${Hh}" viewBox="0 0 ${Wd} ${Hh}" aria-label="Courbe de marée"><defs><clipPath id="cl${d.dk}"><rect width="${Wd}" height="${Hh}"/></clipPath></defs><g clip-path="url(#cl${d.dk})"><path d="${area}" fill="var(--tide-fill)"/><path d="${path}" fill="none" stroke="var(--tide-line)" stroke-width="1.6"/>${marks}</g></svg></td>`;
  }).join("")}`;

  // Bichomètre : un jour sur trois, alerte BB1 ; les autres jours, un niveau tiré au sort (fixe pour chaque date)
  const BICHO = ["Rien à l'horizon", "Quelques traces", "Zone fréquentée"];
  const bichoRow = () => `${lab("Bichomètre","pour rire")}${days.map(d=>{
    const n = Math.floor(tp(d.dk)/864e5);
    const inner = n%3===0 ? `<span class="bb1">Attention BB1 pas loin</span>` : `<span class="bnorm">${BICHO[(n*7919)%3]}</span>`;
    return `<td colspan="${d.n}" class="ds bicho">${inner}</td>`;
  }).join("")}`;
  const gap = `<tr class="gap"><th class="lab"></th><td colspan="${cols.length}"></td></tr>`;
  // Pas de note tant que tu n'as noté aucune session sur ce spot
  const spotSess = state.sessions.filter(x=>x.spot===spot.id && x.f).length;
  const noteSt = rowStyles(cols, cols.map(c=>c.score ? c.score.v : null), noteRgb);
  const noteCell = (c, i) => {
    if(!spotSess) return td(c, "–", "dim", ` title="Note une session sur ce spot pour voir ta note"`);
    if(!c.score) return td(c, "–", "dim");
    const v = c.score.v, perso = c.score.w >= 0.3;
    const tip = `Note ${v.toFixed(1)}/10` + (perso ? ` · ajustée par ${c.score.n} de tes sessions (note de base ${c.score.base.toFixed(1)})` : " · note de base");
    return td(c, Math.round(v), "note"+(perso?" perso":""), `${noteSt[i]} title="${tip}"`);
  };

  const R = {
    note:     `${lab("Note", spotSess ? "/10 · • = perso" : "/10 · aucune session")}${cols.map(noteCell).join("")}`,
    houle:    `${lab("Hauteur","m · touche")}${(()=>{ const st = rowStyles(cols, cols.map(c=>c.hs), scaleRgb("wave")); return cols.map((c, i)=>td(c, fmt(c.hs,1), "swc", `${st[i]} data-i="${i}"`)).join(""); })()}`,
    periode:  `${lab("Période","s")}${cRow("period", c=>c.per, fmt)}`,
    dirhoule: `${lab("Direction","selon le spot")}${cols.map(c=>{
      if(c.dir==null) return td(c, "–", "dim");
      const fit = swellFit(c.dir, spot);
      return td(c, arrow(c.dir, `Houle de ${card(c.dir)} (${Math.round(c.dir)}°), ${fit.txt} pour ce spot (bonne de ${fit.arc[0]}° à ${fit.arc[1]}°)`), "dirc "+fit.cls);
    }).join("")}`,
    energie:  `${lab("Énergie","kJ")}${cRow("energy", c=>c.e, fmt)}`,
    vent:     `${lab("Vent","nœuds")}${cRow("wind", c=>c.ws, fmt)}`,
    rafales:  `${lab("Rafales","nœuds")}${cRow("wind", c=>c.wg, fmt)}`,
    dirvent:  `${lab("Direction","off / side / on")}${cols.map(c=>td(c, arrow(c.wdir, c.wdir==null?"":`Vent de ${card(c.wdir)} (${Math.round(c.wdir)}°), ${REL_TXT[c.rel]}`), "dirc "+(c.rel||""))).join("")}`,
    courbe:   tideRow(),
    bicho:    bichoRow(),
  };
  const body = GROUPS.filter(g=>g.id!=="fun" || APP.bicho).map(g=>{
    const rows = g.rows.filter(([id])=>shown(id));
    if(!rows.length) return "";
    return `<tr class="grp g-${g.id}"><th class="lab" scope="rowgroup">${g.name}</th><td colspan="${cols.length}"></td></tr>` +
      rows.map(([id])=>`<tr class="g-${g.id}">${R[id]}</tr>`).join("");
  }).join("");
  const synth = `
  <div class="block synth"><div class="bt"><span class="bt-name">Synthèse surf</span></div>
  <div class="scroll"><table class="fc" style="width:${tblW}px">${colgroup}<thead>${header()}</thead><tbody>${body || `<tr><td colspan="${cols.length+1}" class="msg">Toutes les lignes sont masquées. Ouvre « Personnaliser » pour en réafficher.</td></tr>`}</tbody></table></div></div>`;

  // Comparaison des modèles de houle
  const wv = WAVE_MODELS.map(md=>({md, h:series(m,"wave_height",md.id), p:series(m,"wave_period",md.id)}));
  const waveCmp = !state.blocks.wavecmp ? "" : `
  <details class="block" data-id="wavecmp" ${state.open.wavecmp?"open":""}><summary><span class="bt-name">Houle · comparaison des modèles</span><span class="bt-info">au large (~15 km à l'ouest) · hauteur (m) et période moyenne (s)</span></summary>
  <div class="scroll"><table class="fc" style="width:${tblW}px">${colgroup}<thead>${header()}</thead><tbody>
    ${wv.map(({md,h,p},i)=>`${i?gap:""}<tr>${lab(md.name,md.info+" · m")}${cRow("wave", c=>h.get(c.t), v=>fmt(v,1))}</tr>
    <tr>${lab("Période","s")}${cRow("period", c=>p.get(c.t), fmt)}</tr>`).join("")}
  </tbody></table></div></details>`;

  // Un bloc par modèle de vent (format Windguru)
  const windBlocks = WIND_MODELS.map(md=>{
    const X = WM[md.id];
    if(!state.blocks[md.id] || !cols.some(c=>X.ws.get(c.t)!=null)) return "";
    return `
  <details class="block" data-id="${md.id}" ${state.open[md.id]?"open":""}><summary><span class="bt-name">${md.name}</span><span class="bt-info">${md.info}</span></summary>
  <div class="scroll"><table class="fc" style="width:${tblW}px">${colgroup}<thead>${header()}</thead><tbody>
    <tr>${lab("Vent","nœuds")}${cRow("wind", c=>X.ws.get(c.t), fmt)}</tr>
    <tr>${lab("Rafales","nœuds")}${cRow("wind", c=>X.wg.get(c.t), fmt)}</tr>
    <tr>${lab("Direction")}${cols.map(c=>{const v=X.wd.get(c.t); const r=v==null?"":windRel(v,spot); return td(c, arrow(v, v==null?"":`Vent de ${card(v)} (${Math.round(v)}°), ${REL_TXT[r]}`), "dirc "+r);}).join("")}</tr>
  </tbody></table></div></details>`;
  }).join("");

  document.getElementById("out").innerHTML = synth + waveCmp + windBlocks;
  lastCols = cols;
  if(state.view === "hist") document.querySelectorAll("#out .scroll").forEach(e=>{ e.scrollLeft = e.scrollWidth; });   // historique : on arrive sur les jours récents

  // En-tête du spot
  const myDirs = spotDirs(spot);
  const todayCoef = coefs[todayKey] || [];
  const nowCol = cols[0];
  const nextPM = ex.find(e=>e.type==="PM" && e.t>nowNaive()), nextBM = ex.find(e=>e.type==="BM" && e.t>nowNaive());
  document.getElementById("spotName").textContent = `${spot.town} · ${spot.name}`;
  document.getElementById("spotMeta").innerHTML = [
    `Face au <b>${card(spot.face)}</b> (${spot.face}°)`,
    `Bon vent <b>${myDirs.wi[0]}°–${myDirs.wi[1]}°</b> · bonne houle <b>${myDirs.sw[0]}°–${myDirs.sw[1]}°</b>`,
    todayCoef.length ? `Coef du jour <b>${todayCoef.join(" / ")}</b>` : "",
    cols.sun[todayKey] ? `Soleil <b>${hhmm(cols.sun[todayKey][0])}</b> – <b>${hhmm(cols.sun[todayKey][1])}</b>` : "",
    nextPM ? `Prochaine PM <b>${hhmm(nextPM.t)}</b>` : "",
    nextBM ? `Prochaine BM <b>${hhmm(nextBM.t)}</b>` : "",
    (()=>{ const n = state.sessions.filter(x=>x.spot===spot.id).length; return n ? `<b>${n}</b> session${n>1?"s":""} notée${n>1?"s":""} ici` : ""; })(),
  ].filter(Boolean).map(x=>`<span>${x}</span>`).join("");
  const hNow = Math.floor(nowNaive()/H)*H, airNow = best("t", hNow), sstNow = sst.get(hNow) ?? [...sst.entries()].find(([t])=>t>=hNow)?.[1];
  document.getElementById("temps").innerHTML =
    (sstNow!=null ? `<span class="tchip eau" title="Température de l'eau, ${spot.name}"><small>Eau</small><b>${Math.round(sstNow)}°</b></span>` : "") +
    (airNow!=null ? `<span class="tchip" title="Température de l'air, ${spot.name}"><small>Air</small><b>${Math.round(airNow)}°</b></span>` : "");
  document.getElementById("updated").textContent = "Mis à jour à " + new Date(data.at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
}

function renderLegend(){
  dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme!=="light" || document.documentElement.dataset.theme==="dark";
  const sw = (name, scale, vals, unit) => `<div class="lg"><h3>${name} (${unit})</h3><div class="sw">${vals.map(v=>`<span style="${cellStyle(scale,v)}">${v}</span>`).join("")}</div></div>`;
  document.getElementById("legend").innerHTML =
    sw("Houle","wave",[0.3,0.5,1,1.5,2,2.5,3,4,5,6],"m") +
    sw("Période","period",[8,10,11,12,13,14,15,16,18,20],"s") +
    sw("Énergie","energy",[50,100,150,200,250,300,350,600,1000,2000],"kJ") +
    sw("Vent","wind",[5,7,9,11,13,15,17,19,21,25,30],"nœuds") +
    `<div class="lg"><h3>Vent par rapport à la plage</h3><div class="rel"><span class="off-l" style="background:var(--off);color:var(--off-ink)">offshore · de terre</span><span style="background:var(--cross)">side-shore</span><span style="background:var(--on);color:var(--on-ink)">onshore · de mer</span></div></div>` +
    `<div class="lg"><h3>Direction de la houle pour le spot</h3><div class="rel"><span style="background:var(--off);color:var(--off-ink)">bonne</span><span style="background:var(--cross)">moyenne</span><span style="background:var(--on);color:var(--on-ink)">mauvaise</span></div></div>`;
}

// ---------- Interface ----------
function renderSpots(){
  syncSpotUrl();
  const favs = SPOTS.filter(x=>(state.favs||[]).includes(x.id));
  const cur = SPOTS.find(x=>x.id===state.spot);
  const list = cur && !favs.includes(cur) ? [...favs, cur] : favs;
  document.getElementById("spots").innerHTML = list.map(x=>`<button type="button" class="spot${(state.favs||[]).includes(x.id)?"":" notfav"}" data-id="${x.id}" aria-pressed="${x.id===state.spot}"><small>${x.town}</small><b>${x.name}</b></button>`).join("")
    + `<button type="button" class="spot allspots" id="allSpots"><small>${SPOTS.length} spots</small><b>☆ Mes spots</b></button>`;
}
// Choix des spots favoris
const spotsDlg = document.getElementById("spotsDlg");
function renderSpotPicker(){
  const grp = x => x.custom ? "Mes spots créés" : x.town, towns = [...new Set(SPOTS.map(grp))];
  const reg = t => { const x = SPOTS.find(y=>grp(y)===t); return x.custom ? "" : x.region || "Pays basque"; };
  document.getElementById("spotPick").innerHTML = towns.map((t,i)=>`${reg(t) && reg(t)!==(i ? reg(towns[i-1]) : "") ? `<h3 class="sp-reg">${reg(t)}</h3>` : ""}<div class="sp-town"><h4>${t}</h4>${SPOTS.filter(x=>grp(x)===t).map(x=>{
    const fav = (state.favs||[]).includes(x.id);
    return `<div class="sp-row${x.id===state.spot?" cur":""}"><button type="button" class="sp-star" data-fav="${x.id}" aria-pressed="${fav}" aria-label="${fav?"Retirer":"Ajouter"} ${x.name} ${fav?"des":"aux"} favoris">${fav?"★":"☆"}</button><button type="button" class="sp-go" data-go="${x.id}">${x.name}${x.big?' <em>grosse houle</em>':x.reef?' <em>reef</em>':""}${CAMS[x.id]?' <em>webcam</em>':""}${x.custom?` <em>${x.town}</em>`:""}</button>${x.custom?`<button type="button" class="sp-del" data-delspot="${x.id}" aria-label="Supprimer ${x.name}">✕</button>`:""}</div>`;
  }).join("")}</div>`).join("");
}
function syncSeg(id, val){ document.querySelectorAll(`#${id} button`).forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.v==String(val)))); }
function syncControls(){ syncSeg("segStep",state.step); syncSeg("segDays",state.days); syncSeg("segNight",state.night); syncSeg("segDir", state.dirDeg?"deg":"arrow"); }
function toggleDir(deg){ state.dirDeg = deg; persist(); syncControls(); if(last) render(last.spot, last.data); }
document.getElementById("segDir").addEventListener("click", e=>{ const b=e.target.closest("button"); if(b) toggleDir(b.dataset.v==="deg"); });
// Toucher une heure de l'en-tête : bascule 3 h <-> 1 h, en gardant cette heure au même endroit à l'écran
document.getElementById("out").addEventListener("click", e=>{
  const h = e.target.closest("td.hcell"); if(!h || !last) return;
  const sc = h.closest(".scroll"), t = +h.dataset.t, x = h.getBoundingClientRect().left;
  state.step = state.step === 3 ? 1 : 3; persist(); syncControls(); render(last.spot, last.data);
  // l'heure touchée existe toujours (3 h ⊂ 1 h) sauf en passant à 3 h depuis une heure intermédiaire : on prend la plus proche
  const cells = [...document.querySelectorAll("#out .block.synth td.hcell")];
  const near = cells.reduce((a, c)=>Math.abs(+c.dataset.t - t) < Math.abs(+a.dataset.t - t) ? c : a, cells[0]);
  const nsc = document.querySelector("#out .block.synth .scroll");
  if(near && nsc && sc) nsc.scrollLeft += near.getBoundingClientRect().left - x;
});
// Un clic sur n'importe quelle case de direction bascule flèches <-> degrés
document.getElementById("out").addEventListener("click", e=>{ if(e.target.closest("td.dirc")) toggleDir(!state.dirDeg); });
// Blocs détaillés repliés par défaut ; on retient ceux que l'utilisateur ouvre
document.getElementById("out").addEventListener("toggle", e=>{ const d=e.target; if(d.dataset && d.dataset.id){ state.open[d.dataset.id] = d.open; persist(); } }, true);

let reqId = 0, last = null;
async function show(force){
  renderCam(SPOTS.find(s=>s.id===state.spot));
  const spot = SPOTS.find(s=>s.id===state.spot), my = ++reqId;
  document.getElementById("spotName").textContent = `${spot.town} · ${spot.name}`;
  if(!cache[spot.id] || force) document.getElementById("out").innerHTML = `<div class="block"><div class="msg"><b>Chargement des prévisions…</b>Houle, vent et marée pour ${spot.name}.</div></div>`;
  try{
    const data = await fetchSpot(spot, force);
    if(my!==reqId) return;
    last = {spot, data};
    render(spot, data);
  }catch(e){
    if(my!==reqId) return;
    document.getElementById("out").innerHTML = `<div class="block"><div class="msg"><b>Impossible de récupérer les prévisions.</b>Vérifie ta connexion Internet puis clique sur Actualiser. (${e.message})</div></div>`;
  }
}

document.getElementById("spots").addEventListener("click", e=>{
  if(e.target.closest("#allSpots")){ renderSpotPicker(); spotsDlg.showModal(); return; }
  const b = e.target.closest(".spot"); if(!b) return;
  state.spot = b.dataset.id; persist(); renderSpots(); renderView(); show(false);
});
spotsDlg.addEventListener("click", e=>{
  if(e.target===spotsDlg || e.target.closest("[data-close]")) return spotsDlg.close();
  const f = e.target.closest("[data-fav]");
  if(f){ const id = f.dataset.fav; state.favs = (state.favs||[]).includes(id) ? state.favs.filter(x=>x!==id) : [...(state.favs||[]), id]; persist(); renderSpotPicker(); renderSpots(); return; }
  const ds = e.target.closest("[data-delspot]");
  if(ds){
    const id = ds.dataset.delspot, sp = SPOTS.find(x=>x.id===id);
    if(!confirm(`Supprimer ton spot « ${sp.name} » ? Ses sessions notées restent dans ta liste.`)) return;
    state.mySpots = (state.mySpots||[]).filter(x=>x.id!==id);
    state.favs = (state.favs||[]).filter(x=>x!==id);
    if(state.dirs) delete state.dirs[id];
    syncCustomSpots(); persist(); renderSpotPicker(); renderSpots(); show(false); return;
  }
  if(e.target.closest("#newSpotBtn")){ spotsDlg.close(); openNewSpot(); return; }
  const g = e.target.closest("[data-go]");
  if(g){ state.spot = g.dataset.go; persist(); renderSpots(); renderView(); spotsDlg.close(); show(false); }
});
[["segStep","step",Number],["segDays","days",Number],["segNight","night",String]].forEach(([id,key,cast])=>{
  document.getElementById(id).addEventListener("click", e=>{
    const b = e.target.closest("button"); if(!b) return;
    state[key] = cast(b.dataset.v); persist(); syncControls();
    if(last) render(last.spot, last.data);
  });
});
document.getElementById("refresh").addEventListener("click", ()=>show(true));
PHONE.addEventListener("change", ()=>{ if(last) render(last.spot, last.data); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>{ renderLegend(); if(last) render(last.spot, last.data); });

// ---------- Profils et personnalisation ----------
const esc = t => String(t).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function renderWho(){
  const name = account ? account.email.split("@")[0] : store.current;
  document.getElementById("whoName").textContent = name;
  document.getElementById("avatar").textContent = name.trim().charAt(0).toUpperCase() || "?";
}
function renderPrefs(){
  document.getElementById("profList").innerHTML = Object.keys(store.users).map(n=>`<button type="button" data-p="${esc(n)}" aria-pressed="${n===store.current}">${esc(n)}</button>`).join("");
  document.getElementById("rowChecks").innerHTML = GROUPS.filter(g=>g.id!=="fun" || APP.bicho).map(g=>`<div class="rg g-${g.id}"><b>${g.name}</b>${g.rows.map(([id,name])=>`<label class="chk"><input type="checkbox" id="row-${id}" data-row="${id}" ${shown(id)?"checked":""}>${name}</label>`).join("")}</div>`).join("");
  document.getElementById("blockChecks").innerHTML = `<div class="rg g-blocs"><b>Sous le tableau</b>${BLOCKS.map(([id,name])=>`<label class="chk"><input type="checkbox" id="blk-${id}" data-blk="${id}" ${state.blocks[id]?"checked":""}>${name}</label>`).join("")}</div>`;
  document.getElementById("delProf").disabled = Object.keys(store.users).length < 2;
  document.getElementById("profSec").hidden = !!account;
  document.getElementById("delProf").hidden = !!account;
  renderAccount();
  syncSeg("segTheme", state.theme || "auto");
}
// Bonnes directions du spot affiché (bouton à côté de « Mes sessions »)
const dirDlg = document.getElementById("dirDlg");
function renderDirs(){
  const sp = SPOTS.find(x=>x.id===state.spot), dd = spotDirs(sp);
  document.getElementById("dirTitle").textContent = `Bonnes directions · ${sp.name}`;
  [["dSw0",dd.sw[0]],["dSw1",dd.sw[1]],["dWi0",dd.wi[0]],["dWi1",dd.wi[1]]].forEach(([id,v])=>document.getElementById(id).value = v);
}
document.getElementById("dirBtn").addEventListener("click", ()=>{ renderDirs(); dirDlg.showModal(); });
dirDlg.addEventListener("click", e=>{ if(e.target===dirDlg || e.target.closest("[data-close]")) dirDlg.close(); });
dirDlg.addEventListener("change", ()=>{
  const v = id => { const n = parseFloat(document.getElementById(id).value); return Number.isFinite(n) ? norm(n) : null; };
  const sw = [v("dSw0"), v("dSw1")], wi = [v("dWi0"), v("dWi1")];
  if([...sw, ...wi].includes(null)) return;   // champ vide : on attend une valeur
  state.dirs = {...(state.dirs||{}), [state.spot]: {sw, wi}};
  applyAll();
});
function applyTheme(){
  const t = state.theme || "auto", root = document.documentElement;
  if(t==="auto") delete root.dataset.theme; else root.dataset.theme = t;
  const isDark = t==="dark" || (t==="auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#0c161e" : "#0b6e7a";
  renderLegend();
}
document.getElementById("segTheme").addEventListener("click", e=>{ const b=e.target.closest("button"); if(!b) return; state.theme = b.dataset.v; syncSeg("segTheme", state.theme); applyAll(); });
function applyAll(){ syncCustomSpots(); applyTheme(); persist(); const bo = document.getElementById("bichoOpen"); if(bo) bo.hidden = !(APP.bicho && shown("bicho")); renderWho(); renderSpots(); syncControls(); renderView(); if(last && last.spot.id===state.spot) render(last.spot, last.data); else show(false); }
const dlg = document.getElementById("prefs");
let prefsDirty = false;
// Une case cochée ou décochée : on recharge la page en fermant, pour repartir d'un affichage propre
dlg.addEventListener("close", ()=>{ if(prefsDirty){ prefsDirty = false; location.reload(); } });
const openPrefs = () => { renderPrefs(); dlg.showModal(); };
document.getElementById("custom").addEventListener("click", openPrefs);
document.getElementById("who").addEventListener("click", openPrefs);
dlg.addEventListener("click", e=>{
  if(e.target===dlg || e.target.closest("[data-close]")) return dlg.close();
  const pb = e.target.closest("[data-p]");
  if(pb){ useProfile(pb.dataset.p); renderPrefs(); applyAll(); }
});
dlg.addEventListener("change", e=>{
  const i = e.target;
  if(i.dataset.row){ state.hidden = state.hidden.filter(x=>x!==i.dataset.row); if(!i.checked) state.hidden.push(i.dataset.row); }
  else if(i.dataset.blk){ state.blocks[i.dataset.blk] = i.checked; }
  else return;
  prefsDirty = true; applyAll();
});
document.getElementById("newProf").addEventListener("submit", e=>{
  e.preventDefault();
  const inp = document.getElementById("newName"), name = inp.value.trim();
  if(!name) return inp.focus();
  if(!store.users[name]) store.users[name] = {...defaultPrefs(), spot:state.spot};
  inp.value = ""; useProfile(name); renderPrefs(); applyAll();
});
document.getElementById("delProf").addEventListener("click", ()=>{
  if(Object.keys(store.users).length<2) return;
  delete store.users[store.current]; useProfile(Object.keys(store.users)[0]); renderPrefs(); applyAll();
});
document.getElementById("dirReset").addEventListener("click", ()=>{
  if(state.dirs) delete state.dirs[state.spot];
  renderDirs(); applyAll();
});
document.getElementById("resetProf").addEventListener("click", ()=>{
  state.hidden = []; BLOCKS.forEach(([id])=>state.blocks[id] = true); renderPrefs(); applyAll();
});

// ---------- Onglet Carte : houle et vent sur le monde entier ----------
// Les données sont préparées deux fois par jour par GitHub Actions (outils/construire_donnees_carte.py)
// et lues sur la branche « data » du dépôt : aucun appel à Open-Meteo depuis le téléphone.
const MAP_DATA = "https://raw.githubusercontent.com/Dbasaguren/olatu/data/";
const hex = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const PAL = {
  swell:  {name:"Hauteur de houle", unit:"m",   ticks:[0,1,2,3,4,6,8],     stops:[[0,"#0d1b4c"],[0.5,"#123f8c"],[1,"#1673b8"],[1.5,"#18a5b5"],[2,"#3cc47c"],[2.5,"#9bd94a"],[3,"#f2d43b"],[4,"#f59a2c"],[5,"#e8512f"],[6,"#c92a5a"],[8,"#8a2fc2"],[10,"#d1a8ff"]]},
  period: {name:"Période moyenne de houle", unit:"s",   ticks:[4,8,10,12,14,16,20], stops:[[4,"#0d1b4c"],[7,"#1673b8"],[9,"#18a5b5"],[11,"#3cc47c"],[13,"#f2d43b"],[15,"#f59a2c"],[17,"#e8512f"],[20,"#8a2fc2"]]},
  wind:   {name:"Vent",             unit:"nds", ticks:[0,10,15,20,25,30,40], stops:[[0,"#0d1b4c"],[5,"#1673b8"],[10,"#18a5b5"],[15,"#3cc47c"],[20,"#f2d43b"],[25,"#f59a2c"],[30,"#e8512f"],[40,"#8a2fc2"]]},
};
Object.values(PAL).forEach(p=>p.rgb = p.stops.map(([v,c])=>[v, ...hex(c)]));
function palRgb(p, v){
  const s = p.rgb;
  if(v<=s[0][0]) return s[0].slice(1);
  for(let i=0;i<s.length-1;i++){ const a=s[i], b=s[i+1]; if(v<=b[0]){ const f=(v-a[0])/(b[0]-a[0]); return [a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f, a[3]+(b[3]-a[3])*f]; } }
  return s[s.length-1].slice(1);
}
const PLACES = [["Biarritz",43.48,-1.56,7],["Hossegor",43.66,-1.40,7],["Saint-Sébastien",43.32,-1.98,7],["Bilbao",43.26,-2.93,5],["Santander",43.46,-3.80,6],["La Corogne",43.36,-8.41,5],["Lisbonne",38.72,-9.14,4],["Porto",41.15,-8.61,6],["Bordeaux",44.84,-0.58,5],["Brest",48.39,-4.49,5],["Irlande",52.8,-8.0,4],["Açores",38.6,-28.0,4],["Islande",64.9,-18.5,3],["Terre-Neuve",48.5,-56.0,3],["Antilles",16.5,-61.5,3],["Canaries",28.3,-16.5,4],["Maroc",31.8,-7.1,4],["Hawaï",20.8,-156.3,3],["Tahiti",-17.6,-149.4,3],["Bali",-8.4,115.2,3],["Australie",-25.0,134.0,2],["Afrique du Sud",-30.5,24.0,2],["Brésil",-10.0,-52.0,2],["Californie",36.5,-119.5,3],["Japon",36.2,138.3,3]];
const VIEWS = {monde:[[20,-20],2], atlantique:[[42,-28],3], basque:[[43.7,-3],7]};
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAP = {map:null, canvas:null, data:{}, ti:0, timer:null};
const FLOW = {canvas:null, parts:[], raf:0, running:false};

function loadScript(src){ return new Promise((ok, ko)=>{ const t=document.createElement("script"); t.src=src; t.onload=ok; t.onerror=()=>ko(new Error("chargement impossible : "+src)); document.head.appendChild(t); }); }
function loadCss(href){ const l=document.createElement("link"); l.rel="stylesheet"; l.href=href; document.head.appendChild(l); }
const normLon = lo => ((lo+180)%360+360)%360-180;

function dilate(src, nT, nLat, nLon, passes, wrap){
  let a = Float32Array.from(src); const nP = nLat*nLon;
  for(let k=0;k<passes;k++){
    const b = Float32Array.from(a);
    for(let t=0;t<nT;t++) for(let i=0;i<nLat;i++) for(let j=0;j<nLon;j++){
      const idx = t*nP+i*nLon+j; if(!isNaN(a[idx])) continue;
      let s=0, n=0;
      for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++){
        const ii=i+di; let jj=j+dj;
        if(ii<0 || ii>=nLat) continue;
        if(wrap) jj=(jj+nLon)%nLon; else if(jj<0 || jj>=nLon) continue;
        const v=a[t*nP+ii*nLon+jj]; if(!isNaN(v)){ s+=v; n++; }
      }
      if(n) b[idx]=s/n;
    }
    a = b;
  }
  return a;
}
// Lit swell.json ou wind.json (valeurs entières, -1 = terre) et prépare les grilles
async function fetchLayerData(kind){
  const c = MAP.data[kind]; if(c && Date.now()-c.at < 3600e3) return c;
  const J = await getJSON(MAP_DATA + (kind==="wind" ? "wind.json" : "swell.json"));
  const nT = J.times.length;
  const dec = (arr, scale) => { const a = new Float32Array(arr.length); for(let i=0;i<arr.length;i++) a[i] = arr[i] < 0 ? NaN : arr[i]/scale; return a; };
  const grids = J.grids.map(g=>{
    const o = {id:g.id, lat0:g.lat0, lon0:g.lon0, step:g.step, nLat:g.nLat, nLon:g.nLon, nP:g.nLat*g.nLon, wrap:g.wrap};
    if(kind==="wind"){ o.v = dec(g.v, 10); o.d = dec(g.d, 1); } else { o.v = dec(g.h, 100); o.p = dec(g.p, 10); o.d = dec(g.d, 1); }
    o.dx = o.d.map(v=>Math.sin(v*DEG)); o.dy = o.d.map(v=>Math.cos(v*DEG));
    // Comble les trous près des côtes (et les petites mers) avec les valeurs voisines ; la terre est dessinée par-dessus
    const passes = g.wrap ? 3 : 2;
    o.fill = {v: dilate(o.v, nT, o.nLat, o.nLon, passes, o.wrap)};
    if(o.p) o.fill.p = dilate(o.p, nT, o.nLat, o.nLon, passes, o.wrap);
    return o;
  });
  const res = {at:Date.now(), grids, times:J.times, generated:J.generated};
  MAP.data[kind] = res; return res;
}
// Interpolation bilinéaire ; renvoie {v, sea} (sea = part de mer autour du point)
function sampleGrid(g, arr, ti, lat, lon){
  const fy=(lat-g.lat0)/g.step; if(fy<0 || fy>g.nLat-1) return null;
  let j, j1, x;
  if(g.wrap){ const fx = ((lon-g.lon0)%360+360)%360/g.step; j = Math.floor(fx); x = fx-j; j %= g.nLon; j1 = (j+1)%g.nLon; }
  else { const fx = (lon-g.lon0)/g.step; if(fx<0 || fx>g.nLon-1) return null; j = Math.min(Math.floor(fx), g.nLon-2); x = fx-j; j1 = j+1; }
  const i=Math.min(Math.floor(fy), g.nLat-2), y=fy-i, o=ti*g.nP;
  const c=[[i,j,(1-y)*(1-x)],[i,j1,(1-y)*x],[i+1,j,y*(1-x)],[i+1,j1,y*x]];
  let s=0, w=0;
  for(const [ii,jj,ww] of c){ const v=arr[o+ii*g.nLon+jj]; if(!isNaN(v)){ s+=v*ww; w+=ww; } }
  // distance au bord de la grille, en mailles (pour fondre deux grilles entre elles)
  const edge = g.wrap ? 99 : Math.min(fy, g.nLat-1-fy, (lon-g.lon0)/g.step, g.nLon-1-(lon-g.lon0)/g.step);
  return w>1e-6 ? {v:s/w, sea:w, edge} : null;
}
const BLEND = 2;   // largeur du fondu entre une grille fine et la suivante, en mailles
function sampleAt(D, key, ti, lat, lon, filled){
  lon = normLon(lon);
  const gs = D.grids;
  for(let k=0;k<gs.length;k++){
    const r = sampleGrid(gs[k], filled ? gs[k].fill[key] : gs[k][key], ti, lat, lon);
    if(!r || !(filled || r.sea>0.5)) continue;
    // Près du bord de la grille fine : fondu progressif vers la grille plus large
    if(r.edge < BLEND && k+1 < gs.length){
      for(let n=k+1;n<gs.length;n++){
        const r2 = sampleGrid(gs[n], filled ? gs[n].fill[key] : gs[n][key], ti, lat, lon);
        if(r2 && (filled || r2.sea>0.5)){ const f = r.edge/BLEND; return {v:r.v*f + r2.v*(1-f), sea:r.sea}; }
      }
    }
    return r;
  }
  return null;
}
function dirAt(D, ti, lat, lon){
  const x = sampleAt(D,"dx",ti,lat,lon), y = sampleAt(D,"dy",ti,lat,lon);
  return x && y ? (Math.atan2(x.v, y.v)/DEG+360)%360 : null;
}
const layerKey = l => l==="wind" ? "wind" : "swell";
const fieldKey = l => l==="period" ? "p" : "v";
const curData = () => MAP.data[layerKey(state.mapLayer)];

// Côtes Natural Earth : 1:110 m vue de loin, 1:50 m de près
function toRings(topo){
  const geo = topojson.feature(topo, topo.objects.land);
  const geoms = geo.features ? geo.features.map(f=>f.geometry) : [geo.geometry];
  const rings = [];
  for(const gm of geoms){ const polys = gm.type==="Polygon" ? [gm.coordinates] : gm.coordinates; for(const poly of polys) for(const r0 of poly){
    // Contours qui traversent la ligne de changement de date : longitudes rendues continues (sinon trait à travers la carte)
    const r = []; let prev = null;
    for(const [lo0,la] of r0){ let lo = lo0; if(prev!==null){ while(lo-prev > 180) lo -= 360; while(lo-prev < -180) lo += 360; } r.push([lo,la]); prev = lo; }
    let a=1e9,b=-1e9,c=1e9,d=-1e9; for(const [lo,la] of r){ if(lo<a)a=lo; if(lo>b)b=lo; if(la<c)c=la; if(la>d)d=la; }
    rings.push({pts:r, minLo:a, maxLo:b, minLa:c, maxLa:d});
  } }
  return rings;
}
async function loadLand(){
  await loadScript("https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js");
  MAP.l110 = toRings(await getJSON("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json")); drawMap();
  MAP.l50 = toRings(await getJSON("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json")); drawMap();
}

function placeCanvas(cv, W, Hh){
  const dpr = window.devicePixelRatio || 1;
  cv.width = W*dpr; cv.height = Hh*dpr; cv.style.width = W+"px"; cv.style.height = Hh+"px";
  L.DomUtil.setPosition(cv, MAP.map.containerPointToLayerPoint([0,0]));
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); return ctx;
}
function drawMap(){
  const m = MAP.map, D = curData(); if(!m || !D) return;
  const {x:W, y:Hh} = m.getSize(), ctx = placeCanvas(MAP.canvas, W, Hh);
  ctx.clearRect(0,0,W,Hh);
  const pal = PAL[state.mapLayer], key = fieldKey(state.mapLayer), ti = MAP.ti;
  // 1. Champ de couleur, calculé en basse résolution puis lissé
  const S = 4, w = Math.ceil(W/S), h = Math.ceil(Hh/S), small = MAP.small || (MAP.small = document.createElement("canvas"));
  small.width = w; small.height = h;
  const sctx = small.getContext("2d"), img = sctx.createImageData(w, h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const ll = m.containerPointToLatLng([x*S+S/2, y*S+S/2]), r = sampleAt(D, key, ti, ll.lat, ll.lng, true), k = (y*w+x)*4;
    if(!r) continue;
    const c = palRgb(pal, r.v); img.data[k]=c[0]; img.data[k+1]=c[1]; img.data[k+2]=c[2]; img.data[k+3]=255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, w*S, h*S);
  // 2. Terre et côtes, nettes, par-dessus (copies du monde à gauche et à droite si besoin)
  const land = m.getZoom() >= 4 && MAP.l50 ? MAP.l50 : MAP.l110;
  if(land){
    const bd = m.getBounds(), west = bd.getWest(), east = bd.getEast(), south = bd.getSouth(), north = bd.getNorth();
    ctx.beginPath();
    for(let off = -720; off <= 720; off += 360){   // chaque contour est testé sur plusieurs tours du monde
      for(const r of land){
        if(r.maxLo+off < west || r.minLo+off > east || r.maxLa < south || r.minLa > north) continue;
        r.pts.forEach(([lo,la],i)=>{ const pt = m.latLngToContainerPoint([la, lo+off]); i ? ctx.lineTo(pt.x,pt.y) : ctx.moveTo(pt.x,pt.y); });
        ctx.closePath();
      }
    }
    ctx.fillStyle = "#1c2731"; ctx.fill("nonzero");   // nonzero : deux copies superposées du même continent ne s'annulent pas
    ctx.strokeStyle = "rgba(220,235,245,.45)"; ctx.lineWidth = 0.8; ctx.stroke();
  }
  // 3. Sans animation (réglage « réduire les animations ») : flèches fixes
  if(REDUCED) staticArrows(ctx, D, W, Hh);
  // 4. Repères et spots
  ctx.font = "600 11px Barlow, system-ui, sans-serif";
  for(const [name, la, lo, minZ] of PLACES){
    if(m.getZoom() < minZ) continue;
    const pt = m.latLngToContainerPoint([la, lo]);
    if(pt.x<0 || pt.y<0 || pt.x>W || pt.y>Hh) continue;
    ctx.fillStyle = "rgba(220,235,245,.55)"; ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.8, 0, 2*Math.PI); ctx.fill();
    ctx.fillStyle = "rgba(220,235,245,.8)"; ctx.fillText(name, pt.x+5, pt.y+4);
  }
  for(const sp of SPOTS){
    const cur = sp.id===state.spot; if(!cur && !(state.favs||[]).includes(sp.id)) continue;
    if(m.getZoom() < 5 && !cur) continue;
    const pt = m.latLngToContainerPoint([sp.lat, sp.lon]);
    ctx.beginPath(); ctx.arc(pt.x, pt.y, cur?5.5:4, 0, 2*Math.PI); ctx.fillStyle = cur ? "#ffffff" : "#cfe3ee"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#0b1622"; ctx.stroke();
    if(cur){ ctx.font = "700 12px Barlow, system-ui, sans-serif"; ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(11,22,34,.9)"; ctx.strokeText(sp.name, pt.x+9, pt.y+4); ctx.fillStyle = "#fff"; ctx.fillText(sp.name, pt.x+9, pt.y+4); }
  }
}
function arrowGlyph(ctx, x, y, travelDeg, len, alpha){
  ctx.save(); ctx.translate(x, y); ctx.rotate(travelDeg*DEG);
  const t = len/2, head = Math.max(4.5, len*0.34);
  for(const [col, wid] of [[`rgba(6,14,22,${(0.75*alpha).toFixed(3)})`, 3.6], [`rgba(255,255,255,${alpha.toFixed(3)})`, 1.7]]){
    ctx.strokeStyle = col; ctx.lineWidth = wid; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(0, t); ctx.lineTo(0, -t+1); ctx.moveTo(-head*0.6, -t+head); ctx.lineTo(0, -t); ctx.lineTo(head*0.6, -t+head); ctx.stroke();
  }
  ctx.restore();
}
// Taille et vitesse d'une flèche selon la houle (hauteur, période) ou le vent
function flowStyle(D, ti, lat, lon, v){
  if(state.mapLayer==="wind") return {len: 8 + clamp(v*0.35, 0, 13), speed: 0.25 + clamp(v*0.035, 0, 1.4)};
  const p = sampleAt(D, "p", ti, lat, lon), per = p ? p.v : 8;
  return {len: 9 + clamp(v*2.4, 0, 13), speed: 0.2 + clamp((per-5)*0.075, 0, 1.4)};
}
function staticArrows(ctx, D, W, Hh){
  const m = MAP.map, G = W < 500 ? 46 : 54;
  for(let y=G/2; y<Hh; y+=G) for(let x=G/2; x<W; x+=G){
    const ll = m.containerPointToLatLng([x,y]), r = sampleAt(D, "v", MAP.ti, ll.lat, ll.lng), d = r ? dirAt(D, MAP.ti, ll.lat, ll.lng) : null;
    if(!r || d==null) continue;
    arrowGlyph(ctx, x, y, (d+180)%360, flowStyle(D, MAP.ti, ll.lat, ll.lng, r.v).len, 1);
  }
}
// ---- Flèches animées : elles glissent dans le sens de la houle, apparaissent et s'effacent ----
function spawn(p, W, Hh){ p.x = Math.random()*W; p.y = Math.random()*Hh; p.age = 0; p.life = 90 + Math.random()*110; }
function flowReset(){
  if(!MAP.map || REDUCED) return;
  const {x:W, y:Hh} = MAP.map.getSize(), n = Math.round(clamp(W*Hh/2300, 120, 520));
  placeCanvas(FLOW.canvas, W, Hh);
  FLOW.parts = Array.from({length:n}, ()=>{ const p = {}; spawn(p, W, Hh); p.age = Math.random()*p.life; return p; });
  FLOW.canvas.style.opacity = 1; FLOW.running = true;
  if(!FLOW.raf) FLOW.raf = requestAnimationFrame(flowTick);
}
function flowPause(){ FLOW.running = false; if(FLOW.canvas) FLOW.canvas.style.opacity = 0; }
function flowStop(){ flowPause(); cancelAnimationFrame(FLOW.raf); FLOW.raf = 0; }
function flowTick(){
  FLOW.raf = requestAnimationFrame(flowTick);
  if(!FLOW.running || document.hidden) return;
  const m = MAP.map, D = curData(); if(!m || !D) return;
  const {x:W, y:Hh} = m.getSize(), ctx = FLOW.canvas.getContext("2d"), dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,Hh);
  const ti = MAP.ti, minV = state.mapLayer==="wind" ? 1 : 0.1;
  for(const p of FLOW.parts){
    const ll = m.containerPointToLatLng([p.x, p.y]), r = sampleAt(D, "v", ti, ll.lat, ll.lng), d = r ? dirAt(D, ti, ll.lat, ll.lng) : null;
    if(!r || d==null || r.v < minV){ spawn(p, W, Hh); continue; }
    const st = flowStyle(D, ti, ll.lat, ll.lng, r.v), tr = ((d+180)%360)*DEG;
    p.x += Math.sin(tr)*st.speed; p.y -= Math.cos(tr)*st.speed; p.age++;
    if(p.age > p.life || p.x<-20 || p.y<-20 || p.x>W+20 || p.y>Hh+20){ spawn(p, W, Hh); continue; }
    arrowGlyph(ctx, p.x, p.y, (d+180)%360, st.len, Math.sin(Math.PI*p.age/p.life)*0.95);
  }
}

function renderMapLegend(){
  const p = PAL[state.mapLayer], lo = p.stops[0][0], hi = p.stops[p.stops.length-1][0];
  const grad = p.stops.map(([v,c])=>`${c} ${((v-lo)/(hi-lo)*100).toFixed(1)}%`).join(",");
  document.getElementById("mapLegend").innerHTML = `<b>${p.name} (${p.unit})</b><div class="bar" style="background:linear-gradient(90deg,${grad})"></div><div class="ticks">${p.ticks.map(t=>`<span>${t}</span>`).join("")}</div>`;
}
function setMapTime(ti){
  const D = curData(); if(!D) return;
  MAP.ti = clamp(ti, 0, D.times.length-1);
  const t = tp(D.times[MAP.ti]), dt = new Date(t);
  document.getElementById("mapSlider").value = MAP.ti;
  document.getElementById("mapWhen").textContent = `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} · ${dt.getUTCHours()}h`;
  drawMap();
}
async function refreshMap(){
  const load = document.getElementById("mapLoad");
  try{
    if(!window.L){
      loadCss("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    }
    if(!MAP.map){
      const [c, z] = VIEWS.atlantique;
      // La carte ne peut pas sortir du monde : ni au-delà des pôles, ni trop loin sur les côtés
      const m = MAP.map = L.map("mapFrame", {center:c, zoom:z, minZoom:2, maxZoom:9, worldCopyJump:true, zoomControl:true,
        maxBounds:[[-78,-200],[82,200]], maxBoundsViscosity:1});
      const fitMinZoom = () => { const z0 = m.getBoundsZoom([[-78,-200],[82,200]], true); m.setMinZoom(Math.max(2, Math.ceil(z0))); };
      fitMinZoom(); m.on("resize", fitMinZoom);
      m.attributionControl.setPrefix(""); m.attributionControl.addAttribution("Open-Meteo · Natural Earth");
      m.createPane("field").style.zIndex = 250;
      m.createPane("flow").style.zIndex = 260; m.getPane("flow").style.pointerEvents = "none";
      MAP.canvas = L.DomUtil.create("canvas", "", m.getPane("field"));
      FLOW.canvas = L.DomUtil.create("canvas", "", m.getPane("flow"));
      m.on("movestart zoomstart", flowPause);
      m.on("zoomstart", ()=>{ MAP.canvas.style.opacity = 0; });
      m.on("moveend", ()=>{ MAP.canvas.style.opacity = 1; drawMap(); flowReset(); });
      m.on("resize", ()=>{ drawMap(); flowReset(); });
      m.on("click", e=>{
        const D = curData(); if(!D) return;
        const {lat, lng} = e.latlng, ti = MAP.ti, d = dirAt(D, ti, lat, lng), v = sampleAt(D, "v", ti, lat, lng);
        if(!v) return;
        let html;
        if(state.mapLayer==="wind") html = `<b>Vent ${Math.round(v.v)} nds</b>${d!=null?`<br>De ${card(d)} (${Math.round(d)}°)`:""}`;
        else { const p = sampleAt(D, "p", ti, lat, lng); html = `<b>Houle ${v.v.toFixed(1)} m</b>${p?` · ${Math.round(p.v)} s`:""}${d!=null?`<br>De ${card(d)} (${Math.round(d)}°)`:""}${p?`<br>Énergie ${Math.round(ENERGY(v.v, p.v))} kJ`:""}`; }
        L.popup({closeButton:false}).setLatLng(e.latlng).setContent(html).openOn(MAP.map);
      });
      loadLand().catch(err=>console.warn("Côtes non chargées :", err.message));
    }
    MAP.map.invalidateSize();
    const kind = layerKey(state.mapLayer);
    if(!MAP.data[kind] || Date.now()-MAP.data[kind].at >= 3600e3){ load.hidden = false; load.textContent = "Chargement de la carte…"; }
    const D = await fetchLayerData(kind);
    load.hidden = true;
    const slider = document.getElementById("mapSlider"); slider.max = D.times.length-1;
    if(!MAP.tiSet){ const now = nowNaive(); MAP.ti = Math.max(0, D.times.findIndex(t=>tp(t) + 1.5*H >= now)); MAP.tiSet = true; }
    const g = D.generated ? new Date(D.generated.replace("Z",":00Z")) : null;
    document.getElementById("mapStamp").textContent = g ? `Prévisions préparées le ${g.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} à ${g.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}.` : "";
    const sp = SPOTS.find(x=>x.id===state.spot);
    document.getElementById("windyLink").href = `https://www.windy.com/${sp.lat}/${sp.lon}?waves,${sp.lat},${sp.lon},6`;
    renderMapLegend(); setMapTime(MAP.ti); flowReset();
  }catch(err){
    load.hidden = false; load.textContent = "Carte indisponible : " + err.message + ". Vérifie ta connexion.";
  }
}
function stopMapAnim(){ clearInterval(MAP.timer); MAP.timer = null; const b = document.getElementById("mapPlay"); b.textContent = "▶"; b.setAttribute("aria-label","Lancer l'animation"); }
document.getElementById("mapPlay").addEventListener("click", ()=>{
  if(MAP.timer) return stopMapAnim();
  const b = document.getElementById("mapPlay"); b.textContent = "❚❚"; b.setAttribute("aria-label","Mettre en pause");
  MAP.timer = setInterval(()=>{ const D = curData(); if(!D) return; setMapTime(MAP.ti+1 >= D.times.length ? 0 : MAP.ti+1); }, 700);
});
document.getElementById("mapSlider").addEventListener("input", e=>{ stopMapAnim(); setMapTime(+e.target.value); });
document.getElementById("segZoom").addEventListener("click", e=>{ const b = e.target.closest("[data-z]"); if(!b || !MAP.map) return; const [c, z] = VIEWS[b.dataset.z]; MAP.map.flyTo(c, z, {duration:0.8}); });

// ---------- Onglet météo : 7 jours, une carte par jour ----------
const WX = {0:["☀️","Ciel dégagé"],1:["🌤️","Plutôt dégagé"],2:["⛅","Partiellement nuageux"],3:["☁️","Couvert"],45:["🌫️","Brouillard"],48:["🌫️","Brouillard givrant"],
  51:["🌦️","Bruine légère"],53:["🌦️","Bruine"],55:["🌦️","Bruine forte"],56:["🌧️","Bruine verglaçante"],57:["🌧️","Bruine verglaçante"],61:["🌧️","Pluie faible"],63:["🌧️","Pluie"],65:["🌧️","Pluie forte"],
  66:["🌧️","Pluie verglaçante"],67:["🌧️","Pluie verglaçante"],71:["🌨️","Neige faible"],73:["🌨️","Neige"],75:["❄️","Neige forte"],77:["🌨️","Grains de neige"],
  80:["🌦️","Averses"],81:["🌦️","Averses"],82:["⛈️","Fortes averses"],85:["🌨️","Averses de neige"],86:["🌨️","Averses de neige"],95:["⛈️","Orage"],96:["⛈️","Orage et grêle"],99:["⛈️","Orage et grêle"]};
const wxCache = {};
async function renderMeteo(){
  const spot = SPOTS.find(x=>x.id===state.spot), box = document.getElementById("wxGrid");
  let d = wxCache[spot.id];
  if(!d || Date.now()-d.at > 30*60e3){
    box.innerHTML = `<p class="pd-hint">Chargement de la météo…</p>`;
    try{
      const j = await getJSON("https://api.open-meteo.com/v1/forecast?"+qs({latitude:spot.lat, longitude:spot.lon, timezone:TZ, forecast_days:7, wind_speed_unit:"kn",
        daily:"weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max"}));
      d = wxCache[spot.id] = {at:Date.now(), j};
    }catch(err){ box.innerHTML = `<p class="pd-hint">Météo indisponible : vérifie ta connexion.</p>`; return; }
  }
  if(state.view !== "meteo" || state.spot !== spot.id) return;
  const D = d.j.daily, todayKey = dayKey(nowNaive());
  const sst = last && last.spot.id===spot.id ? series(last.data.s, "sea_surface_temperature") : null;
  box.innerHTML = D.time.map((day, i)=>{
    const [ico, labw] = WX[D.weather_code[i]] || ["·", "—"], dt = new Date(tp(day));
    const eau = sst ? [...sst.entries()].filter(([t])=>dayKey(t)===day).map(([,v])=>v) : [];
    const r = v => v==null ? "–" : Math.round(v);
    return `<div class="wx${day===todayKey?" today":""}"><div class="wx-day">${day===todayKey?"Aujourd'hui":`${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()}`}</div>
      <div class="wx-ico" aria-hidden="true">${ico}</div><div class="wx-lab">${labw}</div>
      <div class="wx-t">${r(D.temperature_2m_max[i])}° <small>/ ${r(D.temperature_2m_min[i])}°</small></div>
      <div class="wx-l">Pluie <b>${D.precipitation_sum[i]==null?"–":D.precipitation_sum[i].toFixed(1)} mm</b> · ${r(D.precipitation_probability_max[i])} %</div>
      <div class="wx-l">Vent <b>${r(D.wind_speed_10m_max[i])}</b> · rafales <b>${r(D.wind_gusts_10m_max[i])}</b> nds</div>
      <div class="wx-l">UV <b>${r(D.uv_index_max[i])}</b>${eau.length?` · eau <b>${Math.round(eau.reduce((a,b)=>a+b,0)/eau.length)}°</b>`:""}</div></div>`;
  }).join("");
}
function renderView(){
  if(state.mapLayer!=="swell" && state.mapLayer!=="period" && state.mapLayer!=="wind") state.mapLayer = "swell";
  const map = state.view === "map", meteo = state.view === "meteo", table = !map && !meteo;
  document.querySelectorAll("#viewTabs button").forEach(b=>b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
  const selTab = document.querySelector(`#viewTabs [data-view="${state.view}"]`), bar = document.getElementById("viewTabs");
  if(selTab) bar.scrollLeft = selTab.offsetLeft - (bar.clientWidth - selTab.offsetWidth)/2;   // onglet actif visible sur téléphone
  document.getElementById("mapView").hidden = !map;
  document.getElementById("meteoView").hidden = !meteo;
  ["out","legend"].forEach(id=>document.getElementById(id).hidden = !table);
  document.querySelector(".notes").hidden = !table;
  document.querySelector(".controls").hidden = !table || !state.showCtl;
  document.getElementById("dispBtn").hidden = !table;
  document.getElementById("dispBtn").setAttribute("aria-expanded", String(!!state.showCtl));
  if(!map){ if(MAP.timer) stopMapAnim(); flowStop(); }
  if(meteo) return renderMeteo();
  if(table){ if(last) render(last.spot, last.data); return; }
  syncSeg("segLayer", state.mapLayer);
  refreshMap();
}
document.getElementById("dispBtn").addEventListener("click", ()=>{ state.showCtl = !state.showCtl; persist(); renderView(); });
document.getElementById("viewTabs").addEventListener("click", e=>{ const b = e.target.closest("[data-view]"); if(!b) return; state.view = b.dataset.view; persist(); renderView(); });
document.getElementById("segLayer").addEventListener("click", e=>{ const b = e.target.closest("button"); if(!b) return; state.mapLayer = b.dataset.v; persist(); renderView(); });

syncCustomSpots(); applyTheme(); renderWho(); renderSpots(); syncControls(); renderView(); show(false);



// ---------- Créer ton spot ----------
const nsDlg = document.getElementById("newSpotDlg"), NS = {map:null, marker:null, lat:null, lon:null};
const NS_BOUNDS = [[42.9,-4.6],[46.4,-0.9]];   // golfe de Gascogne : la marée de Socoa y reste proche de la réalité
const clean = t => t.replace(/[<>&"']/g, "").trim();
function nsMsg(t, err){ const m = document.getElementById("nsMsg"); m.textContent = t || ""; m.className = "fmsg" + (err ? " err" : ""); }
async function openNewSpot(){
  nsDlg.showModal(); nsMsg("");
  try{
    if(!window.L){
      loadCss("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    }
  }catch(e){ return nsMsg("Carte indisponible : " + e.message, true); }
  if(NS.map){ NS.map.invalidateSize(); return; }
  const cur = SPOTS.find(x=>x.id===state.spot);
  const m = NS.map = L.map("nsMap", {center:[cur.lat, cur.lon], zoom:13, minZoom:7, maxBounds:NS_BOUNDS, maxBoundsViscosity:1});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:18, attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(m);
  m.attributionControl.setPrefix("");
  m.on("click", async e=>{
    const {lat, lng} = e.latlng;
    if(!L.latLngBounds(NS_BOUNDS).contains(e.latlng)) return;
    NS.lat = +lat.toFixed(4); NS.lon = +lng.toFixed(4);
    if(NS.marker) NS.marker.setLatLng(e.latlng); else NS.marker = L.marker(e.latlng).addTo(m);
    document.getElementById("nsWhere").textContent = `Spot placé : ${NS.lat}, ${NS.lon}`;
    try{   // commune la plus proche (OpenStreetMap / Nominatim, une requête par point placé)
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=fr&lat=${NS.lat}&lon=${NS.lon}`);
      const a = (await r.json()).address || {};
      const town = a.city || a.town || a.village || a.municipality || a.county;
      if(town) document.getElementById("nsTown").value = clean(town).slice(0, 30);
    }catch(_){ /* pas grave : l'utilisateur tape la commune */ }
  });
  setTimeout(()=>m.invalidateSize(), 50);
}
nsDlg.addEventListener("click", e=>{ if(e.target===nsDlg || e.target.closest("[data-close]")) nsDlg.close(); });
document.getElementById("nsForm").addEventListener("submit", e=>{
  e.preventDefault();
  if(NS.lat==null) return nsMsg("Touche d'abord la carte pour placer ton spot.", true);
  const num = id => norm(parseFloat(document.getElementById(id).value));
  const sw = [num("nsSw0"), num("nsSw1")], wi = [num("nsWi0"), num("nsWi1")];
  if([...sw, ...wi].some(Number.isNaN)) return nsMsg("Indique les 4 directions en degrés.", true);
  const name = clean(document.getElementById("nsName").value), town = clean(document.getElementById("nsTown").value);
  if(!name || !town) return nsMsg("Donne un nom et une commune à ton spot.", true);
  // Orientation de la plage déduite du bon vent : la plage regarde à l'opposé du vent de terre
  const sp = {id:"u"+Date.now().toString(36), town, name, lat:NS.lat, lon:NS.lon, face:norm(arcMid(wi)+180), custom:true, sw, wi};
  state.mySpots = [...(state.mySpots||[]), sp];
  state.favs = [...(state.favs||[]), sp.id];
  state.spot = sp.id;
  syncCustomSpots(); persist(); renderSpots(); renderView(); show(false);
  e.target.reset(); NS.lat = NS.lon = null; if(NS.marker){ NS.marker.remove(); NS.marker = null; }
  document.getElementById("nsWhere").textContent = "Aucun point placé.";
  nsDlg.close();
});

// ---------- Compte : connexion, synchronisation ----------
const rowToSess = r => ({id:r.id, spot:r.spot, date:r.date, h0:r.h0, h1:r.h1, rating:r.rating, note:r.note||"", f:r.f, savedAt:r.saved_at});
const sessToRow = x => ({id:x.id, spot:x.spot, date:x.date, h0:x.h0, h1:x.h1, rating:x.rating, note:x.note||null, f:x.f});
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2,10));
function accMsg(text, err){ const m = document.getElementById("accMsg"); m.textContent = text || ""; m.className = "fmsg" + (err ? " err" : ""); }
const FR_ERR = {
  "Invalid login credentials": "Email ou mot de passe incorrect.",
  "Email not confirmed": "Confirme d'abord ton email : clique sur le lien reçu, puis reconnecte-toi.",
  "User already registered": "Un compte existe déjà avec cet email : connecte-toi.",
};
const frErr = e => FR_ERR[e.message] || e.message;

async function useAccount(user){
  const cached = store.account && store.account.id===user.id ? store.account.state : null;
  const seed = cached || store.users[store.current];   // 1re connexion : on reprend les réglages du profil actuel
  account = {id:user.id, email:user.email, ready:false};
  state = {...defaultPrefs(), ...prefsOf(seed || {}), sessions: cached ? cached.sessions : []};
  applyPageSpot();
  store.account = {id:user.id, email:user.email, state};
  save("profiles", store); applyAll(); renderAccount();
  try{
    const [p, r] = await Promise.all([
      sb.from("profiles").select("prefs").eq("id", user.id).maybeSingle(),
      sb.from("sessions").select("*").order("date", {ascending:false}),
    ]);
    if(p.error) throw p.error; if(r.error) throw r.error;
    if(!account || account.id!==user.id) return;
    if(p.data && p.data.prefs){ Object.assign(state, defaultPrefs(), p.data.prefs); applyPageSpot(); }
    state.sessions = r.data.map(rowToSess);
    account.ready = true;
    // Admin ? (table admins : seul l'admin peut lire sa propre ligne)
    sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle().then(({data})=>{ if(account && account.id===user.id){ account.admin = !!data; renderAccount(); } });
    // Dernière visite : colonne last_seen (supabase/schema.sql), visible uniquement dans le tableau de bord Supabase
    sb.from("profiles").upsert({id:user.id, last_seen:new Date().toISOString()}).then(({error})=>{ if(error) console.warn("Dernière visite non enregistrée :", error.message); });
    if(!p.data) syncPrefsSoon();   // crée la fiche du compte avec les réglages actuels
    save("profiles", store); applyAll(); renderAccount();
  }catch(err){
    accMsg("Synchronisation impossible : " + frErr(err) + " Tes données restent affichées depuis cet appareil.", true);
  }
}
function leaveAccount(){
  account = null; store.account = null;
  useProfile(store.current); save("profiles", store); applyAll(); renderAccount();
}
async function loadAppConfig(){
  if(!sb) return;
  const {data, error} = await sb.from("app_config").select("key,value");
  if(error || !data) return;
  for(const r of data) if(r.key === "bicho_enabled") APP.bicho = r.value !== false;
  save("appcfg", APP); applyAppConfig();
}
function applyAppConfig(){
  document.getElementById("bichoOpen").hidden = !(APP.bicho && shown("bicho"));
  if(!APP.bicho && bkDlg.open) bkDlg.close();
  if(last && (state.view==="fc" || state.view==="hist")) render(last.spot, last.data);
}
document.getElementById("admBicho").addEventListener("change", async e=>{
  const on = e.target.checked, msg = document.getElementById("admMsg");
  const {error} = await sb.from("app_config").upsert({key:"bicho_enabled", value:on});
  if(error){ e.target.checked = !on; msg.className = "fmsg err"; msg.textContent = "Réglage non enregistré : " + error.message; return; }
  APP.bicho = on; save("appcfg", APP); applyAppConfig(); renderPrefs();
  msg.className = "fmsg"; msg.textContent = on ? "Bichomètre activé pour tout le monde." : "Bichomètre désactivé pour tout le monde.";
});
function renderAccount(){
  document.getElementById("adminSec").hidden = !(account && account.admin);
  document.getElementById("admBicho").checked = APP.bicho;
  const logged = !!account;
  document.getElementById("accForm").hidden = logged || !document.getElementById("accNewPass").hidden;
  document.getElementById("accIn").hidden = !logged;
  if(!sb){ document.getElementById("accForm").hidden = true; accMsg("Connexion indisponible (pas de réseau). Recharge l'appli une fois connecté à Internet.", true); }
  if(!logged) return;
  document.getElementById("accMail").textContent = account.email;
  // Sessions notées sans compte dans ce navigateur : proposer de les ajouter au compte
  const known = new Set(state.sessions.map(x=>x.id));
  const local = Object.entries(store.users).flatMap(([n,u])=>(u.sessions||[]).filter(x=>!known.has(x.id)).map(x=>({...x, _p:n})));
  document.getElementById("accImport").innerHTML = local.length && account.ready
    ? `<div class="acc-imp"><span>Ce navigateur contient <b>${local.length}</b> session${local.length>1?"s":""} notée${local.length>1?"s":""} sans compte.</span><button class="btn" type="button" id="accImportBtn">Les ajouter à mon compte</button></div>` : "";
}
document.getElementById("accImport").addEventListener("click", async e=>{
  if(!e.target.closest("#accImportBtn")) return;
  const known = new Set(state.sessions.map(x=>x.id));
  const local = Object.values(store.users).flatMap(u=>(u.sessions||[]).filter(x=>!known.has(x.id)));
  const {error} = await sb.from("sessions").upsert(local.map(sessToRow));
  if(error) return accMsg("Import impossible : " + frErr(error), true);
  state.sessions.push(...local);
  Object.values(store.users).forEach(u=>{ u.sessions = []; });
  save("profiles", store); applyAll(); renderAccount();
  accMsg(`${local.length} session${local.length>1?"s":""} ajoutée${local.length>1?"s":""} à ton compte.`);
});
const credentials = () => ({email:document.getElementById("accEmail").value.trim(), password:document.getElementById("accPass").value});
document.getElementById("accForm").addEventListener("submit", async e=>{
  e.preventDefault(); if(!sb) return;
  accMsg("Connexion…");
  const {error} = await sb.auth.signInWithPassword(credentials());
  if(error) return accMsg(frErr(error), true);
  document.getElementById("accPass").value = ""; accMsg("Connecté. Tes réglages et tes sessions sont synchronisés.");
});
document.getElementById("accSignup").addEventListener("click", async ()=>{
  if(!sb) return;
  const c = credentials();
  if(!c.email || c.password.length < 8) return accMsg("Indique ton email et un mot de passe d'au moins 8 caractères.", true);
  accMsg("Création du compte…");
  const {data, error} = await sb.auth.signUp({...c, options:{emailRedirectTo: location.origin + location.pathname}});
  if(error) return accMsg(frErr(error), true);
  document.getElementById("accPass").value = "";
  accMsg(data.session ? "Compte créé, tu es connecté." : `Compte créé. Ouvre l'email envoyé à ${c.email}, clique sur le lien de confirmation, puis connecte-toi ici.`);
});
document.getElementById("accForgot").addEventListener("click", async ()=>{
  if(!sb) return;
  const email = document.getElementById("accEmail").value.trim();
  if(!email) return accMsg("Indique ton email, puis clique à nouveau sur « Mot de passe oublié ? ».", true);
  const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
  accMsg(error ? frErr(error) : `Email envoyé à ${email} : clique sur le lien pour choisir un nouveau mot de passe.`, !!error);
});
document.getElementById("accNewPass").addEventListener("submit", async e=>{
  e.preventDefault();
  const {error} = await sb.auth.updateUser({password:document.getElementById("accNewPw").value});
  if(error) return accMsg(frErr(error), true);
  document.getElementById("accNewPass").hidden = true; document.getElementById("accNewPw").value = "";
  renderAccount(); accMsg("Mot de passe changé.");
});
document.getElementById("accLogout").addEventListener("click", async ()=>{ await sb?.auth.signOut(); leaveAccount(); accMsg("Déconnecté."); });
let delArmed = false;
document.getElementById("accDelete").addEventListener("click", async e=>{
  const b = e.currentTarget;
  if(!delArmed){ delArmed = true; b.textContent = "Confirmer : tout supprimer définitivement"; accMsg("Ton compte, tes réglages et toutes tes sessions seront effacés. Clique à nouveau pour confirmer.", true); return; }
  delArmed = false; b.textContent = "Supprimer mon compte";
  const {error} = await sb.rpc("delete_my_account");
  if(error) return accMsg("Suppression impossible : " + frErr(error), true);
  await sb.auth.signOut(); leaveAccount(); accMsg("Compte supprimé.");
});
loadAppConfig();

// ---------- Suivi des visites, avec ou sans compte (anonyme : identifiant tiré au hasard par navigateur) ----------
// Le serveur ajoute l'adresse IP tronquée et le pays (fonctions visit_start / visit_ping, supabase/schema.sql)
const VISITOR = load("visitor", null) || newId(); save("visitor", VISITOR);
const VISIT = {id:null, ms:0, since:null, timer:null};
const deviceName = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Android/.test(u) ? "Android" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "PC Windows" : "Autre"; };
function visitTick(){   // cumule le temps passé appli visible à l'écran
  if(VISIT.since){ VISIT.ms += Date.now() - VISIT.since; VISIT.since = document.hidden ? null : Date.now(); }
  else if(!document.hidden) VISIT.since = Date.now();
}
function visitSave(){
  visitTick();
  if(!VISIT.id) return;
  // visit_ping rattache aussi la visite au compte si l'utilisateur vient de se connecter
  sb.rpc("visit_ping", {p_id:VISIT.id, p_seconds:Math.round(VISIT.ms/1000)}).then(({error})=>{ if(error) console.warn("Visite non enregistrée :", error.message); });
}
let visitStarting = false;
async function visitStart(){
  if(VISIT.id || visitStarting || !sb) return;
  visitStarting = true;
  const {data, error} = await sb.rpc("visit_start", {p_visitor:VISITOR, p_device:deviceName()});
  visitStarting = false;
  if(error){ console.warn("Visite non enregistrée :", error.message); return; }
  VISIT.id = data; VISIT.ms = 0; VISIT.since = document.hidden ? null : Date.now();
  VISIT.timer = setInterval(visitSave, 30000);
}
document.addEventListener("visibilitychange", visitSave);
window.addEventListener("pagehide", visitSave);

document.getElementById("admUsersBtn").addEventListener("click", async ()=>{
  const box = document.getElementById("admUsers"); box.textContent = "Chargement…";
  const {data, error} = await sb.rpc("admin_visitor_stats");
  if(error){ box.textContent = "Impossible de charger : " + frErr(error); return; }
  const d = v => v ? new Date(v).toLocaleString("fr-FR", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"}) : "–";
  const accounts = data.filter(r=>r.email).length, day = Date.now() - 864e5, week = Date.now() - 7*864e5;
  const recent = t => data.filter(r=>new Date(r.last_visit).getTime() > t).length;
  box.innerHTML = `<p class="pd-hint"><b>${data.length}</b> visiteur${data.length>1?"s":""} (${accounts} avec compte) · ${recent(day)} sur 24 h · ${recent(week)} sur 7 jours</p><table class="adm-users"><tr><th>Visiteur</th><th>1re visite</th><th>Dernière visite</th><th>Visites</th><th>Temps total</th><th>Appareil</th><th>IP (tronquée)</th><th>Pays</th></tr>${data.map(r=>`<tr><td>${r.email ? esc(r.email) : "Anonyme · " + esc(r.visitor.slice(0,6))}</td><td>${d(r.first_visit)}</td><td>${d(r.last_visit)}</td><td>${r.visits}</td><td>${r.minutes} min</td><td>${esc(r.device||"–")}</td><td>${esc(r.ip||"–")}</td><td>${esc(r.country||"–")}</td></tr>`).join("")}</table>`;
});
if(sb){
  sb.auth.onAuthStateChange((event, session)=>{
    // Hors du callback : la bibliothèque déconseille d'appeler Supabase directement dedans
    setTimeout(()=>{
      const u = session && session.user;
      if(event==="PASSWORD_RECOVERY"){ document.getElementById("accNewPass").hidden = false; openPrefs(); accMsg("Choisis ton nouveau mot de passe."); }
      if(u && (!account || account.id!==u.id || !account.ready)) useAccount(u);
      else if(!u && account) leaveAccount();
      if(VISIT.id) visitSave(); else visitStart();   // connexion en cours de visite : la visite est rattachée au compte
      renderAccount(); renderWho();
    }, 0);
  });
}

// ---------- Sessions notées ----------
const sessDlg = document.getElementById("sessDlg");
let sfRating = null, sfSpotId = null;
const naiveToUtc = n => { let u = n - 2*H; u = n - (toNaive(u) - u); return n - (toNaive(u) - u); };
const isoDay = ms => new Date(ms).toISOString().slice(0,10);
const circMean = arr => { const v = arr.filter(x=>x!=null); if(!v.length) return null; const sx = v.reduce((a,d)=>a+Math.sin(d*DEG),0), cx = v.reduce((a,d)=>a+Math.cos(d*DEG),0); return (Math.atan2(sx,cx)/DEG+360)%360; };
const mean = arr => { const v = arr.filter(x=>x!=null); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };

// Conditions réelles pendant la session : houle et vent (Open-Meteo, données passées) + marée calculée
async function fetchConditions(spot, date, h0, h1){
  const common = {latitude:spot.lat, longitude:spot.lon, timezone:TZ, start_date:date, end_date:date};
  const [mar, met, gfs] = await Promise.all([
    getJSON("https://marine-api.open-meteo.com/v1/marine?"+qs({...common, hourly:"wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_peak_period,swell_wave_direction"})),
    getJSON("https://api.open-meteo.com/v1/forecast?"+qs({...common, hourly:"wind_speed_10m,wind_direction_10m,pressure_msl", wind_speed_unit:"kn"})),
    getJSON("https://marine-api.open-meteo.com/v1/marine?"+qs({...common, hourly:"wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction", models:"ncep_gfswave016"})).catch(()=>null),
  ]);
  const hours = []; for(let h=h0; h<=Math.max(h0,h1); h++) hours.push(tp(date+"T"+String(h).padStart(2,"0")+":00"));
  const M = k => series(mar,k), W = k => series(met,k);
  const hs = M("wave_height"), tm = M("wave_period"), wd = M("wave_direction"), sh = M("swell_wave_height"), sp = M("swell_wave_period"), sd = M("swell_wave_direction");
  const ws = W("wind_speed_10m"), wdir = W("wind_direction_10m"), pr = W("pressure_msl");
  const G = k => gfs ? series(gfs, k) : new Map(), gH = G("wave_height"), gP = G("wave_period"), gD = G("wave_direction");
  const H_ = mean(hours.map(t=>gH.get(t))) ?? mean(hours.map(t=>hs.get(t))), swH = mean(hours.map(t=>sh.get(t)));
  const tpk = M("swell_wave_peak_period");
  const per = mean(hours.map(t=>gP.get(t))) ?? mean(hours.map(t=>tpk.get(t))) ?? (swH!=null && H_ && swH >= 0.5*H_ ? mean(hours.map(t=>sp.get(t))) : null) ?? mean(hours.map(t=>tm.get(t)));
  const dir = circMean(hours.map(t=>gD.get(t))) ?? circMean(hours.map(t=>sd.get(t) ?? wd.get(t)));
  // vent : moyenne des composantes on/off et side, puis vitesse moyenne
  const comps = hours.map(t=>ws.get(t)!=null && wdir.get(t)!=null ? windComp(ws.get(t), wdir.get(t), spot.face) : null).filter(Boolean);
  const wsM = mean(hours.map(t=>ws.get(t)));
  // marée au milieu de la session (+ surcote météo)
  const mid = tp(date+"T00:00") + ((h0 + Math.max(h0,h1)) / 2) * H, u = naiveToUtc(mid);
  const P = pr.get(Math.floor(mid/H)*H);
  const tide = tideAt(TIDE.socoa, u) + (P!=null ? (1013.25-P)*0.01 : 0);
  const rising = tideAt(TIDE.socoa, u+30*60e3) > tideAt(TIDE.socoa, u-30*60e3);
  if(H_==null || per==null) throw new Error("Pas de données de houle pour cette date.");
  const f = feat(H_, per, dir, wsM, null, tide, rising, spot);
  if(comps.length){ f.on = mean(comps.map(c=>c.on)); f.side = mean(comps.map(c=>c.side)); }
  // Houle 1 / houle 2 moyennes sur la session (GFS-Wave)
  const swAvg = (hk, pk, dk) => { const hh = mean(hours.map(t=>G(hk).get(t))); return hh==null ? null : {h:hh, p:mean(hours.map(t=>G(pk).get(t))), d:circMean(hours.map(t=>G(dk).get(t)))}; };
  f.s1 = swAvg("swell_wave_height","swell_wave_period","swell_wave_direction");
  f.s2 = swAvg("secondary_swell_wave_height","secondary_swell_wave_period","secondary_swell_wave_direction");
  const ww = swAvg("wind_wave_height","wind_wave_period","wind_wave_direction");
  const parts = [f.s1, f.s2, ww].filter(x=>x && x.h > 0 && x.p > 0);
  if(parts.length) f.e = parts.reduce((a, x)=>a + ENERGY(x.h, x.p), 0);
  return f;
}

function fillSessForm(){
  const spotSel = document.getElementById("sfSpot");
  const keep = sfSpotId || state.spot;
  spotSel.innerHTML = SPOTS.map(x=>`<option value="${x.id}" ${x.id===keep?"selected":""}>${x.town} · ${x.name}</option>`).join("");
  const today = isoDay(nowNaive()), min = isoDay(nowNaive() - 90*24*H);
  const d = document.getElementById("sfDate"); d.max = today; d.min = min; if(!d.value || d.value>today || d.value<min) d.value = today;
  const opts = sel => Array.from({length:18},(_,i)=>i+5).map(h=>`<option value="${h}" ${h===sel?"selected":""}>${h}h</option>`).join("");
  const hNow = new Date(nowNaive()).getUTCHours(), st = clamp(hNow-2, 5, 21);
  document.getElementById("sfStart").innerHTML = opts(st);
  document.getElementById("sfEnd").innerHTML = opts(st+1);
  dark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.getElementById("sfRate").innerHTML = Array.from({length:11},(_,i)=>`<button type="button" data-r="${i}" style="${scoreBg(i)}" aria-pressed="${sfRating===i}">${i}</button>`).join("");
}
function renderSessList(){
  const list = [...state.sessions].sort((a,b)=>b.date.localeCompare(a.date) || b.h0-a.h0);
  const box = document.getElementById("sessList");
  if(!list.length){ box.innerHTML = `<p class="sempty">Aucune session pour l'instant. Note ta prochaine session : la note du spot s'adaptera à tes goûts dans des conditions similaires.</p>`; return; }
  box.innerHTML = list.map(x=>{
    const sp = SPOTS.find(y=>y.id===x.spot), dt = new Date(tp(x.date));
    const when = `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()}/${String(dt.getUTCMonth()+1).padStart(2,"0")} · ${x.h0}h–${x.h1}h`;
    const cond = x.f ? `${x.f.hs.toFixed(1)} m · ${Math.round(x.f.per)} s · ${Math.round(x.f.e)} kJ · vent ${Math.round(x.f.ws ?? 0)} nds ${x.f.on>2?"onshore":x.f.on<-2?"offshore":"side"} · marée ${x.f.tide.toFixed(1)} m ${x.f.rising?"montante":"descendante"}` : "conditions non disponibles";
    return `<div class="sitem"><span class="sn" style="${scoreBg(x.rating)}">${x.rating}</span><div><b>${sp?esc(sp.town+" · "+sp.name):"Spot inconnu"}</b><span>${when}</span><span>${cond}</span>${x.note?`<i>${esc(x.note)}</i>`:""}</div><button class="del" type="button" data-del="${x.id}">Supprimer</button></div>`;
  }).join("");
}
function openSess(withForm){
  document.getElementById("sessForm").hidden = !withForm;
  document.getElementById("sdTitle").textContent = withForm ? "Noter une session" : "Mes sessions";
  document.getElementById("sfMsg").textContent = ""; document.getElementById("sfMsg").className = "fmsg";
  sfRating = null; sfSpotId = null; fillSessForm(); renderSessList(); sessDlg.showModal();
}
document.getElementById("logBtn").addEventListener("click", ()=>openSess(true));
document.getElementById("mySess").addEventListener("click", ()=>openSess(false));
document.getElementById("sfStart").addEventListener("change", e=>{ const en = document.getElementById("sfEnd"); if(+en.value <= +e.target.value) en.value = String(Math.min(22, +e.target.value+1)); });
sessDlg.addEventListener("click", e=>{
  if(e.target===sessDlg || e.target.closest("[data-close]")) return sessDlg.close();
  if(e.target.closest("#sfAccount")){ sessDlg.close(); openPrefs(); document.getElementById("accEmail").focus(); return; }
  const r = e.target.closest("[data-r]");
  if(r){ sfRating = +r.dataset.r; document.querySelectorAll("#sfRate button").forEach(b=>b.setAttribute("aria-pressed", String(+b.dataset.r===sfRating))); }
  const del = e.target.closest("[data-del]");
  if(del){
    const id = del.dataset.del;
    (async ()=>{
      if(account){ const {error} = await sb.from("sessions").delete().eq("id", id); if(error){ document.getElementById("sfMsg").className = "fmsg err"; document.getElementById("sfMsg").textContent = "Suppression impossible : " + frErr(error); return; } }
      state.sessions = state.sessions.filter(x=>x.id!==id); persist(); renderSessList(); applyAll();
    })();
  }
});
document.getElementById("sessForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const msg = document.getElementById("sfMsg"), btn = document.getElementById("sfSave");
  const spot = SPOTS.find(x=>x.id===document.getElementById("sfSpot").value); sfSpotId = spot.id;
  const date = document.getElementById("sfDate").value, h0 = +document.getElementById("sfStart").value, h1 = +document.getElementById("sfEnd").value;
  msg.className = "fmsg err";
  if(sfRating==null){ msg.textContent = "Choisis une note de 0 à 10."; return; }
  if(!date){ msg.textContent = "Indique la date de la session."; return; }
  if(h1 < h0){ msg.textContent = "L'heure de fin doit être après l'heure de début."; return; }
  if(tp(date+"T"+String(h0).padStart(2,"0")+":00") > nowNaive()){ msg.textContent = "Cette session n'a pas encore eu lieu."; return; }
  msg.className = "fmsg"; msg.textContent = "Récupération des conditions de la session…"; btn.disabled = true;
  let f = null;
  try{ f = await fetchConditions(spot, date, h0, h1); }
  catch(err){ msg.className = "fmsg err"; msg.textContent = "Conditions introuvables pour cette date : " + err.message + " La session n'est pas enregistrée."; btn.disabled = false; return; }
  const sess = {id:newId(), spot:spot.id, date, h0, h1, rating:sfRating, note:document.getElementById("sfNote").value.trim(), f, savedAt:new Date().toISOString()};
  if(account){
    const {error} = await sb.from("sessions").insert(sessToRow(sess));
    if(error){ msg.className = "fmsg err"; msg.textContent = "Session non enregistrée dans ton compte : " + frErr(error) + " Vérifie ta connexion et réessaie."; btn.disabled = false; return; }
  }
  state.sessions.push(sess);
  persist();
  msg.textContent = `Session enregistrée : ${f.hs.toFixed(1)} m à ${Math.round(f.per)} s, ta note ${sfRating}/10. Les notes du tableau sont mises à jour.`;
  if(!account && sb && state.sessions.length >= 2) msg.insertAdjacentHTML("beforeend", ` <button class="linkbtn" type="button" id="sfAccount">Crée un compte gratuit pour ne pas perdre tes sessions et les retrouver sur tous tes appareils.</button>`);
  btn.disabled = false; document.getElementById("sfNote").value = ""; sfRating = null; fillSessForm(); renderSessList(); applyAll();
});

// ---------- Bichomètre, mode terrain (pour rire : tout est tiré au sort, rien de réel) ----------
const bk = {heading:null, tab:"compass", on:false, raf:0, locked:false, audio:null, sweep:0, lastPing:{}, scanning:false};
const bkDlg = document.getElementById("bichoDlg");
// Tirage fixe par jour et par spot : tout le monde sur le même spot cherche au même endroit
function bkSeed(extra){ const s = dayKey(nowNaive()) + state.spot + (extra||""); let h = 2166136261; for(const ch of s){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
function bkOnOrient(e){
  const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute || e.type==="deviceorientationabsolute") && e.alpha != null ? (360 - e.alpha) % 360 : null;
  if(h != null) bk.heading = h;
}
let bkShakeT = 0;
function bkOnMotion(e){
  const a = e.accelerationIncludingGravity; if(!a || bk.tab!=="scan") return;
  const g = Math.hypot(a.x||0, a.y||0, a.z||0);
  if(g > 24 && Date.now() - bkShakeT > 1500){ bkShakeT = Date.now(); bkScan(); }
}
async function bkStart(){
  try{   // iPhone : autorisation explicite, sur un geste de l'utilisateur
    if(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") await DeviceOrientationEvent.requestPermission();
    if(window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === "function") await DeviceMotionEvent.requestPermission();
  }catch(e){}
  window.addEventListener("deviceorientationabsolute", bkOnOrient);
  window.addEventListener("deviceorientation", bkOnOrient);
  window.addEventListener("devicemotion", bkOnMotion);
  try{ bk.audio = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){}
  bk.on = true; document.getElementById("bkStart").hidden = true;
  bkShowTab(); if(!bk.raf) bk.raf = requestAnimationFrame(bkTick);
}
function bkStop(){
  window.removeEventListener("deviceorientationabsolute", bkOnOrient);
  window.removeEventListener("deviceorientation", bkOnOrient);
  window.removeEventListener("devicemotion", bkOnMotion);
  cancelAnimationFrame(bk.raf); bk.raf = 0; bk.on = false;
  if(bk.audio){ bk.audio.close().catch(()=>{}); bk.audio = null; }
}
function bkPing(freq){
  if(!bk.audio) return;
  const o = bk.audio.createOscillator(), g = bk.audio.createGain(), t = bk.audio.currentTime;
  o.frequency.value = freq; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g).connect(bk.audio.destination); o.start(t); o.stop(t + 0.4);
}
function bkShowTab(){
  syncSeg("bkTabs", bk.tab);
  if(!bk.on) return;
  for(const [t, id] of [["compass","bkCompass"],["radar","bkRadar"],["scan","bkScan"]]) document.getElementById(id).hidden = bk.tab !== t;
}
const BK_TARGET = () => Math.floor(bkSeed("cap") * 360);
function bkTick(){
  bk.raf = requestAnimationFrame(bkTick);
  if(bk.tab==="compass") bkCompass(); else if(bk.tab==="radar") bkRadar();
}
function bkCompass(){
  const heat = document.getElementById("bkHeat"), hint = document.getElementById("bkHint"), arrow = document.getElementById("bkArrow");
  if(bk.heading == null){ heat.textContent = "Boussole introuvable"; hint.textContent = "Il faut un téléphone avec boussole (pas un PC)."; return; }
  const diff = ((BK_TARGET() - bk.heading) % 360 + 540) % 360 - 180;   // -180..180, positif = tourner à droite
  arrow.style.transform = `rotate(${diff}deg)`;
  const a = Math.abs(diff);
  const lvl = a < 5 ? ["BB1 VERROUILLÉE", "#ff5fa2"] : a < 15 ? ["BRÛLANT", "#ff7a3d"] : a < 45 ? ["CHAUD", "#f2c14e"] : a < 90 ? ["Tiède", "#9bd94a"] : ["Froid", "#4fc1cc"];
  heat.textContent = lvl[0]; heat.style.color = lvl[1]; heat.classList.toggle("bk-lock", a < 5);
  hint.textContent = a < 5 ? "Ne bouge plus." : diff > 0 ? "Encore un peu à droite…" : "Encore un peu à gauche…";
  if(a < 5 && !bk.locked){ bk.locked = true; if(navigator.vibrate) navigator.vibrate([120, 60, 120]); bkPing(880); }
  if(a > 10) bk.locked = false;
}
function bkRadar(){
  const cv = document.getElementById("bkCanvas"), ctx = cv.getContext("2d"), W = cv.width, R = W/2 - 8, c = W/2;
  bk.sweep = (bk.sweep + 1.6) % 360;
  const rot = bk.heading != null ? -bk.heading : 0;   // le radar tourne avec le téléphone
  ctx.fillStyle = "rgba(4,16,12,.25)"; ctx.fillRect(0, 0, W, W);   // rémanence
  ctx.strokeStyle = "rgba(60,220,140,.35)"; ctx.lineWidth = 1;
  for(const r of [R, R*0.66, R*0.33]){ ctx.beginPath(); ctx.arc(c, c, r, 0, 2*Math.PI); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(c-R, c); ctx.lineTo(c+R, c); ctx.moveTo(c, c-R); ctx.lineTo(c, c+R); ctx.stroke();
  const sa = (bk.sweep - 90) * DEG;
  ctx.strokeStyle = "rgba(90,255,170,.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + R*Math.cos(sa), c + R*Math.sin(sa)); ctx.stroke();
  // Échos : positions tirées au sort pour le jour et le spot ; le gros = BB1
  const n = 3 + Math.floor(bkSeed("n") * 3);
  let txt = "Balayage en cours…";
  for(let i=0;i<n;i++){
    const brg = bkSeed("b"+i) * 360, dist = 0.25 + bkSeed("d"+i) * 0.7, big = i === 0;
    const scr = ((brg + rot) % 360 + 360) % 360, ang = (scr - 90) * DEG, x = c + R*dist*Math.cos(ang), y = c + R*dist*Math.sin(ang);
    const since = ((bk.sweep - scr) % 360 + 360) % 360;   // degrés depuis le passage du balayage
    if(since < 2 && (!bk.lastPing[i] || Date.now() - bk.lastPing[i] > 1000)){ bk.lastPing[i] = Date.now(); bkPing(big ? 1200 : 700); if(big && navigator.vibrate) navigator.vibrate(60); }
    const alpha = Math.max(0, 1 - since/300);
    ctx.fillStyle = big ? `rgba(255,95,162,${alpha})` : `rgba(90,255,170,${alpha})`;
    ctx.beginPath(); ctx.arc(x, y, big ? 7 : 4, 0, 2*Math.PI); ctx.fill();
    if(big && alpha > 0.2){ ctx.font = "700 13px Barlow, sans-serif"; ctx.fillText("BB1", x + 10, y + 4); txt = `BB1 détectée à ${Math.round(dist * 300)} m, cap ${Math.round(brg)}° (${card(brg)})`; }
  }
  document.getElementById("bkRadarTxt").textContent = txt;
}
const BK_STEPS = ["Calibration des capteurs à biches…", "Analyse des phéromones de wax…", "Triangulation par satellite (imaginaire)…", "Filtrage des mouettes…", "Croisement avec le coefficient de marée…"];
const BK_VERDICTS = [["Zone calme. Concentre-toi sur la houle.", "#4fc1cc"], ["Traces fraîches repérées.", "#9bd94a"], ["Activité suspecte au pic.", "#f2c14e"], ["ALERTE BB1 PAS LOIN", "#ff5fa2"], ["Signal brouillé : trop de néoprène.", "#8fa3b1"]];
function bkScan(){
  if(bk.scanning) return; bk.scanning = true;
  const fill = document.getElementById("bkBarFill"), step = document.getElementById("bkStep"), ver = document.getElementById("bkVerdict");
  ver.textContent = " "; let k = 0;
  const t = setInterval(()=>{
    k++; fill.style.width = (k*20) + "%"; step.textContent = BK_STEPS[(k-1) % BK_STEPS.length]; bkPing(400 + k*120);
    if(k >= 5){
      clearInterval(t);
      const v = BK_VERDICTS[Math.floor(Math.random() * BK_VERDICTS.length)];
      ver.textContent = v[0]; ver.style.color = v[1]; step.textContent = "Scan terminé.";
      if(navigator.vibrate) navigator.vibrate(v[1]==="#ff5fa2" ? [200,80,200,80,400] : 150);
      setTimeout(()=>{ fill.style.width = "0"; bk.scanning = false; }, 1500);
    }
  }, 550);
}
function bkOpen(){ bkShowTab(); bkDlg.showModal(); }
document.getElementById("bichoOpen").addEventListener("click", bkOpen);
document.getElementById("bichoOpen").hidden = !(APP.bicho && shown("bicho"));
document.getElementById("out").addEventListener("click", e=>{ if(APP.bicho && e.target.closest("tr.g-fun")) bkOpen(); });
document.getElementById("bkGo").addEventListener("click", bkStart);
document.getElementById("bkScanBtn").addEventListener("click", bkScan);
document.getElementById("bkTabs").addEventListener("click", e=>{ const b = e.target.closest("button"); if(!b) return; bk.tab = b.dataset.v; bkShowTab(); });
bkDlg.addEventListener("click", e=>{ if(e.target.closest("[data-close]")) bkDlg.close(); });
bkDlg.addEventListener("close", ()=>{ bkStop(); document.getElementById("bkStart").hidden = false; ["bkCompass","bkRadar","bkScan"].forEach(id=>document.getElementById(id).hidden = true); });

// Appli installable : cache hors ligne (uniquement quand le site est servi en http/https)
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  navigator.serviceWorker.register("/sw.js").catch(()=>{});
}
