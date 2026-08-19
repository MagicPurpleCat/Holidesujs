import fs from 'fs';
import path from 'path';

const CHANGELOG_PATH = path.join(process.cwd(), 'CHANGELOG.md');

const COLORS = {
  header: 0xFF5733,
  added: 0x57F287,
  changed: 0x5865F2,
  fixed: 0xFEE75C,
};

const CATEGORY_MAP = {
  '### Добавлено': 'added',
  '### Изменено': 'changed',
  '### Исправлено': 'fixed',
};

const CATEGORY_META = {
  added: { emoji: '✨', title: 'Добавлено', color: COLORS.added },
  changed: { emoji: '🔧', title: 'Изменено', color: COLORS.changed },
  fixed: { emoji: '🐛', title: 'Исправлено', color: COLORS.fixed },
};

function extractUnreleasedSection(text) {
  const marker = '## [Unreleased]';
  const start = text.indexOf(marker);
  if (start === -1) return null;

  const after = text.slice(start);
  const next = after.search(/\n## \[/);
  if (next === -1) return after.trim();

  return after.slice(0, next).trim();
}

function parseUnreleasedHeader(sectionText) {
  const lines = sectionText.split(/\r?\n/);
  const firstLine = lines[0] || '';
  const rest = lines.slice(1);
  const title = firstLine.replace(/^##\s*\[Unreleased\]\s*—?\s*/, '').trim() || 'Обновление';
  const subtitle = rest.find((line) => line.trim() && !line.startsWith('#'))?.trim() || '';
  return { title, subtitle };
}

function formatForDiscord(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '**$1**')
    .replace(/`([^`]+)`/g, '`$1`')
    .trim();
}

function bulletPrefix(indent) {
  if (indent >= 4) return '   └';
  if (indent >= 2) return '  ◦';
  return '▸';
}

/** @returns {{ added: Group[], changed: Group[], fixed: Group[] }} */
function parseStructuredChangelog(sectionText) {
  /** @type {Record<string, { name: string, items: string[] }[]>} */
  const result = {
    added: [],
    changed: [],
    fixed: [],
  };

  let currentKey = null;
  /** @type {{ name: string, items: string[] } | null} */
  let currentGroup = null;
  let skipDevSection = false;

  for (const rawLine of sectionText.split(/\r?\n/)) {
    const raw = rawLine.replace(/\r$/, '');
    const trimmed = raw.trim();

    if (trimmed.startsWith('### Для разработчиков')) {
      skipDevSection = true;
      continue;
    }
    if (skipDevSection) continue;

    const categoryKey = CATEGORY_MAP[trimmed];
    if (categoryKey) {
      currentKey = categoryKey;
      currentGroup = null;
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      if (!currentKey) continue;
      currentGroup = { name: trimmed.slice(5).trim(), items: [] };
      result[currentKey].push(currentGroup);
      continue;
    }

    const bulletMatch = raw.match(/^(\s*)-\s+(.*)$/);
    if (!bulletMatch || !currentKey) continue;

    const indent = bulletMatch[1].length;
    const text = formatForDiscord(bulletMatch[2]);
    if (!text) continue;

    if (!currentGroup) {
      currentGroup = {
        name: categoryKey === 'fixed' ? 'Стабильность и багфиксы' : 'Прочее',
        items: [],
      };
      result[currentKey].push(currentGroup);
    }

    currentGroup.items.push(`${bulletPrefix(indent)} ${text}`);
  }

  return result;
}

function chunkLines(lines, maxLen = 1000) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildCategoryEmbeds(categoryKey, groups) {
  const meta = CATEGORY_META[categoryKey];
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.length === 0) return [];

  /** @type {object[]} */
  const embeds = [];
  /** @type {object[]} */
  let fields = [];

  const flushEmbed = (part = '') => {
    if (fields.length === 0) return;
    embeds.push({
      title: part ? `${meta.emoji} ${meta.title} · ${part}` : `${meta.emoji} ${meta.title}`,
      color: meta.color,
      fields: [...fields],
    });
    fields = [];
  };

  for (const group of nonEmpty) {
    const chunks = chunkLines(group.items);
    chunks.forEach((value, index) => {
      const name = index === 0
        ? group.name
        : `${group.name} (продолжение)`;

      fields.push({ name, value, inline: false });

      if (fields.length >= 24) flushEmbed(embeds.length > 0 ? `часть ${embeds.length + 1}` : '');
    });
  }

  flushEmbed();
  return embeds;
}

function countItems(groups) {
  return groups.reduce((sum, g) => sum + g.items.length, 0);
}

function buildDiscordPayload(sectionText) {
  const { title, subtitle } = parseUnreleasedHeader(sectionText);
  const structured = parseStructuredChangelog(sectionText);

  const addedCount = countItems(structured.added);
  const changedCount = countItems(structured.changed);
  const fixedCount = countItems(structured.fixed);
  const totalCount = addedCount + changedCount + fixedCount;

  const summaryLine = totalCount > 0
    ? `✨ **${addedCount}** · 🔧 **${changedCount}** · 🐛 **${fixedCount}**`
    : null;

  const headerEmbed = {
    author: {
      name: 'Holidesu · Changelog',
    },
    title: `⚡ ${title}`,
    description: [
      subtitle ? `*${formatForDiscord(subtitle)}*` : null,
      summaryLine,
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      totalCount > 0
        ? 'Ниже — изменения по категориям.'
        : '⚠️ Нет пунктов в секции `[Unreleased]`.',
    ].filter((line) => line !== null).join('\n'),
    color: COLORS.header,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Holidesu Bot · main',
    },
  };

  const categoryEmbeds = [
    ...buildCategoryEmbeds('added', structured.added),
    ...buildCategoryEmbeds('changed', structured.changed),
    ...buildCategoryEmbeds('fixed', structured.fixed),
  ];

  const embeds = [headerEmbed, ...categoryEmbeds].slice(0, 10);

  if (categoryEmbeds.length === 0) {
    headerEmbed.description = [
      subtitle ? `*${formatForDiscord(subtitle)}*` : null,
      '',
      '⚠️ Нет пунктов в секции `[Unreleased]`.',
    ].filter(Boolean).join('\n');
  }

  return {
    username: 'Holidesu Updates',
    embeds,
  };
}

async function sendToDiscord(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${t}`);
  }
}

async function main() {
  const webhookUrl = process.env.DISCORD_RELEASE_WEBHOOK_URL;
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.log('[PUBLISH_CHANGELOG] CHANGELOG.md not found. Skip.');
    return;
  }

  const text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const section = extractUnreleasedSection(text);

  if (!section) {
    console.log('[PUBLISH_CHANGELOG] [Unreleased] section not found. Skip.');
    return;
  }

  const payload = buildDiscordPayload(section);

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!webhookUrl) {
    console.log('[PUBLISH_CHANGELOG] DISCORD_RELEASE_WEBHOOK_URL is not set. Skip.');
    return;
  }

  await sendToDiscord(webhookUrl, payload);
  console.log(`[PUBLISH_CHANGELOG] Sent ${payload.embeds.length} embed(s) to Discord.`);
}

main().catch((e) => {
  console.error('[PUBLISH_CHANGELOG] Error:', e.message);
  process.exitCode = 1;
});
