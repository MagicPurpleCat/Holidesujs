import { MessageFlags } from 'discord.js';
import { getUserLevel, levelName } from '../../utils/permissions.js';
import { brandEmbed, COLOR, guildFooter } from '../../utils/ui.js';
import { AP } from './ids.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export function isValidUserId(id) {
  return /^\d{17,20}$/.test(String(id || ''));
}

export function isValidPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

export async function requireLevel(interaction, level) {
  const userLevel = getUserLevel(interaction.user.id, interaction.guild);
  if (userLevel >= level) return true;

  const payload = {
    content: `❌ Нужен уровень **${levelName(level)}**. Сейчас: **${levelName(userLevel)}**.`,
    flags: MessageFlags.Ephemeral,
  };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else if (interaction.isRepliable?.()) {
      await interaction.reply(payload);
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function navFooter(interaction, section) {
  return guildFooter(interaction, `панель · ${section}`);
}

export function backCloseRow(backId = AP.home) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(backId)
      .setLabel('Назад')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(AP.close)
      .setLabel('Закрыть')
      .setStyle(ButtonStyle.Danger),
  );
}

export function resultView(interaction, {
  title,
  description,
  color = COLOR.success,
  section = 'home',
  backNav = AP.home,
} = {}) {
  const embed = brandEmbed({
    color,
    title,
    description,
    footer: navFooter(interaction, section),
  });
  return {
    embeds: [embed],
    components: [backCloseRow(backNav)],
  };
}

export function denyView(interaction, text) {
  return resultView(interaction, {
    title: 'Не получилось',
    description: text,
    color: COLOR.danger,
    section: 'ошибка',
  });
}
