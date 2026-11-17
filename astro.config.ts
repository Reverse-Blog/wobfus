import { copyFile, writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";

export default defineConfig({
  outDir: "./site-dist",
  integrations: [
    {
      name: "pages-metadata",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          await copyFile(new URL("./CNAME", import.meta.url), new URL("CNAME", dir));
          await writeFile(new URL(".nojekyll", dir), "");
        },
      },
    },
  ],
});
