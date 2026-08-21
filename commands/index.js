import balanceCmd from './balance.js';
import shopCmd from './shop.js';
import profileCmd from './profile.js';
import casinoCmd from './casino.js';
import clanCmd from './clan.js';
import verifyCmd from './verify.js';
import rankCmd from './rank.js';
import adminPanelCmd from './admin_panel.js';
import topCmd from './top.js';
import helpCmd, { helpAlias } from './help.js';
import marryCmd from './marry.js';
import roleCmd from './role.js';
import historyCmd from './history.js';
import settingsCmd from './settings.js';
import memeGenCmd from './meme-gen.js';
import setupCmd from './setup.js';
import roomSettingsCmd from './room-settings.js';
import logsCmd from './logs.js';
import moderationCmd from './moderation.js';
import repCmd, { repAlias } from './rep.js';
import payCmd from './pay.js';
import featuresCmd from './features.js';
import questsCmd from './quests.js';
import workCmd from './work.js';
import ticketCmd from './ticket.js';
import giveawayCmd from './giveaway.js';
import cosmeticsCmd, { cosmeticsAlias } from './cosmetics.js';
import seasonCmd from './season.js';
import serverStatsCmd from './server-stats.js';
import achievementsCmd from './achievements.js';
import welcomePreviewCmd from './welcome-preview.js';
import selfRolesCmd from './self-roles.js';
import minigames from './minigames.js';

export const allCommands = [
  balanceCmd, shopCmd, profileCmd, casinoCmd, clanCmd,
  verifyCmd, rankCmd,
  adminPanelCmd, topCmd, helpCmd, helpAlias,
  marryCmd, roleCmd, historyCmd, settingsCmd,
  memeGenCmd, setupCmd, roomSettingsCmd, logsCmd,
  moderationCmd, repCmd, repAlias, payCmd, featuresCmd,
  questsCmd, workCmd, ticketCmd, giveawayCmd,
  cosmeticsCmd, cosmeticsAlias, seasonCmd, serverStatsCmd, achievementsCmd, welcomePreviewCmd, selfRolesCmd,
  ...minigames,
];
