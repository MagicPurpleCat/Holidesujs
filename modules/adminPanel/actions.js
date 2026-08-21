import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import {
  getDb,
  ensureUser,
  addCoins,
  removeCoins,
  addXp,
  removeXp,
  logPunishment,
} from '../../database.js';
import { getUserLevel, levelName, canGrant, canModerateMember } from '../../utils/permissions.js';
import { getVerifiedRoleId, getExtraVerifyRoles } from '../verification.js';
import {
  assignLevelRoles,
  removeLevelRole,
  getRoleIdForLevel,
  checkLevelMilestones,
  getReachedMilestones,
} from '../../commands/rank.js';
import { setGuildFeature, getGuildConfig, DEFAULT_FEATURES } from '../../utils/guildConfig.js';
import { COLOR, fmtNum, brandEmbed } from '../../utils/ui.js';
import { AP, modalId } from './ids.js';
import {
  isValidUserId,
  isValidPositiveInt,
  requireLevel,
  resultView,
  denyView,
  backCloseRow,
  navFooter,
} from './helpers.js';
import {
  buildLookupView,
  buildRevokeView,
  buildServerSection,
} from './views.js';

export function showAmountModal(interaction, action, targetId, title, amountLabel) {
  const modal = new ModalBuilder()
    .setCustomId(modalId(action, targetId))
    .setTitle(title.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ap_amount')
        .setLabel(amountLabel)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Число'),
    ),
  );
  return interaction.showModal(modal);
}

export function showReasonModal(interaction, action, targetId, title, extraFields = []) {
  const modal = new ModalBuilder()
    .setCustomId(modalId(action, targetId))
    .setTitle(title.slice(0, 45));

  const rows = [];
  for (const field of extraFields) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label)
          .setStyle(field.style || TextInputStyle.Short)
          .setRequired(field.required !== false)
          .setPlaceholder(field.placeholder || ''),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ap_reason')
        .setLabel('Причина')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Необязательно'),
    ),
  );
  modal.addComponents(...rows.slice(0, 5));
  return interaction.showModal(modal);
}

export async function openRevokeList(interaction) {
  if (!(await requireLevel(interaction, 2))) return true;
  const db = getDb();
  const permUsers = db
    .prepare('SELECT user_id, level FROM bot_permissions WHERE user_id != ? ORDER BY level DESC')
    .all(interaction.user.id);

  if (!permUsers.length) {
    return interaction.update(
      denyView(interaction, 'Нет других пользователей с правами в `bot_permissions`.'),
    );
  }

  const enriched = [];
  for (const pu of permUsers.slice(0, 25)) {
    let label = pu.user_id;
    try {
      const mem = await interaction.guild.members.fetch(pu.user_id).catch(() => null);
      if (mem) label = mem.displayName;
    } catch {
      /* ignore */
    }
    enriched.push({ ...pu, label });
  }

  return interaction.update(buildRevokeView(interaction, enriched));
}

export async function handleRevokeSelect(interaction) {
  if (!(await requireLevel(interaction, 2))) return true;
  const userLevel = getUserLevel(interaction.user.id, interaction.guild);
  const targetId = interaction.values[0];
  const db = getDb();
  const targetPerm = db.prepare('SELECT level FROM bot_permissions WHERE user_id = ?').get(targetId);

  if (!targetPerm) {
    return interaction.update(denyView(interaction, 'У этого пользователя нет прав.'));
  }
  if (targetPerm.level >= userLevel) {
    return interaction.update(
      denyView(interaction, 'Нельзя снять права у равного или более высокого уровня.'),
    );
  }

  db.prepare('DELETE FROM bot_permissions WHERE user_id = ?').run(targetId);
  return interaction.update(
    resultView(interaction, {
      title: 'Права сняты',
      description: `У <@${targetId}> сняты права персонала.`,
      backNav: AP.nav.users,
      section: 'пользователи',
    }),
  );
}

export async function handleGrantLevel(interaction, targetId, levelStr) {
  if (!(await requireLevel(interaction, 2))) return true;
  const granterLevel = getUserLevel(interaction.user.id, interaction.guild);
  const targetLevel = parseInt(levelStr, 10);

  if (![1, 2].includes(targetLevel)) {
    return interaction.update(denyView(interaction, 'Доступны только Mod (1) и Admin (2).'));
  }
  if (!canGrant(granterLevel, targetLevel)) {
    return interaction.update(
      denyView(interaction, 'Owner выдаёт Admin/Mod. Admin — только Mod.'),
    );
  }

  ensureUser(targetId, interaction.guildId);
  getDb().prepare(`
    INSERT INTO bot_permissions (user_id, level, granted_by)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      level = excluded.level,
      granted_by = excluded.granted_by,
      granted_at = datetime('now')
  `).run(targetId, targetLevel, interaction.user.id);

  return interaction.update(
    resultView(interaction, {
      title: 'Права выданы',
      description: `<@${targetId}> → **${levelName(targetLevel)}**`,
      backNav: AP.nav.users,
      section: 'пользователи',
    }),
  );
}

export async function giveVerify(interaction, targetId) {
  if (!(await requireLevel(interaction, 2))) return true;
  if (!isValidUserId(targetId)) {
    return interaction.update(denyView(interaction, 'Некорректный ID.'));
  }

  const db = getDb();
  ensureUser(targetId, interaction.guildId);
  const user = db.prepare(
    'SELECT is_verified, level FROM users WHERE guild_id = ? AND user_id = ?',
  ).get(interaction.guildId, targetId);

  if (user?.is_verified) {
    return interaction.update(
      denyView(interaction, `<@${targetId}> уже верифицирован.`),
    );
  }

  const member = interaction.guild?.members.cache.get(targetId)
    || await interaction.guild?.members.fetch(targetId).catch(() => null);

  db.prepare('UPDATE users SET is_verified = 1 WHERE guild_id = ? AND user_id = ?')
    .run(interaction.guildId, targetId);
  db.prepare('DELETE FROM verification_attempts WHERE user_id = ?').run(targetId);

  const rolesAdded = [];
  const verifiedRoleId = getVerifiedRoleId(interaction.guild.id);
  const extraRoles = getExtraVerifyRoles(interaction.guild.id);

  if (member && verifiedRoleId) {
    try {
      if (!member.roles.cache.has(verifiedRoleId)) {
        await member.roles.add(verifiedRoleId);
        rolesAdded.push(`<@&${verifiedRoleId}>`);
      }
    } catch (err) {
      console.error('[ADMIN] verify role:', err.message);
    }
  }
  if (member && extraRoles.length) {
    try {
      await member.roles.add(extraRoles.filter((id) => interaction.guild.roles.cache.has(id)));
      for (const id of extraRoles) {
        if (interaction.guild.roles.cache.has(id)) rolesAdded.push(`<@&${id}>`);
      }
    } catch (err) {
      console.error('[ADMIN] extra verify roles:', err.message);
    }
  }
  if (member && user) {
    await assignLevelRoles(member, user.level || 1);
  }

  return interaction.update(
    resultView(interaction, {
      title: 'Верификация выдана',
      description:
        `<@${targetId}>\nРоли: ${rolesAdded.length ? rolesAdded.join(', ') : 'не выданы (нет на сервере / прав)'}`,
      backNav: AP.nav.users,
      section: 'пользователи',
    }),
  );
}

export async function takeVerify(interaction, targetId) {
  if (!(await requireLevel(interaction, 2))) return true;
  const db = getDb();
  db.prepare('UPDATE users SET is_verified = 0 WHERE guild_id = ? AND user_id = ?')
    .run(interaction.guildId, targetId);

  try {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    const verifiedRoleId = getVerifiedRoleId(interaction.guild.id);
    if (member && verifiedRoleId && member.roles.cache.has(verifiedRoleId)) {
      await member.roles.remove(verifiedRoleId);
    }
  } catch (err) {
    console.error('[ADMIN] unverify:', err.message);
  }

  return interaction.update(
    resultView(interaction, {
      title: 'Верификация снята',
      description: `У <@${targetId}> снята верификация. Баланс и прогресс сохранены.`,
      color: COLOR.wait,
      backNav: AP.nav.users,
      section: 'пользователи',
    }),
  );
}

export async function lookupUser(interaction, targetId) {
  if (!(await requireLevel(interaction, 2))) return true;
  ensureUser(targetId, interaction.guildId);
  const user = getDb().prepare(
    'SELECT * FROM users WHERE guild_id = ? AND user_id = ?',
  ).get(interaction.guildId, targetId);
  return interaction.update(buildLookupView(interaction, targetId, user));
}

export async function clearInfinite(interaction, targetId) {
  if (!(await requireLevel(interaction, 2))) return true;
  ensureUser(targetId, interaction.guildId);
  getDb().prepare(
    'UPDATE users SET is_infinite_balance = 0 WHERE guild_id = ? AND user_id = ?',
  ).run(interaction.guildId, targetId);

  return interaction.update(
    resultView(interaction, {
      title: '∞ баланс снят',
      description: `<@${targetId}> снова в рейтинге \`/топ\`.`,
      color: COLOR.wait,
      backNav: AP.nav.econ,
      section: 'экономика',
    }),
  );
}

export async function handleEconomyModal(interaction, action, targetId, amount) {
  if (!(await requireLevel(interaction, 2))) return true;
  if (!isValidUserId(targetId)) {
    return interaction.reply({ ...denyView(interaction, 'Некорректный ID.'), flags: MessageFlags.Ephemeral });
  }
  if (!isValidPositiveInt(amount)) {
    return interaction.reply({
      ...denyView(interaction, 'Сумма должна быть положительным целым числом.'),
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  ensureUser(targetId, interaction.guildId);
  const member = interaction.guild?.members.cache.get(targetId)
    || await interaction.guild?.members.fetch(targetId).catch(() => null);
  const mention = `<@${targetId}>`;
  const reply = (view) => interaction.reply({ ...view, flags: MessageFlags.Ephemeral });

  if (action === 'add_balance') {
    addCoins(targetId, amount, interaction.guildId);
    return reply(
      resultView(interaction, {
        title: 'Баланс начислен',
        description: `${mention} получил **${fmtNum(amount)} ⚡HLD**`,
        backNav: AP.nav.econ,
        section: 'экономика',
      }),
    );
  }

  if (action === 'remove_balance') {
    const user = db.prepare(
      'SELECT balance FROM users WHERE guild_id = ? AND user_id = ?',
    ).get(interaction.guildId, targetId);
    if ((user?.balance || 0) < amount) {
      return reply(
        denyView(interaction, `Недостаточно средств. Баланс: **${fmtNum(user?.balance || 0)}**.`),
      );
    }
    removeCoins(targetId, amount, interaction.guildId);
    return reply(
      resultView(interaction, {
        title: 'Баланс списан',
        description: `У ${mention} списано **${fmtNum(amount)} ⚡HLD**`,
        color: COLOR.danger,
        backNav: AP.nav.econ,
        section: 'экономика',
      }),
    );
  }

  if (action === 'set_infinite') {
    db.prepare(
      'UPDATE users SET balance = ?, is_infinite_balance = 1 WHERE guild_id = ? AND user_id = ?',
    ).run(amount, interaction.guildId, targetId);
    return reply(
      resultView(interaction, {
        title: '∞ баланс',
        description: `${mention} — **${fmtNum(amount)} ⚡HLD** (не в \`/топ\`)`,
        color: COLOR.purple,
        backNav: AP.nav.econ,
        section: 'экономика',
      }),
    );
  }

  if (action === 'add_xp') {
    const xpResult = addXp(targetId, amount, interaction.guildId);
    let extra = '';
    if (xpResult) {
      extra = `\nУровень: **${xpResult.oldLevel} → ${xpResult.newLevel}**`;
      if (member) {
        await checkLevelMilestones(member, xpResult.oldLevel, xpResult.newLevel).catch(() => {});
      } else {
        const reached = getReachedMilestones(xpResult.oldLevel, xpResult.newLevel);
        if (reached.length) extra += `\nОтметки: ${reached.join(', ')}`;
      }
    }
    return reply(
      resultView(interaction, {
        title: 'XP начислен',
        description: `${mention} получил **${fmtNum(amount)} XP**${extra}`,
        color: COLOR.aqua,
        backNav: AP.nav.econ,
        section: 'экономика',
      }),
    );
  }

  if (action === 'remove_xp') {
    const before = db.prepare(
      'SELECT level FROM users WHERE guild_id = ? AND user_id = ?',
    ).get(interaction.guildId, targetId);
    const oldLevel = before?.level || 1;
    const newLevel = removeXp(targetId, amount, interaction.guildId);
    let extra = '';
    if (newLevel && newLevel < oldLevel && member) {
      extra = `\nУровень понижен до **${newLevel}**`;
      const oldRoleId = getRoleIdForLevel(oldLevel);
      if (oldRoleId) await removeLevelRole(member, oldRoleId).catch(() => {});
      await assignLevelRoles(member, newLevel).catch(() => {});
    }
    return reply(
      resultView(interaction, {
        title: 'XP снят',
        description: `У ${mention} снято **${fmtNum(amount)} XP**${extra}`,
        color: COLOR.danger,
        backNav: AP.nav.econ,
        section: 'экономика',
      }),
    );
  }

  return reply(denyView(interaction, 'Неизвестное действие экономики.'));
}

export async function handleDeleteModal(interaction, targetId, reason) {
  if (!(await requireLevel(interaction, 2))) return true;
  const granterLevel = getUserLevel(interaction.user.id, interaction.guild);
  const reply = (view) => interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
  if (!reason?.trim()) {
    return reply(denyView(interaction, 'Причина обязательна.'));
  }

  const db = getDb();
  const targetPerm = db.prepare('SELECT level FROM bot_permissions WHERE user_id = ?').get(targetId);
  if (targetPerm && targetPerm.level >= granterLevel) {
    return reply(
      denyView(interaction, 'Нельзя удалить пользователя с таким же или более высоким уровнем.'),
    );
  }

  try {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member) {
      if (!canModerateMember(interaction.member, member)) {
        return reply(
          denyView(interaction, 'Нельзя удалить: выше по ролям, вы сами или владелец.'),
        );
      }
      await member.kick(reason);
    }
  } catch (err) {
    console.error(`[ADMIN] kick ${targetId}:`, err.message);
  }

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
    try {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(targetId);
    } catch {
      /* table may miss column */
    }
  }
  db.prepare('DELETE FROM moderation_log WHERE target_id = ? OR moderator_id = ?')
    .run(targetId, targetId);

  const rooms = db.prepare('SELECT * FROM user_voice_channels WHERE owner_id = ?').all(targetId);
  for (const room of rooms) {
    try {
      const vc = interaction.guild.channels.cache.get(room.voice_channel_id);
      if (vc?.deletable) await vc.delete('Пользователь удалён');
    } catch {
      /* ignore */
    }
    db.prepare('DELETE FROM user_voice_channels WHERE id = ?').run(room.id);
  }

  const customRoles = db.prepare('SELECT * FROM custom_roles WHERE creator_id = ?').all(targetId);
  for (const role of customRoles) {
    try {
      const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
      if (discordRole) await discordRole.delete('Пользователь удалён');
    } catch {
      /* ignore */
    }
    db.prepare('DELETE FROM custom_roles WHERE id = ?').run(role.id);
  }

  db.prepare('DELETE FROM users WHERE guild_id = ? AND user_id = ?')
    .run(interaction.guildId, targetId);

  return reply(
    resultView(interaction, {
      title: 'Пользователь удалён',
      description: `<@${targetId}>\nПричина: ${reason}\nДанные очищены.`,
      color: COLOR.danger,
      backNav: AP.nav.users,
      section: 'пользователи',
    }),
  );
}

export async function handleModAction(interaction, action, targetId, { reason, durationMinutes, useUpdate = false } = {}) {
  if (!(await requireLevel(interaction, 1))) return true;
  if (!isValidUserId(targetId)) {
    const view = denyView(interaction, 'Некорректный ID.');
    return useUpdate ? interaction.update(view) : interaction.reply(view);
  }

  const respond = (view) => (useUpdate
    ? interaction.update(view)
    : interaction.reply({ ...view, flags: MessageFlags.Ephemeral }));

  const db = getDb();
  const guild = interaction.guild;
  let member = guild?.members.cache.get(targetId) || null;
  if (!member && guild) {
    member = await guild.members.fetch(targetId).catch(() => null);
  }

  if (action !== 'warns' && member && !canModerateMember(interaction.member, member)) {
    return respond(
      denyView(interaction, 'Нельзя модерировать: выше по ролям, вы сами или владелец.'),
    );
  }

  if (action === 'warns') {
    const punishments = db.prepare(`
      SELECT * FROM punishments WHERE user_id = ? AND action = 'warn' AND (guild_id = ? OR guild_id = '')
      ORDER BY created_at DESC LIMIT 10
    `).all(targetId, interaction.guildId);

    if (!punishments.length) {
      return respond(
        resultView(interaction, {
          title: 'Предупреждения',
          description: `У <@${targetId}> нет предупреждений.`,
          backNav: AP.nav.mod,
          section: 'модерация',
        }),
      );
    }

    const embed = brandEmbed({
      color: COLOR.wait,
      title: `Warns — ${member?.displayName || targetId}`,
      description: `Всего в выборке: **${punishments.length}**`,
      footer: navFooter(interaction, 'модерация'),
    });
    for (const p of punishments.slice(0, 5)) {
      embed.addFields({
        name: `#${p.id} — ${p.created_at || ''}`,
        value: `${p.reason || 'без причины'}\nМод: <@${p.moderator_id}>`,
      });
    }
    return respond({ embeds: [embed], components: [backCloseRow(AP.nav.mod)] });
  }

  const why = reason?.trim() || 'Не указана';
  const replyE = (view) => interaction.reply({ ...view, flags: MessageFlags.Ephemeral });

  try {
    if (action === 'warn') {
      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'warn',
        reason: why,
        guildId: interaction.guildId,
      });
      return replyE(
        resultView(interaction, {
          title: 'Warn',
          description: `<@${targetId}>\n${why}`,
          color: COLOR.wait,
          backNav: AP.nav.mod,
          section: 'модерация',
        }),
      );
    }

    if (action === 'mute') {
      if (!isValidPositiveInt(durationMinutes)) {
        return replyE(denyView(interaction, 'Длительность — положительное число минут.'));
      }
      if (durationMinutes > 28 * 24 * 60) {
        return replyE(denyView(interaction, 'Максимум мута Discord — 28 дней.'));
      }
      if (!member) {
        return replyE(denyView(interaction, 'Пользователь не на сервере.'));
      }
      await member.timeout(durationMinutes * 60 * 1000, why);
      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'mute',
        reason: why,
        durationSeconds: durationMinutes * 60,
        expiresAtSql: `+${durationMinutes} minutes`,
        guildId: interaction.guildId,
      });
      return replyE(
        resultView(interaction, {
          title: 'Mute',
          description: `<@${targetId}> · **${durationMinutes}** мин.\n${why}`,
          color: COLOR.danger,
          backNav: AP.nav.mod,
          section: 'модерация',
        }),
      );
    }

    if (action === 'kick') {
      if (!member) {
        return replyE(denyView(interaction, 'Пользователь не на сервере.'));
      }
      await member.kick(why);
      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'kick',
        reason: why,
        guildId: interaction.guildId,
      });
      return replyE(
        resultView(interaction, {
          title: 'Kick',
          description: `<@${targetId}>\n${why}`,
          color: COLOR.danger,
          backNav: AP.nav.mod,
          section: 'модерация',
        }),
      );
    }

    if (action === 'ban') {
      await guild.bans.create(targetId, { reason: why });
      logPunishment({
        userId: targetId,
        moderatorId: interaction.user.id,
        action: 'ban',
        reason: why,
        guildId: interaction.guildId,
      });
      return replyE(
        resultView(interaction, {
          title: 'Ban',
          description: `<@${targetId}>\n${why}`,
          color: COLOR.danger,
          backNav: AP.nav.mod,
          section: 'модерация',
        }),
      );
    }
  } catch (err) {
    console.error('[MOD]', err);
    return replyE(denyView(interaction, `Ошибка: ${err.message}`));
  }

  return replyE(denyView(interaction, 'Неизвестное действие модерации.'));
}

export async function toggleFeature(interaction, featureKey) {
  if (!(await requireLevel(interaction, 2))) return true;
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FEATURES, featureKey)) {
    return interaction.update(denyView(interaction, 'Неизвестная фича.'));
  }
  const current = getGuildConfig(interaction.guildId).features?.[featureKey] !== false;
  setGuildFeature(interaction.guildId, featureKey, !current);
  return interaction.update(buildServerSection(interaction));
}

export async function runSetup(interaction) {
  if (!(await requireLevel(interaction, 2))) return true;
  try {
    const { showSetupModal } = await import('../../commands/setup.js');
    await showSetupModal(interaction);
  } catch (e) {
    console.error('[ADMIN] setup:', e.message);
    return interaction.reply(
      denyView(interaction, 'Не удалось открыть `/setup`. Запусти команду вручную.'),
    );
  }
  return true;
}

export async function runLogs(interaction) {
  if (!(await requireLevel(interaction, 2))) return true;
  try {
    const { buildHomeView } = await import('../logs/views.js');
    const view = buildHomeView(interaction);
    await interaction.update({
      content: null,
      embeds: view.embeds,
      components: view.components,
    });
  } catch (e) {
    console.error('[ADMIN] logs:', e.message);
    return interaction.update(denyView(interaction, 'Не удалось открыть `/логи`.'));
  }
  return true;
}
