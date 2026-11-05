import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import {
  big5Alphabet,
  big5Identifier,
  encodeBig5,
  renameBig5Identifiers,
} from "../src/big5.ts";
import { compileVm } from "../src/vm-compiler.ts";
import { serializeVm } from "../src/vm-runtime.ts";

const mixedName = new RegExp(`^(?:[${big5Alphabet}][\\u200c\\u200d])+$`, "u");

function assertMixedBindings(code) {
  let count = 0;
  traverse(parse(code), {
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings)) {
        assert.match(name, mixedName);
        count++;
      }
    },
  });
  assert.ok(count > 0);
}

test("uses valid rare Big5 ideographs mixed with invisible identifier continuations", () => {
  const decoder = new TextDecoder("big5", { fatal: true });
  assert.equal(new Set(big5Alphabet).size, 16);
  for (let index = 0; index < 16; index++) {
    assert.equal(big5Alphabet[index], decoder.decode(Uint8Array.of(0xf9, 0x40 + index)));
  }
  const names = new Set();
  for (let index = 0; index < 4096; index++) {
    const name = big5Identifier(index);
    assert.match(name, mixedName);
    assert.ok(!names.has(name));
    names.add(name);
    parse(`let ${name};`);
  }
});

test("encodes every UTF-16 code unit with ideographs and both invisible characters", () => {
  const source = "\0ASCII\n\"\\\u7e98\u200c\u200d\u{1f600}\ud800\udfff";
  for (const key of [0, 1, 0xffff]) {
    const encoded = encodeBig5(source, key);
    assert.match(encoded, mixedName);
    assert.ok(encoded.includes("\u200c"));
    assert.ok(encoded.includes("\u200d"));
    assert.equal(encoded.length, source.length * 8);
  }
  assert.equal(encodeBig5("", 0), "");
});

test("renames bindings without changing globals, shorthand keys, or shadowed closures", () => {
  const source = `
    const ${big5Identifier(0)} = 5;
    const outer = 3;
    const object = { outer };
    class Box {
      static make(value) { return new Box(value); }
      constructor(value) { this.value = value; }
    }
    function run(value) {
      return () => {
        const outer = value;
        return object.outer + outer + ${big5Identifier(0)};
      };
    }
    console.log(Box.make(run(7)()).value);
  `;
  const generated = renameBig5Identifiers(source);
  assertMixedBindings(generated);
  const output = [];
  runInNewContext(generated, { console: { log: (value) => output.push(value) } });
  assert.deepEqual(output, [15]);
});

test("encodes interpreter and payload literals while preserving arbitrary strings", () => {
  const values = ["", "\0", "quoted \" and \\ escaped", "\n\r\t", "\u{1f600}", "\ud800", "\udfff", "\u200c\u200d"];
  const source = `function identity(value) { return value; }
    console.log(${values.map((value) => `identity(${JSON.stringify(value)})`).join(",")});`;
  const program = compileVm(source);
  for (const fn of program.functions) {
    for (const parameter of fn.parameters) assert.match(parameter, mixedName);
    if (fn.name) assert.match(fn.name, mixedName);
  }
  const generated = serializeVm(program);
  assertMixedBindings(generated);
  traverse(parse(generated), {
    ClassProperty() {
      assert.fail("Generated runtime must not require ES2022 class fields.");
    },
    StringLiteral(path) {
      if (path.node.value !== "") {
        assert.match(path.node.value, mixedName);
      }
    },
    TemplateElement(path) {
      assert.equal(path.node.value.raw, "");
    },
  });
  const output = [];
  runInNewContext(generated, { console: { log: (...args) => output.push(args) } }, {
    timeout: 2000, contextCodeGeneration: { strings: false, wasm: false },
  });
  assert.deepEqual(output, [values]);
});

test("keeps mixed Big5 identifiers through output minification and formatting", async () => {
  const { minify } = await import("vite");
  const { format } = await import("prettier");
  const values = ["", "\u{1f600}\ud800", "\u200c\u200d"];
  const generated = serializeVm(compileVm(`console.log(${values.map((value) => JSON.stringify(value)).join(",")});`));
  const minified = await minify("output.js", generated, {
    module: false, compress: true, mangle: true,
  });
  assert.equal(minified.errors.length, 0);
  const formatted = await format(renameBig5Identifiers(minified.code), { parser: "babel" });
  assertMixedBindings(formatted);
  const output = [];
  runInNewContext(formatted, { console: { log: (...args) => output.push(args) } }, {
    timeout: 2000, contextCodeGeneration: { strings: false, wasm: false },
  });
  assert.deepEqual(output, [values]);
});
