// Calculs purs : angles, énergie de la houle, ressemblance entre deux créneaux.

export const DEG = Math.PI/180;
export const norm = d => ((Math.round(d)%360)+360)%360;
export const inArc = (d, [a,b]) => (d-a+360)%360 <= (b-a+360)%360;
export const arcGap = (d, arc) => inArc(d, arc) ? 0 : Math.min(angDiff(d, arc[0]), angDiff(d, arc[1]));
export const arcMid = ([a,b]) => norm(a + ((b-a+360)%360)/2);
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const angDiff = (a,b) => Math.abs(((a-b)%360+540)%360-180);
// Vent décomposé par rapport à la plage : on > 0 = vent de mer (onshore), on < 0 = vent de terre (offshore)
export function windComp(ws, wdir, face){ const r = (((wdir-face)%360+540)%360-180)*DEG; return {on: ws*Math.cos(r), side: Math.abs(ws*Math.sin(r))}; }
// Ressemblance entre deux créneaux (1 = conditions identiques)
export function similarity(a, b){
  let d2 = ((a.hs-b.hs)/(0.3*Math.max(0.6,(a.hs+b.hs)/2)))**2 + ((a.per-b.per)/2)**2 + ((a.on-b.on)/5)**2 + ((a.side-b.side)/7)**2;
  if(a.dir!=null && b.dir!=null) d2 += (angDiff(a.dir,b.dir)/30)**2;
  if(a.tide!=null && b.tide!=null) d2 += ((a.tide-b.tide)/0.8)**2 + (a.rising!==b.rising ? 0.3 : 0);
  // Houle 1 / houle 2 (sessions notées depuis novembre 2026 ; ignoré pour les plus anciennes)
  if(a.s1 && b.s1 && a.s1.d!=null && b.s1.d!=null) d2 += (angDiff(a.s1.d, b.s1.d)/30)**2;
  if(a.s2 && b.s2){
    d2 += ((a.s2.h - b.s2.h)/0.4)**2;
    if(a.s2.h >= 0.3 && b.s2.h >= 0.3) d2 += ((a.s2.p - b.s2.p)/3)**2 + (a.s2.d!=null && b.s2.d!=null ? (angDiff(a.s2.d, b.s2.d)/40)**2 : 0);
  }
  return Math.exp(-d2/2);
}
// Énergie d'une composante de houle (kJ) : ρ·g²·H²·T² / (16π) ≈ 1,96·H²·T² (même base que Windguru) ; on additionne les composantes
export const ENERGY = (h, t) => 1.96*h*h*t*t;
