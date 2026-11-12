// The MusicBrainz-mode routes end to end on a temp music folder, with a fake MusicBrainz (saved fixtures).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const NodeID3 = require('node-id3');

const fixture = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const REL = '19682ee1-cf2a-4c67-aeef-4fa193cd6984';
const titles = ["Everything's Alright Mama", "Her Father's Pride", 'Smokey Joe of the Poconos', 'The Hunting Ground', 'Pale Blue Dot'];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-music-'));
const dir = path.join(root, 'Carbon Leaf', 'Hunting Ground');
fs.mkdirSync(dir, { recursive: true });
const files = titles.map((t, i) => {
    const name = `${String(i + 1).padStart(2, '0')} - ${t}.mp3`;
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'silence.mp3'), path.join(dir, name));
    NodeID3.update({ title: t, artist: 'Carbon Leaf', album: 'The Hunting Ground', trackNumber: String(i + 1) }, path.join(dir, name));
    return `Carbon Leaf/Hunting Ground/${name}`;
});
fs.writeFileSync(path.join(dir, 'cover.ogg'), 'x');
process.env.MUSIC_DIR = root;
const { app } = require('../src/app');
const { MusicBrainzClient } = require('../src/musicbrainz/client');

const calls = [];
app.locals.mbClient = new MusicBrainzClient({
    minIntervalMs: 0,
    fetch: async url => {
        calls.push(url);
        const body = /\/release\/19682ee1/.test(url) ? fixture('mb-release-19682ee1.json') : /\/release\?/.test(url) ? fixture('mb-search-carbon-leaf.json') : null;
        return body ? { status: 200, ok: true, json: async () => body } : { status: 404, ok: false, json: async () => ({}) };
    },
});

let base, server;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const get = async p => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

test('search: candidates with track counts', async () => {
    const r = await get('/api/mb/search?artist=Carbon%20Leaf&album=The%20Hunting%20Ground&tracks=5');
    assert.equal(r.status, 200);
    assert.equal(r.body.results.length, 2);
    assert.ok(r.body.results.every(x => x.trackCount === 5));
});

test('release by URL; unknown release → 404', async () => {
    const r = await get(`/api/mb/release/${encodeURIComponent(`https://musicbrainz.org/release/${REL}`)}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.release.id, REL);
    assert.deepEqual(r.body.warnings, []);
    assert.equal((await get('/api/mb/release/00000000-0000-0000-0000-000000000000')).status, 404);
});

let mapping;
test('match: 5 files → 5 tracks by number, no warnings', async () => {
    const r = await post('/api/mb/match', { files, release: REL });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pairs.length, 5);
    assert.deepEqual(r.body.unmatchedFiles, []);
    assert.deepEqual(r.body.unmatchedTracks, []);
    assert.equal(r.body.pairs[4].trackTitle, 'Pale Blue Dot');
    assert.deepEqual(r.body.warnings, []);
    mapping = r.body.pairs.map(p => ({ path: p.path, medium: p.medium, position: p.position }));
});

test('preview: album name and IDs change, track titles already match', async () => {
    const r = await post('/api/mb/preview', { release: REL, mapping, useNames: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const f1 = r.body.files[0];
    const field = k => f1.changes.find(c => c.field === k);
    assert.deepEqual(field('album'), { field: 'album', from: 'The Hunting Ground', to: 'Gathering, Vol. 2: The Hunting Ground' });
    assert.equal(field('albumId').to, REL);
    assert.equal(field('albumId').from, null);
    assert.equal(field('title'), undefined);
});

test('apply: every file written and read back; tags are on disk', async () => {
    const r = await post('/api/mb/apply', { release: REL, mapping, useNames: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true, JSON.stringify(r.body.results));
    const t = NodeID3.read(path.join(root, files[2]));
    assert.equal(t.album, 'Gathering, Vol. 2: The Hunting Ground');
    assert.equal(t.userDefinedText.find(x => x.description === 'MusicBrainz Album Id').value, REL);
    const again = await post('/api/mb/preview', { release: REL, mapping, useNames: true });
    assert.ok(again.body.files.every(f => f.changes.length === 0), JSON.stringify(again.body.files.map(f => f.changes)));
});

test('match after apply: no "tagged with another release" warning', async () => {
    const r = await post('/api/mb/match', { files, release: REL });
    assert.deepEqual(r.body.warnings, []);
});

test('refused: two files on one track, a track that does not exist, outside the folder, unsupported format, no files', async () => {
    const dup = mapping.map((m, i) => (i === 1 ? { ...m, position: 1 } : m));
    assert.equal((await post('/api/mb/apply', { release: REL, mapping: dup })).status, 400);
    assert.equal((await post('/api/mb/apply', { release: REL, mapping: [{ ...mapping[0], position: 9 }] })).status, 400);
    assert.equal((await post('/api/mb/match', { files: ['../../etc/passwd.mp3'], release: REL })).status, 400);
    assert.match((await post('/api/mb/match', { files: ['Carbon Leaf/Hunting Ground/cover.ogg'], release: REL })).body.error, /supports \.mp3, \.flac and \.m4a/);
    assert.equal((await post('/api/mb/match', { files: [], release: REL })).status, 400);
});

test('a missing track is a warning, not an error', async () => {
    const r = await post('/api/mb/match', { files: files.slice(0, 4), release: REL });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unmatchedTracks.map(t => t.position), [5]);
    assert.ok(r.body.warnings.some(w => /1 of the edition's 5 tracks have no file/.test(w)));
});

test('MusicBrainz is asked at most once per release (cache)', () => {
    assert.equal(calls.filter(u => /\/release\/19682ee1/.test(u)).length, 1);
});
