/**
 * dsh-font-master — host half.
 *
 * The whole feature lives in the browser half (`lib/client.js`), which owns the
 * font choices, the generated stylesheet and its persistence. This half exists
 * for one reason only: first paint.
 *
 * The browser half can only apply a stylesheet once the client module graph has
 * loaded, so a page refresh would otherwise paint the stock fonts for a frame or
 * two before switching. The browser half therefore stores the exact CSS text it
 * generated under `dsh-font-master:css`, and this half injects a five-line
 * bootstrap into `<head>` on every index render that replays that stored text
 * before any application script runs.
 *
 * Replaying the stored text — instead of rebuilding it here — is deliberate: the
 * host would have to duplicate the stack builder and the token table, and the
 * two copies would drift. On a first ever run there is nothing stored yet, so the
 * bootstrap does nothing and the browser half applies the stylesheet as usual.
 */

/** localStorage key the browser half writes its generated CSS to. */
const CSS_STORAGE_KEY = "dsh-font-master:css";

/** Element id of the bootstrap stylesheet, so the browser half can drop it later. */
const BOOT_STYLE_ID = "dsh-font-master-boot";

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
 * Register the index bootstrap on compositions that actually serve a web UI.
 *
 * `webServer` is optional by design: a profile without an HTTP carrier (a CLI or
 * headless composition) has no index to inject into, and that must not park the
 * plugin — the row still has to activate so the browser half can be served
 * wherever it is needed.
 *
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  const onWebServer = (scoped) => {
    scoped.effect(
      () => scoped.on("webserver/index-inject", (table) => {
        table.push({ kind: "script", placement: "head", text: BOOT_SCRIPT });
      }),
      "dsh-font-master: first-paint font bootstrap",
    );
  };

  try {
    ctx.inject(["webServer"], onWebServer);
  } catch (error) {
    // A composition without the web-server Service: nothing to inject into.
    ctx.logger?.debug?.("dsh-font-master: no web server, skipping index bootstrap");
  }
}
