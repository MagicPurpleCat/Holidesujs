// ============================================================================
// КАРТИНКА: приветствие нового участника
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let canvasModule = null;
try {
  canvasModule = await import('canvas');
} catch {
  canvasModule = null;
}

const { createCanvas, loadImage, registerFont } = canvasModule || {};

const W = 1280;
const H = 820;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const C = {
  accent: '#FF5733',
  aqua: '#33E1C4',
  gold: '#FFD700',
  white: '#F5F5F7',
  muted: 'rgba(245,245,247,0.62)',
  faint: 'rgba(245,245,247,0.38)',
  glass: 'rgba(10,10,16,0.72)',
  glass2: 'rgba(255,255,255,0.06)',
  line: 'rgba(255,255,255,0.12)',
};

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

function drawCover(ctx, img, w, h) {
  const ir = img.width / img.height;
  const cr = w / h;
  let dw;
  let dh;
  let dx;
  let dy;
  if (ir > cr) {
    dh = h;
    dw = h * ir;
    dx = (w - dw) / 2;
    dy = 0;
  } else {
    dw = w;
    dh = w / ir;
    dx = 0;
    dy = (h - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawFallbackBg(ctx) {
  const grad = ctx.createLinearGradient(0, H, W, 0);
  grad.addColorStop(0, '#0a0a12');
  grad.addColorStop(0.5, '#151522');
  grad.addColorStop(1, '#1a1424');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(155,89,182,0.12)';
  ctx.beginPath();
  ctx.arc(W * 0.88, H * 0.12, 240, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(51,225,196,0.08)';
  ctx.beginPath();
  ctx.arc(W * 0.08, H * 0.9, 200, 0, Math.PI * 2);
  ctx.fill();
}

async function drawAvatar(ctx, avatarUrl, cx, cy, r) {
  ctx.save();
  ctx.shadowColor = '#9b59b6';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();

  let loaded = false;
  if (avatarUrl && loadImage) {
    try {
      const img = await loadImage(avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      loaded = true;
    } catch {
      loaded = false;
    }
  }

  if (!loaded) {
    ctx.fillStyle = C.glass2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#9b59b6';
  ctx.lineWidth = 5;
  ctx.stroke();
}

function drawInfoCard(ctx, label, value, x, y, w, h) {
  fillRound(ctx, x, y, w, h, 16, C.glass2);
  strokeRound(ctx, x, y, w, h, 16, C.line);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.faint;
  ctx.font = font(13, true);
  ctx.fillText(trunc(ctx, label.toUpperCase(), w - 32), x + 16, y + 14);
  ctx.fillStyle = C.white;
  ctx.font = font(19, true);
  ctx.textBaseline = 'middle';
  ctx.fillText(trunc(ctx, value, w - 32), x + 16, y + h * 0.62);
}

/**
 * @param {object} data
 * @param {string} data.displayName
 * @param {string} [data.guildName]
 * @param {string} [data.avatarUrl]
 * @param {number} [data.memberCount]
 * @returns {Promise<Buffer|null>}
 */
export async function generateWelcomeImage(data) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const guildName = data.guildName || 'наш сервер';

  const bgPath = path.join(__dirname, '..', 'photo', 'fone_1.png');
  try {
    const bg = await loadImage(bgPath);
    drawCover(ctx, bg, W, H);
  } catch {
    drawFallbackBg(ctx);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(0, 0, W, H);

  fillRound(ctx, 36, 36, W - 72, H - 72, 28, C.glass);
  strokeRound(ctx, 36, 36, W - 72, H - 72, 28, C.line, 2);

  const avatarR = 88;
  const avatarCx = 148;
  const avatarCy = 168;
  await drawAvatar(ctx, data.avatarUrl, avatarCx, avatarCy, avatarR);

  const textX = 280;
  const panelW = W - textX - 72;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.aqua;
  ctx.font = font(15, true);
  ctx.fillText('👋 ДОБРО ПОЖАЛОВАТЬ', textX, 72);

  ctx.fillStyle = C.white;
  ctx.font = font(34, true);
  ctx.fillText(trunc(ctx, guildName, panelW), textX, 102);

  ctx.fillStyle = '#c39bd3';
  ctx.font = font(28, true);
  ctx.fillText(trunc(ctx, data.displayName || 'новый участник', panelW), textX, 148);

  fillRound(ctx, textX, 200, panelW, 168, 18, 'rgba(255,255,255,0.04)');
  strokeRound(ctx, textX, 200, panelW, 168, 18, C.line);

  ctx.fillStyle = C.muted;
  ctx.font = font(17);
  const intro = wrapText(
    ctx,
    'Рады видеть вас в нашем уютном сообществе! Общайтесь, задавайте вопросы, '
    + 'делитесь мемами и картинками — здесь всегда поймут и поддержат.',
    panelW - 40,
  );
  for (let i = 0; i < Math.min(intro.length, 4); i++) {
    ctx.fillText(intro[i], textX + 20, 218 + i * 26);
  }

  const cardY = 390;
  const cardW = (panelW - 24) / 3;
  const cardH = 82;
  drawInfoCard(ctx, 'Правила', '#правила', textX, cardY, cardW, cardH);
  drawInfoCard(ctx, 'Роли', '#роли', textX + cardW + 12, cardY, cardW, cardH);
  drawInfoCard(ctx, 'Стартовый баланс', '100 ⚡HLD', textX + (cardW + 12) * 2, cardY, cardW, cardH);

  fillRound(ctx, textX, 492, panelW, 200, 18, 'rgba(255,255,255,0.04)');
  strokeRound(ctx, textX, 492, panelW, 200, 18, C.line);

  ctx.fillStyle = C.faint;
  ctx.font = font(14, true);
  ctx.fillText('ПЕРЕД НАЧАЛОМ', textX + 20, 510);

  const steps = [
    '📜  Ознакомьтесь с правилами в #правила',
    '🎭  Выберите роли для тематических каналов в #роли',
    '💬  Пишите, общайтесь, делитесь — атмосфера дружелюбная',
    '🤝  Вместе создадим тёплое сообщество!',
  ];

  ctx.fillStyle = C.white;
  ctx.font = font(18);
  for (let i = 0; i < steps.length; i++) {
    ctx.fillText(steps[i], textX + 20, 542 + i * 32);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = C.faint;
  ctx.font = font(14);
  const count = Number(data.memberCount) || 0;
  const footer = count > 0
    ? `Участник №${count.toLocaleString('ru-RU')} · ${guildName}`
    : guildName;
  ctx.fillText(trunc(ctx, footer, panelW), W - 68, H - 52);

  return canvas.toBuffer('image/png');
}
