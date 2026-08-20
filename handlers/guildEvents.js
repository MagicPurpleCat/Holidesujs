import { Events } from 'discord.js';
import { ensureUser, addCoins, addXp, getDb } from '../database.js';
import { bumpQuest, checkEconomyAchievements, getFarmMultiplier } from '../modules/progress.js';
import {
  trackMessageAchievements,
  trackReactionAdd,
  trackVoiceStateAchievements,
  trackPresenceUpdate,
  checkLoyaltyForMember,
  startAchievementLoops,
} from '../modules/achievementsTracker.js';
import { getGuildConfig, getTriggerChannelId, initGuildConfig, suggestScaleOptimizations, clearGuildConfigCache } from '../utils/guildConfig.js';
import { logInfo, logErr } from '../utils/botLog.js';
import { checkLevelMilestones } from '../commands/rank.js';
import { createVoiceRoom, handleOwnerLeave } from '../modules/voiceChannels.js';
import { handleGuildMemberAdd } from '../modules/verification.js';
import { handleGuildMemberAddNPC } from '../modules/welcomeNPC.js';
import { updateActivityAndCheckRank } from '../modules/activityRoles.js';
import { checkAntiSpam } from '../modules/antiSpam.js';
import { logEvent, clearLogConfigCache } from '../modules/logger.js';
import { initVoicePanel } from '../modules/voicePanel.js';
import { isPrimaryGuild } from '../utils/singleGuild.js';

export const voiceFarming = new Map();
const messageCooldowns = new Map();
const MESSAGE_XP_COOLDOWN = 5_000;
const MESSAGE_XP_MIN = 15;
const MESSAGE_XP_MAX = 25;
const FARM_RATE = parseInt(process.env.FARM_RATE, 10) || 10;
/** Полный FARM_RATE только первые N минут после входа/unmute; дальше штраф за AFK */
const ANTI_AFK_FULL_RATE_MINUTES = 20;
const ANTI_AFK_REDUCED_MULTIPLIER = 0.1;
const MESSAGE_COOLDOWN_MAX = 20_000;

function stampVoiceFarmActivity(guildId, userId) {
  if (!guildId || !userId) return;
  const db = getDb();
  ensureUser(userId, guildId);
  db.prepare(
    "UPDATE users SET last_voice_reset_time = datetime('now') WHERE guild_id = ? AND user_id = ?",
  ).run(guildId, userId);
}

function isEligibleForFarm(member) {
  if (!member) return false;
  if (!member.voice || !member.voice.channel) return false;
  if (member.voice.selfDeaf || member.voice.selfMute) return false;
  if (!member.voice.channel.members || member.voice.channel.members.size < 2) return false;
  // хотя бы один другой живой (не бот) в канале
  const humans = [...member.voice.channel.members.values()].filter((m) => !m.user?.bot);
  if (humans.length < 2) return false;
  return true;
}

function pruneMessageCooldowns(now) {
  if (messageCooldowns.size < MESSAGE_COOLDOWN_MAX) return;
  for (const [id, ts] of messageCooldowns) {
    if (now - ts > MESSAGE_XP_COOLDOWN * 4) messageCooldowns.delete(id);
  }
}

export function registerGuildEvents(client, shardId) {
  client.on(Events.GuildCreate, async (guild) => {
    try {
      if (!guild) return;
      if (!isPrimaryGuild(guild.id)) {
        logErr(shardId, 'GUILD', `Лишний сервер ${guild.name} (${guild.id}) — выхожу (односерверный режим)`);
        await guild.leave().catch((err) => logErr(shardId, 'GUILD', err.message));
        return;
      }
      initGuildConfig(guild.id);
      if (guild.roles) await guild.roles.fetch().catch(() => {});
      if (guild.channels) await guild.channels.fetch().catch(() => {});
      setImmediate(() => {
        initVoicePanel(guild).catch((err) => logErr(shardId, 'VOICE_PANEL', `Ошибка инициализации для ${guild.id}: ${err.message}`));
      });
      if (guild.memberCount > 5000) {
        suggestScaleOptimizations(guild.id, guild.memberCount);
      }
    } catch (err) {
      logErr(shardId, 'GUILD_CREATE', `Ошибка при обработке ${guild?.id}: ${err.message}`);
    }
  });

  client.on(Events.GuildDelete, async (guild) => {
    if (!guild) return;
    clearGuildConfigCache(guild.id);
    clearLogConfigCache(guild.id);
    logInfo(shardId, 'GUILD', `Сервер удалён: ${guild.id}. Кэш очищен.`);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message || message.author?.bot || !message.guild) return;
      if (!isPrimaryGuild(message.guild.id)) return;

      const antiSpamResult = await checkAntiSpam(message);
      if (antiSpamResult) return;

      await trackMessageAchievements(message).catch((e) => logErr(shardId, 'ACH', e.message));

      const gConfig = getGuildConfig(message.guild.id);
      const features = gConfig?.features || {};
      if (!features.leveling && !features.economy) return;

      const now = Date.now();
      pruneMessageCooldowns(now);
      const lastMsg = messageCooldowns.get(`${message.guild.id}:${message.author.id}`);
      if (lastMsg && now - lastMsg < MESSAGE_XP_COOLDOWN) return;
      messageCooldowns.set(`${message.guild.id}:${message.author.id}`, now);

      const xpAmount = Math.floor(Math.random() * (MESSAGE_XP_MAX - MESSAGE_XP_MIN + 1)) + MESSAGE_XP_MIN;
      const xpResult = addXp(message.author.id, xpAmount, message.guild.id);

      const db = getDb();
      db.prepare(`
        INSERT INTO user_activity (user_id, messages_count, last_message_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          messages_count = messages_count + 1,
          last_message_at = datetime('now')
      `).run(message.author.id);

      db.prepare('UPDATE users SET total_messages = total_messages + 1, season_messages = COALESCE(season_messages, 0) + 1 WHERE guild_id = ? AND user_id = ?')
        .run(message.guild.id, message.author.id);
      bumpQuest(message.author.id, message.guild.id, 'messages', 1);
      checkEconomyAchievements(message.author.id, message.guild.id);

      if (features.activityRoles) {
        const member = message.guild.members.cache.get(message.author.id);
        if (member) {
          await updateActivityAndCheckRank(member).catch((e) => logErr(shardId, 'ACTIVITY', e.message));
        }
      }

      if (xpResult) {
        const member = message.guild.members.cache.get(message.author.id)
          || await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member) {
          await checkLevelMilestones(
            member,
            xpResult.oldLevel,
            xpResult.newLevel,
          ).catch((e) => logErr(shardId, 'LEVEL', e.message));
        }
      }
    } catch (err) {
      logErr(shardId, 'MESSAGE', `Ошибка: ${err.message}`);
    }
  });

  const bumpReputation = async (reaction, user, delta) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch().catch(() => null);
      const message = reaction.message;
      if (!message?.guild || message.author?.bot) return;
      if (!isPrimaryGuild(message.guild.id)) return;
      if (message.author.id === user.id) return;
      if (message.partial) await message.fetch().catch(() => null);
      if (!message.author?.id) return;
      if (delta > 0) {
        trackReactionAdd(reaction, user);
      }
      if (!getGuildConfig(message.guild.id).features?.reputation) return;
      ensureUser(message.author.id, message.guild.id);
      getDb().prepare(
        'UPDATE users SET total_reactions_received = MAX(0, COALESCE(total_reactions_received, 0) + ?) WHERE guild_id = ? AND user_id = ?',
      ).run(delta, message.guild.id, message.author.id);
      if (delta > 0) checkEconomyAchievements(message.author.id, message.guild.id);
    } catch (err) {
      logErr(shardId, 'REPUTATION', err.message);
    }
  };

  client.on(Events.MessageReactionAdd, (reaction, user) => bumpReputation(reaction, user, 1));
  client.on(Events.MessageReactionRemove, (reaction, user) => bumpReputation(reaction, user, -1));

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      if (!newState?.guild) return;
      if (!isPrimaryGuild(newState.guild.id)) return;

      trackVoiceStateAchievements(oldState, newState);

      const guildConfig = getGuildConfig(newState.guild.id);
      const features = guildConfig?.features || {};
      const guildId = newState.guild.id;

      if (!voiceFarming.has(guildId)) {
        voiceFarming.set(guildId, new Map());
      }
      const guildFarmers = voiceFarming.get(guildId);

      const triggerChannelId = getTriggerChannelId(newState.guild.id);
      const enteredTrigger = triggerChannelId
        && newState.channelId
        && String(newState.channelId) === String(triggerChannelId)
        && String(oldState?.channelId ?? '') !== String(newState.channelId);

      if (enteredTrigger) {
        const member = newState.member
          ?? await newState.guild.members.fetch(newState.id).catch(() => null);
        const triggerChannel = newState.channel
          ?? await newState.guild.channels.fetch(newState.channelId).catch(() => null);

        if (member && triggerChannel) {
          logInfo(shardId, 'JTC', `Триггер ${triggerChannelId}: ${member.user.tag} — создание комнаты`);
          await createVoiceRoom(member, triggerChannel).catch((e) => logErr(shardId, 'JTC', e.message));
        } else {
          logErr(shardId, 'JTC', `Триггер ${triggerChannelId}: не удалось получить member/channel`);
        }
        return;
      }

      if (oldState?.channelId && oldState.channelId !== newState.channelId) {
        const db = getDb();
        const room = db.prepare('SELECT * FROM user_voice_channels WHERE voice_channel_id = ?').get(oldState.channelId);
        if (room && room.owner_id === oldState.member?.user?.id) {
          const voiceChannel = oldState.guild.channels.cache.get(oldState.channelId);
          if (voiceChannel) {
            await handleOwnerLeave(voiceChannel, oldState.guild).catch((e) => logErr(shardId, 'JTC', e.message));
          }
        }
      }

      if (features.voiceFarming) {
        if (oldState?.channelId && !newState.channelId) {
          guildFarmers.delete(oldState.member?.id);
          return;
        }

        if (newState.channelId) {
          const member = newState.member;
          const eligible = isEligibleForFarm(member);
          if (eligible && member) {
            const wasFarming = guildFarmers.has(member.id);
            const wasMuted = Boolean(oldState?.selfMute || oldState?.selfDeaf);
            const nowMuted = Boolean(newState.selfMute || newState.selfDeaf);
            const unmuted = wasMuted && !nowMuted;
            const joinedOrSwitched = String(oldState?.channelId ?? '') !== String(newState.channelId);
            if (!wasFarming || unmuted || joinedOrSwitched) {
              stampVoiceFarmActivity(guildId, member.id);
            }
            guildFarmers.set(member.id, {
              member,
              channelId: newState.channelId,
              startedAt: Date.now(),
            });
          } else {
            guildFarmers.delete(newState.member?.id);
          }
        }
      }
    } catch (err) {
      logErr(shardId, 'VOICE', `Ошибка: ${err.message}`);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      if (!member?.guild) return;
      if (!isPrimaryGuild(member.guild.id)) return;
      await handleGuildMemberAdd(member).catch(() => {});
      checkLoyaltyForMember(member);

      const gConfig = getGuildConfig(member.guild.id);
      if (gConfig?.features?.welcomeNPC) {
        await handleGuildMemberAddNPC(member, gConfig).catch((e) => logErr(shardId, 'WELCOME', e.message));
      }
    } catch (err) {
      logErr(shardId, 'MEMBER_ADD', `Ошибка: ${err.message}`);
    }
  });

  client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
    try {
      const guildId = newPresence?.guild?.id || oldPresence?.guild?.id;
      if (guildId && !isPrimaryGuild(guildId)) return;
      trackPresenceUpdate(oldPresence, newPresence);
    } catch (err) {
      logErr(shardId, 'ACH_PRESENCE', err.message);
    }
  });

  startAchievementLoops(client);

  registerAuditAndLogEvents(client, shardId);
}

function registerAuditAndLogEvents(client, shardId) {
  client.on(Events.MessageDelete, async (message) => {
    try {
      if (!message?.guild) return;
      if (message.author?.bot) return;
      const content = message.content || '(вложение/без текста)';
      await logEvent(message.guild, 'all', {
        eventType: 'message_delete',
        title: '🗑️ Сообщение удалено',
        description: `**${message.author?.tag || 'Неизвестно'}** удалил(а) сообщение в ${message.channel?.toString() || 'неизвестном канале'}`,
        color: 0xe74c3c,
        fields: [
          { name: '📄 Содержимое', value: content.slice(0, 1000) || '(пусто)', inline: false },
        ],
        targetId: message.author?.id,
        targetName: message.author?.tag,
      });
    } catch (err) {
      logErr(shardId, 'LOG_MESSAGE_DELETE', err.message);
    }
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
      if (!newMessage?.guild) return;
      if (newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;
      await logEvent(newMessage.guild, 'all', {
        eventType: 'message_edit',
        title: '✏️ Сообщение изменено',
        description: `**${newMessage.author?.tag}** изменил(а) сообщение в ${newMessage.channel?.toString()}`,
        color: 0xf1c40f,
        fields: [
          { name: '📄 Было', value: (oldMessage.content || '(пусто)').slice(0, 1000), inline: false },
          { name: '📄 Стало', value: (newMessage.content || '(пусто)').slice(0, 1000), inline: false },
        ],
        targetId: newMessage.author?.id,
        targetName: newMessage.author?.tag,
      });
    } catch (err) {
      logErr(shardId, 'LOG_MESSAGE_EDIT', err.message);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      if (!member?.guild) return;
      const accountAge = member.user?.createdAt
        ? Math.floor((Date.now() - member.user.createdAt.getTime()) / 86400000)
        : 0;
      await logEvent(member.guild, 'important', {
        eventType: 'member_join',
        title: '👋 Участник зашёл',
        description: `**${member.user?.tag}** присоединился к серверу`,
        color: 0x2ecc71,
        fields: [
          { name: '👤 Пользователь', value: `<@${member.id}>`, inline: true },
          { name: '📅 Возраст аккаунта', value: `${accountAge} дн.`, inline: true },
        ],
        targetId: member.id,
        targetName: member.user?.tag,
      });
    } catch (err) {
      logErr(shardId, 'LOG_MEMBER_JOIN', err.message);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      if (!member?.guild) return;
      await logEvent(member.guild, 'important', {
        eventType: 'member_leave',
        title: '👋 Участник вышел',
        description: `**${member.user?.tag || 'Неизвестно'}** покинул сервер`,
        color: 0xe74c3c,
        fields: [
          { name: '👤 Пользователь', value: `<@${member.id}>`, inline: true },
        ],
        targetId: member.id,
        targetName: member.user?.tag,
      });
    } catch (err) {
      logErr(shardId, 'LOG_MEMBER_LEAVE', err.message);
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      if (!newMember?.guild) return;
      if (oldMember?.nickname !== newMember.nickname || oldMember?.displayName !== newMember.displayName) {
        await logEvent(newMember.guild, 'all', {
          eventType: 'member_nickname',
          title: '🏷️ Изменён ник',
          description: `**${newMember.user?.tag}** изменил(а) ник`,
          color: 0x3498db,
          fields: [
            { name: 'Было', value: oldMember?.displayName || '—', inline: true },
            { name: 'Стало', value: newMember.displayName || '—', inline: true },
          ],
          targetId: newMember.id,
          targetName: newMember.user?.tag,
        });
      }
      if (oldMember?.roles && newMember.roles) {
        const oldIds = new Set(oldMember.roles.cache.keys());
        const newIds = new Set(newMember.roles.cache.keys());
        const added = [...newIds].filter((id) => !oldIds.has(id));
        const removed = [...oldIds].filter((id) => !newIds.has(id));
        if (added.length > 0 || removed.length > 0) {
          const addedNames = added.map((id) => newMember.guild.roles.cache.get(id)?.name || id);
          const removedNames = removed.map((id) => newMember.guild.roles.cache.get(id)?.name || id);
          await logEvent(newMember.guild, 'all', {
            eventType: 'member_roles',
            title: '🎭 Изменены роли',
            description: `**${newMember.user?.tag}** — изменение ролей`,
            color: 0x9b59b6,
            fields: [
              { name: '➕ Добавлены', value: addedNames.length ? addedNames.join(', ') : '—', inline: true },
              { name: '➖ Убраны', value: removedNames.length ? removedNames.join(', ') : '—', inline: true },
            ],
            targetId: newMember.id,
            targetName: newMember.user?.tag,
          });
        }
      }
    } catch (err) {
      logErr(shardId, 'LOG_MEMBER_UPDATE', err.message);
    }
  });

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      const guild = newState?.guild || oldState?.guild;
      if (!guild) return;
      const member = newState?.member || oldState?.member;
      const userTag = member?.user?.tag || 'Неизвестно';

      if (newState?.channelId && !oldState?.channelId) {
        await logEvent(guild, 'all', {
          eventType: 'voice_join',
          title: '🎤 Зашёл в голосовой канал',
          description: `**${userTag}** зашёл(ла) в ${newState.channel?.toString() || 'канал'}`,
          color: 0x2ecc71,
          targetId: member?.id,
          targetName: userTag,
        });
      } else if (oldState?.channelId && !newState?.channelId) {
        await logEvent(guild, 'all', {
          eventType: 'voice_leave',
          title: '🎤 Вышел из голосового канала',
          description: `**${userTag}** вышел(ла) из ${oldState.channel?.toString() || 'канала'}`,
          color: 0xe74c3c,
          targetId: member?.id,
          targetName: userTag,
        });
      } else if (oldState?.channelId && newState?.channelId && oldState.channelId !== newState.channelId) {
        await logEvent(guild, 'all', {
          eventType: 'voice_move',
          title: '🔀 Перемещение в голосовом канале',
          description: `**${userTag}** переместился из ${oldState.channel?.toString()} в ${newState.channel?.toString()}`,
          color: 0x3498db,
          targetId: member?.id,
          targetName: userTag,
        });
      }
    } catch (err) {
      logErr(shardId, 'LOG_VOICE', err.message);
    }
  });

  client.on(Events.ChannelCreate, async (channel) => {
    try {
      if (!channel?.guild) return;
      await logEvent(channel.guild, 'all', {
        eventType: 'channel_create',
        title: '📁 Канал создан',
        description: `Создан канал ${channel.toString()} (\`${channel.name}\`)`,
        color: 0x2ecc71,
        targetId: channel.id,
        targetName: channel.name,
      });
    } catch (err) {
      logErr(shardId, 'LOG_CHANNEL_CREATE', err.message);
    }
  });

  client.on(Events.ChannelDelete, async (channel) => {
    try {
      if (!channel?.guild) return;
      await logEvent(channel.guild, 'all', {
        eventType: 'channel_delete',
        title: '📁 Канал удалён',
        description: `Удалён канал **${channel.name}**`,
        color: 0xe74c3c,
        targetId: channel.id,
        targetName: channel.name,
      });
    } catch (err) {
      logErr(shardId, 'LOG_CHANNEL_DELETE', err.message);
    }
  });

  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    try {
      if (!newChannel?.guild) return;
      if (oldChannel?.name !== newChannel.name) {
        await logEvent(newChannel.guild, 'all', {
          eventType: 'channel_update',
          title: '📁 Канал изменён',
          description: `Канал **${oldChannel?.name}** → **${newChannel.name}**`,
          color: 0xf1c40f,
          targetId: newChannel.id,
          targetName: newChannel.name,
        });
      }
    } catch (err) {
      logErr(shardId, 'LOG_CHANNEL_UPDATE', err.message);
    }
  });

  client.on(Events.RoleCreate, async (role) => {
    try {
      if (!role?.guild) return;
      await logEvent(role.guild, 'all', {
        eventType: 'role_create',
        title: '🎭 Роль создана',
        description: `Создана роль **${role.name}**`,
        color: 0x2ecc71,
        targetId: role.id,
        targetName: role.name,
      });
    } catch (err) {
      logErr(shardId, 'LOG_ROLE_CREATE', err.message);
    }
  });

  client.on(Events.RoleDelete, async (role) => {
    try {
      if (!role?.guild) return;
      await logEvent(role.guild, 'all', {
        eventType: 'role_delete',
        title: '🎭 Роль удалена',
        description: `Удалена роль **${role.name}**`,
        color: 0xe74c3c,
        targetId: role.id,
        targetName: role.name,
      });
    } catch (err) {
      logErr(shardId, 'LOG_ROLE_DELETE', err.message);
    }
  });

  client.on(Events.GuildAuditLogEntryCreate, async (auditEntry, guild) => {
    try {
      if (!guild) return;
      const { AuditLogEvent } = await import('discord.js');

      const modLabel = {
        [AuditLogEvent.MemberBanAdd]: { title: '🔨 Бан', color: 0xe74c3c, label: 'забанен' },
        [AuditLogEvent.MemberBanRemove]: { title: '🔓 Разбан', color: 0x2ecc71, label: 'разбанен' },
        [AuditLogEvent.MemberKick]: { title: '👢 Кик', color: 0xe74c3c, label: 'кикнут' },
        [AuditLogEvent.MemberUpdate]: { title: '🔇 Мут/Таймаут', color: 0xe67e22, label: 'изменён (возможно мут)' },
        [AuditLogEvent.MemberRoleUpdate]: { title: '🎭 Изменены роли', color: 0x9b59b6, label: 'роли изменены' },
        [AuditLogEvent.ChannelCreate]: { title: '📁 Канал создан', color: 0x2ecc71, label: 'канал создан' },
        [AuditLogEvent.ChannelDelete]: { title: '📁 Канал удалён', color: 0xe74c3c, label: 'канал удалён' },
        [AuditLogEvent.RoleCreate]: { title: '🎭 Роль создана', color: 0x2ecc71, label: 'роль создана' },
        [AuditLogEvent.RoleDelete]: { title: '🎭 Роль удалена', color: 0xe74c3c, label: 'роль удалена' },
      };

      const meta = modLabel[auditEntry.action];
      if (!meta) return;

      const executor = auditEntry.executor?.tag || 'Неизвестно';
      const targetName = auditEntry.target?.tag || auditEntry.target?.username || auditEntry.targetId || 'Неизвестно';
      const reason = auditEntry.reason || 'Не указана';

      await logEvent(guild, 'moderation', {
        eventType: 'moderation',
        title: meta.title,
        description: `**${targetName}** ${meta.label} модератором **${executor}**`,
        color: meta.color,
        fields: [
          { name: '🎯 Цель', value: `<@${auditEntry.targetId}>` || targetName, inline: true },
          { name: '🛠 Модератор', value: executor, inline: true },
          { name: '📄 Причина', value: reason, inline: false },
        ],
        targetId: auditEntry.targetId,
        targetName,
      });
    } catch (err) {
      logErr(shardId, 'LOG_MODERATION', err.message);
    }
  });
}

let farmLoopStarted = false;

/** После рестарта подхватывает тех, кто уже сидит в войсе. */
export async function restoreVoiceFarmSessions(client) {
  if (!client?.guilds?.cache) return 0;
  let restored = 0;

  for (const guild of client.guilds.cache.values()) {
    if (!isPrimaryGuild(guild.id)) continue;
    const features = getGuildConfig(guild.id)?.features || {};
    if (!features.voiceFarming) continue;

    if (!voiceFarming.has(guild.id)) voiceFarming.set(guild.id, new Map());
    const farmers = voiceFarming.get(guild.id);

    await guild.voiceStates.fetch().catch(() => null);
    for (const [, vs] of guild.voiceStates.cache) {
      if (!vs.channelId || !vs.member) continue;
      if (!isEligibleForFarm(vs.member)) continue;
      stampVoiceFarmActivity(guild.id, vs.member.id);
      farmers.set(vs.member.id, {
        member: vs.member,
        channelId: vs.channelId,
        startedAt: Date.now(),
      });
      restored += 1;
    }
  }

  return restored;
}

export function startVoiceFarmLoop() {
  if (farmLoopStarted) return;
  farmLoopStarted = true;
  setInterval(async () => {
    try {
      const db = getDb();

      for (const [guildId, farmers] of voiceFarming) {
        for (const [userId, session] of farmers) {
          try {
            const member = session?.member;
            if (!member || !isEligibleForFarm(member)) {
              farmers.delete(userId);
              continue;
            }

            const user = db.prepare('SELECT last_voice_reset_time FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
            let effectiveRate = Math.max(1, Math.round(FARM_RATE * getFarmMultiplier(member)));

            // Анти-AFK: last_voice_reset_time ставится только при входе/unmute (не каждую минуту)
            if (user?.last_voice_reset_time) {
              const lastReset = new Date(user.last_voice_reset_time + 'Z').getTime();
              const minutesSinceReset = (Date.now() - lastReset) / 60_000;
              if (minutesSinceReset > ANTI_AFK_FULL_RATE_MINUTES) {
                effectiveRate = Math.max(1, Math.floor(effectiveRate * ANTI_AFK_REDUCED_MULTIPLIER));
              }
            }

            addCoins(userId, effectiveRate, guildId);
            const xpResult = addXp(userId, effectiveRate, guildId);
            db.prepare("UPDATE users SET last_voice_farm = datetime('now'), total_voice_minutes = total_voice_minutes + 1, season_voice = COALESCE(season_voice, 0) + 1 WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
            db.prepare('INSERT INTO voice_farm_log (user_id, channel_id, earned) VALUES (?, ?, ?)').run(userId, session.channelId, effectiveRate);
            bumpQuest(userId, guildId, 'voice_minutes', 1);
            checkEconomyAchievements(userId, guildId);

            if (xpResult) {
              await checkLevelMilestones(
                member,
                xpResult.oldLevel,
                xpResult.newLevel,
              ).catch((e) => logErr(null, 'LEVEL', e.message));
            }
          } catch (err) {
            logErr(null, 'FARM', `Ошибка обработки ${userId}: ${err.message}`);
            farmers.delete(userId);
          }
        }
      }
    } catch (err) {
      logErr(null, 'FARM', `Ошибка в интервале: ${err.message}`);
    }
  }, 60_000);
}
