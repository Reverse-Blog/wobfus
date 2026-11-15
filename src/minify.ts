import { minify } from "terser";

export async function minifyCode(code: string): Promise<string> {
  const requestSize = new TextEncoder().encode(JSON.stringify({ code })).byteLength;
  if (requestSize > 1_000_000) {
    throw new Error("JavaScript source exceeds the 1 MB limit.");
  }

  const result = await minify(code, {
    module: false,
    compress: true,
    mangle: true,
  });
  if (typeof result.code !== "string") {
    throw new Error("Minifier did not return JavaScript code.");
  }
  return result.code;
}
