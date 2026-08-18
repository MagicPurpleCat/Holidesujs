// ============================================================================
// Команда /profile — Профиль пользователя с Canvas-генерацией изображения
// Использует модуль modules/canvas-profile-minimal.js для отрисовки
// ============================================================================

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { getDb, getUser, ensureUser } from '../database.js';
import { generateProfileImage } from '../modules/canvas-profile-minimal.js';
import { overallScore } from './top.js';

// ============================================================================
// EMBED-ФОЛБЕК, если модуль canvas недоступен.
// ============================================================================

/**
 * Строит текстовый embed-профиль как запасной вариант.
 * @param {Object} data — те же данные профиля, что для canvas
 * @returns {EmbedBuilder}
 */
function buildProfileEmbed(data) {
  // Защита от RangeError: строго ограничиваем процент 0..100,
  // чтобы .repeat() никогда не получил отрицательное число.
  const pct = Math.max(0, Math.min(100, Number(data?.xpPercent) || 0));
  const filled = Math.min(10, Math.floor(pct / 10));
  const empty = 10 - filled;
  const progress = '█'.repeat(filled) + '░'.repeat(empty);

  const embed = new EmbedBuilder()
    .setColor(0xff5733)
    .setTitle(`👤 Профиль — ${data.username || 'Пользователь'}`)
    .setThumbnail(data.avatarUrl || null)
    .addFields(
      { name: '⚡ Баланс', value: `**${(data.balance || 0).toLocaleString()} ⚡HLD**`, inline: true },
      { name: '🎚 Уровень', value: `**${data.level || 1}**`, inline: true },
      { name: '🏆 Место', value: data.rank ? `**${data.rank}**` : '—', inline: true },
      { name: '📈 Прогресс XP', value: `${progress} **${data.xpPercent || 0}%**`, inline: false },
      { name: '🎤 Минут в голосовых', value: `**${(data.voiceMinutes || 0).toLocaleString()}**`, inline: true },
      { name: '📊 Сообщений', value: `**${(data.messages || 0).toLocaleString()}**`, inline: true },
      { name: '👍 Репутация', value: `**${(data.reputation || 0).toLocaleString()}**`, inline: true },
    );

  if (data.marriageWith && data.marriageWith !== 'Отсутствует') {
    embed.addFields({ name: '❤️ Брак', value: data.marriageWith, inline: false });
  }
  if (data.about) {
    embed.addFields({ name: '📝 О себе', value: data.about.slice(0, 200), inline: false });
  }
  if (data.joinDate) {
    embed.setFooter({ text: `На сервере с: ${data.joinDate}` });
  }

  return embed;
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ: Сбор данных профиля
// ============================================================================

/**
 * Собирает все данные профиля для генерации изображения
 * @param {import('discord.js').User} target - Целевой пользователь
 * @param {import('discord.js').GuildMember} member - Участник гильдии
 * @param {import('better-sqlite3').Database} db - База данных
 * @returns {Object} profileData
 */
function collectProfileData(target, member, db, guildId) {
  const user = getUser(target.id, guildId);
  const activity = db.prepare('SELECT * FROM user_activity WHERE user_id = ?').get(target.id);
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(target.id);

  // Расчет XP для прогресс-бара
  const currentLevel = user.level || 1;
  const currentXp = user.xp || 0;
  const xpForNextLevel = currentLevel >= 100 ? 1 : currentLevel * 100;
  const xpPercent = currentLevel >= 100 ? 100 : Math.min(100, (currentXp / xpForNextLevel) * 100);

  // Получаем никнейм (отображаемое имя)
  const nickname = member?.displayName || target.username;

// Получаем партнера по браку
  let marriageWith = 'Отсутствует';
  if (user.relationship_status === 'married' && user.relationship_partner_id) {
    const partner = db.prepare('SELECT user_id FROM users WHERE guild_id = ? AND user_id = ?')
      .get(guildId, user.relationship_partner_id);
    if (partner) {
      const partnerMember = member?.guild?.members?.cache?.get(user.relationship_partner_id);
      marriageWith = partnerMember?.displayName || user.relationship_partner_id;
    }
  }

  // Место в общем топе (по баллам, как в /топ)
  let rank = null;
  try {
    const users = db.prepare(`
      SELECT user_id, balance, total_xp, total_messages, total_reactions_received
      FROM users WHERE is_infinite_balance = 0 AND guild_id = ?
    `).all(guildId);
    const scores = users.map((u) => ({ id: u.user_id, score: overallScore(u) }));
    scores.sort((a, b) => b.score - a.score);
    const pos = scores.findIndex((s) => s.id === target.id);
    if (pos !== -1) rank = pos + 1;
  } catch (_) {}

  return {
    avatarUrl: target.displayAvatarURL({ size: 512, extension: 'png' }),
    username: nickname,
    nickname: `@${target.username}`,
    balance: user.balance || 0,
    privilege: 'Нет', // Поле для будущего расширения
    level: currentLevel,
    xpPercent: Math.round(xpPercent * 10) / 10,
    rank,
    voiceMinutes: activity?.voice_minutes_total || user.total_voice_minutes || 0,
    messages: activity?.messages_count || user.total_messages || 0,
    reputation: user.total_reactions_received || 0,
    marriageWith,
    favoritePerson: marriageWith, // Используем партнера как "любимого человека"
    joinDate: user.joined_at
      ? new Date(user.joined_at + 'Z').toLocaleDateString('ru-RU', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null,
    about: user.personal_note || null,
  };
}

// ============================================================================
// СЛАШ-КОМАНДА
// ============================================================================

export default {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('👤 Показать профиль пользователя с изображением')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Пользователь, чей профиль показать')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const target = interaction.options.getUser('user') || interaction.user;
      const member = interaction.guild.members.cache.get(target.id);
      const db = getDb();

      // Собираем данные профиля
      const profileData = collectProfileData(target, member, db, interaction.guildId);

      const imageBuffer = await generateProfileImage(profileData);

      if (!imageBuffer) {
        const fallbackEmbed = buildProfileEmbed(profileData);
        await interaction.editReply({
          embeds: [fallbackEmbed],
          content: '⚠️ **Изображение профиля недоступно** (модуль canvas не установлен). Показан текстовый профиль.',
        });
        return;
      }

      // Создаем вложение
      const attachment = new AttachmentBuilder(imageBuffer, {
        name: 'profile.png',
        description: `Профиль ${profileData.username}`,
      });

      // Кнопки управления профилем
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('profile_settings')
          .setLabel('⚙ Настроить')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('profile_gender')
          .setLabel('👤 Указать гендер')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({
        files: [attachment],
        components: [row],
      });
    } catch (error) {
      console.error('[PROFILE] Ошибка генерации профиля:', error);
      await interaction.editReply({
        content: '❌ Произошла ошибка при генерации профиля. Попробуй позже.',
      });
    }
  },
};

// ============================================================================
// ОБРАБОТЧИКИ КНОПОК
// ============================================================================

/**
 * Обрабатывает кнопки профиля (Сделать картинку, Настроить, Указать гендер)
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} true если кнопка обработана
 */
export async function handleProfileButtons(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('profile_')) return false;

  try {
    const db = getDb();

    if (customId === 'profile_image') {
      // Генерация изображения профиля
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

const target = interaction.user;
      const member = interaction.guild.members.cache.get(target.id);
      const profileData = collectProfileData(target, member, db, interaction.guildId);
      const imageBuffer = await generateProfileImage(profileData);

      if (!imageBuffer) {
        const fallbackEmbed = buildProfileEmbed(profileData);
        await interaction.editReply({
          embeds: [fallbackEmbed],
          content: '⚠️ **Изображение профиля недоступно** (модуль canvas не установлен). Показан текстовый профиль.',
        });
        return true;
      }

      const attachment = new AttachmentBuilder(imageBuffer, {
        name: 'profile.png',
        description: `Профиль ${profileData.username}`,
      });

      await interaction.editReply({ files: [attachment] });
      return true;
    }

    if (customId === 'profile_settings') {
      // Модальное окно настроек профиля
      const modal = new ModalBuilder()
        .setCustomId('profile_settings_modal')
        .setTitle('⚙ Настройки профиля');

      const aboutInput = new TextInputBuilder()
        .setCustomId('profile_about')
        .setLabel('📝 О себе (до 200 символов)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(200)
        .setRequired(false)
        .setPlaceholder('Расскажи о себе...');

      const statusInput = new TextInputBuilder()
        .setCustomId('profile_status')
        .setLabel('🎯 Статус (до 50 символов)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(50)
        .setRequired(false)
        .setPlaceholder('Например: В поиске приключений');

      const row1 = new ActionRowBuilder().addComponents(aboutInput);
      const row2 = new ActionRowBuilder().addComponents(statusInput);

      modal.addComponents(row1, row2);
      await interaction.showModal(modal);
      return true;
    }

    if (customId === 'profile_gender') {
      // Меню выбора гендера
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('profile_gender_select')
        .setPlaceholder('👤 Выберите гендер')
        .addOptions([
          { label: 'Мужской', value: 'male', emoji: '👨' },
          { label: 'Женский', value: 'female', emoji: '👩' },
          { label: 'Другой', value: 'other', emoji: '🧑' },
          { label: 'Скрыть', value: 'hidden', emoji: '🔒' },
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({
        content: '👤 Выберите ваш гендер для отображения в профиле:',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error('[PROFILE] Ошибка обработки кнопки:', error);
    await interaction.reply({
      content: '❌ Произошла ошибка.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
}

// ============================================================================
// ОБРАБОТЧИКИ МОДАЛЬНЫХ ОКОН
// ============================================================================

/**
 * Обрабатывает модальные окна профиля
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} true если модалка обработана
 */
export async function handleProfileModals(interaction) {
  if (interaction.customId !== 'profile_settings_modal') return false;

  try {
    const db = getDb();
    const userId = interaction.user.id;
    const about = interaction.fields.getTextInputValue('profile_about') || '';
    const status = interaction.fields.getTextInputValue('profile_status') || '';

    // Авто-миграция: добавляем колонку personal_note в users (если её ещё нет)
    const userTableInfo = db.prepare("PRAGMA table_info('users')").all();
    if (!userTableInfo.some(col => col.name === 'personal_note')) {
      db.exec("ALTER TABLE users ADD COLUMN personal_note TEXT DEFAULT NULL");
    }
    if (!userTableInfo.some(col => col.name === 'status_text')) {
      db.exec("ALTER TABLE users ADD COLUMN status_text TEXT DEFAULT NULL");
    }

    // Сохраняем заметку и статус в таблицу users
    ensureUser(userId, interaction.guildId);
    db.prepare('UPDATE users SET personal_note = ?, status_text = ? WHERE guild_id = ? AND user_id = ?')
      .run(about, status, interaction.guildId, userId);

    await interaction.reply({
      content: '✅ Настройки профиля сохранены! Используйте `/profile` чтобы увидеть изменения.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  } catch (error) {
    console.error('[PROFILE] Ошибка сохранения настроек:', error);
    await interaction.reply({
      content: '❌ Ошибка при сохранении настроек.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
}

// ============================================================================
// ОБРАБОТЧИКИ SELECT MENU
// ============================================================================

/**
 * Обрабатывает SelectMenu профиля (выбор гендера)
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} true если меню обработано
 */
export async function handleProfileSelectMenus(interaction) {
  if (interaction.customId !== 'profile_gender_select') return false;

  try {
    const db = getDb();
    const userId = interaction.user.id;
    const gender = interaction.values[0];

    // Сохраняем гендер в users
    const genderValue = gender === 'hidden' ? null : gender;
    db.prepare('UPDATE users SET gender = ? WHERE guild_id = ? AND user_id = ?')
      .run(genderValue, interaction.guildId, userId);

    const genderDisplay = {
      male: '👨 Мужской',
      female: '👩 Женский',
      other: '🧑 Другой',
      hidden: '🔒 Скрыт',
    };

    await interaction.update({
      content: `✅ Гендер установлен: **${genderDisplay[gender]}**`,
      components: [],
    });
    return true;
  } catch (error) {
    console.error('[PROFILE] Ошибка выбора гендера:', error);
    await interaction.reply({
      content: '❌ Ошибка при выборе гендера.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
}

