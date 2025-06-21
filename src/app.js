// File: src/app.js
// Music Metadata Editor Backend - Fixed Batch Metadata

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { parseFile } = require('music-metadata');

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = '/music';

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

// Helper function to get full path
function getFullPath(relativePath) {
    if (!relativePath || relativePath === '') {
        return MUSIC_DIR;
    }
    // Remove leading slash if present to avoid double slashes
    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    return path.join(MUSIC_DIR, cleanPath);
}

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
                result.push({
                    name: path.parse(item.name).name,
                    path: relativePath,
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
        
        const metadata = await parseFile(fullPath);
        
        res.json({
            filename: path.basename(fullPath),
            common: metadata.common,
            format: metadata.format
        });
        
    } catch (error) {
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
        console.error('Error updating metadata:', error);
        res.status(500).json({ error: 'Failed to update metadata' });
    }
});

// API: Rename file
app.post('/api/file/rename', async (req, res) => {
    try {
        const { oldPath, newName } = req.body;
        const fullOldPath = getFullPath(oldPath);
        const directory = path.dirname(fullOldPath);
        const extension = path.extname(fullOldPath);
        const fullNewPath = path.join(directory, newName + extension);
        
        console.log('Renaming file from:', fullOldPath, 'to:', fullNewPath);
        
        await fs.rename(fullOldPath, fullNewPath);
        
        res.json({ 
            message: 'File renamed successfully',
            success: true 
        });
        
    } catch (error) {
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
        const { oldPath, newName } = req.body;
        const fullOldPath = getFullPath(oldPath);
        const parentDirectory = path.dirname(fullOldPath);
        const fullNewPath = path.join(parentDirectory, newName);
        
        console.log('Renaming directory from:', fullOldPath, 'to:', fullNewPath);
        
        await fs.rename(fullOldPath, fullNewPath);
        
        res.json({ 
            message: 'Directory renamed successfully',
            success: true 
        });
        
    } catch (error) {
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
        console.error('Error in batch delete:', error);
        res.status(500).json({ error: 'Failed to delete items' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        musicDir: MUSIC_DIR
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 Music Metadata Editor server running on port ${PORT}`);
    console.log(`📁 Music directory: ${MUSIC_DIR}`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
});
