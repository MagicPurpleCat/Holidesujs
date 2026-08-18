import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getUserLevel } from '../utils/permissions.js';

/**
 * Строит Embed помощи.
 * @param {number} userLevel — уровень прав пользователя (0 = обычный)
 * @param {string} guildName — название сервера
 */
function buildHelpEmbed(userLevel, guildName) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📖 Помощь — ${guildName}`)
    .setDescription(
      'Добро пожаловать! Вот список доступных команд.\n' +
      'Валюта сервера: **⚡HLD**\n' +
      'Используй `/команда` для выполнения.'
    )
    .addFields(
      {
        name: '💰 Экономика',
        value:
          '`/баланс [пользователь]` — Показать баланс ⚡HLD\n' +
          '`/profile [пользователь]` — Полный профиль\n' +
          '`/rank [пользователь]` — Уровень и прогресс XP\n' +
          '`/shop` — Магазин: роли, бусты, создание ролей\n' +
          '`/топ` — Рейтинг топ-10 с выбором категории\n' +
          '`/settings` — Приватность профиля',
        inline: false,
      },
      {
        name: '🎮 Игровые механики',
        value:
          '`/casino daily` — Ежедневный бонус\n' +
          '`/casino slot <ставка>` — Слот-машина\n' +
          '`/casino coinflip <ставка> <choice>` — Орёл/Решка (макс. 10000, без VIP на выплату)\n' +
          '`/marry <пользователь>` — Предложение руки и сердца\n' +
          '`/divorce` — Расторгнуть брак\n' +
          '`/реп` / `/rep` — Повысить репутацию (кулдаун 1 ч, не себе)\n' +
          '`/meme-gen` — Случайная фраза\n' +
          '`/clan` — Кланы: create, invite, join, deposit, bank, info, leave, wars',
        inline: false,
      },
      {
        name: '🗣 Чат и голос',
        value:
          '🎤 **Комнаты:** зайди в канал создания, затем `/room-settings` — закрыть, скрыть, лимит, имя, кик, передать.\n' +
          '📢 **Фарм ⚡HLD:** будь в голосовом канале с другими участниками (не в соло).\n' +
          '💬 **Сообщения:** за каждое сообщение начисляется XP (раз в 5 секунд).',
        inline: false,
      },
      {
        name: '🔐 Безопасность',
        value:
          '`/verify setup` — Настроить верификацию (админ)\n' +
          '`/verify check [пользователь]` — Проверить статус верификации',
        inline: false,
      },
    )
    .setFooter({ text: 'Наш Discord сервер' })

  // ─── Админ-блок (только для level >= 1) ────────────────────
  if (userLevel >= 1) {
    let adminCommands = '';

    adminCommands +=
      '`/панель` — 🛠 **Единый центр администрирования**\n' +
      'Все админ-функции собраны в одной панели с кнопками:\n';

    if (userLevel >= 2) {
      adminCommands +=
        '└ 🔐 Права: выдать/снять права, снять верификацию, удалить пользователя\n' +
        '└ 💰 Экономика: начислить/снять ⚡HLD, бесконечный баланс, XP\n';
    }

    adminCommands +=
      '└ 🛡 Модерация: `/mod` warn, mute, kick, ban, warns\n' +
      '└ 📜 `/history` — история наказаний\n';

    if (userLevel >= 2) {
      adminCommands +=
        '└ 🛠 Настройка сервера (мастер /setup)\n';
    }

    adminCommands +=
      '└ 📊 Статистика и топ активностей\n' +
      '└ `/setup` — Мастер настройки сервера\n' +
      '└ 📜 `/логи` — Настройка логирования сервера и ролей-фильтров';

    embed.addFields({
      name: '🛠 Админка',
      value: adminCommands,
      inline: false,
    });
  }

  return embed;
}

// ══════════════════════════════════════════════════════════════════
// АЛИАС /HELP
// ══════════════════════════════════════════════════════════════════
// Команда /help делает то же самое, что /помощь.

const helpAlias = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('📖 Показать список команд и описание бота'),

  async execute(interaction) {
    const userLevel = getUserLevel(interaction.user.id, interaction.guild);
    const embed = buildHelpEmbed(userLevel, interaction.guild.name);

    await interaction.reply({ embeds: [embed] });
  },
};

export default {
  data: new SlashCommandBuilder()
    .setName('помощь')
    .setDescription('📖 Показать список команд и описание бота'),

  async execute(interaction) {
    const userLevel = getUserLevel(interaction.user.id, interaction.guild);
    const embed = buildHelpEmbed(userLevel, interaction.guild.name);

    await interaction.reply({ embeds: [embed] });
  },
};

export { helpAlias };
