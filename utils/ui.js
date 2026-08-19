import { EmbedBuilder, MessageFlags } from 'discord.js';

/** Цвета карточки профиля и slash-ответов. */
export const COLOR = {
  accent: 0xff5733,
  gold: 0xffd700,
  aqua: 0x33e1c4,
  success: 0x2ecc71,
  danger: 0xe74c3c,
  wait: 0xf1c40f,
  pink: 0xff69b4,
  purple: 0x9b59b6,
  dark: 0x2b2d31,
};

export function fmtNum(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

export function fmtHld(n) {
  return `**${fmtNum(n)}** ⚡HLD`;
}

export function xpBar(percent, size = 12) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((p / 100) * size);
  return `\`${'▰'.repeat(filled)}${'▱'.repeat(size - filled)}\``;
}

export function countBar(current, goal, size = 8) {
  const now = Math.max(0, Number(current) || 0);
  const max = Math.max(1, Number(goal) || 1);
  const filled = Math.min(size, Math.round((now / max) * size));
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)}`;
  if (now >= max) return `✅ \`${bar}\``;
  return `\`${bar}\` **${now}/${max}**`;
}

export function brandEmbed({
  color = COLOR.accent,
  title,
  description,
  footer,
  thumbnail,
  image,
} = {}) {
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  embed.setFooter({ text: footer || 'Holidesu' });
  return embed;
}

export function guildFooter(interaction, extra) {
  const name = interaction?.guild?.name || 'Holidesu';
  return extra ? `${name} · ${extra}` : name;
}

function payload(embed, options = {}) {
  const body = { embeds: Array.isArray(embed) ? embed : [embed] };
  if (options.ephemeral) body.flags = MessageFlags.Ephemeral;
  if (options.components) body.components = options.components;
  if (options.content) body.content = options.content;
  return body;
}

export async function sendEmbed(interaction, embed, options = {}) {
  const body = payload(embed, options);
  if (options.edit) return interaction.editReply(body);
  if (interaction.replied || interaction.deferred) return interaction.followUp(body);
  return interaction.reply(body);
}

export function replyFail(interaction, description) {
  return sendEmbed(
    interaction,
    brandEmbed({ color: COLOR.danger, title: 'Не получилось', description }),
    { ephemeral: true },
  );
}

export function replyDone(interaction, description, options = {}) {
  return sendEmbed(
    interaction,
    brandEmbed({
      color: COLOR.success,
      title: options.title || 'Готово',
      description,
      footer: options.footer,
    }),
    { ephemeral: options.ephemeral !== false },
  );
}

export function replyWait(interaction, description) {
  return sendEmbed(
    interaction,
    brandEmbed({ color: COLOR.wait, title: 'Подожди', description }),
    { ephemeral: true },
  );
}
