// === МОДУЛЬ: HISTORY (История наказаний пользователя) ===
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getDb } from '../database.js';
import { getUserLevel } from '../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('История наказаний участника')
    .addUserOption((opt) =>
      opt.setName('пользователь')
        .setDescription('Пользователь для просмотра истории')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const level = getUserLevel(interaction.user.id, interaction.guild);
      const canMod = interaction.member?.permissions?.has(PermissionFlagsBits.ModerateMembers);
      if (level < 1 && !canMod) {
        return interaction.reply({
          content: '❌ История наказаний доступна модераторам.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const target = interaction.options.getUser('пользователь');
      const db = getDb();

      // Сначала пытаемся из новой таблицы punishments
      let punishments = db.prepare(`
        SELECT * FROM punishments WHERE user_id = ? AND (guild_id = ? OR guild_id = '') ORDER BY created_at DESC LIMIT 20
      `).all(target.id, interaction.guildId);

      // Если нет — пробуем из moderation_log
      if (punishments.length === 0) {
        const oldLogs = db.prepare(`
          SELECT * FROM moderation_log WHERE target_id = ? ORDER BY timestamp DESC LIMIT 20
        `).all(target.id);

        punishments = oldLogs.map((l) => ({
          id: l.id,
          user_id: l.target_id,
          moderator_id: l.moderator_id,
          action: l.action,
          reason: l.reason,
          duration_seconds: l.duration_seconds,
          active: 0,
          created_at: l.timestamp,
          expires_at: null,
        }));
      }

      if (punishments.length === 0) {
        return interaction.reply({
          content: `✅ У **${target.displayName}** нет наказаний. Чистая репутация!`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const actionEmoji = {
        warn: '⚠️', mute: '🔇', kick: '👢', ban: '🔨',
        unmute: '🔊', unban: '🔓', timeout: '⏰',
      };

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`📜 История наказаний — ${target.displayName}`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(`Всего записей: **${punishments.length}**`)

      for (const p of punishments.slice(0, 5)) {
        const emoji = actionEmoji[p.action] || '📝';
        const mod = `<@${p.moderator_id}>`;
        const duration = p.duration_seconds
          ? `\n⏱ Длительность: **${Math.floor(p.duration_seconds / 60)} мин.**`
          : '';
        const status = p.active ? '🟢 **Активно**' : '🔴 Завершено';

        embed.addFields({
          name: `${emoji} ${p.action.toUpperCase()} #${p.id}`,
          value: `👤 Модератор: ${mod}\n📄 Причина: ${p.reason || 'Не указана'}${duration}\n📅 ${new Date(p.created_at).toLocaleString('ru-RU')}\n${status}`,
          inline: false,
        });
      }

      if (punishments.length > 5) {
        embed.setFooter({ text: `Показано 5 из ${punishments.length} записей` });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('[HISTORY] Ошибка:', error);
      await interaction.reply({
        content: '❌ Не удалось загрузить историю наказаний.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

