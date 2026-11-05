# wobfus

An ESM TypeScript package scaffold for npm. The package does not expose a
public API yet.

## Development

Requires Node.js 24 or newer.

```sh
npm run dev
npm run build
npm run preview
npm run check
npm test
```

`npm run dev` starts a local Vite page with HMR. After building, `npm run
preview` serves it with the minifier endpoint enabled. The page includes a
pseudo-obfuscation demo with Monaco JavaScript editors. Source is compiled to
stack-machine bytecode and bundled with a JavaScript interpreter. Each generation
assigns collision-free random numeric opcodes to common instructions and to
each statically addressed global API (for example `WeakMap`, `console.log`,
and `Math.max`). Repeated uses of the same API share its opcode. Dynamic property
access uses the global object's opcode followed by a property-access instruction.
The debug panel includes the generated instruction/API mapping in hexadecimal.
The exported code omits the symbolic instruction-name table and uses randomized
numeric literals directly in the interpreter dispatch. Human-readable instruction
names are retained only in generation-time debug metadata, not in that table in
the output. The interpreter still exposes operation semantics: this makes analysis
less convenient, not impossible, and is not a security guarantee.
The interpreter itself does not use `eval` or `Function`.
The source editor starts with a Fibonacci example and supports formatting on paste
and typing. Submitting formats the source with Prettier, minifies it with Vite's
built-in minifier, then obfuscates it, minifies the generated VM output again,
and formats the final result with Prettier.
Local variable, parameter, and function binding names are replaced with short
internal identifiers in the bytecode, including top-level declarations.
Property keys, global API paths, and string values are preserved. Final formatting
restores whitespace for readability; it does not undo identifier minification.
The minifier endpoint is provided by the
Vite development and preview servers; serving the built files from a static
host alone does not provide that endpoint. Invalid JavaScript is reported on
the page. The debug panel lists all references rooted at globals available in
the preview page, including calls, constructors, superclass references, and
values. Locally declared or imported names are excluded. Repeated references
are retained, each with its source location and the current environment's value
type. Classes and prototype-bearing functions are labeled `class` and
`constructor`; the latter is a heuristic, not a guarantee of constructibility.
Getters are not invoked (`accessor`), and dynamic properties are labeled `unknown`.
This is static analysis, not an execution trace: aliases and runtime assignments
are not evaluated.
This is a demonstration, not
code protection; do not run generated code from untrusted sources.

## VM language subset

The VM supports plain parameters, normal functions and arrows, recursion,
closures, `var`/`let`/`const`, blocks, `if`, `while`, classic `for`,
unlabeled `break`/`continue`, `return`, arrays, plain object properties,
property reads/writes, function calls, `new`, and basic arithmetic, comparison,
bitwise, logical, assignment, update, and conditional expressions.
Normal functions use strict `this` semantics; arrows capture lexical `this`.
Global API references are resolved in the execution environment, not eagerly
captured during generation. Native method receivers and argument evaluation
order are preserved.

Unsupported syntax produces an explicit error with its source location, without
a dynamic-code fallback. This includes classes, modules, async/generators,
exceptions, destructuring, spread/rest/default parameters, optional chaining,
template/regexp literals, object methods/accessors, sparse arrays, `delete`,
`for-in`/`for-of`, `do-while`, labels, and logical assignment operators.
Function `arguments` is currently represented by an array, without sloppy-mode
parameter aliasing or native arguments-object behavior. Function names and source
reflection are not preserved. Direct `eval` and `Function` references are rejected.
This is not a full JavaScript implementation, a sandbox, or a security feature.
Explicit calls to dynamic-code APIs through aliases or host APIs are not made
CSP-compatible by the VM.

Each editor displays the UTF-8 byte size of its current contents below the code,
updating as the source or formatted output changes. Sizes automatically switch
to KB, MB, and GB using decimal units (1 KB = 1,000 bytes).

Package source lives in `src/`. Vite bundles the ESM output, and TypeScript
generates declarations in `dist/`. Add public exports to `src/index.ts`; build
configuration is in `vite.config.ts`.
