// File: src/musicbrainz/client.js
// MusicBrainz web service client (ws/2, JSON). Follows MusicBrainz's rules for API users:
// at most one request per second (queued here, for the whole process), a meaningful User-Agent,
// and a backoff when the server says 503 (rate limited). Responses are cached in memory.
// No account or key is needed. Requests only ever go out from the backend.

const { version } = require('../../package.json');

const BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = `music-metadata-editor/${version} ( https://github.com/kaibae19/music-metadata-editor )`;
const RELEASE_INC = 'recordings+artist-credits+release-groups+labels+media';
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class MusicBrainzError extends Error {
    constructor(message, status) { super(message); this.name = 'MusicBrainzError'; this.status = status; }
}

class MusicBrainzClient {
    /**
     * @param {object} [opts]
     * @param {Function} [opts.fetch]      fetch implementation (tests inject a fake)
     * @param {number}   [opts.minIntervalMs=1100]  gap between requests (MusicBrainz allows 1/s)
     * @param {number}   [opts.retries=3]  retries on 503, with a growing wait
     * @param {number}   [opts.cacheSize=200]
     * @param {Function} [opts.sleep]      tests replace the wait
     */
    constructor(opts = {}) {
        this.fetch = opts.fetch || globalThis.fetch;
        this.minIntervalMs = opts.minIntervalMs ?? 1100;
        this.retries = opts.retries ?? 3;
        this.cacheSize = opts.cacheSize ?? 200;
        this.sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
        this.cache = new Map();
        this.queue = Promise.resolve();
        this.last = 0;
    }

    /** Queue one GET so requests never overlap and stay at least minIntervalMs apart. */
    get(path, params = {}) {
        const url = `${BASE}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`;
        if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
        const run = async () => {
            for (let attempt = 0; ; attempt++) {
                const wait = this.last + this.minIntervalMs - Date.now();
                if (wait > 0) await this.sleep(wait);
                this.last = Date.now();
                let res;
                try {
                    res = await this.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
                } catch (e) {
                    throw new MusicBrainzError(`MusicBrainz unreachable: ${e.message}`, 0);
                }
                if (res.status === 503 && attempt < this.retries) { await this.sleep(this.minIntervalMs * 2 ** (attempt + 1)); continue; }
                if (res.status === 503) throw new MusicBrainzError('MusicBrainz is rate limiting us; try again in a minute', 503);
                if (res.status === 404) throw new MusicBrainzError('Not found on MusicBrainz', 404);
                if (!res.ok) throw new MusicBrainzError(`MusicBrainz answered HTTP ${res.status}`, res.status);
                const body = await res.json();
                this.cache.set(url, body);
                if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
                return body;
            }
        };
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => {});
        return p;
    }

    /** Release search. Any of artist/album/tracks may be empty; `query` (free text) overrides them. */
    async searchReleases({ artist = '', album = '', tracks = 0, query = '' } = {}, limit = 15) {
        const q = query.trim() || [
            album && `release:"${luceneEscape(album)}"`,
            artist && `artist:"${luceneEscape(artist)}"`,
        ].filter(Boolean).join(' AND ');
        if (!q) throw new MusicBrainzError('Give an artist, an album or a search text', 400);
        const body = await this.get('/release', { query: q, limit: String(limit) });
        return (body.releases || []).map(normalizeSearchHit).sort(byTrackCount(Number(tracks) || 0));
    }

    /** One release with its media and tracks. Accepts an MBID or a musicbrainz.org release URL. */
    async getRelease(idOrUrl) {
        const id = parseReleaseId(idOrUrl);
        if (!id) throw new MusicBrainzError('Not a MusicBrainz release ID or URL', 400);
        return normalizeRelease(await this.get(`/release/${id}`, { inc: RELEASE_INC }));
    }
}

function luceneEscape(s) { return String(s).replace(/([+\-!(){}\[\]^"~*?:\\\/]|&&|\|\|)/g, '\\$1'); }

function parseReleaseId(s) {
    const m = String(s || '').trim().toLowerCase().match(/(?:release\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    return m && MBID.test(m[1]) ? m[1] : null;
}

function credit(ac) {
    const list = ac || [];
    return {
        name: list.map(c => (c.name || c.artist?.name || '') + (c.joinphrase || '')).join(''),
        ids: list.map(c => c.artist?.id).filter(Boolean),
    };
}

function normalizeSearchHit(r) {
    const rg = r['release-group'] || {};
    return {
        id: r.id,
        score: r.score ?? null,
        title: r.title,
        artist: credit(r['artist-credit']).name,
        date: r.date || null,
        country: r.country || null,
        status: r.status || null,
        type: rg['primary-type'] || null,
        secondaryTypes: rg['secondary-types'] || [],
        trackCount: r['track-count'] ?? (r.media || []).reduce((n, m) => n + (m['track-count'] || 0), 0),
        formats: (r.media || []).map(m => m.format).filter(Boolean),
        label: (r['label-info'] || []).map(l => l.label?.name).filter(Boolean)[0] || null,
        disambiguation: r.disambiguation || '',
    };
}

/** The fields the editor writes, flattened. Track artist ids are the first credited artist (as Picard does). */
function normalizeRelease(r) {
    const rg = r['release-group'] || {};
    const albumArtist = credit(r['artist-credit']);
    const media = (r.media || []).map(m => ({
        position: m.position,
        format: m.format || null,
        tracks: (m.tracks || []).map(t => {
            const ta = credit(t['artist-credit'] || t.recording?.['artist-credit'] || r['artist-credit']);
            return {
                releaseTrackId: t.id,
                recordingId: t.recording?.id || null,
                number: t.number,
                position: t.position,
                title: t.title,
                lengthMs: t.length ?? t.recording?.length ?? null,
                artist: ta.name,
                artistId: ta.ids[0] || null,
            };
        }),
    }));
    return {
        id: r.id,
        title: r.title,
        date: r.date || rg['first-release-date'] || null,
        country: r.country || null,
        status: r.status || null,
        type: rg['primary-type'] || null,
        secondaryTypes: rg['secondary-types'] || [],
        releaseGroupId: rg.id || null,
        albumArtist: albumArtist.name,
        albumArtistId: albumArtist.ids[0] || null,
        label: (r['label-info'] || []).map(l => l.label?.name).filter(Boolean)[0] || null,
        disambiguation: r.disambiguation || '',
        discTotal: media.length,
        trackCount: media.reduce((n, m) => n + m.tracks.length, 0),
        media,
    };
}

/** Exact track-count matches first, then by MusicBrainz's score; stable otherwise. */
function byTrackCount(n) {
    return (a, b) => (n ? (a.trackCount === n ? 0 : 1) - (b.trackCount === n ? 0 : 1) : 0) || (b.score ?? 0) - (a.score ?? 0);
}

module.exports = { MusicBrainzClient, MusicBrainzError, normalizeRelease, normalizeSearchHit, parseReleaseId, luceneEscape, USER_AGENT };
