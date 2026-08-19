// === МОДУЛЬ: ROLE (Личные роли — /role-create, /role-manage, /inventory, /hide) ===
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { getDb, ensureUser, removeCoins, addCoins } from '../database.js';
import { CREATION_COST } from './shop.js';

const ROLE_CREATION_COST = CREATION_COST;
const MAX_PERSONAL_ROLES = 1; // макс. 1 роль на пользователя

export default {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Личная роль: создать, надеть, скрыть')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Создать личную роль (модальное окно)')
    )
    .addSubcommand((sub) =>
      sub.setName('manage').setDescription('Управление своими ролями')
    )
    .addSubcommand((sub) =>
      sub.setName('inventory').setDescription('Показать инвентарь ролей')
    )
    .addSubcommand((sub) =>
      sub
        .setName('hide')
        .setDescription('Скрыть/показать личную роль')
        .addStringOption((opt) =>
          opt.setName('действие')
            .setDescription('hide — скрыть, show — показать')
            .setRequired(true)
            .addChoices(
              { name: '🙈 Скрыть', value: 'hide' },
              { name: '👀 Показать', value: 'show' }
            )
        )
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      const db = getDb();
      const userId = interaction.user.id;
      ensureUser(userId, interaction.guildId);

      if (sub === 'create') {
        return handleRoleCreate(interaction);
      } else if (sub === 'manage') {
        return handleRoleManage(interaction);
      } else if (sub === 'inventory') {
        return handleInventory(interaction);
      } else if (sub === 'hide') {
        return handleRoleHide(interaction);
      }
    } catch (error) {
      console.error('[ROLE] Ошибка:', error);
      await interaction.reply({
        content: '❌ Произошла ошибка при выполнении команды.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

// /role-create — открыть модалку
async function handleRoleCreate(interaction) {
  try {
    const db = getDb();
    const userId = interaction.user.id;

    // Проверка лимита: макс. 1 личная роль
    const existingRoles = db.prepare(
      `SELECT COUNT(*) as cnt FROM custom_roles WHERE creator_id = ?`
    ).get(userId);

    if (existingRoles.cnt >= MAX_PERSONAL_ROLES) {
      return interaction.reply({
        content: `❌ У тебя уже есть личная роль. Максимум: **${MAX_PERSONAL_ROLES}** роль. Используй /role manage для управления.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Проверка баланса
    const user = db.prepare('SELECT balance FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, userId);
    if (user.balance < ROLE_CREATION_COST) {
      return interaction.reply({
        content: `❌ Недостаточно ⚡HLD. Создание роли стоит **${ROLE_CREATION_COST} ⚡HLD**. У тебя: **${user.balance} ⚡HLD**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Модальное окно: название и цвет
    const modal = new ModalBuilder()
      .setCustomId('role_create_modal')
      .setTitle('🎭 Создание личной роли');

    const nameInput = new TextInputBuilder()
      .setCustomId('role_name')
      .setLabel('Название роли (до 32 символов)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(32)
      .setPlaceholder('Например: Киберпанк')
      .setRequired(true);

    const colorInput = new TextInputBuilder()
      .setCustomId('role_color')
      .setLabel('HEX-цвет (например #FF4500)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(4)
      .setMaxLength(7)
      .setPlaceholder('#5865F2')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(colorInput),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error('[ROLE CREATE]', error);
  }
}

// /role-manage — показать список личных ролей с кнопками
async function handleRoleManage(interaction) {
  try {
    const db = getDb();
    const userId = interaction.user.id;
    const roles = db.prepare(
      `SELECT * FROM custom_roles WHERE creator_id = ? ORDER BY created_at DESC`
    ).all(userId);

    if (roles.length === 0) {
      return interaction.reply({
        content: '❌ У тебя нет личных ролей. Создай через `/role create`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const embeds = roles.map((r) =>
      new EmbedBuilder()
        .setColor(r.color_hex || '#5865F2')
        .setTitle(`🎭 ${r.role_name}`)
        .addFields(
          { name: '🎨 Цвет', value: r.color_hex, inline: true },
          { name: '🎭 Роль', value: `<@&${r.discord_role_id}>`, inline: true },
          { name: '📊 Статус', value: r.is_for_sale ? '🟢 Продаётся' : '🔴 Не продаётся', inline: true },
        )
    );

    const rows = roles.map((r) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`role_delete_${r.id}`)
          .setLabel('🗑 Удалить')
          .setStyle(ButtonStyle.Danger),
      )
    );

    await interaction.reply({ embeds, components: rows, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('[ROLE MANAGE]', error);
  }
}

// /inventory — список всех ролей пользователя (купленных)
async function handleInventory(interaction) {
  try {
    const db = getDb();
    const member = interaction.member;
    const userId = interaction.user.id;

    // Роли, которые пользователь имеет через магазин (custom_roles)
    // Ищем роли, которые пользователь купил — note: inventory хранит shop_items,
    // а custom_roles — это роли. Для purchasedRoles используем проверку наличия роли на пользователе.
    const userRoleIds = member.roles.cache.map(r => r.id);
    let purchasedRoles = [];
    if (userRoleIds.length > 0) {
      purchasedRoles = db.prepare(`
        SELECT * FROM custom_roles
        WHERE creator_id = ? OR discord_role_id IN (${userRoleIds.map(() => '?').join(',')})
      `).all(userId, ...userRoleIds);
    } else {
      purchasedRoles = db.prepare(
        'SELECT * FROM custom_roles WHERE creator_id = ?',
      ).all(userId);
    }

    // Роли уровня
    const levelRoles = member.roles.cache.filter((r) =>
      r.tags?.botId === null || !r.tags?.botId
    ).filter((r) => r.name !== '@everyone');

    const seen = new Set();
    purchasedRoles = purchasedRoles.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎒 Инвентарь ролей')
      .setDescription(`Всего ролей на сервере: **${member.roles.cache.size - 1}**`)
      .addFields(
        {
          name: '🎭 Купленные роли',
          value: purchasedRoles.length > 0
            ? purchasedRoles.map((r) => `<@&${r.discord_role_id}> — **${r.role_name}**`).join('\n')
            : 'Нет купленных ролей.',
          inline: false,
        },
        {
          name: '📊 Всего ролей',
          value: `${member.roles.cache.size - 1} ролей (включая @everyone)`,
          inline: false,
        }
      )
      .setThumbnail(interaction.user.displayAvatarURL())

    const rows = [];
    let currentRow = new ActionRowBuilder();

    for (const role of purchasedRoles) {
      if (rows.length >= 5) break;
      const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
      if (discordRole && !member.roles.cache.has(role.discord_role_id)) {
        if (currentRow.components.length >= 5) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
          if (rows.length >= 5) break;
        }
        const label = `👕 ${role.role_name}`.slice(0, 80);
        currentRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`inventory_wear_${role.id}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Primary),
        );
      }
    }
    if (currentRow.components.length > 0 && rows.length < 5) {
      rows.push(currentRow);
    }

    await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('[INVENTORY]', error);
  }
}

// /hide — скрыть/показать личную роль
async function handleRoleHide(interaction) {
  try {
    const action = interaction.options.getString('действие');
    const db = getDb();
    const userId = interaction.user.id;
    const member = interaction.member;

    const role = db.prepare(
      `SELECT * FROM custom_roles WHERE creator_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(userId);

    if (!role) {
      return interaction.reply({
        content: '❌ У тебя нет личной роли.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
    if (!discordRole) {
      return interaction.reply({
        content: '❌ Роль не найдена на сервере.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'hide') {
      await member.roles.remove(discordRole);
      await interaction.reply({
        content: `🙈 Роль **${role.role_name}** скрыта. Используй \`/role hide show\` чтобы показать снова.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await member.roles.add(discordRole);
      await interaction.reply({
        content: `👀 Роль **${role.role_name}** теперь видна!`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error('[ROLE HIDE]', error);
    await interaction.reply({
      content: '❌ Ошибка при изменении видимости роли.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

export async function handleRoleCreateModal(interaction) {
  if (interaction.customId !== 'role_create_modal') return false;

  const name = interaction.fields.getTextInputValue('role_name').trim();
  const color = interaction.fields.getTextInputValue('role_color').trim();
  const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  if (!hexRegex.test(color)) {
    await interaction.reply({ content: '❌ Неверный HEX-код. Используй формат #RRGGBB.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const db = getDb();
  if (!removeCoins(interaction.user.id, ROLE_CREATION_COST, interaction.guildId)) {
    await interaction.reply({
      content: `❌ Недостаточно ⚡HLD. Нужно ${ROLE_CREATION_COST} ⚡HLD.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    const createdRole = await interaction.guild.roles.create({
      name,
      color,
      reason: `Создание личной роли пользователем ${interaction.user.tag}`,
    });
    db.prepare(
      `INSERT INTO custom_roles (discord_role_id, creator_id, role_name, color_hex, price) VALUES (?, ?, ?, ?, ?)`,
    ).run(createdRole.id, interaction.user.id, name, color, ROLE_CREATION_COST);
    await interaction.reply({
      content: `🎉 Роль **${name}** создана! <@&${createdRole.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    addCoins(interaction.user.id, ROLE_CREATION_COST, interaction.guildId);
    await interaction.reply({ content: `❌ Ошибка: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  return true;
}


