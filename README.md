# Olatuak

Prévisions surf pour la côte basque française et les Landes, de Biscarrosse à Hendaye : houle, période, énergie des vagues, vent offshore ou onshore, marée de Socoa et coefficient.

Application web installable (PWA) : ouvrir le site sur le téléphone puis « Ajouter à l'écran d'accueil ». Le compte est facultatif (il sert à retrouver ses réglages et ses sessions sur plusieurs appareils).

## Développer

Il faut [Node.js](https://nodejs.org) 22 ou plus.

```bash
npm install        # une fois
npm run dev        # site en local sur http://localhost:4321, rechargé à chaque modification
npm test           # tests des calculs (marée, coefficient, angles, note…)
npm run build      # site final dans dist/
```

## Organisation

| Dossier | Contenu |
|---|---|
| `src/scripts/app.js` | L'interface de l'appli (tableau, carte, comptes, sessions, Bichomètre) |
| `src/lib/` | Calculs purs, testés : spots, temps, marée, couleurs, physique de la houle, note de base |
| `src/components/AppBody.astro` | La structure HTML de l'appli |
| `src/layouts/Base.astro` | L'en-tête de page : titre, description, aperçu de lien, PWA |
| `src/pages/index.astro` | Accueil |
| `src/pages/spots/[id].astro` | Une page par spot (`/spots/cenitz/`…) pour Google, ouverte directement sur ce spot |
| `src/pages/sitemap.xml.js` | Plan du site généré automatiquement |
| `src/styles/app.css` | Styles |
| `public/` | Fichiers copiés tels quels : icônes, manifeste, service worker, confidentialité, `_headers` |
| `tests/` | Tests (`npm test`) |
| `supabase/schema.sql` | Base de données des comptes et des visites |
| `outils/`, `outils-maree/` | Scripts Python : données de la carte, constantes de marée |

Pour ajouter un spot : l'ajouter dans `src/lib/spots.js` (`SPOTS` et `SWELL`). Sa page et son entrée dans le plan du site sont créées automatiquement.

## Mise en ligne

**GitHub Pages** : `.github/workflows/mise-en-ligne.yml` teste, construit et publie le site à chaque push sur `main`. Réglage à faire une seule fois : Settings → Pages → Source : « GitHub Actions ».

**Cloudflare Pages** (recommandé) : Workers & Pages → Create → Pages → connecter le dépôt GitHub, puis
- Framework preset : Astro
- Build command : `npm run build`
- Build output directory : `dist`
- Variable d'environnement : `NODE_VERSION` = `22`

Puis ajouter le domaine `olatuak.eu` dans Custom domains. Le fichier `public/_headers` (cache, sécurité) est appliqué automatiquement.

## Données

- Prévisions de houle et de vent : [Open-Meteo](https://open-meteo.com) (Météo-France, DWD, ECMWF, NOAA), licence CC BY 4.0.
- Marée : constantes harmoniques calculées à partir des mesures des marégraphes de Socoa et de Brest, REFMAR / Shom, Licence Ouverte 2.0 ([doi:10.17183/REFMAR](https://doi.org/10.17183/REFMAR)). Ces prédictions ne sont pas vérifiées par le Shom.

Les scripts de recalcul des constantes sont dans `outils-maree/`.
