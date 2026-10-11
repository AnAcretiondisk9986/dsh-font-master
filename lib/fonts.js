/**
 * Installed-font enumeration for the host half.
 *
 * A browser cannot list system fonts without a permission prompt
 * (`queryLocalFonts()`), and that API is unavailable in some Electron builds, so
 * the list is built here instead: walk the platform's font directories, read the
 * `name` table of every sfnt file, and report the families.
 *
 * The parser is deliberately narrow — it reads only what a family picker needs:
 *
 *   name    family / typographic family, plus every localisation as a search alias
 *   OS/2    `ulUnicodeRange2` for CJK coverage, PANOSE for serif-vs-sans
 *   post    `isFixedPitch` for monospacing
 *
 * Files are read with positioned reads rather than slurped whole: a Windows font
 * directory routinely holds 20 MB CJK collections, and only a few hundred bytes
 * of each are interesting.
 *
 * Zero dependencies on purpose — the plugin ships no runtime dependencies at all.
 */

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Positioned-read helper: read `length` bytes at `position`. */
async function readAt(handle, position, length) {
	const size = Math.max(0, Math.trunc(length));
	if (size === 0) return Buffer.alloc(0);
	const buffer = Buffer.alloc(size);
	let filled = 0;
	while (filled < size) {
		// A short read is legal for files; loop until the range is covered or EOF.
		// eslint-disable-next-line no-await-in-loop
		const { bytesRead } = await handle.read(buffer, filled, size - filled, position + filled);
		if (bytesRead <= 0) break;
		filled += bytesRead;
	}
	return filled === size ? buffer : buffer.subarray(0, filled);
}

/** sfnt table tags this module cares about. */
const TAGS = {
	NAME: 0x6e616d65,
	OS2: 0x4f532f32,
	POST: 0x706f7374,
};

/** `ttcf` — a TrueType/OpenType collection header. */
const TTCF = 0x74746366;

/** Windows platform id with a Unicode (UCS-2) encoding. */
const PLATFORM_WINDOWS = 3;
/** Unicode platform id. */
const PLATFORM_UNICODE = 0;
/** en-US and zh-CN language ids on the Windows platform. */
const LANG_EN_US = 0x0409;
const LANG_ZH_CN = 0x0804;

/** Upper bound on a `name` table read; real tables are far below this. */
const MAX_NAME_TABLE = 512 * 1024;
/** Upper bound on faces read out of one collection. */
const MAX_COLLECTION_FACES = 64;
/** Upper bound on the search aliases kept per family. */
const MAX_ALIASES = 12;

/**
 * Decode one `name` record.
 *
 * Windows and Unicode platform records are UTF-16BE; Macintosh records use the
 * font's own legacy encoding, which `latin1` approximates well enough for a
 * searchable label.
 *
 * @param table - the whole `name` table.
 * @param record - the record to decode.
 * @returns the decoded string, or `""` when the range is out of bounds.
 */
function decodeName(table, record) {
	const start = record.stringOffset + record.offset;
	const end = Math.min(table.length, start + record.length);
	if (start >= table.length || end <= start) return "";
	const slice = table.subarray(start, end);
	if (record.platformID === PLATFORM_WINDOWS || record.platformID === PLATFORM_UNICODE) {
		let out = "";
		for (let i = 0; i + 1 < slice.length; i += 2) out += String.fromCharCode(slice.readUInt16BE(i));
		return out;
	}
	return slice.toString("latin1");
}

/**
 * Rank a `name` record so the most useful localisation wins.
 * @param record - the record to rank.
 * @returns a lower-is-better score.
 */
function languageRank(record) {
	if (record.platformID === PLATFORM_WINDOWS) {
		if (record.languageID === LANG_EN_US) return 0;
		if (record.languageID === LANG_ZH_CN) return 1;
		return 2;
	}
	if (record.platformID === PLATFORM_UNICODE) return 3;
	if (record.platformID === 1) return 4;
	return 5;
}

/**
 * Collect every localisation of the requested name ids.
 * @param table - the whole `name` table.
 * @param wanted - the name ids to collect.
 * @returns a map of name id to a `{ preferred, aliases }` pair.
 */
function readNames(table, wanted) {
	const count = table.readUInt16BE(2);
	const stringOffset = table.readUInt16BE(4);
	const records = [];
	for (let i = 0; i < count; i += 1) {
		const at = 6 + i * 12;
		if (at + 12 > table.length) break;
		const nameID = table.readUInt16BE(at + 6);
		if (!wanted.includes(nameID)) continue;
		records.push({
			platformID: table.readUInt16BE(at),
			encodingID: table.readUInt16BE(at + 2),
			languageID: table.readUInt16BE(at + 4),
			nameID,
			length: table.readUInt16BE(at + 8),
			offset: table.readUInt16BE(at + 10),
			stringOffset,
		});
	}
	records.sort((a, b) => languageRank(a) - languageRank(b));

	const byId = new Map();
	for (const record of records) {
		const value = decodeName(table, record).trim();
		if (value === "") continue;
		let entry = byId.get(record.nameID);
		if (!entry) {
			entry = { preferred: value, aliases: [], zh: null };
			byId.set(record.nameID, entry);
		}
		if (!entry.aliases.includes(value)) entry.aliases.push(value);
		if (entry.zh === null && record.platformID === PLATFORM_WINDOWS && record.languageID === LANG_ZH_CN) {
			entry.zh = value;
		}
	}
	return byId;
}

/**
 * Classify one face from its OS/2 and post tables.
 *
 * Monospacing is taken from `post.isFixedPitch`, not from PANOSE. CJK fonts
 * frequently declare PANOSE proportion 9 (monospaced) simply because Han
 * ideographs are full-width — SimHei, KaiTi and FangSong all do — which would
 * flood a code-font picker with proportional text faces. `isFixedPitch` is the
 * font's own statement about its Latin metrics, so it is the reliable signal;
 * PANOSE proportion is only consulted when a face ships no `post` table.
 *
 * @param os2 - the OS/2 table, or null.
 * @param post - the post table, or null.
 * @returns `{ cjk, mono, serif }`.
 */
function classify(os2, post) {
	let cjk = false;
	let serif = null;
	let panoseMono = false;

	if (os2 && os2.length >= 58) {
		// ulUnicodeRange2 bit 16 == overall bit 48 == CJK Unified Ideographs.
		const range2 = os2.readUInt32BE(46);
		cjk = (range2 & 0x00010000) !== 0;
		// PANOSE: byte 0 is the family kind (2 = Latin text), byte 1 the serif
		// style (2..10 serif-ish, 11..13 sans), byte 3 the proportion (9 = mono).
		const kind = os2.readUInt8(32);
		if (kind === 2) {
			const serifStyle = os2.readUInt8(33);
			const proportion = os2.readUInt8(35);
			if (serifStyle >= 11 && serifStyle <= 13) serif = false;
			else if (serifStyle >= 2 && serifStyle <= 10) serif = true;
			panoseMono = proportion === 9;
		}
	}

	const hasPost = post && post.length >= 16;
	const mono = hasPost ? post.readUInt32BE(12) !== 0 : panoseMono;
	return { cjk, mono, serif };
}

/**
 * Parse one face out of a collection or a single-font file.
 * @param handle - an open file handle.
 * @param offset - the face's table-directory offset.
 * @returns the face descriptor, or null when it carries no usable name.
 */
async function readFace(handle, offset) {
	const header = await readAt(handle, offset, 12);
	if (header.length < 12) return null;
	const numTables = header.readUInt16BE(4);
	if (numTables === 0 || numTables > 512) return null;

	const directory = await readAt(handle, offset + 12, numTables * 16);
	if (directory.length < numTables * 16) return null;

	const tables = new Map();
	for (let i = 0; i < numTables; i += 1) {
		const at = i * 16;
		const tag = directory.readUInt32BE(at);
		if (tag !== TAGS.NAME && tag !== TAGS.OS2 && tag !== TAGS.POST) continue;
		tables.set(tag, {
			offset: directory.readUInt32BE(at + 8),
			length: directory.readUInt32BE(at + 12),
		});
	}

	const nameTable = tables.get(TAGS.NAME);
	if (!nameTable) return null;
	const name = await readAt(handle, nameTable.offset, Math.min(nameTable.length, MAX_NAME_TABLE));
	if (name.length < 6) return null;

	const names = readNames(name, [1, 16, 2, 4, 6]);
	// Typographic family (16) wins over the legacy family (1) when present.
	const family = names.get(16) || names.get(1);
	if (!family) return null;

	const os2Entry = tables.get(TAGS.OS2);
	const postEntry = tables.get(TAGS.POST);
	const os2 = os2Entry ? await readAt(handle, os2Entry.offset, Math.min(os2Entry.length, 128)) : null;
	const post = postEntry ? await readAt(handle, postEntry.offset, Math.min(postEntry.length, 32)) : null;

	// Search aliases: every localisation of the family name, plus the PostScript
	// name. Full names (id 4) are deliberately excluded — they carry the style,
	// so they would add "… Bold", "… Light" and dozens of translations of each
	// without making anything findable that the family name does not already.
	const aliases = [];
	const push = (value) => {
		if (value && !aliases.includes(value) && aliases.length < MAX_ALIASES) aliases.push(value);
	};
	for (const id of [16, 1, 6]) {
		const entry = names.get(id);
		if (!entry) continue;
		for (const alias of entry.aliases) push(alias);
	}
	if (aliases.length === 0) push(family.preferred);

	return {
		name: family.preferred,
		zh: family.zh,
		aliases,
		subfamily: names.get(2) ? names.get(2).preferred : "",
		...classify(os2, post),
	};
}

/**
 * Read every face declared by one font file.
 * @param filePath - absolute path to a `.ttf`, `.otf`, `.ttc` or `.otc` file.
 * @returns the faces found, or `[]` when the file is not a readable sfnt.
 */
export async function readFontFile(filePath) {
	let handle;
	try {
		handle = await fsp.open(filePath, "r");
	} catch (error) {
		return [];
	}
	try {
		const header = await readAt(handle, 0, 12);
		if (header.length < 12) return [];

		let offsets;
		if (header.readUInt32BE(0) === TTCF) {
			const declared = header.readUInt32BE(8);
			const count = Math.min(declared, MAX_COLLECTION_FACES);
			const table = await readAt(handle, 12, count * 4);
			offsets = [];
			for (let i = 0; i < count && (i + 1) * 4 <= table.length; i += 1) {
				offsets.push(table.readUInt32BE(i * 4));
			}
		} else {
			offsets = [0];
		}

		const faces = [];
		for (const offset of offsets) {
			// Sequential by necessity: one handle, and collections are small.
			// eslint-disable-next-line no-await-in-loop
			const face = await readFace(handle, offset);
			if (face) faces.push(face);
		}
		return faces;
	} catch (error) {
		return [];
	} finally {
		await handle.close().catch(() => {});
	}
}

/** Extensions that hold sfnt outlines. `.fon` is the legacy bitmap format and is skipped. */
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".otc"]);

/**
 * The platform's font directories.
 *
 * Paths are composed with the *target* platform's separator, not the running
 * one's, so the returned list is meaningful when the function is asked about a
 * platform other than the host — which is what makes it testable.
 *
 * @param platform - `process.platform`.
 * @param env - `process.env`.
 * @param home - the user's home directory.
 * @returns absolute directory paths, most authoritative first.
 */
export function fontDirectories(platform = process.platform, env = process.env, home = os.homedir()) {
	if (platform === "win32") {
		const windir = env.WINDIR || "C:\\Windows";
		const dirs = [path.win32.join(windir, "Fonts")];
		// Per-user installs landed here from Windows 10 1809 onwards.
		if (env.LOCALAPPDATA) dirs.push(path.win32.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
		return dirs;
	}
	if (platform === "darwin") {
		return [
			"/System/Library/Fonts",
			"/Library/Fonts",
			path.posix.join(home, "Library", "Fonts"),
		];
	}
	return [
		"/usr/share/fonts",
		"/usr/local/share/fonts",
		path.posix.join(home, ".local", "share", "fonts"),
		path.posix.join(home, ".fonts"),
	];
}

/**
 * List font files under the given directories, following nested directories.
 * @param dirs - directories to walk.
 * @param limit - safety bound on the number of files considered.
 * @returns `{ path, size, mtimeMs }` records.
 */
async function listFontFiles(dirs, limit = 5000) {
	const found = [];
	const walk = async (dir, depth) => {
		if (found.length >= limit || depth > 6) return;
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch (error) {
			return;
		}
		for (const entry of entries) {
			if (found.length >= limit) return;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				// Sequential by necessity: bounded fan-out keeps the walk cheap.
				// eslint-disable-next-line no-await-in-loop
				await walk(full, depth + 1);
				continue;
			}
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			if (!FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
			try {
				// eslint-disable-next-line no-await-in-loop
				const stat = await fsp.stat(full);
				found.push({ path: full, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
			} catch (error) {
				// Unreadable entry: skip it rather than failing the whole scan.
			}
		}
	};

	for (const dir of dirs) {
		// Sequential by necessity: one shared result list.
		// eslint-disable-next-line no-await-in-loop
		await walk(dir, 0);
	}
	return found;
}

/**
 * A stable fingerprint of the font directory contents, so a cached list can be
 * reused until a font is actually added or removed.
 * @param files - records from `listFontFiles`.
 * @returns a short hex digest.
 */
function fingerprint(files) {
	// FNV-1a over the sorted file identity; avoids a crypto import for a cache key.
	let hash = 0x811c9dc5;
	const feed = (text) => {
		for (let i = 0; i < text.length; i += 1) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
	};
	for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
		feed(`${file.path}|${file.size}|${file.mtimeMs};`);
	}
	return `${(hash >>> 0).toString(16)}-${files.length}`;
}

/**
 * Rank a face's style so the plain one is listed first. Files are read with
 * bounded concurrency, so the order faces arrive in is not stable; ranking here
 * is what makes the reported list deterministic.
 * @param subfamily - the face's style name.
 * @returns a lower-is-better rank.
 */
function faceRank(subfamily) {
	const key = String(subfamily).trim().toLowerCase();
	if (key === "") return 90;
	if (key === "regular" || key === "book") return 0;
	if (key === "normal" || key === "roman") return 1;
	if (key.startsWith("medium")) return 3;
	if (key.includes("bold")) return 10;
	if (key.includes("italic") || key.includes("oblique")) return 20;
	if (key.includes("light") || key.includes("thin")) return 30;
	return 5;
}

/**
 * Collapse faces into families, merging every style of one family into a single
 * entry that is as capable as its most capable face.
 * @param faces - face descriptors read from the font files.
 * @returns the sorted family list.
 */
function groupFamilies(faces) {
	const byFamily = new Map();
	for (const face of faces) {
		const key = face.name.toLowerCase();
		let family = byFamily.get(key);
		if (!family) {
			family = {
				name: face.name,
				zh: face.zh,
				aliases: [],
				cjk: false,
				mono: false,
				serif: null,
				faces: [],
			};
			byFamily.set(key, family);
		}
		if (!family.zh && face.zh) family.zh = face.zh;
		for (const alias of face.aliases) if (!family.aliases.includes(alias)) family.aliases.push(alias);
		// A family counts as CJK / monospaced when any of its faces is, and keeps
		// a serif verdict only when the faces agree.
		family.cjk = family.cjk || face.cjk;
		family.mono = family.mono || face.mono;
		if (family.serif === null) family.serif = face.serif;
		else if (family.serif !== face.serif) family.serif = null;
		if (face.subfamily && !family.faces.includes(face.subfamily)) family.faces.push(face.subfamily);
	}
	const families = [...byFamily.values()];
	for (const family of families) {
		family.faces.sort((a, b) => faceRank(a) - faceRank(b) || a.localeCompare(b, "en"));
	}
	return families.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * Enumerate the installed families.
 *
 * The result is cached next to the plugin's other state and reused while the
 * font directories are unchanged, so a normal start costs one directory walk.
 *
 * @param options - `refresh` forces a rescan; `cacheFile` overrides the cache path.
 * @returns `{ families, scannedAt, cached, fileCount }`.
 */
export async function enumerateFonts(options = {}) {
	const dirs = options.directories || fontDirectories();
	const files = await listFontFiles(dirs);
	const stamp = fingerprint(files);
	const cacheFile = options.cacheFile;
	const now = Date.now();

	if (!options.refresh && cacheFile) {
		try {
			const cached = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
			if (cached && cached.stamp === stamp && Array.isArray(cached.families)) {
				return {
					families: cached.families,
					scannedAt: cached.scannedAt || now,
					cached: true,
					fileCount: files.length,
				};
			}
		} catch (error) {
			// No usable cache: fall through to a full scan.
		}
	}

	const faces = [];
	const concurrency = 8;
	let cursor = 0;
	const worker = async () => {
		while (cursor < files.length) {
			const index = cursor;
			cursor += 1;
			const facesOfFile = await readFontFile(files[index].path);
			for (const face of facesOfFile) faces.push(face);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

	const families = groupFamilies(faces);
	const result = { families, scannedAt: now, cached: false, fileCount: files.length };

	if (cacheFile) {
		try {
			await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
			await fsp.writeFile(cacheFile, JSON.stringify({ stamp, scannedAt: now, families }), "utf8");
		} catch (error) {
			// A read-only home directory only costs us the cache.
		}
	}
	return result;
}
