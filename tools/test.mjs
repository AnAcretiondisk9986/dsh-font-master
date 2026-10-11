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
import os from "node:os";
import path from "node:path";
import { fakeClientContext, loadClient, root } from "./load-client.mjs";
import { collect, renderTree, toHtml } from "./render-tree.mjs";
import { buildCollection, buildFont } from "../test/font-fixtures.mjs";
import { enumerateFonts, fontDirectories, readFontFile } from "../lib/fonts.js";

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

/**
 * Run one asynchronous check.
 * @param name - human-readable check name.
 * @param fn - the async assertion body.
 */
async function checkAsync(name, fn) {
	try {
		await fn();
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
 * Load a fresh browser half, run its `apply` against a recording context, and
 * expose a re-render helper so a check can observe the page after a change.
 * @param options - `props` render the page with, plus `loadClient` options.
 * @returns the loaded module, the context record, the registration and a render function.
 */
function bootSettingsPage(options = {}) {
	const client = loadClient(options);
	const { ctx, registered } = fakeClientContext();
	client.exports.apply(ctx);
	const registration = registered.slotRegistrations[0];
	if (!registration) throw new Error("apply registered no settings page");
	/** Render the page as React would, expanding nested components and their hooks. */
	const render = (props) => renderTree(
		{ type: registration.component, props: props || options.props || {}, children: [] },
		client.renderComponent,
	);
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

/**
 * The label a rendered menu option shows.
 * @param option - a rendered `role="option"` button.
 * @returns the family label text.
 */
function optionLabel(option) {
	const name = option.children.find((child) => child && child.props && child.props.className === "dfm-optionName");
	return name ? name.children[0] : null;
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

check("the settings page renders three cards and six font pickers", () => {
	const { tree } = bootSettingsPage();
	assert.equal(tree.type, "div");
	assert.equal(collect(tree, "section").length, 3, "one card per group");
	assert.equal(textInputs(tree).length, 6, "latin + CJK for each of three groups");
	assert.equal(collect(tree, "button").filter((node) => node.props.className === "dfm-caret").length, 6);
	assert.equal(collect(tree, "div").filter((node) => node.props.className === "dfm-picker").length, 6);
	assert.ok(followCheckbox(tree), "the content group offers follow-the-interface");
});

check("no dropdown is rendered until a picker is opened", () => {
	const { tree } = bootSettingsPage();
	assert.equal(collect(tree, "div").filter((node) => node.props.className === "dfm-menu").length, 0);
});

check("opening a picker lists every installed family, grouped, in its own face", () => {
	const { render, tree } = bootSettingsPage();
	const latinInput = textInputs(tree)[0];
	latinInput.props.onFocus();
	const next = render();
	const menu = collect(next, "div").find((node) => node.props.className === "dfm-menu");
	assert.ok(menu, "the picker did not open");
	const options = collect(next, "button").filter((node) => node.props.role === "option");
	assert.ok(options.length > 40, `expected the built-in catalogue, got ${options.length}`);
	const groups = collect(next, "div").filter((node) => node.props.className === "dfm-menuGroup")
		.map((node) => node.children[0]);
	assert.deepEqual(plain(groups), ["西文", "中文", "等宽"], "a Latin slot leads with Latin faces");
	// Each row paints itself in the family it offers.
	assert.ok(options.some((node) => node.props.style.fontFamily.includes("'Segoe UI'")));
	assert.ok(options.some((node) => node.props.style.fontFamily.includes("'微软雅黑'")));
});

check("a code slot leads with monospace faces", () => {
	const { render, tree } = bootSettingsPage();
	textInputs(tree)[4].props.onFocus();
	const groups = collect(render(), "div")
		.filter((node) => node.props.className === "dfm-menuGroup")
		.map((node) => node.children[0]);
	assert.deepEqual(plain(groups), ["等宽", "中文", "西文"]);
});

check("typing filters the list and picking fills the field", () => {
	const { render, tree } = bootSettingsPage();
	const input = textInputs(tree)[0];
	input.props.onFocus();
	let options = collect(render(), "button").filter((node) => node.props.role === "option");
	assert.ok(options.length > 40);

	// Search by the localised name: the alias list has to be consulted.
	textInputs(render())[0].props.onChange({ target: { value: "雅黑" } });
	options = collect(render(), "button").filter((node) => node.props.role === "option");
	assert.ok(options.length >= 1 && options.length < 6, `expected a narrow match, got ${options.length}`);
	assert.equal(optionLabel(options[0]), "微软雅黑");

	options[0].props.onClick();
	assert.equal(textInputs(render())[0].props.value, "微软雅黑");
});

check("a pick is remembered in the recently-used group", () => {
	const { client, render, tree } = bootSettingsPage();
	const input = textInputs(tree)[0];
	input.props.onFocus();
	const options = collect(render(), "button").filter((node) => node.props.role === "option");
	const georgia = options.find((node) => optionLabel(node) === "Georgia");
	assert.ok(georgia, "Georgia missing from the catalogue");
	georgia.props.onClick();

	assert.deepEqual(JSON.parse(client.storage.get("dsh-font-master:v1")).recent, ["Georgia"]);
	textInputs(render())[0].props.onFocus();
	const groups = collect(render(), "div")
		.filter((node) => node.props.className === "dfm-menuGroup")
		.map((node) => node.children[0]);
	assert.equal(groups[0], "最近使用");
});

check("a search with no matches says so instead of rendering nothing", () => {
	const { render, tree } = bootSettingsPage();
	textInputs(tree)[0].props.onFocus();
	textInputs(render())[0].props.onChange({ target: { value: "zzzz-no-such-font" } });
	assert.equal(collect(render(), "button").filter((node) => node.props.role === "option").length, 0);
	const empty = collect(render(), "div").find((node) => node.props.className === "dfm-menuEmpty");
	assert.ok(empty, "no empty-state message");
});

check("the page renders through a host translator when one is supplied", () => {
	const { tree } = bootSettingsPage({ props: { t: (key) => "T:" + key } });
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

	const reset = collect(render(), "button").find((node) => node.props.className === "dfm-button");
	assert.ok(reset, "expected the reset button");
	reset.props.onClick();
	assert.equal(client.storage.get("dsh-font-master:css"), "", "reset must publish nothing");
	assert.deepEqual(JSON.parse(client.storage.get("dsh-font-master:v1")), {
		v: 1,
		ui: { latin: "", cjk: "" },
		content: { follow: true, latin: "", cjk: "" },
		code: { latin: "", cjk: "" },
		recent: [],
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
console.log("\n[installed-font catalogue]");

/**
 * A `fetch` stand-in for the host fonts route.
 * @param payload - the JSON body to answer with.
 * @param options - `ok` / `status` / `reject` control the outcome.
 * @returns the stub, carrying its recorded calls.
 */
function fetchStub(payload, options = {}) {
	const calls = [];
	const stub = (url, init) => {
		calls.push({ url, init });
		if (options.reject) return Promise.reject(new Error(options.reject));
		return Promise.resolve({
			ok: options.ok !== false,
			status: options.status === undefined ? 200 : options.status,
			json: () => Promise.resolve(payload),
		});
	};
	stub.calls = calls;
	return stub;
}

/** A host-shaped family record. */
const hostFamily = (name, extra = {}) => Object.assign({
	name,
	zh: null,
	aliases: [name],
	cjk: false,
	mono: false,
	serif: null,
}, extra);

await checkAsync("a host answer replaces the built-in list", async () => {
	const fetch = fetchStub({ families: [hostFamily("Alpha Sans"), hostFamily("Beta Serif")], scannedAt: 123 });
	const client = loadClient({ fetch });
	client.exports.apply(fakeClientContext().ctx);
	await client.internals.loadCatalogue(false);
	const snapshot = client.internals.getCatalogue();
	assert.equal(snapshot.status, "ready");
	assert.equal(snapshot.source, "host");
	assert.equal(snapshot.families.length, 2);
	assert.equal(snapshot.scannedAt, 123);
	assert.equal(fetch.calls[0].url, client.internals.FONTS_ENDPOINT);
	assert.deepEqual(plain(fetch.calls[0].init), { credentials: "same-origin" });
});

await checkAsync("a failing route falls back to the built-in list", async () => {
	const fetch = fetchStub(null, { reject: "boom" });
	const client = loadClient({ fetch });
	client.exports.apply(fakeClientContext().ctx);
	await client.internals.loadCatalogue(false);
	const snapshot = client.internals.getCatalogue();
	assert.equal(snapshot.status, "fallback");
	assert.equal(snapshot.source, "builtin");
	assert.ok(snapshot.families.some((family) => family.name === "Segoe UI"), "fallback list is not the built-in one");
});

await checkAsync("an empty catalogue counts as a failure rather than an empty picker", async () => {
	const fetch = fetchStub({ families: [] });
	const client = loadClient({ fetch });
	client.exports.apply(fakeClientContext().ctx);
	await client.internals.loadCatalogue(false);
	assert.equal(client.internals.getCatalogue().status, "fallback");
});

await checkAsync("a non-OK status falls back too", async () => {
	const fetch = fetchStub({ families: [hostFamily("Alpha")] }, { ok: false, status: 401 });
	const client = loadClient({ fetch });
	client.exports.apply(fakeClientContext().ctx);
	await client.internals.loadCatalogue(false);
	assert.equal(client.internals.getCatalogue().status, "fallback");
});

await checkAsync("a rescan asks the host for a fresh scan", async () => {
	const fetch = fetchStub({ families: [hostFamily("Alpha")] });
	const client = loadClient({ fetch });
	client.exports.apply(fakeClientContext().ctx);
	await client.internals.loadCatalogue(false);
	await client.internals.loadCatalogue(true);
	assert.equal(fetch.calls.length, 2, "the second call must not be coalesced away");
	assert.ok(fetch.calls[1].url.endsWith("?refresh=1"), fetch.calls[1].url);
});

await checkAsync("concurrent loads share one request", async () => {
	const fetch = fetchStub({ families: [hostFamily("Alpha")] });
	const client = loadClient({ fetch });
	client.exports.apply(fakeClientContext().ctx);
	await Promise.all([client.internals.loadCatalogue(true), client.internals.loadCatalogue(true)]);
	assert.equal(fetch.calls.length, 1, "two callers started two scans");
});

await checkAsync("rendering without fetch still yields a usable picker", async () => {
	const client = loadClient();
	client.exports.apply(fakeClientContext().ctx);
	await client.internals.loadCatalogue(false);
	const snapshot = client.internals.getCatalogue();
	assert.equal(snapshot.status, "fallback");
	assert.ok(snapshot.families.length > 50);
});

check("malformed host records are dropped and the rest are coerced", () => {
	const { normalizeFamily } = I;
	assert.equal(normalizeFamily(null), null);
	assert.equal(normalizeFamily({}), null);
	assert.equal(normalizeFamily({ name: "   " }), null);
	assert.equal(normalizeFamily({ name: "x".repeat(500) }), null);
	const record = normalizeFamily({ name: " Alpha ", zh: 7, aliases: ["Alpha", 9, ""], cjk: 1, mono: true, serif: "yes" });
	assert.equal(record.name, "Alpha");
	assert.equal(record.zh, null, "a non-string localisation must not survive");
	assert.deepEqual(plain(record.aliases), ["Alpha"]);
	assert.equal(record.cjk, false, "only a real boolean counts");
	assert.equal(record.mono, true);
	assert.equal(record.serif, null);
	assert.equal(record.installed, true, "host-enumerated families are installed by construction");
});

check("search matches the family name, the localisation and the aliases", () => {
	const { matchFamily } = I;
	const family = { name: "Microsoft YaHei", zh: "微软雅黑", aliases: ["Microsoft YaHei", "微软雅黑", "MSYH"] };
	assert.equal(matchFamily(family, ""), true);
	assert.equal(matchFamily(family, "yahei"), true, "case-insensitive name match");
	assert.equal(matchFamily(family, "雅黑"), true, "localised-name match");
	assert.equal(matchFamily(family, "MSYH"), true, "alias match");
	assert.equal(matchFamily(family, "consolas"), false);
});

check("each slot leads with its own kind of face", () => {
	const { bucketOrder } = I;
	assert.deepEqual(plain(bucketOrder("latin", false)), ["latin", "cjk", "mono"]);
	assert.deepEqual(plain(bucketOrder("cjk", false)), ["cjk", "latin", "mono"]);
	assert.deepEqual(plain(bucketOrder("latin", true)), ["mono", "cjk", "latin"]);
});

check("rows group by kind, honour recents, and index every item", () => {
	const { buildRows } = I;
	const families = [
		{ name: "Arial", zh: null, aliases: [], cjk: false, mono: false, serif: false },
		{ name: "Georgia", zh: null, aliases: [], cjk: false, mono: false, serif: true },
		{ name: "Consolas", zh: null, aliases: [], cjk: false, mono: true, serif: false },
		{ name: "Microsoft YaHei", zh: "微软雅黑", aliases: [], cjk: true, mono: false, serif: false },
	];
	const tr = (key) => key;
	const rows = buildRows(families, "", "latin", false, ["Georgia"], tr);
	assert.deepEqual(plain(rows.filter((row) => row.type === "group").map((row) => row.label)),
		["picker.recent", "picker.latin", "picker.cjk", "picker.mono"]);
	assert.equal(rows.filter((row) => row.type === "item").length, 4, "recents must not be listed twice");
	assert.deepEqual(plain(rows.filter((row) => row.type === "item").map((row) => row.index)), [0, 1, 2, 3]);

	const searched = buildRows(families, "雅黑", "latin", false, [], tr);
	assert.equal(searched.length, 1);
	assert.equal(searched[0].family.name, "Microsoft YaHei");
	assert.equal(searched[0].index, 0);
});

check("prefix matches sort above substring matches", () => {
	const { buildRows } = I;
	const families = [
		{ name: "Noto Sans", zh: null, aliases: [], cjk: false, mono: false, serif: null },
		{ name: "Sans Serif Pro", zh: null, aliases: [], cjk: false, mono: false, serif: null },
	];
	const rows = buildRows(families, "san", "latin", false, [], (key) => key);
	assert.deepEqual(plain(rows.map((row) => row.family.name)), ["Sans Serif Pro", "Noto Sans"]);
});

await checkAsync("a family known under two names is inserted under both", async () => {
	// The host catalogue reports the en-US family name with the localised one
	// beside it; the field then carries both spellings so the stack resolves
	// whichever of them the engine indexes.
	const fetch = fetchStub({
		families: [hostFamily("Microsoft YaHei", { zh: "微软雅黑", aliases: ["Microsoft YaHei", "微软雅黑"], cjk: true })],
	});
	const { render, tree } = bootSettingsPage({ fetch });
	await new Promise((resolve) => setImmediate(resolve));
	textInputs(tree)[0].props.onFocus();
	const options = collect(render(), "button").filter((node) => node.props.role === "option");
	assert.equal(optionLabel(options[0]), "微软雅黑");
	options[0].props.onClick();
	assert.equal(textInputs(render())[0].props.value, "微软雅黑, Microsoft YaHei");
});

// ---------------------------------------------------------------------------
console.log("\n[host font parser]");

/** A scratch directory for the synthetic font files. */
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-font-master-test-"));

/**
 * Write bytes to the scratch directory.
 * @param name - file name.
 * @param bytes - file contents.
 * @returns the absolute path.
 */
function scratchFile(name, bytes) {
	const target = path.join(scratch, name);
	fs.writeFileSync(target, bytes);
	return target;
}

await checkAsync("a single-face sfnt yields its family, localisation and aliases", async () => {
	const file = scratchFile("single.ttf", buildFont({
		legacyFamily: "Test Family",
		zh: "测试字体",
		subfamily: "Regular",
		postScript: "TestFamily-Regular",
		serifStyle: 4,
		proportion: 4,
	}));
	const faces = await readFontFile(file);
	assert.equal(faces.length, 1);
	assert.equal(faces[0].name, "Test Family");
	assert.equal(faces[0].zh, "测试字体");
	assert.equal(faces[0].subfamily, "Regular");
	assert.ok(faces[0].aliases.includes("Test Family"));
	assert.ok(faces[0].aliases.includes("测试字体"), "the localisation must be searchable");
	assert.ok(faces[0].aliases.includes("TestFamily-Regular"), "the PostScript name must be searchable");
});

await checkAsync("the typographic family name wins over the legacy one", async () => {
	const file = scratchFile("typo.ttf", buildFont({ legacyFamily: "Legacy Name", family: "Typographic Name" }));
	const faces = await readFontFile(file);
	assert.equal(faces[0].name, "Typographic Name");
	assert.ok(faces[0].aliases.includes("Legacy Name"), "the legacy name stays reachable as an alias");
});

await checkAsync("OS/2 classifies a CJK serif face", async () => {
	const file = scratchFile("cjk.ttf", buildFont({ legacyFamily: "CJK Serif", cjk: true, serifStyle: 4 }));
	const faces = await readFontFile(file);
	assert.equal(faces[0].cjk, true);
	assert.equal(faces[0].serif, true);
	assert.equal(faces[0].mono, false);
});

await checkAsync("post.isFixedPitch decides monospacing, not PANOSE proportion", async () => {
	// A CJK face declaring PANOSE proportion 9 (monospaced) but no fixed pitch is
	// what SimHei and friends look like; PANOSE alone would mislabel them.
	const misleading = scratchFile("pseudo-mono.ttf", buildFont({
		legacyFamily: "Pseudo Mono", cjk: true, proportion: 9, fixedPitch: false,
	}));
	assert.equal((await readFontFile(misleading))[0].mono, false, "PANOSE proportion alone must not imply monospace");

	const real = scratchFile("real-mono.ttf", buildFont({ legacyFamily: "Real Mono", proportion: 9, fixedPitch: true }));
	assert.equal((await readFontFile(real))[0].mono, true);
});

await checkAsync("a ttcf collection yields one family per face", async () => {
	const file = scratchFile("collection.ttc", buildCollection([
		{ options: { legacyFamily: "Collection Sans", subfamily: "Regular" } },
		{ options: { legacyFamily: "Collection Sans UI", subfamily: "Regular" } },
	]));
	const faces = await readFontFile(file);
	assert.deepEqual(faces.map((face) => face.name), ["Collection Sans", "Collection Sans UI"]);
	assert.deepEqual(faces.map((face) => face.subfamily), ["Regular", "Regular"]);
});

await checkAsync("a file that is not a font is skipped, not thrown on", async () => {
	const junk = scratchFile("junk.ttf", Buffer.from("this is definitely not a font file"));
	assert.deepEqual(await readFontFile(junk), []);
	assert.deepEqual(await readFontFile(path.join(scratch, "missing.ttf")), []);
});

await checkAsync("enumerateFonts walks a directory, groups faces and caches the result", async () => {
	const dir = path.join(scratch, "dir");
	fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
	fs.writeFileSync(path.join(dir, "one.ttf"), buildFont({ legacyFamily: "One", subfamily: "Regular" }));
	fs.writeFileSync(path.join(dir, "one-bold.ttf"), buildFont({ legacyFamily: "One", subfamily: "Bold" }));
	fs.writeFileSync(path.join(dir, "nested", "two.ttc"), buildCollection([
		{ options: { legacyFamily: "Two", subfamily: "Regular", cjk: true } },
		{ options: { legacyFamily: "Three", subfamily: "Regular" } },
	]));
	// Not a font extension at all: must never be opened.
	fs.writeFileSync(path.join(dir, "legacy.fon"), Buffer.from("nope"));

	const cacheFile = path.join(scratch, "cache", "fonts.json");
	const first = await enumerateFonts({ directories: [dir], cacheFile, refresh: true });
	assert.equal(first.fileCount, 3, "the .fon file must not be counted");
	assert.deepEqual(first.families.map((family) => family.name), ["One", "Three", "Two"]);
	const one = first.families.find((family) => family.name === "One");
	assert.deepEqual(plain(one.faces), ["Regular", "Bold"], "two files of one family collapse into one entry");
	assert.equal(first.families.find((family) => family.name === "Two").cjk, true);
	assert.equal(first.cached, false);

	const second = await enumerateFonts({ directories: [dir], cacheFile });
	assert.equal(second.cached, true, "an unchanged directory must reuse the cache");
	assert.deepEqual(second.families, first.families);

	// Adding a font changes the fingerprint, so the cache is discarded.
	fs.writeFileSync(path.join(dir, "four.ttf"), buildFont({ legacyFamily: "Four" }));
	const third = await enumerateFonts({ directories: [dir], cacheFile });
	assert.equal(third.cached, false, "a new file must invalidate the cache");
	assert.ok(third.families.some((family) => family.name === "Four"));
});

await checkAsync("a missing directory is tolerated", async () => {
	const result = await enumerateFonts({ directories: [path.join(scratch, "nope")], refresh: true });
	assert.deepEqual(plain(result.families), []);
	assert.equal(result.fileCount, 0);
});

check("fontDirectories covers the platform's install locations", () => {
	assert.deepEqual(plain(fontDirectories("win32", { WINDIR: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "C:\\Users\\x")), [
		"C:\\Windows\\Fonts",
		"C:\\Users\\x\\AppData\\Local\\Microsoft\\Windows\\Fonts",
	]);
	assert.deepEqual(plain(fontDirectories("darwin", {}, "/Users/x")), [
		"/System/Library/Fonts",
		"/Library/Fonts",
		"/Users/x/Library/Fonts",
	]);
	const linux = plain(fontDirectories("linux", {}, "/home/x"));
	assert.ok(linux.includes("/usr/share/fonts"));
	assert.ok(linux.includes("/home/x/.local/share/fonts"));
	// The win32 default must not depend on the running machine's environment.
	assert.ok(plain(fontDirectories("win32", {}, "C:\\Users\\x"))[0].endsWith("Fonts"));
});

fs.rmSync(scratch, { recursive: true, force: true });

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


