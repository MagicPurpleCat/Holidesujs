// === МОДУЛЬ: SETTINGS (Приватность и настройки) ===
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getDb, ensureUser } from '../database.js';

/**
 * Строит embed и компоненты для настроек.
 * Экспортируется для использования в index.js при обработке кнопок toggle.
 * @param {string} userId - ID пользователя
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[], flags: number }}
 */
export function buildSettingsMessage(userId) {
  const db = getDb();
  ensureUser(userId);

  let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`).run(userId);
    settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Настройки профиля')
    .setDescription('Управляй приватностью и уведомлениями:')
    .addFields(
      {
        name: '💍 Брачные предложения',
        value: settings.allow_marriage_requests ? '✅ Разрешены' : '❌ Запрещены',
        inline: true,
      },
      {
        name: '❤️ Показывать отношения',
        value: settings.show_relationship ? '✅ Видно в профиле' : '❌ Скрыто',
        inline: true,
      },
      {
        name: '📬 Уведомления в ЛС',
        value: settings.allow_dm_notifications ? '✅ Включены' : '❌ Отключены',
        inline: true,
      },
      {
        name: '🔗 Упоминания в профиле',
        value: settings.allow_profile_mentions ? '✅ Разрешены' : '❌ Запрещены',
        inline: true,
      },
    )
    .setFooter({ text: 'Нажми на кнопку, чтобы переключить настройку' })

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_toggle_marriage')
        .setLabel(settings.allow_marriage_requests ? '🚫 Запретить браки' : '💍 Разрешить браки')
        .setStyle(settings.allow_marriage_requests ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('settings_toggle_relationship')
        .setLabel(settings.show_relationship ? '🙈 Скрыть отношения' : '👀 Показать отношения')
        .setStyle(settings.show_relationship ? ButtonStyle.Secondary : ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_toggle_dm')
        .setLabel(settings.allow_dm_notifications ? '🔇 Откл. уведомления' : '🔔 Вкл. уведомления')
        .setStyle(settings.allow_dm_notifications ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('settings_toggle_mentions')
        .setLabel(settings.allow_profile_mentions ? '🚫 Запретить упоминания' : '✅ Разрешить упоминания')
        .setStyle(settings.allow_profile_mentions ? ButtonStyle.Danger : ButtonStyle.Primary),
    ),
  ];

  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

export default {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('⚙️ Настройки профиля и приватности'),

  async execute(interaction) {
    try {
      const result = buildSettingsMessage(interaction.user.id);
      await interaction.reply(result);
    } catch (error) {
      console.error('[SETTINGS] Ошибка:', error);
      await interaction.reply({
        content: '❌ Не удалось загрузить настройки.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

