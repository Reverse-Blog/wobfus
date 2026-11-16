import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [
    {
      name: "pages-metadata",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "CNAME",
          source: readFileSync(new URL("./CNAME", import.meta.url), "utf8"),
        });
        this.emitFile({
          type: "asset",
          fileName: ".nojekyll",
          source: "",
        });
      },
    },
  ],
  build: {
    outDir: "site-dist",
  },
});
