import { MessageFlags } from 'discord.js';
import { logErr } from './botLog.js';
import { logEvent } from '../modules/logger.js';

const DEFAULT_FALLBACK_TEXT = 'Сервис временно недоступен, попробуйте позже.';

/**
 * Унифицированный ответ пользователю при ошибках interaction-ов.
 * Поддерживает состояния: replied/deferred.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} opts
 * @param {string} opts.text
 * @param {boolean} opts.ephemeral
 */
export async function safeInteractionFallback(interaction, {
  text = DEFAULT_FALLBACK_TEXT,
  ephemeral = true,
} = {}) {
  const payload = {
    content: text,
    flags: ephemeral ? MessageFlags.Ephemeral : 0,
  };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // Если Discord не даёт ответить из-за состояния interaction — просто молча игнорируем.
  }
}

function safeString(x, fallback = '') {
  if (x === undefined || x === null) return fallback;
  return String(x).slice(0, 300);
}

/**
 * Логирует ошибку interaction-а в консоль и (если возможно) в guild-лог.
 *
 * @param {object} params
 * @param {import('discord.js').Interaction} params.interaction
 * @param {number|string} params.shardId
 * @param {string} params.context
 * @param {unknown} params.error
 */
export async function reportInteractionError({
  interaction,
  shardId,
  context,
  error,
}) {
  const err = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));
  const guild = interaction.guild;
  const guildId = guild?.id || interaction.guildId || '';
  const userId = interaction.user?.id || '';

  const customId = interaction.customId ? safeString(interaction.customId, 'customId') : null;
  const commandName = interaction.commandName ? safeString(interaction.commandName, 'commandName') : null;

  logErr(
    shardId,
    'INTERACTION_SAFE',
    `${context}: guild=${guildId} user=${userId} command=${commandName ?? '-'} customId=${customId ?? '-'} err=${err.message}`,
  );

  // В guild-лог пишем только если можем достать guild.
  if (!guild) return;

  try {
    await logEvent(guild, 'important', {
      eventType: 'interaction_error',
      level: 'important',
      title: '❌ Ошибка interaction',
      description:
        `Контекст: \`${context}\`\n` +
        `Команда: ${commandName ? `\`${commandName}\`` : '—'}\n` +
        `customId: ${customId ? `\`${customId}\`` : '—'}\n` +
        `Пользователь: ${userId ? `<@${userId}>` : '—'}\n` +
        `Ошибка: \`${safeString(err.message, err.message)}\``,
      color: 0xED4245,
      targetId: userId || null,
      targetName: interaction.user?.tag || userId || null,
      details: {
        stack: err.stack?.slice(0, 1500) || '',
      },
    });
  } catch {
    // Никакого fallback — логирование ошибок не должно ломать обработчик.
  }
}

/**
 * Обёртка для handler-ов: гарантирует user-facing fallback + логирование.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} params
 * @param {number|string} params.shardId
 * @param {string} params.context
 * @param {Function} params.fn
 */
export async function withInteractionFallback(interaction, {
  shardId,
  context,
  fn,
} = {}) {
  try {
    return await fn();
  } catch (error) {
    await reportInteractionError({ interaction, shardId, context, error });
    await safeInteractionFallback(interaction, {});
    return null;
  }
}

