import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSize } from "../src/format-size.ts";

test("formats byte sizes using decimal KB, MB, and GB thresholds", () => {
  for (const [bytes, expected] of [
    [0, "0 bytes"],
    [999, "999 bytes"],
    [1000, "1.00 KB"],
    [1536, "1.54 KB"],
    [999_999, "1000.00 KB"],
    [1_000_000, "1.00 MB"],
    [999_999_999, "1000.00 MB"],
    [1_000_000_000, "1.00 GB"],
    [2_500_000_000, "2.50 GB"],
  ]) {
    assert.equal(formatSize(bytes), expected);
  }
});
