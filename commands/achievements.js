// ============================================================================
// Команда: /достижения — каталог тематических достижений
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
import { getAchievementProgress } from '../modules/achievementsTracker.js';
import { COLOR, guildFooter } from '../utils/ui.js';

const PAGE_SIZE = 10;

export function parseAchievementsCustomId(customId) {
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

function buildAchievementsLines(keys, unlockedSet, guildId, userId) {
  return keys.map((key) => {
    const a = ACHIEVEMENTS[key];
    const unlocked = unlockedSet.has(key);
    const mark = unlocked ? '✅' : '⬜';
    const target = a?.target || 1;
    let progressHint = '';
    if (!unlocked && target > 1) {
      const prog = getAchievementProgress(userId, guildId, key);
      progressHint = ` · _${Math.min(prog.progress, target)}/${target}_`;
    } else if (!unlocked && a?.description) {
      progressHint = ` · _${a.description}_`;
    }
    // Короткие описания в списке — обрезаем
    if (progressHint.length > 90) {
      progressHint = `${progressHint.slice(0, 87)}…_`;
    }
    return `${mark} ${a?.emoji || '🏅'} **${a?.name || key}**${progressHint}`;
  });
}

export function buildAchievementsEmbed(interaction, {
  userId,
  username,
  category = 'all',
  page = 0,
  search = '',
} = {}) {
  const guildId = interaction.guildId;
  const targetId = userId || interaction.user.id;
  const unlockedRows = listAchievements(targetId, guildId);
  const unlockedKeys = new Set((unlockedRows || []).map((r) => r.key).filter((k) => ACHIEVEMENTS[k]));
  const unlockedCount = unlockedKeys.size;

  const q = String(search || '').trim().toLowerCase();
  let allKeys = listAchievementKeys(category);
  if (q) {
    allKeys = allKeys.filter((key) => {
      const a = ACHIEVEMENTS[key];
      if (!a) return false;
      return (
        key.toLowerCase().includes(q)
        || String(a.name || '').toLowerCase().includes(q)
        || String(a.description || '').toLowerCase().includes(q)
      );
    });
  }

  const totalPages = Math.max(1, Math.ceil(allKeys.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = allKeys.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const lines = buildAchievementsLines(slice, unlockedKeys, guildId, targetId);

  const catMeta = ACHIEVEMENT_CATEGORIES[category] || ACHIEVEMENT_CATEGORIES.all;
  const searchLine = q ? `\nПоиск: **${search.trim()}** · найдено **${allKeys.length}**` : '';
  const embed = new EmbedBuilder()
    .setColor(COLOR.accent)
    .setTitle(`🏅 Достижения${username ? ` — ${username}` : ''}`)
    .setDescription(
      `Открыто: **${unlockedCount}/${ACHIEVEMENT_TOTAL}**\n` +
      `Категория: **${catMeta.emoji} ${catMeta.label}** · страница **${safePage + 1}/${totalPages}**` +
      searchLine,
    )
    .addFields({
      name: 'Список',
      value: lines.length ? lines.join('\n').slice(0, 1020) : (q ? 'Ничего не найдено по запросу.' : 'В этой категории пока пусто.'),
    })
    .setFooter({
      text: guildFooter(interaction, `${unlockedCount}/${ACHIEVEMENT_TOTAL} · ${catMeta.label}`),
    })
    .setTimestamp();

  embed.__achMeta = { category, page: safePage, totalPages, targetId, search: q };
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
    const [, targetId] = customId.split(':');
    const category = interaction.values?.[0] || 'all';

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
    .setDescription(`Каталог достижений Holidesu (${ACHIEVEMENT_TOTAL} шт.)`)
    .addStringOption((opt) =>
      opt
        .setName('поиск')
        .setDescription('Найти по названию или описанию')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Команда доступна только на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const search = interaction.options.getString('поиск') || '';
    const payload = buildAchievementsReply(interaction, { search });
    return interaction.editReply(payload);
  },
};
