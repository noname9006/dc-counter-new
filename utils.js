const fs = require('fs').promises;
const path = require('path');

// Debug logging function
function debugLog(message, details = null) {
    if (process.env.DEBUG_MODE !== 'true') return;

    const timestamp = new Date().toISOString();
    const logDir = 'logs';
    const logDate = timestamp.split('T')[0];
    const logFile = path.join(logDir, `debug_${logDate}.log`);
    
    let logMessage = `[${timestamp}] ${message}`;
    if (details) {
        logMessage += '\n' + JSON.stringify(details, null, 2);
    }
    
    // Console output
    console.log(logMessage);
    
    // File output
    fs.mkdir(logDir, { recursive: true })
        .then(() => fs.appendFile(logFile, logMessage + '\n'))
        .catch(err => console.error('Logging failed:', err));
}

// Format date for CSV
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toISOString().split('T')[0];
}

// Clean string for CSV
function cleanCSVString(str) {
    if (!str) return '';
    str = str.replace(/"/g, '""');
    if (/[,"\n\r]/.test(str)) {
        str = `"${str}"`;
    }
    return str;
}

// Format time duration
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Create progress bar
function createProgressBar(current, total, length = 20) {
    const progress = Math.floor((current / total) * length);
    return '█'.repeat(progress) + '░'.repeat(length - progress);
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

module.exports = {
    debugLog,
    formatDate,
    cleanCSVString,
    formatDuration,
    createProgressBar,
    formatFileSize
};