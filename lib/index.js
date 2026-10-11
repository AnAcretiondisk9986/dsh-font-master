/**
 * dsh-font-master — host half.
 *
 * Two jobs:
 *
 * 1. **First paint.** The browser half can only apply a stylesheet once the
 *    client module graph has loaded, so a page refresh would otherwise paint the
 *    stock fonts for a frame or two. The browser half stores the exact CSS text
 *    it generated under `dsh-font-master:css`; this half injects a five-line
 *    bootstrap into `<head>` that replays it before any application script runs.
 *    Replaying the stored text — instead of rebuilding it here — keeps a second
 *    copy of the stack builder from drifting away from the first.
 *
 * 2. **Font enumeration.** A browser cannot list system fonts without a
 *    permission prompt, so the picker's catalogue is read here from the
 *    platform's font files (see `./fonts.js`) and served over one HTTP route.
 *    The scan is cached on disk and keyed by a fingerprint of the font
 *    directories, so a normal start costs a single directory walk.
 */

import path from "node:path";
import os from "node:os";
import { enumerateFonts } from "./fonts.js";

/** localStorage key the browser half writes its generated CSS to. */
const CSS_STORAGE_KEY = "dsh-font-master:css";

/** Element id of the bootstrap stylesheet, so the browser half can drop it later. */
const BOOT_STYLE_ID = "dsh-font-master-boot";

/**
 * Route prefix owned by this plugin. Kept out of `/plugins`, which the client
 * module system owns, so the two never contend for the same prefix match.
 */
export const FONTS_ROUTE = "/dsh-font-master";

/**
 * Inline bootstrap: replay the browser half's last stylesheet into `<head>`.
 *
 * Written as a flat string list rather than a template literal so the emitted
 * script contains no interpolation syntax, and kept free of the literal
 * `</script>` sequence so it is safe to inline in the index document.
 */
const BOOT_SCRIPT = [
	"(function(){try{",
	"var css=window.localStorage.getItem('" + CSS_STORAGE_KEY + "');",
	"if(!css)return;",
	"var s=document.createElement('style');",
	"s.id='" + BOOT_STYLE_ID + "';",
	"s.setAttribute('data-plugin','dsh-font-master');",
	"s.textContent=css;",
	"(document.head||document.documentElement).appendChild(s);",
	"}catch(e){}})();",
].join("");

/**
 * The harness home directory, where the plugin keeps its font cache.
 * @returns an absolute directory path.
 */
function dshHome() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
	return path.join(os.homedir(), ".dsh");
}

/**
 * Register the index bootstrap and the font-catalogue route.
 *
 * `webServer` is optional by design: a profile without an HTTP carrier (a CLI or
 * headless composition) has no index to inject into and no route to serve, and
 * that must not park the plugin — the row still has to activate so the browser
 * half can be served wherever it is needed.
 *
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
	/** Last scan result, kept warm so a page load never waits for a directory walk. */
	let catalogue = null;
	/** The in-flight scan, so concurrent requests share one pass. */
	let scanning = null;

	const cacheFile = path.join(dshHome(), "dsh-font-master", "fonts.json");

	/**
	 * Enumerate fonts, reusing the previous result unless a rescan is asked for.
	 * @param refresh - ignore the cache and walk the font directories again.
	 * @returns the scan result.
	 */
	const loadCatalogue = (refresh) => {
		if (!refresh && catalogue !== null) return Promise.resolve(catalogue);
		if (scanning !== null) return scanning;
		scanning = enumerateFonts({ refresh, cacheFile })
			.then((result) => {
				catalogue = result;
				return result;
			})
			.catch((error) => {
				ctx.logger?.warn?.("dsh-font-master: font scan failed: %s", error && error.message);
				return { families: [], scannedAt: Date.now(), cached: false, fileCount: 0, failed: true };
			})
			.finally(() => {
				scanning = null;
			});
		return scanning;
	};

	// Warm the catalogue at startup; the picker asks for it milliseconds later.
	ctx.effect(() => {
		loadCatalogue(false);
		return () => {};
	}, "dsh-font-master: warm the font catalogue");

	/**
	 * Serve `GET <FONTS_ROUTE>/fonts` to the browser half.
	 *
	 * The route applies the same trust checks the rest of the web surface uses,
	 * so a composition bound to a non-loopback address does not hand the machine's
	 * font list to the network. Only family names are exposed — never file paths.
	 */
	const registerFontRoute = (scoped) => {
		scoped.effect(() => scoped.webServer.register({
			kind: "prefix",
			path: FONTS_ROUTE,
			handler: async (req, res) => {
				try {
					const connection = typeof scoped.get === "function" ? scoped.get("connection") : undefined;
					const rejection = connection && typeof connection.requestRejection === "function"
						? connection.requestRejection({ headers: req.headers })
						: undefined;
					if (rejection !== undefined) {
						res.writeHead(rejection, { "content-type": "text/plain; charset=utf-8" });
						res.end("refused\n");
						return;
					}
					if (req.method !== "GET" && req.method !== "HEAD") {
						res.writeHead(405);
						res.end();
						return;
					}
					const url = new URL(req.url || "/", "http://localhost");
					if (url.pathname !== FONTS_ROUTE + "/fonts") {
						res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
						res.end("not found\n");
						return;
					}
					const result = await loadCatalogue(url.searchParams.get("refresh") === "1");
					const body = JSON.stringify({
						families: result.families,
						scannedAt: result.scannedAt,
						cached: result.cached === true,
						failed: result.failed === true,
					});
					res.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store",
					});
					res.end(req.method === "HEAD" ? undefined : body);
				} catch (error) {
					ctx.logger?.warn?.("dsh-font-master: font route failed: %s", error && error.message);
					if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
					res.end("error\n");
				}
			},
		}), "dsh-font-master: font catalogue route");
	};

	const onWebServer = (scoped) => {
		scoped.effect(
			() => scoped.on("webserver/index-inject", (table) => {
				table.push({ kind: "script", placement: "head", text: BOOT_SCRIPT });
			}),
			"dsh-font-master: first-paint font bootstrap",
		);
		registerFontRoute(scoped);
	};

	try {
		ctx.inject(["webServer"], onWebServer);
	} catch (error) {
		// A composition without the web-server Service: nothing to inject into.
		ctx.logger?.debug?.("dsh-font-master: no web server, skipping index bootstrap");
	}
}
