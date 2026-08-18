// === МОДУЛЬ: WELCOME NPC (Приветствие в стиле RPG) ===
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { getDb, ensureUser, addCoins } from '../database.js';
import { getGuildConfig } from '../utils/guildConfig.js';

// ⚠️ ВСТАВЬ СЮДА ID КАНАЛА ДЛЯ ПРИВЕТСТВИЙ (например #welcome)
const WELCOME_CHANNEL_ID = null; // [ВСТАВЬ СЮДА ID КАНАЛА WELCOME]

// ⚠️ ВСТАВЬ СЮДА ID РОЛИ "ВЕЛОСЕР" ДЛЯ ВЫБОРА ПРИ ПРИВЕТСТВИИ
const WELCOMER_ROLE_ID = null; // [ВСТАВЬ СЮДА ID РОЛИ "ВЕЛОСЕР"]

// ══════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт Embed-приветствие для нового участника.
 * ИСПРАВЛЕНО: Удалена устаревшая метка "Holidesu" и статическая дата для улучшения UX.
 * Footer содержит только нейтральный текст.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {boolean} hasMainChannel — есть ли основной канал для кнопки-ссылки
 * @returns {EmbedBuilder}
 */
function createWelcomeEmbed(member, hasMainChannel) {
  let description =
    `**${member.displayName}**, ты появился в мире **${member.guild.name}**!\n\n` +
    `🎭 **Твой класс:** Путешественник\n` +
    `📜 **Квест:** Освоиться на сервере\n` +
    `💰 **Начальный капитал:** 100 ⚡HLD\n\n` +
    `**Что делать?**\n` +
    `🗣 Общайся в чатах — получай XP и ⚡HLD\n` +
    `🎤 Заходи в голосовые каналы — фарми валюту\n` +
    `🎮 Используй \`/help\` для списка команд!\n\n` +
    `*Перед началом приключения выбери свою роль ниже:*`;

  // Если ID основного канала не указан — добавляем предупреждение
  if (!hasMainChannel) {
    description += '\n\n⚠️ **Обратитесь к администрации для получения ссылки на основной канал.**';
  }

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('⚔️ Добро пожаловать в Holidesu!')
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Добро пожаловать на сервер!' })
}

/**
 * Создаёт ActionRow с кнопкой-ссылкой на основной канал.
 *
 * @param {string} guildId — ID сервера
 * @param {string} channelId — ID основного канала
 * @returns {ActionRowBuilder}
 */
function createActionRow(guildId, channelId) {
  const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;

  // Формируем ссылку вида: https://discord.com/channels/{guildId}/{channelId}
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🚪 Перейти в основной канал')
      .setStyle(ButtonStyle.Link)
      .setURL(channelUrl),
  );

  return row;
}

// ══════════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает событие guildMemberAdd — отправляет RPG-приветствие.
 * Сначала пытается отправить в ЛС пользователю. Если ЛС закрыты —
 * отправляет в канал с fallback-сообщением.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {Object} [config=null] — конфиг сервера (должен содержать mainChannelId)
 */
export async function handleGuildMemberAddNPC(member, config = null) {
  try {
    if (member.user.bot) return;

    const db = getDb();
    const g = member.guild.id;
    const existed = db.prepare('SELECT user_id, balance FROM users WHERE guild_id = ? AND user_id = ?').get(g, member.id);
    ensureUser(member.id, g);
    if (!existed) {
      console.log(`[WELCOME] Стартовый капитал 100 ⚡HLD для ${member.user.tag}`);
    } else if ((existed.balance || 0) === 0) {
      addCoins(member.id, 100, g);
      console.log(`[WELCOME] Начислено 100 ⚡HLD при возвращении ${member.user.tag}`);
    }

    // ─── Получаем конфиг, если не передан ──────────────────────
    if (!config) {
      try {
        config = getGuildConfig(member.guild.id);
      } catch {
        config = null;
      }
    }

    // Определяем, есть ли основной канал для кнопки-ссылки
    const mainChannelId = config?.mainChannelId || null;
    const hasMainChannel = Boolean(mainChannelId);

    // Создаём Embed и кнопку
    const embed = createWelcomeEmbed(member, hasMainChannel);
    let components = [];

    if (hasMainChannel) {
      // Создаём кнопку-ссылку "Перейти в основной канал"
      const row = createActionRow(member.guild.id, mainChannelId);
      components = [row];
    }

    // ─── Пытаемся отправить в ЛС пользователю ──────────────────
    try {
      const dmChannel = await member.createDM();
      await dmChannel.send({
        embeds: [embed],
        components: components,
      });
      console.log(`[WELCOME] Приветствие отправлено в ЛС для ${member.user.tag}`);
    } catch (dmError) {
      // ─── Обработка ошибки закрытых ЛС ────────────────────────
      // Код 50007 = DiscordAPIError: Cannot send messages to this user
      if (dmError.code === 50007 || (dmError.message && dmError.message.includes('Cannot send messages to this user'))) {
        console.warn(`[WELCOME] ЛС закрыты для ${member.user.tag}, отправляем в канал.`);

        // Создаём fallback-Embed с предупреждением
        const fallbackEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('⚠️ Личные сообщения закрыты')
          .setDescription(
            `⚠️ **${member.displayName}**, я попытался отправить приветствие в ЛС, ` +
            `но ваши личные сообщения закрыты.\n\nВот ваше приветствие:`
          );

        // Определяем целевой канал для отправки
        const guildCfg = getGuildConfig(member.guild.id);
        const welcomeChannelId = guildCfg.welcomeChannelId || WELCOME_CHANNEL_ID;
        const welcomeChannel = welcomeChannelId
          ? member.guild.channels.cache.get(welcomeChannelId)
          : null;
        const targetChannel = welcomeChannel || member.guild.systemChannel;

        if (targetChannel) {
          await targetChannel.send({
            content: `<@${member.id}>`,
            embeds: [fallbackEmbed, embed],
            components: components,
          });
          console.log(`[WELCOME] Приветствие отправлено в канал ${targetChannel.name} (${targetChannel.id})`);
        } else {
          // Если нет ни welcome-канала, ни системного — логируем ошибку
          console.warn(`[WELCOME] Не найден канал для отправки fallback-приветствия для ${member.user.tag}`);
        }
      } else {
        // Любая другая ошибка при отправке ЛС — пробрасываем дальше
        throw dmError;
      }
    }
  } catch (error) {
    console.error('[WELCOME] Ошибка приветствия:', error.message);
  }
}

/**
 * Обработчик кнопки "Я готов к приключениям" — открывает Modal выбора роли.
 * Оставлен для обратной совместимости (старые сообщения с кнопкой).
 * @param {import('discord.js').Interaction} interaction
 */
export async function handleWelcomeReadyButton(interaction) {
  try {
    if (interaction.customId !== 'welcome_ready') return false;

    // Модальное окно для выбора роли
    const modal = new ModalBuilder()
      .setCustomId('welcome_role_modal')
      .setTitle('⚔️ Выбери свою роль');

    const roleInput = new TextInputBuilder()
      .setCustomId('welcome_role_name')
      .setLabel('Как к тебе обращаться в приключении?')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(32)
      .setPlaceholder('Например: Воин, Маг, Плут...')
      .setRequired(true);

    const classInput = new TextInputBuilder()
      .setCustomId('welcome_class')
      .setLabel('Твой класс (любой текст)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(32)
      .setPlaceholder('Например: Маг Огня, Тёмный Рыцарь...')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(roleInput),
      new ActionRowBuilder().addComponents(classInput),
    );

    await interaction.showModal(modal);
    return true;
  } catch (error) {
    console.error('[WELCOME] Ошибка кнопки:', error.message);
    return false;
  }
}

/**
 * Обработчик модального окна выбора роли.
 * @param {import('discord.js').Interaction} interaction
 */
export async function handleWelcomeRoleModal(interaction) {
  try {
    if (interaction.customId !== 'welcome_role_modal') return;

    const roleName = interaction.fields.getTextInputValue('welcome_role_name').trim();
    const className = interaction.fields.getTextInputValue('welcome_class').trim();

    // Выдаём роль "ВЕЛОСЕР" если указана
    if (WELCOMER_ROLE_ID) {
      try {
        await interaction.member.roles.add(WELCOMER_ROLE_ID);
      } catch (err) {
        console.error('[WELCOME] Ошибка выдачи роли:', err.message);
      }
    }

    // Сохраняем информацию о пользователе (можно расширить)
    const db = getDb();
    ensureUser(interaction.user.id, interaction.guildId);

    // Ответ
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🎉 Приключение начинается!')
      .setDescription(
        `**${roleName}** (${className}), добро пожаловать в мир **${interaction.guild.name}**!\n\n` +
        `📜 **Твой стартовый квест:**\n` +
        `1. Напиши сообщение в чат — получи XP\n` +
        `2. Зайди в голосовой канал — начни фармить ⚡HLD\n` +
        `3. Используй \`/help\` — изучи все команды\n` +
        `4. Загляни в \`/shop\` — купи первую роль!\n\n` +
        `💡 **Совет:** Найди напарника и поженись через \`/marry\`!`
      )
      .setFooter({ text: 'Удачи в приключениях!' })

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('[WELCOME] Ошибка модалки:', error.message);
  }
}

