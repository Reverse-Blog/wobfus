<h1 align="center">wobfus</h1>

<p align="center">
  <img src="./trident.png" alt="Wobfus trident" width="240">
</p>

<p align="center">
  Experimental lightweight JavaScript VM obfuscation demo.
</p>

## What it does

Wobfus transforms JavaScript into a less readable form while aiming to preserve
its behavior. The browser playground lets you edit, obfuscate, and run the
result.
The playground uses a GitHub-inspired dark theme and the Wobfus trident logo.

## Playground deployment

Run `npm run dev` for the Astro development server. `npm run build` produces both the npm
package in `dist/` and the static playground in `site-dist/`, using separate
entry points: Vite for the npm package and Astro for the website. Use `npm run build:package` or
`npm run build:site` to build only one target, and `npm run preview` to serve the
built playground locally. The playground minifies generated code in the browser and does
not require a server-side minification endpoint.

On each page load, the playground sends the full page URL, browser languages,
and referring origin (when available) to `https://visitor.reverse.blog`.
This notification runs only on the website, not in the npm package.
The plain inline script lives in `src/layouts/Layout.astro`, shared by website
pages. The playground page is `src/pages/index.astro`; its browser behavior stays
in `src/preview.ts`, including Monaco workers, obfuscation, and the sandboxed runner.

The playground deploys through Vercel. The checked-in `vercel.json` selects the
**Astro** framework preset, `npm run build:site` as the build command, and
`site-dist` as the output directory. Redeploy after changing this configuration.
Configure custom domains in the Vercel project settings. The website is static
and does not require a server adapter.

Do not publish `dist/` on Vercel: it contains the npm package, not the website.
Serving its `index.js` at `/` produces an empty JavaScript response instead of HTML.

Deploy the entire `site-dist/` directory, not the repository root or the npm
package's `dist/`. The built HTML references JavaScript and CSS under `_astro/`,
including Monaco styles and workers.
The default build targets the custom domain root. For a repository subpath,
run `npm run build:site -- --base /wobfus/` and preview it with
`npm run preview -- --base /wobfus/`, or set `base` in `astro.config.ts`.

## Lightweight VM output

The demo keeps a simple virtual machine while prioritizing smaller output:

- Small, sequential instruction and API opcodes.
- One invocation opcode per statically known global API path, reused across calls.
- Plain bytecode with readable source binding names, strings, and API paths.
- Bytecode control-flow flattening enabled by default for every VM function.
- A self-contained runtime, without encoded payloads or Unicode name masking.
- Minified playground output, then formatted for readability.

The playground compiles the source directly and minifies only the generated
output. Each result still includes the VM runtime, so very small inputs will
produce larger output than the original source.

The runtime prepares a lazy API resolver registry once. Bytecode prepares the
call target before its arguments, then invokes it using the API's own opcode
(also for constructors). This preserves method receivers, getters, and API
replacements without eagerly reading browser APIs. Local functions, instance
methods, and dynamically computed API paths still use generic call instructions.
API paths remain visible in the registry; the original JavaScript is not
stored or evaluated as a source string.

## Bytecode control flow

After compilation, the compiler extracts basic blocks at branch targets and
after branches or returns. It also splits long linear sections into chunks of
at most 12 original instructions. Blocks are permuted reproducibly, implicit
fallthroughs become explicit jumps, and all jump targets are relocated.
An entry jump selects the original first block; the existing VM is unchanged.

Instructions within each block retain their original order. Jumps preserve the
stack and lexical environment, including `enter`, `leave`, and `cloneScope`.
This adds at most one fallthrough jump per block plus one entry jump per
function, increasing bytecode size and execution overhead without another VM.
The execution graph can still be recovered, especially by dynamic tracing.

**This is an experimental demo, not a security feature.** Source names and
literals are intentionally visible; the output can be inspected and
reverse-engineered.

Not all JavaScript features are supported. Always review the result and never
run code from untrusted sources.
