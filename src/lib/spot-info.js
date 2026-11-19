// Textes des pages de spot (référencement) : nom complet, titre de page, bonnes directions en clair.
import { SWELL } from "./spots.js";
import { norm } from "./physics.js";
import { card } from "./time.js";

const CARD_FR = {
  N:"nord", NNE:"nord-nord-est", NE:"nord-est", ENE:"est-nord-est", E:"est", ESE:"est-sud-est", SE:"sud-est", SSE:"sud-sud-est",
  S:"sud", SSO:"sud-sud-ouest", SO:"sud-ouest", OSO:"ouest-sud-ouest", O:"ouest", ONO:"ouest-nord-ouest", NO:"nord-ouest", NNO:"nord-nord-ouest",
};
export const cardFr = d => CARD_FR[card(d)];
const vowel = w => /^[aeiou]/.test(w);
const le = w => (vowel(w) ? "l'" : "le ") + w;   // « l'ouest », « le nord-ouest »
const de = w => (vowel(w) ? "d'" : "de ") + w;   // « d'ouest », « de nord-ouest »

// « Grande Plage, Biarritz » ; « Labenne Océan » quand le nom contient déjà la commune
export const spotLabel = s => s.name.toLowerCase().includes(s.town.toLowerCase()) ? s.name : `${s.name}, ${s.town}`;
export const spotPath = s => `/spots/${s.id}/`;
export const spotTitle = s => `Surf ${spotLabel(s)} · prévisions houle, vent et marée | Olatuak`;
export const spotDescription = s =>
  `Prévisions surf ${spotLabel(s)} : hauteur, période et énergie de la houle, vent offshore ou onshore, marée et coefficient, heure par heure sur 10 jours. Gratuit.`;

// Bonnes directions par défaut, comme dans l'appli (defaultDirs) : houle autour de la direction idéale, vent de terre
export function spotFacts(s){
  const [best, win] = SWELL[s.id] || [s.face], g = (win || [20])[0];
  const off = norm(s.face + 180);
  return {
    region: s.region || "Pays basque",
    faces: `${le(cardFr(s.face))} (${norm(s.face)}°)`,
    swell: `${de(cardFr(best))} (${norm(best - g)}° à ${norm(best + g)}°)`,
    wind: `${de(cardFr(off))} (${norm(s.face + 135)}° à ${norm(s.face + 225)}°)`,
  };
}
