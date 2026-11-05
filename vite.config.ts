import { minify, defineConfig, type Connect, type Plugin } from "vite";

const minifyPath = "/__wobfus/minify";
const maxSourceBytes = 1_000_000;

function sendJson(
  response: Parameters<Connect.NextHandleFunction>[1],
  statusCode: number,
  body: object,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function minifyEndpoint(): Plugin {
  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const requestPath = request.url?.split("?")[0];
    if (requestPath !== minifyPath) {
      next();
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Use POST to minify JavaScript." });
      return;
    }

    if (!request.headers["content-type"]?.includes("application/json")) {
      sendJson(response, 415, { error: "Expected an application/json request." });
      return;
    }

    void (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxSourceBytes) {
          sendJson(response, 413, { error: "JavaScript source exceeds the 1 MB limit." });
          return;
        }
        chunks.push(buffer);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendJson(response, 400, { error: "Request body must be valid JSON." });
        return;
      }

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("code" in payload) ||
        typeof payload.code !== "string"
      ) {
        sendJson(response, 400, { error: "Request body must contain JavaScript in a code field." });
        return;
      }

      try {
        const result = await minify("source.js", payload.code, {
          module: false,
          compress: true,
          mangle: true,
          sourcemap: false,
        });
        if (result.errors.length > 0) {
          sendJson(response, 422, { error: result.errors[0]?.message ?? "Could not minify JavaScript." });
          return;
        }
        sendJson(response, 200, { code: result.code });
      } catch (error) {
        sendJson(response, 422, {
          error: `Could not minify JavaScript: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: `Vite minifier request failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  };

  return {
    name: "wobfus-vite-minifier",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [minifyEndpoint()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    sourcemap: false,
    minify: true,
  },
});
