/**
 * Load `lib/client.js` the way the DSH client module system does.
 *
 * The browser half is registered through `window.__ModuleLoader__.load({ id,
 * factory })` and returns a lazy-CJS exports object, so it cannot simply be
 * imported. This helper stands up the minimum globals that registration needs,
 * captures the entry, and runs the factory with a stubbed `require`.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/** Repository root. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A React stub sufficient for module initialisation (nothing renders here).
 * @returns a stand-in for the `react` module.
 */
export function reactStub() {
	return {
		createElement: (type, props, ...children) => ({ type, props, children }),
		useState: (initial) => [initial, () => {}],
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
		useEffect: () => {},
		useLayoutEffect: () => {},
		useMemo: (fn) => fn(),
		useCallback: (fn) => fn,
		useRef: (value) => ({ current: value }),
	};
}

/**
 * A DOM stub rich enough to run the browser half's `apply`: enough of an
 * element to hold a `<style>`, and enough of a document to find it again.
 * @returns the fake document plus the list of elements it created.
 */
export function createFakeDom() {
	const created = [];
	const byId = new Map();

	/**
	 * Build one fake element.
	 * @param tagName - the tag to pretend to be.
	 * @returns the element stub.
	 */
	function element(tagName) {
		const node = {
			tagName: String(tagName).toUpperCase(),
			children: [],
			attributes: {},
			dataset: {},
			style: {},
			textContent: "",
			parentNode: null,
			id: "",
			appendChild(child) {
				child.parentNode = node;
				node.children.push(child);
				if (child.id) byId.set(child.id, child);
				return child;
			},
			setAttribute(name, value) {
				node.attributes[name] = String(value);
				if (name === "id") {
					node.id = String(value);
					byId.set(node.id, node);
				}
			},
			remove() {
				node.removed = true;
				if (node.id) byId.delete(node.id);
				if (node.parentNode) {
					const index = node.parentNode.children.indexOf(node);
					if (index >= 0) node.parentNode.children.splice(index, 1);
				}
			},
			/** Canvas probing is a no-op here; `isInstalled` treats null as unknown. */
			getContext: () => null,
			measureText: () => ({ width: 0 }),
		};
		created.push(node);
		return node;
	}

	const head = element("head");
	const documentElement = element("html");
	const document = {
		head,
		documentElement,
		body: element("body"),
		createElement: (tagName) => element(tagName),
		getElementById: (id) => byId.get(id) || null,
		querySelector: () => null,
	};

	return { document, created, byId };
}

/**
 * Evaluate the browser half and return its exports.
 * @param options - optional `localStorage` map shared with the sandbox.
 * @returns the module entry, its exports, the raw source, the storage map and the fake DOM.
 */
export function loadClient(options = {}) {
	const source = fs.readFileSync(path.join(root, "lib", "client.js"), "utf8");
	let registration = null;
	const store = options.localStorage || new Map();
	const dom = createFakeDom();

	const sandbox = {
		console,
		Symbol,
		Object,
		Array,
		Set,
		Map,
		JSON,
		String,
		Number,
		Boolean,
		Math,
		Error,
		document: dom.document,
		window: {
			localStorage: {
				getItem: (key) => (store.has(key) ? store.get(key) : null),
				setItem: (key, value) => { store.set(key, String(value)); },
			},
			__ModuleLoader__: {
				load(entry) { registration = entry; },
			},
		},
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox, { filename: "lib/client.js" });

	if (!registration) throw new Error("lib/client.js did not register a module");
	const react = reactStub();
	const exportsObject = registration.factory((name) => {
		if (name === "react") return react;
		throw new Error(`unexpected require: ${name}`);
	});

	return {
		source,
		registration,
		exports: exportsObject,
		internals: exportsObject.__internals,
		storage: store,
		dom,
	};
}

/**
 * A client context stub that records what the browser half registers.
 * @returns the context plus a record of every registration it received.
 */
export function fakeClientContext() {
	const registered = { slotInjections: [], slotRegistrations: [], locales: [], effects: [] };
	const ctx = {
		effect(callback, label) {
			registered.effects.push(label || "(unlabelled)");
			return callback();
		},
		on: () => () => {},
		inject: (_deps, callback) => callback(ctx),
		locale: {
			register(namespace, dictionaries) {
				registered.locales.push({ namespace, dictionaries });
				return () => {};
			},
		},
		slots: {
			inject(name, callback) {
				registered.slotInjections.push(name);
				return callback();
			},
			register(options, component) {
				registered.slotRegistrations.push({ options, component });
				return () => {};
			},
		},
	};
	return { ctx, registered };
}
