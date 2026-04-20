// Background service worker for LiveTiming Extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('LiveTiming Extension installed');
    
    // Set default settings
    chrome.storage.sync.set({
        darkTheme: true,
        beepOnNewLap: true,
        refreshInterval: 5000,
        enabled: true
    });
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup automatically due to manifest configuration
    console.log('Extension icon clicked');
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'newFastestLap') {
        // Show notification for new fastest lap
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: '🏁 New Fastest Lap!',
            message: `New fastest lap: ${request.lapTime}`,
            priority: 2
        });
    }
    
    sendResponse({ success: true });
});

// Handle tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && 
        tab.url && 
        tab.url.includes('livetiming.azurewebsites.net')) {
        
        // Inject content script if not already injected
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).catch(() => {
            // Content script might already be injected, ignore error
        });
    }
});
