import assert from "node:assert/strict";
import { test } from "node:test";
import { findGlobalCalls } from "../src/global-calls.ts";

test("finds direct and member calls rooted in globals with source locations", () => {
  const calls = findGlobalCalls("fetch('/api');\nconsole.log('ready');");

  assert.deepEqual(calls, [
    { callee: "fetch", type: Object.hasOwn(fetch, "prototype") ? "constructor" : "function", line: 1, column: 1 },
    { callee: "console.log", type: "function", line: 2, column: 1 },
  ]);
});

test("does not report calls when a global name is shadowed", () => {
  const calls = findGlobalCalls(`
    const console = { log() {} };
    function run(fetch) {
      fetch();
      console.log("local");
    }
    setTimeout(run, 0);
  `);

  assert.deepEqual(calls.map(({ callee }) => callee), ["setTimeout"]);
});

test("respects block scopes without hiding calls to globals elsewhere", () => {
  const calls = findGlobalCalls(`
    {
      const console = { log() {} };
      console.log("local");
    }
    console.log("global");
  `);

  assert.deepEqual(calls.map(({ callee }) => callee), ["console.log"]);
});

test("finds optional calls rooted in globals", () => {
  const calls = findGlobalCalls("console?.log?.('ready');");

  assert.deepEqual(calls, [
    { callee: "console?.log", type: "function", line: 1, column: 1 },
  ]);
});

test("ignores super calls while finding global calls in class methods", () => {
  const calls = findGlobalCalls(`
    class Child extends Parent {
      constructor() {
        super();
        console.log("ready");
      }
    }
  `);

  assert.deepEqual(calls.map(({ callee }) => callee), ["console.log"]);
});

test("finds constructors, superclass references, and plain global values", () => {
  const calls = findGlobalCalls(`
    const cache = new WeakMap();
    const items = new Set();
    class CustomMap extends Map {}
    const promiseType = Promise;
    const value = undefined;
    const infinity = Infinity;
    const parse = JSON.parse;
  `);

  assert.deepEqual(calls.map(({ callee }) => callee), [
    "WeakMap", "Set", "Map", "Promise", "undefined", "Infinity", "JSON.parse",
  ]);
});

test("retains repeated calls, constructors, values, and equivalent static properties", () => {
  const calls = findGlobalCalls(
    "new WeakMap(); WeakMap;\nconsole.log(1); console['log'](2); console?.log?.(3);",
  );

  assert.deepEqual(calls, [
    { callee: "WeakMap", type: "constructor", line: 1, column: 5 },
    { callee: "WeakMap", type: "constructor", line: 1, column: 16 },
    { callee: "console.log", type: "function", line: 2, column: 1 },
    { callee: "console['log']", type: "function", line: 2, column: 17 },
    { callee: "console?.log", type: "function", line: 2, column: 36 },
  ]);
});

test("excludes imported, hoisted, and locally declared constructors", () => {
  const calls = findGlobalCalls(`
    import { WeakMap } from "custom";
    new WeakMap();
    function run() {
      new Map();
      var Map;
    }
    {
      class Set {}
      new Set();
    }
    new Map();
    new Set();
  `);

  assert.deepEqual(calls.map(({ callee }) => callee), ["Map", "Set"]);
});

test("finds globals inside computed properties without treating property names as references", () => {
  const calls = findGlobalCalls(`
    const object = { WeakMap: 1 };
    object.WeakMap;
    console[Symbol.iterator];
  `);

  assert.deepEqual(calls.map(({ callee }) => callee), [
    "console[Symbol.iterator]", "Symbol.iterator",
  ]);
});

test("classifies global objects, functions, constructors, primitives, and dynamic properties", () => {
  const calls = findGlobalCalls(`
    console;
    JSON.parse;
    WeakMap;
    undefined;
    Infinity;
    Symbol.iterator;
    console[key];
  `);

  assert.deepEqual(calls.map(({ type }) => type), [
    "object", "function", "constructor", "undefined", "number", "symbol", "unknown",
  ]);
});

test("classifies classes and accessors without invoking getters", () => {
  const key = "__wobfusTypeTest";
  let getterCalls = 0;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: {
      Example: class Example {},
      value: null,
      get lazy() {
        getterCalls++;
        throw new Error("Must not invoke getters.");
      },
    },
  });

  try {
    const calls = findGlobalCalls(`${key}.Example; ${key}.value; ${key}.lazy;`);
    assert.deepEqual(calls.map(({ type }) => type), ["class", "null", "accessor"]);
    assert.equal(getterCalls, 0);
  } finally {
    delete globalThis[key];
  }
});
