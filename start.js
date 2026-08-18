/**
 * Локальный запуск бота:
 * 1. Проверяет наличие npm-модулей (при необходимости ставит их)
 * 2. Проверяет .env (создаёт из .env.example, если нет)
 * 3. Регистрирует slash-команды (отключить: --no-register)
 * 4. Запускает bot.js
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '.');
const require = createRequire(import.meta.url);

const COLOR_RESET = '\x1b[0m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_RED = '\x1b[31m';

function log(msg, color = COLOR_CYAN) {
  console.log(`${color}[START]${COLOR_RESET} ${msg}`);
}

function canLoad(name) {
  try {
    require(name);
    return true;
  } catch {
    return false;
  }
}

function npmInstall(packages = []) {
  const args = packages.length > 0
    ? `npm install ${packages.join(' ')} --no-audit --no-fund --foreground-scripts`
    : 'npm install --no-audit --no-fund --foreground-scripts';
  log(`Установка: ${args}`, COLOR_YELLOW);
  execSync(args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'false',
    },
  });
}

function ensureModules() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const engines = pkg.engines?.node || '>=22.5.0';
  const required = Object.keys(pkg.dependencies || {});
  const optional = Object.keys(pkg.optionalDependencies || {});

  if (!canLoad('node:sqlite')) {
    log(
      `Нужен Node.js ${engines} со встроенным node:sqlite. Сейчас: ${process.versions.node}`,
      COLOR_RED,
    );
    process.exit(1);
  }
  log(`Node.js ${process.versions.node}, node:sqlite — ок`, COLOR_GREEN);

  let missingRequired = required.filter((name) => !canLoad(name));
  let missingOptional = optional.filter((name) => !canLoad(name));

  if (missingRequired.length > 0 || missingOptional.length > 0) {
    const allMissing = [...missingRequired, ...missingOptional];
    log(`Нет модулей: ${allMissing.join(', ')}. Устанавливаю...`, COLOR_YELLOW);
    try {
      npmInstall();
    } catch (err) {
      log(`npm install не удался: ${err.message}`, COLOR_RED);
      if (missingRequired.length > 0) process.exit(1);
    }

    missingRequired = required.filter((name) => !canLoad(name));
    missingOptional = optional.filter((name) => !canLoad(name));

    if (missingRequired.length > 0 || missingOptional.length > 0) {
      const stillMissing = [...missingRequired, ...missingOptional];
      try {
        npmInstall(stillMissing);
      } catch (err) {
        log(`Не удалось поставить ${stillMissing.join(', ')}: ${err.message}`, COLOR_YELLOW);
      }
      missingRequired = required.filter((name) => !canLoad(name));
      missingOptional = optional.filter((name) => !canLoad(name));
    }
  }

  if (missingRequired.length > 0) {
    log(`Обязательные модули не установлены: ${missingRequired.join(', ')}.`, COLOR_RED);
    log('Выполни вручную: npm install', COLOR_RED);
    process.exit(1);
  }

  for (const name of required) {
    log(`${name} — установлен`, COLOR_GREEN);
  }

  for (const name of optional) {
    if (missingOptional.includes(name)) {
      log(`${name} — не установился. Профиль будет текстовым.`, COLOR_YELLOW);
    } else {
      log(`${name} — установлен`, COLOR_GREEN);
    }
  }
}

function ensureEnvFile() {
  const envPath = path.join(projectRoot, '.env');
  const examplePath = path.join(projectRoot, '.env.example');

  if (fs.existsSync(envPath)) {
    log('.env найден.', COLOR_GREEN);
    return;
  }

  if (fs.existsSync(examplePath)) {
    let content = fs.readFileSync(examplePath, 'utf8');
    content = content
      .replace(/ваш_токен_сюда/gi, '')
      .replace(/ваш_client_id_сюда/gi, '')
      .replace(/id_вашего_сервера/gi, '');
    fs.writeFileSync(envPath, content, 'utf8');
    log('Создан .env из .env.example. Заполни DISCORD_TOKEN и CLIENT_ID.', COLOR_YELLOW);
    return;
  }

  fs.writeFileSync(
    envPath,
    '# Токен бота\nDISCORD_TOKEN=\nCLIENT_ID=\nGUILD_ID=\nFARM_RATE=10\n',
    'utf8',
  );
  log('Создан минимальный .env. Заполни DISCORD_TOKEN и CLIENT_ID.', COLOR_YELLOW);
}

function shouldRegister() {
  return !process.argv.slice(2).includes('--no-register');
}

async function registerCommands() {
  log('Регистрация slash-команд...', COLOR_CYAN);
  try {
    const { registerCommands: doRegister } = await import('./register-commands.js');
    const result = await doRegister();
    log(`Регистрация команд завершена: ${result.count} команд (${result.scope}).`, COLOR_GREEN);
  } catch (e) {
    log(`Ошибка при регистрации команд: ${e.message}`, COLOR_RED);
    log('Продолжаю запуск без регистрации...', COLOR_YELLOW);
  }
}

async function main() {
  console.log('═════════════════════════════════════════════════');
  console.log('  Holidesu Bot');
  console.log('═════════════════════════════════════════════════');

  ensureModules();
  ensureEnvFile();

  if (shouldRegister()) {
    await registerCommands();
  }

  log('Запуск бота...', COLOR_GREEN);
  return import('./bot.js');
}

main().catch((err) => {
  console.error(`${COLOR_RED}[START][FATAL]${COLOR_RESET} ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

export default main;
