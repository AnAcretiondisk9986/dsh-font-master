/**
 * dsh-font-master — browser half.
 *
 * DeepSeek Harness paints every piece of text from two custom properties:
 *
 *   --dsw-font-family      UI chrome *and* body text (one shared stack)
 *   --ds-font-family-code  code blocks and monospace surfaces
 *
 * and the Markdown body re-derives a whole family of tokens from
 * `--dsw-font-family` (`--dsw-font-markdown-base`, `-h1`…`-h4`, `-table`,
 * `-small`, …). That last fact is what makes a separate *content* font possible
 * without touching the DOM: overriding the Markdown tokens gives the transcript
 * its own face while the chrome keeps `--dsw-font-family`.
 *
 * The plugin therefore never rewrites component CSS. It owns one stylesheet:
 *
 *   html,body { <token overrides> !important }
 *
 * `!important` is required, not decorative: ui-theme declares these on `:root`
 * and on `body`, and ui-layout writes the resolved theme snapshot onto
 * `document.body` as inline custom properties, which outrank a plain rule.
 *
 * Chinese and Latin are split by ordinary font-stack ordering, the standard
 * technique: the Latin family is listed first and simply has no Han glyphs, so
 * Han characters fall through to the Chinese family behind it.
 */

window.__ModuleLoader__.load({
	id: "dsh-font-master",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** The shell seeds `react`; tolerate either the namespace or a CJS default. */
		const reactNs = require("react");
		const React = reactNs && reactNs.createElement ? reactNs : (reactNs && reactNs.default) || reactNs;
		const h = React.createElement;

		/** Client Services this half consumes; the Client Loader reads this export. */
		const inject = ["locale", "slots"];

		/** Dictionary namespace owned by this plugin. */
		const NS = "dsh-font-master";
		/** Where the chosen families live. */
		const STATE_KEY = "dsh-font-master:v1";
		/** Where the generated stylesheet text is mirrored for the host bootstrap. */
		const CSS_KEY = "dsh-font-master:css";
		/** Our stylesheet element. */
		const STYLE_ID = "dsh-font-master";
		/** The host half's first-paint element, adopted and dropped on first sync. */
		const BOOT_STYLE_ID = "dsh-font-master-boot";

		/** Plugin-owned copy: `zh` is the key-set source of truth, `en` mirrors it. */
		const DICTS = {
			zh: {
				"section.lead": "分别设置界面、内容与代码三处字体，每处都可以单独指定西文字体和中文字体。留空表示跟随 DeepSeek Harness 默认。",
				"section.note": "字体必须已经装在你这台机器上，否则浏览器会静默回退到后面的候选。本插件不含任何字体文件。",
				"group.ui.title": "界面字体",
				"group.ui.hint": "侧栏、菜单、按钮、设置、标题等外壳文字。",
				"group.content.title": "内容字体",
				"group.content.hint": "会话正文：助手回复的 Markdown，以及你发送的消息。代码块和行内代码不受影响。",
				"group.code.title": "代码字体",
				"group.code.hint": "代码块、行内代码、diff、JSON 树等等宽区域。",
				"slot.latin": "西文",
				"slot.cjk": "中文",
				"slot.placeholder": "字体名，可用逗号分隔多个",
				"slot.custom": "自定义 / 未在列表中",
				"follow": "内容字体跟随界面字体",
				"preview": "预览",
				"reset": "全部恢复默认",
				"missing": "（本机未检测到）",
				"monoHint": "建议选择等宽字体",
				"sample": "汉字排版 Handgloves 0123 —— 中英混排 Sample",
			},
			en: {
				"section.lead": "Set the interface, content and code faces independently; each one takes its own Latin and CJK family. Leave a field empty to keep the DeepSeek Harness default.",
				"section.note": "A family must already be installed on this machine, otherwise the browser falls back to the next candidate silently. This plugin ships no font files.",
				"group.ui.title": "Interface font",
				"group.ui.hint": "Sidebar, menus, buttons, settings, headings — the chrome around your conversation.",
				"group.content.title": "Content font",
				"group.content.hint": "The transcript: assistant Markdown and the messages you send. Code blocks and inline code are untouched.",
				"group.code.title": "Code font",
				"group.code.hint": "Code blocks, inline code, diffs, JSON trees — every monospace surface.",
				"slot.latin": "Latin",
				"slot.cjk": "CJK",
				"slot.placeholder": "Family name; commas separate a list",
				"slot.custom": "Custom / not listed",
				"follow": "Content font follows the interface font",
				"preview": "Preview",
				"reset": "Reset everything",
				"missing": " (not detected on this machine)",
				"monoHint": "A monospace family is recommended",
				"sample": "Handgloves 0123 — 汉字排版 Sample",
			},
		};

		/**
		 * The tail of the stock Harness stacks. Kept behind the user's picks so
		 * scripts the chosen families do not cover (emoji, rare symbols) still
		 * resolve to the faces the Harness intends.
		 */
		const UI_TAIL = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
		const CODE_TAIL = '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"';

		/**
		 * Keywords the CSS font machinery defines itself. They must be emitted
		 * verbatim: quoting `-apple-system` or `BlinkMacSystemFont` turns a system
		 * font into a family lookup that finds nothing and silently loses the tail.
		 */
		const GENERIC_FAMILIES = new Set([
			"serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
			"ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji",
			"math", "fangsong", "inherit", "initial", "unset", "revert",
			"-apple-system", "blinkmacsystemfont", "-webkit-body", "-webkit-pictograph",
		]);

		/**
		 * Markdown `font` shorthands whose family is pinned to `--dsw-font-family`.
		 *
		 * Each of these has four sibling longhands in ui-theme
		 * (`-font-style`, `-font-weight`, `-font-size`, `-line-height`), so the
		 * override rebuilds the shorthand from those instead of copying the
		 * version-specific size and line-height formulas. That keeps the plugin
		 * working when the Harness retunes the type scale.
		 */
		const MD_SHORTHANDS = [
			"--dsw-font-markdown-h1",
			"--dsw-font-markdown-h2",
			"--dsw-font-markdown-h3",
			"--dsw-font-markdown-h4",
			"--dsw-font-markdown-base",
			"--dsw-font-markdown-base-strong",
			"--dsw-font-markdown-base-italic",
			"--dsw-font-markdown-base-strong-italic",
			"--dsw-font-markdown-table",
			"--dsw-font-markdown-table-head",
			"--dsw-font-markdown-small",
			"--dsw-font-markdown-small-strong",
			"--dsw-font-markdown-small-italic",
			"--dsw-font-markdown-small-strong-italic",
		];

		/**
		 * User-message plain text. Chat renders user text as `.plainRun` spans
		 * inside the bubble; the bubble itself uses the shared `--dsw-font-family`
		 * and has no content token of its own, so this is the one place the plugin
		 * needs a class hook. Both CSS-Module naming orders are matched, and a
		 * renamed local would only cost coverage — never a broken layout.
		 */
		const USER_TEXT_SELECTOR = 'html:root body [class*="_plainRun"],html:root body [class*="plainRun_"]';

		/** Guard against a typo turning into an unbounded stylesheet. */
		const MAX_FAMILY_INPUT = 200;

		// ------------------------------------------------------------------
		// Font stacks
		// ------------------------------------------------------------------

		/**
		 * Turn free-form user input into a CSS family list.
		 *
		 * Accepts a comma-separated list, quotes bare names, leaves generic
		 * keywords and already-quoted names alone, and strips the characters that
		 * would let a value escape the declaration it is interpolated into.
		 * @param input - raw user text.
		 * @returns the ready-to-emit family segments.
		 */
		function toFamilyList(input) {
			if (typeof input !== "string") return [];
			const out = [];
			for (const rawSegment of input.slice(0, MAX_FAMILY_INPUT).split(",")) {
				const segment = rawSegment.replace(/[;{}<>\\]/g, "").replace(/"/g, "'").trim();
				if (segment === "") continue;
				// A leading hyphen is the vendor-keyword namespace (`-apple-system`),
				// never a family name that would survive quoting.
				if (GENERIC_FAMILIES.has(segment.toLowerCase()) || segment.startsWith("-")) {
					out.push(segment);
					continue;
				}
				if (/^'.*'$/.test(segment)) {
					out.push(segment);
					continue;
				}
				out.push("'" + segment + "'");
			}
			return out;
		}

		/**
		 * Build one stack: Latin first, then CJK, then the stock Harness tail.
		 * Latin-first ordering is the whole CJK/Latin split — the Latin family
		 * simply has no Han glyphs and Han falls through to the next family.
		 * @param group - `{ latin, cjk }` from the state.
		 * @param tail - the stock stack appended last.
		 * @returns the stack, or `""` when the group is unset.
		 */
		function buildStack(group, tail) {
			const picked = toFamilyList(group && group.latin).concat(toFamilyList(group && group.cjk));
			if (picked.length === 0) return "";
			return picked.concat(toFamilyList(tail)).join(", ");
		}

		/**
		 * Rebuild the Markdown family tokens around a content stack.
		 * @param family - the resolved content family list.
		 * @returns one declaration per token, without the trailing semicolon.
		 */
		function markdownDeclarations(family) {
			const out = [];
			for (const name of MD_SHORTHANDS) {
				out.push(name + ":var(" + name + "-font-style,normal) var(" + name + "-font-weight,400) "
					+ "var(" + name + "-font-size,14px)/var(" + name + "-line-height,24px) " + family + " !important");
				// Consumers that read the longhand directly (user-text chips do).
				out.push(name + "-font-family:" + family + " !important");
			}
			return out;
		}

		/**
		 * Compose the plugin's entire stylesheet for one state.
		 *
		 * Pure: no DOM, no globals — which is what makes it testable outside the
		 * browser and why the host half can replay the stored text verbatim.
		 * @param state - the normalised plugin state.
		 * @returns CSS text, possibly empty when every group follows the default.
		 */
		function buildCss(state) {
			const ui = buildStack(state.ui, UI_TAIL);
			const contentGroup = state.content.follow ? state.ui : state.content;
			const content = buildStack(contentGroup, UI_TAIL);
			const code = buildStack(state.code, CODE_TAIL);
			// Only a content face that differs from the UI face needs its own tokens;
			// otherwise the Markdown tokens already resolve to `--dsw-font-family`.
			const contentIndependent = content !== "" && content !== ui;

			const declarations = [];
			if (ui !== "") declarations.push("--dsw-font-family:" + ui + " !important");
			if (code !== "") {
				declarations.push("--ds-font-family-code:" + code + " !important");
				// Some components read this one through `var(--dsw-font-mono, …)`.
				declarations.push("--dsw-font-mono:" + code + " !important");
			}
			if (contentIndependent) {
				for (const declaration of markdownDeclarations(content)) declarations.push(declaration);
			}

			const blocks = [];
			if (declarations.length > 0) {
				// Every declaration is terminated here, once, so no pair can run together.
				blocks.push("html,body{" + declarations.map((entry) => entry + ";").join("") + "}");
			}
			if (contentIndependent) blocks.push(USER_TEXT_SELECTOR + "{font-family:" + content + ";}");
			return blocks.join("\n");
		}

		// ------------------------------------------------------------------
		// State
		// ------------------------------------------------------------------

		/** A fresh, everything-follows-the-default state. */
		function defaultState() {
			return {
				v: 1,
				ui: { latin: "", cjk: "" },
				content: { follow: true, latin: "", cjk: "" },
				code: { latin: "", cjk: "" },
			};
		}

		/** One group, coerced to the exact shape the builders expect. */
		function normGroup(raw) {
			const src = raw && typeof raw === "object" ? raw : {};
			const pick = (value) => (typeof value === "string" ? value.slice(0, MAX_FAMILY_INPUT) : "");
			return { latin: pick(src.latin), cjk: pick(src.cjk) };
		}

		/**
		 * Coerce whatever localStorage held into the current state shape.
		 * Unknown or older payloads degrade to the default instead of throwing.
		 * @param raw - parsed JSON, of unknown provenance.
		 * @returns a valid state.
		 */
		function normalizeState(raw) {
			const base = defaultState();
			if (!raw || typeof raw !== "object") return base;
			base.ui = normGroup(raw.ui);
			base.code = normGroup(raw.code);
			const content = normGroup(raw.content);
			content.follow = !(raw.content && raw.content.follow === false);
			base.content = content;
			return base;
		}

		/** Read the persisted state, tolerating private-mode storage failures. */
		function loadState() {
			try {
				const raw = window.localStorage.getItem(STATE_KEY);
				if (raw === null) return defaultState();
				return normalizeState(JSON.parse(raw));
			} catch (error) {
				return defaultState();
			}
		}

		/**
		 * Minimal external store: one immutable state, synchronous subscribers.
		 * @param initial - starting state.
		 * @param onCommit - called after every accepted change.
		 */
		function createStore(initial, onCommit) {
			let state = initial;
			const listeners = new Set();
			return {
				get: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => { listeners.delete(listener); };
				},
				/** Replace one group, keeping identity stable when nothing changed. */
				patch: (groupId, patch) => {
					const next = Object.assign({}, state, {});
					next[groupId] = Object.assign({}, state[groupId], patch);
					state = next;
					onCommit(state);
					for (const listener of Array.from(listeners)) listener();
				},
				reset: () => {
					state = defaultState();
					onCommit(state);
					for (const listener of Array.from(listeners)) listener();
				},
			};
		}

		// ------------------------------------------------------------------
		// Catalog
		// ------------------------------------------------------------------

		/** Proportional families, split by the slot they belong in. */
		const CATALOG_TEXT = {
			cjk: [
				{
					label: "中文 · 黑体（无衬线）",
					families: [
						"微软雅黑", "Microsoft YaHei", "苹方-简", "PingFang SC", "思源黑体", "Source Han Sans SC",
						"Noto Sans SC", "HarmonyOS Sans SC", "MiSans", "OPPO Sans", "阿里巴巴普惠体", "得意黑",
						"Smiley Sans", "更纱黑体 UI SC", "Sarasa UI SC", "黑体", "SimHei", "等线", "DengXian",
						"幼圆", "YouYuan", "方正兰亭黑", "华文细黑", "STXihei",
					],
				},
				{
					label: "中文 · 宋体 / 楷体 / 仿宋",
					families: [
						"宋体", "SimSun", "思源宋体", "Source Han Serif SC", "Noto Serif SC", "华文中宋",
						"STZhongsong", "方正小标宋简体", "方正书宋简体", "楷体", "KaiTi", "华文楷体", "STKaiti",
						"仿宋", "FangSong", "仿宋_GB2312", "霞鹜文楷", "LXGW WenKai", "朱雀仿宋",
					],
				},
			],
			latin: [
				{
					label: "西文 · 无衬线",
					families: [
						"Segoe UI", "Inter", "Roboto", "Helvetica Neue", "Arial", "Verdana", "Tahoma",
						"Calibri", "Open Sans", "Lato", "Montserrat", "Poppins", "Source Sans 3",
						"IBM Plex Sans", "Noto Sans", "Nunito Sans", "Work Sans",
					],
				},
				{
					label: "西文 · 衬线",
					families: [
						"Georgia", "Times New Roman", "Cambria", "Garamond", "Book Antiqua",
						"Palatino Linotype", "Noto Serif", "Merriweather", "Source Serif 4", "Constantia",
						"Baskerville", "Rockwell",
					],
				},
				{
					label: "西文 · 展示",
					families: ["Impact", "Trebuchet MS", "Century Gothic", "Futura", "Candara", "Corbel"],
				},
			],
		};

		/** Monospace families. */
		const CATALOG_MONO = {
			latin: [
				{
					label: "等宽 · 西文",
					families: [
						"Consolas", "Cascadia Code", "Cascadia Mono", "JetBrains Mono", "Fira Code", "Fira Mono",
						"Source Code Pro", "IBM Plex Mono", "Roboto Mono", "Ubuntu Mono", "Inconsolata", "Hack",
						"Victor Mono", "Iosevka", "Maple Mono", "Menlo", "Monaco", "SF Mono", "DejaVu Sans Mono",
						"Liberation Mono", "Courier New", "Space Mono", "PT Mono", "Anonymous Pro",
					],
				},
			],
			cjk: [
				{
					label: "等宽 · 中文",
					families: [
						"更纱黑体 Mono SC", "Sarasa Mono SC", "等距更纱黑体 SC", "Sarasa Term SC",
						"Noto Sans Mono CJK SC", "霞鹜文楷等宽", "LXGW WenKai Mono", "微软雅黑", "宋体",
					],
				},
			],
		};

		/** Memoised availability answers, keyed by family name. */
		const availability = new Map();
		/** One shared measuring context. */
		let measureCtx = null;

		/**
		 * Whether a family is actually installed.
		 *
		 * Measured rather than asked for: `document.fonts.check()` reports the
		 * generic fallback as present, and `queryLocalFonts()` needs a permission
		 * prompt. Rendering the same probe string against three generic baselines
		 * and looking for a width change is the reliable, prompt-free test.
		 * @param family - the family name to probe.
		 * @returns true when installed; unknown failures answer true (never hide a font).
		 */
		function isInstalled(family) {
			if (availability.has(family)) return availability.get(family);
			let result = true;
			try {
				if (measureCtx === null) measureCtx = document.createElement("canvas").getContext("2d");
				if (measureCtx) {
					const probe = "mmmmmmmmmmlliWW汉字排版";
					const safe = family.replace(/["'\\]/g, "");
					result = false;
					for (const base of ["monospace", "serif", "sans-serif"]) {
						measureCtx.font = "72px " + base;
						const before = measureCtx.measureText(probe).width;
						measureCtx.font = "72px '" + safe + "', " + base;
						if (measureCtx.measureText(probe).width !== before) {
							result = true;
							break;
						}
					}
				}
			} catch (error) {
				result = true;
			}
			availability.set(family, result);
			return result;
		}

		// ------------------------------------------------------------------
		// Settings page
		// ------------------------------------------------------------------

		/** Group descriptors driving the three cards. */
		const GROUPS = [
			{ id: "ui", key: "ui", mono: false, follow: false },
			{ id: "content", key: "content", mono: false, follow: true },
			{ id: "code", key: "code", mono: true, follow: false },
		];

		/**
		 * One family slot: a catalogue picker plus free text, so any family is
		 * reachable even when it is not in the list or not installed yet.
		 * @param props - slot descriptor and current value.
		 */
		function FamilySlot(props) {
			const { label, value, onChange, script, mono, disabled, tr } = props;
			const catalog = (mono ? CATALOG_MONO : CATALOG_TEXT)[script] || [];
			const known = new Set();
			for (const group of catalog) for (const family of group.families) known.add(family);
			const listValue = known.has(value) ? value : "";
			return h("div", { className: "dfm-slot" },
				h("span", { className: "dfm-slotLabel" }, label),
				h("div", { className: "dfm-slotFields" },
					h("select", {
						className: "dfm-select",
						value: listValue,
						disabled,
						"aria-label": label,
						onChange: (event) => onChange(event.target.value),
					},
						h("option", { value: "" }, tr("slot.custom")),
						catalog.map((group) => h("optgroup", { key: group.label, label: group.label },
							group.families.map((family) => h("option", { key: family, value: family },
								isInstalled(family) ? family : family + tr("missing"))))),
					),
					h("input", {
						className: "dfm-input",
						type: "text",
						value,
						disabled,
						placeholder: tr("slot.placeholder"),
						"aria-label": label,
						spellCheck: false,
						onChange: (event) => onChange(event.target.value),
					}),
				),
			);
		}

		/**
		 * One group card: title, hint, both slots and a live preview.
		 * @param props - group descriptor, state, patcher and translator.
		 */
		function GroupCard(props) {
			const { group, state, patch, tr } = props;
			const value = state[group.id];
			const effectiveGroup = group.follow && value.follow ? state.ui : value;
			const previewStack = buildStack(effectiveGroup, group.mono ? CODE_TAIL : UI_TAIL)
				|| (group.mono ? CODE_TAIL : UI_TAIL);
			const disabled = group.follow && value.follow;
			return h("section", { className: "dfm-card" },
				h("div", { className: "dfm-cardHead" },
					h("h3", { className: "dfm-cardTitle" }, tr("group." + group.key + ".title")),
					h("p", { className: "dfm-cardHint" }, tr("group." + group.key + ".hint")),
					group.mono ? h("p", { className: "dfm-cardHint dfm-cardHintMono" }, tr("monoHint")) : null,
				),
				group.follow ? h("label", { className: "dfm-check" },
					h("input", {
						type: "checkbox",
						checked: value.follow,
						onChange: (event) => patch(group.id, { follow: event.target.checked }),
					}),
					h("span", null, tr("follow")),
				) : null,
				h("div", { className: disabled ? "dfm-fields dfm-fieldsDisabled" : "dfm-fields" },
					h(FamilySlot, {
						label: tr("slot.latin"),
						value: value.latin,
						onChange: (next) => patch(group.id, { latin: next }),
						script: "latin",
						mono: group.mono,
						disabled,
						tr,
					}),
					h(FamilySlot, {
						label: tr("slot.cjk"),
						value: value.cjk,
						onChange: (next) => patch(group.id, { cjk: next }),
						script: "cjk",
						mono: group.mono,
						disabled,
						tr,
					}),
				),
				h("div", { className: "dfm-preview" },
					h("span", { className: "dfm-previewTag" }, tr("preview")),
					h("span", {
						className: "dfm-previewText",
						style: { fontFamily: previewStack },
					}, tr("sample")),
				),
			);
		}

		/**
		 * The settings page body.
		 * @param props - slot props; `t` arrives only when the host passes a translator.
		 */
		function FontsSection(props) {
			const t = props && typeof props.t === "function" ? props.t : null;
			const tr = (key) => (t ? t(key) : (DICTS.zh[key] || key));
			const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
			return h("div", { className: "dfm-root" },
				h("p", { className: "dfm-lead" }, tr("section.lead")),
				GROUPS.map((group) => h(GroupCard, {
					key: group.id,
					group,
					state,
					patch: store.patch,
					tr,
				})),
				h("div", { className: "dfm-actions" },
					h("button", {
						type: "button",
						className: "dfm-button",
						onClick: () => store.reset(),
					}, tr("reset")),
					h("span", { className: "dfm-note" }, tr("section.note")),
				),
			);
		}

		/** This plugin's own chrome, built from the theme's semantic tokens. */
		const CSS = [
			".dfm-root{display:flex;flex-direction:column;gap:14px;padding:2px 0 28px;}",
			".dfm-lead{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;}",
			".dfm-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);}",
			".dfm-cardHead{display:flex;flex-direction:column;gap:4px;}",
			".dfm-cardTitle{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}",
			".dfm-cardHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-cardHintMono{color:var(--dsw-alias-label-tertiary);font-style:italic;}",
			".dfm-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;}",
			".dfm-fields{display:flex;flex-direction:column;gap:8px;}",
			".dfm-fieldsDisabled{opacity:.5;}",
			".dfm-slot{display:flex;align-items:center;gap:10px;}",
			".dfm-slotLabel{flex:none;width:34px;font-size:12px;color:var(--dsw-alias-label-secondary);}",
			".dfm-slotFields{display:flex;flex:1;min-width:0;gap:8px;}",
			".dfm-select{flex:1 1 46%;min-width:0;height:30px;padding:0 6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;}",
			".dfm-input{flex:1 1 54%;min-width:0;height:30px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;}",
			".dfm-select:focus-visible,.dfm-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));}",
			".dfm-preview{display:flex;align-items:baseline;gap:10px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);overflow:hidden;}",
			".dfm-previewTag{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-previewText{font-size:15px;line-height:22px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			".dfm-actions{display:flex;align-items:center;gap:12px;}",
			".dfm-button{height:30px;padding:0 14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;}",
			".dfm-button:hover{background:var(--dsw-alias-interactive-bg-hover);}",
			".dfm-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
		].join("");

		// ------------------------------------------------------------------
		// Wiring
		// ------------------------------------------------------------------

		/** The live store; created in `apply` once persistence is available. */
		let store = null;

		/**
		 * Keep exactly one stylesheet in the document and mirror its text for the
		 * host bootstrap, so the next page load paints the chosen fonts immediately.
		 * @param css - stylesheet text.
		 */
		function publish(css) {
			try {
				let tag = document.getElementById(STYLE_ID);
				if (!tag) {
					tag = document.createElement("style");
					tag.id = STYLE_ID;
					tag.setAttribute("data-plugin", "dsh-font-master");
					(document.head || document.documentElement).appendChild(tag);
				}
				tag.textContent = css;
				// The bootstrap element has done its job; our tag now owns the tokens.
				const boot = document.getElementById(BOOT_STYLE_ID);
				if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
			} catch (error) {
				// A DOM failure must never take the settings page down with it.
			}
			try {
				window.localStorage.setItem(CSS_KEY, css);
			} catch (error) {
				// Private mode: the plugin still works, it just loses first paint.
			}
		}

		/** Insert this plugin's own settings-page chrome. */
		function injectChrome() {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-font-master/chrome";
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => { tag.remove(); };
		}

		/**
		 * Client plugin body.
		 * @param ctx - client root context carrying the slot and locale services.
		 */
		function apply(ctx) {
			store = createStore(loadState(), (state) => {
				try {
					window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
				} catch (error) {
					// Not persisted, but the session keeps working.
				}
				publish(buildCss(state));
			});

			// Apply once at load: the module graph settles before the shell renders,
			// so the chosen faces are already in place for the first painted frame.
			publish(buildCss(store.get()));

			ctx.effect(() => injectChrome(), "dsh-font-master: settings chrome");
			ctx.effect(() => ctx.locale.register(NS, DICTS), "dsh-font-master: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-font-master",
				order: 6,
				label: "字体 / Fonts",
				locale: NS,
			}, FontsSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		/** Exposed for the Node-side tests; not part of the plugin contract. */
		exports.__internals = {
			buildCss,
			buildStack,
			toFamilyList,
			normalizeState,
			defaultState,
			createStore,
			MD_SHORTHANDS,
			DICTS,
			UI_TAIL,
			CODE_TAIL,
			STATE_KEY,
			CSS_KEY,
		};
		return module.exports;
	},
});
