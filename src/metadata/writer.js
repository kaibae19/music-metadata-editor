// File: src/metadata/writer.js
const path = require('path');
const fs = require('fs').promises;
const NodeID3 = require('node-id3');
const Metaflac = require('metaflac-js2');
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
     * Write metadata to FLAC file using metaflac-js2
     */
    async writeFLACMetadata(filePath, metadata) {
        try {
            const flac = new Metaflac(filePath);
            
            // Update tags - only set if value is provided and not null
            if (metadata.title !== undefined) {
                if (metadata.title) {
                    flac.setTag(`TITLE=${metadata.title}`);
                } else {
                    flac.removeTag('TITLE');
                }
            }
            if (metadata.artist !== undefined) {
                if (metadata.artist) {
                    flac.setTag(`ARTIST=${metadata.artist}`);
                } else {
                    flac.removeTag('ARTIST');
                }
            }
            if (metadata.album !== undefined) {
                if (metadata.album) {
                    flac.setTag(`ALBUM=${metadata.album}`);
                } else {
                    flac.removeTag('ALBUM');
                }
            }
            if (metadata.albumartist !== undefined) {
                if (metadata.albumartist) {
                    flac.setTag(`ALBUMARTIST=${metadata.albumartist}`);
                } else {
                    flac.removeTag('ALBUMARTIST');
                }
            }
            if (metadata.year !== undefined) {
                if (metadata.year) {
                    flac.setTag(`DATE=${metadata.year}`);
                } else {
                    flac.removeTag('DATE');
                }
            }
            if (metadata.track !== undefined) {
                if (metadata.track) {
                    flac.setTag(`TRACKNUMBER=${metadata.track}`);
                } else {
                    flac.removeTag('TRACKNUMBER');
                }
            }
            if (metadata.genre !== undefined) {
                if (metadata.genre) {
                    flac.setTag(`GENRE=${metadata.genre}`);
                } else {
                    flac.removeTag('GENRE');
                }
            }

            // Save the changes
            flac.save();

            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Write metadata to MP4/M4A file using mp3tag.js
     */
    async writeMP4Metadata(filePath, metadata) {
        try {
            // Read the file
            const buffer = await fs.readFile(filePath);
            const mp3tag = new MP3Tag(buffer, true); // verbose mode

            // Read existing tags
            mp3tag.read();

            // Update tags - only set if value is provided
            if (metadata.title !== undefined) {
                mp3tag.tags.title = metadata.title || '';
            }
            if (metadata.artist !== undefined) {
                mp3tag.tags.artist = metadata.artist || '';
            }
            if (metadata.album !== undefined) {
                mp3tag.tags.album = metadata.album || '';
            }
            if (metadata.albumartist !== undefined) {
                mp3tag.tags.albumartist = metadata.albumartist || '';
            }
            if (metadata.year !== undefined) {
                mp3tag.tags.year = metadata.year ? metadata.year.toString() : '';
            }
            if (metadata.track !== undefined) {
                mp3tag.tags.track = metadata.track ? metadata.track.toString() : '';
            }
            if (metadata.genre !== undefined) {
                mp3tag.tags.genre = metadata.genre || '';
            }

            // Save the changes
            mp3tag.save();
            
            // Write back to file
            await fs.writeFile(filePath, Buffer.from(mp3tag.buffer));

            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: error.message };
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
