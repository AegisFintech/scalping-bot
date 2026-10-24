import path from "node:path";
export function storageServiceConfig({ root, node, runtime, logs, envFile }) {
  for (const value of [root, node, runtime, logs, envFile])
    if (!path.isAbsolute(value) || /[\s%\x00-\x1f]/.test(value))
      throw new Error("STORAGE_INSTALL_PATH_INVALID");
  return {
    logrotate: `${logs}/pm2/*.log {\n  weekly\n  maxsize 2M\n  rotate 7\n  maxage 7\n  missingok\n  notifempty\n  compress\n  delaycompress\n  copytruncate\n  su root root\n}\n`,
    service(command) {
      if (!["maintenance", "backup"].includes(command))
        throw new Error("STORAGE_INSTALL_COMMAND_INVALID");
      return `[Unit]\nDescription=Scalper local storage ${command}\nAfter=postgresql.service\n\n[Service]\nType=oneshot\nWorkingDirectory=${root}\nExecStart=${node} ${root}/scripts/storage-maintenance.mjs ${command} --runtime ${runtime} --logs ${logs}\nEnvironment=PYTHONDONTWRITEBYTECODE=1\nEnvironment=DOTENV_CONFIG_PATH=${envFile}\nUMask=0077\nNice=10\nTimeoutStartSec=600\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nReadWritePaths=${runtime} ${logs}\n`;
    },
  };
}
