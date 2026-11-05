import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { compileVm } from "../src/vm-compiler.ts";
import { serializeVm } from "../src/vm-runtime.ts";
import { renameBig5Identifiers } from "../src/big5.ts";

function execute(source) {
  const output = [];
  const program = compileVm(source);
  const generated = serializeVm(program);
  runInNewContext(generated, {
    console: { log: (...args) => output.push(args) },
  }, { timeout: 2000, contextCodeGeneration: { strings: false, wasm: false } });
  return output;
}

test("executes Fibonacci bytecode with dynamic code generation disabled", () => {
  assert.deepEqual(execute(`
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    console.log(fibonacci(10));
  `), [[55]]);
});

test("replaces source binding names throughout bytecode without changing scopes or property keys", () => {
  const source = `
    function fibonacciNamed(inputNumber) {
      if (inputNumber <= 1) return inputNumber;
      return fibonacciNamed(inputNumber - 1) + fibonacciNamed(inputNumber - 2);
    }
    const calculateResult = function recursiveNamed(inputNumber) {
      return inputNumber < 2 ? 1 : inputNumber * recursiveNamed(inputNumber - 1);
    };
    function captureArguments(inputNumber) {
      var inputNumber;
      return () => arguments[0] + inputNumber;
    }
    let outerValue = 7;
    { let outerValue = 9; console.log(outerValue); }
    const holder = { outerValue };
    console.log(fibonacciNamed(10), calculateResult(5), captureArguments(3)(),
      holder.outerValue, outerValue, "literal preserved");
  `;
  const program = compileVm(source);
  const generated = serializeVm(program);
  for (const name of [
    "fibonacciNamed", "inputNumber", "calculateResult", "recursiveNamed", "captureArguments",
  ]) {
    assert.ok(!JSON.stringify(program.functions).includes(name), `Leaked binding: ${name}`);
    assert.ok(!generated.includes(name), `Leaked source name: ${name}`);
  }
  assert.deepEqual(execute(source), [[9], [55, 120, 6, 7, 7, "literal preserved"]]);
});

test("assigns collision-free random instruction and per-API opcodes", () => {
  const source = "const cache = new WeakMap(); console.log(cache); console.log(Math.max(1, 2));";
  const first = compileVm(source);
  const second = compileVm(source);
  const entries = Object.entries(first.globals);
  assert.deepEqual(entries.map(([, path]) => path.join(".")).sort(), [
    "Math.max", "WeakMap", "console.log",
  ]);
  const codes = [...Object.values(first.instructions), ...entries.map(([code]) => Number(code))];
  assert.equal(new Set(codes).size, codes.length);
  assert.notDeepEqual(first.instructions, second.instructions);
  const emitted = first.functions.flatMap(({ code }) => code.map(([opcode]) => opcode));
  for (const [opcode] of entries) assert.ok(emitted.includes(Number(opcode)));
  assert.ok(emitted.includes(first.instructions.construct));
  assert.ok(emitted.includes(first.instructions.call));
});

test("serialized output omits instruction names and the symbolic dispatch table", () => {
  const program = compileVm("let value = 1; value++; console.log(value);");
  const generated = serializeVm(program);
  assert.doesNotMatch(generated, /\binstructions\b|\bop\.(?:read|write|call|construct)\b/);
  assert.doesNotMatch(generated, /prepareCall|jumpFalse|jumpTrue|jumpNotNull|cloneScope|typeofGlobal/);
  for (const name of Object.keys(program.instructions)) {
    assert.ok(!generated.includes(`"${name}":`), `Leaked instruction key: ${name}`);
  }
  const output = [];
  runInNewContext(generated, { console: { log: (value) => output.push(value) } }, {
    contextCodeGeneration: { strings: false, wasm: false },
  });
  assert.deepEqual(output, [2]);
});

test("packs VM metadata and encodes global and property names", () => {
  const generated = serializeVm(compileVm(`
    const secretKey = "hidden value";
    const box = { recognizableProperty: secretKey };
    console.log(box.recognizableProperty);
  `));
  for (const text of [
    "globals", "functions", "parameters", "recognizableProperty",
    "hidden value", "console", "log",
  ]) {
    assert.ok(!generated.includes(text), `Leaked packed metadata: ${text}`);
  }
  const output = [];
  runInNewContext(generated, { console: { log: (value) => output.push(value) } }, {
    contextCodeGeneration: { strings: false, wasm: false },
  });
  assert.deepEqual(output, ["hidden value"]);
});

test("supports constructors, native method receivers, and computed keys", () => {
  assert.deepEqual(execute(`
    const cache = new WeakMap();
    const key = {};
    cache.set(key, 42);
    const items = [];
    items.push(cache.get(key));
    console.log(items[0], cache instanceof WeakMap, Math["max"](3, 5));
  `), [[42, true, 5]]);
});

test("preserves Proxy traps, getters, and dynamic method receivers", () => {
  assert.deepEqual(execute(`
    let reads = 0;
    const target = { value: 7, method: function (amount) { return this.value + amount; } };
    Object.defineProperty(target, "counted", {
      get: function () { reads++; return reads; }
    });
    const proxy = new Proxy(target, {
      get: function (object, key, receiver) {
        return Reflect.get(object, key, receiver);
      }
    });
    const key = "meth" + "od";
    console.log(proxy.counted, proxy.counted, proxy[key](5), reads);
  `), [[1, 2, 12, 2]]);
});

test("preserves shared TypedArray memory, byte order, and floating-point edge cases", () => {
  assert.deepEqual(execute(`
    const buffer = new ArrayBuffer(8);
    const floats = new Float64Array(buffer);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    view.setFloat64(0, Math.PI, true);
    console.log(view.getFloat64(0, true), bytes[0], bytes[7]);
    floats[0] = -0;
    console.log(Object.is(floats[0], -0), 1 / floats[0]);
    console.log(0 / 0 !== 0 / 0, (2147483647 + 1) | 0);
  `), [[Math.PI, 24, 64], [true, -Infinity], [true, -2147483648]]);
});

test("supports closures, recursion, function hoisting, and block scopes", () => {
  assert.deepEqual(execute(`
    console.log(add(2, 3));
    function add(a, b) { return a + b; }
    function counter() {
      let n = 0;
      return () => ++n;
    }
    const count = counter();
    const factorial = function recur(n) { return n < 2 ? 1 : n * recur(n - 1); };
    let value = 1;
    { let value = 2; console.log(value); }
    console.log(count(), count(), factorial(5), value);
  `), [[5], [2], [1, 2, 120, 1]]);
});

test("supports for and while loops with break, continue, and per-iteration closures", () => {
  assert.deepEqual(execute(`
    const callbacks = [];
    let total = 0;
    for (let i = 0; i < 4; i++) {
      callbacks.push(() => i);
      if (i === 1) continue;
      total += i;
    }
    let n = 0;
    while (true) {
      n++;
      if (n === 3) break;
    }
    console.log(total, n, callbacks[0](), callbacks[1](), callbacks[3]());
  `), [[5, 3, 0, 1, 3]]);
});

test("preserves short circuiting, coercion, bigint updates, and object properties", () => {
  assert.deepEqual(execute(`
    let n = 0;
    false && n++;
    true || n++;
    const v = null ?? "fallback";
    let big = 1n;
    const before = big++;
    const object = { ["key"]: "value", n };
    console.log(n, v, "a" + 1, before, big, object.key, typeof object);
  `), [[0, "fallback", "a1", 1n, 2n, "value", "object"]]);
});

test("supports template literals with interpolated expressions and escapes", () => {
  const source = "let order = 0; const result = `value=${++order}, escaped=\\n, object=${{ value: 7 }}`; console.log(result, order, `plain`);";
  assert.deepEqual(execute(source), [["value=1, escaped=\n, object=[object Object]", 1, "plain"]]);
});

test("captures call targets before evaluating arguments", () => {
  assert.deepEqual(execute(`
    let f = (value) => "old";
    const next = () => "new";
    console.log(f(f = next));
    const object = { method: () => "first" };
    console.log(object.method(object.method = next));
  `), [["old"], ["first"]]);
});

test("preserves strict function this and arrow lexical this", () => {
  assert.deepEqual(execute(`
    const object = {
      value: 7,
      get: function () { return () => this.value; }
    };
    console.log(object.get()());
    function plain() { return this; }
    console.log(plain() === undefined);
  `), [[7], [true]]);
});

test("throws for temporal dead zones, constants, and non-callable values", () => {
  assert.throws(() => execute("console.log(a); let a = 1;"), /before initialization/);
  assert.throws(() => execute("const a = 1; a = 2;"), /constant variable/);
  assert.throws(() => execute("const a = 1; a();"), /not a function/);
});

test("rejects unsupported syntax explicitly instead of falling back to eval", () => {
  for (const source of [
    "class Example {}", "async function run() {}", "function* run() {}",
    "try {} catch (error) {}", "const {a} = object;", "const x = [...items];",
    "eval('1')", "Function('return 1')", "object?.method()",
  ]) {
    assert.throws(() => compileVm(source), /Unsupported|not supported/);
  }
});

test("supports typeof missing globals without hiding lexical temporal dead zones", () => {
  assert.deepEqual(execute('console.log(typeof __missingVmGlobal);'), [["undefined"]]);
  assert.throws(() => execute("console.log(typeof value); let value;"), /before initialization/);
});

test("does not execute global getters during compilation and preserves lazy access", () => {
  const key = "__wobfusLazyApi";
  let getterCalls = 0;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    get() { getterCalls++; return { value: 42 }; },
  });
  try {
    const program = compileVm(`if (false) console.log(${key}.value);`);
    assert.equal(getterCalls, 0);
    runInNewContext(serializeVm(program), {}, {
      contextCodeGeneration: { strings: false, wasm: false },
    });
    assert.equal(getterCalls, 0);
  } finally {
    delete globalThis[key];
  }
});

test("preserves loop-initializer closure environments", () => {
  assert.deepEqual(execute(`
    let first;
    for (let i = (first = () => i, 0); i < 2; i++) {}
    console.log(first());
  `), [[0]]);
});

test("minified Fibonacci compiles and executes through the same pipeline as the page", async () => {
  const { minify } = await import("vite");
  const result = await minify("source.js", `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    console.log(fibonacci(10));
  `, { module: false, compress: true, mangle: true });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(execute(result.code), [[55]]);
});

test("final formatted output keeps Fibonacci names removed after both minification passes", async () => {
  const { minify } = await import("vite");
  const { format } = await import("prettier");
  const source = await minify("source.js", `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    console.log(fibonacci(10));
  `, { module: false, compress: true, mangle: true });
  assert.equal(source.errors.length, 0);
  const generated = serializeVm(compileVm(source.code));
  const minified = await minify("output.js", generated, {
    module: false, compress: true, mangle: true,
  });
  assert.equal(minified.errors.length, 0);
  assert.ok(minified.code.length < generated.length);
  const formatted = await format(renameBig5Identifiers(minified.code), { parser: "babel" });
  assert.doesNotMatch(formatted, /fibonacci/);
  const output = [];
  runInNewContext(formatted, { console: { log: (value) => output.push(value) } }, {
    contextCodeGeneration: { strings: false, wasm: false }, timeout: 2000,
  });
  assert.deepEqual(output, [55]);
});

test("minifies both source and VM output without requiring dynamic code generation", async () => {
  const { minify } = await import("vite");
  const source = await minify("source.js", `
    const cache = new WeakMap();
    const key = {};
    cache.set(key, 42);
    console.log(cache.get(key));
  `, { module: false, compress: true, mangle: true });
  assert.equal(source.errors.length, 0);
  const generated = serializeVm(compileVm(source.code));
  const output = await minify("output.js", generated, {
    module: false, compress: true, mangle: true,
  });
  assert.equal(output.errors.length, 0);
  assert.ok(output.code.length < generated.length);
  const logged = [];
  runInNewContext(output.code, {
    console: { log: (value) => logged.push(value) },
  }, { contextCodeGeneration: { strings: false, wasm: false }, timeout: 2000 });
  assert.deepEqual(logged, [42]);
});

test("bundled obfuscator emits a self-contained executable runtime after Vite minification", async () => {
  const { build } = await import("vite");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      lib: { entry: "src/obfuscate.ts", formats: ["es"] },
      minify: true,
      write: false,
    },
  });
  const chunk = result[0].output.find((item) => item.type === "chunk");
  assert.ok(chunk);
  const { obfuscate } = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
  const output = [];
  runInNewContext(obfuscate("console.log(Math.max(4, 9));"), {
    console: { log: (value) => output.push(value) },
  }, { contextCodeGeneration: { strings: false, wasm: false } });
  assert.deepEqual(output, [9]);
});
