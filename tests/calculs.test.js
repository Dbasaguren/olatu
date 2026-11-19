// Tests des calculs sensibles (marée, coefficient, angles, énergie, note). Lancer : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIDE, tideSeries, extremes, coefsByDay } from "../src/lib/tide.js";
import { tp, toNaive, dayKey, card } from "../src/lib/time.js";
import { angDiff, inArc, arcGap, arcMid, norm, ENERGY, windComp, similarity } from "../src/lib/physics.js";
import { baseScore } from "../src/lib/score.js";
import { SPOTS, SWELL } from "../src/lib/spots.js";
import { spotLabel, spotFacts } from "../src/lib/spot-info.js";

const H = 3600e3;

test("coefficient : marée du siècle du 21 mars 2015 (119 officiel, ±3)", () => {
  const c = coefsByDay(Date.UTC(2015, 2, 20), Date.UTC(2015, 2, 23));
  const max = Math.max(...Object.values(c).flat());
  assert.ok(Math.abs(max - 119) <= 3, `coefficient max calculé : ${max}`);
});

test("coefficient : toujours entre 20 et 120, deux par jour au plus", () => {
  const c = coefsByDay(Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1));
  for (const [day, list] of Object.entries(c)) {
    assert.ok(list.length <= 2, day);
    for (const v of list) assert.ok(v >= 20 && v <= 120, `${day} : ${v}`);
  }
});

test("marée de Socoa : 2 pleines mers et 2 basses mers environ par jour, hauteurs plausibles", () => {
  const t0 = Date.UTC(2026, 5, 1), pts = tideSeries(TIDE.socoa, t0, t0 + 10 * 24 * H, 10);
  const ex = extremes(pts);
  const pm = ex.filter(e => e.type === "PM"), bm = ex.filter(e => e.type === "BM");
  assert.ok(pm.length >= 18 && pm.length <= 21, `PM : ${pm.length}`);
  assert.ok(bm.length >= 18 && bm.length <= 21, `BM : ${bm.length}`);
  for (const e of pm) assert.ok(e.v > 3 && e.v < 5.2, `PM ${e.v}`);
  for (const e of bm) assert.ok(e.v > -0.2 && e.v < 2.2, `BM ${e.v}`);
  // les extrêmes alternent
  for (let i = 1; i < ex.length; i++) assert.notEqual(ex[i].type, ex[i - 1].type);
});

test("heure locale : passage à l'heure d'été (29 mars 2026, 2 h UTC+1 → 3 h UTC+2)", () => {
  assert.equal(toNaive(Date.UTC(2026, 2, 29, 0, 30)), tp("2026-03-29T01:30"));
  assert.equal(toNaive(Date.UTC(2026, 2, 29, 1, 30)), tp("2026-03-29T03:30"));
  assert.equal(dayKey(tp("2026-03-29T23:00")), "2026-03-29");
});

test("angles et arcs de bonnes directions", () => {
  assert.equal(angDiff(350, 10), 20);
  assert.equal(angDiff(90, 270), 180);
  assert.equal(norm(-30), 330);
  assert.ok(inArc(355, [340, 20]));          // arc qui passe par le nord
  assert.ok(!inArc(30, [340, 20]));
  assert.equal(arcGap(30, [340, 20]), 10);
  assert.equal(arcMid([340, 20]), 0);
  assert.equal(card(290), "ONO");
});

test("énergie de la houle : 1,96 × H² × T²", () => {
  assert.equal(Math.round(ENERGY(1.5, 12)), 635);
  assert.equal(ENERGY(0, 15), 0);
});

test("vent par rapport à la plage : de face = onshore, de dos = offshore", () => {
  const face = 300;
  assert.ok(windComp(10, 300, face).on > 9.9);     // vent venant de la mer
  assert.ok(windComp(10, 120, face).on < -9.9);    // vent de terre
  assert.ok(Math.abs(windComp(10, 30, face).on) < 1e-9 && windComp(10, 30, face).side > 9.9);
});

test("ressemblance : 1 pour des conditions identiques, plus faible quand elles s'écartent", () => {
  const a = { hs: 1.5, per: 12, dir: 300, on: -5, side: 2, tide: 2, rising: true };
  assert.equal(similarity(a, a), 1);
  assert.ok(similarity(a, { ...a, hs: 2.5 }) < similarity(a, { ...a, hs: 1.7 }));
});

test("note de base : bonne houle + vent de terre > même houle + vent de mer", () => {
  const spot = SPOTS.find(s => s.id === "cotebasques");
  const dirs = { sw: [270, 310], wi: [norm(spot.face + 135), norm(spot.face + 225)] };
  const f = (wdir) => { const w = windComp(10, wdir, spot.face); return { hs: 1.8, per: 13, dir: 290, ws: 10, wdir, on: w.on, side: w.side, e: ENERGY(1.8, 13) }; };
  const off = baseScore(f(100), spot, dirs), on = baseScore(f(280), spot, dirs);
  assert.ok(off > on, `offshore ${off} / onshore ${on}`);
  assert.ok(off >= 0 && off <= 10 && on >= 0 && on <= 10);
  assert.equal(baseScore(null, spot, dirs), null);
});

test("spots : identifiants uniques, coordonnées sur la côte, direction de houle définie", () => {
  const ids = SPOTS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SPOTS) {
    assert.match(s.id, /^[a-z]+$/);
    assert.ok(s.lat > 43.3 && s.lat < 44.6 && s.lon > -1.9 && s.lon < -1.2, s.id);
    assert.ok(SWELL[s.id], `SWELL manquant : ${s.id}`);
  }
});

test("textes des pages de spot", () => {
  assert.equal(spotLabel({ name: "Grande Plage", town: "Biarritz" }), "Grande Plage, Biarritz");
  assert.equal(spotLabel({ name: "Labenne Océan", town: "Labenne" }), "Labenne Océan");
  const f = spotFacts(SPOTS.find(s => s.id === "cotebasques"));
  assert.equal(f.faces, "l'ouest (280°)");
  assert.match(f.swell, /^d'ouest/);
});
