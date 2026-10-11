/**
 * Synthetic font files for the host-side parser tests.
 *
 * Building sfnt bytes here keeps the suite hermetic: it asserts what the parser
 * does with a `name` table, an OS/2 classification, a `post` pitch flag and a
 * `ttcf` collection header without depending on whichever fonts happen to be
 * installed on the machine running the tests.
 */

/** sfnt table tags. */
const TAG = {
	name: 0x6e616d65,
	os2: 0x4f532f32,
	post: 0x706f7374,
};

/** Encode a string as UTF-16BE, the Windows-platform name encoding. */
function utf16be(text) {
	const buffer = Buffer.alloc(text.length * 2);
	for (let i = 0; i < text.length; i += 1) buffer.writeUInt16BE(text.charCodeAt(i), i * 2);
	return buffer;
}

/**
 * Build one `name` table.
 * @param entries - `{ id, text, lang }` records; `lang` defaults to en-US.
 * @returns the table bytes.
 */
function nameTable(entries) {
	const strings = [];
	const records = [];
	let stringOffset = 0;
	for (const entry of entries) {
		const encoded = utf16be(entry.text);
		records.push({
			platformID: 3,
			encodingID: 1,
			languageID: entry.lang === undefined ? 0x0409 : entry.lang,
			nameID: entry.id,
			length: encoded.length,
			offset: stringOffset,
		});
		strings.push(encoded);
		stringOffset += encoded.length;
	}

	const header = Buffer.alloc(6 + records.length * 12);
	header.writeUInt16BE(0, 0); // format 0
	header.writeUInt16BE(records.length, 2);
	header.writeUInt16BE(6 + records.length * 12, 4); // string storage offset
	records.forEach((record, index) => {
		const at = 6 + index * 12;
		header.writeUInt16BE(record.platformID, at);
		header.writeUInt16BE(record.encodingID, at + 2);
		header.writeUInt16BE(record.languageID, at + 4);
		header.writeUInt16BE(record.nameID, at + 6);
		header.writeUInt16BE(record.length, at + 8);
		header.writeUInt16BE(record.offset, at + 10);
	});
	return Buffer.concat([header, ...strings]);
}

/**
 * Build one OS/2 table carrying just the fields the classifier reads.
 * @param options - `{ serifStyle, proportion, cjk }`.
 * @returns the table bytes.
 */
function os2Table(options) {
	const table = Buffer.alloc(78);
	table.writeUInt16BE(4, 0); // version
	table.writeUInt8(2, 32); // PANOSE family kind: Latin text
	table.writeUInt8(options.serifStyle === undefined ? 11 : options.serifStyle, 33);
	table.writeUInt8(options.proportion === undefined ? 4 : options.proportion, 35);
	table.writeUInt32BE(options.cjk ? 0x00010000 : 0, 46); // ulUnicodeRange2
	return table;
}

/**
 * Build one `post` table with just the pitch flag.
 * @param fixedPitch - the `isFixedPitch` value to declare.
 * @returns the table bytes.
 */
function postTable(fixedPitch) {
	const table = Buffer.alloc(32);
	table.writeUInt32BE(0x00030000, 0); // version 3.0
	table.writeUInt32BE(fixedPitch, 12);
	return table;
}

/**
 * Build a complete single-face sfnt file.
 *
 * @param options - family names, localisation and classification flags.
 * @param baseOffset - where this font's table directory will sit once written,
 *   so the same builder can be embedded in a collection.
 * @param extraBytes - leading padding reserved before the directory.
 * @returns the font bytes.
 */
export function buildFont(options, baseOffset = 0, extraBytes = 0) {
	const entries = [];
	if (options.legacyFamily) {
		entries.push({ id: 1, text: options.legacyFamily });
		if (options.zh) entries.push({ id: 1, text: options.zh, lang: 0x0804 });
	}
	if (options.family) entries.push({ id: 16, text: options.family });
	if (options.subfamily) entries.push({ id: 2, text: options.subfamily });
	if (options.postScript) entries.push({ id: 6, text: options.postScript });

	const tables = [
		{ tag: TAG.name, data: nameTable(entries) },
		{ tag: TAG.os2, data: os2Table(options) },
		{ tag: TAG.post, data: postTable(options.fixedPitch === true ? 1 : 0) },
	];

	const headerSize = 12 + tables.length * 16;
	let cursor = baseOffset + extraBytes + headerSize;
	const placed = tables.map((table) => {
		const entry = { tag: table.tag, offset: cursor, length: table.data.length, data: table.data };
		// Tables are 4-byte aligned in real fonts; keep that so offsets stay honest.
		cursor += Math.ceil(table.data.length / 4) * 4;
		return entry;
	});

	const total = cursor - baseOffset;
	const buffer = Buffer.alloc(total);
	buffer.writeUInt32BE(0x00010000, extraBytes);
	buffer.writeUInt16BE(placed.length, extraBytes + 4);
	buffer.writeUInt16BE(16, extraBytes + 6);
	buffer.writeUInt16BE(0, extraBytes + 8);
	buffer.writeUInt16BE(placed.length * 16 - 16, extraBytes + 10);

	placed.forEach((entry, index) => {
		const at = extraBytes + 12 + index * 16;
		buffer.writeUInt32BE(entry.tag, at);
		buffer.writeUInt32BE(0, at + 4); // checksum, unread by the parser
		buffer.writeUInt32BE(entry.offset, at + 8);
		buffer.writeUInt32BE(entry.length, at + 12);
		entry.data.copy(buffer, entry.offset - baseOffset);
	});
	return buffer;
}

/**
 * Wrap several faces in a `ttcf` collection.
 * @param faces - `{ options, subfamily }` descriptors.
 * @returns the collection bytes.
 */
export function buildCollection(faces) {
	const headerSize = 12 + faces.length * 4;
	let cursor = headerSize;
	const built = faces.map((face) => {
		const bytes = buildFont(face.options || face, cursor, 0);
		const entry = { offset: cursor, bytes };
		cursor += bytes.length;
		return entry;
	});

	const header = Buffer.alloc(headerSize);
	header.writeUInt32BE(0x74746366, 0); // 'ttcf'
	header.writeUInt32BE(0x00010000, 4);
	header.writeUInt32BE(faces.length, 8);
	built.forEach((entry, index) => header.writeUInt32BE(entry.offset, 12 + index * 4));
	return Buffer.concat([header, ...built.map((entry) => entry.bytes)]);
}
