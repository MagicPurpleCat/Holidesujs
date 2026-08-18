import { buildRoomPanel } from '../commands/room-settings.js';

/**
 * Компактная панель комнаты. room — строка из user_voice_channels.
 */
function buildRoomControlPanel(room, voiceChannel) {
  if (!room || !voiceChannel) return [];
  return buildRoomPanel(room, voiceChannel).components;
}

export { buildRoomControlPanel, buildRoomPanel };
