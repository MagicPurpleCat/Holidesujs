// === МОДУЛЬ: RELATIONSHIPS (Обработка кнопок брака) ===
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb, ensureUser } from '../database.js';
import { unlockAchievement, getOrCreateFamilyBank, splitFamilyBank } from './progress.js';

/**
 * Обрабатывает нажатие кнопок "Принять" / "Отклонить" для предложения брака.
 * @param {import('discord.js').Interaction} interaction
 */
export async function handleMarryButton(interaction) {
  try {
    const { customId, user, guild } = interaction;
    if (!customId.startsWith('marry_')) return false;

    const parts = customId.split('_');
    const action = parts[1]; // accept / reject
    const proposerId = parts[2];
    const targetId = parts[3];

    // Проверка: только цель может нажать на кнопку
    if (user.id !== targetId) {
      await interaction.reply({
        content: '❌ Только тот, кому сделали предложение, может ответить!',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const db = getDb();
    const g = guild?.id || interaction.guildId;
    ensureUser(proposerId, g);
    ensureUser(targetId, g);

    const proposer = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, proposerId);
    const target = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, targetId);

    // Повторная проверка статуса
    if (proposer.relationship_status === 'married' || target.relationship_status === 'married') {
      await interaction.reply({
        content: '❌ Один из вас уже состоит в браке. Предложение недействительно.',
        flags: MessageFlags.Ephemeral,
      });
      // Обновляем сообщение
      try {
        const msg = await interaction.fetchReply().catch(() => null);
        if (msg && msg.editable) {
          const expiredEmbed = EmbedBuilder.from(msg.embeds[0])
            .setColor(0x808080)
            .setTitle('💔 Предложение недействительно')
            .setDescription('Один из участников уже в браке.');
          await msg.edit({ embeds: [expiredEmbed], components: [] }).catch(() => {});
        }
      } catch { /* ignore */ }
      return true;
    }

    if (action === 'accept') {
      // 💞 Принять — записываем брак
      db.prepare(`UPDATE users SET relationship_status = 'married', relationship_partner_id = ? WHERE guild_id = ? AND user_id = ?`)
        .run(targetId, g, proposerId);
      db.prepare(`UPDATE users SET relationship_status = 'married', relationship_partner_id = ? WHERE guild_id = ? AND user_id = ?`)
        .run(proposerId, g, targetId);

      // Запись в таблицу relationships
      db.prepare(`INSERT INTO relationships (user1_id, user2_id, status) VALUES (?, ?, 'married')`)
        .run(proposerId, targetId);
      getOrCreateFamilyBank(g, proposerId, targetId);
      unlockAchievement(proposerId, g, 'first_marriage');
      unlockAchievement(targetId, g, 'first_marriage');

      const embed = new EmbedBuilder()
        .setColor(0xff69b4)
        .setTitle('💞 Поздравляем! Свадьба состоялась!')
        .setDescription(
          `**<@${proposerId}>** и **<@${targetId}>** теперь муж и жена! 🎉\n\n` +
          `💕 Любите друг друга и будьте счастливы!`
        )

      // Обновляем оригинальное сообщение
      try {
        const msg = await interaction.fetchReply().catch(() => null);
        if (msg && msg.editable) {
          await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
        }
      } catch { /* ignore */ }

      await interaction.reply({ content: '💞 **Поздравляю!** Вы теперь муж и жена!', flags: MessageFlags.Ephemeral });

    } else if (action === 'reject') {
      // 💔 Отклонить
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💔 Предложение отклонено')
        .setDescription(
          `**<@${targetId}>** отклонил(а) предложение **<@${proposerId}>**.\n\n` +
          `Не отчаивайся, в мире много других сердец! 💪`
        )

      try {
        const msg = await interaction.fetchReply().catch(() => null);
        if (msg && msg.editable) {
          await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
        }
      } catch { /* ignore */ }

      await interaction.reply({ content: '💔 Предложение отклонено.', flags: MessageFlags.Ephemeral });
    }

    return true;
  } catch (error) {
    console.error('[RELATIONSHIPS] Ошибка:', error);
    return false;
  }
}

/**
 * Развод (команда для админов или сам развод).
 * @param {string} userId — ID пользователя, который инициирует развод
 */
export function divorceUser(userId, guildId = '') {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    if (!user || user.relationship_status !== 'married') return { success: false, reason: 'not_married' };

    const partnerId = user.relationship_partner_id;
    if (partnerId) splitFamilyBank(guildId, userId, partnerId);

    // Обновляем обоих
    db.prepare(`UPDATE users SET relationship_status = 'divorced', relationship_partner_id = NULL WHERE guild_id = ? AND user_id = ?`)
      .run(guildId, userId);
    if (partnerId) {
      db.prepare(`UPDATE users SET relationship_status = 'divorced', relationship_partner_id = NULL WHERE guild_id = ? AND user_id = ?`)
        .run(guildId, partnerId);
    }

    // Обновляем запись в relationships
    db.prepare(`UPDATE relationships SET status = 'divorced', divorced_at = datetime('now') 
      WHERE (user1_id = ? OR user2_id = ?) AND status = 'married'`)
      .run(userId, userId);

    return { success: true, partnerId };
  } catch (error) {
    console.error('[RELATIONSHIPS] Ошибка развода:', error);
    return { success: false, reason: 'error' };
  }
}

