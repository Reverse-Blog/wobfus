import * as monaco from "monaco-editor";
import EditorWorker from "../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import TypeScriptWorker from "../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";
import { format } from "prettier/standalone";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import { obfuscate } from "./obfuscate.js";
import { formatSize } from "./format-size.js";
import { minifyCode } from "./minify.js";

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "typescript" || label === "javascript") {
      return new TypeScriptWorker();
    }

    return new EditorWorker();
  },
};

monaco.editor.defineTheme("wobfus-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8B949E" },
    { token: "keyword", foreground: "FF7B72" },
    { token: "string", foreground: "A5D6FF" },
    { token: "number", foreground: "79C0FF" },
  ],
  colors: {
    "editor.background": "#0d1117",
    "editor.foreground": "#e6edf3",
    "editorLineNumber.foreground": "#6e7681",
    "editorLineNumber.activeForeground": "#e6edf3",
    "editorCursor.foreground": "#58a6ff",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#21262d",
    "editorWidget.background": "#161b22",
    "editorWidget.border": "#30363d",
    "editorIndentGuide.background1": "#21262d",
  },
});

const form = document.querySelector<HTMLFormElement>("#obfuscator");
const sourceContainer = document.querySelector<HTMLDivElement>("#source");
const outputContainer = document.querySelector<HTMLDivElement>("#output");
const submitButton = document.querySelector<HTMLButtonElement>("#obfuscate-button");
const previewButton = document.querySelector<HTMLButtonElement>("#preview-button");
const previewFrame = document.querySelector<HTMLIFrameElement>("#preview-frame");
const sourceSize = document.querySelector<HTMLSpanElement>("#source-size");
const outputSize = document.querySelector<HTMLSpanElement>("#output-size");

if (
  !form ||
  !sourceContainer ||
  !outputContainer ||
  !submitButton ||
  !previewButton ||
  !previewFrame ||
  !sourceSize ||
  !outputSize
) {
  throw new Error("Could not initialize the obfuscator page.");
}

const source = monaco.editor.create(sourceContainer, {
  value: `const canvas = document.createElement("canvas");
canvas.width = 1000;
canvas.height = 560;
const ctx = canvas.getContext("2d");
const background = ctx.createLinearGradient(0, 0, 1000, 560);
background.addColorStop(0, "#20232d");
background.addColorStop(1, "#2c2835");
ctx.fillStyle = background;
ctx.fillRect(0, 0, canvas.width, canvas.height);

const shape = ctx.createLinearGradient(320, 130, 680, 410);
shape.addColorStop(0, "#b9b0cb");
shape.addColorStop(0.5, "#989dbb");
shape.addColorStop(1, "#738f97");
ctx.fillStyle = shape;
ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
ctx.shadowBlur = 35;
ctx.shadowOffsetY = 18;
ctx.beginPath();
ctx.moveTo(500, 108);
ctx.bezierCurveTo(610, 72, 735, 176, 686, 282);
ctx.bezierCurveTo(756, 392, 582, 455, 500, 410);
ctx.bezierCurveTo(388, 466, 265, 370, 314, 266);
ctx.bezierCurveTo(254, 160, 400, 76, 500, 108);
ctx.closePath();
ctx.fill();
ctx.shadowBlur = 0;
ctx.shadowOffsetY = 0;

ctx.fillStyle = "#d4bb87";
ctx.beginPath();
ctx.arc(500, 265, 72, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = "#30333d";
ctx.fillRect(435, 238, 130, 8);
ctx.beginPath();
ctx.roundRect(446, 239, 43, 30, 10);
ctx.roundRect(511, 239, 43, 30, 10);
ctx.fill();
ctx.strokeStyle = "#efe8d8";
ctx.lineWidth = 5;
ctx.lineCap = "round";
ctx.beginPath();
ctx.arc(500, 278, 26, 0.2, Math.PI - 0.2);
ctx.stroke();

ctx.fillStyle = "#d5d2de";
ctx.textAlign = "center";
ctx.font = "500 18px system-ui, sans-serif";
ctx.fillText("stay a little mysterious.", 500, 485);

console.log("%c ", "display: inline-block; padding: 140px 250px; background: url('" + canvas.toDataURL() + "') center / contain no-repeat;");
console.log("https://www.youtube.com/watch?v=dQw4w9WgXcQ");`,
  language: "javascript",
  theme: "wobfus-dark",
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
  theme: "wobfus-dark",
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

const encodeBase64 = (value: string): string => {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const previewMarkerOwner = "obfuscated-preview";
const clearPreviewMarkers = () => {
  const model = output.getModel();
  if (model) monaco.editor.setModelMarkers(model, previewMarkerOwner, []);
};

const onPreviewMessage = (event: MessageEvent<unknown>) => {
  if (
    event.source !== previewFrame.contentWindow ||
    typeof event.data !== "object" ||
    event.data === null
  ) {
    return;
  }

  if (
    "type" in event.data &&
    event.data.type === "wobfus-preview-error" &&
    "message" in event.data &&
    typeof event.data.message === "string"
  ) {
    const line =
      "line" in event.data && typeof event.data.line === "number" && Number.isInteger(event.data.line)
        ? event.data.line
        : undefined;
    const column =
      "column" in event.data &&
      typeof event.data.column === "number" &&
      Number.isInteger(event.data.column)
        ? event.data.column
        : undefined;
    const location =
      line === undefined
        ? ""
        : ` at line ${line}${column === undefined ? "" : `, column ${column}`}`;
    console.error(`Preview error${location}: ${event.data.message}`);

    const model = output.getModel();
    if (model && line !== undefined && line >= 1 && line <= model.getLineCount()) {
      const markerColumn =
        column === undefined
          ? 1
          : Math.min(Math.max(1, column), model.getLineMaxColumn(line));
      const marker = {
        startLineNumber: line,
        startColumn: markerColumn,
        endLineNumber: line,
        endColumn: Math.min(markerColumn + 1, model.getLineMaxColumn(line)),
        message: event.data.message,
        severity: monaco.MarkerSeverity.Error,
      };
      monaco.editor.setModelMarkers(model, previewMarkerOwner, [marker]);
      output.revealLineInCenter(line);
    }
  }
};
window.addEventListener("message", onPreviewMessage);

previewButton.addEventListener("click", () => {
  const code = output.getValue();
  if (!code.trim()) {
    console.error("Obfuscate some code before running the preview.");
    return;
  }

  clearPreviewMarkers();
  const encodedCode = encodeBase64(code);
  previewFrame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:#080b13}body{overflow:auto}</style></head><body><script>
function reportError(message,line,column){parent.postMessage({type:"wobfus-preview-error",message:String(message),line:line,column:column},"*")}
window.onerror=function(message,source,line,column){reportError(message,line,column)};
window.onunhandledrejection=function(event){var stack=event.reason&&event.reason.stack;var match=typeof stack==="string"&&stack.match(/:(\\d+):(\\d+)(?:\\)?(?:\\n|$))/);reportError(event.reason,match?Number(match[1]):undefined,match?Number(match[2]):undefined)};
var bytes=Uint8Array.from(atob("${encodedCode}"),function(character){return character.charCodeAt(0)});
var script=document.createElement("script");
script.textContent=new TextDecoder().decode(bytes);
document.body.appendChild(script);
<\/script></body></html>`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const sourceCode = source.getValue();
  clearPreviewMarkers();
  if (!sourceCode.trim()) {
    output.setValue("");
    previewButton.disabled = true;
    previewFrame.srcdoc = "";
    return;
  }

  submitButton.disabled = true;
  previewButton.disabled = true;
  previewFrame.srcdoc = "";

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
    const obfuscatedCode = obfuscate(formattedSource);
    const minifiedOutput = await minifyCode(obfuscatedCode);
    const obfuscatedOutput = await format(minifiedOutput, options);

    source.pushUndoStop();
    source.executeEdits("format", [
      { range: model.getFullModelRange(), text: formattedSource },
    ]);
    source.pushUndoStop();
    output.setValue(obfuscatedOutput);
    previewButton.disabled = false;
  } catch (error) {
    output.setValue("");
    previewButton.disabled = true;
    previewFrame.srcdoc = "";
    console.error("Could not format or obfuscate code.", error);
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
    window.removeEventListener("message", onPreviewMessage);
  });
}
