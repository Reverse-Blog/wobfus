import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { flattenVmControlFlow } from "../src/vm-control-flow.ts";
import { compileVm } from "../src/vm-compiler.ts";
import { serializeVm } from "../src/vm-runtime.ts";

const ops = { jump: 0, jumpFalse: 1, jumpTrue: 2, jumpNotNull: 3, return: 4, constant: 5 };
const branches = new Set([ops.jump, ops.jumpFalse, ops.jumpTrue, ops.jumpNotNull]);

function trace(code, condition) {
  const visited = [];
  let pc = 0;
  for (let steps = 0; pc < code.length && steps < 1000; steps++) {
    const [opcode, operand] = code[pc++];
    if (opcode === ops.constant) visited.push(operand);
    else if (opcode === ops.return) return visited;
    else if (opcode === ops.jump ||
      opcode === ops.jumpFalse && !condition ||
      opcode === ops.jumpTrue && condition ||
      opcode === ops.jumpNotNull && condition != null) pc = operand;
  }
  assert.ok(pc >= code.length, "Trace did not terminate");
  return visited;
}

test("splits and permutes linear blocks without changing their execution order", () => {
  const original = Array.from({ length: 60 }, (_, index) => [ops.constant, index]);
  original.push([ops.return]);
  const copy = structuredClone(original);
  const flattened = flattenVmControlFlow(original, ops);
  assert.deepEqual(original, copy);
  assert.deepEqual(flattenVmControlFlow(original, ops), flattened);
  assert.equal(flattened[0][0], ops.jump);
  const physicalOrder = flattened.filter(([op]) => op === ops.constant).map(([, value]) => value);
  assert.notDeepEqual(physicalOrder, Array.from({ length: 60 }, (_, i) => i));
  assert.deepEqual(trace(flattened), trace(original));
  assert.ok(flattened.length <= original.length + Math.ceil(original.length / 12) + 1);
  let run = 0;
  for (const [operation] of flattened) {
    if (operation === ops.constant) assert.ok(++run <= 12);
    else run = 0;
  }
});

test("relocates conditional, unconditional, backward, shared, and end targets", () => {
  for (const branch of [ops.jumpFalse, ops.jumpTrue, ops.jumpNotNull]) {
    const original = [
      [ops.jump, 3], [ops.constant, "backward"], [ops.jump, 7],
      [ops.constant, "first"], [branch, 1], [ops.constant, "fallthrough"], [ops.jump, 7],
      [ops.constant, "shared"], [ops.jump, 9],
    ];
    const flattened = flattenVmControlFlow(original, ops);
    for (const condition of [false, true, null, 0, 1]) {
      assert.deepEqual(trace(flattened, condition), trace(original, condition));
    }
    for (const [op, target] of flattened) {
      if (branches.has(op)) {
        assert.ok(Number.isInteger(target) && target >= 0 && target <= flattened.length);
      }
    }
  }
});

test("handles empty code and returns, and rejects invalid branch targets", () => {
  assert.deepEqual(flattenVmControlFlow([], ops), []);
  assert.deepEqual(trace(flattenVmControlFlow([[ops.return], [ops.constant, "unreachable"]], ops)), []);
  for (const target of [-1, 0.5, 2, "0", NaN]) {
    assert.throws(() => flattenVmControlFlow([[ops.jump, target]], ops), /Invalid VM jump target/);
  }
  assert.throws(() => flattenVmControlFlow([], {}), /Missing control-flow opcode/);
});

test("flattened functions preserve effects, recursion, loops, closures, scopes, and short circuits", () => {
  const source = `
    let order = 0;
    const object = { value: 7, method: function (n) { return this.value + n; } };
    const values = [];
    for (let i = 0; i < 6; i++) {
      if (i === 1) continue;
      { let captured = i; values.push(() => captured); }
      if (i === 4) break;
    }
    function factorial(n) { return n < 2 ? 1 : n * factorial(n - 1); }
    let total = 0;
    for (let i = 0; i < 3; i++) {
      let j = 0;
      while (j < 4) {
        j++;
        if (j === 2) continue;
        if (j === 4) break;
        total += i + j;
      }
    }
    false && order++;
    true || order++;
    const fallback = null ?? ++order;
    console.log(object.method(++order), factorial(6), total, fallback,
      values[0](), values[1](), values[3](), order);
  `;
  const run = (code) => {
    const output = [];
    runInNewContext(code, { console: { log: (...args) => output.push(args) } }, {
      timeout: 2000, contextCodeGeneration: { strings: false, wasm: false },
    });
    return output;
  };
  const program = compileVm(source);
  for (const fn of program.functions) assert.equal(fn.code[0][0], program.instructions.jump);
  assert.deepEqual(run(serializeVm(program)), run(`"use strict";${source}`));
  assert.deepEqual(run(serializeVm(program)), [[9, 720, 18, 1, 0, 2, 4, 2]]);
});

test("flattening preserves exception timing and stops subsequent API effects", () => {
  const source = 'console.log("before"); const value = null; console.log(value.missing); console.log("after");';
  const output = [];
  assert.throws(() => runInNewContext(serializeVm(compileVm(source)), {
    console: { log: (value) => output.push(value) },
  }), /null or undefined/);
  assert.deepEqual(output, ["before"]);
});
