import { EmbedBuilder } from 'discord.js';
import { getDb, addCoins } from '../database.js';
import {
  isoWeekKey,
  getSeasonTop,
  resetSeasonCounters,
  seasonScore,
} from './progress.js';
import { getGuildConfig } from '../utils/guildConfig.js';
import { logErr } from '../utils/botLog.js';

const REWARDS = [1500, 1000, 500];
let started = false;

export async function settleSeasons(client) {
  const week = isoWeekKey();
  const db = getDb();
  const guilds = client.guilds?.cache;
  if (!guilds) return;

  for (const guild of guilds.values()) {
    try {
      const state = db.prepare('SELECT * FROM season_state WHERE guild_id = ?').get(guild.id);
      if (!state) {
        db.prepare('INSERT INTO season_state (guild_id, week_key) VALUES (?, ?)').run(guild.id, week);
        continue;
      }
      if (state.week_key === week) continue;
      if (state.paid_week === state.week_key) {
        db.prepare('UPDATE season_state SET week_key = ? WHERE guild_id = ?').run(week, guild.id);
        resetSeasonCounters(guild.id);
        continue;
      }

      const top = getSeasonTop(guild.id, 3).filter((u) => seasonScore(u) > 0);
      const cfg = getGuildConfig(guild.id);
      const lines = [];
      for (let i = 0; i < top.length; i++) {
        const prize = REWARDS[i] || 0;
        if (prize > 0) addCoins(top[i].user_id, prize, guild.id);
        lines.push(`${i + 1}. <@${top[i].user_id}> — **${prize} ⚡HLD**`);
        if (i === 0 && cfg.seasonRoleId) {
          const member = await guild.members.fetch(top[i].user_id).catch(() => null);
          const role = guild.roles.cache.get(cfg.seasonRoleId);
          if (member && role) {
            await member.roles.add(role, 'Победитель сезона').catch(() => {});
          }
        }
      }

      db.prepare('UPDATE season_state SET week_key = ?, paid_week = ? WHERE guild_id = ?')
        .run(week, state.week_key, guild.id);
      resetSeasonCounters(guild.id);

      const channelId = cfg.logChannelId || cfg.cmdChannelId;
      const channel = channelId ? guild.channels.cache.get(channelId) : null;
      if (channel && lines.length) {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle(`🏅 Итоги сезона ${state.week_key}`)
              .setDescription(lines.join('\n')),
          ],
        }).catch(() => {});
      }
    } catch (err) {
      logErr(null, 'SEASON', err.message);
    }
  }
}

export function startSeasonLoop(client) {
  if (started) return;
  started = true;
  settleSeasons(client).catch(() => {});
  setInterval(() => {
    settleSeasons(client).catch(() => {});
  }, 15 * 60 * 1000);
}
