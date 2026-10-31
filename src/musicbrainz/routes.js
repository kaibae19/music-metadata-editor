// File: src/musicbrainz/routes.js
// MusicBrainz mode API (docs/musicbrainz-mode.md). The editor never talks to Lidarr; these routes only read
// MusicBrainz and write tags. Paths go through the app's guarded resolver (getFullPath).
//   GET  /api/mb/search?artist=&album=&tracks=&query=    candidate releases
//   GET  /api/mb/release/:id                             one release (id or musicbrainz.org URL) + warnings
//   POST /api/mb/match   {files, release}                read the files, propose file → track pairs
//   POST /api/mb/preview {release, mapping, useNames}    per file: field, now, after
//   POST /api/mb/apply   {release, mapping, useNames}    write + read back (restore on mismatch), per file

const path = require('path');
const { parseFile } = require('music-metadata');
const { MusicBrainzClient } = require('./client');
const { mapTracks } = require('./mapping');
const { buildFields, applyToFile, readMusicBrainzTags, SUPPORTED } = require('../metadata/musicbrainz-tags');

const MAX_FILES = 200;
const LIDARR_NOTE = "Lidarr's default \"Standard\" metadata profile only shows some release types and official releases; if the album doesn't appear in Lidarr, allow this type in the artist's metadata profile";

function warningsFor(release, mapping) {
    const w = [];
    if (release.status && release.status.toLowerCase() !== 'official') w.push(`This edition's status is "${release.status}". ${LIDARR_NOTE}.`);
    if ((release.secondaryTypes || []).length) w.push(`This edition is ${release.secondaryTypes.join(' + ')} (${release.type || 'no primary type'}). ${LIDARR_NOTE}.`);
    if (mapping) {
        const missing = release.trackCount - mapping.length;
        if (missing > 0) w.push(`${missing} of the edition's ${release.trackCount} tracks have no file. Lidarr scores missing tracks; another edition may fit better.`);
    }
    return w;
}

function register(app, { getFullPath, musicDir }) {
    const defaultClient = new MusicBrainzClient();
    const mb = () => app.locals.mbClient || defaultClient;   // tests swap in a fake
    const rel = full => path.relative(musicDir, full);

    const fail = (res, e) => {
        const status = e.status && e.status >= 400 && e.status < 600 ? (e.status === 503 ? 503 : e.status === 404 ? 404 : e.status === 400 ? 400 : 502) : 500;
        if (status === 500) console.error('MusicBrainz mode:', e);
        res.status(status).json({ error: e.message });
    };

    function filesFrom(list) {
        if (!Array.isArray(list) || !list.length) throw Object.assign(new Error('No files given'), { status: 400 });
        if (list.length > MAX_FILES) throw Object.assign(new Error(`At most ${MAX_FILES} files at once`), { status: 400 });
        return list.map(p => {
            const full = getFullPath(p);
            if (!SUPPORTED.includes(path.extname(full).toLowerCase())) throw Object.assign(new Error(`${path.basename(full)}: MusicBrainz mode supports ${SUPPORTED.join(' and ')} for now`), { status: 400 });
            return full;
        });
    }

    function mappingFrom(release, mapping) {
        if (!Array.isArray(mapping) || !mapping.length) throw Object.assign(new Error('No mapping given'), { status: 400 });
        const seen = new Set();
        const full = filesFrom(mapping.map(m => m.path));
        return mapping.map((m, i) => {
            const key = `${m.medium}-${m.position}`;
            if (seen.has(key)) throw Object.assign(new Error(`Two files are mapped to disc ${m.medium} track ${m.position}`), { status: 400 });
            seen.add(key);
            try { buildFields(release, Number(m.medium), Number(m.position)); }
            catch (e) { throw Object.assign(new Error(`${path.basename(full[i])}: ${e.message}`), { status: 400 }); }
            return { full: full[i], medium: Number(m.medium), position: Number(m.position) };
        });
    }

    app.get('/api/mb/search', async (req, res) => {
        try {
            const { artist = '', album = '', tracks = '', query = '' } = req.query;
            res.json({ results: await mb().searchReleases({ artist, album, tracks: Number(tracks) || 0, query }) });
        } catch (e) { fail(res, e); }
    });

    app.get('/api/mb/release/:id', async (req, res) => {
        try {
            const release = await mb().getRelease(req.params.id);
            res.json({ release, warnings: warningsFor(release) });
        } catch (e) { fail(res, e); }
    });

    app.post('/api/mb/match', async (req, res) => {
        try {
            const full = filesFrom(req.body.files);
            const release = await mb().getRelease(req.body.release);
            const files = [];
            const current = {};
            for (const f of full) {
                const meta = await parseFile(f, { duration: true, skipCovers: true });
                const c = meta.common;
                files.push({ path: rel(f), name: path.basename(f), title: c.title, track: c.track?.no, disc: c.disk?.no, durationMs: meta.format.duration ? Math.round(meta.format.duration * 1000) : null });
                const id = Array.isArray(c.musicbrainz_albumid) ? c.musicbrainz_albumid[0] : c.musicbrainz_albumid;
                if (id) current[id] = (current[id] || 0) + 1;
            }
            const m = mapTracks(files, release);
            const titleOf = (medium, position) => release.media.find(x => x.position === medium)?.tracks.find(t => t.position === position)?.title;
            const warnings = warningsFor(release, m.pairs);
            const others = Object.entries(current).filter(([id]) => id !== release.id);
            if (others.length) warnings.push(`${others.reduce((n, [, c]) => n + c, 0)} file(s) are currently tagged with another MusicBrainz release (${others.map(([id]) => id).join(', ')}); applying replaces it.`);
            res.json({
                release,
                files,
                pairs: m.pairs.map(p => ({ ...p, trackTitle: titleOf(p.medium, p.position) })),
                unmatchedFiles: m.unmatchedFiles,
                unmatchedTracks: m.unmatchedTracks,
                warnings,
            });
        } catch (e) { fail(res, e); }
    });

    app.post('/api/mb/preview', async (req, res) => {
        try {
            const release = await mb().getRelease(req.body.release);
            const useNames = req.body.useNames !== false;
            const out = [];
            for (const m of mappingFrom(release, req.body.mapping)) {
                const now = await readMusicBrainzTags(m.full);
                const f = buildFields(release, m.medium, m.position, { useNames });
                const after = { ...f.ids, ...(f.names || {}) };
                const changes = [];
                for (const k of ['albumId', 'releaseGroupId', 'artistId', 'albumArtistId', 'recordingId', 'releaseTrackId', 'releaseStatus', 'releaseCountry', ...(f.names ? ['title', 'artist', 'album', 'albumartist', 'track', 'disc'] : [])]) {
                    const to = after[k] ?? null, from = now[k] ?? null;
                    if (String(to ?? '') !== String(from ?? '')) changes.push({ field: k, from, to });
                }
                out.push({ path: rel(m.full), medium: m.medium, position: m.position, changes });
            }
            res.json({ files: out, warnings: warningsFor(release, req.body.mapping) });
        } catch (e) { fail(res, e); }
    });

    app.post('/api/mb/apply', async (req, res) => {
        try {
            const release = await mb().getRelease(req.body.release);
            const useNames = req.body.useNames !== false;
            const results = [];
            for (const m of mappingFrom(release, req.body.mapping)) {   // one at a time: each is backed up, written, read back
                const r = await applyToFile(m.full, buildFields(release, m.medium, m.position, { useNames }));
                results.push({ path: rel(m.full), ok: r.ok, error: r.error, mismatches: r.mismatches });
            }
            res.json({ ok: results.every(r => r.ok), results });
        } catch (e) { fail(res, e); }
    });
}

module.exports = { register, warningsFor };
