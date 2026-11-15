import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { minifyCode } from "../src/minify.ts";

test("minifies a script while preserving its result", async () => {
  const source = "function calculate(value) { const result = value * 2; return result + 1; } globalThis.result = calculate(20);";
  const output = await minifyCode(source);
  const context = {};

  assert.ok(output.length < source.length);
  runInNewContext(output, context);
  assert.equal(context.result, 41);
});

test("rejects invalid JavaScript", async () => {
  await assert.rejects(minifyCode("function {"));
});

test("enforces the existing limit on the UTF-8 encoded request", async () => {
  await assert.rejects(
    minifyCode("\\".repeat(500_000)),
    /JavaScript source exceeds the 1 MB limit/,
  );
});
