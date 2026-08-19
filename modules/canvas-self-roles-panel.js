// ============================================================================
// Баннер панели самовыбираемых ролей
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SELF_ROLE_GROUPS } from './selfRolesCatalog.js';

let canvasModule = null;
try {
  canvasModule = await import('canvas');
} catch {
  canvasModule = null;
}

const { createCanvas, loadImage, registerFont } = canvasModule || {};

const W = 1280;
const H = 920;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';

function tryRegister(file, family) {
  if (!registerFont || !fs.existsSync(file)) return false;
  try {
    registerFont(file, { family });
    return true;
  } catch {
    return false;
  }
}

const fontsDir = path.join(__dirname, '..', 'fonts');
const winFonts = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'Fonts')
  : 'C:\\Windows\\Fonts';

if (tryRegister(path.join(fontsDir, 'Roboto-Bold.ttf'), 'HolidesuBold')
  || tryRegister(path.join(winFonts, 'segoeuib.ttf'), 'HolidesuBold')) {
  FONT_BOLD = 'HolidesuBold';
}
if (tryRegister(path.join(fontsDir, 'Roboto-Regular.ttf'), 'Holidesu')
  || tryRegister(path.join(winFonts, 'segoeui.ttf'), 'Holidesu')) {
  FONT = 'Holidesu';
}

function font(size, bold = false) {
  return `${bold ? 'bold ' : ''}${size}px ${bold ? FONT_BOLD : FONT}, ${FONT}, sans-serif`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRound(ctx, x, y, w, h, r, stroke, width = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function trunc(ctx, text, maxW) {
  let t = String(text || '');
  if (!t) return '';
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function wrapText(ctx, text, maxW) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawStars(ctx, count = 120) {
  for (let i = 0; i < count; i++) {
    const x = (Math.sin(i * 47.3) * 0.5 + 0.5) * W;
    const y = (Math.cos(i * 31.7) * 0.5 + 0.5) * H;
    const r = (i % 7 === 0) ? 2.2 : (i % 3 === 0 ? 1.4 : 0.8);
    const alpha = 0.15 + (i % 5) * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.min(alpha, 0.9)})`;
    ctx.fill();
  }
}

function drawNebulaBg(ctx) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#07051a');
  grad.addColorStop(0.35, '#12102e');
  grad.addColorStop(0.65, '#1a1035');
  grad.addColorStop(1, '#0d0820');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  drawStars(ctx, 160);

  const blobs = [
    { x: W * 0.15, y: H * 0.12, r: 220, c: 'rgba(155,89,182,0.18)' },
    { x: W * 0.82, y: H * 0.1, r: 180, c: 'rgba(93,173,226,0.14)' },
    { x: W * 0.7, y: H * 0.88, r: 260, c: 'rgba(241,196,15,0.08)' },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, b.c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function splitRoleLabel(name) {
  const space = String(name).indexOf(' ');
  if (space <= 0) return { emoji: '', label: name };
  return {
    emoji: name.slice(0, space),
    label: name.slice(space + 1).trim() || name,
  };
}

function drawRoleBlock(ctx, role, x, y, w, h) {
  const padX = 18;
  const innerW = w - padX * 2;

  fillRound(ctx, x, y, w, h, 18, 'rgba(255,255,255,0.05)');
  strokeRound(ctx, x, y, w, h, 18, 'rgba(255,255,255,0.12)');

  const { emoji, label } = splitRoleLabel(role.name);
  const titleY = y + 20;
  const labelY = y + 58;
  const bodyY = y + 82;
  const lineH = 22;
  const bodyLines = 3;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(22, true);
  let titleX = x + padX;
  if (emoji) {
    ctx.fillText(emoji, titleX, titleY);
    titleX += ctx.measureText(emoji).width + 10;
  }
  ctx.fillText(trunc(ctx, label, innerW - (titleX - x - padX)), titleX, titleY);

  ctx.fillStyle = 'rgba(245,245,247,0.55)';
  ctx.font = font(13, true);
  ctx.fillText('ЧТО ЭТО ЗНАЧИТ', x + padX, labelY);

  ctx.fillStyle = 'rgba(245,245,247,0.88)';
  ctx.font = font(15);
  const wrapped = wrapText(ctx, role.summary || role.description, innerW);
  for (let i = 0; i < bodyLines; i++) {
    let line = wrapped[i] || '';
    if (i === bodyLines - 1 && wrapped.length > bodyLines) {
      line = trunc(ctx, wrapped.slice(bodyLines - 1).join(' '), innerW);
    } else if (line) {
      line = trunc(ctx, line, innerW);
    }
    if (line) ctx.fillText(line, x + padX, bodyY + i * lineH);
  }
}

/**
 * @param {{ guildName?: string, guildIconUrl?: string|null }} data
 * @returns {Promise<Buffer|null>}
 */
export async function generateSelfRolesPanelImage(data = {}) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawNebulaBg(ctx);

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, H);

  fillRound(ctx, 28, 28, W - 56, H - 56, 28, 'rgba(8,6,22,0.72)');
  strokeRound(ctx, 28, 28, W - 56, H - 56, 28, 'rgba(232,218,239,0.22)', 2);

  const guildName = data.guildName || 'Seansize × Celestial';

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5DADE2';
  ctx.font = font(16, true);
  ctx.fillText('CELESTIAL · УВЕДОМЛЕНИЯ', 52, 48);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(40, true);
  ctx.fillText('Роли пингов', 52, 78);

  ctx.fillStyle = '#E8DAEF';
  ctx.font = font(20);
  ctx.fillText(trunc(ctx, guildName, W - 120), 52, 128);

  ctx.fillStyle = 'rgba(245,245,247,0.68)';
  ctx.font = font(17);
  ctx.fillText('Ниже — что означает каждая роль. Выбирай в меню под картинкой.', 52, 162);

  const pings = SELF_ROLE_GROUPS[0];
  if (pings) {
    const count = pings.roles.length;
    const gap = 12;
    const pad = 52;
    const blockW = Math.floor((W - pad * 2 - gap * (count - 1)) / count);
    const blockH = 188;
    const blockY = 200;
    for (let i = 0; i < count; i++) {
      const x = pad + i * (blockW + gap);
      drawRoleBlock(ctx, pings.roles[i], x, blockY, blockW, blockH);
    }
  }

  fillRound(ctx, 52, 420, W - 104, 200, 22, 'rgba(255,255,255,0.04)');
  strokeRound(ctx, 52, 420, W - 104, 200, 22, 'rgba(255,255,255,0.10)');

  ctx.fillStyle = 'rgba(245,245,247,0.45)';
  ctx.font = font(14, true);
  ctx.fillText('КАК ВЫБРАТЬ', 72, 438);

  const steps = [
    '1. Нажми меню «🔔 Уведомления» под этим сообщением.',
    '2. Отметь роли, о которых хочешь получать @упоминания.',
    '3. Можно взять одну, две или все три — как удобно.',
    '4. Чтобы отключить — снова открой меню и сними выбор.',
  ];
  ctx.fillStyle = 'rgba(245,245,247,0.88)';
  ctx.font = font(17);
  for (let i = 0; i < steps.length; i++) {
    ctx.fillText(steps[i], 72, 472 + i * 32);
  }

  fillRound(ctx, 52, 640, W - 104, 200, 22, 'rgba(155,89,182,0.12)');
  strokeRound(ctx, 52, 640, W - 104, 200, 22, 'rgba(155,89,182,0.28)');

  ctx.fillStyle = '#E8DAEF';
  ctx.font = font(14, true);
  ctx.fillText('ВАЖНО', 72, 658);

  const note = wrapText(
    ctx,
    'Роли не дают доступ к каналам — только пинги. Без выбранных ролей тебя не будут '
    + 'беспокоить лишними упоминаниями. Тематические каналы и доступ к разделам '
    + 'настраиваются отдельно в #роли.',
    W - 144,
  );
  ctx.fillStyle = 'rgba(245,245,247,0.85)';
  ctx.font = font(16);
  for (let i = 0; i < Math.min(note.length, 5); i++) {
    ctx.fillText(note[i], 72, 686 + i * 24);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(245,245,247,0.40)';
  ctx.font = font(14);
  ctx.fillText('Holidesu · панель ролей', W - 52, H - 40);

  return canvas.toBuffer('image/png');
}
