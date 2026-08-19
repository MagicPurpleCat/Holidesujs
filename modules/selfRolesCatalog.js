/** Каталог самовыбираемых ролей для панели #роли. */

export const SELF_ROLES_CHANNEL_ID = '1528854421797208134';

/**
 * @typedef {object} SelfRoleDef
 * @property {string} key
 * @property {string} name — отображаемое имя (с эмодзи)
 * @property {string} description — коротко (меню Discord, до 100 симв.)
 * @property {string} detail — полное объяснение для embed и баннера
 * @property {number} color — Discord color int
 */

/**
 * @typedef {object} SelfRoleGroup
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {number} max — 0 = без лимита, 1 = только одна роль
 * @property {SelfRoleDef[]} roles
 */

/** @type {SelfRoleGroup[]} */
export const SELF_ROLE_GROUPS = [
  {
    id: 'pings',
    label: '🔔 Уведомления',
    description: 'Выбери, о чём получать пинги — без лишнего спама',
    max: 0,
    roles: [
      {
        key: 'announce',
        name: '📢 Анонсы',
        description: 'Официальные новости: правила, решения админов, важные посты',
        summary: 'Правила сервера, решения админов и официальные объявления.',
        detail: 'Уведомляет о серьёзных изменениях на сервере: новые правила, важные решения команды, официальные объявления. Пинги редкие — только когда действительно нужно знать всем.',
        color: 0xF39C12,
      },
      {
        key: 'events',
        name: '🎉 События',
        description: 'Ивенты, конкурсы, совместные активности и розыгрыши',
        summary: 'Ивенты, конкурсы, совместные игры и активности сообщества.',
        detail: 'Напоминания о вечерах в голосе, конкурсах, совместных играх и праздниках на сервере. Если любишь участвовать в жизни сообщества — эта роль для тебя.',
        color: 0xE91E63,
      },
      {
        key: 'botnews',
        name: '🤖 Holidesu',
        description: 'Обновления бота: новые команды, экономика, сезоны',
        summary: 'Новости бота: команды, ⚡HLD, XP, сезоны и техработы.',
        detail: 'Новости от бота Holidesu: новые функции, изменения ⚡HLD и XP, сезонные ивенты и техработы. Полезно тем, кто активно пользуется командами и рейтингами.',
        color: 0xFF5733,
      },
    ],
  },
];

export function findRoleDef(groupId, roleKey) {
  const group = SELF_ROLE_GROUPS.find((g) => g.id === groupId);
  return group?.roles.find((r) => r.key === roleKey) || null;
}

export function allRoleKeysInGroup(groupId) {
  const group = SELF_ROLE_GROUPS.find((g) => g.id === groupId);
  return group?.roles.map((r) => r.key) || [];
}

/** Краткий текст для embed под картинкой (без дублирования баннера). */
export function buildSelfRolesGuideText() {
  const group = SELF_ROLE_GROUPS[0];
  if (!group) return '';

  const lines = group.roles.map((r) => `• ${r.name} — ${r.description}`);

  return [
    'Выбери в меню ниже, о чём получать пинги.',
    '',
    ...lines,
  ].join('\n');
}
