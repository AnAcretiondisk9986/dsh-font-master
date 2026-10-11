/**
 * Print what the host half would report for this machine.
 *
 * Useful when a family the user expects is missing from the picker: it shows the
 * directories that were scanned, how many files were read, and how each family
 * was classified — plus the raw bytes behind a single file.
 *
 * Run: node tools/font-report.mjs [query]
 */

import { enumerateFonts, fontDirectories, readFontFile } from "../lib/fonts.js";

const query = (process.argv[2] || "").toLowerCase();

const directories = fontDirectories();
console.log("scanned directories:");
for (const dir of directories) console.log("  " + dir);

const started = Date.now();
const result = await enumerateFonts({ refresh: true });
console.log(`\n${result.fileCount} font files -> ${result.families.length} families in ${Date.now() - started} ms`);
console.log(`  CJK        ${result.families.filter((family) => family.cjk).length}`);
console.log(`  monospace  ${result.families.filter((family) => family.mono).length}`);
console.log(`  serif      ${result.families.filter((family) => family.serif === true).length}`);

const shown = query === ""
	? result.families
	: result.families.filter((family) => [family.name, family.zh, ...family.aliases]
		.some((name) => name && name.toLowerCase().includes(query)));

console.log(`\n${shown.length} families${query ? ` matching "${query}"` : ""}:`);
for (const family of shown) {
	const tags = [
		family.cjk ? "cjk" : null,
		family.mono ? "mono" : null,
		family.serif === true ? "serif" : family.serif === false ? "sans" : null,
	].filter(Boolean).join(" ");
	console.log(`  ${(family.zh || family.name).padEnd(22)} ${family.name.padEnd(28)} ${tags.padEnd(16)} ${family.faces.join(", ")}`);
	if (family.aliases.length > 1) console.log(`      aliases: ${family.aliases.join(" · ")}`);
}

if (query !== "") {
	const first = shown[0];
	if (first) {
		console.log(`\nfirst match read back from disk: ${JSON.stringify(first, null, 2).slice(0, 600)}`);
	} else {
		console.log("\nno match; nothing to read back");
	}
} else {
	const sample = directories[0];
	console.log(`\nreadFontFile on a single file (${sample}) is available via readFontFile(); nothing sampled here.`);
	void readFontFile;
}
