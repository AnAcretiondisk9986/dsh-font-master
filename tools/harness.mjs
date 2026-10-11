/**
 * Shared builder for the visual and measured verification pages.
 *
 * The point of these pages is that they load the *real* stylesheets, with the
 * real hashed class names, exported from the running DSH build:
 *
 *   web-shell.css   the Vite-built shell bundle: `body{font-family:var(
 *                   --dsw-font-family, …)}` plus the CSS Modules for Markdown,
 *                   code blocks and user text under their shipped
 *                   `_local_hash_line` names.
 *   ui-theme.*.css  the sheets `@deepseek-ai/dsh-client-ui-theme` injects at
 *                   runtime: the token definitions themselves.
 *
 * The demo markup then uses the shipped class names verbatim, so the cascade
 * under test is the cascade the browser sees — not a paraphrase of it.
 */

import fs from "node:fs";
import path from "node:path";
import { root } from "./load-client.mjs";

/** Sheets loaded in the order the browser loads them. */
export const SHEETS = [
	"web-shell.css",
	"ui-theme.base.css",
	"ui-theme.design-platform.css",
	"ui-theme.gradient-shadow-text.css",
];

/** The three faces the demo asks for; picked to be unmistakably different. */
export const DEMO_STATE = {
	v: 1,
	ui: { latin: "Tahoma", cjk: "黑体" },
	content: { follow: false, latin: "Georgia", cjk: "宋体" },
	code: { latin: "Consolas", cjk: "" },
};

/** Shipped class names, as they appear in `web-shell.css`. */
const CLS = {
	markdown: "_markdown_1ypvv_5",
	tableScroll: "_tableScroll_1ypvv_192",
	codeBlock: "_block_7gxqk_4",
	plainRun: "_plainRun_fbulu_6",
};

/** Demo chrome only — none of this is part of the plugin. */
export const HARNESS_CSS = `
body { margin: 0; background: #fff; color: #1a1a1a; }
.shell { display: flex; min-height: 100vh; }
.chrome {
  width: 226px; flex: none; padding: 18px 14px; background: #f4f5f7;
  border-right: 1px solid #e3e5e8; display: flex; flex-direction: column; gap: 14px;
}
.chrome .brand { font-size: 15px; font-weight: 600; }
.chrome nav { display: flex; flex-direction: column; gap: 2px; }
.chrome nav a { display: block; padding: 7px 10px; border-radius: 8px; font-size: 13px; color: #3c4043; }
.chrome nav a.active { background: #e6e8eb; font-weight: 600; }
.chrome button { margin-top: auto; height: 30px; border: 1px solid #d6d9dd; border-radius: 8px; background: #fff; font-size: 12px; }
.region { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #8b9096; }
.main { flex: 1; min-width: 0; padding: 22px 30px 40px; }
.main > .region { margin-bottom: 10px; }
.markdown { max-width: 660px; }
.chatBubble {
  background: #eceef1; border-radius: 14px; max-width: 100%; padding: 10px 16px;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
}
.chatChip { display: inline; margin: 0 2px; font-weight: 500; color: #2b6cb0; font-family: var(--dsw-font-markdown-code-font-family); }
.bubbleRow { display: flex; justify-content: flex-end; max-width: 660px; margin-top: 16px; }
.legend { margin-top: 20px; padding: 12px 14px; border: 1px solid #e3e5e8; border-radius: 10px; font-size: 12px; color: #4a4f55; max-width: 660px; }
`;

/**
 * The demo body: chrome, one Markdown region, one user bubble.
 * @returns HTML for the page body.
 */
export function demoBody() {
	return `
<div class="shell">
  <aside class="chrome">
    <div class="region">界面区域</div>
    <div class="brand">DeepSeek Harness</div>
    <nav>
      <a class="active">新建会话</a>
      <a>工作区 Workspaces</a>
      <a>设置 Settings</a>
    </nav>
    <button>New session</button>
  </aside>
  <main class="main">
    <div class="region">内容区域 · 助手回复</div>
    <div class="${CLS.markdown}">
      <h2>内容字体示例 Content font sample</h2>
      <p>助手回复的正文走 Markdown 字体 token，与界面外壳互不影响。中文用宋体，西文用 Georgia，
      Handgloves 0123 — the quick brown fox jumps over the lazy dog.</p>
      <p>行内代码写 <code>--dsw-font-family</code>，它应该仍然是等宽字体。</p>
      <div class="${CLS.tableScroll}">
        <table>
          <thead><tr><th>用途</th><th>Token</th></tr></thead>
          <tbody>
            <tr><td>界面</td><td>--dsw-font-family</td></tr>
            <tr><td>内容</td><td>--dsw-font-markdown-*</td></tr>
            <tr><td>代码</td><td>--ds-font-family-code</td></tr>
          </tbody>
        </table>
      </div>
      <div class="${CLS.codeBlock}">
        <pre><code>const faces = ['Georgia', '\u5b8b\u4f53'];
for (const face of faces) console.log(face);   // 代码字体：Consolas</code></pre>
      </div>
    </div>
    <div class="bubbleRow">
      <div class="chatBubble"><span class="${CLS.plainRun}">这是用户发送的消息，走内容字体。</span>
      <span class="chatChip">/compact</span></div>
    </div>
    <div class="legend">
      <b>对照说明</b>：两页只有一处不同 —— 是否加载插件生成的样式表。
      字体选择：界面 Tahoma / 黑体，内容 Georgia / 宋体，代码 Consolas。
    </div>
  </main>
</div>`;
}

/**
 * Probes for the measured variant: one element per region the plugin divides.
 * @returns `[label, selector]` pairs.
 */
export function probes() {
	return [
		["界面 · 侧栏标题", ".chrome .brand"],
		["界面 · 导航项", ".chrome nav a"],
		["界面 · 按钮", ".chrome button"],
		["内容 · Markdown 段落", `.${CLS.markdown} p`],
		["内容 · Markdown 标题", `.${CLS.markdown} h2`],
		["内容 · 表格单元", `.${CLS.tableScroll} td`],
		["内容 · 行内代码", `.${CLS.markdown} :not(pre) > code`],
		["代码 · 代码块", `.${CLS.codeBlock} pre code`],
		["用户消息 · plainRun", `.${CLS.plainRun}`],
		["用户消息 · chip", ".chatChip"],
	];
}

/** Class-name map handed to the measurement script. */
export const CLASS_NAMES = CLS;

/** Copy every fixture next to the generated pages. */
export function writeFixtures(outDir) {
	const fixtureDir = path.join(root, "test", "fixtures");
	for (const name of fs.readdirSync(fixtureDir)) {
		fs.copyFileSync(path.join(fixtureDir, name), path.join(outDir, name));
	}
}

/**
 * Render one standalone page.
 * @param options - `withPlugin` links the generated stylesheet; `body` replaces
 * the default demo; `extraCss` and `measureScript` are appended verbatim.
 * @returns the full HTML document.
 */
export function renderPage(options) {
	const links = SHEETS.map((name) => `<link rel="stylesheet" href="${name}">`).join("\n");
	const script = options.measureScript ? `<script>${options.measureScript}</script>` : "";
	const extra = options.extraCss ? `<style>${options.extraCss}</style>` : "";
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-font-master — ${options.title || (options.withPlugin ? "plugin" : "default")}</title>
${links}
<style>${HARNESS_CSS}</style>
${extra}
${options.withPlugin ? '<link rel="stylesheet" href="plugin.css">' : ""}
</head>
<body>
${options.body || demoBody()}
${script}
</body>
</html>
`;
}
