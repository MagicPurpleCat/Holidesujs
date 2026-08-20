/**
 * Проверка версии Node.js при старте и автообновление через fnm / nvm / winget / choco.
 * После установки перезапускает start.js уже новым node.exe.
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';

const RELAUNCH_FLAG = 'HOLIDESU_NODE_ENSURED';

function parseVersion(version) {
  const clean = String(version).replace(/^v/, '').split('-')[0];
  const [major, minor, patch] = clean.split('.').map((n) => parseInt(n, 10) || 0);
  return { major, minor, patch };
}

function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

/** Минимальная версия из engines.node (например >=22.5.0). */
export function parseMinNodeVersion(range = '>=22.5.0') {
  const match = String(range).match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : '22.5.0';
}

export function nodeMeetsRequirement(current, minVersion) {
  return compareVersions(current, minVersion) >= 0;
}

function hasCommand(name) {
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`;
    execSync(cmd, { stdio: 'pipe', shell: true });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, cwd) {
  execSync(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
}

function getNodeVersion(nodePath) {
  const out = execSync(`"${nodePath}" -p "process.versions.node"`, {
    encoding: 'utf8',
    shell: true,
  });
  return out.trim();
}

function findSuitableNode(minVersion) {
  const candidates = new Set();

  if (process.execPath) candidates.add(process.execPath);

  if (hasCommand('fnm')) {
    try {
      const fnmNode = execSync('fnm which', { encoding: 'utf8', shell: true }).trim();
      if (fnmNode) candidates.add(fnmNode);
    } catch {
      /* ignore */
    }
  }

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (programFiles) candidates.add(path.join(programFiles, 'nodejs', 'node.exe'));
  if (programFilesX86) candidates.add(path.join(programFilesX86, 'nodejs', 'node.exe'));

  const nvmHome = process.env.NVM_HOME || path.join(process.env.APPDATA || '', 'nvm');
  if (fs.existsSync(nvmHome)) {
    try {
      for (const entry of fs.readdirSync(nvmHome)) {
        if (entry.startsWith('v')) {
          candidates.add(path.join(nvmHome, entry, 'node.exe'));
        }
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const whereCmd = process.platform === 'win32' ? 'where node' : 'which -a node';
    const lines = execSync(whereCmd, { encoding: 'utf8', shell: true })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    for (const line of lines) candidates.add(line.trim());
  } catch {
    /* ignore */
  }

  let best = null;
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      const version = getNodeVersion(candidate);
      if (!nodeMeetsRequirement(version, minVersion)) continue;
      if (!best || compareVersions(version, best.version) > 0) {
        best = { path: candidate, version };
      }
    } catch {
      /* ignore broken binary */
    }
  }

  return best;
}

function tryInstallNode(minVersion, log) {
  const major = parseVersion(minVersion).major;

  if (hasCommand('fnm')) {
    log(`Ставлю Node.js ${minVersion} через fnm...`, 'yellow');
    runCommand(`fnm install ${minVersion}`);
    runCommand(`fnm use ${minVersion}`);
    return true;
  }

  if (hasCommand('nvm')) {
    log(`Ставлю Node.js ${minVersion} через nvm...`, 'yellow');
    runCommand(`nvm install ${minVersion}`);
    runCommand(`nvm use ${minVersion}`);
    return true;
  }

  if (process.platform === 'win32' && hasCommand('winget')) {
    log(`Ставлю Node.js через winget (нужно >= ${minVersion})...`, 'yellow');
    runCommand(
      'winget install -e --id OpenJS.NodeJS.LTS '
      + '--accept-package-agreements --accept-source-agreements --silent',
    );
    return true;
  }

  if (hasCommand('choco')) {
    log(`Ставлю Node.js LTS через Chocolatey (нужно >= ${minVersion})...`, 'yellow');
    runCommand('choco upgrade nodejs-lts -y');
    return true;
  }

  if (process.platform !== 'win32' && hasCommand('brew')) {
    log(`Ставлю Node.js ${major} через Homebrew...`, 'yellow');
    runCommand(`brew install node@${major} || brew upgrade node`);
    return true;
  }

  return false;
}

function relaunchNode(nodePath, startScript, extraArgs, projectRoot) {
  const child = spawn(
    nodePath,
    [startScript, ...extraArgs],
    {
      stdio: 'inherit',
      cwd: projectRoot,
      env: { ...process.env, [RELAUNCH_FLAG]: '1' },
      shell: false,
    },
  );

  child.on('error', (err) => {
    console.error(`[START] Не удалось перезапустить через ${nodePath}: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function isContainerRuntime() {
  try {
    if (process.env.HOLIDESU_SKIP_NODE_ENSURE === '1') return true;
    if (process.env.DOCKER === '1' || process.env.container) return true;
    if (process.env.KUBERNETES_SERVICE_HOST) return true;
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * @param {object} options
 * @param {string} options.projectRoot
 * @param {string} options.startScript — абсолютный путь к start.js
 * @param {string[]} options.argv — аргументы после node start.js
 * @param {(msg: string, level?: 'cyan'|'green'|'yellow'|'red') => void} options.log
 * @returns {boolean} true — можно продолжать текущим процессом
 */
export function ensureNodeVersion({ projectRoot, startScript, argv = [], log }) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const minVersion = parseMinNodeVersion(pkg.engines?.node);
  const current = process.versions.node;

  if (nodeMeetsRequirement(current, minVersion)) {
    log(`Node.js ${current} — подходит (нужно >= ${minVersion})`, 'green');
    return true;
  }

  // В Docker/K8s нельзя ставить Node через winget/choco — не валим контейнер в restart loop
  if (isContainerRuntime()) {
    log(
      `Node.js ${current} < ${minVersion}, но автообновление в контейнере отключено. `
        + 'Собери образ на Node >= 22.5 (node:sqlite). Продолжаю запуск…',
      'yellow',
    );
    return true;
  }

  if (process.env[RELAUNCH_FLAG] === '1') {
    log(
      `Node.js ${current} всё ещё ниже ${minVersion} после автообновления.`,
      'red',
    );
    log(
      `Установи Node.js ${minVersion}+ вручную: https://nodejs.org/ `
      + 'или через fnm / nvm / winget, затем перезапусти бота.',
      'red',
    );
    process.exit(1);
  }

  log(
    `Node.js ${current} устарел — нужен >= ${minVersion}. Пробую обновить автоматически...`,
    'yellow',
  );

  const installed = tryInstallNode(minVersion, log);
  if (!installed) {
    log(
      `Автообновление недоступно (нет fnm, nvm, winget или choco). `
      + `Установи Node.js ${minVersion}+: https://nodejs.org/`,
      'red',
    );
    process.exit(1);
  }

  const suitable = findSuitableNode(minVersion);
  if (!suitable) {
    log(
      `Node.js установлен, но подходящий node.exe не найден. `
      + `Перезапусти терминал и снова выполни npm start.`,
      'yellow',
    );
    process.exit(0);
  }

  if (suitable.path === process.execPath && suitable.version === current) {
    log(
      `Установка завершена, но текущий процесс всё ещё на ${current}. `
      + `Перезапусти терминал и снова выполни npm start.`,
      'yellow',
    );
    process.exit(0);
  }

  log(`Перезапуск через Node.js ${suitable.version} (${suitable.path})...`, 'cyan');
  relaunchNode(suitable.path, startScript, argv, projectRoot);
  return false;
}
