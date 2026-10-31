// Run: node --test test/   (no network: fetch is faked with the saved fixtures)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MusicBrainzClient, parseReleaseId, luceneEscape, USER_AGENT } = require('../src/musicbrainz/client');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const REL = '19682ee1-cf2a-4c67-aeef-4fa193cd6984';

function fakeFetch(routes, log = []) {
    return async (url, opts) => {
        log.push({ url, ua: opts.headers['User-Agent'], at: Date.now() });
        for (const [re, reply] of routes) if (re.test(url)) {
            const r = typeof reply === 'function' ? reply() : reply;
            return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, json: async () => r.body };
        }
        return { status: 404, ok: false, json: async () => ({}) };
    };
}

test('release: the IDs Lidarr reads, from a real MusicBrainz response', async () => {
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/\/release\/19682ee1/, { body: fixture('mb-release-19682ee1.json') }]]), minIntervalMs: 0 });
    const r = await mb.getRelease(REL);
    assert.equal(r.id, REL);
    assert.equal(r.releaseGroupId, '65ce38f2-19f7-444b-977f-5da5ffc0c33b');
    assert.equal(r.albumArtistId, 'd3fb1614-78fd-4555-9c68-f8b25add2de7');
    assert.equal(r.type, 'EP');
    assert.equal(r.status, 'Official');
    assert.equal(r.trackCount, 5);
    assert.equal(r.discTotal, 1);
    const t1 = r.media[0].tracks[0];
    assert.equal(t1.releaseTrackId, '094b09f9-12bd-4fcb-bf91-24852b2b54cc');
    assert.equal(t1.recordingId, '642c466b-3247-4480-bcec-471461ff3c08');
    assert.equal(t1.title, "Everything's Alright Mama");
    assert.equal(t1.position, 1);
    assert.equal(t1.artistId, 'd3fb1614-78fd-4555-9c68-f8b25add2de7');
});

test('release without its own date falls back to the release group first-release date', async () => {
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/\/release\//, { body: fixture('mb-release-19682ee1.json') }]]), minIntervalMs: 0 });
    assert.equal((await mb.getRelease(REL)).date, '2020');
});

test('search: normalized hits, exact track count first', async () => {
    const body = fixture('mb-search-carbon-leaf.json');
    body.releases[0]['track-count'] = 6;   // make the first hit the wrong size
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/\/release\?/, { body }]]), minIntervalMs: 0 });
    const hits = await mb.searchReleases({ artist: 'Carbon Leaf', album: 'The Hunting Ground', tracks: 5 });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].id, 'f8952de0-91c4-41f9-b796-6f8ae7b1b996');
    assert.deepEqual(hits[0].formats, ['CD']);
    assert.equal(hits[0].type, 'EP');
});

test('search builds a fielded query and escapes it; free text wins', async () => {
    const log = [];
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/./, { body: { releases: [] } }]], log), minIntervalMs: 0 });
    await mb.searchReleases({ artist: 'AC/DC', album: 'Live: 1992' });
    const q = new URL(log[0].url).searchParams.get('query');
    assert.equal(q, 'release:"Live\\: 1992" AND artist:"AC\\/DC"');
    await mb.searchReleases({ artist: 'x', query: 'barcode:123' });
    assert.equal(new URL(log[1].url).searchParams.get('query'), 'barcode:123');
    await assert.rejects(mb.searchReleases({}), /artist, an album or a search text/);
});

test('every request carries the User-Agent and fmt=json', async () => {
    const log = [];
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/./, { body: { releases: [] } }]], log), minIntervalMs: 0 });
    await mb.searchReleases({ album: 'a' });
    assert.equal(log[0].ua, USER_AGENT);
    assert.match(USER_AGENT, /^music-metadata-editor\/\S+ \( https:\/\/github\.com\/kaibae19\/music-metadata-editor \)$/);
    assert.equal(new URL(log[0].url).searchParams.get('fmt'), 'json');
});

test('requests are queued at least minIntervalMs apart, even when fired together', async () => {
    const log = [];
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/./, { body: { releases: [] } }]], log), minIntervalMs: 120 });
    await Promise.all([mb.searchReleases({ album: 'a' }), mb.searchReleases({ album: 'b' }), mb.searchReleases({ album: 'c' })]);
    assert.equal(log.length, 3);
    for (let i = 1; i < 3; i++) assert.ok(log[i].at - log[i - 1].at >= 110, `gap ${log[i].at - log[i - 1].at} ms`);
});

test('cache: the same request is fetched once', async () => {
    const log = [];
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/./, { body: fixture('mb-release-19682ee1.json') }]], log), minIntervalMs: 0 });
    await mb.getRelease(REL); await mb.getRelease(`https://musicbrainz.org/release/${REL}`);
    assert.equal(log.length, 1);
});

test('503 backs off and retries, then succeeds; a persistent 503 says so', async () => {
    let n = 0; const waits = [];
    const flaky = () => (++n < 3 ? { status: 503 } : { body: { releases: [] } });
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/./, flaky]]), minIntervalMs: 10, sleep: async ms => { waits.push(ms); } });
    await mb.searchReleases({ album: 'a' });
    assert.equal(n, 3);
    assert.ok(waits.includes(20) && waits.includes(40), `waits ${waits}`);
    const dead = new MusicBrainzClient({ fetch: fakeFetch([[/./, { status: 503 }]]), minIntervalMs: 0, retries: 1, sleep: async () => {} });
    await assert.rejects(dead.searchReleases({ album: 'a' }), err => err.status === 503 && /rate limiting/.test(err.message));
});

test('a failed request does not jam the queue', async () => {
    let n = 0;
    const mb = new MusicBrainzClient({ fetch: fakeFetch([[/./, () => (++n === 1 ? { status: 500 } : { body: { releases: [] } })]]), minIntervalMs: 0 });
    await assert.rejects(mb.searchReleases({ album: 'a' }), /HTTP 500/);
    assert.deepEqual(await mb.searchReleases({ album: 'b' }), []);
});

test('release ids: bare, URL, junk', () => {
    assert.equal(parseReleaseId(REL), REL);
    assert.equal(parseReleaseId(`https://musicbrainz.org/release/${REL.toUpperCase()}`), REL);
    assert.equal(parseReleaseId('not-an-id'), null);
    assert.equal(luceneEscape('a"b'), 'a\\"b');
});
