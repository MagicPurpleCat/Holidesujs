import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb, ensureUser, removeCoins, addCoins, runInTransaction } from '../database.js';

// Символы для слот-машины
const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '⭐', '🔔'];
const VIP_MULTIPLIER = 1.2;
const MAX_BET = 10_000;

function recordCasinoResult(db, userId, { bet, winAmount, slot = false }) {
  runInTransaction(() => {
    if (winAmount > 0) {
      addCoins(userId, winAmount);
    } else if (!removeCoins(userId, bet)) {
      throw new Error('NO_FUNDS');
    }
    const won = winAmount > 0 ? winAmount : 0;
    const lost = winAmount < 0 ? Math.abs(winAmount) : 0;
    if (slot) {
      db.prepare(`
        INSERT INTO casino_stats (user_id, total_bet, total_won, total_lost, last_slot_spin)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          total_bet = total_bet + excluded.total_bet,
          total_won = total_won + excluded.total_won,
          total_lost = total_lost + excluded.total_lost,
          last_slot_spin = excluded.last_slot_spin
      `).run(userId, bet, won, lost);
    } else {
      db.prepare(`
        INSERT INTO casino_stats (user_id, total_bet, total_won, total_lost)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          total_bet = total_bet + excluded.total_bet,
          total_won = total_won + excluded.total_won,
          total_lost = total_lost + excluded.total_lost
      `).run(userId, bet, won, lost);
    }
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('🎰 Игровые мини-игры')
    .addSubcommand((sub) =>
      sub.setName('daily').setDescription('Забрать ежедневный бонус (200 ⚡HLD)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('slot')
        .setDescription('Крутить слот-машину')
        .addIntegerOption((opt) =>
          opt.setName('bet').setDescription('Ставка (макс. 10000)').setRequired(true).setMinValue(10).setMaxValue(10000)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('coinflip')
        .setDescription('Орёл или решка')
        .addIntegerOption((opt) =>
          opt.setName('bet').setDescription('Ставка (макс. 10000)').setRequired(true).setMinValue(10).setMaxValue(10000)
        )
        .addStringOption((opt) =>
          opt.setName('choice')
            .setDescription('Орёл (heads) или Решка (tails)')
            .setRequired(true)
            .addChoices(
              { name: '🦅 Орёл (heads)', value: 'heads' },
              { name: '🦅 Решка (tails)', value: 'tails' }
            )
        )
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;
      const db = getDb();
      ensureUser(userId);

      if (sub === 'daily') {
        return handleDaily(interaction, userId, db);
      } else if (sub === 'slot') {
        return handleSlot(interaction, userId, db);
      } else if (sub === 'coinflip') {
        return handleCoinflip(interaction, userId, db);
      }
    } catch (error) {
      console.error('[CASINO] Ошибка:', error);
      await interaction.reply({
        content: '❌ Произошла ошибка в казино.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

// ─── DAILY ──────────────────────────────────────────────────────────
async function handleDaily(interaction, userId, db) {
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

  // last_daily хранится в casino_stats
  const casinoStats = db.prepare('SELECT * FROM casino_stats WHERE user_id = ?').get(userId);
  const now = new Date();
  const lastDaily = casinoStats?.last_daily ? new Date(casinoStats.last_daily + 'Z') : null;

  // Проверка: прошло ли 24 часа
  if (lastDaily && (now - lastDaily) < 24 * 60 * 60 * 1000) {
    const timeLeft = 24 * 60 * 60 * 1000 - (now - lastDaily);
    const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
    const minsLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
    return interaction.reply({
      content: `⏰ Ежедневный бонус уже получен! Следующий через **${hoursLeft} ч. ${minsLeft} мин.**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const dailyAmount = 200;
  try {
    runInTransaction(() => {
      addCoins(userId, dailyAmount);
      db.prepare(`
        INSERT INTO casino_stats (user_id, last_daily, total_won) VALUES (?, datetime('now'), ?)
        ON CONFLICT(user_id) DO UPDATE SET last_daily = datetime('now'), total_won = total_won + ?
      `).run(userId, dailyAmount, dailyAmount);
    });
  } catch (err) {
    console.error('[CASINO] daily:', err);
    return interaction.reply({
      content: '❌ Не удалось выдать бонус. Попробуй ещё раз.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎰 Ежедневный бонус')
    .setDescription(`Ты получил **${dailyAmount} ⚡HLD**!`)
    .addFields(
      { name: '💰 Новый баланс', value: `**${user.balance + dailyAmount} ⚡HLD**`, inline: true },
      { name: '⏰ Следующий бонус', value: 'Через **24 часа**', inline: true },
    )

  await interaction.reply({ embeds: [embed] });
}

// ─── SLOT ────────────────────────────────────────────────────────────
async function handleSlot(interaction, userId, db) {
  const bet = interaction.options.getInteger('bet');
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

  if (bet > MAX_BET) {
    return interaction.reply({
      content: `❌ Максимальная ставка: **${MAX_BET} ⚡HLD**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка баланса
  if (user.balance < bet) {
    return interaction.reply({
      content: `❌ Недостаточно ⚡HLD. Твой баланс: **${user.balance} ⚡HLD**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Анимация: "крутим барабан"
  await interaction.reply({ content: '🎲 **Крутим барабан...** 🎲' });

  // Задержка для анимации
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Генерация результатов
  const reels = [
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
  ];

  // Определяем выигрыш
  let multiplier = 0;
  let winAmount = 0;

  // Проверка VIP-статуса (по наличию активного буста)
  const hasVipBoost = db.prepare(`
    SELECT COUNT(*) as cnt FROM active_boosts WHERE user_id = ? AND expires_at > datetime('now')
  `).get(userId).cnt > 0;

  const effectiveVip = hasVipBoost ? VIP_MULTIPLIER : 1.0;

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    multiplier = 5 * effectiveVip;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    multiplier = 1.5;
  }

  if (multiplier > 0) {
    winAmount = Math.floor(bet * multiplier);
  } else {
    winAmount = -bet;
  }

  try {
    recordCasinoResult(db, userId, { bet, winAmount, slot: true });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.editReply({ content: '❌ Недостаточно ⚡HLD для ставки.' });
    }
    throw err;
  }

  // Результат
  const updatedUser = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(userId);

  const embed = new EmbedBuilder()
    .setColor(winAmount > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle(winAmount > 0 ? '🎉 **ДЖЕКПОТ!** 🎉' : '😔 Не повезло...')
    .setDescription(`**${reels.join(' | ')}**`)
    .addFields(
      { name: '💰 Ставка', value: `**${bet} ⚡HLD**`, inline: true },
      { name: winAmount > 0 ? '🏆 Выигрыш' : '💸 Проигрыш',
        value: winAmount > 0 ? `**+${winAmount} ⚡HLD**` : `**-${Math.abs(winAmount)} ⚡HLD**`,
        inline: true },
      { name: '💳 Баланс', value: `**${updatedUser.balance} ⚡HLD**`, inline: true },
    )
    .setFooter({ text: hasVipBoost ? 'VIP +20% только на три одинаковых символа' : 'Пара даёт x1.5. VIP — только на джекпот.' })

  await interaction.editReply({ content: null, embeds: [embed] });
}

// ─── COINFLIP ──────────────────────────────────────────────────────
async function handleCoinflip(interaction, userId, db) {
  const bet = interaction.options.getInteger('bet');
  const choice = interaction.options.getString('choice');
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

  if (bet > MAX_BET) {
    return interaction.reply({
      content: `❌ Максимальная ставка: **${MAX_BET} ⚡HLD**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка баланса
  if (user.balance < bet) {
    return interaction.reply({
      content: `❌ Недостаточно ⚡HLD. Твой баланс: **${user.balance} ⚡HLD**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({ content: '🪙 **Подбрасываем монетку...** 🪙' });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const win = result === choice;

  let winAmount = 0;
  if (win) {
    winAmount = bet * 2;
  } else {
    winAmount = -bet;
  }

  try {
    recordCasinoResult(db, userId, { bet, winAmount, slot: false });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.editReply({ content: '❌ Недостаточно ⚡HLD для ставки.' });
    }
    throw err;
  }

  const updatedUser = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(userId);

  const embed = new EmbedBuilder()
    .setColor(win ? 0x2ecc71 : 0xe74c3c)
    .setTitle(win ? '🎉 **Победа!** 🎉' : '😔 Проигрыш')
    .setDescription(
      `Выпало: **${result === 'heads' ? '🦅 Орёл' : '🦅 Решка'}**\n` +
      `Ты выбрал: **${choice === 'heads' ? '🦅 Орёл' : '🦅 Решка'}**`
    )
    .addFields(
      { name: '💰 Ставка', value: `**${bet} ⚡HLD**`, inline: true },
      { name: win ? '🏆 Выигрыш' : '💸 Проигрыш',
        value: win ? `**+${winAmount} ⚡HLD**` : `**-${Math.abs(winAmount)} ⚡HLD**`,
        inline: true },
      { name: '💳 Баланс', value: `**${updatedUser.balance} ⚡HLD**`, inline: true },
    )
    .setFooter({ text: 'Честная игра 50/50. VIP не увеличивает выплату coinflip.' })

  await interaction.editReply({ content: null, embeds: [embed] });
}

