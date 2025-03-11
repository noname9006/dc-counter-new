require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const setupCountUnverifiedCommand = require('./countUnverified');
const { setupExtractCommands } = require('./unverified');
const { setupPurgeCommands } = require('./purge');
const fs = require('fs');
const path = require('path');

// Debug mode and logging
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Helper function to get formatted timestamp in UTC
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Custom logging function
function debugLog(message, isMemberInfo = false, ...args) {
    if (DEBUG_MODE || !isMemberInfo) {
        const logPrefix = DEBUG_MODE ? `[DEBUG ${getTimestamp()}]` : `[${getTimestamp()}]`;
        console.log(logPrefix, message, ...args);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [
        Partials.Channel
    ]
});

// Environment variables
const token = process.env.DISCORD_TOKEN;
const allowedRoles = process.env.ALLOWED_ROLES.split(',');
const allowedChannels = process.env.ALLOWED_CHANNELS.split(',');
const ignoredRoleId = process.env.IGNORED_ROLE;
const verifiedRoleId = process.env.VERIFIED_ROLE;
const intervalMinutes = parseInt(process.env.INTERVAL_MINUTES) || 5;

// Channel configurations
const totalMemberCountChannelId = process.env.TOTAL_MEMBER_COUNT_CHANNEL_ID;
const totalMemberCountNameFormat = process.env.TOTAL_MEMBER_COUNT_NAME_FORMAT;

// Role configurations
const scheduledRoles = Array.from({ length: 6 }, (_, i) => process.env[`SCHEDULED_ROLE_${i + 1}`]).filter(Boolean);
const scheduledChannels = Array.from({ length: 6 }, (_, i) => process.env[`SCHEDULED_CHANNEL_${i + 1}`]).filter(Boolean);
const scheduledChannelNames = Array.from({ length: 6 }, (_, i) => process.env[`SCHEDULED_CHANNEL_NAME_${i + 1}`]).filter(Boolean);
const countRoles = Array.from({ length: 6 }, (_, i) => process.env[`COUNT_ROLE_${i + 1}`]).filter(Boolean);

// Message cache for tracking user messages (last 24 hours)
const messageCache = new Map();

// Clear message cache every 24 hours
setInterval(() => {
    messageCache.clear();
}, 24 * 60 * 60 * 1000);

function countMembersWithHighestRole(members, roleId, verifiedRoleId, countedMembers = new Set()) {
    let count = 0;
    let roleMemberIds = new Set();

    members.forEach(member => {
        // Skip bots and already counted members
        if (member.user.bot || countedMembers.has(member.id)) return;
        
        // Skip unverified members
        if (!member.roles.cache.has(verifiedRoleId)) return;

        const memberRoles = member.roles.cache;
        const highestRole = member.roles.highest;

        // Handle ignored role case
        if (highestRole.id === ignoredRoleId) {
            const nextHighestRole = memberRoles
                .filter(r => r.id !== ignoredRoleId && !r.managed)
                .sort((a, b) => b.position - a.position)
                .first();

            if (nextHighestRole && nextHighestRole.id === roleId) {
                count++;
                roleMemberIds.add(member.id);
                countedMembers.add(member.id);
                debugLog(`Counted member ${member.user.tag} for role ${roleId} (ignored role)`, true);
            }
        }
        // Handle normal case
        else if (highestRole.id === roleId) {
            count++;
            roleMemberIds.add(member.id);
            countedMembers.add(member.id);
            debugLog(`Counted member ${member.user.tag} for role ${roleId}`, true);
        }
    });

    return { count, memberIds: roleMemberIds };
}

async function updateChannelNames() {
    debugLog('Starting channel name updates');
    const guild = client.guilds.cache.first();
    if (!guild) {
        debugLog('No guild found');
        return;
    }

    try {
        await guild.members.fetch();
        debugLog('Fetched all guild members');

        // Update total member count
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        const totalMemberChannel = guild.channels.cache.get(totalMemberCountChannelId);
        if (totalMemberChannel) {
            const newName = totalMemberCountNameFormat.replace('{count}', totalMembers);
            await totalMemberChannel.setName(newName);
            debugLog(`Updated total member count channel: ${newName}`);
        }

        // Update role-specific channels
        let countedMembers = new Set();
        
        for (let i = 0; i < scheduledRoles.length; i++) {
            const roleId = scheduledRoles[i];
            const channelId = scheduledChannels[i];
            const channelNameFormat = scheduledChannelNames[i];

            if (!roleId || !channelId || !channelNameFormat) continue;

            const role = guild.roles.cache.get(roleId);
            const channel = guild.channels.cache.get(channelId);

            if (!role || !channel) {
                debugLog(`Missing role or channel for index ${i}`);
                continue;
            }

            const { count } = countMembersWithHighestRole(
                guild.members.cache,
                roleId,
                verifiedRoleId,
                countedMembers
            );

            const newName = channelNameFormat.replace('{count}', count);
            await channel.setName(newName);
            debugLog(`Updated ${role.name} channel: ${newName}`);
        }
    } catch (error) {
        debugLog('Error in updateChannelNames:', error);
    }
}

function scheduleUpdates() {
    const intervalMs = intervalMinutes * 60 * 1000;
    debugLog(`Setting up interval updates every ${intervalMinutes} minutes`);
    
    updateChannelNames();
    setInterval(updateChannelNames, intervalMs);
}

// Track messages for counting
client.on('messageCreate', message => {
    if (message.author.bot) return;
    
    const userId = message.author.id;
    const currentCount = messageCache.get(userId) || 0;
    messageCache.set(userId, currentCount + 1);
});

client.once('ready', () => {
    debugLog('Bot is ready!');
    debugLog(`Start time: ${getTimestamp()}`);
    scheduleUpdates();
});

setupExtractCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });
setupPurgeCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });
setupCountUnverifiedCommand(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });

client.on('messageCreate', async message => {
    // First check if it starts with !count
    if (!message.content.startsWith('!count')) return;
    
    // Get the full command
    const fullCommand = message.content.trim();
    
    // List of valid commands
    const validCommands = ['!count', '!count export', '!count unverified'];
    
    // If it's not a valid command, ignore it
    if (!validCommands.includes(fullCommand)) {
        debugLog('Invalid count command received:', fullCommand);
        return;
    }
    
    debugLog('Count command received', {
        channel: message.channel.id,
        user: message.author.tag,
        command: fullCommand
    });

    // Check channel permission
    if (!allowedChannels.includes(message.channel.id)) {
        debugLog('Command used in unauthorized channel');
        return;
    }

    // Check role permission
    const memberRoles = message.member.roles.cache.map(role => role.name);
    if (!allowedRoles.some(role => memberRoles.includes(role))) {
        debugLog('Command used by unauthorized user');
        return;
    }

    // Handle export command
    if (fullCommand === '!count export') {
        try {
            await message.channel.send('Generating CSV export... This might take a few moments.');
            
            const guild = message.guild;
            await guild.members.fetch();
            
            // Prepare CSV header
            const csvHeader = 'UserID,Username,Highest Role,Server Join Date,Discord Join Date,Messages Number\n';
            let csvContent = csvHeader;
            
            // Process each member
            for (const [id, member] of guild.members.cache) {
                if (member.user.bot) continue;  // Skip bots
                
                const userId = member.user.id;
                const username = member.user.tag.replace(/,/g, '');  // Remove commas to avoid CSV issues
                const highestRole = member.roles.highest.name.replace(/,/g, '');
                const serverJoinDate = member.joinedAt.toISOString().slice(0, 19).replace('T', ' ');
                const discordJoinDate = member.user.createdAt.toISOString().slice(0, 19).replace('T', ' ');
                const messagesNumber = messageCache.get(userId) || 0;
                
                // Add line to CSV
                csvContent += `${userId},"${username}","${highestRole}","${serverJoinDate}","${discordJoinDate}",${messagesNumber}\n`;
            }
            
            // Create temporary file
            const tempFilePath = path.join(__dirname, 'user_export.csv');
            fs.writeFileSync(tempFilePath, csvContent, 'utf8');
            
            // Create attachment and send file
            const attachment = new AttachmentBuilder(tempFilePath, {
                name: `user_export_${getTimestamp().replace(/[: ]/g, '-')}.csv`
            });
            
            await message.channel.send({
                content: 'Here is your requested user export:',
                files: [attachment]
            });
            
            // Clean up temporary file
            fs.unlinkSync(tempFilePath);
            
            debugLog('Export command completed successfully');
            return;
        } catch (error) {
            debugLog('Error in export command:', error);
            await message.channel.send('An error occurred while generating the export.');
            return;
        }
    }

    // If not export command, must be !count or !count unverified
    try {
        const guild = message.guild;
        await guild.members.fetch();
        debugLog('Fetched all guild members');

        // Count total and verified members
        const totalMembers = guild.members.cache.filter(member => !member.user.bot).size;
        const unverifiedMembers = guild.members.cache.filter(member => 
            !member.user.bot && !member.roles.cache.has(verifiedRoleId)
        ).size;
        const unverifiedPercentage = ((unverifiedMembers / totalMembers) * 100).toFixed(1);

        if (fullCommand === '!count unverified') {
            // Don't do anything here as it's handled by the countUnverifiedCommand module
            return;
        }

        // Regular !count command
        const embed = new EmbedBuilder()
            .setTitle(`Total members: ${totalMembers}`)
            .setDescription(`Unverified members: ${unverifiedMembers} (${unverifiedPercentage}%)`)
            .setFooter({
                text: 'Botanix Labs',
                iconURL: 'https://a-us.storyblok.com/f/1014909/512x512/026e26392f/dark_512-1.png'
            });

        let totalRoleCount = 0;
        let globalCountedMembers = new Set();

        for (let i = 0; i < countRoles.length; i++) {
            const roleId = countRoles[i];
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;

            const { count, memberIds } = countMembersWithHighestRole(
                guild.members.cache,
                roleId,
                verifiedRoleId,
                globalCountedMembers
            );

            totalRoleCount += count;
            memberIds.forEach(id => globalCountedMembers.add(id));

            let percentage;
            if (i === 0 || i === 1) {
                percentage = ((count / totalMembers) * 100).toFixed(1);
            } else if (i === 2 || i === 3) {
                percentage = ((count / totalMembers) * 100).toFixed(2);
            } else {
                percentage = ((count / totalMembers) * 100).toFixed(3);
            }

            embed.addFields({ name: role.name, value: `${count} (${percentage}%)`, inline: true });
        }

        // Verify counts in debug mode
        if (DEBUG_MODE) {
            debugLog('\n=== Final Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Total role count: ${totalRoleCount}`);
            debugLog(`Counted unique members: ${globalCountedMembers.size}`);
            debugLog(`Unaccounted verified members: ${totalMembers - unverifiedMembers - globalCountedMembers.size}`);

            const unaccountedMembers = guild.members.cache
                .filter(m => 
                    m.roles.cache.has(verifiedRoleId) && 
                    !globalCountedMembers.has(m.id)
                );

            if (unaccountedMembers.size > 0) {
                debugLog('\nUnaccounted verified members:');
                unaccountedMembers.forEach(member => {
                    const roles = member.roles.cache
                        .filter(r => !r.managed)
                        .map(r => r.name)
                        .join(', ');
                    debugLog(`${member.user.tag} - Roles: ${roles}`);
                });
            }
        }

        await message.channel.send({ embeds: [embed] });
        debugLog('Count command completed successfully');

    } catch (error) {
        debugLog('Error in count command:', error);
        debugLog(`Error stack: ${error.stack}`);
        await message.channel.send('An error occurred while counting members.');
    }
});

client.login(token);