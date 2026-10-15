"""Prépare les données de la carte d'Olatu : houle et vent sur le monde entier.

Lancé automatiquement par GitHub Actions deux fois par jour (.github/workflows/donnees-carte.yml).
Usage : python construire_donnees_carte.py DOSSIER_SORTIE

Grilles, de la plus fine à la plus large : golfe de Gascogne (0,5°), Atlantique Nord (1,5°),
Méditerranée et mer du Nord / Baltique (1°, houle seulement), monde jusqu'aux pôles (5°).
Seuls les points en mer sont demandés (masque terre/mer gardé dans mask.json d'une fois sur l'autre),
pour rester sous les limites de l'API gratuite d'Open-Meteo.
Fichiers produits : swell.json (houle), wind.json (vent), mask.json.
Valeurs entières pour alléger : hauteur en cm, période en dixièmes de seconde, vent en dixièmes de nœud,
directions en degrés ; -1 = pas de donnée (terre).
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)

# wind=False : pas de vent sur cette grille (la grille monde suffit), pour rester dans le quota
GRIDS = [
    {"id": "biscay", "lat0": 42.0, "lat1": 48.0, "lon0": -6.0, "lon1": -1.0, "step": 0.5, "wrap": False, "wind": True},
    {"id": "atl", "lat0": 34.5, "lat1": 57.0, "lon0": -35.0, "lon1": -0.5, "step": 1.5, "wrap": False, "wind": True},
    {"id": "med", "lat0": 30.0, "lat1": 46.0, "lon0": -6.0, "lon1": 36.0, "step": 1.0, "wrap": False, "wind": False},
    {"id": "nord", "lat0": 50.0, "lat1": 66.0, "lon0": -4.0, "lon1": 30.0, "step": 1.0, "wrap": False, "wind": False},
    {"id": "world", "lat0": -75.0, "lat1": 80.0, "lon0": -180.0, "lon1": 175.0, "step": 5.0, "wrap": True, "wind": True},
]
CHUNK = 200          # points par requête
PAUSE = 170          # secondes entre deux requêtes : ~4 200 points / heure (limites gratuites : 5 000 / heure, 10 000 / jour)
COMMON = {"forecast_days": 7, "temporal_resolution": "hourly_3", "timezone": "Europe/Paris"}


def points(g):
    n_lat = round((g["lat1"] - g["lat0"]) / g["step"]) + 1
    n_lon = round((g["lon1"] - g["lon0"]) / g["step"]) + 1
    pts = [(round(g["lat0"] + i * g["step"], 2), round(g["lon0"] + j * g["step"], 2)) for i in range(n_lat) for j in range(n_lon)]
    return n_lat, n_lon, pts


def fetch(base, params, pts):
    """Interroge Open-Meteo par paquets ; renvoie une liste de dicts 'hourly' (None si échec du point)."""
    out = []
    for k in range(0, len(pts), CHUNK):
        part = pts[k:k + CHUNK]
        q = dict(COMMON, **params, latitude=",".join(str(p[0]) for p in part), longitude=",".join(str(p[1]) for p in part))
        url = base + "?" + urllib.parse.urlencode(q)
        for attempt in range(6):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    data = json.load(r)
                break
            except Exception as e:  # 429 (trop de requêtes) ou réseau : on attend et on réessaie
                wait = 60 * (attempt + 1)
                print(f"  erreur {e} ; nouvel essai dans {wait} s", flush=True)
                time.sleep(wait)
        else:
            raise SystemExit("Open-Meteo ne répond pas, abandon.")
        data = data if isinstance(data, list) else [data]
        out += [d["hourly"] for d in data]
        print(f"  {base.split('/')[2]} : {min(k + CHUNK, len(pts))}/{len(pts)} points", flush=True)
        time.sleep(PAUSE)
    return out


def q(v, scale):
    return -1 if v is None else int(round(v * scale))


def main():
    mask_path = os.path.join(OUT, "mask.json")
    mask = json.load(open(mask_path)) if os.path.exists(mask_path) else {}
    times = None
    swell_out, wind_out, new_mask = [], [], {}
    for g in GRIDS:
        n_lat, n_lon, pts = points(g)
        known = mask.get(g["id"])
        if known is not None and len(known) != len(pts):
            known = None  # la grille a changé : on redemande tout pour refaire le masque
        sea_idx = [i for i in range(len(pts)) if known is None or known[i]]
        print(f"Grille {g['id']} : {len(pts)} points, {len(sea_idx)} demandés", flush=True)
        sea_pts = [pts[i] for i in sea_idx]
        marine = fetch("https://marine-api.open-meteo.com/v1/marine",
                       {"hourly": "swell_wave_height,swell_wave_period,swell_wave_direction"}, sea_pts)
        times = times or marine[0]["time"]
        n_t, n_p = len(times), len(pts)
        h = [-1] * (n_t * n_p); p = [-1] * (n_t * n_p); d = [-1] * (n_t * n_p)
        sea = [0] * n_p
        for idx, hh in zip(sea_idx, marine):
            if hh.get("swell_wave_height") and any(v is not None for v in hh["swell_wave_height"]):
                sea[idx] = 1
            for t in range(n_t):
                h[t * n_p + idx] = q(hh["swell_wave_height"][t], 100)
                p[t * n_p + idx] = q(hh["swell_wave_period"][t], 10)
                d[t * n_p + idx] = q(hh["swell_wave_direction"][t], 1)
        new_mask[g["id"]] = sea
        meta = {"id": g["id"], "lat0": g["lat0"], "lon0": g["lon0"], "step": g["step"], "nLat": n_lat, "nLon": n_lon, "wrap": g["wrap"]}
        swell_out.append(dict(meta, h=h, p=p, d=d))
        if not g["wind"]:
            continue
        # Vent : uniquement sur les points en mer
        wind_idx = [i for i in range(n_p) if sea[i]]
        wind = fetch("https://api.open-meteo.com/v1/forecast",
                     {"hourly": "wind_speed_10m,wind_direction_10m", "wind_speed_unit": "kn", "models": "ecmwf_ifs025"},
                     [pts[i] for i in wind_idx])
        ws = [-1] * (n_t * n_p); wd = [-1] * (n_t * n_p)
        for idx, hh in zip(wind_idx, wind):
            for t in range(min(n_t, len(hh["time"]))):
                ws[t * n_p + idx] = q(hh["wind_speed_10m"][t], 10)
                wd[t * n_p + idx] = q(hh["wind_direction_10m"][t], 1)
        wind_out.append(dict(meta, v=ws, d=wd))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    src = "Open-Meteo.com (CC BY 4.0) : vagues MFWAM/ECMWF WAM, vent ECMWF IFS"
    json.dump({"generated": stamp, "source": src, "times": times, "grids": swell_out}, open(os.path.join(OUT, "swell.json"), "w"), separators=(",", ":"))
    json.dump({"generated": stamp, "source": src, "times": times, "grids": wind_out}, open(os.path.join(OUT, "wind.json"), "w"), separators=(",", ":"))
    json.dump(new_mask, open(mask_path, "w"), separators=(",", ":"))
    for f in ("swell.json", "wind.json", "mask.json"):
        print(f, round(os.path.getsize(os.path.join(OUT, f)) / 1024), "Ko")


if __name__ == "__main__":
    main()
