// Raw .aac (ADTS, no MP4 container) is refused instead of "succeeding" without touching the file (the old path did
// that for .m4a/.aac, seen 2026-11-11). .m4a is written for real now: test/mp4.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const MetadataWriter = require('../src/metadata/writer');

test('AAC: writeMetadata says unsupported and leaves the file alone', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-m4a-'));
    for (const name of ['b.aac']) {
        const f = path.join(d, name);
        fs.writeFileSync(f, 'not really audio');
        const r = await new MetadataWriter().writeMetadata(f, { title: 'X' });
        assert.equal(r.success, false);
        assert.match(r.error, /Unsupported format: \.aac\. Supported formats: \.mp3, \.flac, \.m4a/);
        assert.equal(fs.readFileSync(f, 'utf8'), 'not really audio');
    }
});
