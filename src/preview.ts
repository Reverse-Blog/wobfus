import * as monaco from "monaco-editor";
import EditorWorker from "../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import TypeScriptWorker from "../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";
import { format } from "prettier/standalone";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import { obfuscateWithMetadata } from "./obfuscate.js";
import { formatSize } from "./format-size.js";
import { findGlobalCalls } from "./global-calls.js";
import { compileVm } from "./vm-compiler.js";

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "typescript" || label === "javascript") {
      return new TypeScriptWorker();
    }

    return new EditorWorker();
  },
};

const form = document.querySelector<HTMLFormElement>("#obfuscator");
const sourceContainer = document.querySelector<HTMLDivElement>("#source");
const outputContainer = document.querySelector<HTMLDivElement>("#output");
const status = document.querySelector<HTMLParagraphElement>("#status");
const submitButton = document.querySelector<HTMLButtonElement>(".run-button");
const sourceSize = document.querySelector<HTMLSpanElement>("#source-size");
const outputSize = document.querySelector<HTMLSpanElement>("#output-size");
const globalCallList = document.querySelector<HTMLUListElement>("#global-calls");
const globalCallCount = document.querySelector<HTMLSpanElement>("#global-call-count");
const opcodeList = document.querySelector<HTMLUListElement>("#opcode-list");

if (
  !form ||
  !sourceContainer ||
  !outputContainer ||
  !status ||
  !submitButton ||
  !sourceSize ||
  !outputSize ||
  !globalCallList ||
  !globalCallCount ||
  !opcodeList
) {
  throw new Error("Could not initialize the obfuscator page.");
}

const renderOpcodes = (opcodes: ReturnType<typeof obfuscateWithMetadata>["opcodes"]) => {
  opcodeList.replaceChildren();
  for (const opcode of opcodes) {
    const item = document.createElement("li");
    const name = document.createElement("code");
    const kind = document.createElement("span");
    const value = document.createElement("span");
    name.textContent = opcode.name;
    kind.className = "debug-type";
    kind.textContent = opcode.kind;
    value.textContent = `0x${opcode.opcode.toString(16)}`;
    item.append(name, kind, value);
    opcodeList.append(item);
  }
};

const renderGlobalCalls = (calls: ReturnType<typeof findGlobalCalls>) => {
  globalCallList.replaceChildren();
  globalCallCount.textContent = String(calls.length);

  if (calls.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "debug-empty";
    emptyMessage.textContent = "No global references detected.";
    globalCallList.append(emptyMessage);
    return;
  }

  for (const call of calls) {
    const item = document.createElement("li");
    const callee = document.createElement("code");
    const type = document.createElement("span");
    const location = document.createElement("span");
    callee.textContent = call.callee;
    type.className = "debug-type";
    type.textContent = call.type;
    location.className = "debug-location";
    location.textContent = `${call.line}:${call.column}`;
    item.append(callee, type, location);
    globalCallList.append(item);
  }
};

const source = monaco.editor.create(sourceContainer, {
  value: `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));`,
  language: "javascript",
  theme: "vs-dark",
  ariaLabel: "Source code editor",
  formatOnPaste: true,
  formatOnType: true,
  renderLineHighlight: "none",
  automaticLayout: true,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 22,
  padding: { top: 12, bottom: 12 },
});

const output = monaco.editor.create(outputContainer, {
  value: "",
  language: "javascript",
  theme: "vs-dark",
  ariaLabel: "Obfuscated output editor",
  renderLineHighlight: "none",
  automaticLayout: true,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  readOnly: true,
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 22,
  padding: { top: 12, bottom: 12 },
});

const encoder = new TextEncoder();
const updateSizes = () => {
  sourceSize.textContent = formatSize(encoder.encode(source.getValue()).byteLength);
  outputSize.textContent = formatSize(encoder.encode(output.getValue()).byteLength);
};

const sourceSizeSubscription = source.onDidChangeModelContent(updateSizes);
const outputSizeSubscription = output.onDidChangeModelContent(updateSizes);
updateSizes();

async function minifyCode(code: string): Promise<string> {
  const response = await fetch("/__wobfus/minify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !("code" in result) ||
    typeof result.code !== "string"
  ) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `Minifier request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return result.code;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sourceCode = source.getValue();
  if (!sourceCode.trim()) {
    output.setValue("");
    renderGlobalCalls([]);
    renderOpcodes([]);
    status.textContent = "Enter some JavaScript code first.";
    return;
  }

  submitButton.disabled = true;
  status.textContent = "Formatting, minifying, and obfuscating code...";

  try {
    const model = source.getModel();
    if (!model) {
      throw new Error("Source editor model is unavailable.");
    }

    source.updateOptions({ readOnly: true });
    const options = {
      parser: "babel",
      plugins: [babelPlugin, estreePlugin],
    };
    const formattedSource = await format(sourceCode, options);
    compileVm(formattedSource);
    const minifiedSource = await minifyCode(formattedSource);
    const result = obfuscateWithMetadata(minifiedSource);
    const minifiedOutput = await minifyCode(result.code);
    const obfuscatedOutput = await format(minifiedOutput, options);

    source.pushUndoStop();
    source.executeEdits("format", [
      { range: model.getFullModelRange(), text: formattedSource },
    ]);
    source.pushUndoStop();
    output.setValue(obfuscatedOutput);
    renderGlobalCalls(findGlobalCalls(formattedSource));
    renderOpcodes(result.opcodes);
    status.textContent = "Done. Code was minified before and after VM obfuscation, then formatted for display.";
  } catch (error) {
    output.setValue("");
    renderGlobalCalls([]);
    renderOpcodes([]);
    console.error("Could not format or obfuscate code.", error);
    status.textContent = `Could not format or obfuscate code: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    source.updateOptions({ readOnly: false });
    submitButton.disabled = false;
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sourceSizeSubscription.dispose();
    outputSizeSubscription.dispose();
    source.dispose();
    output.dispose();
  });
}
