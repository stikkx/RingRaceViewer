// Popup script for LiveTiming Extension
class PopupManager {
    constructor() {
        this.settings = {
            darkTheme: true,
            themeStyle: 'dark',
            beepOnNewLap: true,
            refreshInterval: 5000,
            popupTimer: 5,
            autoClosePopup: true,
            enabled: true
        };
        
        this.init();
    }

    async init() {
        // Load current settings
        await this.loadSettings();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Update UI with current settings
        this.updateUI();
        
        // Check if we're on a supported page
        await this.checkPageSupport();
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get([
                'darkTheme', 
                'themeStyle',
                'beepOnNewLap', 
                'refreshInterval',
                'popupTimer',
                'autoClosePopup',
                'enabled'
            ]);
            
            this.settings = { ...this.settings, ...result };
        } catch (error) {
            console.log('Error loading settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set(this.settings);
            this.showStatus('Settings saved successfully!', 'success');
        } catch (error) {
            this.showStatus('Error saving settings', 'error');
            console.log('Error saving settings:', error);
        }
    }

    setupEventListeners() {
        // Dark theme toggle
        document.getElementById('darkTheme').addEventListener('change', (e) => {
            this.settings.darkTheme = e.target.checked;
            this.saveSettings();
            this.sendMessageToContentScript('updateSettings', this.settings);
        });

        // Theme style selection
        document.getElementById('themeStyle').addEventListener('change', (e) => {
            this.settings.themeStyle = e.target.value;
            this.saveSettings();
            this.sendMessageToContentScript('updateSettings', this.settings);
        });

        // Beep on new lap toggle
        document.getElementById('beepOnNewLap').addEventListener('change', (e) => {
            this.settings.beepOnNewLap = e.target.checked;
            this.saveSettings();
            this.sendMessageToContentScript('updateSettings', this.settings);
        });

        // Refresh interval slider
        const refreshSlider = document.getElementById('refreshInterval');
        const refreshValue = document.getElementById('refreshValue');
        
        refreshSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.settings.refreshInterval = value;
            refreshValue.textContent = `${value / 1000} seconds`;
        });

        refreshSlider.addEventListener('change', (e) => {
            this.saveSettings();
            this.sendMessageToContentScript('updateSettings', this.settings);
        });

        // Notification timer slider
        const timerSlider = document.getElementById('popupTimer');
        const timerValue = document.getElementById('timerValue');
        
        timerSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.settings.popupTimer = value;
            timerValue.textContent = `${value} seconds`;
        });

        timerSlider.addEventListener('change', (e) => {
            this.saveSettings();
            this.sendMessageToContentScript('updateSettings', this.settings);
        });

        // Auto-close notifications toggle
        document.getElementById('autoClosePopup').addEventListener('change', (e) => {
            this.settings.autoClosePopup = e.target.checked;
            this.saveSettings();
            this.sendMessageToContentScript('updateSettings', this.settings);
        });

        // Toggle extension button
        document.getElementById('toggleExtension').addEventListener('click', () => {
            this.toggleExtension();
        });
    }

    updateUI() {
        // Update checkboxes
        document.getElementById('darkTheme').checked = this.settings.darkTheme;
        document.getElementById('beepOnNewLap').checked = this.settings.beepOnNewLap;
        document.getElementById('autoClosePopup').checked = this.settings.autoClosePopup;
        
        // Update theme style selector
        document.getElementById('themeStyle').value = this.settings.themeStyle;
        
        // Update sliders
        const refreshSlider = document.getElementById('refreshInterval');
        const refreshValue = document.getElementById('refreshValue');
        refreshSlider.value = this.settings.refreshInterval;
        refreshValue.textContent = `${this.settings.refreshInterval / 1000} seconds`;
        
        const timerSlider = document.getElementById('popupTimer');
        const timerValue = document.getElementById('timerValue');
        timerSlider.value = this.settings.popupTimer;
        timerValue.textContent = `${this.settings.popupTimer} seconds`;
        
        // Update toggle button
        this.updateToggleButton();
    }

    updateToggleButton() {
        const button = document.getElementById('toggleExtension');
        if (this.settings.enabled) {
            button.textContent = 'Disable Extension';
            button.className = 'w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors duration-200 transform hover:scale-105';
        } else {
            button.textContent = 'Enable Extension';
            button.className = 'w-full py-3 bg-racing-green hover:bg-green-600 text-white font-bold rounded-lg transition-colors duration-200 transform hover:scale-105';
        }
    }

    async toggleExtension() {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.updateToggleButton();
        
        if (this.settings.enabled) {
            this.sendMessageToContentScript('enableExtension');
        } else {
            this.sendMessageToContentScript('disableExtension');
        }
    }

    async checkPageSupport() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab.url && tab.url.includes('livetiming.azurewebsites.net')) {
                // We're on a supported page
                this.showStatus('Extension active on this page', 'success');
            } else {
                // We're not on a supported page
                this.showStatus('Extension only works on LiveTiming pages', 'error');
                this.disableControls();
            }
        } catch (error) {
            console.log('Error checking page support:', error);
            this.showStatus('Error checking page support', 'error');
        }
    }

    disableControls() {
        const controls = document.querySelectorAll('input, button, select');
        controls.forEach(control => {
            control.disabled = true;
            control.classList.add('opacity-50', 'cursor-not-allowed');
        });
    }

    async sendMessageToContentScript(action, data = null) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab.url && tab.url.includes('livetiming.azurewebsites.net')) {
                await chrome.tabs.sendMessage(tab.id, { action, data });
            }
        } catch (error) {
            console.log('Error sending message to content script:', error);
        }
    }

    showStatus(message, type = 'success') {
        const status = document.getElementById('status');
        status.textContent = message;
        
        // Remove existing classes
        status.className = 'text-center py-3 px-4 rounded-lg text-sm font-medium mb-4';
        
        // Add type-specific classes
        if (type === 'success') {
            status.classList.add('bg-green-900/20', 'text-green-400', 'border', 'border-green-500');
        } else if (type === 'error') {
            status.classList.add('bg-red-900/20', 'text-red-400', 'border', 'border-red-500');
        } else {
            status.classList.add('bg-blue-900/20', 'text-blue-400', 'border', 'border-blue-500');
        }
        
        status.classList.remove('hidden');
        
        // Hide after 3 seconds
        setTimeout(() => {
            status.classList.add('hidden');
        }, 3000);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
}); 