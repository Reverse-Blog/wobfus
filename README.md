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

The GitHub Actions workflow builds and deploys the playground on pushes to
`main`. Set the repository's Pages source to **GitHub Actions** and configure
the custom domain in Pages settings. The site build includes `CNAME` and
`.nojekyll`; deploy the entire `site-dist/` directory, not the repository root
or the npm package's `dist/`.

### Troubleshooting Pages

In **Settings > Pages > Build and deployment > Source**, select **GitHub
Actions**, not **Deploy from a branch**. Branch deployment runs Jekyll against
the repository source and can overwrite the Vite deployment with an unbuilt
page, even when the `Deploy playground` workflow succeeds.
The workflow checks this setting before building and fails explicitly if
branch deployment is enabled. Changing the Pages source requires repository
administration access; the workflow does not silently change that setting.

If the deployed page requests `src/preview.ts` and reports a `video/mp2t` module
MIME type or missing Monaco styles, it is serving source files rather than the
Astro build. GitHub Pages does not compile Astro or TypeScript or resolve npm imports;
the development server does. Deploy only `site-dist/`, whose HTML references
built JavaScript and CSS under `_astro/`, including Monaco styles and workers.
The default build targets the custom domain root. For a repository subpath,
run `npm run build:site -- --base /wobfus/` and preview it with
`npm run preview -- --base /wobfus/`, or set `base` in `astro.config.ts`.

After changing the Pages source, rerun **Actions > Deploy playground > Run
workflow**. Wait for deployment to finish, then reload without browser cache.
If a CDN is in front of Pages and still serves the old HTML or cached asset
404s, purge those cached responses as well.

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
