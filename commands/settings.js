// === МОДУЛЬ: SETTINGS (Приватность и настройки) ===
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getDb, ensureUser } from '../database.js';
import { brandEmbed, COLOR, guildFooter } from '../utils/ui.js';

/**
 * Строит embed и компоненты для настроек.
 */
export function buildSettingsMessage(userId, guildId = '', interaction = null) {
  const db = getDb();
  ensureUser(userId, guildId);

  let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
    settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }

  const on = (v) => (v ? '●' : '○');
  const embed = brandEmbed({
    color: COLOR.accent,
    title: 'Настройки',
    description:
      'Приватность и уведомления. Кнопка сразу переключает пункт.\n\n' +
      '**Брак** (то же в `/marry` → Настройки)\n' +
      `${on(settings.allow_marriage_requests)} Предложения — ${settings.allow_marriage_requests ? 'открыты' : 'закрыты'}\n` +
      `${on(settings.show_relationship)} В профиле — ${settings.show_relationship ? 'видно' : 'скрыто'}\n\n` +
      '**Прочее**\n' +
      `${on(settings.allow_dm_notifications)} ЛС от бота — ${settings.allow_dm_notifications ? 'вкл' : 'выкл'}\n` +
      `${on(settings.allow_profile_mentions)} Упоминания в профиле — ${settings.allow_profile_mentions ? 'разрешены' : 'запрещены'}`,
    footer: interaction ? guildFooter(interaction, 'settings') : 'Holidesu · settings',
  });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_toggle_marriage')
        .setLabel(settings.allow_marriage_requests ? 'Закрыть предложения' : 'Открыть предложения')
        .setStyle(settings.allow_marriage_requests ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('settings_toggle_relationship')
        .setLabel(settings.show_relationship ? 'Скрыть брак в профиле' : 'Показать брак в профиле')
        .setStyle(settings.show_relationship ? ButtonStyle.Secondary : ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_toggle_dm')
        .setLabel(settings.allow_dm_notifications ? 'Выкл. ЛС' : 'Вкл. ЛС')
        .setStyle(settings.allow_dm_notifications ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('settings_toggle_mentions')
        .setLabel(settings.allow_profile_mentions ? 'Запретить упоминания' : 'Разрешить упоминания')
        .setStyle(settings.allow_profile_mentions ? ButtonStyle.Danger : ButtonStyle.Primary),
    ),
  ];

  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

export default {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Приватность профиля, брака и уведомления'),

  async execute(interaction) {
    try {
      const result = buildSettingsMessage(interaction.user.id, interaction.guildId, interaction);
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
