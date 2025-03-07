require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const { setupExtractCommands } = require('./unverified');
const { setupPurgeCommands } = require('./purge');

// Debug mode and logging
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Helper function to get formatted timestamp in UTC (for logging)
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// Helper function for formatted timestamp in embeds
function getFormattedTimestamp() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Array of short month names
    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    
    if (now.toDateString() === today.toDateString()) {
        return `Today at ${hours}:${minutes}`;
    } else if (now.toDateString() === yesterday.toDateString()) {
        return `Yesterday at ${hours}:${minutes}`;
    } else {
        const day = now.getDate().toString().padStart(2, '0');
        const month = months[now.getMonth()];
        const year = now.getFullYear();
        return `${day} ${month} ${year} ${hours}:${minutes}`;
    }
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

client.once('ready', () => {
    debugLog('Bot is ready!');
    debugLog(`Start time: ${getTimestamp()}`);
    scheduleUpdates();
});

setupExtractCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });
setupPurgeCommands(client, { allowedChannels, allowedRoles, verifiedRoleId, debugLog });

client.on('messageCreate', async message => {
    if (!message.content.startsWith('!count')) return;
    
    debugLog('Count command received', {
        channel: message.channel.id,
        user: message.author.tag
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

        const embed = new EmbedBuilder()
            .setTitle(`Total members: ${totalMembers}`)
            .setDescription('Members with highest roles:')
			.setColor(0xF2B518)
            .setFooter({
                text: `Botanix Labs                                                                        ${getFormattedTimestamp()}`,
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

            // Remove "ambassador" from role name
            const displayName = role.name.replace(/\bambassador\b/gi, '').trim();

            // Add emoji based on index
            let emojiPrefix = '';
            switch(i) {
                case 1:
                    emojiPrefix = '🌱  ';  // 2nd role
                    break;
                case 2:
                    emojiPrefix = '🌼  ';  // 3rd role
                    break;
                case 3:
                    emojiPrefix = '🌲  ';  // 4th role
                    break;
                case 4:
                    emojiPrefix = '🌳  ';  // 5th role
                    break;
                case 5:
                    emojiPrefix = '🥼  ';  // 6th role
                    break;
            }

            embed.addFields({ 
                name: `${emojiPrefix}${displayName}`, 
                value: `${count} (${percentage}%)`, 
                inline: true 
            });
        }

        // Add unverified members as the last field
        embed.addFields({ 
            name: 'Unverified Members', 
            value: `${unverifiedMembers} (${unverifiedPercentage}%)`, 
            inline: false 
        });

        // Verify counts
        if (DEBUG_MODE) {
            debugLog('\n=== Final Count Verification ===');
            debugLog(`Total members: ${totalMembers}`);
            debugLog(`Total role count: ${totalRoleCount}`);
            debugLog(`Counted unique members: ${globalCountedMembers.size}`);
            debugLog(`Unaccounted verified members: ${totalMembers - unverifiedMembers - globalCountedMembers.size}`);

            // List unaccounted verified members
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