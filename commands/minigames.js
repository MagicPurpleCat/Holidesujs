/**
 * Мини-игры для достижений: /quote, /rps, /quiz, /рандом
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { COLOR, guildFooter } from '../utils/ui.js';
import {
  trackQuoteUse,
  trackRpsResult,
  trackQuizCorrect,
  trackLuckyRoll,
} from '../modules/achievementsTracker.js';

const QUOTES = [
  'Не бойся медленно идти вперёд — бойся стоять на месте.',
  'Лучшее время посадить дерево было 20 лет назад. Второе лучшее — сегодня.',
  'Сделай сегодня то, что другие не хотят, завтра будешь жить так, как другие не могут.',
  'Маленькие шаги каждый день дают большие результаты.',
  'Тишина тоже бывает ответом.',
  'Смелость — это не отсутствие страха, а движение вперёд несмотря на него.',
];

const RPS = {
  rock: { emoji: '✊', beats: 'scissors' },
  scissors: { emoji: '✌️', beats: 'paper' },
  paper: { emoji: '✋', beats: 'rock' },
};

const QUIZ = [
  { q: 'Сколько сторон у шестиугольника?', a: ['6', 'шесть'] },
  { q: 'Столица Японии?', a: ['токио', 'tokyo'] },
  { q: '2 + 2 × 2 = ?', a: ['6'] },
  { q: 'Какой газ мы вдыхаем для жизни (химический символ)?', a: ['o2', 'кислород', 'oxygen'] },
  { q: 'Сколько часов в сутках?', a: ['24'] },
  { q: 'Discord основан в каком году? (2015)', a: ['2015'] },
  { q: 'Название валюты Holidesu?', a: ['hld', '⚡hld', 'holidesu'] },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const quoteCmd = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Случайная цитата дня'),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Только на сервере.', flags: MessageFlags.Ephemeral });
    }
    trackQuoteUse(interaction.user.id, interaction.guildId);
    const text = pick(QUOTES);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR.accent)
          .setTitle('💬 Цитата дня')
          .setDescription(`*«${text}»*`)
          .setFooter({ text: guildFooter(interaction, 'Достижение: Цитата дня') }),
      ],
    });
  },
};

export const rpsCmd = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Камень, ножницы, бумага против бота')
    .addStringOption((opt) =>
      opt
        .setName('ход')
        .setDescription('Твой ход')
        .setRequired(true)
        .addChoices(
          { name: '✊ Камень', value: 'rock' },
          { name: '✋ Бумага', value: 'paper' },
          { name: '✌️ Ножницы', value: 'scissors' },
        ),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Только на сервере.', flags: MessageFlags.Ephemeral });
    }
    const choice = interaction.options.getString('ход', true);
    const bot = pick(Object.keys(RPS));
    let result = 'draw';
    if (choice === bot) result = 'draw';
    else if (RPS[choice].beats === bot) result = 'win';
    else result = 'lose';

    if (result === 'win') trackRpsResult(interaction.user.id, interaction.guildId, true);
    else if (result === 'lose') trackRpsResult(interaction.user.id, interaction.guildId, false);

    const titles = {
      win: '🏆 Победа!',
      lose: '💨 Поражение',
      draw: '🤝 Ничья',
    };

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(result === 'win' ? COLOR.success : result === 'lose' ? COLOR.danger : COLOR.accent)
          .setTitle(titles[result])
          .setDescription(
            `Ты: ${RPS[choice].emoji}\nБот: ${RPS[bot].emoji}`,
          )
          .setFooter({ text: guildFooter(interaction, 'Серия побед копится в достижениях') }),
      ],
    });
  },
};

export const quizCmd = {
  data: new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Короткий вопрос викторины')
    .addStringOption((opt) =>
      opt.setName('ответ').setDescription('Твой ответ').setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Только на сервере.', flags: MessageFlags.Ephemeral });
    }

    // Стабильный вопрос на пользователя+час, чтобы нельзя было спамить разные
    const hour = Math.floor(Date.now() / 3_600_000);
    const seed = Number(BigInt(interaction.user.id) % 97n) + hour;
    const item = QUIZ[seed % QUIZ.length];
    const answer = interaction.options.getString('ответ', true).trim().toLowerCase();
    const ok = item.a.some((a) => a === answer);

    if (ok) trackQuizCorrect(interaction.user.id, interaction.guildId);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ok ? COLOR.success : COLOR.danger)
          .setTitle(ok ? '✅ Верно!' : '❌ Неверно')
          .setDescription(`**Вопрос:** ${item.q}`)
          .setFooter({ text: guildFooter(interaction, ok ? '+1 к знатоку викторин' : 'Попробуй ещё') }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const randomCmd = {
  data: new SlashCommandBuilder()
    .setName('рандом')
    .setDescription('Случайное число от 1 до 100')
    .addIntegerOption((opt) =>
      opt.setName('макс').setDescription('Максимум (по умолчанию 100)').setMinValue(2).setMaxValue(10000),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Только на сервере.', flags: MessageFlags.Ephemeral });
    }
    const max = interaction.options.getInteger('макс') || 100;
    const value = Math.floor(Math.random() * max) + 1;
    trackLuckyRoll(interaction.user.id, interaction.guildId, value, max);

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(value === max ? COLOR.success : COLOR.accent)
          .setTitle(value === max ? '🍀 Джекпот!' : '🎲 Рандом')
          .setDescription(`Выпало: **${value}** / ${max}`)
          .setFooter({ text: guildFooter(interaction, value === max ? 'Достижение «Счастливчик»' : 'Нужен максимум') }),
      ],
    });
  },
};

export default [quoteCmd, rpsCmd, quizCmd, randomCmd];
