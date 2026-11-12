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
            
            if (item.isDirectory()) {
                result.push({
                    name: item.name,
                    path: relativePath,
                    type: 'directory'
                });
            } else if (item.isFile() && isAudioFile(item.name)) {
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

module.exports = { app, getFullPath, MUSIC_DIR, IMPORT_DIR };

// Start server (only when run directly; tests require() the app)
if (require.main === module) app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 Music Metadata Editor server running on port ${PORT}`);
    console.log(`📁 Music directory: ${MUSIC_DIR}`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
    console.log('Debug endpoints available:');
    console.log('- GET /api/verify/metadata/<path> - Check if metadata was actually written');
    console.log('- POST /api/test/m4a/<path> - Test alternative M4A writer');
});
