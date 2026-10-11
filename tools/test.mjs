/**
 * dsh-font-master — Node-side checks.
 *
 * The browser half is a lazy-CJS module-loader script, not an ES module, so the
 * suite loads it the way the shell does: stand up `window.__ModuleLoader__`,
 * capture the registration, run the factory with a stubbed `require`, and pull
 * the internals out of the returned exports.
 *
 * The interesting assertions are the integration ones: every Markdown token the
 * plugin rewrites must still exist in the shipped ui-theme stylesheet (fixtures
 * come from the DSH build under `resources/app.asar`), and the host bootstrap
 * must replay the exact storage key the browser half writes.
 *
 * Run: node tools/test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeClientContext, loadClient, root } from "./load-client.mjs";

let passed = 0;
const failures = [];

/**
 * Run one named check, recording rather than throwing so the whole suite runs.
 * @param name - human-readable check name.
 * @param fn - the assertion body.
 */
function check(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  ok   ${name}`);
	} catch (error) {
		failures.push({ name, error });
		console.log(`  FAIL ${name}\n       ${error.message}`);
	}
}

// ---------------------------------------------------------------------------
// Load the browser half the way the client module system does.
// ---------------------------------------------------------------------------

const loaded = loadClient();
const clientSource = loaded.source;
const registration = loaded.registration;
const mod = loaded.exports;
const I = loaded.internals;
const { buildCss, buildStack, toFamilyList, normalizeState, defaultState } = I;

/**
 * Re-materialise a value in this realm. The plugin runs inside a `vm` context,
 * so its arrays and objects carry the sandbox's prototypes and would fail
 * `deepStrictEqual` against host-side literals for the wrong reason.
 * @param value - any JSON-safe value.
 * @returns the same value built from host-realm objects.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Split a `selector{…}` block into its declarations.
 * @param css - generated stylesheet.
 * @param selector - the block's selector text, without the brace.
 * @returns the raw declaration strings.
 */
function blockDeclarations(css, selector) {
	const start = css.indexOf(selector + "{");
	assert.notEqual(start, -1, `block ${selector} is missing`);
	const end = css.indexOf("}", start);
	assert.notEqual(end, -1, `block ${selector} is unterminated`);
	return css.slice(start + selector.length + 1, end).split(";").filter((entry) => entry.trim() !== "");
}

console.log("\n[module contract]");

check("register id is the bare package name", () => {
	assert.equal(registration.id, "dsh-font-master");
});

check("exports apply and inject", () => {
	assert.equal(typeof mod.apply, "function");
	assert.deepEqual(Array.from(mod.inject), ["locale", "slots"]);
});

check("client module declares no top-level side effects beyond registration", () => {
	assert.ok(!/document\.head\.appendChild\([^)]*\)\s*;?\s*$/m.test(clientSource.slice(0, 200)));
});

// ---------------------------------------------------------------------------
console.log("\n[font stacks]");

check("a bare family is quoted", () => {
	assert.deepEqual(plain(toFamilyList("Inter")), ["'Inter'"]);
});

check("a comma-separated list keeps its order", () => {
	assert.deepEqual(plain(toFamilyList("Inter, Roboto")), ["'Inter'", "'Roboto'"]);
});

check("generic keywords stay unquoted", () => {
	assert.deepEqual(plain(toFamilyList("Inter, sans-serif")), ["'Inter'", "sans-serif"]);
});

check("already-quoted names are passed through", () => {
	assert.deepEqual(plain(toFamilyList("'Segoe UI'")), ["'Segoe UI'"]);
});

check("stylesheets cannot be escaped from a family value", () => {
	const out = toFamilyList('Evil"; } html { display: none } .x { a: "b');
	const joined = out.join(", ");
	assert.ok(!joined.includes(";"), "semicolon must not survive");
	assert.ok(!joined.includes("{"), "brace must not survive");
	assert.ok(!joined.includes("}"), "brace must not survive");
	assert.ok(!joined.includes('"'), "double quote must not survive");
});

check("Latin is listed before CJK so Han falls through", () => {
	const stack = buildStack({ latin: "Inter", cjk: "微软雅黑" }, I.UI_TAIL);
	assert.ok(stack.startsWith("'Inter', '微软雅黑'"), stack);
	assert.ok(stack.includes("Microsoft YaHei"), "stock tail must remain as the last resort");
});

check("an empty group builds nothing", () => {
	assert.equal(buildStack({ latin: "", cjk: "" }, I.UI_TAIL), "");
	assert.equal(buildStack(null, I.UI_TAIL), "");
});

check("CJK alone is still a usable stack", () => {
	assert.ok(buildStack({ latin: "", cjk: "思源宋体" }, I.UI_TAIL).startsWith("'思源宋体'"));
});

// ---------------------------------------------------------------------------
console.log("\n[stylesheet generation]");

check("the default state emits no stylesheet at all", () => {
	assert.equal(buildCss(defaultState()), "");
});

check("interface font overrides --dsw-font-family only", () => {
	const css = buildCss(normalizeState({ ui: { latin: "Inter", cjk: "微软雅黑" } }));
	assert.ok(css.includes("--dsw-font-family:'Inter', '微软雅黑'"), css);
	assert.ok(!css.includes("--dsw-font-markdown-base:"), "content tokens must stay untouched");
	assert.ok(!css.includes("--ds-font-family-code"), "code token must stay untouched");
	assert.ok(css.includes("!important"), "the override must outrank the theme's own declaration");
});

check("code font overrides both code tokens", () => {
	const css = buildCss(normalizeState({ code: { latin: "JetBrains Mono" } }));
	assert.ok(css.includes("--ds-font-family-code:'JetBrains Mono'"), css);
	assert.ok(css.includes("--dsw-font-mono:'JetBrains Mono'"), css);
	assert.ok(css.includes("Consolas"), "stock code tail must remain");
});

check("an independent content font rewrites every Markdown shorthand", () => {
	const css = buildCss(normalizeState({
		ui: { latin: "Inter" },
		content: { follow: false, latin: "Source Serif 4", cjk: "思源宋体" },
	}));
	for (const name of I.MD_SHORTHANDS) {
		assert.ok(css.includes(name + ":var("), `missing shorthand ${name}`);
		assert.ok(css.includes(name + "-font-family:"), `missing longhand ${name}`);
	}
	assert.ok(css.includes("'Source Serif 4', '思源宋体'"), css);
});

check("the content font also reaches user messages", () => {
	const css = buildCss(normalizeState({ content: { follow: false, latin: "Source Serif 4" } }));
	assert.ok(css.includes("_plainRun"), css);
});

check("following the interface font emits no content tokens", () => {
	const css = buildCss(normalizeState({
		ui: { latin: "Inter" },
		content: { follow: true, latin: "Source Serif 4" },
	}));
	assert.ok(!css.includes("--dsw-font-markdown-base:"), css);
	assert.ok(!css.includes("_plainRun"), css);
});

check("an identical content stack is not written twice", () => {
	const css = buildCss(normalizeState({
		ui: { latin: "Inter" },
		content: { follow: false, latin: "Inter" },
	}));
	assert.ok(!css.includes("--dsw-font-markdown-base:"), css);
});

check("generated braces stay balanced", () => {
	const css = buildCss(normalizeState({
		ui: { latin: "Inter", cjk: "微软雅黑" },
		content: { follow: false, latin: "Georgia", cjk: "宋体" },
		code: { latin: "Consolas", cjk: "更纱黑体 Mono SC" },
	}));
	const open = (css.match(/\{/g) || []).length;
	const close = (css.match(/\}/g) || []).length;
	assert.equal(open, close, "unbalanced braces");
	assert.equal(open, 2, "one token block plus one user-text block");
});

check("every declaration in the token block is well formed", () => {
	const css = buildCss(normalizeState({
		ui: { latin: "Tahoma", cjk: "黑体" },
		content: { follow: false, latin: "Georgia", cjk: "宋体" },
		code: { latin: "Consolas" },
	}));
	const declarations = blockDeclarations(css, "html,body");
	assert.ok(declarations.length > 30, `expected the content tokens too, got ${declarations.length}`);
	for (const entry of declarations) {
		assert.match(entry, /^\s*--[a-z0-9-]+\s*:\s*\S/, `malformed declaration: ${entry.slice(0, 90)}`);
		assert.ok(!entry.includes("!important--"), `declarations ran together: ${entry.slice(0, 90)}`);
	}
});

check("system font keywords are never quoted", () => {
	const css = buildCss(normalizeState({ ui: { latin: "Tahoma" }, code: { latin: "Consolas" } }));
	assert.ok(css.includes("-apple-system, BlinkMacSystemFont"), css.slice(0, 220));
	assert.ok(!css.includes("'-apple-system'"), "quoting -apple-system breaks the system-font keyword");
	assert.ok(!css.includes("'BlinkMacSystemFont'"), "quoting BlinkMacSystemFont breaks the keyword");
	assert.ok(!css.includes("'sans-serif'"), "generic families must stay unquoted");
});

check("a user-typed vendor keyword is passed through", () => {
	assert.deepEqual(plain(toFamilyList("-apple-system")), ["-apple-system"]);
});

// ---------------------------------------------------------------------------
console.log("\n[state handling]");

check("garbage state falls back to the default", () => {
	assert.deepEqual(normalizeState("nonsense"), defaultState());
	assert.deepEqual(normalizeState(null), defaultState());
	assert.deepEqual(normalizeState(42), defaultState());
});

check("partial state keeps sane defaults", () => {
	const state = normalizeState({ ui: { latin: "Inter" } });
	assert.equal(state.ui.latin, "Inter");
	assert.equal(state.ui.cjk, "");
	assert.equal(state.content.follow, true);
	assert.deepEqual(plain(state.code), { latin: "", cjk: "" });
});

check("an explicit unfollow survives normalisation", () => {
	assert.equal(normalizeState({ content: { follow: false } }).content.follow, false);
});

check("non-string family values are dropped", () => {
	assert.deepEqual(plain(normalizeState({ ui: { latin: 42, cjk: {} } }).ui), { latin: "", cjk: "" });
});

check("absurdly long input is truncated", () => {
	assert.equal(normalizeState({ ui: { latin: "x".repeat(5000) } }).ui.latin.length, 200);
});

// ---------------------------------------------------------------------------
console.log("\n[browser half smoke test]");

/**
 * Flatten arbitrarily nested child arrays, which is how `map`-produced children
 * arrive from the React stub.
 * @param value - any array.
 * @returns a flat array.
 */
function flatten(value) {
	return Array.isArray(value) ? value.flat(Infinity).filter(Boolean) : [value].filter(Boolean);
}

/**
 * Expand the React stub's descriptors into a plain tree, invoking function
 * components so nested children are exercised too.
 * @param node - a descriptor, array, or primitive.
 * @returns the expanded tree (elements only).
 */
function renderTree(node) {
	if (node === null || node === undefined || typeof node === "boolean") return null;
	if (Array.isArray(node)) return flatten(node.map(renderTree));
	if (typeof node === "string" || typeof node === "number") return node;
	if (typeof node.type === "function") return renderTree(node.type(node.props || {}));
	return {
		type: node.type,
		props: node.props || {},
		children: flatten((node.children || []).map(renderTree)),
	};
}

/**
 * Collect every element of one tag in a rendered tree.
 * @param tree - a rendered tree.
 * @param tag - the tag to collect.
 * @returns the matching nodes.
 */
function collect(tree, tag) {
	if (tree === null || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap((child) => collect(child, tag));
	const here = tree.type === tag ? [tree] : [];
	return here.concat(flatten((tree.children || []).map((child) => collect(child, tag))));
}

/**
 * Load a fresh browser half, run its `apply` against a recording context, and
 * expose a re-render helper so a check can observe the page after a change.
 * @returns the loaded module, the context record, the registration and a render function.
 */
function bootSettingsPage() {
	const client = loadClient();
	const { ctx, registered } = fakeClientContext();
	client.exports.apply(ctx);
	const registration = registered.slotRegistrations[0];
	if (!registration) throw new Error("apply registered no settings page");
	/** Render the page as React would, expanding nested components. */
	const render = (props) => renderTree(registration.component(props || {}));
	return { client, registered, registration, render, tree: render() };
}

/** The text inputs, in render order: ui latin/cjk, content latin/cjk, code latin/cjk. */
function textInputs(tree) {
	return collect(tree, "input").filter((node) => node.props.type === "text");
}

/** The content group's follow-the-interface checkbox. */
function followCheckbox(tree) {
	return collect(tree, "input").find((node) => node.props.type === "checkbox");
}

check("apply registers one settings page and one dictionary", () => {
	const { registered } = bootSettingsPage();
	assert.deepEqual(plain(registered.slotInjections), ["settings.section"]);
	assert.equal(registered.slotRegistrations.length, 1);
	assert.equal(registered.slotRegistrations[0].options.name, "settings.section");
	assert.equal(registered.slotRegistrations[0].options.id, "dsh-font-master");
	assert.equal(registered.slotRegistrations[0].options.locale, "dsh-font-master");
	assert.equal(registered.locales.length, 1);
	assert.equal(registered.locales[0].namespace, "dsh-font-master");
	assert.ok(registered.locales[0].dictionaries.zh && registered.locales[0].dictionaries.en);
});

check("the settings page renders three cards, six slots and six inputs", () => {
	const { tree } = bootSettingsPage();
	assert.equal(tree.type, "div");
	assert.equal(collect(tree, "section").length, 3, "one card per group");
	assert.equal(collect(tree, "select").length, 6, "latin + CJK for each of three groups");
	assert.equal(textInputs(tree).length, 6);
	assert.ok(followCheckbox(tree), "the content group offers follow-the-interface");
});

check("the catalogue is actually offered in the pickers", () => {
	const { tree } = bootSettingsPage();
	const values = new Set(collect(tree, "option").map((node) => node.props.value));
	assert.ok(values.has("Segoe UI"), "no Latin families offered");
	assert.ok(values.has("微软雅黑"), "no CJK families offered");
	assert.ok(values.has("Consolas"), "no monospace families offered");
	assert.ok(collect(tree, "optgroup").length > 0, "options are not grouped");
});

check("the page renders through a host translator when one is supplied", () => {
	const client = loadClient();
	const { ctx, registered } = fakeClientContext();
	client.exports.apply(ctx);
	const tree = renderTree(registered.slotRegistrations[0].component({ t: (key) => "T:" + key }));
	const titles = collect(tree, "h3").map((node) => node.children[0]);
	assert.deepEqual(plain(titles), ["T:group.ui.title", "T:group.content.title", "T:group.code.title"]);
});

check("the content slots are disabled while they follow the interface", () => {
	const { tree } = bootSettingsPage();
	const inputs = textInputs(tree);
	assert.equal(inputs[0].props.disabled, false, "the interface slots stay editable");
	assert.equal(inputs[2].props.disabled, true, "content latin must be disabled while following");
	assert.equal(inputs[3].props.disabled, true, "content CJK must be disabled while following");
});

check("editing the interface font persists the state and rewrites the stylesheet", () => {
	const { client, tree } = bootSettingsPage();
	textInputs(tree)[0].props.onChange({ target: { value: "Inter" } });

	const state = JSON.parse(client.storage.get("dsh-font-master:v1"));
	assert.equal(state.ui.latin, "Inter", "state was not persisted");
	const css = client.storage.get("dsh-font-master:css");
	assert.ok(css.includes("--dsw-font-family:'Inter'"), css);
	assert.ok(!css.includes("--dsw-font-markdown-base:"), "content must still follow the interface");
});

check("unfollowing then editing gives the content its own tokens, and following removes them", () => {
	const { client, render, tree } = bootSettingsPage();
	followCheckbox(tree).props.onChange({ target: { checked: false } });

	let next = render();
	assert.equal(textInputs(next)[2].props.disabled, false, "content slots unlock");
	textInputs(next)[0].props.onChange({ target: { value: "Inter" } });
	next = render();
	textInputs(next)[2].props.onChange({ target: { value: "Georgia" } });

	let css = client.storage.get("dsh-font-master:css");
	assert.ok(css.includes("--dsw-font-markdown-base:"), css.slice(0, 200));
	assert.ok(css.includes("_plainRun"), "user messages must follow the content font");

	// Following again drops the independent tokens but keeps the interface font.
	next = render();
	followCheckbox(next).props.onChange({ target: { checked: true } });
	css = client.storage.get("dsh-font-master:css");
	assert.ok(css.includes("--dsw-font-family:'Inter'"));
	assert.ok(!css.includes("--dsw-font-markdown-base:"));
});

check("patching repeatedly reuses a single stylesheet element", () => {
	const { client, render, tree } = bootSettingsPage();
	textInputs(tree)[0].props.onChange({ target: { value: "Inter" } });
	textInputs(render())[4].props.onChange({ target: { value: "Consolas" } });
	textInputs(render())[1].props.onChange({ target: { value: "微软雅黑" } });
	const styles = client.dom.created.filter((node) => node.tagName === "STYLE" && node.id === "dsh-font-master");
	assert.equal(styles.length, 1, "the plugin must own exactly one stylesheet element");
	assert.ok(styles[0].textContent.includes("--ds-font-family-code:'Consolas'"), styles[0].textContent.slice(0, 200));
});

check("reset restores the default and clears the published stylesheet", () => {
	const { client, render, tree } = bootSettingsPage();
	textInputs(tree)[0].props.onChange({ target: { value: "Inter" } });
	assert.notEqual(client.storage.get("dsh-font-master:css"), "");

	const buttons = collect(render(), "button");
	assert.equal(buttons.length, 1, "expected the single reset button");
	buttons[0].props.onClick();
	assert.equal(client.storage.get("dsh-font-master:css"), "", "reset must publish nothing");
	assert.deepEqual(JSON.parse(client.storage.get("dsh-font-master:v1")), {
		v: 1,
		ui: { latin: "", cjk: "" },
		content: { follow: true, latin: "", cjk: "" },
		code: { latin: "", cjk: "" },
	});
});

check("the stylesheet mirror is written for the host bootstrap", () => {
	const { client } = bootSettingsPage();
	assert.ok(client.storage.has("dsh-font-master:css"), "no CSS mirror written");
	assert.equal(client.storage.get("dsh-font-master:css"), "", "the default state must publish nothing");
});

check("a previously stored state is restored on the next boot", () => {
	const store = new Map();
	store.set("dsh-font-master:v1", JSON.stringify({
		ui: { latin: "Tahoma", cjk: "黑体" },
		content: { follow: false, latin: "Georgia", cjk: "宋体" },
		code: { latin: "Consolas", cjk: "" },
	}));
	const client = loadClient({ localStorage: store });
	const { ctx } = fakeClientContext();
	client.exports.apply(ctx);
	const css = client.storage.get("dsh-font-master:css");
	assert.ok(css.includes("--dsw-font-family:'Tahoma', '黑体'"), css.slice(0, 160));
	assert.ok(css.includes("--ds-font-family-code:'Consolas'"));
	assert.ok(css.includes("--dsw-font-markdown-base:"));
});

// ---------------------------------------------------------------------------
console.log("\n[integration with the shipped ui-theme]");

const sheet = fs.readFileSync(
	path.join(root, "test", "fixtures", "ui-theme.gradient-shadow-text.css"),
	"utf8",
);
const declared = new Set(Array.from(sheet.matchAll(/(--dsw-font-[a-z0-9-]+)\s*:/g), (m) => m[1]));

check("every rewritten shorthand exists in ui-theme", () => {
	for (const name of I.MD_SHORTHANDS) {
		assert.ok(declared.has(name), `${name} is gone from ui-theme`);
	}
});

check("every rewritten shorthand still has its four longhands", () => {
	for (const name of I.MD_SHORTHANDS) {
		for (const suffix of ["-font-style", "-font-weight", "-font-size", "-line-height"]) {
			assert.ok(declared.has(name + suffix), `${name}${suffix} is gone from ui-theme`);
		}
	}
});

check("every rewritten shorthand still pins --dsw-font-family", () => {
	const pattern = new RegExp("(" + I.MD_SHORTHANDS.join("|").replace(/--/g, "--") + ")\\s*:\\s*([^;{}]+)", "g");
	let seen = 0;
	for (const match of sheet.matchAll(pattern)) {
		if (I.MD_SHORTHANDS.includes(match[1])) {
			seen += 1;
			assert.ok(
				match[2].includes("var(--dsw-font-family)"),
				`${match[1]} no longer references --dsw-font-family: ${match[2]}`,
			);
		}
	}
	assert.equal(seen, I.MD_SHORTHANDS.length, "some shorthand was not found in the sheet");
});

check("the interface token still exists and is a literal stack", () => {
	const base = fs.readFileSync(path.join(root, "test", "fixtures", "ui-theme.base.css"), "utf8");
	assert.ok(/--dsw-font-family\s*:/.test(base));
	assert.ok(/--ds-font-family-code\s*:/.test(base));
});

// ---------------------------------------------------------------------------
console.log("\n[host bootstrap]");

const hostSource = fs.readFileSync(path.join(root, "lib", "index.js"), "utf8");

check("the bootstrap replays the key the browser half writes", () => {
	assert.equal(typeof I.CSS_KEY, "string");
	assert.ok(I.CSS_KEY.length > 0, "browser half declares no CSS key");
	const declared = /const CSS_STORAGE_KEY = "([^"]+)"/.exec(hostSource);
	assert.ok(declared, "host half declares no storage key constant");
	assert.equal(declared[1], I.CSS_KEY, "host and browser halves disagree on the storage key");
	assert.ok(
		hostSource.includes("localStorage.getItem('\" + CSS_STORAGE_KEY + \"')"),
		"the bootstrap script does not read the declared key",
	);
});

check("the injected script cannot terminate its own tag", () => {
	const script = hostSource.slice(hostSource.indexOf("const BOOT_SCRIPT"), hostSource.indexOf("export function apply"));
	assert.ok(!/<\/script/i.test(script), "boot script contains a closing script tag");
});

check("the bootstrap reads localStorage before the app boots", () => {
	assert.ok(hostSource.includes("webserver/index-inject"));
	assert.ok(hostSource.includes('placement: "head"'));
	assert.ok(hostSource.includes("try{"));
});

// ---------------------------------------------------------------------------
console.log("\n[packaging]");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

check("package name matches the loader row and module id", () => {
	const patch = fs.readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
	assert.equal(pkg.name, "dsh-font-master");
	assert.ok(patch.includes("name: dsh-font-master"), patch);
	assert.equal(registration.id, pkg.name);
});

check("the bundle patch file exists where package.json points", () => {
	assert.ok(fs.existsSync(path.join(root, pkg.dsh.bundle.patch)));
});

check("the client export points at a real file", () => {
	assert.ok(fs.existsSync(path.join(root, pkg.exports["./client"])));
	assert.equal(pkg.dsh.client.platform, "web");
});

check("every file the package ships exists", () => {
	for (const entry of pkg.files) {
		assert.ok(fs.existsSync(path.join(root, entry)), `missing ${entry}`);
	}
});

check("no font files are bundled", () => {
	const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "node_modules" || entry.name === ".git") return [];
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});
	const offenders = walk(root).filter((file) => /\.(woff2?|ttf|otf|ttc)$/i.test(file));
	assert.deepEqual(offenders, [], `font binaries present: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;


