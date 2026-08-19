import { getDb } from '../database.js';
import { overallScore } from './score.js';
import { utcDayKey } from './progress.js';
import { logErr } from '../utils/botLog.js';

let started = false;

async function snapshotGuildStatsDaily(guild) {
  if (!guild?.id) return;

  const db = getDb();
  const dayKey = utcDayKey();

  // Берём только пользователей с конечным балансом
  const rows = db.prepare(`
    SELECT user_id, balance, total_xp, total_messages, total_voice_minutes, total_reactions_received
    FROM users
    WHERE guild_id = ? AND is_infinite_balance = 0
  `).all(guild.id);

  const memberCount = rows.length;
  if (memberCount === 0) {
    db.prepare(`
      INSERT INTO server_stats_daily (
        guild_id, day_key,
        avg_overall_score, avg_balance, avg_xp, avg_messages, avg_voice_minutes, avg_reputation, member_count
      ) VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0)
      ON CONFLICT(guild_id, day_key) DO UPDATE SET
        avg_overall_score = 0,
        avg_balance = 0,
        avg_xp = 0,
        avg_messages = 0,
        avg_voice_minutes = 0,
        avg_reputation = 0,
        member_count = 0
    `).run(guild.id, dayKey);
    return;
  }

  let sumBalance = 0;
  let sumXp = 0;
  let sumMessages = 0;
  let sumVoiceMinutes = 0;
  let sumReputation = 0;
  let sumOverall = 0;

  for (const u of rows) {
    sumBalance += Number(u.balance || 0);
    sumXp += Number(u.total_xp || 0);
    sumMessages += Number(u.total_messages || 0);
    sumVoiceMinutes += Number(u.total_voice_minutes || 0);
    sumReputation += Number(u.total_reactions_received || 0);
    sumOverall += overallScore(u);
  }

  db.prepare(`
    INSERT INTO server_stats_daily (
      guild_id, day_key,
      avg_overall_score, avg_balance, avg_xp, avg_messages, avg_voice_minutes, avg_reputation, member_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, day_key) DO UPDATE SET
      avg_overall_score = excluded.avg_overall_score,
      avg_balance = excluded.avg_balance,
      avg_xp = excluded.avg_xp,
      avg_messages = excluded.avg_messages,
      avg_voice_minutes = excluded.avg_voice_minutes,
      avg_reputation = excluded.avg_reputation,
      member_count = excluded.member_count
  `).run(
    guild.id,
    dayKey,
    sumOverall / memberCount,
    sumBalance / memberCount,
    sumXp / memberCount,
    sumMessages / memberCount,
    sumVoiceMinutes / memberCount,
    sumReputation / memberCount,
    memberCount,
  );
}

export function startServerStatsDailyLoop(client) {
  if (started) return;
  started = true;

  const run = async () => {
    try {
      const guilds = client.guilds?.cache?.values ? client.guilds.cache.values() : null;
      if (!guilds) return;
      for (const guild of guilds) {
        try {
          await snapshotGuildStatsDaily(guild);
        } catch (e) {
          logErr(null, 'SERVER_STATS_DAILY', `Guild ${guild?.id}: ${e.message}`);
        }
      }
    } catch (err) {
      logErr(null, 'SERVER_STATS_DAILY', err.message);
    }
  };

  run().catch(() => {});
  setInterval(() => {
    run().catch(() => {});
  }, 24 * 60 * 60 * 1000);
}

