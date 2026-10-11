/**
 * Measure what the plugin actually does to the cascade.
 *
 * A screenshot is too coarse to tell Segoe UI from Tahoma. This page loads the
 * same real stylesheets as `preview.mjs`, then reports the *computed*
 * `font-family` of one probe per region — plus the rendered advance width of a
 * probe string, which is what proves a different face was used rather than a
 * different declaration string.
 *
 * The measurement is rendered into the page (rather than dumped to stdout)
 * because the results are then screenshotted and read as an artifact.
 *
 * Run: node tools/measure.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { loadClient, root } from "./load-client.mjs";
import { DEMO_STATE, probes, renderPage, writeFixtures } from "./harness.mjs";

const outDir = path.resolve(root, "test", "out");
fs.mkdirSync(outDir, { recursive: true });

const { internals } = loadClient();
const pluginCss = internals.buildCss(internals.normalizeState(DEMO_STATE));

/**
 * Inline measurement: report computed family and probe width per region, then
 * prepend the table so it is the first thing on the page.
 */
const MEASURE_SCRIPT = `
(function () {
  var probes = ${JSON.stringify(probes())};
  var probeText = ${JSON.stringify("Handgloves 0123")};
  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d");
  var rows = [];
  for (var i = 0; i < probes.length; i++) {
    var label = probes[i][0], selector = probes[i][1];
    var el = document.querySelector(selector);
    if (!el) { rows.push([label, "-", "MISSING " + selector]); continue; }
    var family = getComputedStyle(el).fontFamily;
    ctx.font = "16px " + family;
    var width = Math.round(ctx.measureText(probeText).width * 100) / 100;
    rows.push([label, String(width), family]);
  }
  var box = document.createElement("div");
  box.className = "measure";
  var head = document.createElement("div");
  head.className = "measureHead";
  head.textContent =
    "getComputedStyle().fontFamily \\u4e0e '" + probeText + "' \\u7684\\u6e32\\u67d3\\u5bbd\\u5ea6\\uff0816px\\uff09";
  box.appendChild(head);
  var table = document.createElement("table");
  for (var r = 0; r < rows.length; r++) {
    var tr = document.createElement("tr");
    for (var c = 0; c < rows[r].length; c++) {
      var td = document.createElement("td");
      td.textContent = rows[r][c];
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  box.appendChild(table);
  document.body.insertBefore(box, document.body.firstChild);
})();
`;

const MEASURE_CSS = `
.measure { padding: 12px 16px 16px; background: #10131a; color: #e6e9ef; font: 12px/18px Consolas, monospace; }
.measureHead { font-weight: 600; margin-bottom: 8px; color: #9fd0ff; }
.measure table { border-collapse: collapse; }
.measure td { padding: 2px 14px 2px 0; vertical-align: top; }
.measure td:first-child { color: #ffd479; white-space: nowrap; }
.measure td:nth-child(2) { color: #7ee787; text-align: right; white-space: nowrap; }
.measure td:nth-child(3) { color: #c9d1d9; }
`;

writeFixtures(outDir);
fs.writeFileSync(path.join(outDir, "plugin.css"), pluginCss, "utf8");
for (const withPlugin of [false, true]) {
	const name = withPlugin ? "measure-plugin.html" : "measure-default.html";
	let html = renderPage({ withPlugin, measureScript: MEASURE_SCRIPT });
	html = html.replace("</head>", `<style>${MEASURE_CSS}</style>\n</head>`);
	fs.writeFileSync(path.join(outDir, name), html, "utf8");
}

console.log("wrote measure-default.html / measure-plugin.html");
console.log(`probes: ${probes().length} | plugin.css: ${pluginCss.length} chars`);
