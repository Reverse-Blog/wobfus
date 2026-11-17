import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "astro";

for (const base of ["/", "/wobfus/"]) {
  test(`builds a self-contained Astro Pages site at ${base}`, async () => {
    const temporaryRoot = new URL("../.astro/", import.meta.url);
    await mkdir(temporaryRoot, { recursive: true });
    const directory = await mkdtemp(join(fileURLToPath(temporaryRoot), "site-test-"));
    try {
      await build({
        root: new URL("../", import.meta.url),
        outDir: directory,
        base,
        logLevel: "silent",
      });
      const files = new Set(await readdir(directory, { recursive: true }));
      const html = await readFile(join(directory, "index.html"), "utf8");

      assert.match(html, /<script>\s*fetch\("https:\/\/visitor\.reverse\.blog"/);
      assert.doesNotMatch(html, /src\/|node_modules\/|\.ts["']/);
      const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1],
      );
      assert.ok(references.some((reference) => reference.endsWith(".js")));
      assert.ok(references.some((reference) => reference.endsWith(".css")));
      for (const reference of references) {
        assert.ok(reference.startsWith(`${base}_astro/`), reference);
        assert.ok(files.has(reference.slice(base.length)), `Missing asset: ${reference}`);
      }

      const styles = await Promise.all(
        [...files]
          .filter((file) => file.endsWith(".css"))
          .map((file) => readFile(join(directory, file), "utf8")),
      );
      const css = styles.join("\n");
      assert.match(css, /\.monaco-editor/);
      for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        if (match[1].startsWith("data:")) continue;
        const path = new URL(match[1], `https://example.com${base}_astro/style.css`).pathname;
        assert.ok(path.startsWith(`${base}_astro/`), path);
        assert.ok(files.has(path.slice(base.length)), `Missing CSS asset: ${path}`);
      }
      for (const worker of ["editor.worker-", "ts.worker-"]) {
        assert.ok([...files].some((file) => file.startsWith(`_astro/${worker}`)));
      }
      assert.equal(
        await readFile(join(directory, "CNAME"), "utf8"),
        await readFile(new URL("../CNAME", import.meta.url), "utf8"),
      );
      assert.ok(files.has(".nojekyll"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
