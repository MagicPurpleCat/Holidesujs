// === МОДУЛЬ: MARRY (Брак/Отношения) ===
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getDb, ensureUser } from '../database.js';
import { divorceUser } from '../modules/relationships.js';
import { COLOR } from '../utils/ui.js';

export default {
  data: new SlashCommandBuilder()
    .setName('marry')
    .setDescription('Предложение руки и сердца')
    .addUserOption((opt) =>
      opt.setName('пользователь')
        .setDescription('Кому ты хочешь предложить')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const target = interaction.options.getUser('пользователь');
      const userId = interaction.user.id;
      const db = getDb();

      // Проверка: нельзя жениться на себе
      if (target.id === userId) {
        return interaction.reply({
          content: '❌ Ты не можешь жениться на самом себе!',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Проверка: цель — не бот
      if (target.bot) {
        return interaction.reply({
          content: '❌ Нельзя жениться на боте!',
          flags: MessageFlags.Ephemeral,
        });
      }

      const g = interaction.guildId;
      ensureUser(userId, g);
      ensureUser(target.id, g);

      const user = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, userId);
      const targetUser = db.prepare('SELECT * FROM users WHERE guild_id = ? AND user_id = ?').get(g, target.id);

      // Проверка: не женат ли уже
      if (user.relationship_status === 'married') {
        return interaction.reply({
          content: '❌ Ты уже состоишь в браке! Сначала разведись.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (targetUser.relationship_status === 'married') {
        return interaction.reply({
          content: '❌ Этот пользователь уже состоит в браке.',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Проверка настроек приватности цели
      const targetSettings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(target.id);
      if (targetSettings && !targetSettings.allow_marriage_requests) {
        return interaction.reply({
          content: '❌ Этот пользователь запретил брачные предложения в настройках.',
          flags: MessageFlags.Ephemeral,
        });
      }

      // Создаём Embed с предложением
      const embed = new EmbedBuilder()
        .setColor(COLOR.pink)
        .setTitle('Предложение')
        .setDescription(
          `**${interaction.user.displayName}** предлагает руку **${target.displayName}**.\n` +
          '60 секунд, чтобы ответить.'
        )
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: 'Holidesu · marry' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`marry_accept_${userId}_${target.id}`)
          .setLabel('💞 Принять')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`marry_reject_${userId}_${target.id}`)
          .setLabel('💔 Отклонить')
          .setStyle(ButtonStyle.Danger),
      );

      await interaction.reply({ content: `<@${target.id}>`, embeds: [embed], components: [row] });

      // Авто-отмена через 60 секунд
      setTimeout(async () => {
        try {
          const message = await interaction.fetchReply().catch(() => null);
          if (message && message.editable) {
            const expiredEmbed = EmbedBuilder.from(embed)
              .setColor(0x808080)
              .setTitle('⏰ Предложение истекло')
              .setDescription('Время вышло. Предложение отклонено автоматически.');
            await message.edit({ embeds: [expiredEmbed], components: [] }).catch(() => {});
          }
        } catch { /* ignore */ }
      }, 60_000);

    } catch (error) {
      console.error('[MARRY] Ошибка:', error);
      await interaction.reply({
        content: '❌ Произошла ошибка при создании предложения.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};

export const divorceAlias = {
  data: new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('Расторгнуть брак и разделить семейный счёт'),

  async execute(interaction) {
    const result = divorceUser(interaction.user.id, interaction.guildId);
    if (!result.success) {
      const msg = result.reason === 'not_married'
        ? '❌ Ты не состоишь в браке.'
        : '❌ Не удалось расторгнуть брак.';
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    const mention = result.partnerId ? `<@${result.partnerId}>` : 'партнёра';
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('💔 Брак расторгнут')
      .setDescription(`<@${interaction.user.id}> разводится с ${mention}.`);

    await interaction.reply({ embeds: [embed] });
  },
};

