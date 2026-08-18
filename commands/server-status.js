// === МОДУЛЬ: SERVER-STATUS (MOCK, не регистрируется) ===
// Команда скрыта: не входит в bot.js и register-commands.js, пока нет реального API.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

// Список доступных игр для мониторинга
const GAMES = [
  { id: 'valorant', name: 'Valorant', emoji: '🔫' },
  { id: 'cs2', name: 'CS2', emoji: '🎯' },
  { id: 'minecraft', name: 'Minecraft', emoji: '⛏️' },
  { id: 'dota2', name: 'Dota 2', emoji: '⚔️' },
  { id: 'fortnite', name: 'Fortnite', emoji: '🏝️' },
];

/**
 * MOCK-функция: возвращает тестовые данные о статусе игрового сервера.
 * TODO: Заменить на реальный API-запрос к соответствующим сервисам.
 */
function mockGetGameStats(gameId) {
  // Имитация задержки API
  const stats = {
    valorant: {
      status: 'online',
      peakOnline: 124_500,
      bansLastHour: 234,
      avgPing: 42,
      playersOnline: 87_300,
      regions: ['EU', 'NA', 'ASIA'],
    },
    cs2: {
      status: 'online',
      peakOnline: 89_200,
      bansLastHour: 156,
      avgPing: 38,
      playersOnline: 62_100,
      regions: ['EU', 'NA', 'ASIA', 'OCE'],
    },
    minecraft: {
      status: 'online',
      peakOnline: 15_800,
      bansLastHour: 23,
      avgPing: 55,
      playersOnline: 12_400,
      regions: ['EU', 'NA', 'ASIA'],
    },
    dota2: {
      status: 'online',
      peakOnline: 68_900,
      bansLastHour: 89,
      avgPing: 45,
      playersOnline: 51_200,
      regions: ['EU', 'NA', 'ASIA', 'SA'],
    },
    fortnite: {
      status: 'online',
      peakOnline: 256_000,
      bansLastHour: 412,
      avgPing: 35,
      playersOnline: 189_000,
      regions: ['EU', 'NA', 'ASIA', 'OCE'],
    },
  };

  return stats[gameId] || {
    status: 'unknown',
    peakOnline: 0,
    bansLastHour: 0,
    avgPing: 0,
    playersOnline: 0,
    regions: [],
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('server-status')
    .setDescription('📊 Показать статус игрового сервера')
    .addStringOption((opt) =>
      opt.setName('игра')
        .setDescription('Выбери игру')
        .setRequired(true)
        .addChoices(
          ...GAMES.map((g) => ({ name: `${g.emoji} ${g.name}`, value: g.id }))
        )
    ),

  async execute(interaction) {
    try {
      const gameId = interaction.options.getString('игра');
      const game = GAMES.find((g) => g.id === gameId);

      // Используем mock-функцию
      const stats = mockGetGameStats(gameId);

      const statusEmoji = stats.status === 'online' ? '🟢' : '🔴';
      const statusText = stats.status === 'online' ? 'Онлайн' : 'Недоступен';

      const embed = new EmbedBuilder()
        .setColor(stats.status === 'online' ? 0x2ecc71 : 0xe74c3c)
        .setTitle(`${game?.emoji || '🎮'} ${game?.name || gameId} — Мониторинг`)
        .addFields(
          { name: '📡 Статус', value: `${statusEmoji} ${statusText}`, inline: true },
          { name: '👥 Онлайн', value: `**${stats.playersOnline.toLocaleString()}** игроков`, inline: true },
          { name: '📈 Пик онлайн', value: `**${stats.peakOnline.toLocaleString()}**`, inline: true },
          { name: '🔨 Банов за час', value: `**${stats.bansLastHour}**`, inline: true },
          { name: '📶 Средний пинг', value: `**${stats.avgPing}** мс`, inline: true },
          { name: '🌍 Регионы', value: stats.regions.join(', '), inline: true },
        )
        .setFooter({ text: 'Данные предоставлены в тестовом режиме (MOCK)' })

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('[SERVER-STATUS] Ошибка:', error);
      await interaction.reply({
        content: '❌ Не удалось получить статус сервера.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

