import { Events } from 'discord.js';
import { getGuildConfig } from '../utils/guildConfig.js';
import { logErr } from '../utils/botLog.js';

const state = new Map(); // guildId -> { lastHuman, lastBot, timer }
let started = false;

function getCountsFromCache(guild) {
  const members = guild.members?.cache;
  if (!members) return { humans: 0, bots: 0 };

  let humans = 0;
  let bots = 0;
  members.forEach((m) => {
    if (!m?.user) return;
    if (m.user.bot) bots += 1;
    else humans += 1;
  });
  return { humans, bots };
}

async function syncGuildVoiceStats(guild) {
  if (!guild?.id) return;

  const cfg = getGuildConfig(guild.id);
  const membersChannelId = cfg.statsMembersVoiceChannelId;
  const botsChannelId = cfg.statsBotsVoiceChannelId;

  if (!membersChannelId && !botsChannelId) return;

  const membersCh = membersChannelId
    ? (guild.channels.cache.get(membersChannelId) || await guild.channels.fetch(membersChannelId).catch(() => null))
    : null;
  const botsCh = botsChannelId
    ? (guild.channels.cache.get(botsChannelId) || await guild.channels.fetch(botsChannelId).catch(() => null))
    : null;

  if (!membersCh && !botsCh) return;

  const { humans, bots } = getCountsFromCache(guild);
  const desiredHumansName = `Люди: ${humans}`;
  const desiredBotsName = `Боты: ${bots}`;

  const last = state.get(guild.id) || {};

  const tasks = [];
  if (membersCh && membersCh.name !== desiredHumansName && last.lastHuman !== humans) {
    tasks.push(membersCh.setName(desiredHumansName).catch(() => {}));
  }
  if (botsCh && botsCh.name !== desiredBotsName && last.lastBot !== bots) {
    tasks.push(botsCh.setName(desiredBotsName).catch(() => {}));
  }

  await Promise.all(tasks);
  state.set(guild.id, { ...last, lastHuman: humans, lastBot: bots });
}

export function initServerVoiceStats(client) {
  if (started) return;
  started = true;

  // Первый синк
  for (const guild of client.guilds.cache.values()) {
    syncGuildVoiceStats(guild).catch((e) => logErr(null, 'VOICE_STATS', e.message));
  }

  // Синк при изменениях участников
  const scheduleSync = (guildId, guild) => {
    if (!guildId) return;
    const current = state.get(guildId) || {};
    if (current.timer) clearTimeout(current.timer);

    current.timer = setTimeout(() => {
      syncGuildVoiceStats(guild).catch((e) => logErr(null, 'VOICE_STATS', e.message));
    }, 5000); // дебаунс 5 сек

    state.set(guildId, current);
  };

  client.on(Events.GuildMemberAdd, (member) => {
    if (!member?.guild) return;
    scheduleSync(member.guild.id, member.guild);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (!member?.guild) return;
    scheduleSync(member.guild.id, member.guild);
  });

  // Доп. синк раз в 2 минуты (на случай, если cache не обновилась)
  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      syncGuildVoiceStats(guild).catch((e) => logErr(null, 'VOICE_STATS', e.message));
    }
  }, 2 * 60 * 1000);
}

