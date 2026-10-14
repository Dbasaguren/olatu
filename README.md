# Olatu

Prévisions surf pour la côte basque française, de La Barre à Hendaye : houle, période, énergie des vagues, vent offshore ou onshore, marée de Socoa et coefficient.

Application web installable (PWA), sans serveur : ouvrir le site sur le téléphone puis « Ajouter à l'écran d'accueil ».

## Données

- Prévisions de houle et de vent : [Open-Meteo](https://open-meteo.com) (Météo-France, DWD, ECMWF, NOAA), licence CC BY 4.0.
- Marée : constantes harmoniques calculées à partir des mesures des marégraphes de Socoa et de Brest, REFMAR / Shom, Licence Ouverte 2.0 ([doi:10.17183/REFMAR](https://doi.org/10.17183/REFMAR)). Ces prédictions ne sont pas vérifiées par le Shom.

Les scripts de recalcul des constantes sont dans `outils-maree/`.
