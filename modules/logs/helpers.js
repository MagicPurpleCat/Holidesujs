import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { brandEmbed, COLOR, guildFooter } from '../../utils/ui.js';
import { LG } from './ids.js';

export function navFooter(interaction, section) {
  return guildFooter(interaction, `логи · ${section}`);
}

export function backCloseRow(backId = LG.home) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backId).setLabel('Назад').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(LG.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
  );
}

export function resultView(interaction, {
  title,
  description,
  color = COLOR.success,
  section = 'логи',
  backNav = LG.home,
} = {}) {
  return {
    content: null,
    embeds: [
      brandEmbed({
        color,
        title,
        description,
        footer: navFooter(interaction, section),
      }),
    ],
    components: [backCloseRow(backNav)],
  };
}

export function denyView(interaction, text, backNav = LG.home) {
  return resultView(interaction, {
    title: 'Не получилось',
    description: text,
    color: COLOR.danger,
    section: 'ошибка',
    backNav,
  });
}

export function mark(ok) {
  return ok ? '●' : '○';
}
