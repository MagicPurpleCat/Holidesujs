import { EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle, MessageFlags } from 'discord.js';
import { getDb } from '../database.js';

// ===================================================================
// МЕНЕДЖЕР КАСТОМНЫХ РОЛЕЙ
// ===================================================================
// Позволяет создателю роли изменять её параметры:
// цвет, название, цену, а также удалять роль.
// Роль НЕ создаётся ботом — бот меняет параметры у существующей роли,
// ID которой admin заранее внёс в поле discord_role_id в таблице custom_roles.
// ===================================================================

/**
 * Рендерит список ролей пользователя с кнопками действий.
 * @param {Interaction} interaction — взаимодействие (кнопка или команда)
 */
export async function renderRoleManager(interaction) {
  const db = getDb();
  const userId = interaction.user.id;

  // Получаем все кастомные роли, созданные этим пользователем
  const userRoles = db
    .prepare(
      `SELECT * FROM custom_roles WHERE creator_id = ? ORDER BY created_at DESC`
    )
    .all(userId);

  if (userRoles.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚙️ Управление моими ролями')
      .setDescription(
        '❌ У тебя нет созданных ролей.\n\n' +
        'Создай роль через `/shop` → "➕ Создать свою роль".'
      )

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // Для каждой роли создаём отдельный Embed с кнопками
  const embeds = [];
  const allRows = [];

  for (const role of userRoles) {
    // Информация о роли
    const embed = new EmbedBuilder()
      .setColor(role.color_hex || '#5865F2')
      .setTitle(`⚙️ ${role.role_name}`)
      .addFields(
        { name: '🎨 Цвет', value: role.color_hex || '#5865F2', inline: true },
        { name: '💰 Цена', value: `${role.price} ⚡HLD`, inline: true },
        {
          name: '📊 Статус продажи',
          value: role.is_for_sale ? '🟢 Продаётся' : '🔴 Не продаётся',
          inline: true,
        },
        {
          name: '👥 Владельцев',
          value: `${role.current_holders} / ${role.max_holders}`,
          inline: true,
        },
        { name: '🎭 Роль', value: `<@&${role.discord_role_id}>`, inline: false }
      )

    embeds.push(embed);

    // Кнопки для этой роли
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rm_color_${role.id}`)
        .setLabel('🎨 Изменить цвет')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rm_name_${role.id}`)
        .setLabel('✏️ Изменить название')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`rm_price_${role.id}`)
        .setLabel('💰 Изменить цену')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rm_delete_${role.id}`)
        .setLabel('🗑 Удалить роль')
        .setStyle(ButtonStyle.Danger),
    );

    allRows.push(row);
  }

  // Кнопка "Назад"
  allRows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vc_close_manager')
        .setLabel('❌ Закрыть')
        .setStyle(ButtonStyle.Secondary),
    )
  );

  await interaction.reply({ embeds, components: allRows, flags: MessageFlags.Ephemeral });
}

// ===================================================================
// ОБРАБОТЧИК КНОПОК МЕНЕДЖЕРА
// ===================================================================

/**
 * Диспетчер нажатий кнопок менеджера ролей.
 * Возвращает true, если кнопка обработана, иначе false.
 */
export async function handleRoleManagerButtons(interaction) {
  const { customId, user, guild } = interaction;
  const db = getDb();

  // ─── Изменить цвет ──────────────────────────────────────────
  if (customId.startsWith('rm_color_')) {
    const roleId = parseInt(customId.replace('rm_color_', ''), 10);
    return showColorModal(interaction, roleId);
  }

  // ─── Изменить название ──────────────────────────────────────
  if (customId.startsWith('rm_name_')) {
    const roleId = parseInt(customId.replace('rm_name_', ''), 10);
    return showNameModal(interaction, roleId);
  }

  // ─── Изменить цену ─────────────────────────────────────────
  if (customId.startsWith('rm_price_')) {
    const roleId = parseInt(customId.replace('rm_price_', ''), 10);
    return showPriceModal(interaction, roleId);
  }

  // ─── Удалить роль ───────────────────────────────────────────
  if (customId.startsWith('rm_delete_')) {
    const roleId = parseInt(customId.replace('rm_delete_', ''), 10);
    return showDeleteConfirm(interaction, roleId);
  }

  // ─── Подтверждение удаления ─────────────────────────────────
  if (customId.startsWith('rm_delete_confirm_')) {
    const roleId = parseInt(customId.replace('rm_delete_confirm_', ''), 10);
    return handleDeleteRole(interaction, roleId);
  }

  // ─── Отмена удаления ────────────────────────────────────────
  if (customId.startsWith('rm_delete_cancel_')) {
    return interaction.update({
      content: '❌ Удаление отменено.',
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Закрыть менеджер ───────────────────────────────────────
  if (customId === 'vc_close_manager') {
    return interaction.update({
      content: '⚙️ Менеджер ролей закрыт.',
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  return false; // не наша кнопка
}

// ===================================================================
// MODAL: ИЗМЕНИТЬ ЦВЕТ
// ===================================================================

async function showColorModal(interaction, roleDbId) {
  const modal = new ModalBuilder()
    .setCustomId(`rm_color_modal_${roleDbId}`)
    .setTitle('🎨 Изменить цвет роли');

  const hexInput = new TextInputBuilder()
    .setCustomId('rm_color_hex')
    .setLabel('HEX-код цвета (например #FF4500)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(7)
    .setPlaceholder('#5865F2')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(hexInput));

  await interaction.showModal(modal);
}

/**
 * Обработчик модалки с HEX-цветом.
 */
export async function handleColorModal(interaction) {
  if (!interaction.customId.startsWith('rm_color_modal_')) return;

  const roleDbId = parseInt(interaction.customId.replace('rm_color_modal_', ''), 10);
  const hex = interaction.fields.getTextInputValue('rm_color_hex').trim();

  // Валидация HEX
  const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  if (!hexRegex.test(hex)) {
    return interaction.reply({
      content: '❌ Неверный HEX-код. Используй формат `#RRGGBB` или `#RGB`. Например: `#FF4500`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Роль не найдена или это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Обновляем цвет в Discord
  const guild = interaction.guild;
  const discordRole = guild.roles.cache.get(role.discord_role_id);
  if (!discordRole) {
    return interaction.reply({
      content: '❌ Роль не найдена на сервере. Возможно, она была удалена.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await discordRole.edit({ color: hex, reason: `Изменение цвета роли ${role.role_name} (владелец: ${interaction.user.tag})` });

    // Обновляем в БД
    db.prepare('UPDATE custom_roles SET color_hex = ? WHERE id = ?').run(hex, roleDbId);

    await interaction.reply({
      content: `✅ Цвет роли **${role.role_name}** изменён на ${hex}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error(`[ROLEMGR] Ошибка изменения цвета роли:`, err.message);
    await interaction.reply({
      content: `❌ Ошибка при изменении цвета: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ===================================================================
// MODAL: ИЗМЕНИТЬ НАЗВАНИЕ
// ===================================================================

async function showNameModal(interaction, roleDbId) {
  const modal = new ModalBuilder()
    .setCustomId(`rm_name_modal_${roleDbId}`)
    .setTitle('✏️ Изменить название роли');

  const nameInput = new TextInputBuilder()
    .setCustomId('rm_name')
    .setLabel('Новое название (до 32 символов)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(32)
    .setPlaceholder('Введи новое название роли')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

  await interaction.showModal(modal);
}

/**
 * Обработчик модалки с названием роли.
 */
export async function handleNameModal(interaction) {
  if (!interaction.customId.startsWith('rm_name_modal_')) return;

  const roleDbId = parseInt(interaction.customId.replace('rm_name_modal_', ''), 10);
  const newName = interaction.fields.getTextInputValue('rm_name').trim();

  // Валидация длины
  if (newName.length < 2 || newName.length > 32) {
    return interaction.reply({
      content: '❌ Название должно быть от 2 до 32 символов.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Роль не найдена или это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Обновляем название в Discord
  const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
  if (!discordRole) {
    return interaction.reply({
      content: '❌ Роль не найдена на сервере.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await discordRole.edit({
      name: newName,
      reason: `Изменение названия роли (владелец: ${interaction.user.tag})`,
    });

    // Обновляем в БД
    db.prepare('UPDATE custom_roles SET role_name = ? WHERE id = ?').run(newName, roleDbId);

    await interaction.reply({
      content: `✅ Название роли изменено на **${newName}**`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    console.error(`[ROLEMGR] Ошибка изменения названия роли:`, err.message);
    await interaction.reply({
      content: `❌ Ошибка при изменении названия: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ===================================================================
// MODAL: ИЗМЕНИТЬ ЦЕНУ
// ===================================================================

async function showPriceModal(interaction, roleDbId) {
  const modal = new ModalBuilder()
    .setCustomId(`rm_price_modal_${roleDbId}`)
    .setTitle('💰 Изменить цену роли');

  const priceInput = new TextInputBuilder()
    .setCustomId('rm_price')
    .setLabel('Новая цена в ⚡HLD (минимум 1000)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(7)
    .setPlaceholder('5000')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(priceInput));

  await interaction.showModal(modal);
}

/**
 * Обработчик модалки с ценой.
 */
export async function handlePriceModal(interaction) {
  if (!interaction.customId.startsWith('rm_price_modal_')) return;

  const roleDbId = parseInt(interaction.customId.replace('rm_price_modal_', ''), 10);
  const priceStr = interaction.fields.getTextInputValue('rm_price').trim();
  const price = parseInt(priceStr, 10);

  if (isNaN(price) || price < 1000) {
    return interaction.reply({
      content: '❌ Цена должна быть не менее **1000 ⚡HLD**.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Роль не найдена или это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Обновляем в БД
  db.prepare('UPDATE custom_roles SET price = ? WHERE id = ?').run(price, roleDbId);

  await interaction.reply({
    content: `✅ Цена роли **${role.role_name}** изменена на **${price} ⚡HLD**`,
    flags: MessageFlags.Ephemeral,
  });
}

// ===================================================================
// УДАЛЕНИЕ РОЛИ
// ===================================================================

async function showDeleteConfirm(interaction, roleDbId) {
  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Роль не найдена или это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🗑 Подтверждение удаления роли')
    .setDescription(
      `**Ты уверен, что хочешь удалить роль ${role.role_name}?**\n\n` +
      `⚠️ Роль исчезнет у **всех владельцев** (${role.current_holders} чел.).\n` +
      `💸 Средства за покупку **сгорают** — возврат не производится.\n` +
      `🎭 Сама роль <@&${role.discord_role_id}> будет удалена с сервера.\n\n` +
      `Это действие **необратимо**.`
    )

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rm_delete_confirm_${roleDbId}`)
      .setLabel('✅ Да, удалить навсегда')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`rm_delete_cancel_${roleDbId}`)
      .setLabel('❌ Отмена')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function handleDeleteRole(interaction, roleDbId) {
  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Роль не найдена или это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    // 1. Удаляем роль из Discord
    const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
    if (discordRole) {
      await discordRole.delete(`Роль удалена владельцем ${interaction.user.tag}`);
    }

    // 2. Удаляем запись из custom_roles
    db.prepare('DELETE FROM custom_roles WHERE id = ?').run(roleDbId);

    // 3. Отвечаем пользователю
    await interaction.update({
      content: `✅ Роль **${role.role_name}** удалена навсегда. Все владельцы потеряли её.`,
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral,
    });

    console.log(`[ROLEMGR] Роль "${role.role_name}" (${role.discord_role_id}) удалена пользователем ${interaction.user.tag}`);
  } catch (err) {
    console.error(`[ROLEMGR] Ошибка удаления роли:`, err.message);
    await interaction.update({
      content: `❌ Ошибка при удалении роли: ${err.message}`,
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }
}

