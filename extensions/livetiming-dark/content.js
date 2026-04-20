// LiveTiming Dark Theme & Lap Alerts Content Script
class LiveTimingExtension {
    constructor() {
        this.settings = {
            refreshInterval: 5000,
            beepOnNewLap: true,
            darkTheme: true,
            themeStyle: 'dark',
            popupTimer: 5,
            autoClosePopup: true,
            enabled: true,
            positionColumnWidth: 80,
            classColumnWidth: 100
        };
        this.fastestSectorTimes = [];
        this.fastestLapTime = [1337, 999999999.0];
        this.audioContext = null;
        this.fallbackInterval = null;
        this.sectorCount = 9;
        
        this.init();
    }

    async init() {
        console.log('LiveTiming Extension: Initializing...');
        
        // Load settings from storage
        await this.loadSettings();
        
        console.log('LiveTiming Extension: Settings loaded:', this.settings);
        
        // Apply theme if enabled
        if (this.settings.darkTheme && this.settings.enabled) {
            console.log('LiveTiming Extension: Applying fallback theme');
            this.applyFallbackTheme();
        } else {
            console.log('LiveTiming Extension: Theme disabled or extension disabled');
        }
        
        // Start monitoring if enabled
        if (this.settings.enabled) {
            console.log('LiveTiming Extension: Starting monitoring...');
            this.startMonitoring();
        }
        
        // Listen for settings changes
        chrome.storage.onChanged.addListener(this.handleSettingsChange.bind(this));
        
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        
        console.log('LiveTiming Extension: Initialization complete');
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get([
                'refreshInterval', 
                'beepOnNewLap', 
                'darkTheme', 
                'themeStyle', 
                'popupTimer',
                'autoClosePopup',
                'enabled',
                'positionColumnWidth',
                'classColumnWidth'
            ]);
            this.settings = { ...this.settings, ...result };
        } catch (error) {
            console.log('Using default settings:', error);
        }
    }

    handleSettingsChange(changes) {
        if (changes.refreshInterval) {
            this.settings.refreshInterval = changes.refreshInterval.newValue;
            if (this.settings.enabled) {
                this.restartMonitoring();
            }
        }
        if (changes.beepOnNewLap) {
            this.settings.beepOnNewLap = changes.beepOnNewLap.newValue;
        }
        if (changes.darkTheme) {
            this.settings.darkTheme = changes.darkTheme.newValue;
            if (this.settings.darkTheme && this.settings.enabled) {
                this.applyFallbackTheme();
            } else {
                this.removeTheme();
            }
        }
        if (changes.themeStyle) {
            this.settings.themeStyle = changes.themeStyle.newValue;
            if (this.settings.darkTheme && this.settings.enabled) {
                this.applyFallbackTheme();
            }
        }
        if (changes.popupTimer) {
            this.settings.popupTimer = changes.popupTimer.newValue;
        }
        if (changes.autoClosePopup) {
            this.settings.autoClosePopup = changes.autoClosePopup.newValue;
        }
        if (changes.enabled) {
            this.settings.enabled = changes.enabled.newValue;
            if (this.settings.enabled) {
                this.enableExtension();
            } else {
                this.disableExtension();
            }
        }
        if (changes.positionColumnWidth) {
            this.settings.positionColumnWidth = changes.positionColumnWidth.newValue;
        }
        if (changes.classColumnWidth) {
            this.settings.classColumnWidth = changes.classColumnWidth.newValue;
        }
    }

    handleMessage(request, sender, sendResponse) {
        switch (request.action) {
            case 'updateSettings':
                this.settings = { ...this.settings, ...request.data };
                this.applySettings();
                break;
            case 'enableExtension':
                this.enableExtension();
                break;
            case 'disableExtension':
                this.disableExtension();
                break;
            case 'getStatus':
                sendResponse({
                    enabled: this.settings.enabled,
                    darkTheme: this.settings.darkTheme,
                    themeStyle: this.settings.themeStyle,
                    beepOnNewLap: this.settings.beepOnNewLap,
                    refreshInterval: this.settings.refreshInterval,
                    popupTimer: this.settings.popupTimer,
                    autoClosePopup: this.settings.autoClosePopup,
                    positionColumnWidth: this.settings.positionColumnWidth,
                    classColumnWidth: this.settings.classColumnWidth
                });
                break;
        }
        sendResponse({ success: true });
    }

    applySettings() {
        if (this.settings.darkTheme && this.settings.enabled) {
            this.applyFallbackTheme();
        } else {
            this.removeTheme();
        }
        
        if (this.settings.enabled) {
            this.restartMonitoring();
        } else {
            this.stopMonitoring();
        }
    }

    enableExtension() {
        this.settings.enabled = true;
        if (this.settings.darkTheme) {
            this.applyFallbackTheme();
        }
        this.startMonitoring();
    }

    disableExtension() {
        this.settings.enabled = false;
        this.removeTheme();
        this.stopMonitoring();
    }

    stopMonitoring() {
        if (this.fallbackInterval) {
            clearInterval(this.fallbackInterval);
            this.fallbackInterval = null;
        }
    }

    initAudio() {
        // Only initialize audio context when user interacts
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (error) {
                console.log('Audio context not available:', error);
            }
        }
    }

    beep(vol, freq, duration) {
        if (!this.settings.beepOnNewLap || !this.settings.enabled) return;
        
        // Initialize audio context on first beep (user interaction)
        this.initAudio();
        
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            oscillator.frequency.value = freq;
            oscillator.type = "square";
            gainNode.connect(this.audioContext.destination);
            gainNode.gain.value = vol * 0.01;
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration * 0.001);
        } catch (error) {
            console.log('Beep failed:', error);
        }
    }

    applyFallbackTheme() {
        console.log('LiveTiming Extension: Applying fallback theme...');
        
        const fallbackCSS = `
            /* Fallback Dark Theme */
            body {
                background-color: #1a1a1a !important;
                color: #ffffff !important;
            }
            
            /* Universal styled-components override */
            [class*="sc-"] {
                color: #ffffff !important;
            }
            
            /* Target elements by their content and structure */
            div:has(h1) {
                color: #ffffff !important;
            }
            
            div:has(span) {
                color: #ffffff !important;
            }
            
            /* Header containers - target by structure */
            div > div > div {
                color: #ffffff !important;
            }
            
            /* Race title and info containers */
            div:has(h1:contains("ADAC")),
            div:has(h1:contains("Nürburgring")),
            div:has(h1:contains("Qualifiers")),
            div:has(h1:contains("Race")),
            div:has(span:contains("Session")),
            div:has(span:contains("Time to end")),
            div:has(span:contains("Track state")) {
                color: #ffffff !important;
                background-color: #2d2d2d !important;
            }
            
            /* Table styling */
            table {
                background-color: #2d2d2d !important;
                color: #ffffff !important;
            }
            
            /* Table headers */
            th {
                background-color: #444444 !important;
                color: #ffffff !important;
                border-color: #666666 !important;
            }
            
            /* Table cells */
            td {
                background-color: #2d2d2d !important;
                color: #ffffff !important;
                border-color: #444444 !important;
            }
            
            /* Table rows */
            tr {
                background-color: #2d2d2d !important;
            }
            
            /* Alternating rows */
            tr:nth-child(even) {
                background-color: #333333 !important;
            }
            
            /* Hover effects */
            tr:hover {
                background-color: #3a3a3a !important;
            }
            
            /* Links */
            a {
                color: #22c55e !important;
            }
            
            a:hover {
                color: #16a34a !important;
            }
            
            /* Buttons */
            button {
                background-color: #22c55e !important;
                color: #ffffff !important;
                border-color: #16a34a !important;
            }
            
            button:hover {
                background-color: #16a34a !important;
            }
            
            /* Input fields */
            input, select, textarea {
                background-color: #2d2d2d !important;
                color: #ffffff !important;
                border-color: #444444 !important;
            }
            
            /* Scrollbars */
            ::-webkit-scrollbar {
                width: 12px;
                height: 12px;
            }
            
            ::-webkit-scrollbar-track {
                background: #2d2d2d !important;
            }
            
            ::-webkit-scrollbar-thumb {
                background: #22c55e !important;
                border-radius: 6px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
                background: #16a34a !important;
            }
            
            /* Fastest sector highlighting */
            .fastest-sector {
                background: linear-gradient(135deg, #22c55e, #16a34a) !important;
                color: #000000 !important;
                font-weight: bold !important;
                text-shadow: 0 1px 2px rgba(255,255,255,0.3) !important;
                box-shadow: 0 2px 4px rgba(34, 197, 94, 0.3) !important;
            }
            
            /* Fastest lap highlighting */
            .fastest-lap {
                background: linear-gradient(135deg, #ec4899, #be185d) !important;
                color: #ffffff !important;
                font-weight: bold !important;
                text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
                box-shadow: 0 2px 4px rgba(236, 72, 153, 0.3) !important;
            }
            
            /* Timing elements - ensure white text */
            .tc-fastestLap {
                color: #ffffff !important;
            }
            
            .tc-fastestLap.fastest-lap {
                color: #ffffff !important;
            }
            
            /* All tc (timing) elements */
            .tc {
                color: #ffffff !important;
            }
            
            /* Sector time elements */
            [class*="tc-sector"] {
                color: #ffffff !important;
            }
            
            /* Ensure all timing data is white */
            td[class*="tc-"] {
                color: #ffffff !important;
            }
        `;
        
        const style = document.createElement('style');
        style.id = 'livetiming-theme-fallback';
        style.textContent = fallbackCSS;
        document.head.appendChild(style);
        
        // Add legacy class for compatibility
        document.body.classList.add('livetiming-dark-theme');
        
        // Apply dynamic styling for header elements
        this.applyDynamicHeaderStyling();
        
        // Apply column width settings
        this.applyColumnWidths();
        
        console.log('LiveTiming Extension: Fallback theme applied');
    }

    applyDynamicHeaderStyling() {
        // Function to apply styling to header elements
        const styleHeaderElements = () => {

            // Style all styled-components elements
            const styledElements = document.querySelectorAll('[class*="sc-"]');
            styledElements.forEach(element => {
                element.style.color = '#ffffff';
                // If it's a container with children, also style the background
                if (element.children.length > 0) {
                    element.style.backgroundColor = '#2d2d2d';
                }
            });
        };

        // Apply styling immediately
        styleHeaderElements();

        // Set up a mutation observer to handle dynamically added content
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the added element or its children need styling
                            const elementsToStyle = node.querySelectorAll ? 
                                [node, ...node.querySelectorAll('*')] : [node];
                            
                            elementsToStyle.forEach(element => {
                                if (element.matches && element.matches('[class*="sc-"]')) {
                                    element.style.color = '#ffffff';
                                    if (element.children.length > 0) {
                                        element.style.backgroundColor = '#2d2d2d';
                                    }
                                }
                            });
                        }
                    });
                }
            });
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Store observer for cleanup
        this.headerObserver = observer;
    }

    applyColumnWidths() {
        // Create dynamic CSS for column widths
        const columnCSS = `
            /* Dynamic column width settings */
            table {
                table-layout: fixed !important;
                width: 100% !important;
            }
            
            /* Position column (number) - user configurable */
            td:nth-child(1), th:nth-child(1) {
                width: ${this.settings.positionColumnWidth}px !important;
                min-width: ${this.settings.positionColumnWidth}px !important;
                max-width: ${this.settings.positionColumnWidth}px !important;
            }
            
            /* Class column - user configurable */
            td:nth-child(3), th:nth-child(3) {
                width: ${this.settings.classColumnWidth}px !important;
                min-width: ${this.settings.classColumnWidth}px !important;
                max-width: ${this.settings.classColumnWidth}px !important;
            }
            
            /* Table cell styling for better text handling */
            td {
                padding: 6px 4px !important;
                text-align: center !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            
            th {
                padding: 8px 4px !important;
                text-align: center !important;
                font-weight: bold !important;
            }
        `;
        
        // Remove existing column width style if it exists
        const existingStyle = document.getElementById('livetiming-column-widths');
        if (existingStyle) {
            existingStyle.remove();
        }
        
        // Add new column width style
        const style = document.createElement('style');
        style.id = 'livetiming-column-widths';
        style.textContent = columnCSS;
        document.head.appendChild(style);
    }

    removeTheme() {
        const fallbackStyle = document.getElementById('livetiming-theme-fallback');
        if (fallbackStyle) {
            fallbackStyle.remove();
        }
        
        // Clean up mutation observer
        if (this.headerObserver) {
            this.headerObserver.disconnect();
            this.headerObserver = null;
        }
        
        // Reset dynamic styling
        this.resetDynamicStyling();
        
        // Remove all theme classes from body
        document.body.classList.remove('livetiming-theme-dark', 'livetiming-theme-light', 'livetiming-theme-racing', 'livetiming-theme-neon', 'livetiming-dark-theme');
    }

    resetDynamicStyling() {
        // Reset all styled-components elements to default
        const styledElements = document.querySelectorAll('[class*="sc-"]');
        styledElements.forEach(element => {
            element.style.removeProperty('color');
            element.style.removeProperty('background-color');
        });

        // Reset h1 and span elements
        const h1Elements = document.querySelectorAll('h1');
        h1Elements.forEach(h1 => {
            h1.style.removeProperty('color');
            if (h1.parentElement) {
                h1.parentElement.style.removeProperty('color');
                h1.parentElement.style.removeProperty('background-color');
            }
        });

        const spanElements = document.querySelectorAll('span');
        spanElements.forEach(span => {
            span.style.removeProperty('color');
            if (span.parentElement) {
                span.parentElement.style.removeProperty('color');
                span.parentElement.style.removeProperty('background-color');
            }
        });
    }

    startMonitoring() {
        // Clear any existing interval
        if (this.fallbackInterval) {
            clearInterval(this.fallbackInterval);
        }

        // Initialize fastest sector times
        this.fastestSectorTimes = [];
        for (let i = 0; i < this.sectorCount; ++i) {
            this.fastestSectorTimes.push([1337, 999999999.0]);
        }

        // Start monitoring
        this.fallbackInterval = setInterval(() => {
            if (this.settings.enabled) {
                this.processSectorTimes();
                this.processLapTimes();
            }
        }, this.settings.refreshInterval);

        // Initial beep on startup (will only work after user interaction)
        if (this.settings.beepOnNewLap && this.settings.enabled) {
            // Don't beep immediately to avoid autoplay issues
            console.log('LiveTiming Extension: Monitoring started - beep will work after user interaction');
        }
    }

    restartMonitoring() {
        this.startMonitoring();
    }

    processSectorTimes() {
        for (let i = 0; i < this.sectorCount; ++i) {
            const sectorTimes = document.querySelectorAll(`td.tc.tc-sector${i + 1}Time`);
            let currentSectorTime = 0.0;

            sectorTimes.forEach((sectorTime, index) => {
                if (sectorTime.innerHTML !== "") {
                    currentSectorTime = this.parseTime(sectorTime.innerHTML);
                    
                    if (this.fastestSectorTimes[i][1] > currentSectorTime && currentSectorTime !== 0) {
                        this.fastestSectorTimes[i] = [index + 1, currentSectorTime];
                    }

                    // Reset background color
                    const sectorTimeCSS = document.querySelector(`tr:nth-child(${index + 1}) > td.tc.tc-sector${i + 1}Time`);
                    if (sectorTimeCSS) {
                        sectorTimeCSS.style.backgroundColor = "";
                        sectorTimeCSS.classList.remove('fastest-sector');
                    }
                }
            });

            // Highlight fastest sector
            const fastestSectorCSS = document.querySelector(`tr:nth-child(${this.fastestSectorTimes[i][0]}) > td.tc.tc-sector${i + 1}Time`);
            if (fastestSectorCSS) {
                fastestSectorCSS.classList.add('fastest-sector');
            }
        }
    }

    processLapTimes() {
        const fastestLaps = document.querySelectorAll('.tc-fastestLap');
        let currentLap = 0.0;

        fastestLaps.forEach((fastestLap, index) => {
            if (fastestLap.innerHTML !== "") {
                currentLap = this.parseTime(fastestLap.innerHTML);
                
                if (this.fastestLapTime[1] > currentLap && currentLap !== 0) {
                    this.fastestLapTime = [index + 1, currentLap];
                }

                // Reset background color
                const lapTimeCSS = document.querySelector(`tr:nth-child(${index + 1}) > td.tc.tc-fastestLap`);
                if (lapTimeCSS) {
                    lapTimeCSS.style.backgroundColor = "";
                    lapTimeCSS.classList.remove('fastest-lap');
                }
            }
        });

        // Highlight fastest lap
        const fastestLapCSS = document.querySelector(`tr:nth-child(${this.fastestLapTime[0]}) > td.tc.tc-fastestLap`);
        if (fastestLapCSS) {
            fastestLapCSS.classList.add('fastest-lap');
        }

        // Check for new fastest lap
        this.checkNewFastestLap();
    }

    checkNewFastestLap() {
        const storedFastestLap = sessionStorage.getItem('fastestLap');
        
        if (storedFastestLap) {
            const laptime = parseFloat(storedFastestLap);
            if (laptime > this.fastestLapTime[1]) {
                // New fastest lap detected
                sessionStorage.setItem('fastestLap', this.fastestLapTime[1]);
                this.alertNewFastestLap();
            }
        } else {
            // First fastest lap
            sessionStorage.setItem('fastestLap', this.fastestLapTime[1]);
            if (this.settings.beepOnNewLap && this.settings.enabled) {
                this.beep(100, 500, 300);
            }
        }
    }

    alertNewFastestLap() {
        if (this.settings.beepOnNewLap && this.settings.enabled) {
            // Multiple beeps for new fastest lap
            for (let i = 0; i < 5; i++) {
                setTimeout(() => this.beep(100, 400, 100), i * 150);
            }
        }

        // Show notification
        this.showNotification('New Fastest Lap!', `New fastest lap: ${this.formatTime(this.fastestLapTime[1])}`);
        
        // Send message to background script for system notification
        chrome.runtime.sendMessage({
            action: 'newFastestLap',
            lapTime: this.formatTime(this.fastestLapTime[1])
        });
    }

    showNotification(title, message) {
        // Create notification element with inline styles
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            color: white;
            padding: 16px;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            z-index: 9999;
            font-family: Arial, sans-serif;
            font-weight: bold;
            max-width: 300px;
            transform: translateX(100%);
            transition: transform 0.3s ease-out;
            animation: slideIn 0.3s ease-out;
        `;
        
        // Add CSS animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
        
        // Create notification content
        notification.innerHTML = `
            <div style="font-size: 16px; margin-bottom: 4px; font-weight: bold;">${title}</div>
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">${message}</div>
            <div style="position: absolute; top: 8px; right: 8px; font-size: 12px; opacity: 0.75;">5s</div>
            <div style="position: absolute; bottom: 0; left: 0; height: 4px; background: #4ade80; transition: width 1s ease-linear; width: 100%;"></div>
        `;
        
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        // Start timer
        const timerDuration = this.settings.popupTimer || 5;
        let timeRemaining = timerDuration;
        const progressBarElement = notification.querySelector('div[style*="position: absolute; bottom: 0"]');
        const timerDisplayElement = notification.querySelector('div[style*="position: absolute; top: 8px"]');
        
        const timer = setInterval(() => {
            timeRemaining--;
            timerDisplayElement.textContent = `${timeRemaining}s`;
            
            // Update progress bar
            const percentage = (timeRemaining / timerDuration) * 100;
            progressBarElement.style.width = `${percentage}%`;
            
            // Change color based on time remaining
            if (timeRemaining <= 2) {
                progressBarElement.style.background = '#f87171'; // red
            } else if (timeRemaining <= 3) {
                progressBarElement.style.background = '#facc15'; // yellow
            }
            
            if (timeRemaining <= 0) {
                clearInterval(timer);
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    notification.remove();
                    style.remove();
                }, 300);
            }
        }, 1000);
        
        // Pause timer on hover
        notification.addEventListener('mouseenter', () => {
            clearInterval(timer);
        });
        
        // Resume timer on mouse leave
        notification.addEventListener('mouseleave', () => {
            if (timeRemaining > 0) {
                const newTimer = setInterval(() => {
                    timeRemaining--;
                    timerDisplayElement.textContent = `${timeRemaining}s`;
                    
                    // Update progress bar
                    const percentage = (timeRemaining / timerDuration) * 100;
                    progressBarElement.style.width = `${percentage}%`;
                    
                    // Change color based on time remaining
                    if (timeRemaining <= 2) {
                        progressBarElement.style.background = '#f87171'; // red
                    } else if (timeRemaining <= 3) {
                        progressBarElement.style.background = '#facc15'; // yellow
                    }
                    
                    if (timeRemaining <= 0) {
                        clearInterval(newTimer);
                        notification.style.transform = 'translateX(100%)';
                        setTimeout(() => {
                            notification.remove();
                            style.remove();
                        }, 300);
                    }
                }, 1000);
            }
        });
    }

    parseTime(timeString) {
        const parts = timeString.split(":");
        if (parts.length > 1) {
            return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
        } else {
            return parseFloat(parts[0]);
        }
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = (seconds % 60).toFixed(3);
        return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
    }
}

// Initialize the extension when the page is ready
let _ltInstance = null;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { _ltInstance = new LiveTimingExtension(); });
} else {
    _ltInstance = new LiveTimingExtension();
}

// Listen for postMessage from RingRaceViewer dashboard (parent frame)
window.addEventListener('message', (event) => {
    if (!_ltInstance) return;
    if (event.data && event.data.type === 'rrv-extension') {
        if (event.data.action === 'enable') {
            _ltInstance.enableExtension();
        } else if (event.data.action === 'disable') {
            _ltInstance.disableExtension();
        } else if (event.data.action === 'getStatus') {
            event.source.postMessage({ type: 'rrv-extension-status', enabled: _ltInstance.settings.enabled }, '*');
        }
    }
}); 