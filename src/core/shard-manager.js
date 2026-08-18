// ══════════════════════════════════════════════════════════════════
// МОДУЛЬ: UniversalShardManager — менеджер discord.js Client в этом процессе
// Не порождает отдельные OS-процессы: каждый шард — Client с shards: [id].
// ══════════════════════════════════════════════════════════════════
// Заменяет ручное создание new Client().
// При запуске:
//   1. Запрашивает /gateway/bot у Discord API.
//   2. Определяет оптимальное количество шардов.
//   3. Создаёт и запускает каждый шард как Client в текущем процессе.
//   4. При падении шарда — авто-перезапуск с экспоненциальным backoff.
// ══════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { getDb } from '../../database.js';

// ══════════════════════════════════════════════════════════════════
// КОНФИГУРАЦИЯ
// ══════════════════════════════════════════════════════════════════

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MULTIPLIER = 3;
const BACKOFF_MAX_MS = 300_000;

// ══════════════════════════════════════════════════════════════════
// КАСТОМНЫЙ ЛОГГЕР
// ══════════════════════════════════════════════════════════════════
// Формат: [YYYY-MM-DD HH:mm:ss.ms] [LEVEL] [SHARD #id] [MODULE] Сообщение
// ИСПРАВЛЕНО: единый формат для всех логов, уровни: INFO, WARN, ERROR, FATAL

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function formatTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function shardLog(shardId, level, module, message, ...args) {
  const ts = formatTimestamp();
  const shardStr = shardId !== undefined && shardId !== null ? `SHARD #${shardId}` : 'MAIN';
  console.log(`[${ts}] [${level}] [${shardStr}] [${module}] ${message}`, ...args);
}

function shardError(shardId, module, message, ...args) {
  const ts = formatTimestamp();
  const shardStr = shardId !== undefined && shardId !== null ? `SHARD #${shardId}` : 'MAIN';
  console.error(`[${ts}] [ERROR] [${shardStr}] [${module}] ${message}`, ...args);
}

// ══════════════════════════════════════════════════════════════════
// КЛАСС: UniversalShardManager
// ══════════════════════════════════════════════════════════════════

export class UniversalShardManager {
  /**
   * @param {string} token — Discord bot token (из process.env.DISCORD_TOKEN)
   * @param {Object} [options] — опциональные настройки
   * @param {number} [options.intents] — GatewayIntentBits
   */
  constructor(token, options = {}) {
    // ИСПРАВЛЕНО: проверка token
    if (!token || typeof token !== 'string' || token.length < 10) {
      throw new Error('[SHARD-MANAGER] [FATAL] Токен должен быть непустой строкой.');
    }

    this.token = token;
    this.options = options;

    /** @type {Map<number, { client: Client|null, status: string, backoffAttempt: number, restartTimer: NodeJS.Timeout|null }>} */
    this.shards = new Map();

    /** Общее количество шардов */
    this.totalShards = 0;

    /** Флаг: идёт ли процесс завершения */
    this.isShuttingDown = false;

    this.onShardReady = null;
    this.onInteraction = null;

    shardLog(null, 'INFO', 'SHARD-MANAGER', 'Инициализация UniversalShardManager...');
  }

  // ══════════════════════════════════════════════════════════════
  // 1. ОПРЕДЕЛЕНИЕ КОЛИЧЕСТВА ШАРДОВ
  // ══════════════════════════════════════════════════════════════

  /**
   * Запрашивает эндпоинт /gateway/bot у Discord API.
   * Возвращает рекомендуемое количество шардов.
   *
   * ИСПРАВЛЕНО: проверка статуса 200 OK, валидация типа shards,
   * fallback при любых ошибках сети или парсинга.
   *
   * @returns {Promise<number>}
   */
  async fetchRecommendedShards() {
    try {
      const response = await fetch('https://discord.com/api/v10/gateway/bot', {
        headers: {
          Authorization: `Bot ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (holidesu, 1.0.0)',
        },
      });

      // ИСПРАВЛЕНО: явная проверка статуса 200
      if (response.status !== 200) {
        let errorBody = '';
        try { errorBody = await response.text(); } catch (_) { /* ignore */ }
        throw new Error(`Discord API ответил статусом ${response.status}: ${errorBody}`);
      }

      const data = await response.json();

      // ИСПРАВЛЕНО: проверка, что data — объект, и shards — целое положительное число
      if (!data || typeof data !== 'object') {
        throw new Error('Ответ API не является объектом');
      }

      const recommended = Number.isSafeInteger(data.shards) && data.shards > 0
        ? data.shards
        : 1;

      shardLog(null, 'INFO', 'SHARD-MANAGER', `Discord API рекомендует ${recommended} шардов.`);
      return recommended;
    } catch (err) {
      shardError(null, 'SHARD-MANAGER', `Не удалось получить количество шардов: ${err.message}`);
      shardLog(null, 'WARN', 'SHARD-MANAGER', 'Fallback: запуск с 1 шардом.');
      return 1;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 2. ЗАПУСК ВСЕХ ШАРДОВ
  // ══════════════════════════════════════════════════════════════

  /**
   * Главная точка входа.
   *
   * @param {Function} [onShardReady]
   * @param {Function} [onInteraction]
   */
  async start(onShardReady, onInteraction) {
    this.onShardReady = typeof onShardReady === 'function' ? onShardReady : null;
    this.onInteraction = typeof onInteraction === 'function' ? onInteraction : null;

    this.totalShards = await this.fetchRecommendedShards();

    // ИСПРАВЛЕНО: проверка на 0 шардов
    if (!Number.isSafeInteger(this.totalShards) || this.totalShards < 1) {
      shardLog(null, 'WARN', 'SHARD-MANAGER', 'Количество шардов некорректно, принудительно устанавливаем 1.');
      this.totalShards = 1;
    }

    shardLog(null, 'INFO', 'SHARD-MANAGER', `Запуск ${this.totalShards} шардов...`);

    const startPromises = [];
    for (let shardId = 0; shardId < this.totalShards; shardId++) {
      startPromises.push(this.launchShard(shardId));
    }

    await Promise.allSettled(startPromises);

    shardLog(null, 'INFO', 'SHARD-MANAGER', `Все ${this.totalShards} шардов запущены.`);
  }

  // ══════════════════════════════════════════════════════════════
  // 3. ЗАПУСК ОДНОГО ШАРДА
  // ══════════════════════════════════════════════════════════════

  /**
   * Создаёт и запускает один экземпляр Client.
   *
   * @param {number} shardId
   */
  async launchShard(shardId) {
    // ИСПРАВЛЕНО: проверка типа shardId
    if (!Number.isSafeInteger(shardId) || shardId < 0) {
      shardError(null, 'SHARD-MANAGER', `Некорректный shardId: ${shardId}`);
      return;
    }

    const existing = this.shards.get(shardId);
    if (existing && existing.status === 'connected' && existing.client) {
      shardLog(shardId, 'INFO', 'SHARD-MANAGER', 'Уже запущен и подключён. Пропускаем.');
      return;
    }

    shardLog(shardId, 'INFO', 'SHARD-MANAGER', 'Запуск...');

    const client = new Client({
      shards: [shardId],
      shardCount: this.totalShards,
      intents: this.options.intents || [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Reaction, Partials.User],
    });

    this.shards.set(shardId, {
      client,
      status: 'connecting',
      backoffAttempt: 0,
      restartTimer: null,
    });

    // ИСПРАВЛЕНО: используем 'clientReady' вместо 'ready' (v14.16+).
    // Событие 'ready' объявлено устаревшим и будет удалено в v15.
    client.once('clientReady', () => {
      this.handleShardReady(shardId, client);
    });

    // ИСПРАВЛЕНО: отдельный обработчик client.on('error') для предотвращения падений
    client.on('error', (error) => {
      shardError(shardId, 'SHARD-MANAGER', `Клиент сообщил об ошибке: ${error.message}`);
    });

    // Разрыв соединения
    client.on('disconnect', () => {
      if (this.isShuttingDown) return;
      shardLog(shardId, 'WARN', 'SHARD-MANAGER', 'Разрыв соединения. Запуск переподключения...');
      const sd = this.shards.get(shardId);
      if (sd) sd.status = 'disconnected';
      this.scheduleRestart(shardId);
    });

    // Ошибка шарда
    client.on('shardError', (error) => {
      if (this.isShuttingDown) return;
      shardError(shardId, 'SHARD-MANAGER', `Ошибка шарда: ${error.message}`);
      const sd = this.shards.get(shardId);
      if (sd) sd.status = 'error';
      this.scheduleRestart(shardId);
    });

    // Обработчик взаимодействий (если передан)
    if (this.onInteraction) {
      client.on('interactionCreate', (interaction) => {
        this.onInteraction(interaction, shardId, client);
      });
    }

    // ─── Авторизация ──────────────────────────────────────────
    try {
      await client.login(this.token);
      const sd = this.shards.get(shardId);
      if (sd) {
        sd.status = 'connected';
        sd.backoffAttempt = 0;
      }
    } catch (err) {
      shardError(shardId, 'SHARD-MANAGER', `Ошибка входа: ${err.message}`);
      const sd = this.shards.get(shardId);
      if (sd) sd.status = 'login_failed';
      this.scheduleRestart(shardId);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 4. ОБРАБОТЧИК ГОТОВНОСТИ ШАРДА
  // ══════════════════════════════════════════════════════════════

  /**
   * Вызывается при ready.
   * ИСПРАВЛЕНО: больше НЕ кэшируем все гильдии принудительно — это
   * происходит по мере добавления серверов через guildCreate.
   * Только логируем готовность и вызываем внешний колбэк.
   *
   * @param {number} shardId
   * @param {Client} client
   */
  async handleShardReady(shardId, client) {
    // ИСПРАВЛЕНО: проверка client и client.user
    if (!client || !client.user) {
      shardError(shardId, 'SHARD-MANAGER', 'handleShardReady вызван с некорректным client');
      return;
    }

    shardLog(shardId, 'INFO', 'SHARD-MANAGER',
      `Подключён как ${client.user.tag}. Серверов: ${client.guilds.cache.size}.`);

    const sd = this.shards.get(shardId);
    if (sd) sd.status = 'connected';

    // ИСПРАВЛЕНО: больше не перебираем все гильдии в цикле fetch —
    // это может вызвать rate limit и задержку старта. Вместо этого
    // конфиги создаются при guildCreate.

    // Вызываем внешний колбэк
    if (this.onShardReady) {
      try {
        await this.onShardReady(shardId, client);
      } catch (err) {
        shardError(shardId, 'SHARD-MANAGER', `Ошибка в колбэке onShardReady: ${err.message}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 5. ПЕРЕЗАПУСК С ЭКСПОНЕНЦИАЛЬНЫМ BACKOFF
  // ══════════════════════════════════════════════════════════════

  /**
   * Планирует перезапуск шарда с увеличивающейся задержкой.
   * ИСПРАВЛЕНО: проверка isShuttingDown, проверка существования shardData.
   *
   * @param {number} shardId
   */
  scheduleRestart(shardId) {
    if (this.isShuttingDown) return;

    const shardData = this.shards.get(shardId);
    if (!shardData) return;

    shardData.backoffAttempt++;

    const delay = Math.min(
      BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, shardData.backoffAttempt - 1),
      BACKOFF_MAX_MS,
    );

    shardLog(shardId, 'WARN', 'SHARD-MANAGER',
      `Перезапуск через ${(delay / 1000).toFixed(1)}с (попытка ${shardData.backoffAttempt})...`);

    if (shardData.restartTimer) {
      clearTimeout(shardData.restartTimer);
    }

    shardData.restartTimer = setTimeout(async () => {
      if (this.isShuttingDown) return;

      // ИСПРАВЛЕНО: безопасное уничтожение старого клиента
      try {
        if (shardData.client) {
          await shardData.client.destroy().catch(() => {});
        }
      } catch (e) {
        // Игнорируем
      }
      shardData.client = null;

      await this.launchShard(shardId);
    }, delay);
  }

  // ══════════════════════════════════════════════════════════════
  // 6. ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  // ══════════════════════════════════════════════════════════════

  /**
   * @returns {Client[]}
   */
  getAllClients() {
    const clients = [];
    for (const [, shardData] of this.shards) {
      if (shardData.client) clients.push(shardData.client);
    }
    return clients;
  }

  /**
   * @param {number} shardId
   * @returns {Client|null}
   */
  getClient(shardId) {
    if (!Number.isSafeInteger(shardId)) return null;
    const shardData = this.shards.get(shardId);
    return shardData ? shardData.client : null;
  }

  /**
   * Грациозное завершение всех шардов.
   */
  async shutdown() {
    this.isShuttingDown = true;
    shardLog(null, 'INFO', 'SHARD-MANAGER', 'Завершение всех шардов...');

    const destroyPromises = [];
    for (const [shardId, shardData] of this.shards) {
      if (shardData.restartTimer) {
        clearTimeout(shardData.restartTimer);
        shardData.restartTimer = null;
      }
      if (shardData.client) {
        destroyPromises.push(
          shardData.client.destroy().catch(() => {}),
        );
      }
    }

    await Promise.allSettled(destroyPromises);
    this.shards.clear();
    shardLog(null, 'INFO', 'SHARD-MANAGER', 'Все шарды завершены.');
  }
}

export default UniversalShardManager;

