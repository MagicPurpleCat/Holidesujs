// ══════════════════════════════════════════════════════════════════
// МОДУЛЬ: PERMISSIONS — Единая система проверки прав
// ══════════════════════════════════════════════════════════════════
// Owner = 3, Admin = 2, Moderator = 1, User = 0
// ══════════════════════════════════════════════════════════════════
//
// Все команды импортируют getUserLevel() и checkPermissions()
// через этот модуль — НИКАКОГО дублирования кода!
// ══════════════════════════════════════════════════════════════════

import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getDb } from '../database.js';
import { getGuildConfig } from './guildConfig.js';

/**
 * Уровень прав: bot_permissions, затем владелец/админ-роли из /setup.
 */
export function getUserLevel(userId, guild = null) {
  try {
    const db = getDb();
    const perm = db.prepare('SELECT level FROM bot_permissions WHERE user_id = ?').get(userId);
    if (perm?.level) return perm.level;

    if (guild) {
      const cfg = getGuildConfig(guild.id);
      if (cfg.ownerId && cfg.ownerId === userId) return 3;
      const member = guild.members?.cache?.get(userId);
      if (member && cfg.adminRoles.some((roleId) => member.roles.cache.has(roleId))) return 2;
      if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return 2;
    }
    return 0;
  } catch (error) {
    console.error('[PERMISSIONS] Ошибка getUserLevel:', error.message);
    return 0;
  }
}

/**
 * Возвращает текстовое название уровня и эмодзи.
 * @param {number} level
 * @returns {string}
 */
export function levelName(level) {
  switch (level) {
    case 3: return '👑 Owner';
    case 2: return '🛠 Admin';
    case 1: return '🛡 Mod';
    default: return '👤 Пользователь';
  }
}

/**
 * Проверяет, может ли пользователь с уровнем `granterLevel`
 * выдать права уровня `targetLevel`.
 * 
 * Правила:
 * - Owner (3) может выдать Admin (2) или Mod (1), но не Owner.
 * - Admin (2) может выдать только Mod (1).
 * - Mod (1) не может выдавать права.
 * 
 * @param {number} granterLevel — уровень выдающего
 * @param {number} targetLevel — запрашиваемый уровень
 * @returns {boolean}
 */
export function canGrant(granterLevel, targetLevel) {
  if (granterLevel < 2) return false;
  if (granterLevel === 3) return targetLevel === 1 || targetLevel === 2;
  if (granterLevel === 2 && targetLevel === 1) return true;
  return false;
}

/**
 * Нельзя модерировать себя, владельца сервера и тех, кто выше по ролям.
 */
export function canModerateMember(moderatorMember, targetMember) {
  if (!moderatorMember || !targetMember) return false;
  if (targetMember.id === moderatorMember.id) return false;
  if (targetMember.user?.bot) return false;
  if (targetMember.id === moderatorMember.guild?.ownerId) return false;
  const me = moderatorMember.guild?.members?.me;
  if (me && targetMember.roles.highest.position >= me.roles.highest.position) return false;
  if (targetMember.roles.highest.position >= moderatorMember.roles.highest.position) {
    return false;
  }
  return true;
}

/**
 * Проверяет, имеет ли пользователь минимально необходимый уровень прав.
 * Если нет — отправляет ephemeral-ответ и возвращает false.
 * 
 * @param {import('discord.js').Interaction} interaction
 * @param {number} requiredLevel — минимальный требуемый уровень (1, 2, 3)
 * @returns {Promise<boolean>} — true если доступ есть
 */
export async function checkPermissions(interaction, requiredLevel) {
  const userLevel = getUserLevel(interaction.user.id, interaction.guild);

  if (userLevel < requiredLevel) {
    await interaction.reply({
      content: `❌ У тебя недостаточно прав. Требуется: **${levelName(requiredLevel)}**. Твой уровень: **${levelName(userLevel)}**.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return false;
  }

  return true;
}

