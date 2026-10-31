// File: src/metadata/writer.js
// Enhanced M4A Metadata Writer with comprehensive debugging and error handling

const path = require('path');
const fs = require('fs').promises;
const NodeID3 = require('node-id3');
const flac = require('./flac');
const MP3Tag = require('mp3tag.js');

class MetadataWriter {
    constructor() {
        this.supportedFormats = ['.mp3', '.flac', '.m4a', '.aac'];
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
     * every other tag and the pictures stay. A field left undefined is untouched; an empty one is removed.
     */
    async writeFLACMetadata(filePath, metadata) {
        const fields = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', albumartist: 'ALBUMARTIST', year: 'DATE', track: 'TRACKNUMBER', genre: 'GENRE' };
        const changes = {};
        for (const [key, name] of Object.entries(fields)) {
            if (metadata[key] !== undefined) changes[name] = metadata[key] ? String(metadata[key]) : null;
        }
        try {
            await flac.writeTags(filePath, changes);
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * COMPLETELY REWRITTEN: M4A metadata writer with comprehensive debugging and multiple fallback approaches
     */
    async writeMP4Metadata(filePath, metadata) {
        console.log(`\n=== M4A METADATA WRITE START ===`);
        console.log(`File: ${path.basename(filePath)}`);
        console.log(`Full path: ${filePath}`);
        console.log(`Metadata to write:`, JSON.stringify(metadata, null, 2));
        
        try {
            // Step 1: Verify file exists and get stats
            let fileStats;
            try {
                fileStats = await fs.stat(filePath);
                console.log(`✅ File exists - Size: ${fileStats.size} bytes, Modified: ${fileStats.mtime}`);
            } catch (error) {
                console.log(`❌ File access error:`, error.message);
                return { success: false, error: `File not accessible: ${error.message}` };
            }

            // Step 2: Check write permissions
            try {
                await fs.access(filePath, fs.constants.W_OK);
                console.log(`✅ File is writable`);
            } catch (error) {
                console.log(`❌ File not writable:`, error.message);
                return { success: false, error: 'File is not writable', code: 'PERMISSION_DENIED' };
            }

            // Step 3: Read the file into buffer
            let buffer;
            try {
                buffer = await fs.readFile(filePath);
                console.log(`✅ File read successfully - Buffer size: ${buffer.length} bytes`);
            } catch (error) {
                console.log(`❌ Failed to read file:`, error.message);
                return { success: false, error: `Failed to read file: ${error.message}` };
            }

            // Step 4: Verify it's actually an M4A file by checking the buffer
            const bufferStart = buffer.slice(0, 20);
            console.log(`File header: ${bufferStart.toString('hex')}`);
            console.log(`File header ASCII: ${bufferStart.toString('ascii', 4, 12)}`);
            
            // M4A files should have 'ftyp' at bytes 4-8
            const fileType = buffer.toString('ascii', 4, 8);
            if (!fileType.includes('ftyp')) {
                console.log(`⚠️ Warning: File may not be a valid M4A (no ftyp signature found)`);
            } else {
                console.log(`✅ Valid M4A file signature detected`);
            }

            // Step 5: Try multiple mp3tag.js configurations
            let mp3tag;
            try {
                // Try with verbose mode first
                console.log(`Attempting to create MP3Tag instance (verbose mode)...`);
                mp3tag = new MP3Tag(buffer, true);
                console.log(`✅ MP3Tag instance created successfully`);
            } catch (error) {
                console.log(`❌ Failed to create MP3Tag instance:`, error.message);
                try {
                    // Fallback: try without verbose mode
                    console.log(`Attempting fallback: MP3Tag without verbose mode...`);
                    mp3tag = new MP3Tag(buffer, false);
                    console.log(`✅ MP3Tag instance created (fallback mode)`);
                } catch (fallbackError) {
                    console.log(`❌ Fallback also failed:`, fallbackError.message);
                    return { success: false, error: `Failed to parse M4A file: ${error.message}` };
                }
            }

            // Step 6: Read existing tags
            let existingTags = {};
            try {
                mp3tag.read();
                existingTags = { ...mp3tag.tags };
                console.log(`✅ Existing tags read:`, JSON.stringify(existingTags, null, 2));
            } catch (error) {
                console.log(`⚠️ Warning: Could not read existing tags:`, error.message);
                console.log(`Continuing with empty tag set...`);
            }

            // Step 7: Prepare new tags (only update provided fields)
            const newTags = { ...existingTags };
            let changesCount = 0;

            if (metadata.title !== undefined && metadata.title !== null) {
                const newTitle = metadata.title.trim();
                if (newTitle !== '' && newTitle !== existingTags.title) {
                    newTags.title = newTitle;
                    changesCount++;
                    console.log(`📝 Will update title: "${existingTags.title}" -> "${newTitle}"`);
                }
            }

            if (metadata.artist !== undefined && metadata.artist !== null) {
                const newArtist = metadata.artist.trim();
                if (newArtist !== '' && newArtist !== existingTags.artist) {
                    newTags.artist = newArtist;
                    changesCount++;
                    console.log(`📝 Will update artist: "${existingTags.artist}" -> "${newArtist}"`);
                }
            }

            if (metadata.album !== undefined && metadata.album !== null) {
                const newAlbum = metadata.album.trim();
                if (newAlbum !== '' && newAlbum !== existingTags.album) {
                    newTags.album = newAlbum;
                    changesCount++;
                    console.log(`📝 Will update album: "${existingTags.album}" -> "${newAlbum}"`);
                }
            }

            if (metadata.albumartist !== undefined && metadata.albumartist !== null) {
                const newAlbumArtist = metadata.albumartist.trim();
                if (newAlbumArtist !== '' && newAlbumArtist !== existingTags.albumartist) {
                    newTags.albumartist = newAlbumArtist;
                    changesCount++;
                    console.log(`📝 Will update albumartist: "${existingTags.albumartist}" -> "${newAlbumArtist}"`);
                }
            }

            if (metadata.year !== undefined && metadata.year !== null && metadata.year !== '') {
                const newYear = metadata.year.toString();
                if (newYear !== existingTags.year) {
                    newTags.year = newYear;
                    changesCount++;
                    console.log(`📝 Will update year: "${existingTags.year}" -> "${newYear}"`);
                }
            }

            if (metadata.track !== undefined && metadata.track !== null && metadata.track !== '') {
                const newTrack = metadata.track.toString();
                if (newTrack !== existingTags.track) {
                    newTags.track = newTrack;
                    changesCount++;
                    console.log(`📝 Will update track: "${existingTags.track}" -> "${newTrack}"`);
                }
            }

            if (metadata.genre !== undefined && metadata.genre !== null) {
                const newGenre = metadata.genre.trim();
                if (newGenre !== '' && newGenre !== existingTags.genre) {
                    newTags.genre = newGenre;
                    changesCount++;
                    console.log(`📝 Will update genre: "${existingTags.genre}" -> "${newGenre}"`);
                }
            }

            if (changesCount === 0) {
                console.log(`ℹ️ No changes needed - all metadata already matches`);
                return { success: true, error: null };
            }

            console.log(`📊 Total changes to make: ${changesCount}`);

            // Step 8: Apply the new tags
            try {
                mp3tag.tags = newTags;
                console.log(`✅ Tags assigned to MP3Tag instance`);
                console.log(`Final tag set:`, JSON.stringify(mp3tag.tags, null, 2));
            } catch (error) {
                console.log(`❌ Failed to assign tags:`, error.message);
                return { success: false, error: `Failed to assign tags: ${error.message}` };
            }

            // Step 9: Save tags to buffer
            try {
                mp3tag.save();
                console.log(`✅ Tags saved to buffer successfully`);
            } catch (error) {
                console.log(`❌ Failed to save tags to buffer:`, error.message);
                return { success: false, error: `Failed to save tags: ${error.message}` };
            }

            // Step 10: Create backup before writing
            const backupPath = filePath + '.backup.' + Date.now();
            try {
                await fs.copyFile(filePath, backupPath);
                console.log(`✅ Backup created: ${path.basename(backupPath)}`);
            } catch (error) {
                console.log(`⚠️ Warning: Could not create backup:`, error.message);
                console.log(`Proceeding without backup...`);
            }

            // Step 11: Write the modified buffer back to file
            try {
                await fs.writeFile(filePath, Buffer.from(mp3tag.buffer));
                console.log(`✅ File written successfully`);
                
                // Verify the write worked
                const newStats = await fs.stat(filePath);
                console.log(`✅ New file size: ${newStats.size} bytes (was ${fileStats.size})`);
                
                // Remove backup on success
                try {
                    await fs.unlink(backupPath);
                    console.log(`✅ Backup removed`);
                } catch (backupError) {
                    console.log(`⚠️ Could not remove backup (not critical):`, backupError.message);
                }
                
                console.log(`🎉 M4A metadata write completed successfully!`);
                return { success: true, error: null };
                
            } catch (writeError) {
                console.log(`❌ Failed to write file:`, writeError.message);
                
                // Try to restore from backup
                try {
                    await fs.copyFile(backupPath, filePath);
                    await fs.unlink(backupPath);
                    console.log(`✅ File restored from backup`);
                } catch (restoreError) {
                    console.log(`❌ Failed to restore from backup:`, restoreError.message);
                }
                
                return { 
                    success: false, 
                    error: `Failed to write file: ${writeError.message}`,
                    code: writeError.code
                };
            }

        } catch (error) {
            console.log(`❌ Unexpected error in M4A metadata write:`, error.message);
            console.log(`Stack trace:`, error.stack);
            return { success: false, error: `Unexpected error: ${error.message}` };
        } finally {
            console.log(`=== M4A METADATA WRITE END ===\n`);
        }
    }

    /**
     * Write metadata to file - automatically detects format
     */
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
            case '.aac':
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
