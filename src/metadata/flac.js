// File: src/metadata/flac.js
// FLAC tags through `metaflac`, the reference tool from the FLAC project (Alpine: `apk add flac`).
// It changes only the tags it's told to and keeps everything else (other tags, pictures, padding, seek table).
// Replaces metaflac-js2 1.0.8, whose tag reader is commented out: it never loaded a file's existing tags,
// so every save wiped all tags except the ones just set (found 2026-10-31, on a copy of a library file).
// Called with execFile (no shell): values can hold any character except a newline.

const { execFile } = require('child_process');

const METAFLAC = process.env.METAFLAC || 'metaflac';
const NAME = /^[\x20-\x3C\x3E-\x7D]+$/;   // Vorbis comment field names: printable ASCII except '='

function run(args) {
    return new Promise((resolve, reject) => {
        execFile(METAFLAC, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                const why = err.code === 'ENOENT' ? `${METAFLAC} not found (install the flac package)` : (stderr || err.message).trim();
                return reject(new Error(`metaflac: ${why}`));
            }
            resolve(stdout);
        });
    });
}

/** All Vorbis comments as { NAME: [values] } (names upper-cased; a field can repeat). */
async function readTags(file) {
    const out = await run(['--no-utf8-convert', '--export-tags-to=-', file]);
    const tags = {};
    for (const line of out.split('\n')) {
        const i = line.indexOf('=');
        if (i <= 0) continue;
        const k = line.slice(0, i).toUpperCase();
        (tags[k] = tags[k] || []).push(line.slice(i + 1));
    }
    return tags;
}

/**
 * Set or remove tags in one metaflac run (operations apply in order: each named field is removed, then set).
 * @param {string} file
 * @param {Object<string, string|string[]|null|''>} changes  value → set (array → repeated field); null/'' → remove
 */
async function writeTags(file, changes) {
    const args = ['--no-utf8-convert'];   // no --preserve-modtime: a tag edit should change mtime (Lidarr rescans by it)
    for (const [rawName, value] of Object.entries(changes)) {
        const name = rawName.toUpperCase();
        if (!NAME.test(name)) throw new Error(`metaflac: bad field name "${rawName}"`);
        args.push(`--remove-tag=${name}`);
        if (value === null || value === undefined || value === '') continue;
        for (const v of Array.isArray(value) ? value : [value]) {
            const s = String(v);
            if (/[\r\n]/.test(s)) throw new Error(`metaflac: newline in ${name}`);
            args.push(`--set-tag=${name}=${s}`);
        }
    }
    if (args.length === 1) return;
    args.push(file);
    await run(args);
}

module.exports = { readTags, writeTags };
