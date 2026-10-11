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
 *
 * The picker's catalogue comes from the host half, which reads the platform's
 * font files — a browser cannot enumerate system fonts without a permission
 * prompt. A small built-in list stands in whenever that fetch is unavailable.
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
		/** Host route serving the installed-family catalogue. */
		const FONTS_ENDPOINT = "/dsh-font-master/fonts";

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
				"follow": "内容字体跟随界面字体",
				"preview": "预览",
				"reset": "全部恢复默认",
				"monoHint": "建议选择等宽字体",
				"sample": "汉字排版 Handgloves 0123 —— 中英混排 Sample",
				"picker.loading": "正在读取本机字体…",
				"picker.ready": "本机共 {n} 个字体族",
				"picker.fallback": "读不到本机字体清单，先用内置候选",
				"picker.rescan": "重新扫描",
				"picker.empty": "没有匹配的字体",
				"picker.recent": "最近使用",
				"picker.cjk": "中文",
				"picker.mono": "等宽",
				"picker.latin": "西文",
				"tag.serif": "衬线",
				"tag.missing": "未安装",
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
				"follow": "Content font follows the interface font",
				"preview": "Preview",
				"reset": "Reset everything",
				"monoHint": "A monospace family is recommended",
				"sample": "Handgloves 0123 — 汉字排版 Sample",
				"picker.loading": "Reading installed fonts…",
				"picker.ready": "{n} families installed",
				"picker.fallback": "Installed fonts unavailable; using the built-in list",
				"picker.rescan": "Rescan",
				"picker.empty": "No matching font",
				"picker.recent": "Recently used",
				"picker.cjk": "CJK",
				"picker.mono": "Monospace",
				"picker.latin": "Latin",
				"tag.serif": "serif",
				"tag.missing": "not installed",
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
		/** How many picks the "recently used" group remembers. */
		const MAX_RECENT = 8;
		/** Upper bound on rendered search results. */
		const MAX_RESULTS = 300;

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
				recent: [],
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
			if (Array.isArray(raw.recent)) {
				base.recent = raw.recent.filter((name) => typeof name === "string").slice(0, MAX_RECENT);
			}
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
			/** Notify every subscriber after a committed change. */
			const emit = () => {
				onCommit(state);
				for (const listener of Array.from(listeners)) listener();
			};
			return {
				get: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => { listeners.delete(listener); };
				},
				/** Replace one group, keeping identity stable when nothing changed. */
				patch: (groupId, patch) => {
					state = Object.assign({}, state, { [groupId]: Object.assign({}, state[groupId], patch) });
					emit();
				},
				/** Shallow-merge top-level fields (used by the recently-used list). */
				merge: (partial) => {
					state = Object.assign({}, state, partial);
					emit();
				},
				reset: () => {
					state = defaultState();
					emit();
				},
			};
		}

		// ------------------------------------------------------------------
		// Family catalogue
		// ------------------------------------------------------------------

		/**
		 * The built-in catalogue, used before the host answers and whenever its
		 * route is unavailable.
		 *
		 * A CJK entry is written `主名|别名|…`: the names separated by `|` are one
		 * family known under several names, the first being the label the picker
		 * shows. That keeps 「微软雅黑」 and 「Microsoft YaHei」 from appearing as two
		 * unrelated entries, and gives the picked stack both spellings so it
		 * resolves whichever one the engine indexes.
		 *
		 * `serif` is only set where the section heading claims it; `mono` comes
		 * from the section itself.
		 */
		const CATALOG_TEXT = {
			cjk: [
				{
					label: "中文 · 黑体（无衬线）",
					serif: false,
					families: [
						"微软雅黑|Microsoft YaHei", "苹方-简|PingFang SC", "思源黑体|Source Han Sans SC|Noto Sans SC",
						"鸿蒙黑体|HarmonyOS Sans SC", "MiSans", "OPPO Sans", "阿里巴巴普惠体|Alibaba PuHuiTi",
						"得意黑|Smiley Sans", "更纱黑体 UI SC|Sarasa UI SC", "黑体|SimHei", "等线|DengXian",
						"幼圆|YouYuan", "方正兰亭黑", "华文细黑|STXihei",
					],
				},
				{
					label: "中文 · 宋体 / 楷体 / 仿宋",
					serif: true,
					families: [
						"宋体|SimSun", "思源宋体|Source Han Serif SC|Noto Serif SC", "华文中宋|STZhongsong",
						"方正小标宋简体", "方正书宋简体", "楷体|KaiTi", "华文楷体|STKaiti", "仿宋|FangSong",
						"仿宋_GB2312", "霞鹜文楷|LXGW WenKai", "朱雀仿宋",
					],
				},
			],
			latin: [
				{
					label: "西文 · 无衬线",
					serif: false,
					families: [
						"Segoe UI", "Inter", "Roboto", "Helvetica Neue", "Arial", "Verdana", "Tahoma",
						"Calibri", "Open Sans", "Lato", "Montserrat", "Poppins", "Source Sans 3",
						"IBM Plex Sans", "Noto Sans", "Nunito Sans", "Work Sans",
					],
				},
				{
					label: "西文 · 衬线",
					serif: true,
					families: [
						"Georgia", "Times New Roman", "Cambria", "Garamond", "Book Antiqua",
						"Palatino Linotype", "Noto Serif", "Merriweather", "Source Serif 4", "Constantia",
						"Baskerville", "Rockwell",
					],
				},
				{
					label: "西文 · 展示",
					serif: null,
					families: ["Impact", "Trebuchet MS", "Century Gothic", "Futura", "Candara", "Corbel"],
				},
			],
		};

		const CATALOG_MONO = {
			latin: [
				{
					label: "等宽 · 西文",
					serif: false,
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
					serif: null,
					families: [
						"更纱黑体 Mono SC|Sarasa Mono SC", "等距更纱黑体 SC|Sarasa Term SC",
						"Noto Sans Mono CJK SC", "霞鹜文楷等宽|LXGW WenKai Mono",
					],
				},
			],
		};

		/** Memoised availability answers for built-in entries, keyed by family name. */
		const availability = new Map();
		/** One shared measuring context. */
		let measureCtx = null;

		/**
		 * Whether a family is actually installed.
		 *
		 * Measured rather than asked for: `document.fonts.check()` reports the
		 * generic fallback as present, and `queryLocalFonts()` needs a permission
		 * prompt. Rendering the same probe string against three generic baselines
		 * and looking for a width change is the reliable, prompt-free test. Only
		 * the built-in catalogue needs it — host-enumerated entries are installed
		 * by construction.
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

		/**
		 * Flatten the built-in catalogue into family records.
		 * @returns family records in catalogue order.
		 */
		function curatedFamilies() {
			const seen = new Map();
			/**
			 * Add one catalogue entry, merging a duplicate that appears in two sections.
			 * @param entry - `主名|别名|…` for a family known under several names.
			 * @param section - the catalogue section carrying script/serif metadata.
			 * @param mono - whether the section is a monospace section.
			 */
			const add = (entry, section, mono) => {
				const names = String(entry).split("|").map((name) => name.trim()).filter(Boolean);
				if (names.length === 0) return;
				const key = names[0].toLowerCase();
				const existing = seen.get(key);
				if (existing) {
					existing.mono = existing.mono || mono;
					if (existing.serif === null) existing.serif = section.serif;
					for (const alias of names) if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
					return;
				}
				seen.set(key, {
					name: names[0],
					zh: section.cjk ? names[0] : null,
					aliases: names.slice(),
					cjk: section.cjk === true,
					mono,
					serif: section.serif === undefined ? null : section.serif,
					builtin: true,
					installed: true,
				});
			};
			for (const [script, sections] of Object.entries(CATALOG_TEXT)) {
				for (const section of sections) {
					const described = Object.assign({ cjk: script === "cjk" }, section);
					for (const name of section.families) add(name, described, false);
				}
			}
			for (const [script, sections] of Object.entries(CATALOG_MONO)) {
				for (const section of sections) {
					const described = Object.assign({ cjk: script === "cjk" }, section);
					for (const name of section.families) add(name, described, true);
				}
			}
			const families = Array.from(seen.values());
			for (const family of families) family.installed = isInstalled(family.name);
			return families;
		}

		/**
		 * Coerce one host-supplied family record into the shape the picker expects.
		 * @param raw - a record from the fonts route.
		 * @returns the record, or null when it carries no usable name.
		 */
		function normalizeFamily(raw) {
			if (!raw || typeof raw !== "object") return null;
			const name = typeof raw.name === "string" ? raw.name.trim() : "";
			if (name === "" || name.length > 200) return null;
			const aliases = Array.isArray(raw.aliases)
				? raw.aliases.filter((alias) => typeof alias === "string" && alias !== "")
				: [];
			return {
				name,
				zh: typeof raw.zh === "string" && raw.zh !== "" ? raw.zh : null,
				aliases,
				cjk: raw.cjk === true,
				mono: raw.mono === true,
				serif: raw.serif === true ? true : raw.serif === false ? false : null,
				builtin: false,
				installed: true,
			};
		}

		/** Live catalogue snapshot; replaced wholesale so React sees a new identity. */
		let catalogue = {
			families: [],
			status: "idle",
			source: "builtin",
			scannedAt: 0,
			error: null,
		};
		const catalogueListeners = new Set();
		/** The in-flight request, so repeated mounts share one fetch. */
		let catalogueRequest = null;

		/**
		 * Publish a new catalogue snapshot.
		 * @param next - fields to merge into the snapshot.
		 */
		function setCatalogue(next) {
			catalogue = Object.assign({}, catalogue, next);
			for (const listener of Array.from(catalogueListeners)) listener();
		}

		/**
		 * Subscribe to catalogue changes (for `useSyncExternalStore`).
		 * @param listener - called on every new snapshot.
		 * @returns the unsubscribe function.
		 */
		function subscribeCatalogue(listener) {
			catalogueListeners.add(listener);
			return () => { catalogueListeners.delete(listener); };
		}

		/** Read the catalogue snapshot. */
		function getCatalogue() {
			return catalogue;
		}

		/**
		 * Load the installed-family catalogue from the host half.
		 *
		 * Falls back to the built-in list when the route is missing, refuses the
		 * request, or answers with nothing usable — the picker stays usable either
		 * way, which matters because the route only exists in compositions that
		 * carry a web server.
		 *
		 * @param force - ask the host for a fresh scan.
		 * @returns a promise resolving when the snapshot settles.
		 */
		function loadCatalogue(force) {
			// One scan at a time: a double-click on "rescan" must not start a second
			// walk of the font directories.
			if (catalogueRequest !== null) return catalogueRequest;
			const fetchFn = typeof window !== "undefined" && typeof window.fetch === "function" ? window.fetch : null;
			if (fetchFn === null) {
				setCatalogue({ families: curatedFamilies(), status: "fallback", source: "builtin", error: "no fetch" });
				return Promise.resolve(catalogue);
			}

			setCatalogue({ status: "loading" });
			catalogueRequest = Promise.resolve()
				.then(() => fetchFn(FONTS_ENDPOINT + (force ? "?refresh=1" : ""), { credentials: "same-origin" }))
				.then((response) => {
					if (!response.ok) throw new Error("HTTP " + response.status);
					return response.json();
				})
				.then((payload) => {
					const families = Array.isArray(payload && payload.families)
						? payload.families.map(normalizeFamily).filter(Boolean)
						: [];
					if (families.length === 0) throw new Error("empty catalogue");
					setCatalogue({
						families,
						status: "ready",
						source: "host",
						scannedAt: typeof payload.scannedAt === "number" ? payload.scannedAt : 0,
						error: null,
					});
				})
				.catch((error) => {
					setCatalogue({
						families: curatedFamilies(),
						status: "fallback",
						source: "builtin",
						error: String((error && error.message) || error),
					});
				})
				.finally(() => {
					catalogueRequest = null;
				});
			return catalogueRequest;
		}

		/**
		 * Does one family match a search query?
		 * @param family - the family record.
		 * @param query - raw search text.
		 * @returns true when the name, its localisation, or an alias contains it.
		 */
		function matchFamily(family, query) {
			const needle = String(query || "").trim().toLowerCase();
			if (needle === "") return true;
			if (family.name.toLowerCase().includes(needle)) return true;
			if (family.zh && family.zh.toLowerCase().includes(needle)) return true;
			return (family.aliases || []).some((alias) => alias.toLowerCase().includes(needle));
		}

		/**
		 * Which headings a slot shows, and in what order. The slot's own script
		 * leads: a code slot lists monospace first, a CJK slot lists Han faces
		 * first, so the likely answer is always nearest the top.
		 * @param role - `"latin"` or `"cjk"`.
		 * @param mono - whether the slot is a monospace slot.
		 * @returns bucket ids in display order.
		 */
		function bucketOrder(role, mono) {
			if (mono) return ["mono", "cjk", "latin"];
			if (role === "cjk") return ["cjk", "latin", "mono"];
			return ["latin", "cjk", "mono"];
		}

		/**
		 * The heading a family belongs under.
		 * @param family - the family record.
		 * @returns `"cjk"`, `"mono"` or `"latin"`.
		 */
		function bucketOf(family) {
			if (family.cjk) return "cjk";
			if (family.mono) return "mono";
			return "latin";
		}

		/**
		 * The label shown for a family: its localised name when it has one.
		 * @param family - the family record.
		 * @returns the display label.
		 */
		function displayName(family) {
			return family.zh || family.name;
		}

		/**
		 * Build the rows a picker renders: group headings plus items, or a single
		 * flat list while searching. Every item row carries its flat index so the
		 * keyboard can move through it.
		 *
		 * @param families - the catalogue.
		 * @param query - current search text; empty means the grouped view.
		 * @param role - the slot's script.
		 * @param mono - whether the slot is a monospace slot.
		 * @param recent - recently used family names, most recent first.
		 * @param tr - translator.
		 * @returns the row list.
		 */
		function buildRows(families, query, role, mono, recent, tr) {
			const translated = typeof tr === "function" ? tr : (key) => key;
			const searching = String(query || "").trim() !== "";
			let index = 0;
			/** Wrap one family as an item row carrying its flat index. */
			const item = (family) => {
				const row = { type: "item", family, index };
				index += 1;
				return row;
			};

			if (searching) {
				const needle = String(query).trim().toLowerCase();
				const matched = families.filter((family) => matchFamily(family, needle));
				// Prefix matches first, then alphabetical — the order Word's own
				// search uses, and the one that puts the obvious answer on top.
				matched.sort((a, b) => {
					const aHit = a.name.toLowerCase().startsWith(needle)
						|| (a.zh || "").toLowerCase().startsWith(needle);
					const bHit = b.name.toLowerCase().startsWith(needle)
						|| (b.zh || "").toLowerCase().startsWith(needle);
					if (aHit !== bHit) return aHit ? -1 : 1;
					return displayName(a).localeCompare(displayName(b));
				});
				return matched.slice(0, MAX_RESULTS).map(item);
			}

			const rows = [];
			const byName = new Map(families.map((family) => [family.name.toLowerCase(), family]));
			const recentFamilies = (recent || [])
				.map((name) => byName.get(String(name).toLowerCase()))
				.filter(Boolean);
			if (recentFamilies.length > 0) {
				rows.push({ type: "group", label: translated("picker.recent") });
				for (const family of recentFamilies) rows.push(item(family));
			}

			const buckets = new Map(bucketOrder(role, mono).map((id) => [id, []]));
			for (const family of families) {
				// A recent entry is already listed above; do not repeat it.
				if (recentFamilies.includes(family)) continue;
				const bucket = buckets.get(bucketOf(family));
				if (bucket) bucket.push(family);
			}
			for (const [id, bucket] of buckets) {
				if (bucket.length === 0) continue;
				bucket.sort((a, b) => displayName(a).localeCompare(displayName(b)));
				rows.push({ type: "group", label: translated("picker." + id) });
				for (const family of bucket) rows.push(item(family));
			}
			return rows;
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
		 * The small right-aligned tags on a menu row.
		 * @param family - the family record.
		 * @param tr - translator.
		 * @returns the tag text, or `""`.
		 */
		function tagsOf(family, tr) {
			const tags = [];
			if (family.cjk) tags.push(tr("picker.cjk"));
			if (family.mono) tags.push(tr("picker.mono"));
			if (family.serif === true) tags.push(tr("tag.serif"));
			if (family.builtin && family.installed === false) tags.push(tr("tag.missing"));
			return tags.join(" · ");
		}

		/**
		 * Word-style family picker: a text field that doubles as the search box,
		 * with a dropdown listing every installed family rendered in its own face.
		 *
		 * @param props - slot descriptor, current value, catalogue and translator.
		 */
		function FontPicker(props) {
			const { label, value, onChange, onPick, role, mono, disabled, families, recent, tr } = props;
			const [open, setOpen] = React.useState(false);
			const [query, setQuery] = React.useState("");
			const [active, setActive] = React.useState(0);

			const rows = buildRows(families, query, role, mono, recent, tr);
			const items = rows.filter((row) => row.type === "item");
			const activeRow = items.length === 0 ? null : items[Math.min(active, items.length - 1)];

			/**
			 * Apply one pick: the localised name first, then the primary family
			 * name, so the stack resolves whether or not the engine indexes the
			 * localised record.
			 * @param family - the picked family.
			 */
			const commit = (family) => {
				const names = [];
				for (const candidate of [displayName(family), family.name]) {
					if (candidate && !names.includes(candidate)) names.push(candidate);
				}
				onChange(names.join(", "));
				onPick(family.name);
				setOpen(false);
				setQuery("");
			};

			/** Move the keyboard highlight. */
			const move = (delta) => {
				setActive((current) => Math.max(0, Math.min(items.length - 1, current + delta)));
			};

			return h("div", { className: "dfm-picker" },
				h("div", { className: "dfm-pickerField" },
					h("input", {
						className: "dfm-input dfm-inputFont",
						type: "text",
						value,
						disabled,
						placeholder: tr("slot.placeholder"),
						"aria-label": label,
						spellCheck: false,
						onFocus: () => { if (!disabled) { setOpen(true); setQuery(""); setActive(0); } },
						onChange: (event) => {
							onChange(event.target.value);
							setQuery(event.target.value);
							setOpen(true);
							setActive(0);
						},
						onKeyDown: (event) => {
							const key = event.key;
							if (key === "ArrowDown") {
								event.preventDefault();
								if (!open) { setOpen(true); setQuery(""); } else move(1);
							} else if (key === "ArrowUp") {
								event.preventDefault();
								move(-1);
							} else if (key === "Enter") {
								if (open && activeRow) { event.preventDefault(); commit(activeRow.family); }
							} else if (key === "Escape") {
								setOpen(false);
							}
						},
						onBlur: () => setOpen(false),
					}),
					h("button", {
						type: "button",
						className: "dfm-caret",
						disabled,
						tabIndex: -1,
						"aria-label": label + " \u25be",
						onMouseDown: (event) => event.preventDefault(),
						onClick: () => { setOpen(!open); setQuery(""); setActive(0); },
					}, "\u25be"),
				),
				open && !disabled ? h("div", { className: "dfm-menu", role: "listbox" },
					rows.length === 0 ? h("div", { className: "dfm-menuEmpty" }, tr("picker.empty")) : null,
					rows.map((row) => (row.type === "group"
						? h("div", { key: "g:" + row.label, className: "dfm-menuGroup" }, row.label)
						: h("button", {
							key: "f:" + row.family.name,
							type: "button",
							role: "option",
							className: "dfm-option"
								+ (activeRow && activeRow.index === row.index ? " dfm-optionOn" : ""),
							style: { fontFamily: toFamilyList(row.family.name).join(", ") },
							onMouseDown: (event) => event.preventDefault(),
							onMouseEnter: () => setActive(row.index),
							onClick: () => commit(row.family),
						},
							h("span", { className: "dfm-optionName" }, displayName(row.family)),
							h("span", { className: "dfm-optionTags" }, tagsOf(row.family, tr)),
						))),
				) : null,
			);
		}

		/**
		 * One family slot: the picker for that script.
		 * @param props - slot descriptor and current value.
		 */
		function FamilySlot(props) {
			const { label, value, onChange, onPick, role, mono, disabled, families, recent, tr } = props;
			return h("div", { className: "dfm-slot" },
				h("span", { className: "dfm-slotLabel" }, label),
				h(FontPicker, {
					label,
					value,
					onChange,
					onPick,
					role,
					mono,
					disabled,
					families,
					recent,
					tr,
				}),
			);
		}

		/**
		 * One group card: title, hint, both slots and a live preview.
		 * @param props - group descriptor, state, patcher, catalogue and translator.
		 */
		function GroupCard(props) {
			const { group, state, patch, catalogue: snapshot, tr } = props;
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
					["latin", "cjk"].map((script) => h(FamilySlot, {
						key: script,
						label: tr("slot." + script),
						value: value[script],
						onChange: (next) => patch(group.id, { [script]: next }),
						onPick: (name) => store.merge({
							recent: [name].concat(state.recent.filter((entry) => entry !== name)).slice(0, MAX_RECENT),
						}),
						role: script,
						mono: group.mono,
						disabled,
						families: snapshot.families,
						recent: state.recent,
						tr,
					})),
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
			/**
			 * Resolve a dictionary key, substituting `{name}` placeholders.
			 * @param key - dictionary key.
			 * @param params - replacement values.
			 * @returns the localised string.
			 */
			const tr = (key, params) => {
				const raw = t ? t(key) : (DICTS.zh[key] || key);
				if (!params) return raw;
				return String(raw).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
			};
			const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
			const snapshot = React.useSyncExternalStore(subscribeCatalogue, getCatalogue, getCatalogue);

			return h("div", { className: "dfm-root" },
				h("p", { className: "dfm-lead" }, tr("section.lead")),
				h("div", { className: "dfm-catalog" },
					h("span", {
						className: snapshot.status === "fallback" ? "dfm-catalogText dfm-catalogWarn" : "dfm-catalogText",
					}, snapshot.status === "loading"
						? tr("picker.loading")
						: snapshot.status === "ready"
							? tr("picker.ready", { n: snapshot.families.length })
							: tr("picker.fallback")),
					h("button", {
						type: "button",
						className: "dfm-button dfm-buttonSmall",
						disabled: snapshot.status === "loading",
						onClick: () => { loadCatalogue(true); },
					}, tr("picker.rescan")),
				),
				GROUPS.map((group) => h(GroupCard, {
					key: group.id,
					group,
					state,
					patch: store.patch,
					catalogue: snapshot,
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
			".dfm-catalog{display:flex;align-items:center;gap:10px;}",
			".dfm-catalogText{font-size:12px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-catalogWarn{color:var(--dsw-alias-state-warn-primary);}",
			".dfm-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);}",
			".dfm-cardHead{display:flex;flex-direction:column;gap:4px;}",
			".dfm-cardTitle{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}",
			".dfm-cardHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-cardHintMono{font-style:italic;}",
			".dfm-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;}",
			".dfm-fields{display:flex;flex-direction:column;gap:8px;}",
			".dfm-fieldsDisabled{opacity:.5;}",
			".dfm-slot{display:flex;align-items:flex-start;gap:10px;}",
			".dfm-slotLabel{flex:none;width:34px;padding-top:7px;font-size:12px;color:var(--dsw-alias-label-secondary);}",
			".dfm-picker{position:relative;flex:1;min-width:0;}",
			".dfm-pickerField{display:flex;align-items:center;}",
			".dfm-input{flex:1;min-width:0;height:30px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;}",
			".dfm-inputFont{border-top-right-radius:0;border-bottom-right-radius:0;}",
			".dfm-caret{flex:none;width:24px;height:30px;padding:0;border:0.5px solid var(--dsw-alias-border-l2);border-left:none;border-top-right-radius:var(--dsw-radius-md);border-bottom-right-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;cursor:pointer;}",
			".dfm-caret:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}",
			".dfm-input:focus-visible,.dfm-caret:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));}",
			".dfm-menu{position:absolute;z-index:40;top:32px;left:0;right:0;max-height:290px;overflow-y:auto;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-elevation-panel);}",
			".dfm-menuGroup{position:sticky;top:0;padding:5px 8px 3px;background:var(--dsw-alias-bg-overlay);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}",
			".dfm-menuEmpty{padding:10px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-option{display:flex;align-items:baseline;justify-content:space-between;gap:10px;width:100%;padding:5px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-align:left;cursor:pointer;}",
			".dfm-optionOn{background:var(--dsw-alias-interactive-bg-hover);}",
			".dfm-optionName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".dfm-optionTags{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-preview{display:flex;align-items:baseline;gap:10px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);overflow:hidden;}",
			".dfm-previewTag{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);}",
			".dfm-previewText{font-size:15px;line-height:22px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
			".dfm-actions{display:flex;align-items:center;gap:12px;}",
			".dfm-button{height:30px;padding:0 14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;}",
			".dfm-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}",
			".dfm-button:disabled{opacity:.55;cursor:default;}",
			".dfm-buttonSmall{height:24px;padding:0 10px;font-size:11px;}",
			".dfm-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
		].join("");

		// ------------------------------------------------------------------
		// Wiring
		// ------------------------------------------------------------------

		/** The live settings store; created in `apply` once persistence is available. */
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

		/**
		 * Insert this plugin's own settings-page chrome.
		 * @returns the disposer removing it again.
		 */
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

			// Warm the installed-family catalogue so the picker opens instantly.
			loadCatalogue(false);

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
			curatedFamilies,
			normalizeFamily,
			matchFamily,
			buildRows,
			bucketOrder,
			displayName,
			loadCatalogue,
			getCatalogue,
			CHROME_CSS: CSS,
			FONTS_ENDPOINT,
			MAX_RECENT,
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
