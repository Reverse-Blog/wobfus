import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "The page must include a plain inline visitor script.");

function runNotification(fetch, referrer = "", errors = []) {
  return runInNewContext(script, {
    fetch,
    window: { location: { href: "https://example.com/nested/page?demo=1#output" } },
    navigator: { languages: ["en-US", "en"] },
    document: { referrer },
    URL,
    console: { error: (...args) => errors.push(args) },
  });
}

test("sends a keepalive page notification with languages and only the referring origin", async () => {
  for (const referrer of ["", "https://referrer.example/path?private=value#section"]) {
    const calls = [];
    const errors = [];
    await runNotification(async (url, options) => {
      calls.push({ url, options });
      return { ok: true };
    }, referrer, errors);

    assert.equal(calls.length, 1);
    const { url, options } = calls[0];
    assert.equal(url, "https://visitor.reverse.blog");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "text/plain;charset=UTF-8");
    assert.equal(options.keepalive, true);
    assert.deepEqual(JSON.parse(options.body), {
      url: "https://example.com/nested/page?demo=1#output",
      languages: ["en-US", "en"],
      referrer: referrer ? "https://referrer.example" : "",
    });
    assert.deepEqual(errors, []);
  }
});

test("reports unsuccessful HTTP responses", async () => {
  const errors = [];
  await runNotification(async () => ({ ok: false, status: 503 }), "", errors);
  assert.deepEqual(errors, [["Visitor notification failed:", 503]]);
});

test("reports network failures without an unhandled rejection", async () => {
  const errors = [];
  await runNotification(async () => {
    throw new TypeError("Failed to fetch");
  }, "", errors);
  assert.deepEqual(errors, [["Could not reach the visitor Worker."]]);
});
