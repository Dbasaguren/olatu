// Plan du site pour Google : accueil, une page par spot, confidentialité.
import { SPOTS } from "../lib/spots.js";
import { spotPath } from "../lib/spot-info.js";

export function GET({ site }) {
  const url = (path, freq) => `  <url><loc>${new URL(path, site).href}</loc><changefreq>${freq}</changefreq></url>`;
  const body = [
    url("/", "daily"),
    ...SPOTS.map(s => url(spotPath(s), "daily")),
    url("/confidentialite.html", "yearly"),
  ].join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
