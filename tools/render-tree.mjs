/**
 * Render the React stub's element descriptors.
 *
 * The plugin's settings page is a plain function component tree built with
 * `createElement`, so it can be rendered here in Node without React: expand the
 * descriptors, then either assert against the tree (tests) or serialise it to
 * HTML (the picker screenshot, which therefore shows the real component output
 * rather than a hand-drawn mock-up).
 */

/**
 * Flatten arbitrarily nested child arrays, which is how `map`-produced children
 * arrive from the stub.
 * @param value - any array.
 * @returns a flat array.
 */
export function flatten(value) {
	return Array.isArray(value) ? value.flat(Infinity).filter(Boolean) : [value].filter(Boolean);
}

/**
 * Expand descriptors into a plain tree, invoking function components so nested
 * children — and their hooks — are exercised too.
 * @param node - a descriptor, array, or primitive.
 * @param renderComponent - the stub's re-entrant component renderer.
 * @param path - this node's position path, used to key hook storage.
 * @returns the expanded tree (elements only).
 */
export function renderTree(node, renderComponent, path = "r") {
	if (node === null || node === undefined || typeof node === "boolean") return null;
	if (Array.isArray(node)) return flatten(node.map((child, index) => renderTree(child, renderComponent, `${path}.${index}`)));
	if (typeof node === "string" || typeof node === "number") return node;
	if (typeof node.type === "function") {
		return renderTree(renderComponent(node.type, node.props || {}, path), renderComponent, path);
	}
	return {
		type: node.type,
		props: node.props || {},
		children: flatten((node.children || []).map((child, index) => renderTree(child, renderComponent, `${path}.${index}`))),
	};
}

/**
 * Collect every element of one tag in a rendered tree.
 * @param tree - a rendered tree.
 * @param tag - the tag to collect.
 * @returns the matching nodes.
 */
export function collect(tree, tag) {
	if (tree === null || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap((child) => collect(child, tag));
	const here = tree.type === tag ? [tree] : [];
	return here.concat(flatten((tree.children || []).map((child) => collect(child, tag))));
}

/** Elements that never take a closing tag. */
const VOID_TAGS = new Set(["input", "br", "hr", "img", "meta", "link"]);

/** Props that are emitted as bare attributes when truthy. */
const BOOLEAN_PROPS = new Set(["disabled", "checked", "selected", "readOnly", "spellCheck"]);

/**
 * Escape text for HTML output.
 * @param value - raw text.
 * @returns the escaped text.
 */
function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Serialise a style object to a CSS declaration list.
 * @param style - the style object.
 * @returns the declaration list.
 */
function styleText(style) {
	return Object.entries(style)
		.map(([property, value]) => `${property.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${value}`)
		.join(";");
}

/**
 * Serialise a rendered tree to HTML.
 * @param tree - a rendered tree from `renderTree`.
 * @returns the HTML string.
 */
export function toHtml(tree) {
	if (tree === null || tree === undefined) return "";
	if (Array.isArray(tree)) return tree.map(toHtml).join("");
	if (typeof tree === "string" || typeof tree === "number") return escapeHtml(tree);
	const { type, props, children } = tree;
	const attributes = [];
	for (const [name, value] of Object.entries(props)) {
		if (name === "children" || value === undefined || value === null) continue;
		if (name === "style") {
			attributes.push(`style="${escapeHtml(styleText(value))}"`);
			continue;
		}
		if (BOOLEAN_PROPS.has(name)) {
			if (value) attributes.push(name === "spellCheck" ? `spellcheck="false"` : name);
			continue;
		}
		// React names a few DOM attributes differently from HTML.
		if (name === "className") {
			attributes.push(`class="${escapeHtml(value)}"`);
			continue;
		}
		// Event handlers and React-only props have no HTML meaning here.
		if (name.startsWith("on") || name === "key" || name === "ref") continue;
		attributes.push(`${name}="${escapeHtml(value)}"`);
	}
	const head = `<${type}${attributes.length > 0 ? " " + attributes.join(" ") : ""}>`;
	if (VOID_TAGS.has(type)) return head;
	return `${head}${(children || []).map(toHtml).join("")}</${type}>`;
}
