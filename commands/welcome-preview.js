import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { getUserLevel } from '../utils/permissions.js';
import { replyFail } from '../utils/ui.js';
import { buildWelcomeMessagePayload } from '../modules/welcomeNPC.js';

function canPreview(interaction) {
  return Boolean(
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || getUserLevel(interaction.user.id, interaction.guild) >= 2,
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('welcome-preview')
    .setDescription('Предпросмотр приветственной картинки для новичков')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Чей аватар и имя показать (по умолчанию — вы)')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canPreview(interaction)) {
      return replyFail(interaction, 'Нужны права **Управление сервером** или уровень админа бота.');
    }

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild.members.cache.get(targetUser.id)
      ?? await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return replyFail(interaction, 'Участник не найден на этом сервере.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const payload = await buildWelcomeMessagePayload(member);

    if (!payload.files.length) {
      return interaction.editReply({
        content: '❌ Не удалось сгенерировать картинку. Проверь, установлен ли пакет `canvas`.',
      });
    }

    await interaction.editReply({
      content: `👁 **Предпросмотр** для ${member}\nТак выглядит сообщение: пинг + картинка + кнопка.`,
      files: payload.files,
      components: payload.components,
    });
  },
};
