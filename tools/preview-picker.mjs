/**
 * Render the settings page's font picker to a static page for screenshotting.
 *
 * This is not a mock-up: the component tree is produced by the plugin's own
 * `FontsSection` running against the React stub, the dropdown is filled from a
 * real `enumerateFonts()` scan of this machine, and the styling is the plugin's
 * own chrome stylesheet. What the screenshot shows is what the browser half
 * renders — only the surrounding settings shell is stubbed.
 *
 * Run: node tools/preview-picker.mjs [outputDir]
 * Screenshot the generated `picker.html` into `docs/picker.png`.
 */

import fs from "node:fs";
import path from "node:path";
import { fakeClientContext, loadClient, root } from "./load-client.mjs";
import { renderTree, toHtml } from "./render-tree.mjs";
import { enumerateFonts } from "../lib/fonts.js";

const outDir = path.resolve(process.argv[2] || path.join(root, "test", "out"));
fs.mkdirSync(outDir, { recursive: true });

/** Scan this machine, exactly as the host half's route does. */
const scan = await enumerateFonts({ refresh: true });
console.log(`scanned ${scan.fileCount} font files -> ${scan.families.length} families`);

/** A `fetch` stub answering the plugin's catalogue request with that scan. */
const fetchStub = () => Promise.resolve({
	ok: true,
	status: 200,
	json: () => Promise.resolve({ families: scan.families, scannedAt: scan.scannedAt, cached: false }),
});

/** A settings state with a few recents, so the shot shows the group in use. */
const stored = new Map([["dsh-font-master:v1", JSON.stringify({
	v: 1,
	ui: { latin: "Segoe UI", cjk: "Microsoft YaHei, 微软雅黑" },
	content: { follow: false, latin: "Georgia", cjk: "SimSun, 宋体" },
	code: { latin: "Consolas", cjk: "" },
	recent: ["Georgia", "Consolas", "Segoe UI"],
})]]);

const client = loadClient({ fetch: fetchStub, localStorage: stored });
const { ctx, registered } = fakeClientContext();
client.exports.apply(ctx);
await client.internals.loadCatalogue(false);

const registration = registered.slotRegistrations[0];
/** Render the page with the plugin's own renderer. */
const render = () => renderTree(
	{ type: registration.component, props: {}, children: [] },
	client.renderComponent,
);

// Open the content card's Latin picker: the dropdown is then shown next to the
// preview line, which paints the same stack.
let tree = render();
const inputs = [];
const walk = (node) => {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) { node.forEach(walk); return; }
	if (node.type === "input" && node.props.type === "text") inputs.push(node);
	(node.children || []).forEach(walk);
};
walk(tree);
inputs[2].props.onFocus();
tree = render();
const page = toHtml(tree);

/**
 * The real theme token sheets, so the plugin's `var(--dsw-*)` values resolve.
 * Without them the plugin's own chrome has no colours, radii or shadows and the
 * screenshot would misrepresent it.
 */
const THEME_CSS = ["ui-theme.base.css", "ui-theme.design-platform.css", "ui-theme.gradient-shadow-text.css"]
	.map((name) => fs.readFileSync(path.join(root, "test", "fixtures", name), "utf8"))
	.join("\n");

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-font-master — font picker</title>
<style>
  ${THEME_CSS}
  html,body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
    font-family:var(--dsw-font-family);}
  .frame{max-width:660px;margin:0 auto;padding:22px 26px 40px;}
  .frameTitle{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8b9096;margin-bottom:12px;}
  .frameNote{margin-top:360px;font-size:12px;line-height:19px;color:#55595f;}
  /* The plugin's own chrome, verbatim. */
  ${client.internals.CHROME_CSS}
  /* The settings shell only exists so the page has a surface to sit on. */
  .dfm-root{padding:0;}
</style></head>
<body><div class="frame">
  <div class="frameTitle">设置 → 字体 / Fonts · 内容字体 · 西文槽位</div>
  ${page}
  <p class="frameNote">
    菜单内容是这台机器上真实枚举出来的字体族（${scan.families.length} 个，${scan.fileCount} 个字体文件），
    每一行用它自己的字面渲染，右侧标出中文 / 等宽 / 衬线。
    本页由插件自己的组件渲染成静态 HTML，样式与主题令牌都取自插件和 DSH 本身。
  </p>
</div></body></html>`;

fs.writeFileSync(path.join(outDir, "picker.html"), HTML, "utf8");
console.log(`wrote ${path.join(outDir, "picker.html")}`);
