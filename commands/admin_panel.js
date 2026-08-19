import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { getDb, ensureUser, addCoins, removeCoins, addXp, removeXp, logPunishment } from '../database.js';
import { getUserLevel, levelName, canGrant, canModerateMember } from '../utils/permissions.js';
import { getRoleIdForLevel, assignLevelRoles, removeLevelRole, checkLevelMilestones, getReachedMilestones } from './rank.js';
import { getVerifiedRoleId, getExtraVerifyRoles } from '../modules/verification.js';

// ══════════════════════════════════════════════════════════════════
// АДМИН-ПАНЕЛЬ И РОЛИ ДОСТУПА (owner=3, admin=2, moderator=1)
// ══════════════════════════════════════════════════════════════════
//
// ЕДИНЫЙ ЦЕНТР АДМИНИСТРИРОВАНИЯ:
//   • Права и пользователи (выдать/снять права, верификация, удаление)
//   • Экономика (баланс, бесконечный баланс, XP)
//   • Модерация (warn / mute / kick / ban / warns)
//   • Настройка сервера (/setup)
//   • Статистика и топ активностей
//
// ТАБЛИЦА: bot_permissions (user_id, level, granted_by, granted_at)
// - level=3 (owner) — полный доступ
// - level=2 (admin) — может выдавать только Mod
// - level=1 (moderator) — базовый доступ
//
// КОМАНДА: /админ-панель (доступна level >= 1)
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// ⚠️ ID роли "Верифицирован" и доп. ролей импортируются из
// modules/verification.js (VERIFIED_ROLE_ID, EXTRA_VERIFICATION_ROLES).
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Проверяет, что у пользователя достаточный уровень прав.
 * Если нет — отправляет ephemeral-ответ и возвращает false.
 */
function requireLevel(interaction, level) {
  const userLevel = getUserLevel(interaction.user.id, interaction.guild);
  if (userLevel < level) {
    interaction.reply({
      content: `❌ У тебя недостаточно прав. Требуется: **${levelName(level)}**. Твой уровень: **${levelName(userLevel)}**.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return false;
  }
  return true;
}

/**
 * Валидирует Discord ID (17-20 цифр).
 */
function isValidUserId(id) {
  return /^\d{17,20}$/.test(id);
}

/**
 * Валидирует положительное целое число.
 */
function isValidPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Показывает модалку с двумя полями: ID пользователя + сумма.
 */
function showUserAmountModal(interaction, customId, title, amountLabel, placeholder) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ap_econ_target')
        .setLabel('ID пользователя Discord')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Вставь ID пользователя')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ap_econ_amount')
        .setLabel(amountLabel)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(placeholder)
        .setRequired(true)
    ),
  );

  return interaction.showModal(modal);
}

// ══════════════════════════════════════════════════════════════════
// ПОСТРОЕНИЕ EMBED АДМИН-ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════

/**
 * Строит Embed и кнопки для админ-панели.
 * @param {number} userLevel — уровень прав вызвавшего пользователя
 */
function buildAdminPanel(userLevel) {
  // ─── Описание доступных команд в зависимости от уровня прав ──
  const levelCommands = {
    1: '**🛡 Модерация**\n' +
       '• ⚠️ Warn — выдать предупреждение\n' +
       '• 🔇 Mute — замутить на время\n' +
       '• 👢 Kick — кикнуть\n' +
       '• 🔨 Ban — забанить\n' +
       '• 📋 Warns — список предупреждений\n\n' +
       '**📊 Информация**\n' +
       '• 📊 Статистика сервера\n' +
       '• 🏆 Топ активностей',
    2: '**✅ Верификация**\n' +
       '• ✅ Выдать верификацию\n' +
       '• 🔓 Снять верификацию\n\n' +
       '**🔑 Права и пользователи**\n' +
       '• ➕ Выдать права\n' +
       '• ➖ Снять права\n' +
       '• 🗑 Удалить пользователя\n\n' +
       '**💰 Экономика**\n' +
       '• 💰 Начислить баланс\n' +
       '• 💸 Снять баланс\n' +
       '• ♾️ Беск. баланс / 🚫 Снять беск.\n' +
       '• ⭐ Начислить XP / 📉 Снять XP\n\n' +
       '**🛡 Модерация**\n' +
       '• ⚠️ Warn • 🔇 Mute • 👢 Kick • 🔨 Ban • 📋 Warns\n\n' +
       '**🛠 Настройка**\n' +
       '• 🛠 Настройка сервера (/setup)\n\n' +
       '**📊 Информация**\n' +
       '• 📊 Статистика • 🏆 Топ активностей',
    3: '**✅ Верификация**\n' +
       '• ✅ Выдать верификацию\n' +
       '• 🔓 Снять верификацию\n\n' +
       '**🔑 Права и пользователи**\n' +
       '• ➕ Выдать права\n' +
       '• ➖ Снять права\n' +
       '• 🗑 Удалить пользователя\n\n' +
       '**💰 Экономика**\n' +
       '• 💰 Начислить баланс\n' +
       '• 💸 Снять баланс\n' +
       '• ♾️ Беск. баланс / 🚫 Снять беск.\n' +
       '• ⭐ Начислить XP / 📉 Снять XP\n\n' +
       '**🛡 Модерация**\n' +
       '• ⚠️ Warn • 🔇 Mute • 👢 Kick • 🔨 Ban • 📋 Warns\n\n' +
       '**🛠 Настройка**\n' +
       '• 🛠 Настройка сервера (/setup)\n\n' +
       '**📊 Информация**\n' +
       '• 📊 Статистика • 🏆 Топ активностей',
  };

  const embed = new EmbedBuilder()
    .setColor(0xFFD700) // Gold цвет
.setTitle('🛠 Панель управления')
    .setDescription(
      'Управление правами, пользователями, экономикой и модерацией.\n' +
      `Твой уровень: **${levelName(userLevel)}**`
    )
.addFields(
      { name: '📋 Доступные команды', value: levelCommands[userLevel] || levelCommands[1], inline: false }
    )
    .setFooter({ text: 'Изменения вступают в силу мгновенно.' })

  const rows = [];

// ─── Ряд 1: Верификация (level >= 2) ───────────────────────
  if (userLevel >= 2) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ap_give_verify')
          .setLabel('✅ Выдать верификацию')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('admin_remove_verify')
          .setLabel('🔓 Снять верификацию')
          .setStyle(ButtonStyle.Danger),
      )
    );
  }

  // ─── Ряд 2: Права и пользователи (level >= 2) ──────────────
  if (userLevel >= 2) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('admin_give_perm')
          .setLabel('➕ Выдать права')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ap_revoke_perms')
          .setLabel('➖ Снять права')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ap_delete_user')
          .setLabel('🗑 Удалить пользователя')
          .setStyle(ButtonStyle.Danger),
      )
    );
  }

  // ─── Ряд 3: Экономика (level >= 2) ─────────────────────────
  if (userLevel >= 2) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ap_add_balance')
          .setLabel('💰 Начислить баланс')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ap_remove_balance')
          .setLabel('💸 Снять баланс')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ap_set_infinite')
          .setLabel('♾️ Беск. баланс')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('ap_clear_infinite')
          .setLabel('🚫 Снять беск.')
          .setStyle(ButtonStyle.Secondary),
      )
    );
  }

// ─── Ряд 4: Опыт + Модерация + Настройка ───────────────────
  const row3 = [];
  if (userLevel >= 2) {
    row3.push(
      new ButtonBuilder()
        .setCustomId('ap_add_xp')
        .setLabel('⭐ Начислить XP')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ap_remove_xp')
        .setLabel('📉 Снять XP')
        .setStyle(ButtonStyle.Danger),
    );
  }
  if (userLevel >= 1) {
    row3.push(
      new ButtonBuilder()
        .setCustomId('ap_moderation')
        .setLabel('🛡 Модерация')
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (userLevel >= 2) {
    row3.push(
      new ButtonBuilder()
        .setCustomId('ap_setup')
        .setLabel('🛠 Настройка')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (row3.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(...row3));
  }

  // ─── Ряд 4: Информация ─────────────────────────────────────
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('admin_stats')
        .setLabel('📊 Статистика')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ap_top_activity')
        .setLabel('🏆 Топ активностей')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('ap_close')
        .setLabel('❌ Закрыть')
        .setStyle(ButtonStyle.Danger),
    )
  );

  return { embed, components: rows };
}

/**
 * Строит Embed и кнопки подменю модерации.
 */
function buildModerationMenu(userLevel) {
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🛡 Модерация')
    .setDescription(
      'Выбери действие модерации.\n' +
      `Твой уровень: **${levelName(userLevel)}**`
    )
    .addFields(
      { name: '📋 Доступные действия', value: 'Нажми кнопку — откроется окно ввода.', inline: false }
    )
    .setFooter({ text: 'Warn / Mute / Kick / Ban / Warns' })

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ap_warn')
      .setLabel('⚠️ Warn')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ap_mute')
      .setLabel('🔇 Mute')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ap_kick')
      .setLabel('👢 Kick')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ap_ban')
      .setLabel('🔨 Ban')
      .setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ap_warns')
      .setLabel('📋 Warns')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ap_back')
      .setLabel('⬅️ Назад в панель')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, components: [row, row2] };
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИКИ КНОПОК АДМИН-ПАНЕЛИ
// ══════════════════════════════════════════════════════════════════

/**
 * Главный диспетчер кнопок админ-панели.
 * Вызывается из index.js при customId, начинающемся с 'ap_' или 'admin_'.
 */
export async function handleAdminPanelButtons(interaction) {
  const { customId, user, guild } = interaction;
  const userLevel = getUserLevel(user.id, guild);
  const db = getDb();

  // ─── Закрыть панель ─────────────────────────────────────────
  if (customId === 'ap_close') {
    return interaction.update({
      content: '🛠 Админ-панель закрыта.',
      embeds: [],
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Выдать права ───────────────────────────────────────────
  if (customId === 'admin_give_perm' || customId === 'ap_grant_perms') {
    if (!requireLevel(interaction, 2)) return;

    const modal = new ModalBuilder()
      .setCustomId('ap_grant_modal')
      .setTitle('📝 Выдать права');

    const userIdInput = new TextInputBuilder()
      .setCustomId('ap_target_user')
      .setLabel('ID пользователя Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вставь ID пользователя')
      .setRequired(true);

    const levelInput = new TextInputBuilder()
      .setCustomId('ap_target_level')
      .setLabel('Уровень (3=Owner, 2=Admin, 1=Mod)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('1, 2 или 3')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(userIdInput),
      new ActionRowBuilder().addComponents(levelInput),
    );

    return interaction.showModal(modal);
  }

  // ─── Снять права (список) ───────────────────────────────────
  if (customId === 'ap_revoke_perms') {
    if (!requireLevel(interaction, 2)) return;

    const permUsers = db
      .prepare(
        'SELECT user_id, level FROM bot_permissions WHERE user_id != ? ORDER BY level DESC'
      )
      .all(user.id);

    if (permUsers.length === 0) {
      return interaction.reply({
        content: '❌ Нет пользователей с правами (кроме тебя).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🚫 Снять права')
      .setDescription('Выбери пользователя, у которого нужно снять права:')

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ap_revoke_select')
      .setPlaceholder('Выбери пользователя...');

    for (const pu of permUsers) {
      let label = pu.user_id;
      try {
        const mem = await guild.members.fetch(pu.user_id).catch(() => null);
        if (mem) label = mem.displayName;
      } catch {}
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${label} (${levelName(pu.level)})`)
          .setValue(pu.user_id)
      );
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // ─── Обработчик выбора пользователя для снятия прав ───────
  if (customId === 'ap_revoke_select') {
    const targetId = interaction.values[0];
    const targetPerm = db
      .prepare('SELECT level FROM bot_permissions WHERE user_id = ?')
      .get(targetId);

    if (!targetPerm) {
      return interaction.reply({
        content: '❌ У этого пользователя нет прав.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Проверка: нельзя снять права у того, у кого уровень выше или равен твоему
    if (targetPerm.level >= userLevel) {
      return interaction.reply({
        content: '❌ Нельзя снять права у пользователя с таким же или более высоким уровнем.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Снимаем права (удаляем запись)
    db.prepare('DELETE FROM bot_permissions WHERE user_id = ?').run(targetId);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Права сняты')
      .setDescription(`У пользователя <@${targetId}> сняты права.`)

    return interaction.update({ embeds: [embed], components: [] });
  }

  // ─── Удалить пользователя ─────────────────────────────────
  if (customId === 'ap_delete_user') {
    if (!requireLevel(interaction, 2)) return;

    const modal = new ModalBuilder()
      .setCustomId('ap_delete_modal')
      .setTitle('🗑 Удалить пользователя');

    const userIdInput = new TextInputBuilder()
      .setCustomId('ap_delete_target')
      .setLabel('ID пользователя Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вставь ID пользователя для удаления')
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('ap_delete_reason')
      .setLabel('Причина удаления')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Опиши причину кика и удаления данных')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(userIdInput),
      new ActionRowBuilder().addComponents(reasonInput),
    );

    return interaction.showModal(modal);
  }

  // ─── Статистика сервера ────────────────────────────────────
  if (customId === 'admin_stats' || customId === 'ap_server_stats') {
    const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE guild_id = ?').get(interaction.guildId).cnt;
    const verifiedUsers = db.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE is_verified = 1 AND guild_id = ?'
    ).get(interaction.guildId).cnt;
    const totalBalance = db.prepare(
      'SELECT SUM(balance) as total FROM users WHERE is_infinite_balance = 0 AND guild_id = ?'
    ).get(interaction.guildId).total || 0;
    const topLevel = db.prepare(
      'SELECT MAX(level) as max FROM users WHERE guild_id = ?'
    ).get(interaction.guildId).max || 1;
    const totalVoiceMinutes = db.prepare(
      'SELECT SUM(total_voice_minutes) as total FROM users WHERE guild_id = ?'
    ).get(interaction.guildId).total || 0;
    const activeRooms = db.prepare(
      'SELECT COUNT(*) as cnt FROM user_voice_channels'
    ).get().cnt;

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('📊 Статистика сервера')
      .addFields(
        { name: '👥 Всего пользователей', value: `${totalUsers}`, inline: true },
        { name: '✅ Верифицировано', value: `${verifiedUsers}`, inline: true },
        { name: '💰 Общий баланс', value: `${totalBalance.toLocaleString()} ⚡HLD`, inline: true },
        { name: '🏆 Макс. уровень', value: `${topLevel}`, inline: true },
        { name: '🎙 Минут в голосе', value: `${totalVoiceMinutes.toLocaleString()}`, inline: true },
        { name: '🎤 Активных комнат', value: `${activeRooms}`, inline: true },
      )

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ap_back')
        .setLabel('⬅️ Назад в панель')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // ─── Топ активностей ──────────────────────────────────────
  if (customId === 'ap_top_activity') {
    const topUsers = db
      .prepare(
        `SELECT user_id, balance, level, total_xp, total_voice_minutes,
                ROUND((balance * 0.3) + (total_xp * 0.7) + (total_voice_minutes * 0.1), 2) as score
         FROM users
         WHERE is_infinite_balance = 0 AND guild_id = ?
         ORDER BY score DESC
         LIMIT 10`
      )
      .all(interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🏆 Топ активностей (админ-панель)')
      .setDescription(
        topUsers.length === 0
          ? 'Нет данных.'
          : topUsers
              .map(
                (u, i) =>
                  `**${i + 1}.** <@${u.user_id}> — счет: **${u.score}** | ` +
                  `${u.balance} ⚡HLD | Lv.${u.level}`
              )
              .join('\n')
      )

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ap_back')
        .setLabel('⬅️ Назад в панель')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

// ─── Выдать верификацию ────────────────────────────────────
  if (customId === 'ap_give_verify') {
    if (!requireLevel(interaction, 2)) return;

    const modal = new ModalBuilder()
      .setCustomId('ap_give_verify_modal')
      .setTitle('✅ Выдать верификацию');

    const userIdInput = new TextInputBuilder()
      .setCustomId('ap_give_verify_target')
      .setLabel('ID пользователя Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вставь ID пользователя')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

    return interaction.showModal(modal);
  }

  // ─── Снять верификацию ─────────────────────────────────────
  if (customId === 'admin_remove_verify' || customId === 'ap_unverify') {
    if (!requireLevel(interaction, 2)) return;

    const modal = new ModalBuilder()
      .setCustomId('ap_unverify_modal')
      .setTitle('🔓 Снять верификацию');

    const userIdInput = new TextInputBuilder()
      .setCustomId('ap_unverify_target')
      .setLabel('ID пользователя Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вставь ID пользователя')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

    return interaction.showModal(modal);
  }

  // ─── Экономика: модалки ────────────────────────────────────
  if (customId === 'ap_add_balance') {
    if (!requireLevel(interaction, 2)) return;
    return showUserAmountModal(
      interaction,
      'ap_add_balance_modal',
      '💰 Начислить баланс',
      'Сумма ⚡HLD',
      'Сколько начислить'
    );
  }

  if (customId === 'ap_remove_balance') {
    if (!requireLevel(interaction, 2)) return;
    return showUserAmountModal(
      interaction,
      'ap_remove_balance_modal',
      '💸 Снять баланс',
      'Сумма ⚡HLD',
      'Сколько списать'
    );
  }

  if (customId === 'ap_set_infinite') {
    if (!requireLevel(interaction, 2)) return;
    return showUserAmountModal(
      interaction,
      'ap_set_infinite_modal',
      '♾️ Бесконечный баланс',
      'Значение баланса',
      'Введи значение баланса'
    );
  }

  if (customId === 'ap_clear_infinite') {
    if (!requireLevel(interaction, 2)) return;

    const modal = new ModalBuilder()
      .setCustomId('ap_clear_infinite_modal')
      .setTitle('🚫 Снять бесконечный баланс');

    const userIdInput = new TextInputBuilder()
      .setCustomId('ap_econ_target')
      .setLabel('ID пользователя Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Вставь ID пользователя')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

    return interaction.showModal(modal);
  }

  if (customId === 'ap_add_xp') {
    if (!requireLevel(interaction, 2)) return;
    return showUserAmountModal(
      interaction,
      'ap_add_xp_modal',
      '⭐ Начислить XP',
      'Количество XP',
      'Сколько XP начислить'
    );
  }

  if (customId === 'ap_remove_xp') {
    if (!requireLevel(interaction, 2)) return;
    return showUserAmountModal(
      interaction,
      'ap_remove_xp_modal',
      '📉 Снять XP',
      'Количество XP',
      'Сколько XP снять'
    );
  }

  // ─── Подменю модерации ─────────────────────────────────────
  if (customId === 'ap_moderation') {
    if (!requireLevel(interaction, 1)) return;
    const { embed, components } = buildModerationMenu(userLevel);
    return interaction.update({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  }

  // ─── Кнопки модерации (модалки) ────────────────────────────
  if (customId === 'ap_warn') {
    if (!requireLevel(interaction, 1)) return;
    const modal = new ModalBuilder()
      .setCustomId('ap_warn_modal')
      .setTitle('⚠️ Выдать предупреждение');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_target')
          .setLabel('ID пользователя Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Вставь ID пользователя')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_reason')
          .setLabel('Причина')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Опиши причину предупреждения')
          .setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  if (customId === 'ap_mute') {
    if (!requireLevel(interaction, 1)) return;
    const modal = new ModalBuilder()
      .setCustomId('ap_mute_modal')
      .setTitle('🔇 Замутить пользователя');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_target')
          .setLabel('ID пользователя Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Вставь ID пользователя')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_duration')
          .setLabel('Длительность (минуты)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Например: 60')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_reason')
          .setLabel('Причина')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Опиши причину мута')
          .setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  if (customId === 'ap_kick') {
    if (!requireLevel(interaction, 1)) return;
    const modal = new ModalBuilder()
      .setCustomId('ap_kick_modal')
      .setTitle('👢 Кикнуть пользователя');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_target')
          .setLabel('ID пользователя Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Вставь ID пользователя')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_reason')
          .setLabel('Причина')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Опиши причину кика')
          .setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  if (customId === 'ap_ban') {
    if (!requireLevel(interaction, 1)) return;
    const modal = new ModalBuilder()
      .setCustomId('ap_ban_modal')
      .setTitle('🔨 Забанить пользователя');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_target')
          .setLabel('ID пользователя Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Вставь ID пользователя')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_reason')
          .setLabel('Причина')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Опиши причину бана')
          .setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  if (customId === 'ap_warns') {
    if (!requireLevel(interaction, 1)) return;
    const modal = new ModalBuilder()
      .setCustomId('ap_warns_modal')
      .setTitle('📋 Предупреждения пользователя');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ap_mod_target')
          .setLabel('ID пользователя Discord')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Вставь ID пользователя')
          .setRequired(true)
      ),
    );
    return interaction.showModal(modal);
  }

  // ─── Настройка сервера (/setup) ────────────────────────────
  if (customId === 'ap_setup') {
    if (!requireLevel(interaction, 2)) return;
    try {
      const { showSetupModal } = await import('./setup.js');
      await showSetupModal(interaction);
    } catch (e) {
      console.error('[ADMIN] Ошибка запуска setup:', e.message);
      return interaction.reply({
        content: '❌ Не удалось запустить мастер настройки. Используй команду `/setup`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  // ─── Назад в панель ───────────────────────────────────────
  if (customId === 'ap_back') {
    const { embed, components } = buildAdminPanel(userLevel);
    return interaction.update({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  }

  return false;
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИКИ МОДАЛЬНЫХ ОКОН
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает модалку выдачи прав.
 */
export async function handleGrantModal(interaction) {
  if (interaction.customId !== 'ap_grant_modal') return;

  const granterId = interaction.user.id;
  const granterLevel = getUserLevel(granterId, interaction.guild);
  const targetId = interaction.fields.getTextInputValue('ap_target_user').trim();
  const targetLevelStr = interaction.fields.getTextInputValue('ap_target_level').trim();
  const targetLevel = parseInt(targetLevelStr, 10);

  // Валидация уровня
  if (![1, 2, 3].includes(targetLevel)) {
    return interaction.reply({
      content: '❌ Уровень должен быть 1 (Mod), 2 (Admin) или 3 (Owner).',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка прав выдающего
  if (!canGrant(granterLevel, targetLevel)) {
    return interaction.reply({
      content:
        '❌ Ты не можешь выдать такой уровень прав. ' +
        'Owner может выдать Admin или Mod, но не Owner. Admin может выдать только Mod (1).',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();

  // Проверяем существование пользователя в БД (создаём запись если нет)
  ensureUser(targetId, interaction.guildId);

  // Вставляем или обновляем права
  db.prepare(`
    INSERT INTO bot_permissions (user_id, level, granted_by)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      level = excluded.level,
      granted_by = excluded.granted_by,
      granted_at = datetime('now')
  `).run(targetId, targetLevel, granterId);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Права выданы')
    .setDescription(
      `Пользователь <@${targetId}> получил уровень **${levelName(targetLevel)}**\n` +
      `Выдал: **${interaction.user.displayName}**`
    )

  await interaction.reply({ embeds: [embed] });
}

/**
 * Обрабатывает модалку удаления пользователя (кик + чистка БД).
 */
export async function handleDeleteUserModal(interaction) {
  if (interaction.customId !== 'ap_delete_modal') return;

  const granterLevel = getUserLevel(interaction.user.id, interaction.guild);
  const targetId = interaction.fields.getTextInputValue('ap_delete_target').trim();
  const reason = interaction.fields.getTextInputValue('ap_delete_reason').trim();

  if (!reason) {
    return interaction.reply({
      content: '❌ Причина удаления обязательна.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();

  // Проверка: нельзя удалить пользователя с таким же или более высоким уровнем
  const targetPerm = db
    .prepare('SELECT level FROM bot_permissions WHERE user_id = ?')
    .get(targetId);
  if (targetPerm && targetPerm.level >= granterLevel) {
    return interaction.reply({
      content: '❌ Нельзя удалить пользователя с таким же или более высоким уровнем прав.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Пытаемся кикнуть с сервера
  try {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member) {
      if (!canModerateMember(interaction.member, member)) {
        return interaction.reply({
          content: '❌ Нельзя удалить этого пользователя: он выше по ролям, это вы сами или владелец сервера.',
          flags: MessageFlags.Ephemeral,
        });
      }
      await member.kick(reason);
    }
  } catch (err) {
    console.error(`[ADMIN] Ошибка кика ${targetId}:`, err.message);
    // Продолжаем даже если кик не удался (пользователь мог уже покинуть сервер)
  }

  // Удаляем все данные пользователя из БД
  const tables = [
    'bot_permissions',
    'verification_attempts',
    'verification',
    'active_boosts',
    'inventory',
    'casino_stats',
    'voice_farm_log',
    'clan_members',
    'user_activity',
    'user_settings',
    'punishments',
  ];

  for (const table of tables) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(targetId);
  }

  db.prepare('DELETE FROM moderation_log WHERE target_id = ? OR moderator_id = ?')
    .run(targetId, targetId);

  // Удаляем голосовые комнаты пользователя
  const rooms = db
    .prepare('SELECT * FROM user_voice_channels WHERE owner_id = ?')
    .all(targetId);
  for (const room of rooms) {
    try {
      const vc = interaction.guild.channels.cache.get(room.voice_channel_id);
      if (vc && vc.deletable) await vc.delete('Пользователь удалён');
    } catch {}
    db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(room.id);
  }

  // Удаляем кастомные роли пользователя
  const customRoles = db
    .prepare('SELECT * FROM custom_roles WHERE creator_id = ?')
    .all(targetId);
  for (const role of customRoles) {
    try {
      const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
      if (discordRole) await discordRole.delete('Пользователь удалён');
    } catch {}
    db.prepare('DELETE FROM custom_roles WHERE id = ?').run(role.id);
  }

  // Удаляем самого пользователя
  db.prepare('DELETE FROM users WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, targetId);

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🗑 Пользователь удалён')
    .setDescription(
      `Пользователь <@${targetId}> был удалён.\n` +
      `Причина: ${reason}\n` +
      `Все данные очищены из БД.`
    )

  await interaction.reply({ embeds: [embed] });
}

/**
 * Обрабатывает модалку снятия верификации.
 */
export async function handleUnverifyModal(interaction) {
  if (interaction.customId !== 'ap_unverify_modal') return;

  const targetId = interaction.fields.getTextInputValue('ap_unverify_target').trim();
  const db = getDb();

  // Снимаем флаг верификации в БД
  db.prepare('UPDATE users SET is_verified = 0 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, targetId);

  // Снимаем роль "Верифицирован" с пользователя
  try {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    const verifiedRoleId = getVerifiedRoleId(interaction.guild.id);
    if (member && verifiedRoleId) {
      if (member.roles.cache.has(verifiedRoleId)) {
        await member.roles.remove(verifiedRoleId);
      }
    }
  } catch (err) {
    console.error(`[ADMIN] Ошибка снятия роли верификации:`, err.message);
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🔓 Верификация снята')
    .setDescription(
      `У пользователя <@${targetId}> снята верификация.\n` +
      `Роль верификации снята. Баланс и прогресс сохранены.`
    )

  await interaction.reply({ embeds: [embed] });
}

/**
 * Обрабатывает модалку выдачи верификации вручную через админ-панель.
 * Выдаёт роль "Верифицирован" + доп. роли верификации + роль уровня.
 */
export async function handleGiveVerifyModal(interaction) {
  if (interaction.customId !== 'ap_give_verify_modal') return;

  if (!requireLevel(interaction, 2)) return;

  const targetId = interaction.fields.getTextInputValue('ap_give_verify_target').trim();
  if (!isValidUserId(targetId)) {
    return interaction.reply({
      content: '❌ Некорректный ID пользователя. Он должен состоять из 17-20 цифр.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  ensureUser(targetId, interaction.guildId);

  // Проверяем, не верифицирован ли уже
  const user = db.prepare('SELECT is_verified, level FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, targetId);
  if (user?.is_verified) {
    return interaction.reply({
      content: `⚠️ Пользователь <@${targetId}> уже верифицирован.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.guild?.members.cache.get(targetId) || null;
  const display = member?.displayName || targetId;

  // Ставим флаг верификации в БД
  db.prepare('UPDATE users SET is_verified = 1 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, targetId);

  // Удаляем незавершённую попытку капчи (если есть)
  db.prepare('DELETE FROM verification_attempts WHERE user_id = ?').run(targetId);

  let rolesAdded = [];

  // Выдаём роль "Верифицирован"
  const verifiedRoleId = getVerifiedRoleId(interaction.guild.id);
  const extraRoles = getExtraVerifyRoles(interaction.guild.id);

  if (member && verifiedRoleId) {
    try {
      if (!member.roles.cache.has(verifiedRoleId)) {
        await member.roles.add(verifiedRoleId);
        rolesAdded.push(`<@&${verifiedRoleId}>`);
      }
    } catch (err) {
      console.error(`[ADMIN] Ошибка выдачи роли верификации ${targetId}:`, err.message);
    }
  }

  if (member && extraRoles.length > 0) {
    const validRoles = extraRoles.filter((id) => {
      const role = interaction.guild?.roles.cache.get(id);
      return !!role;
    });
    if (validRoles.length > 0) {
      try {
        await member.roles.add(validRoles);
        for (const id of validRoles) rolesAdded.push(`<@&${id}>`);
      } catch (err) {
        console.error(`[ADMIN] Ошибка выдачи доп. ролей верификации ${targetId}:`, err.message);
      }
    }
  }

  // Выдаём роль уровня
  const userData = db.prepare('SELECT level FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, targetId);
  let levelRoleMsg = '';
  if (member && userData) {
    const before = member.roles.cache.size;
    await assignLevelRoles(member, userData.level);
    const after = member.roles.cache.size;
    if (after > before) levelRoleMsg = `\n🎚 Выдана роль уровня **${userData.level}**.`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Верификация выдана')
    .setDescription(`Пользователь **${display}** верифицирован вручную.`)
    .addFields(
      { name: '👤 Пользователь', value: `<@${targetId}>`, inline: true },
      { name: '🎭 Роли', value: rolesAdded.length > 0 ? rolesAdded.join(', ') : '⚠️ Роли не выданы (пользователь не на сервере или нет прав).', inline: false },
    )
    .setFooter({ text: 'Выдал: ' + interaction.user.displayName })

  if (levelRoleMsg) {
    embed.addFields({ name: '🎚 Уровень', value: levelRoleMsg, inline: false });
  }

  await interaction.reply({ embeds: [embed] });
}

/**
 * Обрабатывает модалки экономики: баланс, бесконечный баланс, XP.
 */
export async function handleEconomyModal(interaction) {
  const { customId } = interaction;
  const econModals = [
    'ap_add_balance_modal',
    'ap_remove_balance_modal',
    'ap_set_infinite_modal',
    'ap_clear_infinite_modal',
    'ap_add_xp_modal',
    'ap_remove_xp_modal',
  ];
  if (!econModals.includes(customId)) return;

  if (!requireLevel(interaction, 2)) return;

  const targetId = interaction.fields.getTextInputValue('ap_econ_target').trim();
  if (!isValidUserId(targetId)) {
    return interaction.reply({
      content: '❌ Некорректный ID пользователя. Он должен состоять из 17-20 цифр.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  ensureUser(targetId, interaction.guildId);

  const member = interaction.guild?.members.cache.get(targetId) || null;
  const display = member?.displayName || targetId;

  // ─── Снять бесконечный баланс (только ID) ──────────────────
  if (customId === 'ap_clear_infinite_modal') {
    db.prepare('UPDATE users SET is_infinite_balance = 0 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, targetId);

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('♾️ Бесконечный баланс снят')
      .setDescription(
        `У **${display}** снят флаг бесконечного баланса.\n` +
        `Теперь баланс участвует в общем рейтинге \`/топ\`.`
      )

    return interaction.reply({ embeds: [embed] });
  }

  const amountStr = interaction.fields.getTextInputValue('ap_econ_amount').trim();
  const amount = parseInt(amountStr, 10);
  if (!isValidPositiveInt(amount)) {
    return interaction.reply({
      content: '❌ Сумма должна быть положительным целым числом.',
      flags: MessageFlags.Ephemeral,
    });
  }

  let embed;

  switch (customId) {
    case 'ap_add_balance_modal': {
      addCoins(targetId, amount, interaction.guildId);
      embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Баланс начислен')
        .setDescription(`Пользователь **${display}** получил **${amount} ⚡HLD**`)
      break;
    }

    case 'ap_remove_balance_modal': {
      const user = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, targetId);
      if (user.balance < amount) {
        return interaction.reply({
          content: `❌ Недостаточно средств! У **${display}** всего **${user.balance} ⚡HLD**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      removeCoins(targetId, amount, interaction.guildId);
      embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('✅ Баланс списан')
        .setDescription(
          `У **${display}** списано **${amount} ⚡HLD**\n` +
          `Остаток: **${user.balance - amount} ⚡HLD**`
        )
      break;
    }

    case 'ap_set_infinite_modal': {
      db.prepare(
        'UPDATE users SET balance = ?, is_infinite_balance = 1 WHERE guild_id = ? AND user_id = ?'
      ).run(amount, interaction.guildId, targetId);
      embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('♾️ Бесконечный баланс установлен')
        .setDescription(
          `Пользователь **${display}** теперь имеет бесконечный баланс ♾️\n` +
          `Значение: **${amount} ⚡HLD**\n\n` +
          `⚠️ Этот баланс не участвует в рейтинге \`/топ\`.`
        )
      break;
    }

    case 'ap_add_xp_modal': {
      const xpResult = addXp(targetId, amount, interaction.guildId);
      let levelUpMsg = '';
      if (xpResult && member) {
        const reached = await checkLevelMilestones(
          member,
          xpResult.oldLevel,
          xpResult.newLevel,
        );
        levelUpMsg = `\n🎉 **Уровень повышен: ${xpResult.oldLevel} → ${xpResult.newLevel}!**`;
        if (reached.length > 0) {
          levelUpMsg += `\n🏆 Отметки: **${reached.join(', ')}**`;
        }
      } else if (xpResult) {
        levelUpMsg = `\n🎉 **Уровень повышен: ${xpResult.oldLevel} → ${xpResult.newLevel}!**`;
        const reached = getReachedMilestones(xpResult.oldLevel, xpResult.newLevel);
        if (reached.length > 0) {
          levelUpMsg += `\n🏆 Отметки: **${reached.join(', ')}**`;
        }
      }
      embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('✅ XP начислен')
        .setDescription(`**${display}** получил **${amount} XP**${levelUpMsg}`)
      break;
    }

    case 'ap_remove_xp_modal': {
      const userBefore = db.prepare('SELECT level FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, targetId);
      const oldLevel = userBefore.level;
      const newLevel = removeXp(targetId, amount, interaction.guildId);
      let levelDownMsg = '';
      if (newLevel && newLevel < oldLevel && member) {
        levelDownMsg = `\n📉 **Уровень понижен до ${newLevel}!**`;
        const oldRoleId = getRoleIdForLevel(oldLevel);
        if (oldRoleId) {
          await removeLevelRole(member, oldRoleId);
        }
        await assignLevelRoles(member, newLevel);
      }
      embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('✅ XP снят')
        .setDescription(`У **${display}** снято **${amount} XP**${levelDownMsg}`)
      break;
    }
  }

  await interaction.reply({ embeds: [embed] });
}

/**
 * Обрабатывает модалки модерации: warn, mute, kick, ban, warns.
 */
export async function handleModerationModal(interaction) {
  const { customId } = interaction;
  const modModals = [
    'ap_warn_modal',
    'ap_mute_modal',
    'ap_kick_modal',
    'ap_ban_modal',
    'ap_warns_modal',
  ];
  if (!modModals.includes(customId)) return;

  if (!requireLevel(interaction, 1)) return;

  const targetId = interaction.fields.getTextInputValue('ap_mod_target').trim();
  if (!isValidUserId(targetId)) {
    return interaction.reply({
      content: '❌ Некорректный ID пользователя. Он должен состоять из 17-20 цифр.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  const guild = interaction.guild;
  let member = guild?.members.cache.get(targetId) || null;
  if (!member && guild) {
    member = await guild.members.fetch(targetId).catch(() => null);
  }
  const display = member?.displayName || targetId;

  if (customId !== 'ap_warns_modal' && member && !canModerateMember(interaction.member, member)) {
    return interaction.reply({
      content: '❌ Нельзя модерировать этого пользователя: он выше по ролям, это вы сами или владелец сервера.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Список предупреждений ─────────────────────────────────
  if (customId === 'ap_warns_modal') {
    const punishments = db.prepare(`
      SELECT * FROM punishments WHERE user_id = ? AND action = 'warn' AND (guild_id = ? OR guild_id = '')
      ORDER BY created_at DESC LIMIT 10
    `).all(targetId, interaction.guildId);

    if (punishments.length === 0) {
      return interaction.reply({
        content: `✅ У **${display}** нет предупреждений.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`📋 Предупреждения — ${display}`)
      .setDescription(`Всего предупреждений: **${punishments.length}**`)

    for (const p of punishments.slice(0, 5)) {
      embed.addFields({
        name: `⚠️ #${p.id} — ${new Date(p.created_at).toLocaleString('ru-RU')}`,
        value: `**Причина:** ${p.reason || 'Не указана'}\n**Модератор:** <@${p.moderator_id}>`,
        inline: false,
      });
    }

    if (punishments.length > 5) {
      embed.setFooter({ text: `Показано 5 из ${punishments.length}` });
    }

    return interaction.reply({ embeds: [embed] });
  }

  const reason = interaction.fields.getTextInputValue('ap_mod_reason')?.trim() || 'Не указана';

  // ─── Mute ───────────────────────────────────────────────────
  if (customId === 'ap_mute_modal') {
    const durationStr = interaction.fields.getTextInputValue('ap_mod_duration').trim();
    const durationMinutes = parseInt(durationStr, 10);

    if (!isValidPositiveInt(durationMinutes)) {
      return interaction.reply({
        content: '❌ Длительность должна быть положительным числом (в минутах).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;
    if (durationMinutes > MAX_TIMEOUT_MINUTES) {
      return interaction.reply({
        content: '❌ Максимальный мут в Discord — **28 дней** (40320 мин.).',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!member) {
      return interaction.reply({
        content: '❌ Пользователь не найден на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await member.timeout(durationMinutes * 60 * 1000, reason);

      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'mute',
        reason,
        durationSeconds: durationMinutes * 60,
        expiresAtSql: `+${durationMinutes} minutes`,
        guildId: interaction.guildId,
      });

      try {
        const dm = await (await guild.members.fetch(targetId)).user.createDM();
        await dm.send({
          content: `🔇 **Мут** на сервере **${guild.name}**\n**Длительность:** ${durationMinutes} мин.\n**Причина:** ${reason}`,
        });
      } catch {}

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🔇 Мут')
        .setDescription(`Пользователь **${member.displayName}** замьючен.`)
        .addFields(
          { name: '👤 Пользователь', value: `<@${targetId}>`, inline: true },
          { name: '⏱ Длительность', value: `**${durationMinutes}** мин.`, inline: true },
          { name: '📄 Причина', value: reason, inline: false },
        )

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('[MOD] Ошибка мута:', err);
      return interaction.reply({
        content: `❌ Ошибка при муте: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ─── Warn / Kick / Ban ─────────────────────────────────────
  try {
    let embed;

    if (customId === 'ap_warn_modal') {
      ensureUser(targetId, interaction.guildId);
      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'warn',
        reason,
        guildId: interaction.guildId,
      });

      try {
        const dm = await (await guild.members.fetch(targetId)).user.createDM();
        await dm.send({
          content: `⚠️ **Предупреждение** на сервере **${guild.name}**\n**Причина:** ${reason}\n**Модератор:** ${interaction.user.displayName}`,
        });
      } catch {}

      embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('⚠️ Предупреждение')
        .setDescription(`Пользователь **${display}** получил предупреждение.`)
        .addFields(
          { name: '👤 Пользователь', value: `<@${targetId}>`, inline: true },
          { name: '📄 Причина', value: reason, inline: true },
        )
    } else if (customId === 'ap_kick_modal') {
      if (!member) {
        return interaction.reply({
          content: '❌ Пользователь не найден на сервере.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await member.kick(reason);

      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'kick',
        reason,
        guildId: interaction.guildId,
      });

      embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('👢 Кик')
        .setDescription(`Пользователь **${member.displayName}** кикнут.`)
        .addFields(
          { name: '👤 Пользователь', value: `<@${targetId}>`, inline: true },
          { name: '📄 Причина', value: reason, inline: true },
        )
    } else if (customId === 'ap_ban_modal') {
      await guild.bans.create(targetId, { reason });

      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'ban',
        reason,
        guildId: interaction.guildId,
      });

      embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🔨 Бан')
        .setDescription(`Пользователь **${display}** забанен.`)
        .addFields(
          { name: '👤 Пользователь', value: `<@${targetId}>`, inline: true },
          { name: '📄 Причина', value: reason, inline: true },
        )
    }

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error('[MOD] Ошибка:', err);
    return interaction.reply({
      content: `❌ Ошибка при выполнении действия: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// КОМАНДА /АДМИН-ПАНЕЛЬ
// ══════════════════════════════════════════════════════════════════

const adminPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('панель')
    .setDescription('Админ-центр: экономика, права, модерация'),

  async execute(interaction) {
    const userLevel = getUserLevel(interaction.user.id, interaction.guild);

    if (userLevel < 1) {
      return interaction.reply({
        content: '❌ У тебя недостаточно прав для использования админ-панели.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const { embed, components } = buildAdminPanel(userLevel);
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  },
};

export default adminPanelCommand;

