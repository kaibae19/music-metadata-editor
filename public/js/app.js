// File: public/js/app.js
// Music Metadata Editor Frontend - FOR public/js/app.js ONLY

// Theme Management
class ThemeManager {
    constructor() {
        this.theme = this.getStoredTheme() || 'dark'; // Default to dark
        this.init();
    }

    init() {
        this.applyTheme(this.theme);
        this.setupToggle();
    }

    getStoredTheme() {
        try {
            return localStorage.getItem('music-editor-theme');
        } catch (e) {
            return null;
        }
    }

    setStoredTheme(theme) {
        try {
            localStorage.setItem('music-editor-theme', theme);
        } catch (e) {
            // localStorage not available, continue anyway
        }
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.updateToggleButton(theme);
        this.setStoredTheme(theme);
    }

    updateToggleButton(theme) {
        const themeIcon = document.getElementById('themeIcon');
        const themeText = document.getElementById('themeText');
        
        if (themeIcon && themeText) {
            if (theme === 'light') {
                themeIcon.textContent = '☀️';
                themeText.textContent = 'Light';
            } else {
                themeIcon.textContent = '🌙';
                themeText.textContent = 'Dark';
            }
        }
    }

    setupToggle() {
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.theme = this.theme === 'dark' ? 'light' : 'dark';
                this.applyTheme(this.theme);
            });
        }
    }

    toggle() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(this.theme);
    }
}

class MetadataEditor {
    constructor() {
        this.currentPath = '';
        this.selectedFile = null;
        this.selectedItems = new Set();
        this.originalMetadata = null;
        this.scrollPositions = new Map();

        // Initialize theme manager first
        this.themeManager = new ThemeManager();

        this.initializeElements();
        this.setupEventListeners();
        this.loadFiles();
    }

    initializeElements() {
        this.fileList = document.getElementById('fileList');
        this.breadcrumb = document.getElementById('breadcrumb');
        this.selectionInfo = document.getElementById('selectionInfo');
        this.fileInfo = document.getElementById('fileInfo');
        this.metadataForm = document.getElementById('metadataForm');
        this.placeholder = document.getElementById('placeholder');
        this.statusBar = document.getElementById('statusBar');

        this.titleInput = document.getElementById('title');
        this.artistInput = document.getElementById('artist');
        this.albumInput = document.getElementById('album');
        this.albumartistInput = document.getElementById('albumartist');
        this.yearInput = document.getElementById('year');
        this.trackInput = document.getElementById('track');
        this.genreInput = document.getElementById('genre');

        this.saveBtn = document.getElementById('saveBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.clearSelectionBtn = document.getElementById('clearSelectionBtn');
        this.batchActions = document.getElementById('batchActions');

        this.contextMenu = document.getElementById('contextMenu');
        this.contextRename = document.getElementById('contextRename');
        this.contextDelete = document.getElementById('contextDelete');
        this.contextBatchDelete = document.getElementById('contextBatchDelete');
        this.contextSeparator = document.getElementById('contextSeparator');

        this.contextTarget = null;
    }

    setupEventListeners() {
        this.saveBtn.addEventListener('click', () => this.saveMetadata());
        this.resetBtn.addEventListener('click', () => this.resetForm());
        this.clearSelectionBtn.addEventListener('click', () => this.clearSelection());

        this.contextRename.addEventListener('click', () => this.handleContextRename());
        this.contextDelete.addEventListener('click', () => this.handleContextDelete());
        this.contextBatchDelete.addEventListener('click', () => this.deleteItems());

        document.addEventListener('click', () => this.hideContextMenu());
        document.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.file-item') && !e.target.classList.contains('breadcrumb-part')) {
                this.hideContextMenu();
            }
        });

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

            if (this.currentPath) {
                this.scrollPositions.set(this.currentPath, this.fileList.scrollTop);
            }

            const response = await fetch('/api/files?path=' + encodeURIComponent(path));
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load files');
            }

            this.currentPath = data.currentPath;
            this.renderFileList(data.items);
            this.updateBreadcrumb();

            const savedPosition = this.scrollPositions.get(this.currentPath);
            if (savedPosition !== undefined) {
                setTimeout(() => {
                    this.fileList.scrollTop = savedPosition;
                }, 0);
            } else {
                this.fileList.scrollTop = 0;
            }

            this.setStatus('Loaded ' + data.items.length + ' items', 'success');

        } catch (error) {
            console.error('Error loading files:', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    renderFileList(items) {
        let html = '';

        if (this.currentPath && this.currentPath !== '/music' && this.currentPath !== '') {
            html += '<div class="file-item parent" data-path=".." data-type="parent"><span class="file-name">..</span></div>';
        }

        if (items.length === 0 && (!this.currentPath || this.currentPath === '/music' || this.currentPath === '')) {
            this.fileList.innerHTML = '<div class="loading">No audio files found in this directory</div>';
            return;
        }

        html += items.map(item =>
            '<div class="file-item ' + item.type + '" data-path="' + item.path + '" data-type="' + item.type + '">' +
            '<span class="file-name">' + item.name + '</span>' +
            (item.extension ? '<span class="file-extension">' + item.extension.substring(1) + '</span>' : '') +
            '</div>'
        ).join('');

        if (items.length === 0) {
            html += '<div class="loading">No audio files found in this directory</div>';
        }

        this.fileList.innerHTML = html;

        this.fileList.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', (e) => this.handleFileClick(item, e));
            item.addEventListener('contextmenu', (e) => this.handleContextMenu(item, e));
        });
    }

    handleFileClick(element, event) {
        const path = element.dataset.path;
        const type = element.dataset.type;

        if (event.ctrlKey || event.metaKey) {
            if (type === 'parent') return;
            this.toggleSelection(element, path, type);
            return;
        }

        const hadSelections = this.selectedItems.size > 0;
        this.clearSelection();

        if (type === 'parent') {
            if (!hadSelections) {
                this.goBack();
            }
        } else if (type === 'directory') {
            if (!hadSelections) {
                this.loadFiles(path);
            }
        } else if (type === 'file') {
            this.selectSingleFile(element, path);
        }
    }

    toggleSelection(element, path, type) {
        const itemKey = type + ':' + path;

        if (this.selectedItems.has(itemKey)) {
            this.selectedItems.delete(itemKey);
            element.classList.remove('multi-selected');
        } else {
            this.selectedItems.add(itemKey);
            element.classList.add('multi-selected');
        }

        this.updateSelectionUI();
    }

    clearSelection() {
        this.selectedItems.clear();
        this.fileList.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('multi-selected', 'selected');
        });
        this.updateSelectionUI();

        this.selectedFile = null;
        this.metadataForm.style.display = 'none';
        this.placeholder.style.display = 'flex';
    }

    updateSelectionUI() {
        const count = this.selectedItems.size;

        if (count === 0) {
            this.selectionInfo.classList.add('hidden');
            this.selectionInfo.textContent = '';
            this.batchActions.style.display = 'none';
            return;
        }

        this.selectionInfo.classList.remove('hidden');
        this.selectionInfo.textContent = count + ' item' + (count > 1 ? 's' : '') + ' selected';
        this.batchActions.style.display = 'block';

        const selectedFiles = Array.from(this.selectedItems).filter(item => item.startsWith('file:'));
        if (selectedFiles.length > 0 && selectedFiles.length === count) {
            this.loadBatchMetadata(selectedFiles.map(item => item.substring(5)));
        } else {
            this.metadataForm.style.display = 'none';
            this.placeholder.style.display = 'flex';
        }
    }

    async selectSingleFile(element, path) {
        this.clearSelection();

        this.fileList.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('selected');
        });
        element.classList.add('selected');

        this.selectedFile = path;
        this.setStatus('Loading metadata...', 'info');

        try {
            const response = await fetch('/api/metadata/' + encodeURIComponent(path));
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
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    async loadBatchMetadata(filePaths) {
        this.setStatus('Loading metadata for selected files...', 'info');

        try {
            const metadataPromises = filePaths.map(async (filePath) => {
                const response = await fetch('/api/metadata/' + encodeURIComponent(filePath));
                const data = await response.json();
                return response.ok ? data.common : null;
            });

            const metadataResults = await Promise.all(metadataPromises);
            const validMetadata = metadataResults.filter(m => m !== null);

            if (validMetadata.length === 0) {
                throw new Error('Could not load metadata for any selected files');
            }

            const commonMetadata = this.findCommonMetadata(validMetadata);

            this.originalMetadata = commonMetadata;
            this.populateBatchForm(commonMetadata, filePaths.length);
            this.showMetadataForm();
            this.setStatus('Loaded metadata for ' + validMetadata.length + ' files', 'success');

        } catch (error) {
            console.error('Error loading batch metadata:', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    findCommonMetadata(metadataArray) {
        if (metadataArray.length === 0) return {};
        if (metadataArray.length === 1) return metadataArray[0];

        const common = {};
        const fields = ['artist', 'album', 'albumartist', 'year', 'genre'];

        fields.forEach(field => {
            const firstValue = metadataArray[0][field];
            const allSame = metadataArray.every(meta => meta[field] === firstValue);
            if (allSame && firstValue) {
                common[field] = firstValue;
            }
        });

        return common;
    }

    populateBatchForm(commonMetadata, fileCount) {
        this.fileInfo.textContent = 'Editing ' + fileCount + ' files (showing common values)';

        this.titleInput.value = '';
        this.trackInput.value = '';
        this.artistInput.value = commonMetadata.artist || '';
        this.albumInput.value = commonMetadata.album || '';
        this.albumartistInput.value = commonMetadata.albumartist || '';
        this.yearInput.value = commonMetadata.year || '';
        this.genreInput.value = commonMetadata.genre || '';

        this.titleInput.disabled = true;
        this.trackInput.disabled = true;

        this.titleInput.placeholder = 'Individual titles (not editable in batch mode)';
        this.trackInput.placeholder = 'Individual track numbers (not editable in batch mode)';
    }

    populateForm(data) {
        this.fileInfo.textContent = 'Editing: ' + data.filename;

        this.titleInput.value = data.common.title || '';
        this.artistInput.value = data.common.artist || '';
        this.albumInput.value = data.common.album || '';
        this.albumartistInput.value = data.common.albumartist || '';
        this.yearInput.value = data.common.year || '';
        this.trackInput.value = data.common.track || '';
        this.genreInput.value = data.common.genre || '';

        this.titleInput.disabled = false;
        this.trackInput.disabled = false;
        this.titleInput.placeholder = '';
        this.trackInput.placeholder = '';
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
        const metadata = {
            title: this.titleInput.value.trim(),
            artist: this.artistInput.value.trim(),
            album: this.albumInput.value.trim(),
            albumartist: this.albumartistInput.value.trim(),
            year: this.yearInput.value ? parseInt(this.yearInput.value) : null,
            track: this.trackInput.value ? parseInt(this.trackInput.value) : null,
            genre: this.genreInput.value.trim()
        };

        if (this.selectedItems.size > 0) {
            return this.saveBatchMetadata(metadata);
        }

        if (!this.selectedFile) return;

        this.saveBtn.disabled = true;
        this.setStatus('Saving metadata...', 'info');

        try {
            const response = await fetch('/api/metadata/' + encodeURIComponent(this.selectedFile), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ metadata })
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 403 && data.code === 'PERMISSION_DENIED') {
                    this.setStatus('⚠️ File system is read-only - cannot save changes. Remove read-only flag to enable writing.', 'error');
                } else if (response.status === 400 && data.code === 'UNSUPPORTED_FORMAT') {
                    this.setStatus('⚠️ ' + data.error, 'error');
                } else {
                    throw new Error(data.error || 'Failed to save metadata');
                }
                return;
            }

            this.originalMetadata = Object.assign({}, metadata);
            this.setStatus('✅ ' + (data.message || 'Metadata saved successfully'), 'success');

        } catch (error) {
            console.error('Error saving metadata:', error);
            this.setStatus('❌ Error: ' + error.message, 'error');
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    async saveBatchMetadata(metadata) {
        const selectedFiles = Array.from(this.selectedItems)
            .filter(item => item.startsWith('file:'))
            .map(item => item.substring(5));

        if (selectedFiles.length === 0) {
            this.setStatus('No files selected for batch update', 'error');
            return;
        }

        this.saveBtn.disabled = true;
        this.setStatus('Saving metadata for ' + selectedFiles.length + ' files...', 'info');

        try {
            const batchMetadata = {};
            Object.keys(metadata).forEach(key => {
                if (metadata[key] !== '' && metadata[key] !== null && !this[key + 'Input'].disabled) {
                    batchMetadata[key] = metadata[key];
                }
            });

            const response = await fetch('/api/metadata/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filePaths: selectedFiles,
                    metadata: batchMetadata
                })
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 403) {
                    this.setStatus('⚠️ File system is read-only - cannot save changes. Remove read-only flag to enable writing.', 'error');
                } else {
                    throw new Error(data.error || 'Failed to save batch metadata');
                }
                return;
            }

            // Handle partial success scenarios
            if (data.code === 'SOME_PERMISSION_DENIED') {
                this.setStatus(`⚠️ ${data.message}`, 'warning');
            } else if (data.successCount === data.totalFiles) {
                this.setStatus(`✅ ${data.message}`, 'success');
            } else if (data.successCount > 0) {
                this.setStatus(`⚠️ ${data.message}`, 'warning');
            } else {
                this.setStatus(`❌ ${data.message}`, 'error');
            }

            // Log detailed results for debugging
            if (data.results && data.results.length > 0) {
                const failures = data.results.filter(r => !r.success);
                if (failures.length > 0) {
                    console.warn('Some files failed to update:', failures);
                }
            }

        } catch (error) {
            console.error('Error saving batch metadata:', error);
            this.setStatus('❌ Error: ' + error.message, 'error');
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    updateBreadcrumb() {
        if (!this.currentPath || this.currentPath === '/music' || this.currentPath === '') {
            this.breadcrumb.innerHTML = 'Music Library';
        } else {
            const parts = this.currentPath.split('/').filter(p => p && p !== 'music');

            let breadcrumbHtml = '<span class="breadcrumb-part" data-path="" data-type="root">Music Library</span>';

            let currentPath = '';
            for (let i = 0; i < parts.length; i++) {
                currentPath += (currentPath ? '/' : '') + parts[i];
                breadcrumbHtml += ' <span class="breadcrumb-separator">></span> ';
                breadcrumbHtml += '<span class="breadcrumb-part" data-path="' + currentPath + '" data-type="directory">' + parts[i] + '</span>';
            }

            this.breadcrumb.innerHTML = breadcrumbHtml;

            this.breadcrumb.querySelectorAll('.breadcrumb-part').forEach(part => {
                part.addEventListener('click', () => {
                    const targetPath = part.dataset.path;
                    this.loadFiles(targetPath);
                });

                part.addEventListener('contextmenu', (e) => {
                    this.handleBreadcrumbContextMenu(part, e);
                });
            });
        }
    }

    goBack() {
        if (!this.currentPath || this.currentPath === '/music' || this.currentPath === '') {
            return; // Already at root
        }

        console.log('Going back from current path:', this.currentPath);

        // Split path and remove empty parts
        const pathParts = this.currentPath.split('/').filter(p => p && p !== 'music');
        console.log('Path parts:', pathParts);
        
        // Remove the last part to go up one level
        pathParts.pop();
        console.log('After pop:', pathParts);

        // If no parts left, go to root
        if (pathParts.length === 0) {
            console.log('Going to root');
            this.loadFiles('');
        } else {
            // Reconstruct the parent path
            const parentPath = pathParts.join('/');
            console.log('Going to parent path:', parentPath);
            this.loadFiles(parentPath);
        }
    }

    setStatus(message, type = 'info') {
        this.statusBar.textContent = message;
        this.statusBar.className = 'status-bar ' + type;

        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                this.statusBar.textContent = 'Ready - Select a music file to begin';
                this.statusBar.className = 'status-bar';
            }, 3000);
        }
    }

    async renameSingleItem(itemPath, type) {
        console.log('renameSingleItem called with:', itemPath, type);
        console.log('Current directory path:', this.currentPath);

        const currentName = itemPath.split('/').pop();
        const newName = prompt('Enter new ' + type + ' name:', currentName);

        if (!newName || newName === currentName) return;

        this.setStatus('Renaming ' + type + '...', 'info');

        try {
            const endpoint = type === 'directory' ? '/api/directory/rename' : '/api/file/rename';
            const requestBody = {
                oldPath: itemPath,
                newName: newName
            };

            console.log('Rename request endpoint:', endpoint);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            console.log('Rename response status:', response.status);

            if (!response.ok) {
                throw new Error(data.error || 'Failed to rename ' + type);
            }

            this.setStatus(type + ' renamed successfully', 'success');

            if (type === 'directory') {
                const oldFullPath = this.currentPath;
                console.log('Checking path update for directory rename');
                console.log('Current path:', oldFullPath);
                console.log('Renamed directory:', currentName);
                console.log('New name:', newName);

                if (oldFullPath) {
                    let updatedPath = null;
                    
                    if (oldFullPath === currentName) {
                        updatedPath = newName;
                        console.log('Exact match - updating to:', updatedPath);
                    }
                    else if (oldFullPath.endsWith('/' + currentName)) {
                        updatedPath = oldFullPath.substring(0, oldFullPath.length - currentName.length) + newName;
                        console.log('End match - updating to:', updatedPath);
                    }
                    else if (oldFullPath.includes('/' + currentName + '/')) {
                        updatedPath = oldFullPath.replace('/' + currentName + '/', '/' + newName + '/');
                        console.log('Middle match - updating to:', updatedPath);
                    }
                    else if (oldFullPath.startsWith(currentName + '/')) {
                        updatedPath = newName + oldFullPath.substring(currentName.length);
                        console.log('Start match - updating to:', updatedPath);
                    }
                    
                    if (updatedPath) {
                        this.currentPath = updatedPath;
                        console.log('Path updated from', oldFullPath, 'to', updatedPath);
                    }
                }
            }

            this.clearSelection();
            this.loadFiles(this.currentPath);

        } catch (error) {
            console.error('Error renaming ' + type + ':', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    async deleteItems() {
        if (this.selectedItems.size > 0) {
            return this.batchDelete();
        } else if (this.selectedFile) {
            return this.deleteSingleFile();
        }

        this.setStatus('Select items to delete', 'error');
    }

    async batchDelete() {
        const items = Array.from(this.selectedItems).map(itemKey => {
            const parts = itemKey.split(':');
            return { type: parts[0], path: parts[1] };
        });

        const directories = items.filter(item => item.type === 'directory');
        const files = items.filter(item => item.type === 'file');

        let warningMessage = '';

        if (directories.length > 0) {
            warningMessage = 'DANGER: Batch Delete with Directories\n\n' +
                           'You are about to PERMANENTLY DELETE:\n' +
                           '• ' + files.length + ' files\n' +
                           '• ' + directories.length + ' directories (and ALL their contents)\n\n' +
                           'Directories to be deleted:\n' +
                           directories.map(d => '  • ' + d.path.split('/').pop()).join('\n') + '\n\n' +
                           'This will delete ALL music files, subdirectories,\n' +
                           'and metadata in these directories.\n\n' +
                           'THIS CANNOT BE UNDONE!\n\n' +
                           'Type "DELETE ALL" (all caps) to confirm:';

            const confirmation = prompt(warningMessage);

            if (confirmation !== 'DELETE ALL') {
                this.setStatus('Batch deletion cancelled', 'info');
                return;
            }
        } else {
            const itemNames = items.map(item => item.path.split('/').pop()).join(', ');

            if (!confirm('Are you sure you want to delete these ' + items.length + ' files?\n\n' + itemNames + '\n\nThis action cannot be undone.')) {
                return;
            }
        }

        this.setStatus('Deleting ' + items.length + ' items...', 'info');

        try {
            const response = await fetch('/api/batch/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ items })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete items');
            }

            this.setStatus(data.message || 'Items deleted successfully', 'success');

            if (data.errors && data.errors.length > 0) {
                console.warn('Some items had errors:', data.errors);
            }

            this.clearSelection();
            this.loadFiles(this.currentPath);

        } catch (error) {
            console.error('Error deleting items:', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    async deleteSingleFile() {
        const fileName = this.selectedFile.split('/').pop();

        if (!confirm('Are you sure you want to delete "' + fileName + '"?\n\nThis action cannot be undone.')) {
            return;
        }

        this.setStatus('Deleting file...', 'info');

        try {
            const response = await fetch('/api/file/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filePath: this.selectedFile
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete file');
            }

            this.setStatus('File deleted successfully', 'success');

            this.selectedFile = null;
            this.metadataForm.style.display = 'none';
            this.placeholder.style.display = 'flex';
            this.loadFiles(this.currentPath);

        } catch (error) {
            console.error('Error deleting file:', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    handleContextMenu(element, event) {
        event.preventDefault();

        const path = element.dataset.path;
        const type = element.dataset.type;

        if (type === 'parent') {
            return;
        }

        this.contextTarget = { element, path, type };

        this.contextRename.style.display = 'block';

        if (this.selectedItems.size > 1) {
            this.contextDelete.style.display = 'none';
            this.contextBatchDelete.style.display = 'block';
            this.contextSeparator.style.display = 'block';
        } else {
            this.contextDelete.style.display = 'block';
            this.contextBatchDelete.style.display = 'none';
            this.contextSeparator.style.display = 'none';
        }

        this.contextMenu.style.left = event.pageX + 'px';
        this.contextMenu.style.top = event.pageY + 'px';
        this.contextMenu.style.display = 'block';

        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.contextMenu.style.left = (event.pageX - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            this.contextMenu.style.top = (event.pageY - rect.height) + 'px';
        }
    }

    hideContextMenu() {
        this.contextMenu.style.display = 'none';
        this.contextTarget = null;
    }

    handleContextRename() {
        console.log('handleContextRename called');
        console.log('contextTarget:', this.contextTarget);

        const target = this.contextTarget;
        this.hideContextMenu();

        if (target) {
            console.log('Calling renameSingleItem with:', target.path, target.type);
            this.renameSingleItem(target.path, target.type);
        } else {
            console.log('No contextTarget found for rename!');
        }
    }

    handleContextDelete() {
        console.log('handleContextDelete called');
        console.log('contextTarget:', this.contextTarget);

        const target = this.contextTarget;
        this.hideContextMenu();

        if (target) {
            console.log('Context target type:', target.type);
            console.log('Context target path:', target.path);

            if (target.type === 'directory') {
                console.log('Calling deleteSingleDirectory');
                this.deleteSingleDirectory(target.path);
            } else {
                console.log('Calling deleteSingleFileByPath');
                this.deleteSingleFileByPath(target.path);
            }
        } else {
            console.log('No contextTarget found!');
        }
    }

    async deleteSingleDirectory(dirPath) {
        console.log('deleteSingleDirectory called with path:', dirPath);

        const dirName = dirPath.split('/').pop();

        const warning = 'DANGER: Delete Directory\n\n' +
                       'You are about to PERMANENTLY DELETE:\n' +
                       '"' + dirName + '" and ALL files/folders inside it.\n\n' +
                       'This will delete:\n' +
                       '• All music files in this directory\n' +
                       '• All subdirectories and their contents\n' +
                       '• ALL metadata and file organization\n\n' +
                       'THIS CANNOT BE UNDONE!\n\n' +
                       'Type "DELETE" (all caps) to confirm:';

        const confirmation = prompt(warning);
        console.log('User confirmation:', confirmation);

        if (confirmation !== 'DELETE') {
            this.setStatus('Directory deletion cancelled', 'info');
            return;
        }

        this.setStatus('Deleting directory...', 'info');

        try {
            console.log('Sending delete request for:', dirPath);
            const response = await fetch('/api/directory/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    dirPath: dirPath
                })
            });

            console.log('Delete response status:', response.status);
            const data = await response.json();
            console.log('Delete response data:', data);

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete directory');
            }

            this.setStatus('Directory deleted successfully', 'success');
            this.loadFiles(this.currentPath);

        } catch (error) {
            console.error('Error deleting directory:', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    async deleteSingleFileByPath(filePath) {
        console.log('deleteSingleFileByPath called with path:', filePath);

        const fileName = filePath.split('/').pop();

        if (!confirm('Are you sure you want to delete "' + fileName + '"?\n\nThis action cannot be undone.')) {
            console.log('User cancelled file deletion');
            return;
        }

        this.setStatus('Deleting file...', 'info');

        try {
            console.log('Sending delete request for file:', filePath);
            const response = await fetch('/api/file/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filePath: filePath
                })
            });

            console.log('File delete response status:', response.status);
            const data = await response.json();
            console.log('File delete response data:', data);

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete file');
            }

            this.setStatus('File deleted successfully', 'success');
            this.loadFiles(this.currentPath);

        } catch (error) {
            console.error('Error deleting file:', error);
            this.setStatus('Error: ' + error.message, 'error');
        }
    }

    handleBreadcrumbContextMenu(element, event) {
        event.preventDefault();

        const path = element.dataset.path;
        const type = element.dataset.type;

        console.log('Breadcrumb context menu - path:', path, 'type:', type);

        if (type === 'root' || path === '' || path === '/music') {
            return;
        }

        let cleanPath = path;
        if (path && path.startsWith('/')) {
            cleanPath = path.substring(1);
        }

        console.log('Setting contextTarget with cleanPath:', cleanPath);
        this.contextTarget = { element, path: cleanPath, type: 'directory' };

        this.contextRename.style.display = 'block';
        this.contextDelete.style.display = 'block';
        this.contextBatchDelete.style.display = 'none';
        this.contextSeparator.style.display = 'none';

        this.contextMenu.style.left = event.pageX + 'px';
        this.contextMenu.style.top = event.pageY + 'px';
        this.contextMenu.style.display = 'block';

        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.contextMenu.style.left = (event.pageX - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            this.contextMenu.style.top = (event.pageY - rect.height) + 'px';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MetadataEditor();
});
