// File: src/metadata/mp4.js
// M4A/MP4 (iTunes-style) tags through node-taglib-sharp (a JavaScript port of TagLib#, LGPL-2.1). It edits the
// ilst atoms in place and keeps everything it isn't told to change (artwork, other atoms, the audio).
// Replaces the old path through mp3tag.js, an MP3/ID3 library: it returned success and left M4A files byte for
// byte unchanged (found 2026-11-11 on a copy of a real iTunes-tagged M4A).
// Safety like the FLAC/MusicBrainz writers: back up, write, read back with a different reader (music-metadata),
// and restore the backup on any mismatch.

const fs = require('fs').promises;
const path = require('path');
const { parseFile } = require('music-metadata');

let taglib;   // loaded lazily, so the rest of the editor runs even if the package is missing
function lib() {
    if (!taglib) {
        try { taglib = require('node-taglib-sharp'); }
        catch { throw new Error('node-taglib-sharp is not installed (npm install)'); }
    }
    return taglib;
}

/** "3", "3/12" or 3 → { no, of } (numbers or null). */
function parseTrack(v) {
    const m = String(v).trim().match(/^(\d+)?\s*(?:\/\s*(\d+))?$/);
    if (!m) throw new Error(`Track must be a number or "n/total", got "${v}"`);
    return { no: m[1] ? parseInt(m[1], 10) : null, of: m[2] ? parseInt(m[2], 10) : null };
}

/**
 * Apply plain-editor changes to an M4A. `changes` uses the editor's field names; for each one:
 * undefined/null = keep, '' = remove, anything else = set.
 * Fields: title, artist, album, albumartist, year, track ("n" or "n/total"), genre.
 */
function applyToTag(tag, changes) {
    const str = (k, prop) => { if (changes[k] != null) tag[prop] = changes[k] === '' ? undefined : String(changes[k]); };
    const arr = (k, prop) => { if (changes[k] != null) tag[prop] = changes[k] === '' ? [] : [String(changes[k])]; };
    str('title', 'title');
    str('album', 'album');
    arr('artist', 'performers');
    arr('albumartist', 'albumArtists');
    arr('genre', 'genres');
    if (changes.year != null) {
        if (changes.year === '') tag.year = 0;
        else {
            const y = parseInt(String(changes.year).slice(0, 4), 10);
            if (!(y > 0 && y < 10000)) throw new Error(`Year must be a number, got "${changes.year}"`);
            tag.year = y;
        }
    }
    if (changes.track != null) {
        if (changes.track === '') { tag.track = 0; tag.trackCount = 0; }
        else {
            const t = parseTrack(changes.track);
            tag.track = t.no || 0;
            if (t.of != null) tag.trackCount = t.of;
        }
    }
}

/** What music-metadata reads back, in the same shape, for the fields that were changed. */
async function readBack(file) {
    const { common } = await parseFile(file, { duration: false, skipCovers: true });
    return {
        title: common.title || '', album: common.album || '', artist: common.artist || '',
        albumartist: common.albumartist || '', genre: (common.genre || [])[0] || '',
        year: common.year ? String(common.year) : '', track: common.track && common.track.no ? String(common.track.no) : '',
        trackOf: common.track && common.track.of ? String(common.track.of) : '',
    };
}

function expected(changes) {
    const want = {};
    for (const k of ['title', 'album', 'artist', 'albumartist', 'genre']) if (changes[k] != null) want[k] = String(changes[k]);
    if (changes.year != null) want.year = changes.year === '' ? '' : String(parseInt(String(changes.year).slice(0, 4), 10));
    if (changes.track != null) {
        if (changes.track === '') want.track = '';
        else { const t = parseTrack(changes.track); want.track = t.no ? String(t.no) : ''; if (t.of != null) want.trackOf = String(t.of); }
    }
    return want;
}

/** Write, read back, restore on mismatch. Returns { success, error, mismatches? }. */
async function writeTags(file, changes) {
    const { File } = lib();
    const want = expected(changes);                         // validates year/track before touching the file
    const backup = path.join(path.dirname(file), `.${path.basename(file)}.mme-backup`);
    await fs.copyFile(file, backup);
    try {
        const f = File.createFromPath(file);
        try {
            applyToTag(f.tag, changes);
            f.save();
        } finally { f.dispose(); }
        const got = await readBack(file);
        const mismatches = Object.entries(want).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}: wanted "${v}", read "${got[k]}"`);
        if (mismatches.length) {
            await fs.copyFile(backup, file);
            return { success: false, error: `M4A write didn't read back (file restored): ${mismatches.join('; ')}`, mismatches };
        }
        return { success: true, error: null };
    } catch (error) {
        await fs.copyFile(backup, file).catch(() => {});
        return { success: false, error: `M4A write failed (file restored): ${error.message}` };
    } finally {
        await fs.rm(backup, { force: true });
    }
}

module.exports = { writeTags, parseTrack };
