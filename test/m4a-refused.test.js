// Until a real MP4 writer exists, saving an M4A/AAC is refused instead of "succeeding" without touching the file
// (seen 2026-11-11: success: true, file byte for byte unchanged).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const MetadataWriter = require('../src/metadata/writer');

test('M4A/AAC: writeMetadata says unsupported and leaves the file alone', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-m4a-'));
    for (const name of ['a.m4a', 'b.aac']) {
        const f = path.join(d, name);
        fs.writeFileSync(f, 'not really audio');
        const r = await new MetadataWriter().writeMetadata(f, { title: 'X' });
        assert.equal(r.success, false);
        assert.match(r.error, /Unsupported format: \.(m4a|aac)\. Supported formats: \.mp3, \.flac/);
        assert.equal(fs.readFileSync(f, 'utf8'), 'not really audio');
    }
});
