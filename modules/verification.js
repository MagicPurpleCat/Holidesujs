import { EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder } from 'discord.js';
import { getDb, ensureUser } from '../database.js';
import { getRoleIdForLevel, assignLevelRoles } from '../commands/rank.js';
import { getGuildConfig, FALLBACK_VERIFIED_ROLE_ID } from '../utils/guildConfig.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ══════════════════════════════════════════════════════════════════
// ВЕРИФИКАЦИЯ ЧЕРЕЗ КАПЧУ (Modal)
// ══════════════════════════════════════════════════════════════════
//
// МЕХАНИКА:
// 1. Одно статичное Embed-сообщение с кнопкой "✅ Пройти верификацию"
//    висит в указанном канале (по умолчанию — канал правил).
// 2. При нажатии кнопки — открывается Modal с капчей (6 случайных символов).
// 3. Если код верный — выдаётся роль "Верифицирован" + роль уровня.
// 4. Если неверный — ошибка, обновляется попытка. Лимит: 3 попытки.
// 5. Таймаут: 10 минут (600 секунд). Если не прошёл — кик.
// ══════════════════════════════════════════════════════════════════

function getVerifiedRoleId(guildId) {
  return getGuildConfig(guildId).verifiedRoleId;
}

function getExtraVerifyRoles(guildId) {
  return getGuildConfig(guildId).extraVerifyRoles;
}

// Максимальное количество попыток
const MAX_ATTEMPTS = 3;

// Таймаут на прохождение капчи (10 минут в миллисекундах)
const CAPTCHA_TIMEOUT_MS = 600_000;

// ══════════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ КАПЧИ
// ══════════════════════════════════════════════════════════════════

/**
 * Генерирует случайную строку из 6 символов (цифры и буквы латиницы).
 * @returns {string} — код капчи
 */
function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ══════════════════════════════════════════════════════════════════
// СОЗДАНИЕ EMBED С КНОПКОЙ ВЕРИФИКАЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Создаёт Embed и кнопку для прохождения верификации.
 * @param {string} guildName — название сервера для подстановки
 * @returns {{ embed: EmbedBuilder, components: ActionRowBuilder[] }}
 */
export function buildVerificationEmbed(guildName) {
  const imagePath = join(__dirname, '..', 'photo', 'verify.png');
  const attachment = new AttachmentBuilder(imagePath);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Верификация')
    .setDescription(
      `Добро пожаловать на сервер **${guildName}**!\n\n` +
      `Чтобы получить доступ к чатам, пройди верификацию.\n` +
      `Нажми кнопку ниже и введи капчу в модальном окне.\n\n` +
      `**Важно:** у тебя есть **10 минут** и **3 попытки**.`
    )
    .setImage('attachment://verify.png')
    .setFooter({ text: 'Верификация обязательна для всех новых участников' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verification_start')
      .setLabel('✅ Пройти верификацию')
      .setStyle(ButtonStyle.Success),
  );

  return { embed, components: [row], files: [attachment] };
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК НАЖАТИЯ КНОПКИ ВЕРИФИКАЦИИ
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает нажатие кнопки "✅ Пройти верификацию".
 * Открывает Modal с капчей.
 */
export async function handleVerificationButton(interaction) {
  if (interaction.customId !== 'verification_start') return false;

  const userId = interaction.user.id;
  const db = getDb();
  ensureUser(userId, interaction.guildId);

  // Проверяем, не верифицирован ли уже
  const user = db.prepare('SELECT is_verified FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, userId);
  if (user && user.is_verified) {
    return interaction.reply({
      content: '✅ Ты уже верифицирован!',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Генерируем капчу
  const captchaCode = generateCaptcha();
  const expiresAt = new Date(Date.now() + CAPTCHA_TIMEOUT_MS).toISOString();

  // Сохраняем/обновляем попытку в БД
  db.prepare(`
    INSERT INTO verification_attempts (user_id, captcha_code, attempts_count, expires_at)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      captcha_code = excluded.captcha_code,
      attempts_count = 0,
      expires_at = excluded.expires_at
  `).run(userId, captchaCode, expiresAt);

  // Создаём Modal
  const modal = new ModalBuilder()
    .setCustomId('verification_modal')
    .setTitle('Введите капчу');

  const captchaInput = new TextInputBuilder()
    .setCustomId('verification_captcha_input')
    .setLabel(`Введите символы: ${captchaCode}`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(6)
    .setMaxLength(6)
    .setPlaceholder('Введи код из 6 символов')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(captchaInput));

  await interaction.showModal(modal);
  return true;
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК ОТПРАВКИ MODAL (ПРОВЕРКА КАПЧИ)
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает отправку модального окна с капчей.
 * Проверяет код, выдаёт роль или обновляет попытку.
 */
export async function handleVerificationModal(interaction) {
  if (interaction.customId !== 'verification_modal') return;

  const userId = interaction.user.id;
  const inputCode = interaction.fields.getTextInputValue('verification_captcha_input').trim();
  const db = getDb();
  ensureUser(userId, interaction.guildId);

  // Получаем данные попытки
  const attempt = db
    .prepare('SELECT * FROM verification_attempts WHERE user_id = ?')
    .get(userId);

  if (!attempt) {
    return interaction.reply({
      content: '❌ Ошибка: сессия верификации не найдена. Нажми кнопку "✅ Пройти верификацию" заново.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверяем, не истекло ли время
  const expiresAt = new Date(attempt.expires_at + 'Z').getTime();
  if (Date.now() > expiresAt) {
    // Время истекло — удаляем запись и кикаем
    db.prepare('DELETE FROM verification_attempts WHERE user_id = ?').run(userId);

    await interaction.reply({
      content: '⏰ Время на верификацию истекло. Ты будешь кикнут с сервера.',
      flags: MessageFlags.Ephemeral,
    });

    // Кикаем пользователя
    const member = interaction.guild.members.cache.get(userId);
    if (member) {
      await member.kick('Время верификации истекло').catch((err) => {
        console.error(`[VERIFY] Ошибка кика ${userId}:`, err.message);
      });
    }
    return;
  }

  // Проверяем количество попыток
  if (attempt.attempts_count >= MAX_ATTEMPTS) {
    // Лимит попыток исчерпан — удаляем запись и кикаем
    db.prepare('DELETE FROM verification_attempts WHERE user_id = ?').run(userId);

    await interaction.reply({
      content: `❌ Превышено количество попыток (${MAX_ATTEMPTS}). Ты будешь кикнут с сервера.`,
      flags: MessageFlags.Ephemeral,
    });

    const member = interaction.guild.members.cache.get(userId);
    if (member) {
      await member.kick('Превышено количество попыток верификации').catch((err) => {
        console.error(`[VERIFY] Ошибка кика ${userId}:`, err.message);
      });
    }
    return;
  }

  // ─── СРАВНЕНИЕ КОДА ──────────────────────────────────────────
  if (inputCode.toUpperCase() === attempt.captcha_code.toUpperCase()) {
    // ✅ Код верный — верификация пройдена

    // Удаляем запись о попытке
    db.prepare('DELETE FROM verification_attempts WHERE user_id = ?').run(userId);

    // Обновляем статус верификации
    db.prepare('UPDATE users SET is_verified = 1 WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, userId);

// Выдаём роль "Верифицирован"
    const member = interaction.guild.members.cache.get(userId);
    if (member) {
      try {
        await member.roles.add(getVerifiedRoleId(interaction.guild.id));
      } catch (err) {
        console.error(`[VERIFY] Ошибка выдачи роли верификации:`, err.message);
      }
    }

    // Выдаём дополнительные роли (если указаны в EXTRA_VERIFICATION_ROLES)
    const extraRoles = getExtraVerifyRoles(interaction.guild.id);
    if (member && extraRoles.length > 0) {
      const validRoles = extraRoles.filter(id => {
        // Проверяем, что роль существует на сервере
        const role = interaction.guild.roles.cache.get(id);
        if (!role) {
          console.warn(`[VERIFY] Дополнительная роль ${id} не найдена на сервере — пропускаем.`);
          return false;
        }
        return true;
      });

      if (validRoles.length > 0) {
        try {
          await member.roles.add(validRoles);
          console.log(`[VERIFY] Выданы дополнительные роли (${validRoles.length}): ${validRoles.join(', ')}`);
        } catch (err) {
          console.error(`[VERIFY] Ошибка выдачи дополнительных ролей:`, err.message);
        }
      }
    }

    // Выдаём роль уровня (если есть уровень)
    const userData = db.prepare('SELECT level FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, userId);
    if (userData && member) {
      await assignLevelRoles(member, userData.level);
    }

    await interaction.reply({
      content: '✅ **Верификация пройдена успешно!** Добро пожаловать на сервер! 🎉',
      flags: MessageFlags.Ephemeral,
    });

    console.log(`[VERIFY] ${interaction.user.tag} успешно прошёл верификацию.`);
  } else {
    // ❌ Неверный код — увеличиваем счётчик попыток
    const newAttempts = attempt.attempts_count + 1;
    const remaining = MAX_ATTEMPTS - newAttempts;

    db.prepare(
      'UPDATE verification_attempts SET attempts_count = ? WHERE user_id = ?'
    ).run(newAttempts, userId);

    if (remaining <= 0) {
      // Лимит исчерпан — кикаем
      db.prepare('DELETE FROM verification_attempts WHERE user_id = ?').run(userId);

      await interaction.reply({
        content: `❌ Неверный код. Попытки исчерпаны. Ты будешь кикнут с сервера.`,
        flags: MessageFlags.Ephemeral,
      });

      const member = interaction.guild.members.cache.get(userId);
      if (member) {
        await member.kick('Превышено количество попыток верификации').catch((err) => {
          console.error(`[VERIFY] Ошибка кика ${userId}:`, err.message);
        });
      }
    } else {
      // Генерируем новый код и открываем новую модалку
      const newCode = generateCaptcha();
      const newExpiresAt = new Date(Date.now() + CAPTCHA_TIMEOUT_MS).toISOString();

      db.prepare(`
        UPDATE verification_attempts SET captcha_code = ?, expires_at = ? WHERE user_id = ?
      `).run(newCode, newExpiresAt, userId);

      // Отправляем ошибку и новую модалку
      await interaction.reply({
        content: `❌ Неверный код. Осталось попыток: **${remaining}**.\nОткрываю новую капчу...`,
        flags: MessageFlags.Ephemeral,
      });

      // Открываем новую модалку с обновлённым кодом
      const modal = new ModalBuilder()
        .setCustomId('verification_modal')
        .setTitle('Введите капчу');

      const captchaInput = new TextInputBuilder()
        .setCustomId('verification_captcha_input')
        .setLabel(`Введите символы: ${newCode}`)
        .setStyle(TextInputStyle.Short)
        .setMinLength(6)
        .setMaxLength(6)
        .setPlaceholder('Введи код из 6 символов')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(captchaInput));

      // Показываем новую модалку (через followUp не получится — нужно через showModal)
      // Вместо этого отправляем в ЛС новый код
      await interaction.user.send(
        `🔐 Новая капча: **${newCode}**\n` +
        `Осталось попыток: ${remaining}\n` +
        `Нажми кнопку "✅ Пройти верификацию" в канале и введи новый код.`
      ).catch(() => {});
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ОБРАБОТЧИК guildMemberAdd
// ══════════════════════════════════════════════════════════════════

/**
 * Обрабатывает событие присоединения нового участника.
 * Бот НЕ выдаёт роли сразу — ждёт прохождения верификации.
 * @param {GuildMember} member — новый участник
 */
export async function handleGuildMemberAdd(member) {
  // Ничего не делаем — роль не выдаётся до верификации.
  // Embed с кнопкой верификации уже висит в канале правил.
  console.log(`[VERIFY] Новый участник: ${member.user.tag} (${member.id}) — ожидает верификации.`);
}

export { getVerifiedRoleId, getExtraVerifyRoles, FALLBACK_VERIFIED_ROLE_ID as VERIFIED_ROLE_ID };

