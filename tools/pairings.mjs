/**
 * Render the CJK / Latin pairing showcase.
 *
 * This is the plugin's headline feature made visible: the same mixed sentence,
 * drawn with several 西文 + 中文 pairings. Each row's inline style is produced by
 * the plugin's own `buildStack`, so the page shows exactly the stack the plugin
 * would emit — not a hand-written approximation of it.
 *
 * Run: node tools/pairings.mjs [outputDir]
 * Screenshot the generated `pairings.html` into `docs/pairings.png`.
 */

import fs from "node:fs";
import path from "node:path";
import { loadClient, root } from "./load-client.mjs";
import { renderPage, writeFixtures } from "./harness.mjs";

const outDir = path.resolve(process.argv[2] || path.join(root, "test", "out"));
fs.mkdirSync(outDir, { recursive: true });

const { internals } = loadClient();
const { buildStack, UI_TAIL, CODE_TAIL } = internals;

/** The sentence every row renders: Latin, digits and Han in one line. */
const SAMPLE = "中西文分立 Handgloves 0123 — 排版 Sample 示例";

/** One demonstrated pairing. */
const ROWS = [
	{
		use: "阅读正文",
		latin: "Georgia",
		cjk: "宋体",
		note: "西文衬线 + 中文宋体，接近纸面文档",
	},
	{
		use: "界面外壳",
		latin: "Segoe UI",
		cjk: "微软雅黑",
		note: "界面清晰度优先",
	},
	{
		use: "文档 / 公文",
		latin: "Times New Roman",
		cjk: "楷体",
		note: "中文用楷体，西文用经典衬线",
	},
	{
		use: "代码区域",
		latin: "Consolas",
		cjk: "宋体",
		note: "等宽字体，中文由宋体补齐",
		mono: true,
	},
	{
		use: "中文留空",
		latin: "Georgia",
		cjk: "",
		note: "中文字体不填时，汉字沿 Harness 自带的中文回退栈渲染",
	},
];

/** Showcase chrome — none of this ships with the plugin. */
const SHOWCASE_CSS = `
body { margin: 0; background: #fff; color: #1a1a1a; }
.wrap { padding: 26px 30px 34px; max-width: 1080px; }
h1 { margin: 0 0 6px; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; }
.lede { margin: 0 0 22px; font-size: 13px; line-height: 20px; color: #55595f; max-width: 760px; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #8b9096; font-weight: 600; padding: 0 14px 8px 0; }
td { padding: 13px 14px 13px 0; border-top: 1px solid #e6e8eb; vertical-align: middle; }
td.use { font-size: 12px; color: #3c4043; font-weight: 600; white-space: nowrap; }
td.pick { font-family: Consolas, monospace; font-size: 11.5px; color: #4a4f55; white-space: nowrap; }
td.pick b { color: #1a1a1a; font-weight: 600; }
td.sample { font-size: 17px; line-height: 26px; }
td.sample .cn { color: #1a1a1a; }
.note { display: block; margin-top: 3px; font-size: 11px; color: #8b9096; }
.tail { margin-top: 20px; font-size: 12px; line-height: 19px; color: #55595f; }
.tail code { font-family: Consolas, monospace; font-size: 11.5px; background: #f2f3f5; padding: 1px 5px; border-radius: 4px; }
`;

/**
 * Render the showcase body.
 * @returns HTML for the page body.
 */
function body() {
	const rows = ROWS.map((row) => {
		const group = { latin: row.latin, cjk: row.cjk };
		const stack = buildStack(group, row.mono ? CODE_TAIL : UI_TAIL);
		return `
    <tr>
      <td class="use">${row.use}</td>
      <td class="pick"><b>${row.latin || "—"}</b> + ${row.cjk || "—"}<span class="note">${row.note}</span></td>
      <td class="sample" style="font-family: ${stack}">${SAMPLE}</td>
    </tr>`;
	}).join("");

	return `
<div class="wrap">
  <h1>中西文分别指定，一个词里两种字</h1>
  <p class="lede">
    西文字体排在字体栈前面，中文字体排在后面：拉丁字母与数字命中西文字体，
    汉字因为西文字体没有对应字形，自然落到中文字体上。不需要语言检测，也不做 DOM 手术。
    下面是同一句话在几组搭配下的样子 —— 每一行的字体栈都由插件的 <code>buildStack()</code> 真实生成。
  </p>
  <table>
    <thead><tr><th>用途</th><th>西文 + 中文</th><th>渲染效果</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="tail">
    中文字体留空也不会丢汉字：插件把西文与中文接在 Harness 自带的回退栈前面，
    所以没指定的那一半仍然由系统字体负责。
  </p>
</div>`;
}

writeFixtures(outDir);
fs.writeFileSync(
	path.join(outDir, "pairings.html"),
	renderPage({ body: body(), extraCss: SHOWCASE_CSS, title: "CJK / Latin pairings" }),
	"utf8",
);

console.log(`wrote ${path.join(outDir, "pairings.html")}`);
for (const row of ROWS) {
	const stack = buildStack({ latin: row.latin, cjk: row.cjk }, row.mono ? CODE_TAIL : UI_TAIL);
	console.log(`  ${(row.latin || "—").padEnd(16)} + ${(row.cjk || "—").padEnd(8)} -> ${stack.slice(0, 72)}…`);
}
