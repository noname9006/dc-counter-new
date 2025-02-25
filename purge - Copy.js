const { EmbedBuilder } = require('discord.js');

class PurgeManager {
    constructor() {
        this.activeOperations = new Map();
    }

    getOperation(guildId, type) {
        const key = `${guildId}-${type}`;
        return this.activeOperations.get(key);
    }

    setOperation(guildId, type, operation) {
        const key = `${guildId}-${type}`;
        this.activeOperations.set(key, operation);
    }

    deleteOperation(guildId, type) {
        const key = `${guildId}-${type}`;
        this.activeOperations.delete(key);
    }
}

class PurgeOperation {
    constructor(guild, type, rate, debugLog) {
        this.guild = guild;
        this.type = type;
        this.rate = rate;
        this.debugLog = debugLog;
        this.isRunning = false;
        this.startTime = null;
        this.processedCount = 0;
        this.skippedCount = 0;
        this.intervalId = null;
    }

    async start(verifiedRoleId) {
        if (this.isRunning) {
            return false;
        }

        this.isRunning = true;
        this.startTime = new Date();
        this.processedCount = 0;
        this.skippedCount = 0;

        this.log('START', {
            rate: this.rate,
            type: this.type,
            startTime: this.formatDate(this.startTime)
        });

        // Start hourly processing
        this.intervalId = setInterval(() => this.processBatch(verifiedRoleId), 3600000);
        // Run first batch immediately
        await this.processBatch(verifiedRoleId);
        return true;
    }

    stop() {
        if (!this.isRunning) {
            return false;
        }

        clearInterval(this.intervalId);
        this.isRunning = false;
        
        this.log('STOP', {
            type: this.type,
            processedTotal: this.processedCount,
            skippedTotal: this.skippedCount,
            duration: this.formatDuration(Date.now() - this.startTime)
        });

        return true;
    }

    async processBatch(verifiedRoleId) {
        await this.guild.members.fetch(); // Refresh member list

        const members = this.guild.members.cache
            .filter(member => !member.user.bot)
            .filter(member => {
                if (this.type === 'noroles') {
                    return member.roles.cache.size === 1; // Only @everyone role
                } else {
                    return !member.roles.cache.has(verifiedRoleId);
                }
            })
            .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp)
            .first(this.rate);

        for (const member of members) {
            try {
                // Recheck conditions before kicking
                const shouldKick = this.type === 'noroles' ?
                    member.roles.cache.size === 1 :
                    !member.roles.cache.has(verifiedRoleId);

                if (shouldKick) {
                    const reason = this.type === 'noroles' ?
                        'Automated purge: No roles' :
                        'Automated purge: Not verified';

                    await member.kick(reason);
                    this.processedCount++;

                    this.log('KICK', {
                        userId: member.id,
                        username: member.user.username,
                        joinDate: this.formatDate(member.joinedAt),
                        reason: reason
                    });
                } else {
                    this.skippedCount++;
                    this.log('SKIP', {
                        userId: member.id,
                        username: member.user.username,
                        reason: 'Conditions no longer met'
                    });
                }
            } catch (error) {
                this.log('ERROR', {
                    userId: member.id,
                    username: member.user.username,
                    error: error.message
                });
            }

            // Delay between kicks to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    getStatus() {
        if (!this.isRunning) {
            return null;
        }

        return {
            type: this.type,
            rate: this.rate,
            runningTime: this.formatDuration(Date.now() - this.startTime),
            processedCount: this.processedCount,
            skippedCount: this.skippedCount
        };
    }

    log(action, data) {
        const timestamp = this.formatDate(new Date());
        const logEntry = {
            timestamp,
            action,
            ...data
        };
        this.debugLog(`PURGE: ${JSON.stringify(logEntry)}`);
    }

    formatDate(date) {
        return date.toISOString().replace('T', ' ').split('.')[0];
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
}

function setupPurgeCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog }) {
    const purgeManager = new PurgeManager();

    client.on('messageCreate', async message => {
        if (!message.content.startsWith('!purge')) return;

        // Check channel permission
        if (!allowedChannels.includes(message.channel.id)) {
            debugLog('Purge command used in unauthorized channel');
            return;
        }

        // Check role permission
        const memberRoles = message.member.roles.cache.map(role => role.name);
        if (!allowedRoles.some(role => memberRoles.includes(role))) {
            debugLog('Purge command used by unauthorized user');
            return;
        }

        const args = message.content.toLowerCase().split(' ');
        if (args.length !== 3) return;

        const [cmd, type, rateArg] = args;
        if (!['noroles', 'unverified'].includes(type)) return;
        if (!rateArg.startsWith('rate=')) return;

        const rate = parseInt(rateArg.split('=')[1]);
        if (isNaN(rate) || rate <= 0) {
            await message.reply('Invalid rate value. Please specify a positive number.');
            return;
        }

        const existingOperation = purgeManager.getOperation(message.guild.id, type);
        if (existingOperation) {
            await message.reply(`A ${type} purge operation is already running. Use \`!purge status ${type}\` to check status.`);
            return;
        }

        const operation = new PurgeOperation(message.guild, type, rate, debugLog);
        purgeManager.setOperation(message.guild.id, type, operation);

        const started = await operation.start(verifiedRoleId);
        if (started) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Started ${type} Purge Operation`)
                .setDescription(`Rate: ${rate} users/hour\nStarted at: ${operation.formatDate(operation.startTime)}`)
                .setFooter({ text: 'Use "!purge status noroles" or "!purge status unverified" to check status' });

            await message.reply({ embeds: [embed] });
        }
    });

    // Add status command
    client.on('messageCreate', async message => {
        if (!message.content.startsWith('!purge status')) return;

        const args = message.content.toLowerCase().split(' ');
        if (args.length !== 3) return;

        const type = args[2];
        if (!['noroles', 'unverified'].includes(type)) return;

        const operation = purgeManager.getOperation(message.guild.id, type);
        if (!operation || !operation.isRunning) {
            await message.reply(`No ${type} purge operation is currently running.`);
            return;
        }

        const status = operation.getStatus();
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(`${type} Purge Status`)
            .addFields(
                { name: 'Running Time', value: status.runningTime, inline: true },
                { name: 'Rate', value: `${status.rate}/hour`, inline: true },
                { name: 'Processed', value: status.processedCount.toString(), inline: true },
                { name: 'Skipped', value: status.skippedCount.toString(), inline: true }
            );

        await message.reply({ embeds: [embed] });
    });

    // Add stop command
    client.on('messageCreate', async message => {
        if (!message.content.startsWith('!purge stop')) return;

        const args = message.content.toLowerCase().split(' ');
        if (args.length !== 3) return;

        const type = args[2];
        if (!['noroles', 'unverified'].includes(type)) return;

        const operation = purgeManager.getOperation(message.guild.id, type);
        if (!operation || !operation.isRunning) {
            await message.reply(`No ${type} purge operation is currently running.`);
            return;
        }

        const stopped = operation.stop();
        if (stopped) {
            purgeManager.deleteOperation(message.guild.id, type);
            await message.reply(`Stopped ${type} purge operation.`);
        }
    });
}

module.exports = { setupPurgeCommands };