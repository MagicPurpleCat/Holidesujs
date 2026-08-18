import {
  clearGuildConfigCache,
  getGuildConfig,
  initGuildConfig,
  suggestScaleOptimizations,
} from '../../utils/guildConfig.js';

/**
 * Совместимый фасад: весь конфиг теперь в utils/guildConfig.js (server_config).
 */
export class UniversalConfig {
  getConfig(guildId) {
    return getGuildConfig(guildId);
  }

  initGuildConfig(guildId, guildName = 'Unknown') {
    const config = initGuildConfig(guildId);
    console.log(`[INFO] [MAIN] [UNIVERSAL-CONFIG] Сервер ${guildId} (${guildName}): конфиг готов.`);
    return config;
  }

  async optimizeForScale(guildId, memberCount) {
    suggestScaleOptimizations(guildId, memberCount);
  }

  clearCache(guildId) {
    clearGuildConfigCache(guildId);
  }

  clearAllCache() {
    clearGuildConfigCache();
  }
}

export const universalConfig = new UniversalConfig();
export default universalConfig;
