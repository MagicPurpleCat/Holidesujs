import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { getUserLevel } from '../utils/permissions.js';
import { replyFail } from '../utils/ui.js';
import {
  publishSelfRolesPanel,
  syncSelfRoleBindings,
  SELF_ROLES_CHANNEL_ID,
  readSelfRolesState,
} from '../modules/selfRolesPanel.js';
import { SELF_ROLE_GROUPS } from '../modules/selfRolesCatalog.js';

function canManage(interaction) {
  return Boolean(
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || getUserLevel(interaction.user.id, interaction.guild) >= 2,
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('self-roles')
    .setDescription('Панель самовыбираемых ролей для участников')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Опубликовать красивую панель ролей в канале #роли')
        .addChannelOption((opt) =>
          opt
            .setName('канал')
            .setDescription(`По умолчанию: ${SELF_ROLES_CHANNEL_ID}`)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Создать роли уведомлений на сервере (без публикации панели)'),
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Где опубликована панель и сколько ролей привязано'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return replyFail(interaction, 'Нужны права **Управление сервером** или уровень админа бота.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const state = readSelfRolesState(interaction.guildId);
      const roleCount = state?.bindings
        ? Object.values(state.bindings).reduce((n, m) => n + Object.keys(m).length, 0)
        : 0;

      if (!state?.bindings && !state?.message_id) {
        return interaction.reply({
          content: 'ℹ️ Роли не созданы. Запусти `/self-roles create` или `/self-roles setup`.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const lines = ['✅ **Статус ролей уведомлений**'];
      if (state.channel_id) lines.push(`📍 Канал панели: <#${state.channel_id}>`);
      if (state.message_id) lines.push(`💬 Сообщение панели: \`${state.message_id}\``);
      else lines.push('💬 Панель не опубликована — `/self-roles setup`');
      lines.push(`🎭 Привязано ролей: **${roleCount}**`);

      return interaction.reply({
        content: lines.join('\n'),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const { bindings, created } = await syncSelfRoleBindings(interaction.guild);
        const lines = SELF_ROLE_GROUPS[0].roles.map((def) => {
          const id = bindings.pings?.[def.key];
          return id ? `${def.name} → <@&${id}>` : `${def.name} → ❌ не привязана`;
        });

        await interaction.editReply({
          content: [
            created.length
              ? `✅ **Создано ролей: ${created.length}**`
              : '✅ **Роли уже существуют** — привязки обновлены.',
            '',
            ...lines,
            '',
            '_Роли пингов включены (mentionable). Для панели в канале: `/self-roles setup`._',
          ].join('\n'),
        });
      } catch (err) {
        await interaction.editReply({ content: `❌ ${err.message}` });
      }
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('канал');
    const channelId = channel?.id || SELF_ROLES_CHANNEL_ID;

    try {
      const { channel: target, bindings } = await publishSelfRolesPanel(interaction.guild, channelId);
      const roleCount = Object.values(bindings).reduce((n, m) => n + Object.keys(m).length, 0);
      await interaction.editReply({
        content: [
          '✅ **Панель ролей опубликована!**',
          `📍 ${target}`,
          `🎭 Создано/привязано ролей: **${roleCount}**`,
          '',
          'Участники выбирают роли через меню под картинкой.',
          '_Подними роль бота выше создаваемых ролей, если выдача не срабатывает._',
        ].join('\n'),
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ ${err.message}`,
      });
    }
  },
};
