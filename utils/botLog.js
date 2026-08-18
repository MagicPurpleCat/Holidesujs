function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

export function logTs() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function logInfo(shardId, module, msg, ...args) {
  const s = shardId !== undefined && shardId !== null ? `SHARD #${shardId}` : 'MAIN';
  console.log(`[${logTs()}] [INFO] [${s}] [${module}] ${msg}`, ...args);
}

export function logWarn(shardId, module, msg, ...args) {
  const s = shardId !== undefined && shardId !== null ? `SHARD #${shardId}` : 'MAIN';
  console.warn(`[${logTs()}] [WARN] [${s}] [${module}] ${msg}`, ...args);
}

export function logErr(shardId, module, msg, ...args) {
  const s = shardId !== undefined && shardId !== null ? `SHARD #${shardId}` : 'MAIN';
  console.error(`[${logTs()}] [ERROR] [${s}] [${module}] ${msg}`, ...args);
}

export function logFatal(module, msg, ...args) {
  console.error(`[${logTs()}] [FATAL] [MAIN] [${module}] ${msg}`, ...args);
}
