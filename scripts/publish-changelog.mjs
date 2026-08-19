import fs from 'fs';
import path from 'path';

const CHANGELOG_PATH = path.join(process.cwd(), 'CHANGELOG.md');

function extractUnreleasedSection(text) {
  const marker = '## [Unreleased]';
  const start = text.indexOf(marker);
  if (start === -1) return null;

  const after = text.slice(start);
  const next = after.search(/\n## \[/); // следующая секция
  if (next === -1) return after.trim();

  return after.slice(0, next).trim();
}

function stripMarkdown(line) {
  // убираем ссылки вида [text](url)
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`/g, '')
    .trim();
}

function extractBullets(sectionText, limit = 15) {
  if (!sectionText) return [];
  let skipDevSection = false;
  const bullets = [];

  for (const raw of sectionText.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('### Для разработчиков')) {
      skipDevSection = true;
      continue;
    }
    if (skipDevSection) continue;
    if (line.startsWith('- ')) {
      bullets.push(stripMarkdown(line.slice(2)));
    }
  }

  return bullets.slice(0, limit);
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
  if (!webhookUrl) {
    console.log('[PUBLISH_CHANGELOG] DISCORD_RELEASE_WEBHOOK_URL is not set. Skip.');
    return;
  }

  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.log('[PUBLISH_CHANGELOG] CHANGELOG.md not found. Skip.');
    return;
  }

  const text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const section = extractUnreleasedSection(text);
  const bullets = extractBullets(section || text, 12);

  const description = bullets.length
    ? bullets.map((b) => `• ${b}`).join('\n')
    : 'Нет пунктов в секции changelog.';

  const payload = {
    embeds: [
      {
        title: 'Изменения Holidesu',
        description,
        color: 0x5865f2,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  await sendToDiscord(webhookUrl, payload);
  console.log('[PUBLISH_CHANGELOG] Sent to Discord.');
}

main().catch((e) => {
  console.error('[PUBLISH_CHANGELOG] Error:', e.message);
  process.exitCode = 1;
});

