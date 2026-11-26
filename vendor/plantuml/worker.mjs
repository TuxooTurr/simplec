import { readFileSync } from "node:fs";

console.log = console.info = console.debug = console.warn = () => {};
globalThis.fetch = async () => { throw new Error("PlantUML network access is disabled"); };

const viz = await import("./viz.mjs");
let graphviz;
globalThis.Viz = { instance: () => graphviz ??= viz.instance() };
const { renderSvg } = await import("./engine.mjs");

const sources = JSON.parse(readFileSync(0, "utf8"));
const images = [];
let remaining = 12 * 1024 * 1024;
for (const source of sources) {
  try {
    const payload = await new Promise(resolve => renderSvg(source, resolve));
    const result = JSON.parse(payload);
    const svg = result.valid && typeof result.svg === "string" ? result.svg : "";
    const size = Buffer.byteLength(svg);
    if (size > remaining || size > 3 * 1024 * 1024) {
      images.push(null);
    } else {
      images.push(svg || null);
      remaining -= size;
    }
  } catch {
    images.push(null);
  }
}

process.stdout.write(JSON.stringify(images));
