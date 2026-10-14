"""Génère les icônes d'Olatu (PWA + iPhone) : un rouleau de vague blanc sur fond bleu canard."""
import sys, os
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else "icons"
os.makedirs(OUT, exist_ok=True)
BG = (11, 110, 122)
FOAM = (255, 255, 255)

def wave_icon(size, safe=1.0, rounded=True):
    S = size * 4  # suréchantillonnage pour des bords lisses
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    m = S * (1 - safe) / 2           # marge de la zone sûre
    W = S - 2 * m
    P = lambda x, y: (m + x * W, m + y * W)
    def disk(cx, cy, r, fill):
        (x0, y0), (x1, y1) = P(cx - r, cy - r), P(cx + r, cy + r)
        d.ellipse([x0, y0, x1, y1], fill=fill)
    # Rouleau : grand disque blanc moins le creux du tube
    disk(0.56, 0.47, 0.30, FOAM)
    disk(0.47, 0.54, 0.19, BG)
    # On ouvre le tube vers le bas à gauche (la lèvre retombe)
    d.polygon([P(0.10, 0.62), P(0.47, 0.62), P(0.47, 0.90), P(0.10, 0.90)], fill=BG)
    # Lèvre : petite goutte qui retombe
    disk(0.335, 0.555, 0.045, FOAM)
    # Mer : deux bandes
    x0, x1 = 0.12, 0.88
    d.rounded_rectangle([*P(x0, 0.74), *P(x1, 0.80)], radius=int(W * 0.03), fill=FOAM)
    d.rounded_rectangle([*P(x0 + 0.10, 0.85), *P(x1 - 0.10, 0.90)], radius=int(W * 0.025), fill=FOAM)
    return img.resize((size, size), Image.LANCZOS)

wave_icon(192, safe=0.84).save(f"{OUT}/icon-192.png")
wave_icon(512, safe=0.84).save(f"{OUT}/icon-512.png")
wave_icon(512, safe=0.68, rounded=False).save(f"{OUT}/icon-maskable-512.png")
ap = Image.new("RGB", (180, 180), BG); ap.paste(wave_icon(180, safe=0.78, rounded=False)); ap.save(f"{OUT}/apple-touch-icon.png")
wave_icon(64, safe=0.92).save(f"{OUT}/favicon.png")
print("ok")
