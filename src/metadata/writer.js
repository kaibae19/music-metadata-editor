// File: src/metadata/writer.js
// Enhanced M4A Metadata Writer with comprehensive debugging and error handling

const path = require('path');
const fs = require('fs').promises;
const NodeID3 = require('node-id3');
const flac = require('./flac');
const mp4 = require('./mp4');

class MetadataWriter {
    constructor() {
        // .m4a: real MP4 tags via node-taglib-sharp (src/metadata/mp4.js) since 2026-11-11; the old path through
        // mp3tag.js returned success and left the file unchanged. .aac (raw ADTS, no MP4 container) stays unsupported.
        this.supportedFormats = ['.mp3', '.flac', '.m4a'];
    }

    /**
     * Get file extension
     */
    getFileExtension(filePath) {
        return path.extname(filePath).toLowerCase();
    }

    /**
     * Enhanced format checking with better error messages
     */
    isSupported(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            console.log('Invalid file path provided to isSupported:', filePath);
            return false;
        }
        
        const ext = this.getFileExtension(filePath);
        const isSupported = this.supportedFormats.includes(ext);
        
        console.log(`Format check for ${path.basename(filePath)}: ${ext} -> ${isSupported ? 'SUPPORTED' : 'NOT SUPPORTED'}`);
        
        return isSupported;
    }

    /**
     * Write metadata to MP3 file using node-id3
     */
    async writeMP3Metadata(filePath, metadata) {
        try {
            const tags = {};
            
            // Map our standard metadata to ID3 tags
            if (metadata.title !== undefined && metadata.title !== null) tags.title = metadata.title;
            if (metadata.artist !== undefined && metadata.artist !== null) tags.artist = metadata.artist;
            if (metadata.album !== undefined && metadata.album !== null) tags.album = metadata.album;
            if (metadata.albumartist !== undefined && metadata.albumartist !== null) tags.performerInfo = metadata.albumartist;
            if (metadata.year !== undefined && metadata.year !== null) tags.year = metadata.year.toString();
            if (metadata.track !== undefined && metadata.track !== null) tags.trackNumber = metadata.track.toString();
            if (metadata.genre !== undefined && metadata.genre !== null) tags.genre = metadata.genre;

            // Use update method to preserve existing tags
            const success = NodeID3.update(tags, filePath);
            
            if (success === true) {
                return { success: true, error: null };
            } else {
                return { success: false, error: success ? success.toString() : 'Unknown error' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Write metadata to a FLAC file with metaflac (src/metadata/flac.js): only the named fields change,
     * every other tag and the pictures stay. undefined or null = untouched (as in the MP3 writer: the form sends null for
     * an empty number field); '' = removed.
     */
    async writeFLACMetadata(filePath, metadata) {
        const fields = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', albumartist: 'ALBUMARTIST', year: 'DATE', track: 'TRACKNUMBER', genre: 'GENRE' };
        const changes = {};
        for (const [key, name] of Object.entries(fields)) {
            const v = metadata[key];
            if (v === undefined || v === null) continue;
            changes[name] = v === '' ? null : String(v);
        }
        try {
            await flac.writeTags(filePath, changes);
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /** M4A/MP4 through node-taglib-sharp (src/metadata/mp4.js): back up, write, read back, restore on mismatch. */
    async writeMP4Metadata(filePath, metadata) {
        const fields = ['title', 'artist', 'album', 'albumartist', 'year', 'track', 'genre'];
        const changes = {};
        for (const k of fields) if (metadata[k] !== undefined && metadata[k] !== null) changes[k] = metadata[k];
        try {
            return await mp4.writeTags(filePath, changes);
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async writeMetadata(filePath, metadata) {
        const ext = this.getFileExtension(filePath);
        
        // Check if we support this format
        if (!this.isSupported(filePath)) {
            return { 
                success: false, 
                error: `Unsupported format: ${ext}. Supported formats: ${this.supportedFormats.join(', ')}` 
            };
        }

        // Check if file exists and is writable
        try {
            await fs.access(filePath, fs.constants.F_OK | fs.constants.W_OK);
        } catch (error) {
            if (error.code === 'EACCES') {
                return { 
                    success: false, 
                    error: 'Permission denied - cannot write to file',
                    code: 'PERMISSION_DENIED'
                };
            } else if (error.code === 'ENOENT') {
                return { 
                    success: false, 
                    error: 'File not found',
                    code: 'FILE_NOT_FOUND'
                };
            }
            return { success: false, error: error.message };
        }

        // Route to appropriate writer based on file extension
        switch (ext) {
            case '.mp3':
                return await this.writeMP3Metadata(filePath, metadata);
            case '.flac':
                return await this.writeFLACMetadata(filePath, metadata);
            case '.m4a':
                return await this.writeMP4Metadata(filePath, metadata);
            default:
                return { 
                    success: false, 
                    error: `Unsupported format: ${ext}` 
                };
        }
    }

    /**
     * Enhanced batch metadata writing with better error handling
     */
    async writeBatchMetadata(filePaths, metadata) {
        const results = [];
        let successCount = 0;
        let permissionDeniedCount = 0;

        console.log(`Starting batch write for ${filePaths.length} files`);

        for (const filePath of filePaths) {
            try {
                // Double-check that the file is supported (defensive programming)
                if (!this.isSupported(filePath)) {
                    const ext = this.getFileExtension(filePath);
                    results.push({
                        file: path.basename(filePath),
                        success: false,
                        error: `Unsupported format: ${ext}`,
                        code: 'UNSUPPORTED_FORMAT'
                    });
                    console.log(`Skipping unsupported file in batch: ${path.basename(filePath)}`);
                    continue;
                }

                const result = await this.writeMetadata(filePath, metadata);
                
                if (result.success) {
                    successCount++;
                    console.log(`✅ Batch update success: ${path.basename(filePath)}`);
                } else if (result.code === 'PERMISSION_DENIED') {
                    permissionDeniedCount++;
                    console.log(`❌ Batch update permission denied: ${path.basename(filePath)}`);
                } else {
                    console.log(`❌ Batch update failed: ${path.basename(filePath)} - ${result.error}`);
                }
                
                results.push({
                    file: path.basename(filePath),
                    success: result.success,
                    error: result.error,
                    code: result.code
                });
                
            } catch (error) {
                console.error(`Exception during batch update for ${path.basename(filePath)}:`, error);
                results.push({
                    file: path.basename(filePath),
                    success: false,
                    error: error.message,
                    code: 'EXCEPTION'
                });
            }
        }

        console.log(`Batch write complete: ${successCount}/${filePaths.length} successful`);

        return {
            success: successCount > 0,
            totalFiles: filePaths.length,
            successCount,
            failedCount: filePaths.length - successCount,
            permissionDeniedCount,
            results
        };
    }
}

module.exports = MetadataWriter;
