# Test fixtures

These stylesheets are **not part of the plugin**. They are exported verbatim from
the local DeepSeek Harness installation (`resources/app.asar`) and kept here as
the truth baseline the integration tests check the plugin against.

| File | Exported from | Why it is needed |
|---|---|---|
| `ui-theme.base.css` | `@deepseek-ai/dsh-client-ui-theme/lib/styles/base.css` | Defines `--dsw-font-family` and `--ds-font-family-code`. |
| `ui-theme.gradient-shadow-text.css` | same package, `gradient-shadow-text.css` | Defines the 14 `--dsw-font-markdown-*` `font` shorthands the content font rewrites, and their `-font-style` / `-font-weight` / `-font-size` / `-line-height` longhands. |
| `ui-theme.design-platform.css` | same package, `design-platform.css` | Colour and elevation tokens, so the generated preview pages look like the real UI. |
| `web-shell.css` | `@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css` | The Vite-built shell bundle: `body { font-family: var(--dsw-font-family, …) }` — the rule that actually applies the interface font — plus the Markdown, code-block and user-text CSS Modules under their shipped `_local_hash_line` names. |

`tools/test.mjs` asserts that every token the plugin rewrites still exists in
these sheets, still carries its four longhands, and is still pinned to
`var(--dsw-font-family)`. When DeepSeek Harness retunes its type scale, re-export
these files and rerun the suite; a failure there means the plugin's assumptions
moved, not that the plugin broke.

Copyright in these files belongs to the DeepSeek Harness project. They are
included solely so the plugin's assumptions can be verified offline.
