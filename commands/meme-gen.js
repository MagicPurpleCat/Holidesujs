// === МОДУЛЬ: MEME-GEN (Генератор мемов/фраз — локальный AI) ===
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getDb, ensureUser } from '../database.js';

// Шаблоны мемов с плейсхолдерами {user}, {server}
const memeTemplates = [
  { type: 'humor', template: 'Когда {user} заходит на сервер {server} и видит 100500 непрочитанных сообщений... 📩', emoji: '😂' },
  { type: 'humor', template: '{user}: «Я всего на минутку зашёл»... Прошло 3 часа. ⏰', emoji: '😅' },
  { type: 'wisdom', template: 'Мудрость {server}: «Купил буст — молодец, не купил — тоже молодец, главное — регулярность!» 💡', emoji: '🧠' },
  { type: 'wisdom', template: 'Знаете, {user}, а {server} — это не просто сервер, это состояние души. ✨', emoji: '🌟' },
  { type: 'roast', template: '{user}, твой микрофон издаёт звуки, как будто робот пытается петь оперу. 🎤🤖', emoji: '🔥' },
  { type: 'roast', template: 'Администрация {server} напоминает: {user}, даже у хлеба есть срок годности. А у тебя? 🍞', emoji: '😏' },
  { type: 'encouragement', template: 'Не грусти, {user}! Даже если сегодня 0 ⚡HLD, завтра будет 100! 💪', emoji: '💪' },
  { type: 'encouragement', template: '{user}, ты уникален! Как и все остальные на {server}. Но ты особенный! 🏆', emoji: '✨' },
  { type: 'funny', template: 'Голосовой чат {server}: «Кто там шуршит чипсами?» — {user}: «Это не я, это клавиатура!» 🍟', emoji: '🤣' },
  { type: 'funny', template: 'Правило {server} №1: Если {user} молчит — значит, читает историю чата последние 3 часа. 📖', emoji: '😆' },
  { type: 'love', template: '{user}, {server} тебя любит! Даже если баланс на нуле. 💕', emoji: '💖' },
  { type: 'love', template: 'Свадьба на {server}! {user} и ⚡HLD — идеальная пара! 💍', emoji: '💞' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('meme-gen')
    .setDescription('🎭 Сгенерировать случайный мем или фразу')
    .addStringOption((opt) =>
      opt.setName('тип')
        .setDescription('Тип мема')
        .setRequired(false)
        .addChoices(
          { name: '🎲 Случайный', value: 'random' },
          { name: '😂 Юмор', value: 'humor' },
          { name: '🧠 Мудрость', value: 'wisdom' },
          { name: '🔥 Рофл', value: 'roast' },
          { name: '💪 Поддержка', value: 'encouragement' },
          { name: '🤣 Прикол', value: 'funny' },
          { name: '💖 Любовь', value: 'love' },
        )
    ),

  async execute(interaction) {
    try {
      const type = interaction.options.getString('тип') || 'random';
      const db = getDb();
      ensureUser(interaction.user.id, interaction.guildId);
      const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);

      // Фильтруем шаблоны по типу
      let filtered = type === 'random'
        ? memeTemplates
        : memeTemplates.filter((m) => m.type === type);

      if (filtered.length === 0) filtered = memeTemplates;

      // Выбираем случайный
      const meme = filtered[Math.floor(Math.random() * filtered.length)];

      // Подставляем данные
      const text = meme.template
        .replace(/{user}/g, interaction.user.displayName)
        .replace(/{server}/g, interaction.guild.name)
        .replace(/{balance}/g, `${user.balance} ⚡HLD`)
        .replace(/{level}/g, `${user.level}`);

      const typeNames = {
        humor: '😂 Юмор',
        wisdom: '🧠 Мудрость',
        roast: '🔥 Рофл',
        encouragement: '💪 Поддержка',
        funny: '🤣 Прикол',
        love: '💖 Любовь',
        random: '🎲 Случайный',
      };

      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle(`${meme.emoji} Генератор мемов • ${typeNames[type] || 'Случайный'}`)
        .setDescription(text)
        .setFooter({ text: `${interaction.guild.name} • /meme-gen` })

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('[MEME-GEN] Ошибка:', error);
      await interaction.reply({
        content: '❌ Не удалось сгенерировать мем.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

