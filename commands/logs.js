// ══════════════════════════════════════════════════════════════════
// КОМАНДА /ЛОГИ — Настройка логирования сервера
// ══════════════════════════════════════════════════════════════════
// Позволяет администратору:
//   1. Создать каналы и роли-фильтры логирования (автоматически)
//   2. Выбрать уровень логирования (все / важные / модерация / выкл)
//   3. Выбрать общий канал для логов (опционально)
//
// Права: ManageGuild (управление сервером)
// Подкоманды:
//   /логи setup — создать каналы и роли логирования
//   /логи level <все|важные|модерация|выкл> — установить уровень
//   /логи channel <канал> — указать общий канал логов
//   /логи status — показать текущую настройку
// ══════════════════════════════════════════════════════════════════

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import {
  getLogConfig,
  setupLogChannels,
  setLogLevel,
  setLogChannel,
  LOG_LEVELS,
  LOG_ROLE_NAMES,
  LOG_PING_ROLE_NAMES,
  LOG_CHANNEL_NAMES,
  levelLabel,
  saveLogConfig,
  clearLogConfigCache,
} from '../modules/logger.js';

// Проверка прав ManageGuild
function canManage(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({
      content: '❌ **У вас нет прав для настройки логирования.**\nНеобходимо право "Управлять сервером" (ManageGuild).',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return false;
  }
  return true;
}

export default {
  data: new SlashCommandBuilder()
    .setName('логи')
    .setDescription('📜 Настройка логирования сервера и ролей-фильтров')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Создать каналы и роли логирования (все / важные / модерация)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('level')
        .setDescription('Установить уровень логирования')
        .addStringOption((opt) =>
          opt
            .setName('уровень')
            .setDescription('Уровень логирования')
            .setRequired(true)
            .addChoices(
              { name: '📜 Все события', value: 'all' },
              { name: '⭐ Важные', value: 'important' },
              { name: '🛡 Модерация', value: 'moderation' },
              { name: '🚫 Выключить', value: 'off' },
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Указать общий канал для логов')
        .addChannelOption((opt) =>
          opt
            .setName('канал')
            .setDescription('Канал, куда отправлять логи')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ping')
        .setDescription('Настроить роль для пинга при логировании')
        .addStringOption((opt) =>
          opt
            .setName('уровень')
            .setDescription('Уровень логирования')
            .setRequired(true)
            .addChoices(
              { name: '📜 Все события', value: 'all' },
              { name: '⭐ Важные', value: 'important' },
              { name: '🛡 Модерация', value: 'moderation' },
            )
        )
        .addChannelOption((opt) =>
          opt
            .setName('канал')
            .setDescription('Канал, где будет создана/использована роль для пинга')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ping-target')
        .setDescription('Включить/выключить пинг целевого пользователя в логах')
        .addStringOption((opt) =>
          opt
            .setName('статус')
            .setDescription('Статус пинга цели')
            .setRequired(true)
            .addChoices(
              { name: '✅ Включить', value: 'on' },
              { name: '❌ Выключить', value: 'off' },
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ping-actor')
        .setDescription('Включить/выключить пинг модератора (актора) в логах')
        .addStringOption((opt) =>
          opt
            .setName('статус')
            .setDescription('Статус пинга модератора')
            .setRequired(true)
            .addChoices(
              { name: '✅ Включить', value: 'on' },
              { name: '❌ Выключить', value: 'off' },
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Показать текущую настройку логирования')
    ),

  async execute(interaction) {
    if (!canManage(interaction)) return;

    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'setup') {
        await handleSetup(interaction);
      } else if (sub === 'level') {
        await handleLevel(interaction);
      } else if (sub === 'channel') {
        await handleChannel(interaction);
      } else if (sub === 'ping') {
        await handlePing(interaction);
      } else if (sub === 'ping-target') {
        await handlePingTarget(interaction);
      } else if (sub === 'ping-actor') {
        await handlePingActor(interaction);
      } else if (sub === 'status') {
        await handleStatus(interaction);
      }
    } catch (err) {
      console.error('[ЛОГИ] Ошибка:', err);
      await interaction.reply({
        content: `❌ Ошибка при настройке логирования: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА SETUP
// ══════════════════════════════════════════════════════════════════

async function handleSetup(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { roles, pingRoles, channels } = await setupLogChannels(interaction.guild);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📜 Логирование настроено!')
    .setDescription(
      'Созданы каналы, роли-фильтры и роли для пинга. Каждый уровень логов виден только соответствующим ролям.\n\n' +
      '**Уровни видимости:**'
    )
    .addFields(
      {
        name: '🛡 Модерация',
        value: `Канал: ${channels.moderation ? `<#${channels.moderation.id}>` : '❌'}\nРоль: ${roles.moderation ? `<@&${roles.moderation.id}>` : '❌'}\nПинг: ${pingRoles.moderation ? `<@&${pingRoles.moderation.id}>` : '❌'}\nВиден: только роли модерации`,
        inline: true,
      },
      {
        name: '⭐ Важные',
        value: `Канал: ${channels.important ? `<#${channels.important.id}>` : '❌'}\nРоль: ${roles.important ? `<@&${roles.important.id}>` : '❌'}\nПинг: ${pingRoles.important ? `<@&${pingRoles.important.id}>` : '❌'}\nВиден: ролям важных и модерации`,
        inline: true,
      },
      {
        name: '📜 Все',
        value: `Канал: ${channels.all ? `<#${channels.all.id}>` : '❌'}\nРоль: ${roles.all ? `<@&${roles.all.id}>` : '❌'}\nПинг: ${pingRoles.all ? `<@&${pingRoles.all.id}>` : '❌'}\nВиден: всем ролям логирования`,
        inline: true,
      },
    )
    .setFooter({ text: 'Используйте /логи level, чтобы выбрать уровень логирования' });

  await interaction.editReply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА LEVEL
// ══════════════════════════════════════════════════════════════════

async function handleLevel(interaction) {
  const level = interaction.options.getString('уровень');
  setLogLevel(interaction.guild.id, level);

  const config = getLogConfig(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(level === 'off' ? 0xe74c3c : 0x2ecc71)
    .setTitle('✅ Уровень логирования установлен')
    .setDescription(
      `Текущий уровень: **${levelLabel(level)}**\n\n` +
      (level === 'off'
        ? '🚫 Логирование полностью отключено.'
        : 'События соответствующего уровня будут записываться в выбранные каналы.')
    )
    .setFooter({ text: `Канал: ${config?.channel_id ? `<#${config.channel_id}>` : 'не указан'}` });

  await interaction.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА CHANNEL
// ══════════════════════════════════════════════════════════════════

async function handleChannel(interaction) {
  const channel = interaction.options.getChannel('канал');

  // Проверяем, что это текстовый канал
  if (channel.type !== 0 && channel.type !== 5) { // 0 = GuildText, 5 = GuildAnnouncement
    return interaction.reply({
      content: '❌ Канал должен быть текстовым.',
      flags: MessageFlags.Ephemeral,
    });
  }

  setLogChannel(interaction.guild.id, channel.id);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Канал логов установлен')
    .setDescription(`Все события будут отправляться в канал ${channel.toString()}.`)
    .setFooter({ text: '⚠️ Если каналы-уровни уже созданы, события будут распределяться по ним.' });

  await interaction.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА STATUS
// ══════════════════════════════════════════════════════════════════

async function handleStatus(interaction) {
  const config = getLogConfig(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📜 Статус логирования')
    .setDescription(
      config
        ? `**Уровень:** ${levelLabel(config.level)}`
        : 'Логирование ещё не настроено. Используйте `/логи setup`.'
    );

  if (config) {
    const fields = [
      { name: '📋 Общий канал', value: config.channel_id ? `<#${config.channel_id}>` : 'Не указан', inline: true },
      { name: '🛡 Канал модерации', value: config.channel_moderation ? `<#${config.channel_moderation}>` : '—', inline: true },
      { name: '⭐ Канал важных', value: config.channel_important ? `<#${config.channel_important}>` : '—', inline: true },
      { name: '📜 Канал всех', value: config.channel_all ? `<#${config.channel_all}>` : '—', inline: true },
      { name: '🛡 Роль модерации', value: config.role_view_moderation ? `<@&${config.role_view_moderation}>` : '—', inline: true },
      { name: '⭐ Роль важных', value: config.role_view_important ? `<@&${config.role_view_important}>` : '—', inline: true },
      { name: '📜 Роль всех', value: config.role_view_all ? `<@&${config.role_view_all}>` : '—', inline: true },
      { name: '', value: '🔔 **Пинги**', inline: false },
      { name: '🛡 Пинг модерации', value: config.ping_role_moderation ? `<@&${config.ping_role_moderation}>` : '—', inline: true },
      { name: '⭐ Пинг важных', value: config.ping_role_important ? `<@&${config.ping_role_important}>` : '—', inline: true },
      { name: '📜 Пинг всех', value: config.ping_role_all ? `<@&${config.ping_role_all}>` : '—', inline: true },
      { name: '🎯 Пинг цели (target)', value: config.ping_target ? '✅ Да' : '❌ Нет', inline: true },
      { name: '🛠 Пинг модератора (actor)', value: config.ping_actor ? '✅ Да' : '❌ Нет', inline: true },
    ];
    embed.addFields(fields);
  }

  await interaction.reply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА PING — Настройка роли для пинга
// ══════════════════════════════════════════════════════════════════

async function handlePing(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const level = interaction.options.getString('уровень');
  const channel = interaction.options.getChannel('канал');

  // Находим или создаём роль пинга
  const pingRoleName = LOG_PING_ROLE_NAMES[level];
  let pingRole = interaction.guild.roles.cache.find(r => r.name === pingRoleName);

  if (!pingRole) {
    try {
      pingRole = await interaction.guild.roles.create({
        name: pingRoleName,
        color: level === 'moderation' ? 0xE74C3C : level === 'important' ? 0xF39C12 : 0x2ECC71,
        reason: 'Создана через /логи ping',
      });
    } catch (err) {
      return interaction.editReply({
        content: `❌ Ошибка при создании роли пинга: ${err.message}`,
      });
    }
  }

  // Сохраняем
  const existing = getLogConfig(interaction.guild.id) || {};
  const key = `pingRole${level.charAt(0).toUpperCase() + level.slice(1)}`;
  saveLogConfig(interaction.guild.id, { ...existing, [key]: pingRole.id });

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Роль для пинга установлена')
    .setDescription(
      `Роль для пинга уровня **${levelLabel(level)}** установлена на <@&${pingRole.id}>.\n` +
      `Канал: ${channel}. При событиях этого уровня роль будет упоминаться в сообщении лога.`
    );

  await interaction.editReply({ embeds: [embed] });
}

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА PING-TARGET — Пинг целевого пользователя
// ══════════════════════════════════════════════════════════════════

async function handlePingTarget(interaction) {
  const status = interaction.options.getString('статус');
  const existing = getLogConfig(interaction.guild.id) || {};
  saveLogConfig(interaction.guild.id, { ...existing, pingTarget: status === 'on' ? 1 : 0 });

  const embed = new EmbedBuilder()
    .setColor(status === 'on' ? 0x2ecc71 : 0xe74c3c)
    .setTitle(status === 'on' ? '✅ Пинг цели включён' : '❌ Пинг цели выключен')
    .setDescription(
      status === 'on'
        ? 'Целевые пользователи (<@target>) будут упоминаться в логах.'
        : 'Целевые пользователи не будут упоминаться в логах.'
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ══════════════════════════════════════════════════════════════════
// ПОДКОМАНДА PING-ACTOR — Пинг модератора/актора
// ══════════════════════════════════════════════════════════════════

async function handlePingActor(interaction) {
  const status = interaction.options.getString('статус');
  const existing = getLogConfig(interaction.guild.id) || {};
  saveLogConfig(interaction.guild.id, { ...existing, pingActor: status === 'on' ? 1 : 0 });

  const embed = new EmbedBuilder()
    .setColor(status === 'on' ? 0x2ecc71 : 0xe74c3c)
    .setTitle(status === 'on' ? '✅ Пинг модератора включён' : '❌ Пинг модератора выключен')
    .setDescription(
      status === 'on'
        ? 'Модераторы (<@actor>) будут упоминаться в логах при модерационных действиях.'
        : 'Модераторы не будут упоминаться в логах.'
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
