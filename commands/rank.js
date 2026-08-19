import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUser } from '../database.js';
import { DEFAULT_LEVEL_ROLES, getGuildConfig } from '../utils/guildConfig.js';
import { COLOR, fmtNum, guildFooter, xpBar } from '../utils/ui.js';

function getLevelRoleMap(guildId) {
  if (!guildId) return DEFAULT_LEVEL_ROLES;
  try {
    return getGuildConfig(guildId).levelRoles || DEFAULT_LEVEL_ROLES;
  } catch {
    return DEFAULT_LEVEL_ROLES;
  }
}

function milestoneLevels(guildId) {
  return Object.keys(getLevelRoleMap(guildId)).map(Number).sort((a, b) => a - b);
}

/** Роли по умолчанию (если /setup не задал свои). */
export const LEVEL_ROLES = DEFAULT_LEVEL_ROLES;

/**
 * Находит ID роли, соответствующей текущему уровню пользователя.
 * Берётся наивысшая роль, уровень которой <= level.
 */
export function getRoleIdForLevel(level, guildId = null) {
  const map = getLevelRoleMap(guildId);
  const levels = Object.keys(map).map(Number).sort((a, b) => a - b).reverse();
  for (const lvl of levels) {
    if (level >= lvl) return map[lvl];
  }
  return null;
}

/**
 * Отметки из LEVEL_ROLES, которые пользователь пересёк при росте oldLevel → newLevel.
 * Отметка считается достигнутой, только если раньше её не было (mark > oldLevel).
 */
export function getReachedMilestones(oldLevel, newLevel, guildId = null) {
  if (newLevel <= oldLevel) return [];
  return milestoneLevels(guildId).filter((mark) => mark > oldLevel && mark <= newLevel);
}

export function isMilestoneLevel(level, guildId = null) {
  const map = getLevelRoleMap(guildId);
  return Object.prototype.hasOwnProperty.call(map, String(level))
    || Object.prototype.hasOwnProperty.call(map, level);
}

/**
 * Поздравляет с новым уровнем в ЛС. Если пересечена отметка — пишет, что роль сменили.
 *
 * @param {import('discord.js').GuildMember|null} member
 * @param {number} oldLevel
 * @param {number} newLevel
 * @returns {Promise<number[]>} достигнутые отметки
 */
export async function checkLevelMilestones(member, oldLevel, newLevel) {
  if (!member || typeof newLevel !== 'number' || newLevel <= oldLevel) return [];

  const guildId = member.guild?.id || null;
  const guildName = member.guild?.name || 'сервере';
  const previousRoleId = getRoleIdForLevel(oldLevel, guildId);
  await assignLevelRoles(member, newLevel);
  const reached = getReachedMilestones(oldLevel, newLevel, guildId);
  const newRoleId = getRoleIdForLevel(newLevel, guildId);
  const roleChanged = reached.length > 0 && !!newRoleId && newRoleId !== previousRoleId;

  const roleLabel = (roleId) => {
    if (!roleId) return 'нет роли';
    const role = member.guild?.roles?.cache?.get(roleId);
    return role ? `**${role.name}**` : 'новая роль';
  };

  const lines = [
    `🎉 Поздравляем, **${member.displayName}**!`,
    `Ты достиг **${newLevel}** уровня на сервере **${guildName}**.`,
  ];

  if (reached.length === 1) {
    lines.push(`🏆 Отметка **${reached[0]}** достигнута.`);
  } else if (reached.length > 1) {
    lines.push(`🏆 Достигнуты отметки: **${reached.join(', ')}**.`);
  }

  if (roleChanged) {
    lines.push(`🎭 Роль обновлена: ${roleLabel(previousRoleId)} → ${roleLabel(newRoleId)}`);
  }

  const embed = new EmbedBuilder()
    .setColor(roleChanged ? 0xf1c40f : 0x5865f2)
    .setTitle(roleChanged ? '🏆 Новый уровень и новая роль' : '🎉 Новый уровень')
    .setDescription(lines.join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setFooter({ text: roleChanged ? 'Роль обновлена за отметку уровня' : 'Так держать!' });

  await member.send({ embeds: [embed] }).catch(() => {});

  return reached;
}

/**
 * Выдаёт пользователю роль по уровню (если её ещё нет).
 * Автоматически снимает предыдущие роли уровней.
 */
export async function assignLevelRoles(member, level) {
  if (!member.roles) return;

  const guildId = member.guild?.id || null;
  const targetRoleId = getRoleIdForLevel(level, guildId);
  if (!targetRoleId) return;

  if (member.roles.cache.has(targetRoleId)) return;

  try {
    const allLevelRoleIds = Object.values(getLevelRoleMap(guildId));
    const rolesToRemove = allLevelRoleIds.filter(
      (id) => member.roles.cache.has(id) && id !== targetRoleId
    );
    for (const id of rolesToRemove) {
      await member.roles.remove(id).catch(() => {});
    }

    await member.roles.add(targetRoleId);
  } catch (err) {
    console.error(`[LEVEL] Ошибка выдачи роли ${targetRoleId} для ${member.id}:`, err.message);
  }
}

/**
 * Снимает конкретную роль уровня у пользователя.
 * Используется при понижении уровня (админ-команда /снять-опыт).
 */
export async function removeLevelRole(member, roleId) {
  if (!member.roles) return;
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
    }
  } catch (err) {
    console.error(`[LEVEL] Ошибка снятия роли ${roleId} у ${member.id}:`, err.message);
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Уровень, XP и роль за отметку')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Посмотреть уровень другого пользователя').setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild.members.cache.get(target.id);

    const user = getUser(target.id, interaction.guildId);

    const currentLevel = user.level;
    const currentXp = user.xp;

    // После 100 уровня прогресс останавливается
    const maxLevel = 100;
    let xpForNext, progressPercent, roleDisplay;

    const guildId = interaction.guild?.id || null;
    const roleMap = getLevelRoleMap(guildId);
    if (currentLevel >= maxLevel) {
      xpForNext = 'MAX';
      progressPercent = 100;
      roleDisplay = roleMap[100] ? `<@&${roleMap[100]}>` : 'Нет';
    } else {
      xpForNext = currentLevel * 100;
      progressPercent = Math.min(100, Math.round((currentXp / xpForNext) * 100));
      const roleId = getRoleIdForLevel(currentLevel, guildId);
      roleDisplay = roleId ? `<@&${roleId}>` : 'Нет';
    }

    const embed = new EmbedBuilder()
      .setColor(member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : COLOR.accent)
      .setTitle(target.displayName)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: 'Уровень',
          value: `**${currentLevel}**`,
          inline: true,
        },
        {
          name: 'Всего XP',
          value: `**${fmtNum(user.total_xp || user.xp)}**`,
          inline: true,
        },
        {
          name: 'Роль',
          value: roleDisplay,
          inline: true,
        },
        {
          name: 'Прогресс',
          value: currentLevel >= maxLevel
            ? 'Максимальный уровень'
            : `${xpBar(progressPercent)}\n**${progressPercent}%** · \`${fmtNum(currentXp)} / ${fmtNum(xpForNext)} XP\``,
          inline: false,
        },
      )
      .setFooter({ text: guildFooter(interaction, 'XP за войса и сообщения') });

    await interaction.reply({ embeds: [embed] });
  },
};

