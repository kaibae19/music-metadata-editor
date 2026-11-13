// File: src/app.js
// Music Metadata Editor Backend - With Verification Endpoints

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { parseFile } = require('music-metadata');
const MP3Tag = require('mp3tag.js');

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = path.resolve(process.env.MUSIC_DIR || '/music');

// Initialize metadata writer
const MetadataWriter = require('./metadata/writer');
const metadataWriter = new MetadataWriter();

// Cross-site guard (2026-11-12). The editor has no login, so two things must not work:
//  - CSRF: a web page the user happens to visit making their browser change files here (upload, rename, delete, tag).
//    Every request that changes something (anything but GET/HEAD/OPTIONS) must come from the editor's own page:
//    Sec-Fetch-Site, when the browser sends it, must be same-origin or none (typed/bookmarked), and Origin, when
//    present, must match the Host the request went to. Requests with neither header (curl, a script on the LAN) pass:
//    no web page can send those.
//  - DNS rebinding: a hostile name pointed at this server is same-origin with itself, so the checks above can't see it.
//    ALLOWED_HOSTS (optional, comma-separated; "name" matches any port, "name:port" one port) refuses any request
//    whose Host isn't listed (loopback names always pass). Unset = no Host check (a startup line says so).
const ALLOWED_HOSTS = String(process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
if (!ALLOWED_HOSTS.length) console.log('ALLOWED_HOSTS not set: any Host header is accepted (set it to guard against DNS rebinding)');
function hostAllowed(host) {
    const h = String(host || '').toLowerCase();
    const name = h.replace(/:\d+$/, '');
    // loopback always: the container's own health check uses it, and a hostile domain can't send it as its Host
    if (['127.0.0.1', 'localhost', '[::1]'].includes(name)) return true;
    return ALLOWED_HOSTS.some(a => a === h || (!/:\d+$/.test(a) && a === name));
}
app.use((req, res, next) => {
    if (ALLOWED_HOSTS.length && !hostAllowed(req.headers.host)) return res.status(403).json({ error: 'Host not allowed' });
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Cross-site request refused' });
    const origin = req.headers.origin;
    if (origin !== undefined) {
        let ok = false;
        try { ok = new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { ok = false; }
        if (!ok) return res.status(403).json({ error: 'Cross-site request refused' });
    }
    next();
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Supported audio file extensions
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav'];

// Helper function to check if file is audio
function isAudioFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
}

// Resolve a path from the browser inside MUSIC_DIR. Anything that would land outside it ("../", absolute
// paths, symlink-free tricks like "/music2") is refused: every route that touches files goes through here.
class PathError extends Error { constructor(m) { super(m); this.status = 400; } }
function getFullPath(relativePath) {
    const clean = String(relativePath || '').replace(/^\/+/, '');
    const full = path.resolve(MUSIC_DIR, clean);
    if (full !== MUSIC_DIR && !full.startsWith(MUSIC_DIR + path.sep)) throw new PathError('Path is outside the music folder');
    return full;
}

// Import folder (docs/upload-and-import.md, step 1): IMPORT_DIR is relative to MUSIC_DIR (default "import"), so it is
// always inside the music folder. One that would land outside it (or on the music folder itself) disables the shortcut.
const IMPORT_DIR = (() => {
    const rel = String(process.env.IMPORT_DIR ?? 'import').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!rel) return null;
    try {
        const full = getFullPath(rel);
        return full === MUSIC_DIR ? null : { rel: path.relative(MUSIC_DIR, full).split(path.sep).join('/'), full };
    } catch {
        console.warn(`IMPORT_DIR "${process.env.IMPORT_DIR}" is outside the music folder: import shortcut off`);
        return null;
    }
})();

// A single name for rename: no separators, not "." or "..".
function checkName(name) {
    if (typeof name !== 'string' || !name.trim() || /[\/\\]/.test(name) || name === '.' || name === '..') throw new PathError('Invalid name');
    return name;
}

// API: Verify metadata was actually written
app.get('/api/verify/metadata/:path(*)', async (req, res) => {
    try {
        const relativePath = req.params.path;
        const fullPath = getFullPath(relativePath);
        
        console.log('=== METADATA VERIFICATION ===');
        console.log('Verifying metadata for:', fullPath);
        
        // Read with music-metadata library (what we use for reading)
        const metadata = await parseFile(fullPath);
        
        console.log('Raw metadata from music-metadata library:');
        console.log('Common tags:', JSON.stringify(metadata.common, null, 2));
        console.log('Format info:', JSON.stringify(metadata.format, null, 2));
        
        // Try reading with MP3Tag library directly
        try {
            const buffer = await fs.readFile(fullPath);
            const mp3tag = new MP3Tag(buffer, false);
            mp3tag.read();
            
            console.log('Tags from MP3Tag library:');
            console.log(JSON.stringify(mp3tag.tags, null, 2));
            
            res.json({
                success: true,
                musicMetadata: metadata.common,
                mp3tagData: mp3tag.tags,
                format: metadata.format,
                fileSize: buffer.length
            });
            
        } catch (mp3tagError) {
            console.log('MP3Tag read error:', mp3tagError.message);
            res.json({
                success: true,
                musicMetadata: metadata.common,
                mp3tagError: mp3tagError.message,
                format: metadata.format
            });
        }
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Verification error:', error);
        res.status(500).json({ error: 'Verification failed: ' + error.message });
    }
});

// Alternative M4A writer using a different approach
async function writeMP4MetadataAlternative(filePath, metadata) {
    console.log(`\n=== ALTERNATIVE M4A WRITER ===`);
    console.log(`File: ${path.basename(filePath)}`);
    
    try {
        // Read the file
        const buffer = await fs.readFile(filePath);
        console.log(`File read: ${buffer.length} bytes`);
        
        // Check if this is actually an MP4/M4A file by looking for the ftyp box
        const ftypIndex = buffer.indexOf('ftyp');
        console.log(`ftyp box found at index: ${ftypIndex}`);
        
        if (ftypIndex === -1) {
            console.log(`❌ This doesn't appear to be a valid MP4/M4A file`);
            return { success: false, error: 'File does not appear to be a valid M4A file (no ftyp box found)' };
        }
        
        // Try creating MP3Tag with different options
        let mp3tag;
        try {
            // Method 1: Standard approach
            mp3tag = new MP3Tag(buffer);
            mp3tag.read();
            console.log(`✅ Standard MP3Tag approach worked`);
        } catch (error1) {
            console.log(`❌ Standard approach failed: ${error1.message}`);
            try {
                // Method 2: Force MP4 format
                mp3tag = new MP3Tag(buffer, false);
                mp3tag.read();
                console.log(`✅ Non-verbose approach worked`);
            } catch (error2) {
                console.log(`❌ Non-verbose approach failed: ${error2.message}`);
                return { success: false, error: `Both MP3Tag approaches failed: ${error1.message}` };
            }
        }
        
        console.log(`Current tags:`, mp3tag.tags);
        
        // Prepare the new tags - be very explicit about what we're setting
        const newTags = {};
        
        // Only set non-empty values
        if (metadata.title && metadata.title.trim() !== '') {
            newTags.title = metadata.title.trim();
        }
        if (metadata.artist && metadata.artist.trim() !== '') {
            newTags.artist = metadata.artist.trim();
        }
        if (metadata.album && metadata.album.trim() !== '') {
            newTags.album = metadata.album.trim();
        }
        if (metadata.albumartist && metadata.albumartist.trim() !== '') {
            newTags.albumartist = metadata.albumartist.trim();
        }
        if (metadata.year && metadata.year !== null) {
            newTags.year = metadata.year.toString();
        }
        if (metadata.track && metadata.track !== null) {
            newTags.track = metadata.track.toString();
        }
        if (metadata.genre && metadata.genre.trim() !== '') {
            newTags.genre = metadata.genre.trim();
        }
        
        console.log(`New tags to set:`, newTags);
        
        if (Object.keys(newTags).length === 0) {
            console.log(`ℹ️ No valid metadata provided`);
            return { success: true, error: null };
        }
        
        // Merge with existing tags (preserve what we're not changing)
        const mergedTags = { ...mp3tag.tags, ...newTags };
        console.log(`Merged tags:`, mergedTags);
        
        // Set the tags
        mp3tag.tags = mergedTags;
        
        // Save to buffer
        mp3tag.save();
        console.log(`✅ Tags saved to buffer`);
        
        // Write the file with a different approach - write to temp file first
        const tempPath = filePath + '.temp.' + Date.now();
        await fs.writeFile(tempPath, Buffer.from(mp3tag.buffer));
        console.log(`✅ Written to temp file: ${path.basename(tempPath)}`);
        
        // Verify the temp file is valid
        const tempBuffer = await fs.readFile(tempPath);
        console.log(`✅ Temp file verification: ${tempBuffer.length} bytes`);
        
        // Replace the original file
        await fs.rename(tempPath, filePath);
        console.log(`✅ Original file replaced`);
        
        return { success: true, error: null };
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.log(`❌ Alternative writer failed:`, error.message);
        return { success: false, error: error.message };
    }
}

// API: Test alternative M4A writer
app.post('/api/test/m4a/:path(*)', async (req, res) => {
    try {
        const relativePath = req.params.path;
        const { metadata } = req.body;
        const fullPath = getFullPath(relativePath);
        
        console.log('=== TESTING ALTERNATIVE M4A WRITER ===');
        console.log('File:', fullPath);
        console.log('Metadata:', metadata);
        
        const result = await writeMP4MetadataAlternative(fullPath, metadata);
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'Alternative M4A writer succeeded' 
            });
        } else {
            res.status(500).json({ 
                error: result.error 
            });
        }
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Test endpoint error:', error);
        res.status(500).json({ error: 'Test failed: ' + error.message });
    }
});

// API: Get files and directories
app.get('/api/files', async (req, res) => {
    try {
        const requestedPath = req.query.path || '';
        const fullPath = getFullPath(requestedPath);
        
        console.log('Listing directory:', fullPath);
        
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        
        const result = [];
        
        for (const item of items) {
            const itemPath = path.join(fullPath, item.name);
            const relativePath = path.relative(MUSIC_DIR, itemPath);
            
            if (item.isDirectory() && item.name.startsWith('.upload-')) continue;   // a zip being unpacked
            if (item.isDirectory()) {
                result.push({
                    name: item.name,
                    path: relativePath,
                    type: 'directory'
                });
            } else if (item.isFile() && isAudioFile(item.name) && !item.name.startsWith('.upload-')) {   // skip uploads in progress
                // FIXED: Use the original filename, not parsed name + extension
                result.push({
                    name: path.parse(item.name).name, // Display name without extension
                    path: relativePath, // Use original relative path
                    type: 'file',
                    extension: path.extname(item.name)
                });
            }
        }
        
        // Sort: directories first, then files, both alphabetically
        result.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        res.json({
            currentPath: requestedPath,
            items: result
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error reading directory:', error);
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// API: Get metadata for a file
app.get('/api/metadata/:path(*)', async (req, res) => {
    try {
        const relativePath = req.params.path;
        const fullPath = getFullPath(relativePath);
        
        console.log('Reading metadata for:', fullPath);
        
        // Check if file exists first
        try {
            await fs.access(fullPath, fs.constants.F_OK);
        } catch (error) {
            console.error('File not found:', fullPath);
            return res.status(404).json({ error: 'File not found' });
        }
        
        const metadata = await parseFile(fullPath);
        
        res.json({
            filename: path.basename(fullPath),
            common: metadata.common,
            format: metadata.format
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error reading metadata:', error);
        res.status(500).json({ error: 'Failed to read metadata' });
    }
});

// API: Batch update metadata for multiple files - FIXED VERSION (MUST BE BEFORE SINGLE FILE ROUTE)
app.post('/api/metadata/batch', async (req, res) => {
    try {
        const { filePaths, metadata } = req.body;
        
        console.log('=== BATCH METADATA ENDPOINT HIT ===');
        console.log('Batch metadata update for:', filePaths?.length || 0, 'files');
        console.log('File paths received:', filePaths);
        console.log('New metadata:', metadata);
        
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            return res.status(400).json({ error: 'No files provided' });
        }
        
        // Convert relative paths to full paths and validate
        const validatedPaths = [];
        const invalidPaths = [];
        
        for (const relativePath of filePaths) {
            try {
                const fullPath = getFullPath(relativePath);
                
                console.log(`Validating file: ${relativePath} -> ${fullPath}`);
                
                // Check if file exists
                await fs.access(fullPath, fs.constants.F_OK);
                
                // Check if format is supported BEFORE attempting to write
                if (!metadataWriter.isSupported(fullPath)) {
                    const ext = path.extname(fullPath).toLowerCase();
                    invalidPaths.push({
                        path: relativePath,
                        reason: `Unsupported format: ${ext}`
                    });
                    console.log(`Skipping unsupported file: ${fullPath} (${ext})`);
                    continue;
                }
                
                validatedPaths.push(fullPath);
                
            } catch (error) {
                invalidPaths.push({
                    path: relativePath,
                    reason: error.code === 'ENOENT' ? 'File not found' : error.message
                });
                console.log(`Skipping invalid file: ${relativePath} - ${error.message}`);
            }
        }
        
        if (validatedPaths.length === 0) {
            return res.status(400).json({ 
                error: 'No supported audio files found in selection',
                details: invalidPaths,
                supportedFormats: metadataWriter.supportedFormats
            });
        }
        
        console.log(`Processing ${validatedPaths.length} valid files (${invalidPaths.length} skipped)`);
        
        // Process the valid files
        const result = await metadataWriter.writeBatchMetadata(validatedPaths, metadata);
        
        let response = {
            success: result.success,
            totalFiles: filePaths.length,
            processedFiles: validatedPaths.length,
            skippedFiles: invalidPaths.length,
            successCount: result.successCount,
            failedCount: result.failedCount,
            results: result.results,
            skippedDetails: invalidPaths
        };
        
        // Enhanced status messages
        if (invalidPaths.length > 0 && result.successCount > 0) {
            response.code = 'PARTIAL_SUCCESS_WITH_SKIPPED';
            response.message = `Updated ${result.successCount}/${validatedPaths.length} supported files. ${invalidPaths.length} files skipped (unsupported formats).`;
        } else if (result.permissionDeniedCount > 0) {
            response.code = 'SOME_PERMISSION_DENIED';
            response.message = `Updated ${result.successCount}/${validatedPaths.length} files. ${result.permissionDeniedCount} files could not be written due to permissions.`;
        } else if (result.successCount === validatedPaths.length) {
            response.message = `Successfully updated metadata for all ${result.successCount} supported files.`;
        } else if (result.successCount > 0) {
            response.message = `Updated ${result.successCount}/${validatedPaths.length} files successfully.`;
        } else {
            response.message = 'Failed to update any files.';
        }
        
        console.log(`Batch update complete: ${result.successCount}/${validatedPaths.length} files updated, ${invalidPaths.length} skipped`);
        
        // Return appropriate status code
        if (result.successCount > 0) {
            res.json(response);
        } else {
            res.status(400).json(response);
        }
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error updating batch metadata:', error);
        res.status(500).json({ error: 'Failed to update batch metadata' });
    }
});

// API: Update metadata for a single file
app.post('/api/metadata/:path(*)', async (req, res) => {
    try {
        const relativePath = req.params.path;
        const { metadata } = req.body;
        const fullPath = getFullPath(relativePath);
        
        console.log('=== SINGLE FILE METADATA ENDPOINT HIT ===');
        console.log('Update metadata request for:', fullPath);
        console.log('New metadata:', metadata);
        
        // Verify file exists
        try {
            await fs.access(fullPath, fs.constants.F_OK);
        } catch (error) {
            console.error('File not found:', fullPath);
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Check if format is supported
        if (!metadataWriter.isSupported(fullPath)) {
            const ext = path.extname(fullPath).toLowerCase();
            return res.status(400).json({ 
                error: `Unsupported format: ${ext}. Supported formats: ${metadataWriter.supportedFormats.join(', ')}`,
                code: 'UNSUPPORTED_FORMAT'
            });
        }
        
        const result = await metadataWriter.writeMetadata(fullPath, metadata);
        
        if (result.success) {
            console.log(`Successfully updated metadata for: ${path.basename(fullPath)}`);
            res.json({ 
                success: true, 
                message: `Metadata updated successfully for ${path.basename(fullPath)}` 
            });
        } else {
            console.error(`Failed to update metadata for ${fullPath}:`, result.error);
            
            if (result.code === 'PERMISSION_DENIED') {
                res.status(403).json({ 
                    error: result.error,
                    code: result.code 
                });
            } else {
                res.status(500).json({ 
                    error: result.error,
                    code: result.code || 'WRITE_FAILED'
                });
            }
        }
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error updating metadata:', error);
        res.status(500).json({ error: 'Failed to update metadata' });
    }
});

// API: Rename file
app.post('/api/file/rename', async (req, res) => {
    try {
        const { oldPath } = req.body;
        const newName = checkName(req.body.newName);
        const fullOldPath = getFullPath(oldPath);
        if (fullOldPath === MUSIC_DIR) throw new PathError('Invalid path');
        const directory = path.dirname(fullOldPath);
        const extension = path.extname(fullOldPath);
        
        // FIXED: Don't add extension if newName already has it
        let finalNewName = newName;
        if (!newName.endsWith(extension)) {
            finalNewName = newName + extension;
        }
        
        const fullNewPath = path.join(directory, finalNewName);
        
        console.log('Renaming file from:', fullOldPath, 'to:', fullNewPath);
        
        await fs.rename(fullOldPath, fullNewPath);
        
        res.json({ 
            message: 'File renamed successfully',
            success: true 
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error renaming file:', error);
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Access denied' });
        } else {
            res.status(500).json({ error: 'Failed to rename file' });
        }
    }
});

// API: Rename directory
app.post('/api/directory/rename', async (req, res) => {
    try {
        const { oldPath } = req.body;
        const newName = checkName(req.body.newName);
        const fullOldPath = getFullPath(oldPath);
        if (fullOldPath === MUSIC_DIR) throw new PathError('Invalid path');
        const parentDirectory = path.dirname(fullOldPath);
        const fullNewPath = path.join(parentDirectory, newName);
        
        console.log('Renaming directory from:', fullOldPath, 'to:', fullNewPath);
        
        await fs.rename(fullOldPath, fullNewPath);
        
        res.json({ 
            message: 'Directory renamed successfully',
            success: true 
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error renaming directory:', error);
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Access denied' });
        } else {
            res.status(500).json({ error: 'Failed to rename directory' });
        }
    }
});

// API: Delete file
app.post('/api/file/delete', async (req, res) => {
    try {
        const { filePath } = req.body;
        const fullPath = getFullPath(filePath);
        
        console.log('Deleting file:', fullPath);
        
        await fs.unlink(fullPath);
        
        res.json({ 
            message: 'File deleted successfully',
            success: true 
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// API: Delete directory
app.post('/api/directory/delete', async (req, res) => {
    try {
        const { dirPath } = req.body;
        const fullPath = getFullPath(dirPath);
        
        console.log('Deleting directory:', fullPath);
        
        await fs.rm(fullPath, { recursive: true, force: true });
        
        res.json({ 
            message: 'Directory deleted successfully',
            success: true 
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error deleting directory:', error);
        res.status(500).json({ error: 'Failed to delete directory' });
    }
});

// API: Batch delete items
app.post('/api/batch/delete', async (req, res) => {
    try {
        const { items } = req.body;
        
        console.log('Batch deleting:', items.length, 'items');
        
        const errors = [];
        
        for (const item of items) {
            try {
                const fullPath = getFullPath(item.path);
                
                if (item.type === 'directory') {
                    await fs.rm(fullPath, { recursive: true, force: true });
                } else {
                    await fs.unlink(fullPath);
                }
                
                console.log('Deleted:', fullPath);
                
            } catch (error) {
                console.error('Error deleting item:', item.path, error);
                errors.push({ path: item.path, error: error.message });
            }
        }
        
        res.json({ 
            message: `Batch delete completed. ${items.length - errors.length} items deleted successfully.`,
            success: true,
            errors: errors
        });
        
    } catch (error) {
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Error in batch delete:', error);
        res.status(500).json({ error: 'Failed to delete items' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Import folder: where it is and whether it exists yet (the UI's "📥 Import" shortcut)
app.get('/api/import', async (req, res) => {
    if (!IMPORT_DIR) return res.json({ enabled: false });
    const stat = await fs.stat(IMPORT_DIR.full).catch(() => null);
    res.json({ enabled: true, path: IMPORT_DIR.rel, exists: !!stat && stat.isDirectory() });
});

// Upload into the import folder (docs/upload-and-import.md, step 2). Off unless ENABLE_UPLOAD=true.
// One file per request, the raw bytes as the body: POST /api/upload?name=<original file name>. Guardrails: audio
// extension + the file must parse as audio, size limit (UPLOAD_MAX_MB), base name only, never overwrite, written to
// a temp file first (no half files).
const UPLOAD_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_UPLOAD || ''));
const UPLOAD_MAX_BYTES = Math.round((parseFloat(process.env.UPLOAD_MAX_MB) || 500) * 1024 * 1024);
const UPLOAD_ZIP_MAX_BYTES = Math.round((parseFloat(process.env.UPLOAD_ZIP_MAX_MB) || 2048) * 1024 * 1024);
const fsSync = require('fs');
const crypto = require('crypto');

function uploadName(raw) {
    // base name only: drop any folder part (/ or \), control characters and leading dots; trim; cap the length
    // also invisible direction/format marks (U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF), which can make a name
    // display with a different extension than it really has
    let name = String(raw || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim().replace(/^\.+/, '');
    if (name.length > 200) name = name.slice(0, 200 - path.extname(name).length) + path.extname(name);
    return name;
}

async function freeName(dir, name) {
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    for (let n = 1; n < 1000; n++) {
        const candidate = n === 1 ? name : `${base} (${n})${ext}`;
        try { await fs.access(path.join(dir, candidate)); } catch { return candidate; }
    }
    throw new Error('Too many files with that name');
}

app.get('/api/upload', (req, res) => {
    res.json({ enabled: UPLOAD_ENABLED && !!IMPORT_DIR, maxBytes: UPLOAD_MAX_BYTES, extensions: AUDIO_EXTENSIONS,
        importPath: IMPORT_DIR ? IMPORT_DIR.rel : null, zipMaxBytes: UPLOAD_ZIP_MAX_BYTES });
});

app.post('/api/upload', async (req, res) => {
    if (!UPLOAD_ENABLED) return res.status(403).json({ error: 'Upload is off (set ENABLE_UPLOAD=true)' });
    if (!IMPORT_DIR) return res.status(403).json({ error: 'No import folder (IMPORT_DIR)' });
    // raw bytes must be sent as application/octet-stream: a cross-site page can't send that type without a CORS
    // preflight, which this server never answers (text/plain would slip through as a "simple" request)
    if (!/^application\/octet-stream\b/i.test(String(req.headers['content-type'] || ''))) return res.status(415).json({ error: 'Send the file as application/octet-stream' });
    const name = uploadName(req.query.name);
    if (!name) return res.status(400).json({ error: 'Missing file name' });
    if (!isAudioFile(name)) return res.status(415).json({ error: `Not an audio file type: ${path.extname(name) || '(none)'}` });
    const declared = Number(req.headers['content-length']);
    if (declared > UPLOAD_MAX_BYTES) return res.status(413).json({ error: `File is larger than ${UPLOAD_MAX_BYTES} bytes` });

    let tmp;
    try {
        await fs.mkdir(IMPORT_DIR.full, { recursive: true });
        tmp = path.join(IMPORT_DIR.full, `.upload-${crypto.randomBytes(6).toString('hex')}${path.extname(name).toLowerCase()}`);
        getFullPath(path.relative(MUSIC_DIR, tmp));            // stays inside MUSIC_DIR (belt and braces)
        let size = 0, tooBig = false;
        await new Promise((resolve, reject) => {
            const out = fsSync.createWriteStream(tmp, { flags: 'wx', mode: 0o664 });
            req.on('data', chunk => {
                size += chunk.length;
                if (size > UPLOAD_MAX_BYTES && !tooBig) { tooBig = true; req.unpipe(out); out.destroy(); req.resume(); resolve(); }
            });
            req.on('error', reject);
            out.on('error', reject);
            out.on('finish', resolve);
            req.pipe(out);
        });
        if (tooBig) { await fs.rm(tmp, { force: true }); return res.status(413).json({ error: `File is larger than ${UPLOAD_MAX_BYTES} bytes` }); }
        if (size === 0) { await fs.rm(tmp, { force: true }); return res.status(400).json({ error: 'Empty file' }); }
        let format;
        try { format = (await parseFile(tmp, { duration: false, skipCovers: true })).format; } catch { format = null; }
        if (!format || !format.container) { await fs.rm(tmp, { force: true }); return res.status(415).json({ error: 'Not a readable audio file' }); }
        // never overwrite: pick a free name, then link (fails if it appeared meanwhile) or rename as a fallback
        let final;
        for (let attempt = 0; attempt < 5; attempt++) {
            final = await freeName(IMPORT_DIR.full, name);
            try { await fs.link(tmp, path.join(IMPORT_DIR.full, final)); await fs.rm(tmp, { force: true }); break; }
            catch (e) {
                if (e.code === 'EEXIST') { final = null; continue; }
                await fs.rename(tmp, path.join(IMPORT_DIR.full, final)); break;   // no hard links (some filesystems)
            }
        }
        if (!final) throw new Error('Could not find a free file name');
        await fs.chmod(path.join(IMPORT_DIR.full, final), 0o664).catch(() => {});
        res.json({ saved: { name: final, path: `${IMPORT_DIR.rel}/${final}`, size, container: format.container } });
    } catch (error) {
        if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
        if (error instanceof PathError) return res.status(400).json({ error: error.message });
        console.error('Upload failed:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Zip upload (src/upload-zip.js): the audio inside a .zip, unpacked into its own folder in the import folder
require('./upload-zip').register(app, {
    uploadEnabled: UPLOAD_ENABLED, importDir: IMPORT_DIR, cleanName: uploadName, isAudioFile, freeName,
    fileMaxBytes: UPLOAD_MAX_BYTES, zipMaxBytes: UPLOAD_ZIP_MAX_BYTES,
    isAudio: async file => { try { return (await parseFile(file, { duration: false, skipCovers: true })).format.container || null; } catch { return null; } },
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        musicDir: MUSIC_DIR
    });
});

// MusicBrainz mode (docs/musicbrainz-mode.md)
require('./musicbrainz/routes').register(app, { getFullPath, musicDir: MUSIC_DIR });

// Path errors anywhere: 400 with the reason (routes that don't catch them themselves)
app.use((err, req, res, next) => {
    if (err instanceof PathError) return res.status(400).json({ error: err.message });
    next(err);
});

module.exports = { app, getFullPath, MUSIC_DIR, IMPORT_DIR, uploadName };

// Start server (only when run directly; tests require() the app)
if (require.main === module) app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 Music Metadata Editor server running on port ${PORT}`);
    console.log(`📁 Music directory: ${MUSIC_DIR}`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
    console.log('Debug endpoints available:');
    console.log('- GET /api/verify/metadata/<path> - Check if metadata was actually written');
    console.log('- POST /api/test/m4a/<path> - Test alternative M4A writer');
});
