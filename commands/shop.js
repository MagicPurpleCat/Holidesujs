import { SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags } from 'discord.js';
import { getDb, removeCoins, addCoins, runInTransaction, setEphemeral, getEphemeral, deleteEphemeral } from '../database.js';
import { assignLevelRoles } from './rank.js';

// ─── Палитра цветов для мастера создания ──────────────────────────
const COLOR_PRESETS = [
  { label: '🔥 Красный', hex: '#FF4500', emoji: '🔴' },
  { label: '💙 Синий',   hex: '#3498DB', emoji: '🔵' },
  { label: '💚 Зелёный', hex: '#2ECC71', emoji: '🟢' },
  { label: '💜 Фиолетовый', hex: '#9B59B6', emoji: '🟣' },
  { label: '⭐ Золотой', hex: '#F1C40F', emoji: '🟡' },
  { label: '🖤 Чёрный',  hex: '#2C3E50', emoji: '⚫' },
  { label: '🤍 Белый',   hex: '#ECF0F1', emoji: '⚪' },
  { label: '💗 Розовый', hex: '#E91E63', emoji: '🩷' },
];

// ─── Константы ─────────────────────────────────────────────────────
const ITEMS_PER_PAGE = 20;
const BUTTONS_PER_ROW = 5;
export const CREATION_COST = 5000;
const COMMISSION_RATE = 0.4; // 40% создателю
const FLOW_TTL_MS = 15 * 60 * 1000;

function shopFlowKey(userId) {
  return `shop_flow:${userId}`;
}

function getShopFlow(userId) {
  return getEphemeral(shopFlowKey(userId));
}

function saveShopFlow(userId, flow) {
  setEphemeral(shopFlowKey(userId), {
    step: flow.step,
    color: flow.color ?? null,
    name: flow.name ?? null,
  }, FLOW_TTL_MS);
}

function clearShopFlow(userId) {
  deleteEphemeral(shopFlowKey(userId));
}

// ─── Хранилище пагинации ───────────────────────────────────────────
// Map<messageId, { page, totalPages, roles[] }>
const paginationCache = new Map();

// ===================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===================================================================

/**
 * Получает список ролей, доступных для продажи (в продаже + есть места).
 */
function getAvailableRoles(db) {
  return db
    .prepare(
      `SELECT * FROM custom_roles
       WHERE is_for_sale = 1 AND current_holders < max_holders
       ORDER BY price ASC`
    )
    .all();
}

/**
 * Строит Embed + кнопки для каталога ролей на указанной странице.
 */
function buildCatalogPage(roles, page = 0) {
  const start = page * ITEMS_PER_PAGE;
  const pageRoles = roles.slice(start, start + ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛒 Каталог ролей')
    .setDescription(`Всего активных лотов: **${roles.length}**`)
    .setFooter({
      text: `Страница ${page + 1} / ${Math.ceil(roles.length / ITEMS_PER_PAGE) || 1}`,
    })

  for (const role of pageRoles) {
    const remaining = role.max_holders - role.current_holders;
    embed.addFields({
      name: `${role.role_name} — **${role.price} ⚡HLD**`,
      value: `🎨 Цвет: \`${role.color_hex}\` | 👤 Осталось мест: **${remaining}/${role.max_holders}**`,
      inline: false,
    });
  }

  if (pageRoles.length === 0) {
    embed.setDescription('❌ Сейчас нет активных лотов. Создай первый!');
  }

  // Кнопки: до 5 в ряду. Последний ряд — навигация + меню (лимит Discord: 5 рядов).
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const role of pageRoles) {
    if (currentRow.components.length >= BUTTONS_PER_ROW) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_role_${role.id}`)
        .setLabel(`💰 ${role.price} HLD`)
        .setStyle(ButtonStyle.Success),
    );
  }
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  const totalPages = Math.ceil(roles.length / ITEMS_PER_PAGE) || 1;
  const navRow = new ActionRowBuilder();

  if (page > 0) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`catalog_page_${page - 1}`)
        .setLabel('⬅️ Назад')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId('shop_main_menu')
      .setLabel('🏠 Меню')
      .setStyle(ButtonStyle.Secondary)
  );

  if (page < totalPages - 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`catalog_page_${page + 1}`)
        .setLabel('➡️ Вперёд')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  rows.push(navRow);

  return { embed, components: rows };
}

/**
 * Строит главное меню магазина.
 */
function buildMainMenu() {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🛍 Магазин ⚡HLD')
    .setDescription(
      'Добро пожаловать в магазин сервера!\n\n' +
      '**💰 Валюта:** ⚡HLD\n' +
      '**🔹 Заработок:** Голосовые каналы (⏱ +⚡HLD/мин) и сообщения\n\n' +
      'Выбери категорию ниже:'
    )
    .addFields(
      {
        name: '🛒 Каталог ролей',
        value: 'Готовые роли, созданные участниками. Купи и носи!',
        inline: false,
      },
      {
        name: '➕ Создать свою роль',
        value: `Создай уникальную роль за **${CREATION_COST} ⚡HLD** и продавай её другим!`,
        inline: false,
      },
      {
        name: '⚡ Бусты (Усиления)',
        value: 'Временные ускорения: удвоенный XP, скидки и другое.',
        inline: false,
      }
    )
    .setFooter({ text: 'Используй /rank для просмотра уровня' })

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('catalog')
      .setLabel('🛒 Каталог ролей')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('create_role')
      .setLabel('➕ Создать свою роль')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('boosts')
      .setLabel('⚡ Бусты')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, components: [row1] };
}

// ===================================================================
// ФУНКЦИЯ ПОСТРОЕНИЯ КАРТОЧЕК БУСТОВ (ПОДРОБНЫЕ EMBED)
// ===================================================================

/**
 * Строит список Embed-ов для бустов — подробные карточки с эффектом,
 * длительностью, описанием, ценой и кнопкой "Купить".
 * Возвращает массив Embed и массив ActionRow.
 */
function buildBoostsMenu(db) {
  const boosts = db
    .prepare("SELECT * FROM shop_items WHERE type = 'boost' ORDER BY price ASC")
    .all();

  if (boosts.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x00d2ff)
      .setTitle('⚡ Бусты (Усиления)')
      .setDescription('❌ Бусты временно недоступны.')

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('shop_main_menu')
        .setLabel('🏠 Назад в меню')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
  }

  const allEmbeds = [];
  const allRows = [];
  let currentRow = new ActionRowBuilder();

  for (const boost of boosts) {
    // Определяем эффект из названия (формат "+X% к опыту" или "+X% к фарму монет")
    const xpMatch = boost.name.match(/\+(\d+)%\s*к\s*опыту/i);
    const coinMatch = boost.name.match(/\+(\d+)%\s*к\s*фарму\s*монет/i);
    let effectText = '';
    if (xpMatch) {
      effectText = `**+${xpMatch[1]}% к опыту**`;
    } else if (coinMatch) {
      effectText = `**+${coinMatch[1]}% к фарму монет**`;
    } else {
      effectText = boost.description || 'Усиление характеристик';
    }

    // Длительность
    const durationText = boost.duration_hours
      ? `Срок действия: **${boost.duration_hours} ч.**`
      : 'Срок действия: **♾ Бессрочно**';

    // Подробное описание (мелкий текст через `-# `)
    const detailedDesc = boost.description
      ? boost.description
      : 'Механика: Пока буст активен, каждое твоё сообщение или минута в голосе приносит увеличенное количество наград.';

    const embed = new EmbedBuilder()
      .setColor(0x00d2ff)
      .setTitle(`${boost.name || '⚡ Буст'}`)
      .addFields(
        { name: '⏱ Длительность', value: durationText, inline: true },
        { name: '✨ Эффект', value: effectText, inline: true },
        { name: '📖 Описание', value: `-# ${detailedDesc}`, inline: false },
        {
          name: '💰 Цена',
          value: `**${boost.price} ⚡HLD**\n📦 Осталось: ${boost.stock === -1 ? '♾️' : boost.stock}`,
          inline: false,
        }
      )

    allEmbeds.push(embed);

    if (currentRow.components.length >= 5) {
      allRows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_boost_${boost.item_id}`)
        .setLabel(`💰 ${boost.price} HLD`)
        .setStyle(ButtonStyle.Success),
    );
  }

  if (currentRow.components.length > 0 && currentRow.components.length < 5) {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId('shop_main_menu')
        .setLabel('🏠 Меню')
        .setStyle(ButtonStyle.Secondary),
    );
    allRows.push(currentRow);
  } else {
    if (currentRow.components.length > 0) allRows.push(currentRow);
    allRows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('shop_main_menu')
          .setLabel('🏠 Назад в меню')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  // Discord: максимум 10 embed и 5 рядов кнопок
  return {
    embeds: allEmbeds.slice(0, 10),
    components: allRows.slice(0, 5),
  };
}

// ===================================================================
// ОБРАБОТЧИКИ КНОПОК (вызываются из index.js)
// ===================================================================

/**
 * Главный диспетчер нажатий кнопок для магазина.
 */
export async function handleShopButton(interaction) {
  const { customId, user, member, guild } = interaction;
  const db = getDb();

  // ─── Навигация ─────────────────────────────────────────────────
  if (customId === 'shop_main_menu') {
    const { embed, components } = buildMainMenu();
    return interaction.update({ embeds: [embed], components });
  }

  if (customId === 'catalog') {
    const roles = getAvailableRoles(db);
    const { embed, components } = buildCatalogPage(roles, 0);

    // Кешируем для пагинации (по ID сообщения)
    if (interaction.message) {
      paginationCache.set(interaction.message.id, {
        roles,
        page: 0,
        totalPages: Math.ceil(roles.length / ITEMS_PER_PAGE) || 1,
      });

      // Очистка кеша через 10 минут
      setTimeout(() => paginationCache.delete(interaction.message.id), 600_000);
    }

    return interaction.update({ embeds: [embed], components });
  }

  // ─── Пагинация ─────────────────────────────────────────────────
  if (customId.startsWith('catalog_page_')) {
    const page = parseInt(customId.replace('catalog_page_', ''), 10);
    const roles = getAvailableRoles(db);
    const { embed, components } = buildCatalogPage(roles, page);

    if (interaction.message) {
      paginationCache.set(interaction.message.id, {
        roles,
        page,
        totalPages: Math.ceil(roles.length / ITEMS_PER_PAGE) || 1,
      });
    }

    return interaction.update({ embeds: [embed], components });
  }

  // ─── Покупка роли ──────────────────────────────────────────────
  if (customId.startsWith('buy_role_')) {
    const roleId = parseInt(customId.replace('buy_role_', ''), 10);
    return handleBuyRole(interaction, roleId);
  }

  // ─── Бусты ─────────────────────────────────────────────────────
  if (customId === 'boosts') {
    const { embeds, components } = buildBoostsMenu(db);
    return interaction.update({ embeds, components });
  }

  if (customId.startsWith('buy_boost_')) {
    const itemId = customId.replace('buy_boost_', '');
    return handleBuyBoost(interaction, itemId);
  }

  // ─── Мастер создания роли ──────────────────────────────────────
  if (customId === 'create_role') {
    return startCreationFlow(interaction);
  }

  if (customId === 'creation_pick_color') {
    // Показываем выбор цвета
    return showColorPicker(interaction);
  }

  if (customId.startsWith('creation_color_')) {
    const hex = customId.replace('creation_color_', '');
    return handleColorPick(interaction, hex);
  }

  if (customId === 'creation_confirm') {
    return handleCreationConfirm(interaction);
  }

  if (customId === 'creation_cancel') {
    return handleCreationCancel(interaction);
  }

  if (customId === 'creation_name') {
    return showNameModal(interaction);
  }

  if (customId === 'configure_sale') {
    return showSaleConfig(interaction);
  }

  if (customId.startsWith('sale_set_price_')) {
    const roleId = parseInt(customId.replace('sale_set_price_', ''), 10);
    return showPriceModal(interaction, roleId);
  }

  if (customId.startsWith('sale_activate_')) {
    const roleId = parseInt(customId.replace('sale_activate_', ''), 10);
    return activateSale(interaction, roleId);
  }

  if (customId.startsWith('sale_deactivate_')) {
    const roleId = parseInt(customId.replace('sale_deactivate_', ''), 10);
    return deactivateSale(interaction, roleId);
  }
}

// ===================================================================
// ПОКУПКА РОЛИ
// ===================================================================

async function handleBuyRole(interaction, roleDbId) {
  const { user, member, guild } = interaction;
  const db = getDb();

  // Получаем данные роли
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);
  if (!role) {
    return interaction.reply({
      content: '❌ Эта роль больше не существует.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка: в продаже ли
  if (!role.is_for_sale) {
    return interaction.reply({
      content: '❌ Эта роль снята с продажи.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка: есть ли места
  if (role.current_holders >= role.max_holders) {
    return interaction.reply({
      content: '❌ Все места заняты (макс. 10).',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка: не покупает ли создатель
  if (role.creator_id === user.id) {
    return interaction.reply({
      content: '❌ Ты не можешь купить собственную роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка: хватает ли ⚡HLD и фиксируем покупку атомарно
  let creatorProfit = 0;
  try {
    runInTransaction(() => {
      const hold = db.prepare(
        'UPDATE custom_roles SET current_holders = current_holders + 1 WHERE id = ? AND current_holders < max_holders AND is_for_sale = 1'
      ).run(roleDbId);
      if (hold.changes === 0) {
        throw new Error('SOLD_OUT');
      }
      if (!removeCoins(user.id, role.price, interaction.guildId)) {
        throw new Error('NO_FUNDS');
      }
      creatorProfit = Math.floor(role.price * COMMISSION_RATE);
      addCoins(role.creator_id, creatorProfit, interaction.guildId);
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply({
        content: `❌ Недостаточно ⚡HLD. Нужно: **${role.price} ⚡HLD**`,
        flags: MessageFlags.Ephemeral,
      });
    }
    if (err.message === 'SOLD_OUT') {
      return interaction.reply({
        content: '❌ Все места заняты (макс. 10).',
        flags: MessageFlags.Ephemeral,
      });
    }
    throw err;
  }

  try {
    const discordRole = guild.roles.cache.get(role.discord_role_id);
    if (!discordRole) {
      runInTransaction(() => {
        addCoins(user.id, role.price, interaction.guildId);
        db.prepare(
          'UPDATE custom_roles SET current_holders = MAX(current_holders - 1, 0) WHERE id = ?'
        ).run(roleDbId);
        if (creatorProfit > 0) removeCoins(role.creator_id, creatorProfit, interaction.guildId);
      });
      return interaction.reply({
        content: '❌ Ошибка: роль не найдена на сервере. Деньги возвращены.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await member.roles.add(discordRole);

    const updatedRole = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleDbId);
    const isFull = updatedRole.current_holders >= updatedRole.max_holders;

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Покупка совершена!')
      .setDescription(
        `Ты приобрёл роль **${role.role_name}** за **${role.price} ⚡HLD**\n\n` +
        `👤 Создатель получил **${creatorProfit} ⚡HLD** (40% комиссии)`
      )

    await interaction.reply({ embeds: [embed] });

    if (isFull) {
      try {
        const roles = getAvailableRoles(db);
        const { embed: catalogEmbed, components } = buildCatalogPage(roles, 0);
        await interaction.message.edit({ embeds: [catalogEmbed], components });
      } catch {
        // Если не удалось обновить — не критично
      }
    }

    console.log(
      `[SHOP] Покупка роли: ${user.tag} купил "${role.role_name}" за ${role.price} ⚡HLD, создатель ${role.creator_id} получил ${creatorProfit} ⚡HLD`
    );
  } catch (err) {
    runInTransaction(() => {
      addCoins(user.id, role.price, interaction.guildId);
      db.prepare(
        'UPDATE custom_roles SET current_holders = MAX(current_holders - 1, 0) WHERE id = ?'
      ).run(roleDbId);
      if (creatorProfit > 0) removeCoins(role.creator_id, creatorProfit, interaction.guildId);
    });
    console.error(`[SHOP] Ошибка покупки роли ${roleDbId}:`, err.message);
    return interaction.reply({
      content: `❌ Ошибка при выдаче роли. Деньги возвращены: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ===================================================================
// ПОКУПКА БУСТА
// ===================================================================

async function handleBuyBoost(interaction, itemId) {
  const { user } = interaction;
  const db = getDb();

  const item = db.prepare('SELECT * FROM shop_items WHERE item_id = ?').get(itemId);
  if (!item) {
    return interaction.reply({
      content: '❌ Этот буст больше не доступен.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Проверка стока
  if (item.stock !== -1) {
    const sold = db
      .prepare('SELECT COUNT(*) as cnt FROM inventory WHERE item_id = ?')
      .get(itemId).cnt;
    if (sold >= item.stock) {
      return interaction.reply({
        content: `❌ Буст \`${item.name}" распродан.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  const expiresAt = item.duration_hours
    ? new Date(Date.now() + item.duration_hours * 3600_000).toISOString()
    : null;

  let xpMultiplier = 1.0;
  let coinMultiplier = 1.0;
  if (item.duration_hours) {
    const pctMatch = item.name.match(/\+(\d+)%/);
    const nameLower = item.name.toLowerCase();
    if (pctMatch) {
      const pct = parseInt(pctMatch[1]);
      if (nameLower.includes('опыт') || nameLower.includes('xp')) {
        xpMultiplier = 1 + pct / 100;
      } else if (nameLower.includes('монет') || nameLower.includes('coin') || nameLower.includes('баланс') || nameLower.includes('фарм')) {
        coinMultiplier = 1 + pct / 100;
      } else {
        xpMultiplier = 1 + pct / 100;
        coinMultiplier = 1 + pct / 100;
      }
    }
  }

  try {
    runInTransaction(() => {
      if (!removeCoins(user.id, item.price, interaction.guildId)) {
        throw new Error('NO_FUNDS');
      }
      db.prepare(`
        INSERT INTO inventory (user_id, item_id, expires_at) VALUES (?, ?, ?)
      `).run(user.id, itemId, expiresAt);
      if (item.duration_hours) {
        db.prepare(`
          INSERT INTO active_boosts (user_id, boost_type, expires_at, xp_multiplier, coin_multiplier)
          VALUES (?, ?, ?, ?, ?)
        `).run(user.id, item.item_id, expiresAt, xpMultiplier, coinMultiplier);
      }
    });
  } catch (err) {
    if (err.message === 'NO_FUNDS') {
      return interaction.reply({
        content: `❌ Недостаточно ⚡HLD. Нужно: **${item.price} ⚡HLD**`,
        flags: MessageFlags.Ephemeral,
      });
    }
    throw err;
  }

  const embed = new EmbedBuilder()
    .setColor(0x00d2ff)
    .setTitle('✅ Буст активирован!')
    .setDescription(
      `Ты приобрёл **${item.name}** за **${item.price} ⚡HLD**\n` +
      (expiresAt ? `⏱ Истекает: <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>` : '♾ Бессрочно')
    )

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

// ===================================================================
// МАСТЕР СОЗДАНИЯ РОЛИ
// ===================================================================

async function startCreationFlow(interaction) {
  const db = getDb();

  // Проверка баланса
  const user = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
  if (!user || user.balance < CREATION_COST) {
    return interaction.reply({
      content: `❌ Создание роли стоит **${CREATION_COST} ⚡HLD**. У тебя недостаточно средств.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Инициализируем состояние
  saveShopFlow(interaction.user.id, { step: 'color', color: null, name: null });

  return showColorPicker(interaction);
}

async function showColorPicker(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎨 Шаг 1/3 — Выбери цвет роли')
    .setDescription('Выбери цвет из предложенных или нажми "Отмена".')
    .setFooter({ text: `Стоимость создания: ${CREATION_COST} ⚡HLD` })

  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < COLOR_PRESETS.length; i++) {
    const c = COLOR_PRESETS[i];
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`creation_color_${c.hex}`)
        .setLabel(`${c.emoji} ${c.label}`)
        .setStyle(ButtonStyle.Secondary)
    );

    if ((i + 1) % 4 === 0 || i === COLOR_PRESETS.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('creation_cancel')
        .setLabel('❌ Отмена')
        .setStyle(ButtonStyle.Danger)
    )
  );

  const reply = await interaction.reply({
    embeds: [embed],
    components: rows,
    flags: MessageFlags.Ephemeral,
  });

  // Сохраняем сообщение для обновления
  const flow = getShopFlow(interaction.user.id);
  if (flow) {
    saveShopFlow(interaction.user.id, flow);
  }
}

async function handleColorPick(interaction, hex) {
  const flow = getShopFlow(interaction.user.id);
  if (!flow) {
    return interaction.reply({
      content: '❌ Сессия создания истекла. Начни заново через `/shop`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  flow.color = hex;
  flow.step = 'name';
  saveShopFlow(interaction.user.id, flow);

  // Предлагаем ввести название
  const embed = new EmbedBuilder()
    .setColor(hex)
    .setTitle('✏️ Шаг 2/3 — Введи название роли')
    .setDescription('Нажми кнопку ниже, чтобы ввести название через модальное окно.')

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('creation_name')
      .setLabel('✏️ Ввести название')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('creation_cancel')
      .setLabel('❌ Отмена')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function showNameModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('creation_name_modal')
    .setTitle('Название роли');

  const nameInput = new TextInputBuilder()
    .setCustomId('role_name')
    .setLabel('Введи название роли (до 32 символов)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(32)
    .setPlaceholder('Например: Киберпанк, Неон, ...')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

  await interaction.showModal(modal);
}

/**
 * Обработчик модалки с названием роли.
 */
export async function handleCreationModal(interaction) {
  if (interaction.customId !== 'creation_name_modal') return;

  const name = interaction.fields.getTextInputValue('role_name');
  const flow = getShopFlow(interaction.user.id);
  if (!flow) {
    return interaction.reply({
      content: '❌ Сессия истекла. Начни заново через `/shop`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  flow.name = name;
  flow.step = 'confirm';
  saveShopFlow(interaction.user.id, flow);

  // Показываем подтверждение
  const embed = new EmbedBuilder()
    .setColor(flow.color)
    .setTitle('✅ Шаг 3/3 — Подтверждение')
    .setDescription('Проверь параметры будущей роли:')
    .addFields(
      { name: '🎨 Цвет', value: flow.color, inline: true },
      { name: '✏️ Название', value: flow.name, inline: true },
      {
        name: '💰 Стоимость',
        value: `${CREATION_COST} ⚡HLD (будет списано)`,
        inline: false,
      },
      {
        name: '⚠️ Внимание',
        value:
          'После создания ты сможешь настроить продажу роли ' +
          '(установить цену, включить/выключить продажу).',
        inline: false,
      }
    )
    .setFooter({ text: 'Подтверди создание или отмени' })

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('creation_confirm')
      .setLabel('✅ Подтвердить и создать')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('creation_cancel')
      .setLabel('❌ Отмена')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function handleCreationConfirm(interaction) {
  const flow = getShopFlow(interaction.user.id);
  if (!flow || !flow.color || !flow.name) {
    return interaction.reply({
      content: '❌ Сессия истекла. Начни заново через `/shop`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  let createdRole;

  try {
    createdRole = await interaction.guild.roles.create({
      name: flow.name,
      color: flow.color,
      reason: `Создание кастомной роли пользователем ${interaction.user.tag}`,
    });
  } catch (err) {
    clearShopFlow(interaction.user.id);
    console.error(`[SHOP] Ошибка создания роли:`, err.message);
    return interaction.reply({
      content: `❌ Ошибка при создании роли: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    runInTransaction(() => {
      if (!removeCoins(interaction.user.id, CREATION_COST, interaction.guildId)) {
        throw new Error('NO_FUNDS');
      }
      db.prepare(
        `INSERT INTO custom_roles (discord_role_id, creator_id, role_name, color_hex, price)
         VALUES (?, ?, ?, ?, ?)`
      ).run(createdRole.id, interaction.user.id, flow.name, flow.color, CREATION_COST);
    });
  } catch (err) {
    await createdRole.delete('Откат создания роли: ошибка списания или БД').catch(() => {});
    clearShopFlow(interaction.user.id);
    if (err.message === 'NO_FUNDS') {
      return interaction.reply({
        content: `❌ Недостаточно ⚡HLD. Нужно: **${CREATION_COST} ⚡HLD**`,
        flags: MessageFlags.Ephemeral,
      });
    }
    console.error(`[SHOP] Ошибка создания роли:`, err.message);
    return interaction.reply({
      content: `❌ Ошибка при создании роли: ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  clearShopFlow(interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(flow.color)
    .setTitle('🎉 Роль создана!')
    .setDescription(
      `Роль **${flow.name}** успешно создана!\n\n` +
      `💸 Списанo: **${CREATION_COST} ⚡HLD**\n` +
      `🎭 Роль: <@&${createdRole.id}>\n\n` +
      `Теперь настрой продажу, чтобы её увидели другие участники.`
    )

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('configure_sale')
      .setLabel('⚙️ Настроить продажу')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.update({ embeds: [embed], components: [row] });

  console.log(
    `[SHOP] Создана роль: ${flow.name} (${createdRole.id}) пользователем ${interaction.user.tag}`
  );
}

async function handleCreationCancel(interaction) {
  clearShopFlow(interaction.user.id);

  const { embed, components } = buildMainMenu();
  await interaction.update({ embeds: [embed], components });
}

// ===================================================================
// НАСТРОЙКА ПРОДАЖИ
// ===================================================================

async function showSaleConfig(interaction) {
  const db = getDb();

  // Ищем последнюю созданную роль пользователя (не в продаже)
  const role = db
    .prepare(
      `SELECT * FROM custom_roles
       WHERE creator_id = ? AND is_for_sale = 0
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(interaction.user.id);

  if (!role) {
    // Показываем все роли пользователя
    const userRoles = db
      .prepare(
        `SELECT * FROM custom_roles WHERE creator_id = ? ORDER BY created_at DESC`
      )
      .all(interaction.user.id);

    if (userRoles.length === 0) {
      return interaction.reply({
        content: '❌ У тебя нет созданных ролей. Создай через `/shop`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Показываем список ролей для настройки
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('⚙️ Настройка продажи ролей')
      .setDescription('Выбери роль для настройки:')

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('sale_select_role')
      .setPlaceholder('Выбери роль...');

    for (const r of userRoles) {
      const status = r.is_for_sale
        ? `🟢 Продаётся (${r.price} ⚡HLD, ${r.current_holders}/${r.max_holders})`
        : `🔴 Не продаётся`;
      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${r.role_name}`)
          .setDescription(status)
          .setValue(`sale_conf_${r.id}`)
      );
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }

  // Показываем настройки для последней созданной роли
  return showRoleConfig(interaction, role);
}

/**
 * Обработчик выбора роли из меню настройки продажи.
 */
export async function handleSaleSelect(interaction) {
  if (interaction.customId !== 'sale_select_role') return;

  const roleId = parseInt(interaction.values[0].replace('sale_conf_', ''), 10);
  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleId);

  if (!role) {
    return interaction.reply({
      content: '❌ Роль не найдена.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await showRoleConfig(interaction, role);
}

async function showRoleConfig(interaction, role) {
  const embed = new EmbedBuilder()
    .setColor(role.color_hex)
    .setTitle(`⚙️ Настройка: ${role.role_name}`)
    .addFields(
      { name: '🎨 Цвет', value: role.color_hex, inline: true },
      { name: '💰 Цена', value: `${role.price} ⚡HLD`, inline: true },
      {
        name: '📊 Статус',
        value: role.is_for_sale ? '🟢 Продаётся' : '🔴 Не продаётся',
        inline: true,
      },
      {
        name: '👥 Владельцы',
        value: `${role.current_holders}/${role.max_holders}`,
        inline: true,
      },
      { name: '🎭 Discord роль', value: `<@&${role.discord_role_id}>`, inline: false }
    )

  const rows = [];

  // Кнопки действий
  const actionRow = new ActionRowBuilder();

  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`sale_set_price_${role.id}`)
      .setLabel('💰 Установить цену')
      .setStyle(ButtonStyle.Primary)
  );

  if (role.is_for_sale) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`sale_deactivate_${role.id}`)
        .setLabel('🔴 Снять с продажи')
        .setStyle(ButtonStyle.Danger)
    );
  } else {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`sale_activate_${role.id}`)
        .setLabel('🟢 Выставить на продажу')
        .setStyle(ButtonStyle.Success)
    );
  }

  rows.push(actionRow);

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('shop_main_menu')
        .setLabel('🏠 Назад в меню')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  // Если это новый ответ (не update)
  if (interaction.isMessageComponent?.() && interaction.isStringSelectMenu?.()) {
    await interaction.update({ embeds: [embed], components: rows });
  } else {
    await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
  }
}

async function showPriceModal(interaction, roleId) {
  const modal = new ModalBuilder()
    .setCustomId(`sale_price_modal_${roleId}`)
    .setTitle('Установка цены');

  const priceInput = new TextInputBuilder()
    .setCustomId('sale_price')
    .setLabel('Цена в ⚡HLD (минимум 1000)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(7)
    .setPlaceholder('5000')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(priceInput));

  await interaction.showModal(modal);
}

/**
 * Обработчик модалки с ценой.
 */
export async function handleSalePriceModal(interaction) {
  if (!interaction.customId.startsWith('sale_price_modal_')) return;

  const roleId = parseInt(interaction.customId.replace('sale_price_modal_', ''), 10);
  const priceStr = interaction.fields.getTextInputValue('sale_price');
  const price = parseInt(priceStr, 10);

  if (isNaN(price) || price < 1000) {
    return interaction.reply({
      content: '❌ Цена должна быть не менее **1000 ⚡HLD**.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleId);
  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  db.prepare('UPDATE custom_roles SET price = ? WHERE id = ?').run(price, roleId);

  await interaction.reply({
    content: `✅ Цена обновлена: **${price} ⚡HLD**`,
    flags: MessageFlags.Ephemeral,
  });
}

async function activateSale(interaction, roleId) {
  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  db.prepare('UPDATE custom_roles SET is_for_sale = 1 WHERE id = ?').run(roleId);

  await interaction.reply({
    content: `✅ Роль **${role.role_name}** выставлена на продажу за **${role.price} ⚡HLD**!`,
    flags: MessageFlags.Ephemeral,
  });
}

async function deactivateSale(interaction, roleId) {
  const db = getDb();
  const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleId);

  if (!role || role.creator_id !== interaction.user.id) {
    return interaction.reply({
      content: '❌ Это не твоя роль.',
      flags: MessageFlags.Ephemeral,
    });
  }

  db.prepare('UPDATE custom_roles SET is_for_sale = 0 WHERE id = ?').run(roleId);

  await interaction.reply({
    content: `🔴 Роль **${role.role_name}** снята с продажи.`,
    flags: MessageFlags.Ephemeral,
  });
}

// ===================================================================
// КОМАНДА /SHOP
// ===================================================================

export default {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('🛍 Магазин ⚡HLD: роли, создание, бусты'),

  async execute(interaction) {
    const { embed, components } = buildMainMenu();
    await interaction.reply({ embeds: [embed], components });
  },
};

