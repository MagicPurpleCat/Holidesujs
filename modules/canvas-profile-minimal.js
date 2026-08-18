// ============================================================================
// canvas-profile-minimal.js
// Генератор изображения профиля — минималистичный дизайн
// Холст: 1280×720 px
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Ленивая загрузка canvas: если пакета нет, generateProfileImage вернёт null.
let canvasModule = null;
try {
  canvasModule = await import('canvas');
} catch (_) {
  canvasModule = null;
}
const { createCanvas, loadImage, registerFont } = canvasModule || {};

// ============================================================================
// КОНФИГУРАЦИЯ ХОЛСТА
// ============================================================================
const W = 1920;   // CANVAS_WIDTH
const H = 1080;   // CANVAS_HEIGHT

// ============================================================================
// ЦВЕТА
// ============================================================================
const C = {
    ORANGE:      '#FF5733',
    TURQUOISE:   '#33E1C4',
    GOLD:        '#FFD700',
    WHITE:       '#FFFFFF',
    GRAY_LIGHT:  '#B0B0B0',
    GRAY_MID:    '#888899',
    GRAY_DARK:   '#333333',
    BG_CARD:     '#1E1E24',
    GRAY_FOOTER: '#666677',
};

// ============================================================================
// ШРИФТЫ
// ============================================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const FONT_BOLD_PATH    = path.join(FONTS_DIR, 'Roboto-Bold.ttf');
const FONT_REGULAR_PATH = path.join(FONTS_DIR, 'Roboto-Regular.ttf');
const B = 'RobotoBold';
const R = 'RobotoRegular';

try {
    if (registerFont) {
        if (fs.existsSync(FONT_BOLD_PATH))    registerFont(FONT_BOLD_PATH, { family: B });
        if (fs.existsSync(FONT_REGULAR_PATH)) registerFont(FONT_REGULAR_PATH, { family: R });
    }
} catch (_) { console.warn('[Canvas] Шрифты не найдены'); }

// ============================================================================
// ⭐ КОНФИГУРАЦИЯ РАСПОЛОЖЕНИЯ (все x, y здесь)
// Меняй любое число — всё пересчитается
// ============================================================================
const L = {
    // ─── СЕТКА ───
    col1: {
        x: 58,    // W * 0.03  — левый отступ
        w: 422,   // W * 0.22  — ширина левой колонки
    },
    col2: {
        x: 528,   // W * 0.03 + W * 0.22 + W * 0.025 — начало правой колонки
        w: 720,   // W - col2.x - 32 (правый отступ)
    },

    // ─── ЛЕВАЯ КОЛОНКА: АВАТАР ───
    avatar: {
        x: 136,   // (col1.x + (col1.w - diam) / 2) — центрирован
        y: 54,    // H * 0.05
        diam: 454,// H * 0.42
    },
    name: {
        x: 269,   // col1.x + col1.w / 2 — центр левой колонки
        y: 540,   // avatar.y + avatar.diam + 32
        size: 48,
    },
    nick: {
        x: 269,   // то же, что name.x
        y: 574,   // name.y + 34
        size: 22,
    },
    balance: {
        x: 162,   // центрирован: col1.x + (col1.w - 295) / 2
        y: 617,   // nick.y + 43
        w: 295,   // col1.w * 0.70
        h: 45,    // H * 0.042
    },

// ─── ПРАВАЯ КОЛОНКА: КАРТОЧКИ ───
    card: {
        x: 728,   // col2.x + (col2.w - 320) / 2 = 528 + 200 — центрирован
        w: 320,
        gapY: 19, // H * 0.018 — зазор между карточками
    },
    level: {
        y: 54,    // H * 0.05 (Привилегия удалена)
        h: 90,    // H * 0.083
    },
    lvlNum: {
        x: 748,   // card.x + 20
        y: 58,    // level.y + 4
    },
    bar: {
        x: 760,   // card.x + (card.w - 256) / 2 = 728 + 32 — центрирован
        y: 121,   // lvlNum.y + 63
        w: 256,   // card.w * 0.80
        h: 14,
    },

    // ─── МЕТРИКИ ───
    metrics: {
        y: 171,   // level.y + level.h + gapY + 8(отступ)
        h: 55,    // H * 0.051
    },

    // ─── ДЕЙСТВИЯ ───
    heart: {
        x: 728,   // card.x
        y: 411,   // metrics.y + 3*metrics.h + 2*gapY + 37
        w: 280,
        h: 55,
    },
    bookmark: {
        x: 728,   // card.x (stacked под heart)
        y: 485,   // heart.y + heart.h + gapY
        w: 280,
        h: 55,
    },

    // ─── ФУТЕР ───
    footer: {
        date: {
            x: 640,   // W / 2
            y: 575,   // H - 80 (снизу)
        },
        about: {
            x: 640,   // W / 2
            y: 605,   // footer.date.y + 30
        },
    },
};

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function wrapText(ctx, text, maxW) {
    if (!text) return [];
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
        else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
}

function trunc(ctx, text, maxW) {
    let t = text || 'Пользователь';
    if (ctx.measureText(t).width <= maxW) return t;
    while (ctx.measureText(t + '…').width > maxW && t.length > 1) t = t.slice(0, -1);
    return t + '…';
}

function fmtDate(d) {
    if (!d) return 'неизвестно';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
}

// ============================================================================
// ЗАГЛУШКА АВАТАРА
// ============================================================================
function drawHorns(ctx, x, y, size) {
    const r = size / 2, cx = x + r, cy = y + r;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1E1E24'; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#2E2E38';
    ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.04, r * 0.40, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.ORANGE;
    ctx.beginPath(); ctx.arc(cx - r * 0.12, cy - r * 0.02, r * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.12, cy - r * 0.02, r * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.ORANGE; ctx.lineWidth = r * 0.04; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - r * 0.18, cy - r * 0.22); ctx.quadraticCurveTo(cx - r * 0.38, cy - r * 0.55, cx - r * 0.18, cy - r * 0.72); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + r * 0.18, cy - r * 0.22); ctx.quadraticCurveTo(cx + r * 0.38, cy - r * 0.55, cx + r * 0.18, cy - r * 0.72); ctx.stroke();
    ctx.lineWidth = r * 0.025;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.28, cy - r * 0.42); ctx.lineTo(cx - r * 0.36, cy - r * 0.38); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + r * 0.28, cy - r * 0.42); ctx.lineTo(cx + r * 0.36, cy - r * 0.38); ctx.stroke();
    ctx.strokeStyle = '#555566'; ctx.lineWidth = r * 0.015;
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.14, r * 0.10, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
}

// ============================================================================
// ЛЕВАЯ КОЛОНКА
// ============================================================================
async function drawLeft(ctx, data) {
    // Аватар
    let loaded = false;
    if (data.avatarUrl) {
        try {
            const img = await loadImage(data.avatarUrl);
            const cx = L.avatar.x + L.avatar.diam / 2;
            const cy = L.avatar.y + L.avatar.diam / 2;
            ctx.save();
            ctx.beginPath(); ctx.arc(cx, cy, L.avatar.diam / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
            ctx.drawImage(img, L.avatar.x, L.avatar.y, L.avatar.diam, L.avatar.diam);
            ctx.restore();
            ctx.save();
            ctx.shadowColor = C.ORANGE; ctx.shadowBlur = 30; ctx.strokeStyle = C.ORANGE; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(cx, cy, L.avatar.diam / 2 - 2, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            loaded = true;
        } catch (_) {}
    }
    if (!loaded) {
        ctx.save(); drawHorns(ctx, L.avatar.x, L.avatar.y, L.avatar.diam); ctx.restore();
        const cx = L.avatar.x + L.avatar.diam / 2;
        const cy = L.avatar.y + L.avatar.diam / 2;
        ctx.save();
        ctx.shadowColor = C.ORANGE; ctx.shadowBlur = 30; ctx.strokeStyle = C.ORANGE; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, L.avatar.diam / 2 - 2, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    // Имя
    const maxNameW = L.col1.w - 46;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.WHITE;
    ctx.font = `bold ${L.name.size}px ${B}, ${R}, sans-serif`;
    ctx.fillText(trunc(ctx, data.username || 'Пользователь', maxNameW), L.name.x, L.name.y);
    ctx.restore();

    // Ник
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.TURQUOISE;
    ctx.font = `${L.nick.size}px ${R}, sans-serif`;
    ctx.fillText(data.nickname || '@user', L.nick.x, L.nick.y);
    ctx.restore();

    // Баланс
    ctx.save();
    roundRect(ctx, L.balance.x, L.balance.y, L.balance.w, L.balance.h, 10);
    ctx.fillStyle = C.BG_CARD; ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.GOLD;
    ctx.font = `bold 22px ${B}, ${R}, sans-serif`;
    const bal = (data.balance ?? 0).toLocaleString();
    ctx.fillText(`⚡HLD ${bal}`, L.name.x, L.balance.y + L.balance.h / 2);
    ctx.restore();
}

// ============================================================================
// ПРАВАЯ КОЛОНКА
// ============================================================================

// Уровень + прогресс-бар
function drawLevel(ctx, data) {
    ctx.save();
    roundRect(ctx, L.card.x, L.level.y, L.card.w, L.level.h, 12);
    ctx.fillStyle = C.BG_CARD; ctx.fill();
    ctx.restore();

    // Цифра уровня + префикс "LVL"
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.ORANGE;
    ctx.font = `bold 48px ${B}, ${R}, sans-serif`;
    ctx.fillText(`LVL ${data.level || 0}`, L.lvlNum.x, L.lvlNum.y);
    ctx.restore();

    // Фон бара
    ctx.save();
    roundRect(ctx, L.bar.x, L.bar.y, L.bar.w, L.bar.h, 7);
    ctx.fillStyle = C.GRAY_DARK; ctx.fill();
    ctx.restore();

    // Заливка бара
    const xp = data.xpPercent ?? 0;
    const fill = Math.min(Math.max((xp / 100) * L.bar.w, 4), L.bar.w);
    ctx.save();
    roundRect(ctx, L.bar.x, L.bar.y, fill, L.bar.h, 7);
    const grad = ctx.createLinearGradient(L.bar.x, 0, L.bar.x + L.bar.w, 0);
    grad.addColorStop(0, C.ORANGE); grad.addColorStop(0.5, '#FF7733'); grad.addColorStop(1, '#FF9933');
    ctx.fillStyle = grad; ctx.fill();
    ctx.restore();

    // Текст %
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.GRAY_MID;
    ctx.font = `14px ${R}, sans-serif`;
    ctx.fillText(`${xp.toFixed(1)}%`, L.bar.x + L.bar.w + 10, L.bar.y + L.bar.h / 2);
    ctx.restore();
}

// Метрики (только значения, без подписей и иконок)
function drawMetrics(ctx, data) {
    const items = [
        data.rank ? `${data.rank} место` : '—',
        `${(data.voiceMinutes || 0).toLocaleString()} мин.`,
        `${data.reputation || 0}`,
    ];

    items.forEach((val, i) => {
        const y = L.metrics.y + i * (L.metrics.h + L.card.gapY);

        ctx.save();
        roundRect(ctx, L.card.x, y, L.card.w, L.metrics.h, 10);
        ctx.fillStyle = C.BG_CARD; ctx.fill();
        ctx.restore();

        ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = C.WHITE; ctx.font = `bold 17px ${B}, ${R}, sans-serif`;
        ctx.fillText(val, L.card.x + 25, y + L.metrics.h / 2); ctx.restore();
    });
}

// Действия (Сердце + Закладка) — без иконок
function drawActions(ctx, data) {
    // Сердце
    ctx.save();
    roundRect(ctx, L.heart.x, L.heart.y, L.heart.w, L.heart.h, 12);
    ctx.fillStyle = C.BG_CARD; ctx.fill();
    ctx.restore();

    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.GRAY_LIGHT; ctx.font = `17px ${R}, sans-serif`;
    ctx.fillText(data.marriageWith || 'Отсутствует', L.heart.x + 25, L.heart.y + L.heart.h / 2); ctx.restore();

    // Закладка
    ctx.save();
    roundRect(ctx, L.bookmark.x, L.bookmark.y, L.bookmark.w, L.bookmark.h, 12);
    ctx.fillStyle = C.BG_CARD; ctx.fill();
    ctx.restore();

    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.GRAY_LIGHT; ctx.font = `17px ${R}, sans-serif`;
    ctx.fillText(data.favoritePerson || 'Отсутствует', L.bookmark.x + 25, L.bookmark.y + L.bookmark.h / 2); ctx.restore();
}

// ============================================================================
// ФУТЕР
// ============================================================================
function drawFooter(ctx, data) {
    // Дата (с подписью "На сервере с:")
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = C.GRAY_LIGHT;
    ctx.font = `16px ${R}, sans-serif`;
    ctx.fillText(`На сервере с: ${fmtDate(data.joinDate)}`, L.footer.date.x, L.footer.date.y);
    ctx.restore();

    // "О себе"
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (data.about && data.about.trim()) {
        ctx.fillStyle = C.GRAY_LIGHT;
        ctx.font = `16px ${R}, sans-serif`;
        const lines = wrapText(ctx, `О себе: ${data.about}`, W * 0.70);
        const n = Math.min(lines.length, 2);
        for (let i = 0; i < n; i++) ctx.fillText(lines[i], L.footer.about.x, L.footer.about.y + i * 24);
        if (lines.length > n) ctx.fillText('…', L.footer.about.x, L.footer.about.y + n * 24);
    } else {
        ctx.fillStyle = C.GRAY_FOOTER;
        ctx.font = `16px ${R}, sans-serif`;
        ctx.fillText('О себе: не указано', L.footer.about.x, L.footer.about.y);
    }
    ctx.restore();
}

// ============================================================================
// ⭐ ГЛАВНАЯ ФУНКЦИЯ
// ============================================================================

/**
 * Генерирует PNG-изображение профиля
 * @param {Object} data — данные пользователя
 * @returns {Buffer}
 */
export async function generateProfileImage(data) {
    if (!createCanvas) return null;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

// Фон — картинка photo/fone_1.png
    const bgPath = path.join(__dirname, '..', 'photo', 'fone_1.png');
    try {
        const bg = await loadImage(bgPath);
        ctx.drawImage(bg, 0, 0, W, H);
    } catch (_) {
        // Если картинка не загрузилась — тёмный градиент
        ctx.save();
        const grad = ctx.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0, '#050508');
        grad.addColorStop(0.5, '#0a0a0f');
        grad.addColorStop(1, '#12121a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

// Сборка
    await drawLeft(ctx, data);
    drawLevel(ctx, data);
    drawMetrics(ctx, data);
    drawActions(ctx, data);
    drawFooter(ctx, data);

    return canvas.toBuffer('image/png');
}

