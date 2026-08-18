import { SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags } from 'discord.js';
import { getDb, ensureUser } from '../database.js';
import { buildVerificationEmbed } from '../modules/verification.js';

/**
 * ══════════════════════════════════════════════════════════════════
 * ВЕРИФИКАЦИЯ — КАПЧА ЧЕРЕЗ MODAL
 * ══════════════════════════════════════════════════════════════════
 *
 * Команда /verify setup [канал] — отправляет Embed с кнопкой
 * "✅ Пройти верификацию" в указанный канал (или текущий).
 * Команда /verify check <пользователь> — проверяет статус.
 */

export default {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('🔐 Система верификации')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('📨 Отправить Embed с кнопкой верификации в канал')
        .addChannelOption((opt) =>
          opt
            .setName('канал')
            .setDescription('Канал для отправки (по умолчанию текущий)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('🔍 Проверить статус верификации пользователя')
        .addUserOption((opt) =>
          opt.setName('пользователь').setDescription('Пользователь').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ─── /verify setup ──────────────────────────────────────────
    if (sub === 'setup') {
      // Только для администраторов
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: '❌ Только администраторы могут настраивать верификацию.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const targetChannel = interaction.options.getChannel('канал') || interaction.channel;

      // Проверяем, что канал — текстовый
      if (!targetChannel.isTextBased()) {
        return interaction.reply({
          content: '❌ Укажи текстовый канал.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const guildName = interaction.guild.name;
      const { embed, components, files } = buildVerificationEmbed(guildName);

      await targetChannel.send({ embeds: [embed], components, files });

      return interaction.reply({
        content: `✅ Embed верификации отправлен в ${targetChannel}!`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ─── /verify check ──────────────────────────────────────────
    if (sub === 'check') {
      const targetUser = interaction.options.getUser('пользователь');
      const db = getDb();
      ensureUser(targetUser.id, interaction.guildId);

      const user = db.prepare('SELECT is_verified FROM users WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(user?.is_verified ? 0x2ecc71 : 0xe74c3c)
        .setTitle('🔍 Статус верификации')
        .setDescription(
          user?.is_verified
            ? `✅ **${targetUser.displayName}** — верифицирован.`
            : `❌ **${targetUser.displayName}** — не верифицирован.`
        )

      return interaction.reply({ embeds: [embed] });
    }
  },
};

