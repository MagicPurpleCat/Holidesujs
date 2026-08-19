// ============================================================================
// КАРТИНКА: статистика сервера + график роста
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
  line: 'rgba(255,255,255,0.12)',
};

function trunc(ctx, text, maxW) {
  let t = String(text || '');
  if (!t) return '';
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
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

function drawPanel(ctx, x, y, w, h, title) {
  fillRound(ctx, x, y, w, h, 22, 'rgba(255,255,255,0.06)');
  strokeRound(ctx, x, y, w, h, 22, 'rgba(255,255,255,0.12)');

  ctx.fillStyle = C.faint;
  ctx.font = '700 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), x + 22, y + 16);
}

function drawTopList(ctx, items, x, y, w, h) {
  // items: [{ name, value }]
  const compact = h <= 160;
  const fontSize = compact ? 11 : 18;
  const rowH = compact ? 8 : 20;
  ctx.font = `400 ${fontSize}px sans-serif`;
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const topOffset = compact ? 18 : 46;
  const maxRows = Math.floor((h - topOffset) / rowH);
  const slice = items.slice(0, Math.min(10, maxRows));

  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    const line = `${i + 1}. ${item.name}`;
    const value = item.value ?? '';
    const left = x + 22;
    const top = y + topOffset + i * rowH;
    const maxNameW = Math.max(40, w - 22 - 260);
    ctx.fillText(trunc(ctx, line, maxNameW), left, top);

    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.fillText(String(value), x + w - 22, top);
    ctx.fillStyle = C.white;
    ctx.textAlign = 'left';
  }
}

function drawLineChart(ctx, points, x, y, w, h) {
  if (!points?.length) return;

  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);

  const left = x + 20;
  const top = y + 24;
  const chartW = w - 40;
  const chartH = h - 60;

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top + chartH);
  ctx.lineTo(left + chartW, top + chartH);
  ctx.stroke();

  const mapX = (i) => left + (chartW * i) / Math.max(1, points.length - 1);
  const mapY = (v) => top + chartH - (chartH * (v - min)) / span;

  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();

  points.forEach((p, i) => {
    const px = mapX(i);
    const py = mapY(p.value);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // точки
  ctx.fillStyle = 'rgba(255,87,51,0.9)';
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(mapX(i), mapY(p.value), 6, 0, Math.PI * 2);
    ctx.fill();
  });

  // подписи по X (каждый 2-й/3-й в зависимости от длины)
  ctx.fillStyle = C.muted;
  ctx.font = '400 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = points.length <= 7 ? 1 : points.length <= 14 ? 2 : 3;
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    ctx.fillText(p.label, mapX(i), y + h - 34);
  });
}

/**
 * @param {object} data
 * @param {Array<{name:string,value:string|number}>} data.overallTop
 * @param {Array<{name:string,value:string|number}>} data.balanceTop
 * @param {Array<{name:string,value:string|number}>} data.xpTop
 * @param {Array<{name:string,value:string|number}>} data.messagesTop
 * @param {Array<{name:string,value:string|number}>} data.voiceTop
 * @param {Array<{name:string,value:string|number}>} data.reputationTop
 * @param {Array<{label:string,value:number}>} data.chartPoints
 * @param {object} data.summary
 * @returns {Promise<Buffer|null>}
 */
export async function generateServerStatsImage(data) {
  if (!createCanvas) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // фон
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, H);

  const bgPath = path.join(__dirname, '..', 'photo', 'fone_1.png');
  try {
    if (fs.existsSync(bgPath)) {
      const bg = await loadImage(bgPath);
      ctx.drawImage(bg, 0, 0, W, H);
    }
  } catch {
    // fallback background: ничего
  }

  // затемнение + акцент
  ctx.fillStyle = 'rgba(4,4,8,0.45)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,87,51,0.55)';
  ctx.fillRect(90, 70, 6, H - 140);

  // заголовок
  ctx.fillStyle = C.faint;
  ctx.font = '700 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('СТАТИСТИКА СЕРВЕРА', 140, 70);

  ctx.fillStyle = C.white;
  ctx.font = '700 40px sans-serif';
  ctx.fillText(data.summary?.guildName || '—', 140, 110);

  // summary
  ctx.font = '400 22px sans-serif';
  ctx.fillStyle = C.muted;
  const sumLines = [
    `Пользователей: ${data.summary?.membersCount ?? 0}`,
    `Минут в голосе: ${data.summary?.voiceMinutes ?? 0}`,
    `Сообщений: ${data.summary?.messagesCount ?? 0}`,
    `Средний рейтинг: ${Math.round(data.summary?.avgOverall ?? 0).toLocaleString('ru-RU')}`,
  ];
  sumLines.forEach((l, i) => ctx.fillText(l, 140, 160 + i * 30));

  // панели top-ов (2 колонки x 3 строки)
  const gapX = 26;
  const leftX = 140;
  const rightX = leftX + 760 + gapX;
  const panelW = 760;
  const panelH = 250;

  const y1 = 250;
  const y2 = 520;
  const y3 = 790;

  drawPanel(ctx, leftX, y1, panelW, panelH, 'Общий ТОП');
  drawTopList(ctx, data.overallTop || [], leftX, y1, panelW, panelH);

  drawPanel(ctx, rightX, y1, panelW, panelH, 'Валюта ТОП');
  drawTopList(ctx, data.balanceTop || [], rightX, y1, panelW, panelH);

  drawPanel(ctx, leftX, y2, panelW, panelH, 'Сообщения ТОП');
  drawTopList(ctx, data.messagesTop || [], leftX, y2, panelW, panelH);

  drawPanel(ctx, rightX, y2, panelW, panelH, 'Войс ТОП');
  drawTopList(ctx, data.voiceTop || [], rightX, y2, panelW, panelH);

  drawPanel(ctx, leftX, y3, panelW, panelH, 'Опыт и репутация');
  // Внутри панели показываем XP и Репутацию двумя компактными под-списками
  drawTopList(ctx, data.xpTop || [], leftX, y3 + 14, panelW, 110);
  drawTopList(ctx, data.reputationTop || [], leftX, y3 + 124, panelW, 110);

  // график роста (внизу)
  const chartX = 140;
  const chartY = 980;
  // высота вылезает за экран, поэтому делаем ниже-сверху: сожмём график
  // Перестраиваем: используем пространство нижней части под график вместо 3-й панели
  // Для текущего MVP: график будет в правой нижней части.

  const chartW = 1520 - 140;
  const chartH = 280;
  const chartAreaX = rightX - 0;
  const chartAreaY = 790;

  drawPanel(ctx, chartAreaX, chartAreaY, panelW, 290, 'Рост рейтинга (средний)');

  // chart рисуем поверх панели
  drawLineChart(ctx, data.chartPoints || [], chartAreaX, chartAreaY, panelW, 290);

  return canvas.toBuffer('image/png');
}

