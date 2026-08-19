import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getDb, getUser, removeCoins } from '../database.js';
import {
  COSMETICS,
  ownsCosmetic,
  grantCosmetic,
  listOwnedCosmetics,
} from '../modules/progress.js';
import { brandEmbed, COLOR, fmtHld, guildFooter, replyFail, replyDone } from '../utils/ui.js';

function cosmeticsBuilder(name) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription('Рамки и фоны для карточки профиля')
    .addSubcommand((sub) => sub.setName('каталог').setDescription('Все предметы и цены'))
    .addSubcommand((sub) =>
      sub
        .setName('купить')
        .setDescription('Купить рамку или фон')
        .addStringOption((opt) =>
          opt.setName('id').setDescription('ID из каталога, например frame_gold').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('надеть')
        .setDescription('Надеть купленное или none чтобы снять')
        .addStringOption((opt) =>
          opt.setName('id').setDescription('ID предмета или none').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('инвентарь').setDescription('Что уже куплено и надето'));
}

async function runCosmetics(interaction) {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (sub === 'каталог') {
    const lines = Object.entries(COSMETICS).map(([id, item]) => {
      const owned = ownsCosmetic(userId, guildId, id) ? ' · есть' : '';
      const kind = item.type === 'frame' ? 'рамка' : 'фон';
      return `**${item.name}** · ${kind}\n\`${id}\` — ${fmtHld(item.price)}${owned}`;
    });
    return interaction.reply({
      embeds: [
        brandEmbed({
          color: COLOR.purple,
          title: 'Каталог косметики',
          description: lines.join('\n\n'),
          footer: guildFooter(interaction, '/cosmetics купить id:…'),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'инвентарь') {
    const owned = listOwnedCosmetics(userId, guildId);
    const user = getUser(userId, guildId);
    const text = owned.length
      ? owned.map((id) => `• **${COSMETICS[id]?.name || id}** \`${id}\``).join('\n')
      : 'Пусто. Открой `/cosmetics каталог`.';
    return interaction.reply({
      embeds: [
        brandEmbed({
          color: COLOR.purple,
          title: 'Инвентарь',
          description: text,
          footer: guildFooter(interaction, 'косметика'),
        }).addFields(
          { name: 'Рамка', value: `\`${user.equipped_frame || 'нет'}\``, inline: true },
          { name: 'Фон', value: `\`${user.equipped_background || 'нет'}\``, inline: true },
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const id = interaction.options.getString('id').trim();

  if (sub === 'купить') {
    const item = COSMETICS[id];
    if (!item) return replyFail(interaction, 'Нет такого ID. Смотри `/cosmetics каталог`.');
    if (ownsCosmetic(userId, guildId, id)) return replyDone(interaction, `**${item.name}** уже куплено.`);
    if (!removeCoins(userId, item.price, guildId)) {
      return replyFail(interaction, `Нужно ${fmtHld(item.price)}.`);
    }
    grantCosmetic(userId, guildId, id);
    return replyDone(
      interaction,
      `**${item.name}** · ${fmtHld(item.price)}\nНадень: \`/cosmetics надеть id:${id}\``,
      { title: 'Куплено', ephemeral: false },
    );
  }

  const db = getDb();
  if (id === 'none') {
    db.prepare(
      'UPDATE users SET equipped_frame = NULL, equipped_background = NULL WHERE guild_id = ? AND user_id = ?',
    ).run(guildId, userId);
    return replyDone(interaction, 'Рамка и фон сняты.');
  }
  const item = COSMETICS[id];
  if (!item) return replyFail(interaction, 'Нет такого ID.');
  if (!ownsCosmetic(userId, guildId, id)) return replyFail(interaction, 'Сначала купи этот предмет.');
  if (item.type === 'frame') {
    db.prepare('UPDATE users SET equipped_frame = ? WHERE guild_id = ? AND user_id = ?')
      .run(id, guildId, userId);
  } else {
    db.prepare('UPDATE users SET equipped_background = ?, custom_background_id = ? WHERE guild_id = ? AND user_id = ?')
      .run(id, id, guildId, userId);
  }
  await replyDone(interaction, `Надето: **${item.name}**. Смотри \`/profile\`.`);
}

export default {
  data: cosmeticsBuilder('cosmetics'),
  execute: runCosmetics,
};

export const cosmeticsAlias = {
  data: cosmeticsBuilder('косметика'),
  execute: runCosmetics,
};
