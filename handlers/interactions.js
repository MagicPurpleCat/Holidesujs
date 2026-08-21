import { Events, MessageFlags } from 'discord.js';
import { getDb } from '../database.js';
import { getGuildConfig, commandFeatureKey } from '../utils/guildConfig.js';
import { logErr } from '../utils/botLog.js';
import { isPrimaryGuild } from '../utils/singleGuild.js';
import { handleAchievementsInteraction } from '../commands/achievements.js';
import { handleTopSelect } from '../commands/top.js';
import { handleProfileButtons, handleProfileModals, handleProfileSelectMenus } from '../commands/profile.js';
import {
  handleShopButton,
  handleCreationModal,
  handleSalePriceModal,
  handleSaleSelect,
} from '../commands/shop.js';
import {
  handleAdminPanelButtons,
  handleGrantModal,
  handleDeleteUserModal,
  handleUnverifyModal,
  handleGiveVerifyModal,
  handleEconomyModal,
  handleModerationModal,
} from '../commands/admin_panel.js';
import {
  handleRoomSettingsButtons,
  handleRoomAddMemberModal,
  handleRoomSettingsModal,
  handleRoomUserSelect,
  handleRoomRenameModal,
  handleRoomLimitModal,
  handleRoomBitrateModal,
} from '../commands/room-settings.js';
import {
  handleSetupInteraction,
  handleSetupModal,
} from '../commands/setup.js';
import { handleLogsPanelInteraction } from '../commands/logs.js';
import { handleRoleCreateModal } from '../commands/role.js';
import { buildSettingsMessage } from '../commands/settings.js';
import {
  handleVoiceChannelButtons,
  handleAddUserModal,
  handlePermissionsModal,
} from '../modules/voiceChannels.js';
import {
  handleRoleManagerButtons,
  handleColorModal,
  handleNameModal,
  handlePriceModal,
} from '../modules/roleManager.js';
import { handleVerificationButton, handleVerificationModal } from '../modules/verification.js';
import {
  handleMarriagePanelInteraction,
  handleMarriageModal,
} from '../commands/marry.js';
import {
  handleClanPanelInteraction,
  handleClanModal,
} from '../commands/clan.js';
import { handleBlackjackButton } from '../commands/casino.js';
import { handleTicketButton, handleTicketClose } from '../commands/ticket.js';
import { handleGiveawayButton } from '../commands/giveaway.js';
import { handleWelcomeReadyButton, handleWelcomeRoleModal } from '../modules/welcomeNPC.js';
import { handleSelfRoleSelect } from '../modules/selfRolesPanel.js';
import { handleVoicePanelButtons } from '../modules/voicePanel.js';
import { reportInteractionError, safeInteractionFallback } from '../utils/errorHandling.js';

export function createInteractionHandler(shardId, client) {
  return async function handleInteraction(interaction) {
    if (!interaction) return;

    if (interaction.guild?.id && !isPrimaryGuild(interaction.guild.id)) {
      if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Этот бот обслуживает только основной сервер.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      return;
    }

    let guildConfig = null;
    if (interaction.guild?.id) {
      try {
        guildConfig = getGuildConfig(interaction.guild.id);
      } catch (e) {
        logErr(shardId, 'CONFIG', `Ошибка getConfig для ${interaction.guild.id}: ${e.message}`);
      }
    }

    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        if (guildConfig && interaction.guild) {
          const feature = commandFeatureKey(interaction.commandName);
          if (feature && guildConfig.features?.[feature] === false) {
            return interaction.reply({
              content: `❌ Функция «${feature}» отключена на этом сервере.\nОбратитесь к администратору.`,
              flags: MessageFlags.Ephemeral,
            });
          }
        }

        await command.execute(interaction);
        return;
      }

      // Setup hub (su:…) — buttons / selects / modals / role & channel menus
      if (interaction.customId?.startsWith('su:')) {
        try {
          const handled = interaction.isModalSubmit()
            ? await handleSetupModal(interaction)
            : await handleSetupInteraction(interaction);
          if (handled) return;
        } catch (e) {
          logErr(shardId, 'SETUP', e.message);
        }
      }

      // Logs hub (lg:…)
      if (interaction.customId?.startsWith('lg:')) {
        try {
          const handled = await handleLogsPanelInteraction(interaction);
          if (handled) return;
        } catch (e) {
          logErr(shardId, 'LOGS', e.message);
        }
      }

      if (interaction.isButton()) {
        const customId = interaction.customId || '';

        if (customId.startsWith('cl:') || customId.startsWith('clan_war_')) {
          const handled = await handleClanPanelInteraction(interaction).catch((e) => {
            logErr(shardId, 'CLAN', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId === 'bj_hit' || customId === 'bj_stand') {
          const handled = await handleBlackjackButton(interaction).catch((e) => {
            logErr(shardId, 'BJ', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId === 'ticket_create') {
          const handled = await handleTicketButton(interaction).catch((e) => {
            logErr(shardId, 'TICKET', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId === 'ticket_close') {
          const handled = await handleTicketClose(interaction).catch((e) => {
            logErr(shardId, 'TICKET', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId.startsWith('giveaway_join:')) {
          const handled = await handleGiveawayButton(interaction).catch((e) => {
            logErr(shardId, 'GIVEAWAY', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId.startsWith('mr:') || customId.startsWith('marry_')) {
          const handled = await handleMarriagePanelInteraction(interaction).catch((e) => {
            logErr(shardId, 'MARRY', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId.startsWith('settings_toggle_')) {
          try {
            const db = getDb();
            const userId = interaction.user.id;
            const action = customId.replace('settings_toggle_', '');
            const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
            if (settings) {
              const updates = {
                marriage: 'allow_marriage_requests',
                relationship: 'show_relationship',
                dm: 'allow_dm_notifications',
                mentions: 'allow_profile_mentions',
              };
              const col = updates[action];
              if (col) {
                const newVal = settings[col] ? 0 : 1;
                db.prepare(`UPDATE user_settings SET ${col} = ? WHERE user_id = ?`).run(newVal, userId);
              }
            }
            await interaction.update(buildSettingsMessage(interaction.user.id, interaction.guildId, interaction));
          } catch (e) {
            logErr(shardId, 'SETTINGS', e.message);
          }
          return;
        }

        if (customId === 'welcome_ready') {
          const handled = await handleWelcomeReadyButton(interaction).catch(() => false);
          if (handled) return;
        }

        if (customId.startsWith('role_delete_')) {
          try {
            const roleId = parseInt(customId.replace('role_delete_', ''), 10);
            if (Number.isNaN(roleId)) {
              return interaction.reply({ content: '❌ Некорректный ID роли.', flags: MessageFlags.Ephemeral });
            }
            const db = getDb();
            const role = db.prepare('SELECT * FROM custom_roles WHERE id = ? AND creator_id = ?').get(roleId, interaction.user.id);
            if (!role) {
              return interaction.reply({ content: '❌ Это не твоя роль.', flags: MessageFlags.Ephemeral });
            }
            const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
            if (discordRole) await discordRole.delete('Удалено владельцем').catch(() => {});
            db.prepare('DELETE FROM custom_roles WHERE id = ?').run(roleId);
            await interaction.reply({ content: `✅ Роль **${role.role_name}** удалена.`, flags: MessageFlags.Ephemeral });
          } catch (e) {
            logErr(shardId, 'ROLE_DELETE', e.message);
          }
          return;
        }

        if (customId.startsWith('inventory_wear_')) {
          try {
            const roleId = parseInt(customId.replace('inventory_wear_', ''), 10);
            if (Number.isNaN(roleId)) return;
            const db = getDb();
            const role = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(roleId);
            if (!role) {
              return interaction.reply({ content: '❌ Роль не найдена.', flags: MessageFlags.Ephemeral });
            }
            if (role.creator_id !== interaction.user.id) {
              return interaction.reply({ content: '❌ Это не твоя роль.', flags: MessageFlags.Ephemeral });
            }
            const discordRole = interaction.guild.roles.cache.get(role.discord_role_id);
            if (discordRole) {
              await interaction.member.roles.add(discordRole);
              await interaction.reply({ content: `👕 Роль **${role.role_name}** надета!`, flags: MessageFlags.Ephemeral });
            } else {
              await interaction.reply({ content: '❌ Роль не найдена на сервере.', flags: MessageFlags.Ephemeral });
            }
          } catch (e) {
            logErr(shardId, 'INVENTORY', e.message);
          }
          return;
        }

        if (customId.startsWith('room_action_') || customId.startsWith('room_confirm_delete_') || customId.startsWith('room_cancel_delete_')) {
          await handleRoomSettingsButtons(interaction).catch((e) => logErr(shardId, 'ROOM_SETTINGS', e.message));
          return;
        }

        if (customId.startsWith('vc_') || customId.startsWith('add_member_') ||
            customId.startsWith('lock_room_') || customId.startsWith('delete_room_') ||
            customId.startsWith('settings_room_')) {
          await handleVoiceChannelButtons(interaction).catch((e) => logErr(shardId, 'VC', e.message));
          return;
        }

        if (customId.startsWith('rm_')) {
          const handled = await handleRoleManagerButtons(interaction).catch(() => false);
          if (handled) return;
        }

        if (customId === 'verification_start') {
          await handleVerificationButton(interaction).catch((e) => logErr(shardId, 'VERIFY', e.message));
          return;
        }

        if (customId.startsWith('ap_') || customId.startsWith('admin_') || customId.startsWith('ap:')) {
          const handled = await handleAdminPanelButtons(interaction).catch(() => false);
          if (handled !== false) return;
        }

        if (customId.startsWith('vp_')) {
          const handled = await handleVoicePanelButtons(interaction).catch(() => false);
          if (handled !== false) return;
        }

        if (customId.startsWith('ach_view:')) {
          const handled = await handleAchievementsInteraction(interaction).catch(() => false);
          if (handled) return;
        }

        const profileButtonHandled = await handleProfileButtons(interaction).catch(() => false);
        if (profileButtonHandled) return;

        await handleShopButton(interaction).catch((e) => logErr(shardId, 'SHOP', e.message));
        return;
      }

      if (interaction.isModalSubmit()) {
        const customId = interaction.customId || '';

        const profileModalHandled = await handleProfileModals(interaction).catch(() => false);
        if (profileModalHandled) return;

        if (customId === 'role_create_modal') {
          await handleRoleCreateModal(interaction).catch((e) => logErr(shardId, 'ROLE', e.message));
          return;
        }

        if (customId === 'welcome_role_modal') { await handleWelcomeRoleModal(interaction).catch(() => {}); return; }
        if (customId === 'creation_name_modal') { await handleCreationModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('sale_price_modal_')) { await handleSalePriceModal(interaction).catch(() => {}); return; }
        if (customId === 'verification_modal') { await handleVerificationModal(interaction).catch(() => {}); return; }
        if (customId === 'vc_add_user_modal') { await handleAddUserModal(interaction).catch(() => {}); return; }
        if (customId === 'vc_permissions_modal') { await handlePermissionsModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('rm_color_modal_')) { await handleColorModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('rm_name_modal_')) { await handleNameModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('rm_price_modal_')) { await handlePriceModal(interaction).catch(() => {}); return; }
        if (customId === 'ap_grant_modal') { await handleGrantModal(interaction).catch(() => {}); return; }
        if (customId === 'ap_delete_modal') { await handleDeleteUserModal(interaction).catch(() => {}); return; }
        if (customId === 'ap_unverify_modal') { await handleUnverifyModal(interaction).catch(() => {}); return; }
        if (customId === 'ap_give_verify_modal') { await handleGiveVerifyModal(interaction).catch(() => {}); return; }

        if (customId.startsWith('ap:modal:')) {
          const { handleAdminPanelModal } = await import('../commands/admin_panel.js');
          await handleAdminPanelModal(interaction).catch(() => {});
          return;
        }

        if (customId.startsWith('cl:modal:')) {
          const handled = await handleClanModal(interaction).catch((e) => {
            logErr(shardId, 'CLAN', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId.startsWith('mr:modal:')) {
          const handled = await handleMarriageModal(interaction).catch((e) => {
            logErr(shardId, 'MARRY', e.message);
            return false;
          });
          if (handled) return;
        }

        if ([
          'ap_add_balance_modal',
          'ap_remove_balance_modal',
          'ap_set_infinite_modal',
          'ap_clear_infinite_modal',
          'ap_add_xp_modal',
          'ap_remove_xp_modal',
        ].includes(customId)) { await handleEconomyModal(interaction).catch(() => {}); return; }

        if ([
          'ap_warn_modal',
          'ap_mute_modal',
          'ap_kick_modal',
          'ap_ban_modal',
          'ap_warns_modal',
        ].includes(customId)) { await handleModerationModal(interaction).catch(() => {}); return; }

        if (customId.startsWith('room_add_member_modal_')) { await handleRoomAddMemberModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('room_settings_modal_')) { await handleRoomSettingsModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('room_rename_modal_')) { await handleRoomRenameModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('room_limit_modal_')) { await handleRoomLimitModal(interaction).catch(() => {}); return; }
        if (customId.startsWith('room_bitrate_modal_')) { await handleRoomBitrateModal(interaction).catch(() => {}); return; }

        return;
      }

      if (interaction.isStringSelectMenu()) {
        const customId = interaction.customId || '';

        if (customId.startsWith('self_role:')) {
          const handled = await handleSelfRoleSelect(interaction).catch((e) => {
            logErr(shardId, 'SELF_ROLES', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId.startsWith('ach_cat:')) {
          const handled = await handleAchievementsInteraction(interaction).catch(() => false);
          if (handled) return;
        }

        const profileSelectHandled = await handleProfileSelectMenus(interaction).catch(() => false);
        if (profileSelectHandled) return;

        if (customId === 'top_select') {
          const topHandled = await handleTopSelect(interaction).catch(() => false);
          if (topHandled) return;
        }

        if (customId.startsWith('cl:')) {
          const handled = await handleClanPanelInteraction(interaction).catch((e) => {
            logErr(shardId, 'CLAN', e.message);
            return false;
          });
          if (handled) return;
        }

        if (customId === 'sale_select_role') {
          await handleSaleSelect(interaction).catch(() => {});
          return;
        }
        if (customId === 'ap_revoke_select' || customId === 'ap:revoke_select' || customId === 'ap:feature_select' || customId.startsWith('ap:grant_level:')) {
          await handleAdminPanelButtons(interaction).catch(() => {});
          return;
        }
        return;
      }

      if (interaction.isUserSelectMenu()) {
        const selectId = interaction.customId || '';
        if (selectId.startsWith('room_user_')) {
          await handleRoomUserSelect(interaction).catch((e) => logErr(shardId, 'ROOM_SETTINGS', e.message));
          return;
        }
        if (selectId.startsWith('ap:user:')) {
          await handleAdminPanelButtons(interaction).catch((e) => logErr(shardId, 'ADMIN', e.message));
          return;
        }
        if (selectId.startsWith('cl:')) {
          await handleClanPanelInteraction(interaction).catch((e) => logErr(shardId, 'CLAN', e.message));
          return;
        }
        if (selectId.startsWith('mr:')) {
          await handleMarriagePanelInteraction(interaction).catch((e) => logErr(shardId, 'MARRY', e.message));
        }
      }
    } catch (error) {
      await reportInteractionError({
        interaction,
        shardId,
        context: 'dispatcher_interactions.js',
        error,
      });
      await safeInteractionFallback(interaction, {
        text: 'Сервис временно недоступен, попробуйте позже.',
        ephemeral: true,
      });
    }
  };
}

export function registerInteractionHandler(client, shardId) {
  client.on(Events.InteractionCreate, createInteractionHandler(shardId, client));
}
