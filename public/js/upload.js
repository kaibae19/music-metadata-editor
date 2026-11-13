// File: public/js/upload.js
// Upload (docs/upload-and-import.md, step 3): an "⬆️ Upload" button and a drop area over the file list. Files (or whole
// folders) go one per request to POST /api/upload, which saves them into the import folder; a .zip goes to
// POST /api/upload/zip, which unpacks its audio into a new folder there. Then the new files open selected, ready for
// 🎼 MusicBrainz. Shown only when the server says upload is on.
// Everything shown is built with textContent (file names never reach innerHTML).

(() => {
    const el = (tag, attrs = {}, ...kids) => {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k === 'text') e.textContent = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
        return e;
    };
    const ext = name => (name.match(/\.[^./]+$/) || [''])[0].toLowerCase();
    const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    // Every File in a drop, folders walked (Chrome, Firefox, Safari: webkitGetAsEntry). A plain file list otherwise.
    async function filesFromDrop(dataTransfer) {
        const entries = [...(dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
        if (!entries.length) return [...(dataTransfer.files || [])];
        const out = [];
        const fileOf = entry => new Promise((res, rej) => entry.file(res, rej));
        const readAll = reader => new Promise((res, rej) => {
            const all = [];
            const next = () => reader.readEntries(batch => (batch.length ? (all.push(...batch), next()) : res(all)), rej);
            next();
        });
        const walk = async (entry, depth) => {
            if (entry.isFile) out.push(await fileOf(entry));
            else if (entry.isDirectory && depth < 4) for (const kid of await readAll(entry.createReader())) await walk(kid, depth + 1);
        };
        for (const entry of entries) await walk(entry, 0);
        return out;
    }

    class UploadPanel {
        constructor(editor, info) {
            this.editor = editor;
            this.info = info;                       // GET /api/upload: { enabled, maxBytes, extensions, importPath }
            this.busy = false;

            this.input = el('input', { type: 'file', multiple: true, accept: [...info.extensions, ...(info.zipMaxBytes ? ['.zip'] : [])].join(','), hidden: true,
                onchange: () => { const files = [...this.input.files]; this.input.value = ''; this.upload(files); } });
            this.button = el('button', { class: 'select-all-btn', id: 'uploadBtn', type: 'button',
                title: `Upload audio files${info.zipMaxBytes ? ' or album zips' : ''} into the import folder (${info.importPath}); or drop files or folders on the file list`,
                onclick: () => this.input.click() }, el('span', { text: '⬆️' }), el('span', { text: 'Upload' }));
            const importBtn = document.getElementById('importBtn');
            if (importBtn) importBtn.after(this.button); else document.querySelector('.selection-controls').append(this.button);
            document.body.append(this.input);

            this.panel = el('div', { class: 'upload-panel', hidden: true, role: 'status', 'aria-live': 'polite' });
            this.dropHint = el('div', { class: 'drop-hint', text: `Drop to upload into ${info.importPath}/` });
            const browser = document.querySelector('.browser-panel');
            browser.querySelector('.panel-header').after(this.panel);
            browser.append(this.dropHint);
            this.setupDrop(browser);
        }

        setupDrop(zone) {
            let depth = 0;
            const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
            zone.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; zone.classList.add('drop-active'); });
            zone.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
            zone.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; zone.classList.remove('drop-active'); } });
            zone.addEventListener('drop', async e => {
                if (!hasFiles(e)) return;
                e.preventDefault(); depth = 0; zone.classList.remove('drop-active');
                let files;
                try { files = await filesFromDrop(e.dataTransfer); }
                catch (err) { this.editor.setStatus('Could not read the dropped items: ' + err.message, 'error'); return; }
                this.upload(files);
            });
            // a drop that misses the zone must not make the browser open the file instead of the editor
            window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
            window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });
        }

        // What can't be sent, decided before any upload: not audio (cover.jpg, .zip …), or over the size limit.
        triage(files) {
            const ok = [], skipped = [];
            for (const f of files) {
                const x = ext(f.name);
                if (x === '.zip') {
                    if (!this.info.zipMaxBytes) skipped.push({ name: f.name, why: 'a zip: unzip it first, then upload the files' });
                    else if (f.size > this.info.zipMaxBytes) skipped.push({ name: f.name, why: `a zip larger than ${mb(this.info.zipMaxBytes)}` });
                    else ok.push(f);
                }
                else if (!this.info.extensions.includes(x)) skipped.push({ name: f.name, why: 'not an audio file' });
                else if (f.size > this.info.maxBytes) skipped.push({ name: f.name, why: `larger than ${mb(this.info.maxBytes)}` });
                else if (f.size === 0) skipped.push({ name: f.name, why: 'empty' });
                else ok.push(f);
            }
            return { ok, skipped };
        }

        // One file per request (the server's contract); XHR for upload progress, which fetch doesn't report.
        send(file, onProgress) {
            const isZip = ext(file.name) === '.zip';
            return new Promise(resolve => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', (isZip ? '/api/upload/zip' : '/api/upload') + '?name=' + encodeURIComponent(file.name));
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
                xhr.onload = () => {
                    let body = {};
                    try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
                    if (xhr.status !== 200) resolve({ error: body.error || `HTTP ${xhr.status}`, skipped: body.skipped });
                    else if (isZip) resolve({ zip: { name: file.name, folder: body.folder, saved: body.saved || [], skipped: body.skipped || [] } });
                    else resolve({ saved: body.saved });
                };
                xhr.onerror = () => resolve({ error: 'network error' });
                xhr.send(file);
            });
        }

        show(...kids) { this.panel.hidden = false; this.panel.replaceChildren(...kids.filter(Boolean)); }   // no "null" text for absent parts

        async upload(files) {
            if (this.busy) { this.editor.setStatus('An upload is already running', 'warning'); return; }
            if (!files.length) return;
            const { ok, skipped } = this.triage(files);
            if (!ok.length) { this.finish([], [], skipped); return; }

            this.busy = true;
            this.button.disabled = true;
            const total = ok.reduce((n, f) => n + f.size, 0);
            let done = 0;
            const saved = [], failed = [], zips = [];
            const bar = el('progress', { max: 1, value: 0 });
            const line = el('div', { class: 'upload-line' });
            this.show(line, bar);
            for (const [i, file] of ok.entries()) {
                const at = (frac) => {
                    line.textContent = frac >= 1 && ext(file.name) === '.zip'
                        ? `Unpacking ${file.name} (${i + 1} of ${ok.length})…`
                        : `Uploading ${i + 1} of ${ok.length}: ${file.name} (${Math.round(frac * 100)}%)`;
                    bar.value = total ? (done + frac * file.size) / total : 0;
                };
                at(0);
                const r = await this.send(file, at);
                done += file.size;
                if (r.saved) saved.push(r.saved);
                else if (r.zip) { zips.push(r.zip); for (const s of r.zip.skipped) skipped.push({ name: `${file.name} › ${s.name}`, why: s.why }); }
                else {
                    failed.push({ name: file.name, why: r.error });
                    for (const s of r.skipped || []) skipped.push({ name: `${file.name} › ${s.name}`, why: s.why });
                }
            }
            this.busy = false;
            this.button.disabled = false;
            this.finish(saved, failed, skipped, zips);
        }

        // The summary stays until closed; then the import folder opens with the new files selected.
        async finish(saved, failed, skipped, zips = []) {
            const parts = [];
            if (saved.length) parts.push(`Uploaded ${plural(saved.length, 'file')} into ${this.info.importPath}/`);
            for (const z of zips) parts.push(`Unpacked ${z.name} into ${z.folder.path}/ (${plural(z.saved.length, 'file')})`);
            if (failed.length) parts.push(`${failed.length} failed`);
            if (skipped.length) parts.push(`${skipped.length} skipped`);
            const renamed = saved.filter(s => / \(\d+\)\.[^.]+$/.test(s.name));
            const problems = [...failed, ...skipped];
            const list = problems.slice(0, 12).map(f => el('li', {}, el('strong', { text: f.name }), ': ' + f.why));
            if (problems.length > 12) list.push(el('li', { text: `… and ${problems.length - 12} more` }));
            if (renamed.length) list.push(el('li', { text: `${plural(renamed.length, 'name')} already existed there, so ${renamed.length === 1 ? 'it was' : 'they were'} saved as "… (2)" etc.: nothing was overwritten` }));
            const anything = saved.length || zips.length;
            const next = anything ? el('div', { class: 'upload-next', text: 'They are selected: 🎼 MusicBrainz looks them up.' }) : null;
            this.show(
                el('div', { class: 'upload-line' }, el('span', { text: parts.join(' · ') || 'Nothing to upload' }),
                    el('button', { class: 'upload-close', type: 'button', title: 'Close', 'aria-label': 'Close', text: '✕', onclick: () => { this.panel.hidden = true; } })),
                list.length ? el('ul', { class: 'upload-problems' }, list) : null,
                next);
            this.panel.className = 'upload-panel ' + (failed.length ? 'error' : skipped.length || !anything ? 'warning' : 'success');
            if (!anything) return;

            // one album zip and nothing else: open its folder with its tracks selected; otherwise the import folder,
            // with the new files and the new album folders selected
            const single = zips.length === 1 && !saved.length;
            const open = single ? zips[0].folder.path : this.info.importPath;
            await this.editor.loadFiles(open);
            this.editor.clearSelection();
            const want = new Set(single ? zips[0].saved.map(s => s.path) : [...saved.map(s => 'file:' + s.path), ...zips.map(z => 'directory:' + z.folder.path)]);
            for (const row of this.editor.fileList.querySelectorAll('.file-item[data-type="file"], .file-item[data-type="directory"]')) {
                const key = row.dataset.type + ':' + row.dataset.path;
                if (!(single ? row.dataset.type === 'file' && want.has(row.dataset.path) : want.has(key))) continue;
                this.editor.selectedItems.add(key);
                row.classList.add('multi-selected');
            }
            this.editor.updateSelectionUI();
            this.editor.fileList.querySelector('.file-item.multi-selected')?.scrollIntoView({ block: 'nearest' });
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const editor = window.metadataEditor;
        if (!editor) return;
        let info;
        try { const r = await fetch('/api/upload'); info = r.ok ? await r.json() : null; } catch { info = null; }
        if (info && info.enabled) new UploadPanel(editor, info);
    });
})();
