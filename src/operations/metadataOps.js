const path = require('path');
const fs = require('fs').promises;

const metadataOps = {
  // Update metadata for single file
  async updateSingleMetadata(req, res, MUSIC_DIR) {
    try {
      const filePath = path.resolve(MUSIC_DIR, req.params.path);
      
      if (!filePath.startsWith(path.resolve(MUSIC_DIR))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { metadata } = req.body;
      
      // This is a placeholder - actual metadata writing depends on file format
      console.log('Would update metadata for:', filePath);
      console.log('New metadata:', metadata);
      
      // TODO: Implement actual metadata writing using appropriate library
      // Different libraries needed for different formats:
      // - node-id3 for MP3
      // - flac-metadata for FLAC  
      // - mp4-tag for MP4/M4A/AAC
      
      res.json({ 
        success: true, 
        message: 'Metadata updated successfully',
        note: 'Writing functionality to be implemented'
      });
      
    } catch (error) {
      console.error('Error updating metadata:', error);
      res.status(500).json({ error: 'Failed to update metadata' });
    }
  },

  // Batch metadata update
  async updateBatchMetadata(req, res, MUSIC_DIR) {
    try {
      const { filePaths, metadata } = req.body;
      
      if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid filePaths array' });
      }

      if (!metadata || typeof metadata !== 'object') {
        return res.status(400).json({ error: 'Missing metadata object' });
      }

      const results = [];
      const errors = [];

      for (const filePath of filePaths) {
        try {
          const fullPath = path.resolve(MUSIC_DIR, filePath);
          
          // Security check
          if (!fullPath.startsWith(path.resolve(MUSIC_DIR))) {
            errors.push({ file: filePath, error: 'Access denied' });
            continue;
          }

          // Check if file exists
          await fs.access(fullPath);
          
          // TODO: Implement actual metadata writing
          console.log('Would update metadata for:', fullPath);
          console.log('New metadata:', metadata);
          
          results.push({ file: filePath, success: true });
          
        } catch (error) {
          errors.push({ file: filePath, error: error.message });
        }
      }

      res.json({
        success: errors.length === 0,
        message: `Updated ${results.length} files${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
        results,
        errors,
        note: 'Batch metadata writing functionality to be implemented'
      });

    } catch (error) {
      console.error('Error in batch metadata update:', error);
      res.status(500).json({ error: 'Failed to update batch metadata' });
    }
  }
};

module.exports = metadataOps;
