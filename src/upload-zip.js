// File: src/upload-zip.js
// Zip upload (docs/upload-and-import.md, "Zip upload"): POST /api/upload/zip?name=Album.zip, the raw zip as the body
// (application/octet-stream, like single files). The audio inside is unpacked into a new folder in the import folder,
// import/<zip name>/, keeping sub-folders such as "Disc 1". Off unless ENABLE_UPLOAD=true.
//
// A zip from the network is hostile input. What this file guarantees, in order:
//  - the zip is received into a hidden temp file (.upload-…), size-capped (UPLOAD_ZIP_MAX_MB, default 2048);
//  - yauzl (pinned) parses it and refuses entry names that are absolute or contain ".." or "\" ("zip slip");
//    on top of that every path segment is cleaned like an upload name and the result must stay inside the album folder;
//  - only audio extensions are unpacked; links, encrypted entries, macOS "._" / __MACOSX junk and odd compression
//    methods are skipped (never written); everything skipped is reported back;
//  - zip bombs: at most ZIP_MAX_ENTRIES entries, each unpacked file ≤ UPLOAD_MAX_MB, all of them together ≤ the zip
//    limit × 2, and an entry that claims to expand more than MAX_RATIO× is refused (audio barely compresses). Bytes are
//    counted while unpacking (yauzl also checks them against the declared size), so lying headers don't help;
//  - every unpacked file must parse as audio, or it is removed again;
//  - all of it happens in a hidden temp folder; only a complete result is renamed into place, under a name that
//    doesn't exist yet ("Album (2)"): nothing is ever merged into or overwritten, and a failure leaves nothing behind.

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const yauzl = require('yauzl');

const ZIP_MAX_ENTRIES = 2000;
const MAX_RATIO = 20;                 // uncompressed / compressed, for entries over 1 MB
const RATIO_FLOOR = 1024 * 1024;

class ZipRefused extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

/** Stream the request body into `file` (created exclusively), refusing more than `max` bytes. Returns the size. */
function receive(req, file, max) {
    return new Promise((resolve, reject) => {
        let size = 0, done = false;
        const out = fsSync.createWriteStream(file, { flags: 'wx', mode: 0o664 });
        const fail = err => { if (done) return; done = true; req.unpipe(out); out.destroy(); req.resume(); reject(err); };
        req.on('data', chunk => { size += chunk.length; if (size > max) fail(new ZipRefused(`The zip is larger than ${max} bytes`, 413)); });
        req.on('error', fail);
        out.on('error', fail);
        out.on('finish', () => { if (!done) { done = true; resolve(size); } });
        req.pipe(out);
    });
}

/** A zip entry's path → clean relative segments, or null with the reason it's skipped. */
function entryPath(fileName, cleanName) {
    const raw = fileName.split('/').filter(Boolean);
    if (raw.some(s => s === '__MACOSX') || raw[raw.length - 1].startsWith('._')) return { skip: 'macOS metadata' };
    if (raw.length > 6) return { skip: 'too deeply nested' };
    const segs = raw.map(cleanName);
    if (segs.some(s => !s || s === '.' || s === '..')) return { skip: 'unusable name' };
    return { segs };
}

function isLink(entry) { return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000; }

/**
 * Unpack the audio in `zipFile` into a new folder under `importDir.full`.
 * opts: { zipName, cleanName, isAudioFile, isAudio(file) → Promise<container|null>, freeName(dir, name), maxFileBytes, maxTotalBytes }
 * Returns { folder: { name, path }, saved: [{ name, path, size, container }], skipped: [{ name, why }] }.
 */
async function unpack(zipFile, importDir, opts) {
    let zip;
    // autoClose off: the entries are all read first (the checks need the whole list), then unpacked; closed by hand below
    try { zip = await yauzl.openPromise(zipFile, { autoClose: false, strictFileNames: true, validateEntrySizes: true }); }
    catch { throw new ZipRefused('Not a readable zip file', 415); }

    const skipped = [], plan = [];
    let count = 0;
    try {
        for await (const entry of zip.eachEntry()) {
            if (++count > ZIP_MAX_ENTRIES) throw new ZipRefused(`The zip has more than ${ZIP_MAX_ENTRIES} entries`);
            const name = entry.fileName;
            if (name.endsWith('/')) continue;                                       // folder entries: implied by files
            if (isLink(entry)) { skipped.push({ name, why: 'a link (never unpacked)' }); continue; }
            const p = entryPath(name, opts.cleanName);
            if (p.skip) { skipped.push({ name, why: p.skip }); continue; }
            if (!opts.isAudioFile(p.segs[p.segs.length - 1])) { skipped.push({ name, why: 'not an audio file' }); continue; }
            if (entry.isEncrypted()) { skipped.push({ name, why: 'encrypted' }); continue; }
            if (!entry.canDecodeFileData()) { skipped.push({ name, why: 'unsupported compression' }); continue; }
            if (entry.uncompressedSize > RATIO_FLOOR && entry.uncompressedSize > MAX_RATIO * Math.max(entry.compressedSize, 1)) {
                throw new ZipRefused(`Refused: "${name}" would expand ${Math.round(entry.uncompressedSize / Math.max(entry.compressedSize, 1))}× (a zip bomb?)`);
            }
            if (entry.uncompressedSize > opts.maxFileBytes) { skipped.push({ name, why: `larger than ${opts.maxFileBytes} bytes` }); continue; }
            plan.push({ entry, segs: p.segs });
        }
    } catch (e) {
        zip.close();
        if (e instanceof ZipRefused) throw e;
        throw new ZipRefused(`Not a usable zip file (${e.message})`, 415);
    }
    if (!plan.length) { zip.close(); throw Object.assign(new ZipRefused('No audio files in the zip', 422), { skipped }); }
    const declared = plan.reduce((n, p) => n + p.entry.uncompressedSize, 0);
    if (declared > opts.maxTotalBytes) { zip.close(); throw new ZipRefused(`The zip would unpack to more than ${opts.maxTotalBytes} bytes`, 413); }

    // one shared top folder (zip of "Album/…" or "Artist/Album/…"): drop it, the new folder already has the name
    while (plan.every(p => p.segs.length > 1 && p.segs[0] === plan[0].segs[0])) for (const p of plan) p.segs.shift();

    const tmpDir = path.join(importDir.full, `.upload-${crypto.randomBytes(6).toString('hex')}`);
    await fs.mkdir(tmpDir, { mode: 0o775 });
    const saved = [];
    let total = 0;
    try {
        for (const { entry, segs } of plan) {
            const dir = path.join(tmpDir, ...segs.slice(0, -1));
            if (dir !== tmpDir && !dir.startsWith(tmpDir + path.sep)) throw new ZipRefused(`Refused: "${entry.fileName}" points outside the folder`);
            await fs.mkdir(dir, { recursive: true, mode: 0o775 });
            const fileName = await opts.freeName(dir, segs[segs.length - 1]);      // "01.mp3" twice in one folder → "(2)"
            const file = path.join(dir, fileName);
            if (!file.startsWith(tmpDir + path.sep)) throw new ZipRefused(`Refused: "${entry.fileName}" points outside the folder`);
            let size = 0;
            const counter = new Transform({
                transform(chunk, _enc, cb) {
                    size += chunk.length; total += chunk.length;
                    if (size > opts.maxFileBytes) return cb(new ZipRefused(`"${entry.fileName}" is larger than ${opts.maxFileBytes} bytes`, 413));
                    if (total > opts.maxTotalBytes) return cb(new ZipRefused(`The zip unpacks to more than ${opts.maxTotalBytes} bytes`, 413));
                    cb(null, chunk);
                },
            });
            const stream = await zip.openReadStreamPromise(entry);
            try { await pipeline(stream, counter, fsSync.createWriteStream(file, { flags: 'wx', mode: 0o664 })); }
            catch (e) { throw e instanceof ZipRefused ? e : new ZipRefused(`Could not unpack "${entry.fileName}" (${e.message})`); }
            const container = await opts.isAudio(file);
            const rel = [...segs.slice(0, -1), fileName].join('/');
            if (!container) { await fs.rm(file, { force: true }); skipped.push({ name: entry.fileName, why: 'not a readable audio file' }); continue; }
            await fs.chmod(file, 0o664).catch(() => {});
            saved.push({ rel, size, container });
        }
        zip.close();
        if (!saved.length) throw Object.assign(new ZipRefused('No readable audio files in the zip', 422), { skipped });

        // the finished folder appears in one step, under a name nobody has yet
        const base = opts.cleanName(path.basename(opts.zipName, path.extname(opts.zipName))) || 'Upload';
        let folderName = null;
        for (let attempt = 0; attempt < 5 && !folderName; attempt++) {
            const candidate = await opts.freeName(importDir.full, base);
            try { await fs.mkdir(path.join(importDir.full, candidate)); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
            await fs.rename(tmpDir, path.join(importDir.full, candidate));            // onto the empty folder we just made
            folderName = candidate;
        }
        if (!folderName) throw new Error('Could not find a free folder name');
        await fs.chmod(path.join(importDir.full, folderName), 0o775).catch(() => {});
        const folderPath = `${importDir.rel}/${folderName}`;
        return {
            folder: { name: folderName, path: folderPath },
            saved: saved.map(s => ({ name: s.rel.split('/').pop(), path: `${folderPath}/${s.rel}`, size: s.size, container: s.container })),
            skipped,
        };
    } catch (e) {
        try { zip.close(); } catch { /* already closed */ }
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        throw e;
    }
}

/** Register POST /api/upload/zip. ctx: everything the route needs from app.js. */
function register(app, ctx) {
    app.post('/api/upload/zip', async (req, res) => {
        if (!ctx.uploadEnabled) return res.status(403).json({ error: 'Upload is off (set ENABLE_UPLOAD=true)' });
        if (!ctx.importDir) return res.status(403).json({ error: 'No import folder (IMPORT_DIR)' });
        if (!/^application\/octet-stream\b/i.test(String(req.headers['content-type'] || ''))) return res.status(415).json({ error: 'Send the zip as application/octet-stream' });
        const zipName = ctx.cleanName(req.query.name);
        if (!zipName) return res.status(400).json({ error: 'Missing file name' });
        if (path.extname(zipName).toLowerCase() !== '.zip') return res.status(415).json({ error: 'Not a .zip file name' });
        if (Number(req.headers['content-length']) > ctx.zipMaxBytes) return res.status(413).json({ error: `The zip is larger than ${ctx.zipMaxBytes} bytes` });

        let tmpZip;
        try {
            await fs.mkdir(ctx.importDir.full, { recursive: true });
            tmpZip = path.join(ctx.importDir.full, `.upload-${crypto.randomBytes(6).toString('hex')}.zip`);
            const size = await receive(req, tmpZip, ctx.zipMaxBytes);
            if (size === 0) throw new ZipRefused('Empty file');
            const result = await unpack(tmpZip, ctx.importDir, {
                zipName, cleanName: ctx.cleanName, isAudioFile: ctx.isAudioFile, isAudio: ctx.isAudio, freeName: ctx.freeName,
                maxFileBytes: ctx.fileMaxBytes, maxTotalBytes: ctx.zipMaxBytes * 2,
            });
            await fs.rm(tmpZip, { force: true });                   // gone before the answer: nothing left once it arrives
            res.json(result);
        } catch (e) {
            if (tmpZip) await fs.rm(tmpZip, { force: true }).catch(() => {});
            if (e instanceof ZipRefused) return res.status(e.status).json({ error: e.message, ...(e.skipped ? { skipped: e.skipped } : {}) });
            console.error('Zip upload failed:', e);
            res.status(500).json({ error: 'Zip upload failed' });
        }
    });
}

module.exports = { register, unpack, entryPath, ZIP_MAX_ENTRIES, MAX_RATIO };
