// ============================================================================
// Карточка профиля 1920×1080
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

const W = 1920;
const H = 1080;
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
  barBg: 'rgba(0,0,0,0.45)',
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

function drawFallbackBg(ctx, from, to) {
  const grad = ctx.createLinearGradient(0, H, W, 0);
  grad.addColorStop(0, from || '#07070c');
  grad.addColorStop(0.45, '#12121c');
  grad.addColorStop(1, to || '#1c1420');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,87,51,0.08)';
  ctx.beginPath();
  ctx.arc(W * 0.82, H * 0.18, 340, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(51,225,196,0.06)';
  ctx.beginPath();
  ctx.arc(W * 0.12, H * 0.86, 280, 0, Math.PI * 2);
  ctx.fill();
}

function drawHorns(ctx, x, y, size) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1E1E24';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#2E2E38';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.04, r * 0.40, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(cx - r * 0.12, cy - r * 0.02, r * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + r * 0.12, cy - r * 0.02, r * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = r * 0.04;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.18, cy - r * 0.22);
  ctx.quadraticCurveTo(cx - r * 0.38, cy - r * 0.55, cx - r * 0.18, cy - r * 0.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.18, cy - r * 0.22);
  ctx.quadraticCurveTo(cx + r * 0.38, cy - r * 0.55, cx + r * 0.18, cy - r * 0.72);
  ctx.stroke();
  ctx.restore();
}

async function drawAvatar(ctx, data, cx, cy, r, accent, opts = {}) {
  const x = cx - r;
  const y = cy - r;
  const size = r * 2;
  const outerRingWidth = opts.outerRingWidth ?? 7;
  const innerRingWidth = opts.innerRingWidth ?? 2;

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 36;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();

  let loaded = false;
  if (data.avatarUrl && loadImage) {
    try {
      const img = await loadImage(data.avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 8, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x + 8, y + 8, size - 16, size - 16);
      ctx.restore();
      loaded = true;
    } catch {
      loaded = false;
    }
  }
  if (!loaded) drawHorns(ctx, x + 8, y + 8, size - 16);

  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.lineWidth = outerRingWidth;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = innerRingWidth;
  ctx.stroke();
}

function drawPill(ctx, text, x, y, fill, color) {
  ctx.font = font(18, true);
  const padX = 18;
  const h = 36;
  const w = ctx.measureText(text).width + padX * 2;
  fillRound(ctx, x, y, w, h, 18, fill);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2);
  return w;
}

function drawStat(ctx, label, value, x, y, w, h) {
  fillRound(ctx, x, y, w, h, 18, C.glass2);
  strokeRound(ctx, x, y, w, h, 18, C.line);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.faint;
  ctx.font = font(15, true);
  ctx.fillText(label.toUpperCase(), x + 22, y + 18);
  ctx.fillStyle = C.white;
  ctx.font = font(28, true);
  ctx.textBaseline = 'middle';
  ctx.fillText(trunc(ctx, String(value), w - 44), x + 22, y + h * 0.62);
}

/**
 * @param {object} data
 * @returns {Promise<Buffer|null>}
 */
export async function generateProfileImage(data) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const accent = data.frameColor || C.accent;

  const bgPath = path.join(__dirname, '..', 'photo', 'fone_1.png');
  try {
    const bg = await loadImage(bgPath);
    drawCover(ctx, bg, W, H);
  } catch {
    drawFallbackBg(ctx, data.bgFrom, data.bgTo);
  }

  if (data.bgFrom && data.bgTo) {
    ctx.save();
    ctx.globalAlpha = 0.38;
    const overlay = ctx.createLinearGradient(0, 0, W, H);
    overlay.addColorStop(0, data.bgFrom);
    overlay.addColorStop(1, data.bgTo);
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(4,4,8,0.42)';
  ctx.fillRect(0, 0, W, H);

  const panel = { x: 48, y: 48, w: W - 96, h: H - 96 };
  fillRound(ctx, panel.x, panel.y, panel.w, panel.h, 36, C.glass);
  strokeRound(ctx, panel.x, panel.y, panel.w, panel.h, 36, C.line, 1.5);
  ctx.save();
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 36);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(panel.x, panel.y, 8, panel.h);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(668, 96, 1, H - 192);

  if (data.frameColor) {
    strokeRound(ctx, 22, 22, W - 44, H - 44, 42, data.frameColor, 10);
    strokeRound(ctx, 34, 34, W - 68, H - 68, 38, 'rgba(255,255,255,0.18)', 2);
  }

  const leftW = 668 - panel.x;
  const leftCenterX = panel.x + leftW / 2;
  const avatarR = 200;
  const avatarDiameter = avatarR * 2;
  const gapAfterAvatar = 32;
  const nameFontSize = 42;
  const gapAfterName = 10;
  const nickFontSize = 22;
  const gapAfterNick = 30;
  const pillH = 36;
  const clanGap = 50;

  let leftBlockHeight = avatarDiameter + gapAfterAvatar + nameFontSize + gapAfterName + nickFontSize + gapAfterNick;
  if (data.clanTag) leftBlockHeight += pillH + clanGap;
  leftBlockHeight += pillH;

  const leftBlockTop = panel.y + (panel.h - leftBlockHeight) / 2;
  const cx = leftCenterX;
  const cy = leftBlockTop + avatarR;
  await drawAvatar(ctx, data, cx, cy, avatarR, accent);

  const name = data.username || 'Пользователь';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.white;
  ctx.font = font(nameFontSize, true);
  const nameY = leftBlockTop + avatarDiameter + gapAfterAvatar;
  ctx.fillText(trunc(ctx, name, leftW - 40), cx, nameY);

  ctx.fillStyle = C.aqua;
  ctx.font = font(nickFontSize);
  const nickY = nameY + nameFontSize + gapAfterName;
  ctx.fillText(trunc(ctx, data.nickname || '', leftW - 40), cx, nickY);

  let badgeY = nickY + nickFontSize + gapAfterNick;
  if (data.clanTag) {
    ctx.font = font(18, true);
    const clanText = trunc(ctx, data.clanTag, 360);
    const clanW = ctx.measureText(clanText).width + 36;
    drawPill(ctx, clanText, cx - clanW / 2, badgeY, 'rgba(51,225,196,0.16)', C.aqua);
    badgeY += 50;
  }

  const bal = `${(data.balance ?? 0).toLocaleString('ru-RU')} HLD`;
  ctx.font = font(20, true);
  const balW = ctx.measureText(bal).width + 36;
  drawPill(ctx, bal, cx - balW / 2, badgeY, 'rgba(255,215,0,0.16)', C.gold);

  const rx = 700;
  const rw = 1140;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.faint;
  ctx.font = font(14, true);
  ctx.fillText('ПРОФИЛЬ HOLIDESU', rx, 80);

  fillRound(ctx, rx, 118, rw, 150, 22, C.glass2);
  strokeRound(ctx, rx, 118, rw, 150, 22, C.line);

  ctx.fillStyle = accent;
  ctx.font = font(56, true);
  ctx.textBaseline = 'middle';
  ctx.fillText(`LVL ${data.level || 1}`, rx + 32, 168);

  const xp = Math.max(0, Math.min(100, Number(data.xpPercent) || 0));
  ctx.fillStyle = C.muted;
  ctx.font = font(22);
  ctx.textAlign = 'right';
  ctx.fillText(`${xp.toFixed(1)}% до следующего`, rx + rw - 32, 168);

  const barX = rx + 32;
  const barY = 214;
  const barW = rw - 64;
  const barH = 18;
  fillRound(ctx, barX, barY, barW, barH, 9, C.barBg);
  const fillW = Math.max(xp > 0 ? 12 : 0, (xp / 100) * barW);
  if (fillW > 0) {
    ctx.save();
    roundRect(ctx, barX, barY, barW, barH, 9);
    ctx.clip();
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, C.gold);
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, fillW, barH);
    ctx.restore();
  }

  const stats = [
    ['Место', data.rank ? `#${data.rank}` : '—'],
    ['Сообщения', (data.messages || 0).toLocaleString('ru-RU')],
    ['Войс, мин', (data.voiceMinutes || 0).toLocaleString('ru-RU')],
    ['Репутация', (data.reputation || 0).toLocaleString('ru-RU')],
  ];
  const gap = 16;
  const tileW = (rw - gap * 3) / 4;
  const tileH = 108;
  const tileY = 290;
  stats.forEach(([label, value], i) => {
    drawStat(ctx, label, value, rx + i * (tileW + gap), tileY, tileW, tileH);
  });

  const infoY = 418;
  const infoH = 88;
  const half = (rw - gap) / 2;
  const married = data.marriageWith && data.marriageWith !== 'Отсутствует';
  if (married) {
    // Плитка "Брак" с аватаркой партнёра + именем
    fillRound(ctx, rx, infoY, half, infoH, 18, C.glass2);
    strokeRound(ctx, rx, infoY, half, infoH, 18, C.line);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = C.faint;
    ctx.font = font(15, true);
    ctx.fillText('БРАК', rx + 22, infoY + 12);

    // Кружок чуть меньше и ниже, чтобы не перекрывал подпись "БРАК"
    const avatarCy = infoY + infoH / 2;
    const avatarR = Math.max(19, Math.min(23, (infoH / 2) - 11));

    // Центрируем по фактической ширине: аватар + реальная ширина имени
    const centerX = rx + half / 2;
    const gapX = 18;
    const avatarW = avatarR * 2;
    const nameMaxW = Math.max(120, Math.min(260, half - 44 - avatarW - gapX));
    ctx.font = font(26, true);
    const marriageText = trunc(ctx, data.marriageWith, nameMaxW);
    const nameW = Math.ceil(ctx.measureText(marriageText).width);
    const groupW = avatarW + gapX + nameW;
    const groupLeftX = centerX - groupW / 2;
    const avatarCx = groupLeftX + avatarR;
    const nameX = groupLeftX + avatarW + gapX;

    await drawAvatar(
      ctx,
      { avatarUrl: data.marriagePartnerAvatarUrl },
      avatarCx,
      avatarCy,
      avatarR,
      accent,
      { outerRingWidth: 2, innerRingWidth: 1 },
    );

    ctx.fillStyle = C.white;
    ctx.textBaseline = 'middle';
    ctx.font = font(26, true);
    ctx.textAlign = 'left';
    ctx.fillText(marriageText, nameX, avatarCy);
  } else {
    drawStat(ctx, 'Брак', 'Не в браке', rx, infoY, half, infoH);
  }
  drawStat(ctx, 'На сервере с', data.joinDate || 'неизвестно', rx + half + gap, infoY, half, infoH);

  const aboutY = 526;
  const aboutH = 168;
  const statusText = data.statusText ? String(data.statusText).trim() : '';
  const hasStatus = Boolean(statusText);
  fillRound(ctx, rx, aboutY, rw, aboutH, 22, C.glass2);
  strokeRound(ctx, rx, aboutY, rw, aboutH, 22, C.line);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.faint;
  ctx.font = font(15, true);
  if (hasStatus) {
    // Pill со статусом чуть выше, чтобы поместить вместе с блоком "О себе"
    drawPill(
      ctx,
      trunc(ctx, statusText, rw - 48),
      rx + 24,
      aboutY + 12,
      'rgba(255,87,51,0.16)',
      accent,
    );
  }

  const aboutTitleY = hasStatus ? aboutY + 66 : aboutY + 18;
  const aboutTextStartY = hasStatus ? aboutY + 94 : aboutY + 52;

  ctx.fillText('О СЕБЕ', rx + 24, aboutTitleY);
  ctx.fillStyle = data.about ? C.white : C.muted;
  ctx.font = font(22);

  const aboutLines = wrapText(
    ctx,
    data.about || 'Пока ничего не указано. Можно заполнить в настройках профиля.',
    rw - 48,
  );
  const maxLines = hasStatus ? 2 : 3;
  aboutLines.slice(0, maxLines).forEach((line, i) => {
    ctx.fillText(line, rx + 24, aboutTextStartY + i * 32);
  });

  const badges = Array.isArray(data.badges) ? data.badges : [];
  const achY = 716;
  ctx.fillStyle = C.faint;
  ctx.font = font(15, true);
  ctx.fillText('ДОСТИЖЕНИЯ', rx, achY);

  fillRound(ctx, rx, achY + 26, rw, 110, 22, C.glass2);
  strokeRound(ctx, rx, achY + 26, rw, 110, 22, C.line);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.white;
  ctx.font = font(34, true);
  ctx.fillText(`${Number(data.achievementsCount || badges.length || 0)}`, rx + rw / 2, achY + 78);
  ctx.fillStyle = C.muted;
  ctx.font = font(20);
  ctx.fillText('Открыто достижений', rx + rw / 2, achY + 112);
  ctx.fillStyle = C.faint;
  ctx.font = font(18, true);
  ctx.fillText('Полный список доступен по кнопке под профилем', rx + rw / 2, achY + 138);

  return canvas.toBuffer('image/png');
}
