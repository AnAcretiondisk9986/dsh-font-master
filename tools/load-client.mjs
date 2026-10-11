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
 * A stateful React stub, so the interactive parts of the settings page can
 * actually be driven from Node: `useState` keeps its value between the manual
 * re-renders the tests perform, and hooks are keyed by component identity the
 * way React keys them by position in the tree.
 *
 * @returns the stub namespace and the re-entrant component renderer that keeps
 *   hook cursors correct while nested components render.
 */
export function createReactStub() {
	/** The component currently rendering. */
	let rendering = null;
	/** Position path of the component currently rendering. */
	let renderingPath = "";
	/** Hook cursor within the current component's render. */
	let cursor = 0;
	/**
	 * Hook storage keyed by position path. Keying by path — not by component
	 * identity — is what keeps two sibling instances of the same component (the
	 * six pickers here) from sharing one state slot, which is how React behaves.
	 */
	const stores = new Map();

	/** The hook array for the component being rendered. */
	const currentStore = () => {
		if (rendering === null) throw new Error("a hook ran outside renderComponent");
		const entry = stores.get(renderingPath);
		if (!entry || entry.component !== rendering) {
			const fresh = { component: rendering, values: [] };
			stores.set(renderingPath, fresh);
			return fresh;
		}
		return entry;
	};

	const react = {
		createElement: (type, props, ...children) => ({ type, props, children }),
		useState(initial) {
			const store = currentStore();
			const index = cursor;
			cursor += 1;
			if (store.values.length <= index) {
				store.values[index] = typeof initial === "function" ? initial() : initial;
			}
			/** Store the next value; the caller re-renders to observe it. */
			const set = (next) => {
				store.values[index] = typeof next === "function" ? next(store.values[index]) : next;
			};
			return [store.values[index], set];
		},
		useRef(initial) {
			const store = currentStore();
			const index = cursor;
			cursor += 1;
			if (store.values.length <= index) store.values[index] = { current: initial };
			return store.values[index];
		},
		useSyncExternalStore(_subscribe, getSnapshot) {
			return getSnapshot();
		},
		useEffect() {},
		useLayoutEffect() {},
		useMemo(fn) {
			return fn();
		},
		useCallback(fn) {
			return fn;
		},
	};

	/**
	 * Render one component with a fresh hook cursor, restoring the parent's.
	 * @param component - the function component.
	 * @param props - its props.
	 * @param path - the component's position in the tree.
	 * @returns whatever the component returned.
	 */
	const renderComponent = (component, props, path = "r") => {
		const savedComponent = rendering;
		const savedPath = renderingPath;
		const savedCursor = cursor;
		rendering = component;
		renderingPath = path;
		cursor = 0;
		try {
			return component(props);
		} finally {
			rendering = savedComponent;
			renderingPath = savedPath;
			cursor = savedCursor;
		}
	};

	return { react, renderComponent };
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
 * @param options - optional `localStorage` map and `fetch` stub shared with the sandbox.
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
		Promise,
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
	// The browser half reaches for `window.fetch`; tests supply their own.
	if (typeof options.fetch === "function") sandbox.window.fetch = options.fetch;
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox, { filename: "lib/client.js" });

	if (!registration) throw new Error("lib/client.js did not register a module");
	const stub = createReactStub();
	const exportsObject = registration.factory((name) => {
		if (name === "react") return stub.react;
		throw new Error(`unexpected require: ${name}`);
	});

	return {
		source,
		registration,
		exports: exportsObject,
		internals: exportsObject.__internals,
		storage: store,
		dom,
		renderComponent: stub.renderComponent,
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
