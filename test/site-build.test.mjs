import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "vite";

test("builds a self-contained GitHub Pages site instead of serving TypeScript", async () => {
  const result = await build({
    configFile: new URL("../vite.app.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (bundle) => bundle.output,
  );
  const files = new Map(outputs.map((output) => [output.fileName, output]));
  const html = String(files.get("index.html").source);

  assert.doesNotMatch(html, /src\/|node_modules\/|\.ts["']/);
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(references.some((reference) => /^\.\/assets\/.*\.js$/.test(reference)));
  assert.ok(references.some((reference) => /^\.\/assets\/.*\.css$/.test(reference)));
  for (const reference of references) {
    assert.ok(reference.startsWith("./assets/"), reference);
    assert.ok(files.has(reference.slice(2)), `Missing asset: ${reference}`);
  }

  const css = outputs
    .filter((output) => output.fileName.endsWith(".css"))
    .map((output) => String(output.source))
    .join("\n");
  assert.match(css, /\.monaco-editor/);
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (match[1].startsWith("data:")) continue;
    const path = new URL(match[1], "https://example.com/wobfus/assets/style.css").pathname;
    assert.ok(path.startsWith("/wobfus/assets/"), path);
    assert.ok(files.has(path.slice("/wobfus/".length)), `Missing CSS asset: ${path}`);
  }
  for (const worker of ["editor.worker-", "ts.worker-"]) {
    assert.ok(outputs.some((output) => output.fileName.startsWith(`assets/${worker}`)));
  }
  assert.equal(
    String(files.get("CNAME").source),
    readFileSync(new URL("../CNAME", import.meta.url), "utf8"),
  );
  assert.ok(files.has(".nojekyll"));
});
