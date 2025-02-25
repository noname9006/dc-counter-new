const fs = require('fs').promises;
const path = require('path');

class Logger {
    constructor() {
        this.debugMode = process.env.DEBUG_MODE === 'true';
        this.logDir = 'logs';
        this.currentLogFile = null;
        this.initLogFile();
    }

    async initLogFile() {
        try {
            // Create logs directory if it doesn't exist
            await fs.mkdir(this.logDir, { recursive: true });
            
            // Create new log file with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.currentLogFile = path.join(this.logDir, `debug_${timestamp}.log`);
            
            // Initial log entry
            await this.log('Debug logging started');
            await this.log(`Debug Mode: ${this.debugMode}`);
        } catch (error) {
            console.error('Failed to initialize log file:', error);
        }
    }

    async log(message, type = 'INFO', details = null) {
        if (!this.debugMode) return;

        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${type}] ${message}`;
        
        if (details) {
            logMessage += '\n' + JSON.stringify(details, null, 2);
        }

        // Console output
        console.log(logMessage);

        // File output
        try {
            await fs.appendFile(this.currentLogFile, logMessage + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    async logError(message, error) {
        await this.log(message, 'ERROR', {
            message: error.message,
            stack: error.stack
        });
    }

    async logProgress(operation, current, total, details = null) {
        await this.log(`${operation}: ${current}/${total}`, 'PROGRESS', details);
    }

    async logAPI(endpoint, status, details = null) {
        await this.log(`API ${endpoint}: ${status}`, 'API', details);
    }
}

module.exports = new Logger();