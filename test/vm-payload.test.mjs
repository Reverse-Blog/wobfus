import assert from "node:assert/strict";
import { test } from "node:test";
import { big5Identifier } from "../src/big5.ts";
import { decodeVmPayload, encodeVmPayload } from "../src/vm-payload.ts";

const alphabet = Array.from({ length: 16 }, (_, index) => big5Identifier(index)).join("");

test("binary payload preserves IEEE-754 values, UTF-16 code units, and nested arrays", () => {
  const value = [
    null, false, true, 0, -0, Number.MIN_VALUE, Number.MAX_VALUE,
    Infinity, -Infinity, NaN, Math.PI, 0xffffffff,
    "", "\0\n\r\t", "\ud800", "\udfff", "\u{1f600}", "\u200c\u200d",
    [[], [1, "nested"]],
  ];
  for (const seed of [0, 1, 0xffffffff, 123456789]) {
    assert.deepEqual(decodeVmPayload(encodeVmPayload(value, seed), alphabet, seed), value);
  }
});

test("stateful payload encoding depends on preceding data and the generation seed", () => {
  const first = encodeVmPayload(["a", "same"], 17);
  const second = encodeVmPayload(["b", "same"], 17);
  assert.notEqual(first, encodeVmPayload(["a", "same"], 18));
  assert.notEqual(first.slice(-16), second.slice(-16));
  assert.deepEqual(decodeVmPayload(first, alphabet, 17), ["a", "same"]);
  assert.deepEqual(decodeVmPayload(second, alphabet, 17), ["b", "same"]);
});

test("rejects malformed or truncated binary data explicitly", () => {
  const encoded = encodeVmPayload([1, "value"], 17);
  assert.throws(() => decodeVmPayload(encoded.slice(1), alphabet, 17), /length/);
  assert.throws(() => decodeVmPayload("x" + encoded.slice(1), alphabet, 17), /digit/);
  assert.throws(() => decodeVmPayload(encoded[0] + "x" + encoded.slice(2), alphabet, 17), /separator/);
  assert.throws(() => decodeVmPayload(encoded.slice(0, -4), alphabet, 17), /Truncated/);
  assert.throws(() => decodeVmPayload(encoded + encoded.slice(0, 4), alphabet, 17), /Trailing/);
  assert.throws(() => encodeVmPayload({}, 17), /Unsupported/);
});
