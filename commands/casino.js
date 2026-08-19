import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDb, ensureUser, removeCoins, addCoins, runInTransaction, setEphemeral, getEphemeral, deleteEphemeral } from '../database.js';
import { bumpQuest, unlockAchievement, checkEconomyAchievements } from '../modules/progress.js';
import { COLOR, fmtHld } from '../utils/ui.js';

// Символы для слот-машины
const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '⭐', '🔔'];
const VIP_MULTIPLIER = 1.2;
const MAX_BET = 10_000;

function recordCasinoResult(db, userId, guildId, { bet, winAmount, slot = false }) {
  const g = guildId || '';
  runInTransaction(() => {
    if (winAmount > 0) {
      addCoins(userId, winAmount, g);
    } else if (!removeCoins(userId, bet, g)) {
      throw new Error('NO_FUNDS');
    }
    const won = winAmount > 0 ? winAmount : 0;
    const lost = winAmount < 0 ? Math.abs(winAmount) : 0;
    if (slot) {
      db.prepare(`
        INSERT INTO casino_stats (guild_id, user_id, total_bet, total_won, total_lost, last_slot_spin)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          total_bet = total_bet + excluded.total_bet,
          total_won = total_won + excluded.total_won,
          total_lost = total_lost + excluded.total_lost,
          last_slot_spin = excluded.last_slot_spin
      `).run(g, userId, bet, won, lost);
    } else {
      db.prepare(`
        INSERT INTO casino_stats (guild_id, user_id, total_bet, total_won, total_lost)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          total_bet = total_bet + excluded.total_bet,
          total_won = total_won + excluded.total_won,
          total_lost = total_lost + excluded.total_lost
      `).run(g, userId, bet, won, lost);
    }
  });
  bumpQuest(userId, g, 'casino_bets', 1);
  if (winAmount > 0) unlockAchievement(userId, g, 'casino_win');
  checkEconomyAchievements(userId, g);
}

export default {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Daily, слоты, орёл/решка и блэкджек')
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('blackjack')
        .setDescription('Блэкджек: набери 21')
        .addIntegerOption((opt) =>
          opt.setName('bet').setDescription('Ставка (макс. 10000)').setRequired(true).setMinValue(10).setMaxValue(10000)
        )
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;
      const guildId = interaction.guildId;
      const db = getDb();
      ensureUser(userId, guildId);

      if (sub === 'daily') {
        return handleDaily(interaction, userId, db, guildId);
      } else if (sub === 'slot') {
        return handleSlot(interaction, userId, db, guildId);
      } else if (sub === 'coinflip') {
        return handleCoinflip(interaction, userId, db, guildId);
      } else if (sub === 'blackjack') {
        return handleBlackjack(interaction, userId, db, guildId);
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
async function handleDaily(interaction, userId, db, guildId) {
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

  // last_daily хранится в casino_stats
  const casinoStats = db.prepare('SELECT * FROM casino_stats WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
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
      addCoins(userId, dailyAmount, guildId);
      db.prepare(`
        INSERT INTO casino_stats (guild_id, user_id, last_daily, total_won) VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET last_daily = datetime('now'), total_won = total_won + ?
      `).run(guildId, userId, dailyAmount, dailyAmount);
    });
  } catch (err) {
    console.error('[CASINO] daily:', err);
    return interaction.reply({
      content: '❌ Не удалось выдать бонус. Попробуй ещё раз.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR.gold)
    .setTitle('Ежедневный бонус')
    .setDescription(`На счёт капнуло ${fmtHld(dailyAmount)}`)
    .addFields(
      { name: 'Баланс', value: fmtHld(user.balance + dailyAmount), inline: true },
      { name: 'Следующий', value: 'через 24 часа', inline: true },
    )
    .setFooter({ text: 'Holidesu · casino daily' });

  await interaction.reply({ embeds: [embed] });
}

// ─── SLOT ────────────────────────────────────────────────────────────
async function handleSlot(interaction, userId, db, guildId) {
  const bet = interaction.options.getInteger('bet');
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

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
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR.accent)
        .setTitle('Слоты')
        .setDescription('Барабан крутится…'),
    ],
  });

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
    recordCasinoResult(db, userId, guildId, { bet, winAmount, slot: true });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.editReply({ content: '❌ Недостаточно ⚡HLD для ставки.' });
    }
    throw err;
  }

  // Результат
  const updatedUser = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(winAmount > 0 ? COLOR.success : COLOR.danger)
    .setTitle(winAmount > 0 ? 'Джекпот' : 'Мимо')
    .setDescription(`**${reels.join('   ')}**`)
    .addFields(
      { name: 'Ставка', value: fmtHld(bet), inline: true },
      { name: winAmount > 0 ? 'Выигрыш' : 'Проигрыш',
        value: winAmount > 0 ? `+${fmtHld(winAmount)}` : `−${fmtHld(Math.abs(winAmount))}`,
        inline: true },
      { name: 'Баланс', value: fmtHld(updatedUser.balance), inline: true },
    )
    .setFooter({ text: hasVipBoost ? 'Holidesu · VIP +20% на три одинаковых' : 'Holidesu · пара ×1.5 · три ×5' });

  await interaction.editReply({ content: null, embeds: [embed] });
}

// ─── COINFLIP ──────────────────────────────────────────────────────
async function handleCoinflip(interaction, userId, db, guildId) {
  const bet = interaction.options.getInteger('bet');
  const choice = interaction.options.getString('choice');
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

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

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR.gold)
        .setTitle('Монетка')
        .setDescription('В воздухе…'),
    ],
  });
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
    recordCasinoResult(db, userId, guildId, { bet, winAmount, slot: false });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.editReply({ content: '❌ Недостаточно ⚡HLD для ставки.' });
    }
    throw err;
  }

  const updatedUser = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

  const embed = new EmbedBuilder()
    .setColor(win ? COLOR.success : COLOR.danger)
    .setTitle(win ? 'Орёл или решка' : 'Не угадал')
    .setDescription(
      `Выпало: **${result === 'heads' ? 'орёл' : 'решка'}**\n` +
      `Твой выбор: **${choice === 'heads' ? 'орёл' : 'решка'}**`
    )
    .addFields(
      { name: 'Ставка', value: fmtHld(bet), inline: true },
      { name: win ? 'Выигрыш' : 'Проигрыш',
        value: win ? fmtHld(winAmount) : `−${fmtHld(Math.abs(winAmount))}`,
        inline: true },
      { name: 'Баланс', value: fmtHld(updatedUser.balance), inline: true },
    )
    .setFooter({ text: 'Holidesu · честные 50/50' });

  await interaction.editReply({ content: null, embeds: [embed] });
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function bjKey(guildId, userId) {
  return `bj:${guildId}:${userId}`;
}

/** Возвращает ставку, если раздача истекла без завершения. */
export function sweepExpiredBlackjackStates() {
  const db = getDb();
  const now = Date.now();
  const rows = db.prepare(`
    SELECT key, payload FROM ephemeral_state
    WHERE key LIKE 'bj:%' AND expires_at <= ?
  `).all(now);

  let refunded = 0;
  for (const row of rows) {
    try {
      const state = JSON.parse(row.payload || '{}');
      const bet = Number(state.bet) || 0;
      if (bet > 0 && state.userId && state.guildId) {
        addCoins(state.userId, bet, state.guildId);
        refunded += 1;
      }
    } catch {
      /* ignore malformed */
    }
    deleteEphemeral(row.key);
  }
  return refunded;
}

let bjSweepStarted = false;
export function startBlackjackSweepLoop() {
  if (bjSweepStarted) return;
  bjSweepStarted = true;
  sweepExpiredBlackjackStates();
  setInterval(() => {
    sweepExpiredBlackjackStates();
  }, 30_000);
}

function drawCard() {
  return {
    rank: RANKS[Math.floor(Math.random() * RANKS.length)],
    suit: SUITS[Math.floor(Math.random() * SUITS.length)],
  };
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(c.rank)) {
      total += 10;
    } else {
      total += Number(c.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function formatHand(cards, hideSecond = false) {
  if (hideSecond && cards.length > 1) {
    return `${cards[0].rank}${cards[0].suit} · ??`;
  }
  return cards.map((c) => `${c.rank}${c.suit}`).join(' · ');
}

function bjButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Ещё').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('Хватит').setStyle(ButtonStyle.Secondary),
  );
}

function bjEmbed(state, revealDealer) {
  const p = handValue(state.player);
  return new EmbedBuilder()
    .setColor(p > 21 ? COLOR.danger : COLOR.accent)
    .setTitle('Блэкджек')
    .addFields(
      { name: `Ты · ${p}`, value: formatHand(state.player), inline: false },
      {
        name: revealDealer ? `Дилер · ${handValue(state.dealer)}` : 'Дилер',
        value: formatHand(state.dealer, !revealDealer),
        inline: false,
      },
      { name: 'Ставка', value: fmtHld(state.bet), inline: true },
    )
    .setFooter({ text: 'Holidesu · 21' });
}

function settleHeldBlackjack(db, userId, guildId, bet, profit) {
  if (profit >= 0) addCoins(userId, bet + profit, guildId);
  const won = profit > 0 ? profit : 0;
  const lost = profit < 0 ? bet : 0;
  db.prepare(`
    INSERT INTO casino_stats (guild_id, user_id, total_bet, total_won, total_lost)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      total_bet = total_bet + excluded.total_bet,
      total_won = total_won + excluded.total_won,
      total_lost = total_lost + excluded.total_lost
  `).run(guildId || '', userId, bet, won, lost);
  bumpQuest(userId, guildId, 'casino_bets', 1);
  if (profit > 0) unlockAchievement(userId, guildId, 'casino_win');
  checkEconomyAchievements(userId, guildId);
}

async function handleBlackjack(interaction, userId, db, guildId) {
  const bet = interaction.options.getInteger('bet');
  const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (user.balance < bet) {
    return interaction.reply({
      content: `❌ Недостаточно ⚡HLD. Баланс: **${user.balance}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (getEphemeral(bjKey(guildId, userId))) {
    return interaction.reply({ content: '❌ Сначала закончи текущую раздачу.', flags: MessageFlags.Ephemeral });
  }
  if (!removeCoins(userId, bet, guildId)) {
    return interaction.reply({
      content: `❌ Недостаточно ⚡HLD. Баланс: **${user.balance}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const player = [drawCard(), drawCard()];
  const dealer = [drawCard(), drawCard()];
  const state = { bet, player, dealer, guildId, userId };

  if (handValue(player) === 21) {
    const profit = Math.floor(bet * 1.5);
    settleHeldBlackjack(db, userId, guildId, bet, profit);
    const updated = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return interaction.reply({
      embeds: [
        bjEmbed(state, true)
          .setTitle('🃏 Блэкджек!')
          .setDescription(`Натуральный 21. Выигрыш **+${profit} ⚡HLD**\nБаланс: **${updated.balance}**`),
      ],
    });
  }

  setEphemeral(bjKey(guildId, userId), state, 5 * 60 * 1000);
  await interaction.reply({ embeds: [bjEmbed(state, false)], components: [bjButtons()] });
}

function dealerPlay(dealer) {
  while (handValue(dealer) < 17) dealer.push(drawCard());
  return dealer;
}

async function finishBlackjack(interaction, state, profit) {
  const db = getDb();
  settleHeldBlackjack(db, state.userId, state.guildId, state.bet, profit);
  deleteEphemeral(bjKey(state.guildId, state.userId));
  const updated = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?')
    .get(state.guildId, state.userId);
  const p = handValue(state.player);
  const d = handValue(state.dealer);
  let title = '🤝 Ничья';
  if (profit > 0) title = '🎉 Победа';
  else if (profit < 0) title = p > 21 ? '💥 Перебор' : '😔 Дилер сильнее';
  await interaction.update({
    embeds: [
      bjEmbed(state, true)
        .setTitle(title)
        .setDescription(`Ты: **${p}** · Дилер: **${d}**\nБаланс: **${updated.balance} ⚡HLD**`),
    ],
    components: [],
  });
}

export async function handleBlackjackButton(interaction) {
  if (interaction.customId !== 'bj_hit' && interaction.customId !== 'bj_stand') return false;
  const state = getEphemeral(bjKey(interaction.guildId, interaction.user.id));
  if (!state) {
    sweepExpiredBlackjackStates();
    await interaction.reply({
      content: '❌ Раздача истекла. Ставка возвращена на баланс, если ещё не была.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId === 'bj_hit') {
    state.player.push(drawCard());
    const p = handValue(state.player);
    if (p > 21) {
      await finishBlackjack(interaction, state, -state.bet);
      return true;
    }
    setEphemeral(bjKey(interaction.guildId, interaction.user.id), state, 5 * 60 * 1000);
    await interaction.update({ embeds: [bjEmbed(state, false)], components: [bjButtons()] });
    return true;
  }

  state.dealer = dealerPlay(state.dealer);
  const p = handValue(state.player);
  const d = handValue(state.dealer);
  let winAmount = 0;
  if (d > 21 || p > d) winAmount = state.bet;
  else if (p < d) winAmount = -state.bet;
  await finishBlackjack(interaction, state, winAmount);
  return true;
}

