import { clamp, arcGap, inArc } from "./physics.js";

// Note de base, avant tes sessions (dirs = bonnes directions du spot, {sw, wi}) : énergie de la houle, période et vent par rapport à la plage
export function baseScore(f, spot, dirs){
  if(!f) return null;
  let s = f.e>100 ? 10*clamp(Math.log(f.e/100)/Math.log(5000/100), 0, 1) : 0;   // seuils pour l'énergie façon Windguru
  if(f.hs>3.5 && !spot.big) s = Math.min(s, 6);
  if(spot.big && f.hs<4) s = Math.min(s, 2);
  if(f.per<8) s -= 2; else if(f.per<10) s -= 1;
  if(f.dir!=null){ const g = arcGap(f.dir, dirs.sw); if(g>25) s -= 2; else if(g>0) s -= 1; }
  const goodWind = f.wdir!=null && inArc(f.wdir, dirs.wi);
  if(f.ws!=null && !goodWind){
    if(f.on>0) s -= Math.min(5, 0.25*Math.max(0, f.on-4));
    s -= Math.min(3, 0.12*Math.max(0, f.side-8));
    if(-f.on>20) s -= 0.15*(-f.on-20);
    if(f.ws<5) s += 0.5;
  }
  return clamp(s, 0, 10);
}
