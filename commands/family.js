import { SlashCommandBuilder } from 'discord.js';
import { getDb, getUser, removeCoins, addCoins, runInTransaction } from '../database.js';
import { getOrCreateFamilyBank, familyPair } from '../modules/progress.js';
import { brandEmbed, COLOR, fmtHld, guildFooter, replyFail, replyDone } from '../utils/ui.js';

function requireMarriage(interaction) {
  const user = getUser(interaction.user.id, interaction.guildId);
  if (user.relationship_status !== 'married' || !user.relationship_partner_id) {
    return null;
  }
  return user;
}

export default {
  data: new SlashCommandBuilder()
    .setName('семья')
    .setDescription('Общий счёт супругов. Вместе в войсе фарм +15%')
    .addSubcommand((sub) => sub.setName('банк').setDescription('Показать семейный счёт'))
    .addSubcommand((sub) =>
      sub
        .setName('положить')
        .setDescription('Положить ⚡HLD на семейный счёт')
        .addIntegerOption((opt) =>
          opt.setName('сумма').setDescription('Сколько положить').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('снять')
        .setDescription('Снять ⚡HLD с семейного счёта')
        .addIntegerOption((opt) =>
          opt.setName('сумма').setDescription('Сколько снять').setRequired(true).setMinValue(1)
        )
    ),

  async execute(interaction) {
    const user = requireMarriage(interaction);
    if (!user) {
      return replyFail(interaction, 'Семейный счёт открывается после брака. `/marry`');
    }

    const partnerId = user.relationship_partner_id;
    const sub = interaction.options.getSubcommand();
    const bank = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, partnerId);
    const [a, b] = familyPair(interaction.user.id, partnerId);

    if (sub === 'банк') {
      const embed = brandEmbed({
        color: COLOR.pink,
        title: 'Семейный счёт',
        description: `<@${a}> + <@${b}>`,
        footer: guildFooter(interaction, 'в одном войсе фарм +15%'),
      }).addFields({ name: 'Баланс', value: fmtHld(bank.balance), inline: true });
      return interaction.reply({ embeds: [embed] });
    }

    const amount = interaction.options.getInteger('сумма');
    const db = getDb();

    if (sub === 'положить') {
      try {
        runInTransaction(() => {
          if (!removeCoins(interaction.user.id, amount, interaction.guildId)) {
            throw new Error('NO_FUNDS');
          }
          db.prepare(
            'UPDATE family_bank SET balance = balance + ? WHERE guild_id = ? AND user_a = ? AND user_b = ?',
          ).run(amount, interaction.guildId, a, b);
        });
      } catch (err) {
        if (err.message === 'NO_FUNDS') {
          return replyFail(interaction, 'Не хватает ⚡HLD.');
        }
        throw err;
      }
      const updated = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, partnerId);
      return replyDone(
        interaction,
        `Положено ${fmtHld(amount)}\nНа счёте ${fmtHld(updated.balance)}`,
        { title: 'Семейный банк', ephemeral: false, footer: guildFooter(interaction, 'семья') },
      );
    }

    const hold = db.prepare(
      'UPDATE family_bank SET balance = balance - ? WHERE guild_id = ? AND user_a = ? AND user_b = ? AND balance >= ?',
    ).run(amount, interaction.guildId, a, b, amount);
    if (hold.changes === 0) {
      return replyFail(interaction, `На счёте только ${fmtHld(bank.balance)}.`);
    }
    addCoins(interaction.user.id, amount, interaction.guildId);
    const updated = getOrCreateFamilyBank(interaction.guildId, interaction.user.id, partnerId);
    await replyDone(
      interaction,
      `Снято ${fmtHld(amount)}\nНа счёте ${fmtHld(updated.balance)}`,
      { title: 'Семейный банк', ephemeral: false, footer: guildFooter(interaction, 'семья') },
    );
  },
};
