const { debugLog } = require('./utils');

function handleError(error, context) {
    debugLog('Error occurred', 'ERROR', {
        context,
        message: error.message,
        stack: error.stack
    });

    // Log to separate error file
    const errorLog = {
        timestamp: new Date().toISOString(),
        context,
        error: {
            message: error.message,
            stack: error.stack,
            code: error.code
        }
    };

    fs.appendFile(
        path.join('logs', 'errors.log'),
        JSON.stringify(errorLog, null, 2) + '\n\n'
    ).catch(console.error);
}

module.exports = handleError;{\rtf1}