import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { brandEmbed, COLOR, guildFooter } from '../../utils/ui.js';
import { SU } from './ids.js';

export function navFooter(interaction, section) {
  return guildFooter(interaction, `setup · ${section}`);
}

export function backCloseRow(backId = SU.home) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backId).setLabel('Назад').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(SU.close).setLabel('Закрыть').setStyle(ButtonStyle.Danger),
  );
}

export function resultView(interaction, {
  title,
  description,
  color = COLOR.success,
  section = 'setup',
  backNav = SU.home,
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

export function denyView(interaction, text, backNav = SU.home) {
  return resultView(interaction, {
    title: 'Не получилось',
    description: text,
    color: COLOR.danger,
    section: 'ошибка',
    backNav,
  });
}

export function ephemeralPayload(view) {
  return { ...view, flags: MessageFlags.Ephemeral };
}

export function mark(ok) {
  return ok ? '●' : '○';
}
