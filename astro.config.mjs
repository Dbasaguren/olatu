// Configuration Astro : site statique (dossier dist/), une page par spot, adresses en /spots/<id>/.
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://olatuak.eu",
  trailingSlash: "ignore",
  build: { format: "directory" },
  devToolbar: { enabled: false },
});
