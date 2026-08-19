// === МОДУЛЬ: WELCOME NPC (Приветствие в стиле RPG) ===
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder } from 'discord.js';
import { getDb, ensureUser, addCoins } from '../database.js';
import { getGuildConfig } from '../utils/guildConfig.js';
import { generateWelcomeImage } from './canvas-welcome.js';

// ⚠️ ВСТАВЬ СЮДА ID КАНАЛА ДЛЯ ПРИВЕТСТВИЙ (например #welcome)
const WELCOME_CHANNEL_ID = null; // [ВСТАВЬ СЮДА ID КАНАЛА WELCOME]

// Канал для кнопки «Перейти в основной канал»
const MAIN_CHANNEL_ID = '1528102721679265973';

// ⚠️ ВСТАВЬ СЮДА ID РОЛИ "ВЕЛОСЕР" ДЛЯ ВЫБОРА ПРИ ПРИВЕТСТВИИ
const WELCOMER_ROLE_ID = null; // [ВСТАВЬ СЮДА ID РОЛИ "ВЕЛОСЕР"]

// ══════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт ActionRow с кнопкой-ссылкой на основной канал.
 *
 * @param {string} guildId — ID сервера
 * @param {string} channelId — ID основного канала
 * @returns {ActionRowBuilder}
 */
function createActionRow(guildId, channelId) {
  const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🚪 Перейти в основной канал')
      .setStyle(ButtonStyle.Link)
      .setURL(channelUrl),
  );
}

export async function buildWelcomeMessagePayload(member) {
  const imageBuffer = await generateWelcomeImage({
    displayName: member.displayName,
    guildName: member.guild.name,
    avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 512 }),
    memberCount: member.guild.memberCount,
  });

  const components = [createActionRow(member.guild.id, MAIN_CHANNEL_ID)];

  if (imageBuffer) {
    return {
      files: [new AttachmentBuilder(imageBuffer, { name: 'welcome.png' })],
      embeds: [],
      components,
    };
  }

  return {
    files: [],
    embeds: [],
    components,
  };
}

// ══════════════════════════════════════════════════════════════════
// ОСНОВНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает событие guildMemberAdd — отправляет приветствие в welcome-канал.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {Object} [config=null] — конфиг сервера
 */
function resolveWelcomeChannel(member, config) {
  const welcomeChannelId = config?.welcomeChannelId || WELCOME_CHANNEL_ID;
  const welcomeChannel = welcomeChannelId
    ? member.guild.channels.cache.get(welcomeChannelId)
    : null;
  return welcomeChannel || member.guild.systemChannel || null;
}

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

    if (!config) {
      try {
        config = getGuildConfig(member.guild.id);
      } catch {
        config = null;
      }
    }

    const targetChannel = resolveWelcomeChannel(member, config);
    if (!targetChannel) {
      console.warn(`[WELCOME] Канал приветствий не настроен для ${member.guild.name} (${member.guild.id})`);
      return;
    }

    const payload = await buildWelcomeMessagePayload(member);

    if (!payload.files.length) {
      console.warn(`[WELCOME] Canvas недоступен — приветствие без картинки для ${member.user.tag}`);
    }

    await targetChannel.send({
      content: `<@${member.id}>`,
      files: payload.files,
      components: payload.components,
    });
    console.log(`[WELCOME] Приветствие отправлено в #${targetChannel.name} для ${member.user.tag}`);
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

