// Music Metadata Editor Frontend

class MetadataEditor {
    constructor() {
        this.currentPath = '';
        this.selectedFile = null;
        this.originalMetadata = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadFiles();
    }

    initializeElements() {
        this.fileList = document.getElementById('fileList');
        this.breadcrumb = document.getElementById('breadcrumb');
        this.fileInfo = document.getElementById('fileInfo');
        this.metadataForm = document.getElementById('metadataForm');
        this.placeholder = document.getElementById('placeholder');
        this.statusBar = document.getElementById('statusBar');
        
        // Form elements
        this.titleInput = document.getElementById('title');
        this.artistInput = document.getElementById('artist');
        this.albumInput = document.getElementById('album');
        this.albumartistInput = document.getElementById('albumartist');
        this.yearInput = document.getElementById('year');
        this.trackInput = document.getElementById('track');
        this.genreInput = document.getElementById('genre');
        
        this.saveBtn = document.getElementById('saveBtn');
        this.resetBtn = document.getElementById('resetBtn');
    }

    setupEventListeners() {
        this.saveBtn.addEventListener('click', () => this.saveMetadata());
        this.resetBtn.addEventListener('click', () => this.resetForm());
        
        // Auto-save on Enter key in form fields
        [this.titleInput, this.artistInput, this.albumInput, this.albumartistInput, 
         this.yearInput, this.trackInput, this.genreInput].forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveMetadata();
                }
            });
        });
    }

    async loadFiles(path = '') {
        try {
            this.setStatus('Loading files...', 'info');
            
            const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load files');
            }
            
            this.currentPath = data.currentPath;
            this.renderFileList(data.items);
            this.updateBreadcrumb();
            this.setStatus(`Loaded ${data.items.length} items`, 'success');
            
        } catch (error) {
            console.error('Error loading files:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        }
    }

    renderFileList(items) {
        if (items.length === 0) {
            this.fileList.innerHTML = '<div class="loading">No audio files found in this directory</div>';
            return;
        }

        const html = items.map(item => `
            <div class="file-item ${item.type}" data-path="${item.path}" data-type="${item.type}">
                <span class="file-name">${item.name}</span>
                ${item.extension ? `<span class="file-extension">${item.extension.substring(1)}</span>` : ''}
            </div>
        `).join('');

        this.fileList.innerHTML = html;

        // Add click listeners
        this.fileList.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => this.handleFileClick(item));
        });
    }

    handleFileClick(element) {
        const path = element.dataset.path;
        const type = element.dataset.type;

        if (type === 'directory') {
            this.loadFiles(path);
        } else if (type === 'file') {
            this.selectFile(element, path);
        }
    }

    async selectFile(element, path) {
        // Update UI selection
        this.fileList.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('selected');
        });
        element.classList.add('selected');

        this.selectedFile = path;
        this.setStatus('Loading metadata...', 'info');

        try {
            const response = await fetch(`/api/metadata/${encodeURIComponent(path)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load metadata');
            }

            this.originalMetadata = data.common;
            this.populateForm(data);
            this.showMetadataForm();
            this.setStatus('Metadata loaded successfully', 'success');

        } catch (error) {
            console.error('Error loading metadata:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        }
    }

    populateForm(data) {
        this.fileInfo.textContent = `Editing: ${data.filename}`;
        
        this.titleInput.value = data.common.title || '';
        this.artistInput.value = data.common.artist || '';
        this.albumInput.value = data.common.album || '';
        this.albumartistInput.value = data.common.albumartist || '';
        this.yearInput.value = data.common.year || '';
        this.trackInput.value = data.common.track || '';
        this.genreInput.value = data.common.genre || '';
    }

    showMetadataForm() {
        this.placeholder.style.display = 'none';
        this.metadataForm.style.display = 'flex';
    }

    resetForm() {
        if (this.originalMetadata) {
            this.titleInput.value = this.originalMetadata.title || '';
            this.artistInput.value = this.originalMetadata.artist || '';
            this.albumInput.value = this.originalMetadata.album || '';
            this.albumartistInput.value = this.originalMetadata.albumartist || '';
            this.yearInput.value = this.originalMetadata.year || '';
            this.trackInput.value = this.originalMetadata.track || '';
            this.genreInput.value = this.originalMetadata.genre || '';
            
            this.setStatus('Form reset to original values', 'info');
        }
    }

    async saveMetadata() {
        if (!this.selectedFile) return;

        this.saveBtn.disabled = true;
        this.setStatus('Saving metadata...', 'info');

        const metadata = {
            title: this.titleInput.value.trim(),
            artist: this.artistInput.value.trim(),
            album: this.albumInput.value.trim(),
            albumartist: this.albumartistInput.value.trim(),
            year: this.yearInput.value ? parseInt(this.yearInput.value) : null,
            track: this.trackInput.value ? parseInt(this.trackInput.value) : null,
            genre: this.genreInput.value.trim()
        };

        try {
            const response = await fetch(`/api/metadata/${encodeURIComponent(this.selectedFile)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ metadata })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save metadata');
            }

            this.originalMetadata = { ...metadata };
            this.setStatus(data.message || 'Metadata saved successfully', 'success');

        } catch (error) {
            console.error('Error saving metadata:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    updateBreadcrumb() {
        if (!this.currentPath || this.currentPath === '/music') {
            this.breadcrumb.textContent = 'Music Library';
        } else {
            const parts = this.currentPath.split('/').filter(p => p);
            this.breadcrumb.textContent = parts.join(' > ');
        }
    }

    setStatus(message, type = 'info') {
        this.statusBar.textContent = message;
        this.statusBar.className = `status-bar ${type}`;
        
        // Auto-clear status after 3 seconds for success/info messages
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                this.statusBar.textContent = 'Ready - Select a music file to begin';
                this.statusBar.className = 'status-bar';
            }, 3000);
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MetadataEditor();
});
