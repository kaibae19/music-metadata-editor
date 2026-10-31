// File: src/metadata/musicbrainz-tags.js
// Write the MusicBrainz tags Lidarr reads (docs/musicbrainz-mode.md), with Picard's tag names, then read them back.
// MP3: ID3 TXXX frames by description + the UFID frame owned by http://musicbrainz.org (replaced, never appended).
// FLAC: Vorbis comments through metaflac. Other formats: not yet (M4A waits for a read-back test).
// Every write is backed up first and restored if the read-back doesn't match.

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const NodeID3 = require('node-id3');
const mm = require('music-metadata');
const flac = require('./flac');

const MB_OWNER = 'http://musicbrainz.org';
const ID3_TXXX = {
    albumId: 'MusicBrainz Album Id',
    releaseGroupId: 'MusicBrainz Release Group Id',
    artistId: 'MusicBrainz Artist Id',
    albumArtistId: 'MusicBrainz Album Artist Id',
    releaseTrackId: 'MusicBrainz Release Track Id',
    releaseType: 'MusicBrainz Album Type',
    releaseStatus: 'MusicBrainz Album Status',
    releaseCountry: 'MusicBrainz Album Release Country',
};
const FLAC_IDS = {
    albumId: 'MUSICBRAINZ_ALBUMID',
    releaseGroupId: 'MUSICBRAINZ_RELEASEGROUPID',
    artistId: 'MUSICBRAINZ_ARTISTID',
    albumArtistId: 'MUSICBRAINZ_ALBUMARTISTID',
    recordingId: 'MUSICBRAINZ_TRACKID',          // Picard's name for the recording
    releaseTrackId: 'MUSICBRAINZ_RELEASETRACKID',
    releaseType: 'RELEASETYPE',
    releaseStatus: 'RELEASESTATUS',
    releaseCountry: 'RELEASECOUNTRY',
};
const SUPPORTED = ['.mp3', '.flac'];

/**
 * The fields for one track of a normalized release (src/musicbrainz/client.js).
 * @returns {{ids: object, names: object|null}}  names only when useNames (the "Use MusicBrainz names" checkbox)
 */
function buildFields(release, medium, position, { useNames = true } = {}) {
    const m = release.media.find(x => x.position === medium);
    const t = m && m.tracks.find(x => x.position === position);
    if (!t) throw new Error(`release ${release.id} has no track ${medium}-${position}`);
    const types = [release.type, ...(release.secondaryTypes || [])].filter(Boolean).map(s => s.toLowerCase());
    const ids = {
        albumId: release.id,
        releaseGroupId: release.releaseGroupId,
        artistId: t.artistId || release.albumArtistId,
        albumArtistId: release.albumArtistId,
        recordingId: t.recordingId,
        releaseTrackId: t.releaseTrackId,
        releaseType: types,
        releaseStatus: release.status ? release.status.toLowerCase() : null,
        releaseCountry: release.country || null,
    };
    const names = useNames ? {
        title: t.title,
        artist: t.artist || release.albumArtist,
        album: release.title,
        albumartist: release.albumArtist,
        track: position, trackTotal: m.tracks.length,
        disc: medium, discTotal: release.discTotal,
        date: release.date || null,
    } : null;
    return { ids, names };
}

async function writeMP3(file, { ids, names }) {
    const cur = NodeID3.read(file);
    if (cur instanceof Error) throw cur;
    const raw = { ...(cur.raw || {}) };
    const ours = new Set(Object.values(ID3_TXXX).map(d => d.toLowerCase()));
    const txxx = (raw.TXXX ? [].concat(raw.TXXX) : []).filter(x => !ours.has(String(x.description).toLowerCase()));
    for (const [k, desc] of Object.entries(ID3_TXXX)) {
        const v = Array.isArray(ids[k]) ? ids[k].join('/') : ids[k];
        if (v) txxx.push({ description: desc, value: String(v) });
    }
    raw.TXXX = txxx;
    const ufid = (raw.UFID ? [].concat(raw.UFID) : []).filter(u => u.ownerIdentifier !== MB_OWNER);
    if (ids.recordingId) ufid.push({ ownerIdentifier: MB_OWNER, identifier: Buffer.from(ids.recordingId) });
    if (ufid.length) raw.UFID = ufid; else delete raw.UFID;
    if (names) {
        const set = (id, v) => { if (v === null || v === undefined || v === '') delete raw[id]; else raw[id] = String(v); };
        set('TIT2', names.title);
        set('TPE1', names.artist);
        set('TALB', names.album);
        set('TPE2', names.albumartist);
        set('TRCK', `${names.track}/${names.trackTotal}`);
        set('TPOS', `${names.disc}/${names.discTotal}`);
        set('TYER', names.date ? names.date.slice(0, 4) : null);   // ID3v2.3: year only
    }
    const ok = NodeID3.write(raw, file);
    if (ok !== true) throw (ok instanceof Error ? ok : new Error('ID3 write failed'));
}

async function writeFLAC(file, { ids, names }) {
    const changes = {};
    for (const [k, name] of Object.entries(FLAC_IDS)) {
        const v = ids[k];
        changes[name] = Array.isArray(v) ? (v.length ? v : null) : (v || null);
    }
    if (names) {
        Object.assign(changes, {
            TITLE: names.title, ARTIST: names.artist, ALBUM: names.album, ALBUMARTIST: names.albumartist,
            TRACKNUMBER: String(names.track), TRACKTOTAL: String(names.trackTotal),
            DISCNUMBER: String(names.disc), DISCTOTAL: String(names.discTotal),
            DATE: names.date || null,
        });
    }
    await flac.writeTags(file, changes);
}

/** What a file says now, read the way the editor reads (music-metadata), MusicBrainz fields included. */
async function readMusicBrainzTags(file) {
    const c = (await mm.parseFile(file, { duration: false, skipCovers: true })).common;
    const one = v => (Array.isArray(v) ? v[0] : v) ?? null;
    return {
        albumId: one(c.musicbrainz_albumid),
        releaseGroupId: one(c.musicbrainz_releasegroupid),
        artistId: one(c.musicbrainz_artistid),
        albumArtistId: one(c.musicbrainz_albumartistid),
        recordingId: one(c.musicbrainz_recordingid),
        releaseTrackId: one(c.musicbrainz_trackid),     // music-metadata's name for the release track
        releaseStatus: one(c.releasestatus),
        releaseCountry: one(c.releasecountry),
        title: c.title ?? null, artist: c.artist ?? null, album: c.album ?? null, albumartist: c.albumartist ?? null,
        track: c.track?.no ?? null, disc: c.disk?.no ?? null,
    };
}

/** Fields that must read back equal (IDs always; titles and numbers when names were written). */
function mismatches(fields, got) {
    const bad = [];
    for (const k of ['albumId', 'releaseGroupId', 'artistId', 'albumArtistId', 'recordingId', 'releaseTrackId']) {
        if ((fields.ids[k] || null) !== (got[k] || null)) bad.push(`${k}: wanted ${fields.ids[k]}, file says ${got[k]}`);
    }
    if (fields.names) {
        for (const k of ['title', 'album', 'albumartist']) if ((fields.names[k] || null) !== (got[k] || null)) bad.push(`${k}: wanted ${fields.names[k]}, file says ${got[k]}`);
        if (got.track !== fields.names.track) bad.push(`track: wanted ${fields.names.track}, file says ${got.track}`);
    }
    return bad;
}

/**
 * Back up, write, read back, restore on mismatch.
 * @returns {Promise<{file, ok: boolean, error?: string, mismatches?: string[], tags?: object}>}
 */
async function applyToFile(file, fields, { write } = {}) {
    const ext = path.extname(file).toLowerCase();
    if (!SUPPORTED.includes(ext)) return { file, ok: false, error: `${ext || 'this format'} isn't supported in MusicBrainz mode yet (MP3 and FLAC are)` };
    const backup = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mme-backup-')), path.basename(file));
    await fs.copyFile(file, backup);
    try {
        await (write || (ext === '.mp3' ? writeMP3 : writeFLAC))(file, fields);
        const tags = await readMusicBrainzTags(file);
        const bad = mismatches(fields, tags);
        if (bad.length) { await fs.copyFile(backup, file); return { file, ok: false, error: 'read-back did not match; file restored', mismatches: bad }; }
        return { file, ok: true, tags };
    } catch (e) {
        await fs.copyFile(backup, file).catch(() => {});
        return { file, ok: false, error: `${e.message}; file restored` };
    } finally {
        await fs.rm(path.dirname(backup), { recursive: true, force: true });
    }
}

module.exports = { buildFields, applyToFile, readMusicBrainzTags, writeMP3, writeFLAC, mismatches, SUPPORTED, ID3_TXXX, FLAC_IDS };
