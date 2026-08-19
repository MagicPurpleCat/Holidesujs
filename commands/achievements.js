// ============================================================================
// Команда: /достижения — каталог 1000 достижений с фильтром и страницами
// ============================================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_TOTAL,
  listAchievementKeys,
  listAchievements,
} from '../modules/progress.js';
import { COLOR, guildFooter } from '../utils/ui.js';

const PAGE_SIZE = 15;

export function parseAchievementsCustomId(customId) {
  // ach_view:<userId>:<category>:<page>
  const parts = String(customId || '').split(':');
  if (parts[0] !== 'ach_view') return null;
  return {
    userId: parts[1] || '',
    category: parts[2] || 'all',
    page: Math.max(0, Number(parts[3]) || 0),
  };
}

function buildAchievementsComponents(targetId, category, page, totalPages) {
  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId(`ach_cat:${targetId}:${page}`)
    .setPlaceholder('📂 Категория достижений')
    .addOptions(
      Object.entries(ACHIEVEMENT_CATEGORIES).map(([key, meta]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${meta.emoji} ${meta.label}`)
          .setValue(key)
          .setDefault(key === category),
      ),
    );

  const prevPage = Math.max(0, page - 1);
  const nextPage = Math.min(totalPages - 1, page + 1);

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ach_view:${targetId}:${category}:${prevPage}`)
      .setLabel('◀ Назад')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`ach_view:${targetId}:${category}:${nextPage}`)
      .setLabel('Вперёд ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );

  return [
    new ActionRowBuilder().addComponents(categorySelect),
    nav,
  ];
}

function formatThreshold(category, threshold) {
  const labels = {
    messages: `${threshold.toLocaleString('ru-RU')} сообщ.`,
    voice: `${threshold.toLocaleString('ru-RU')} мин войса`,
    balance: `${threshold.toLocaleString('ru-RU')} ⚡HLD`,
    xp: `${threshold.toLocaleString('ru-RU')} XP`,
    level: `${threshold} ур.`,
    reputation: `${threshold.toLocaleString('ru-RU')} реп.`,
    streak: `${threshold} дн. подряд`,
    overall: `${threshold.toLocaleString('ru-RU')} рейтинга`,
    quests: `${threshold} квестов`,
  };
  return labels[category] || String(threshold);
}

function buildAchievementsLines(keys, unlockedSet) {
  return keys.map((key) => {
    const a = ACHIEVEMENTS[key];
    const mark = unlockedSet.has(key) ? '✅' : '⬜';
    const hint = !unlockedSet.has(key) && a?.kind === 'tier' && a?.threshold
      ? ` · _${formatThreshold(a.category, a.threshold)}_`
      : '';
    return `${mark} ${a?.emoji || '🏅'} ${a?.name || key}${hint}`;
  });
}

export function buildAchievementsEmbed(interaction, {
  userId,
  username,
  category = 'all',
  page = 0,
} = {}) {
  const guildId = interaction.guildId;
  const targetId = userId || interaction.user.id;
  const unlockedRows = listAchievements(targetId, guildId);
  const unlockedKeys = new Set((unlockedRows || []).map((r) => r.key));
  const unlockedCount = unlockedRows?.length || 0;

  const allKeys = listAchievementKeys(category);
  const totalPages = Math.max(1, Math.ceil(allKeys.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = allKeys.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const lines = buildAchievementsLines(slice, unlockedKeys);

  const catMeta = ACHIEVEMENT_CATEGORIES[category] || ACHIEVEMENT_CATEGORIES.all;
  const embed = new EmbedBuilder()
    .setColor(COLOR.accent)
    .setTitle(`🏅 Достижения${username ? ` — ${username}` : ''}`)
    .setDescription(
      `Открыто: **${unlockedCount}/${ACHIEVEMENT_TOTAL}**\n` +
      `Категория: **${catMeta.emoji} ${catMeta.label}** · страница **${safePage + 1}/${totalPages}**`,
    )
    .addFields({
      name: 'Список',
      value: lines.length ? lines.join('\n') : 'В этой категории пока пусто.',
    })
    .setFooter({
      text: guildFooter(interaction, `${unlockedCount}/${ACHIEVEMENT_TOTAL} · ${catMeta.label}`),
    })
    .setTimestamp();

  embed.__achMeta = { category, page: safePage, totalPages, targetId };
  return embed;
}

export function buildAchievementsReply(interaction, opts = {}) {
  const embed = buildAchievementsEmbed(interaction, opts);
  const meta = embed.__achMeta || {
    category: opts.category || 'all',
    page: opts.page || 0,
    totalPages: 1,
    targetId: opts.userId || interaction.user.id,
  };
  delete embed.__achMeta;

  return {
    embeds: [embed],
    components: buildAchievementsComponents(
      meta.targetId,
      meta.category,
      meta.page,
      meta.totalPages,
    ),
  };
}

export async function handleAchievementsInteraction(interaction) {
  const customId = interaction.customId || '';

  if (customId.startsWith('ach_view:')) {
    const parsed = parseAchievementsCustomId(customId);
    if (!parsed) return false;

    const member = interaction.guild?.members?.cache?.get(parsed.userId)
      || await interaction.guild?.members?.fetch(parsed.userId).catch(() => null);

    const payload = buildAchievementsReply(interaction, {
      userId: parsed.userId,
      username: member?.displayName || member?.user?.username || null,
      category: parsed.category,
      page: parsed.page,
    });

    await interaction.update(payload);
    return true;
  }

  if (customId.startsWith('ach_cat:')) {
    const [, targetId, pageStr] = customId.split(':');
    const category = interaction.values?.[0] || 'all';
    const page = Math.max(0, Number(pageStr) || 0);

    const member = interaction.guild?.members?.cache?.get(targetId)
      || await interaction.guild?.members?.fetch(targetId).catch(() => null);

    const payload = buildAchievementsReply(interaction, {
      userId: targetId,
      username: member?.displayName || member?.user?.username || null,
      category,
      page: 0,
    });

    await interaction.update(payload);
    return true;
  }

  return false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('достижения')
    .setDescription('Каталог из 1000 достижений Holidesu'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Команда доступна только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const payload = buildAchievementsReply(interaction, {});
    return interaction.editReply(payload);
  },
};
