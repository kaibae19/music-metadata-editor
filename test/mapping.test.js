const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRelease } = require('../src/musicbrainz/client');
const { mapTracks, parseNumbers, normTitle, similarity } = require('../src/musicbrainz/mapping');

const release = normalizeRelease(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mb-release-19682ee1.json'), 'utf8')));
const titles = ["Everything's Alright Mama", "Her Father's Pride", 'Smokey Joe of the Poconos', 'The Hunting Ground', 'Pale Blue Dot'];
const lengths = release.media[0].tracks.map(t => t.lengthMs);
const files = (fn) => titles.map((t, i) => fn({ path: `/music/x/${String(i + 1).padStart(2, '0')} - ${t}.mp3`, name: `${String(i + 1).padStart(2, '0')} - ${t}.mp3`, title: t, track: `${i + 1}/5`, durationMs: lengths[i] + 400 }, i));

test('well-tagged album: all by number, nothing left over', () => {
    const r = mapTracks(files(f => f), release);
    assert.equal(r.pairs.length, 5);
    assert.ok(r.pairs.every(p => p.by === 'number' && p.titleScore === 1));
    assert.deepEqual(r.unmatchedFiles, []);
    assert.deepEqual(r.unmatchedTracks, []);
    assert.equal(r.pairs[2].position, 3);
});

test('no track numbers in tags or names: titles do it', () => {
    const r = mapTracks(files(f => ({ ...f, track: undefined, name: `${f.title}.mp3` })).reverse(), release);
    assert.equal(r.pairs.length, 5);
    assert.ok(r.pairs.every(p => p.by === 'title'));
    assert.ok(r.pairs.every((p, i) => p.position === i + 1 && p.path.includes(titles[i])));
});

test('track numbers from the filename when the tags have none', () => {
    const r = mapTracks(files(f => ({ ...f, track: undefined, title: undefined })), release);
    assert.ok(r.pairs.every(p => p.by === 'number'));
    assert.equal(r.pairs.length, 5);
});

test('wrong numbers (tracks shuffled in the tags): titles win over a clearly wrong number', () => {
    const r = mapTracks(files((f, i) => ({ ...f, track: String(5 - i), name: `x${i}.mp3` })), release);
    for (const p of r.pairs) assert.ok(p.path.includes(titles[p.position - 1]), `${p.path} → ${p.position}`);
});

test('no numbers, unusable titles: duration only when one track fits', () => {
    const fs5 = files((f, i) => ({ ...f, track: undefined, title: `Track ${i + 1}x`, name: `audio${i}.mp3` }));
    const r = mapTracks(fs5, release);
    assert.ok(r.pairs.every(p => p.by === 'duration'), JSON.stringify(r.pairs));
    assert.equal(r.pairs.length, 5);
    for (const p of r.pairs) assert.equal(p.path, fs5[p.position - 1].path);
});

test('extra and missing: leftovers are reported, not forced', () => {
    const four = files(f => f).slice(0, 4).concat([{ path: '/music/x/bonus.mp3', name: 'bonus.mp3', title: 'Hidden Bonus Jam', track: '9' }]);
    const r = mapTracks(four, release);
    assert.equal(r.pairs.length, 4);
    assert.deepEqual(r.unmatchedFiles, ['/music/x/bonus.mp3']);
    assert.deepEqual(r.unmatchedTracks.map(t => t.position), [5]);
});

test('numbers: tags, "n/total", filenames with disc-track', () => {
    assert.deepEqual(parseNumbers({ track: '3/12' }), { track: 3, disc: 1 });
    assert.deepEqual(parseNumbers({ track: 4, disc: '2/2' }), { track: 4, disc: 2 });
    assert.deepEqual(parseNumbers({ name: '07 - Song.mp3' }), { track: 7, disc: 1 });
    assert.deepEqual(parseNumbers({ name: '2-05 Song.flac' }), { track: 5, disc: 2 });
    assert.deepEqual(parseNumbers({ name: 'Song.mp3' }), { track: null, disc: 1 });
});

test('titles: punctuation, case, feat., remaster tags, leading numbers', () => {
    assert.equal(normTitle('03 - Smokey Joe of the Poconos.mp3'), 'smokey joe of the poconos');
    assert.equal(similarity('Everything’s Alright, Mama', "Everything's Alright Mama"), 1);   // curly apostrophe, comma
    assert.equal(similarity('Song (feat. Someone)', 'Song'), 1);
    assert.equal(similarity('Song - 2011 Remaster', 'Song') < 1, true);
    assert.equal(similarity('Song (2011 Remaster)', 'Song'), 1);
    assert.equal(similarity('Rock & Roll', 'Rock and Roll'), 1);
    assert.equal(similarity('', 'x'), 0);
});
