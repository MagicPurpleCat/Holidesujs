import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getDb, ensureUser, logPunishment } from '../database.js';
import { canModerateMember, getUserLevel } from '../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('🛠 Модерация')
    .addSubcommand((sub) =>
      sub
        .setName('warn')
        .setDescription('⚠️ Выдать предупреждение')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Пользователь').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Причина').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('mute')
        .setDescription('🔇 Замутить пользователя')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Пользователь').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('duration').setDescription('Длительность в минутах').setRequired(true).setMinValue(1)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Причина').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('👢 Кикнуть пользователя')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Пользователь').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Причина').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('ban')
        .setDescription('🔨 Забанить пользователя')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Пользователь').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Причина').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('warns')
        .setDescription('📋 Показать предупреждения пользователя')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Пользователь').setRequired(true)
        )
    ),

  async execute(interaction) {
    try {
      // Проверка прав: ModerateMembers или Administrator
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers) &&
          !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          getUserLevel(interaction.user.id, interaction.guild) < 1) {
        return interaction.reply({
          content: '❌ У тебя нет прав модератора для этой команды.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const sub = interaction.options.getSubcommand();
      const db = getDb();

      if (sub === 'warn') {
        return handleWarn(interaction, db);
      } else if (sub === 'mute') {
        return handleMute(interaction, db);
      } else if (sub === 'kick') {
        return handleKick(interaction, db);
      } else if (sub === 'ban') {
        return handleBan(interaction, db);
      } else if (sub === 'warns') {
        return handleWarns(interaction, db);
      }
    } catch (error) {
      console.error('[MOD] Ошибка:', error);
      await interaction.reply({
        content: '❌ Произошла ошибка при выполнении команды модерации.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

async function handleWarn(interaction, db) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Не указана';
  const member = interaction.guild.members.cache.get(target.id);

  ensureUser(target.id);
  logPunishment({
    userId: target.id,
    moderatorId: interaction.user.id,
    action: 'warn',
    reason,
  });

  // Отправляем ЛС
  try {
    const dm = await target.createDM();
    await dm.send({
      content: `⚠️ **Предупреждение** на сервере **${interaction.guild.name}**\n**Причина:** ${reason}\n**Модератор:** ${interaction.user.displayName}`,
    });
  } catch {
    // ЛС закрыты — игнорируем
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('⚠️ Предупреждение')
    .setDescription(`Пользователь **${target.displayName}** получил предупреждение.`)
    .addFields(
      { name: '👤 Пользователь', value: `<@${target.id}>`, inline: true },
      { name: '📄 Причина', value: reason, inline: true },
    )

  await interaction.reply({ embeds: [embed] });
}

async function handleMute(interaction, db) {
  const target = interaction.options.getUser('user');
  const durationMinutes = interaction.options.getInteger('duration');
  const reason = interaction.options.getString('reason') || 'Не указана';
  const member = interaction.guild.members.cache.get(target.id);

  if (!member) {
    return interaction.reply({
      content: '❌ Пользователь не найден на сервере.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!canModerateMember(interaction.member, member)) {
    return interaction.reply({
      content: '❌ Нельзя модерировать этого пользователя: он выше по ролям, это вы сами или владелец сервера.',
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

  try {
    // Используем timeout
    const durationMs = durationMinutes * 60 * 1000;
    await member.timeout(durationMs, reason);

    logPunishment({
      userId: target.id,
      moderatorId: interaction.user.id,
      action: 'mute',
      reason,
      durationSeconds: durationMinutes * 60,
      expiresAtSql: `+${durationMinutes} minutes`,
    });

    // ЛС
    try {
      const dm = await target.createDM();
      await dm.send({
        content: `🔇 **Мут** на сервере **${interaction.guild.name}**\n**Длительность:** ${durationMinutes} мин.\n**Причина:** ${reason}`,
      });
    } catch { /* ignore */ }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🔇 Мут')
      .setDescription(`Пользователь **${target.displayName}** замьючен.`)
      .addFields(
        { name: '👤 Пользователь', value: `<@${target.id}>`, inline: true },
        { name: '⏱ Длительность', value: `**${durationMinutes}** мин.`, inline: true },
        { name: '📄 Причина', value: reason, inline: false },
      )

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error('[MOD] Ошибка мута:', err);
    await interaction.reply({
      content: `❌ Ошибка при муте: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleKick(interaction, db) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Не указана';
  const member = interaction.guild.members.cache.get(target.id);

  if (!member) {
    return interaction.reply({
      content: '❌ Пользователь не найден на сервере.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!canModerateMember(interaction.member, member)) {
    return interaction.reply({
      content: '❌ Нельзя кикнуть этого пользователя: он выше по ролям, это вы сами или владелец сервера.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await member.kick(reason);

    logPunishment({
      userId: target.id,
      moderatorId: interaction.user.id,
      action: 'kick',
      reason,
    });

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('👢 Кик')
      .setDescription(`Пользователь **${target.displayName}** кикнут.`)
      .addFields(
        { name: '👤 Пользователь', value: `<@${target.id}>`, inline: true },
        { name: '📄 Причина', value: reason, inline: true },
      )

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    await interaction.reply({
      content: `❌ Ошибка при кике: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleBan(interaction, db) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Не указана';
  const member = interaction.guild.members.cache.get(target.id);

  if (member && !canModerateMember(interaction.member, member)) {
    return interaction.reply({
      content: '❌ Нельзя забанить этого пользователя: он выше по ролям, это вы сами или владелец сервера.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await interaction.guild.bans.create(target.id, { reason });

    logPunishment({
      userId: target.id,
      moderatorId: interaction.user.id,
      action: 'ban',
      reason,
    });

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🔨 Бан')
      .setDescription(`Пользователь **${target.displayName}** забанен.`)
      .addFields(
        { name: '👤 Пользователь', value: `<@${target.id}>`, inline: true },
        { name: '📄 Причина', value: reason, inline: true },
      )

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    await interaction.reply({
      content: `❌ Ошибка при бане: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleWarns(interaction, db) {
  const target = interaction.options.getUser('user');

  const punishments = db.prepare(`
    SELECT * FROM punishments WHERE user_id = ? AND action = 'warn' ORDER BY created_at DESC LIMIT 10
  `).all(target.id);

  if (punishments.length === 0) {
    return interaction.reply({
      content: `✅ У **${target.displayName}** нет предупреждений.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`📋 Предупреждения — ${target.displayName}`)
    .setThumbnail(target.displayAvatarURL())
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

  await interaction.reply({ embeds: [embed] });
}

