# Holidesu Bot — Discord-бот для сообщества

Стек: **Node.js 22.5+** • **discord.js v14** • **node:sqlite** • **dotenv** • опционально **canvas**

---

## Быстрый старт

### 1. Установка

```bash
npm install
```

При `npm start` бот проверяет модули: если нет `discord.js` или `dotenv` — ставит их сам. Нет `canvas` — предупреждение, профиль остаётся текстовым. База — встроенный `node:sqlite`.

### 2. Окружение

Скопируйте `.env.example` в `.env` и заполните токен и `CLIENT_ID`. ID каналов и ролей лучше задать командой `/setup`; переменные ниже — запасной вариант.

```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
FARM_RATE=10
OWNER_ID=
TRIGGER_CHANNEL_ID=
VOICE_CATEGORY_ID=
VERIFIED_ROLE_ID=
EXTRA_VERIFY_ROLES=
```

### 3. Команды и запуск

```bash
npm start
# или
node start.js
```

Slash-команды регистрируются при старте (отключить: `--no-register`). Для теста на одном сервере укажите `GUILD_ID`.

---

## Что умеет бот

- Экономика: `/баланс`, `/shop`, `/profile`, `/rank`, `/топ`, фарм в войсе
- Казино: `/casino daily|slot|coinflip` (ставка не больше 10 000; coinflip без VIP 1.2x)
- Кланы: `/clan create|invite|join|leave|deposit|bank|info|wars`
- Комнаты: вход в канал-триггер из `/setup`, панель `/room-settings`
- Репутация: `/реп` и `/rep` (не себе, кулдаун 1 час)
- Брак: `/marry`, `/divorce`
- Модерация: `/mod`, `/history` (для модов), `/панель`
- Настройка: `/setup` — владелец, админ-роли, каналы (логи, команды, мод, панель, триггер, категория, welcome)

---

## Структура

```
start.js                 # Запуск
bot.js                   # События и маршрутизация
database.js              # SQLite (node:sqlite)
register-commands.js     # Регистрация slash-команд
utils/guildConfig.js     # Конфиг сервера из /setup и .env
commands/                # Slash-команды
modules/                 # Голос, верификация, логи, welcome
```

Создание роли стоит **5000 ⚡HLD** и в `/shop`, и в `/role`.

---

## Безопасность

- Параметризованные SQL-запросы
- Иерархия ролей на kick/ban/mute
- Owner не может выдать уровень Owner другому
- `/history` только для модераторов

MIT
