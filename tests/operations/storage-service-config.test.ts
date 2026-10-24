import { describe, expect, it } from "vitest";
import { storageServiceConfig } from "../../scripts/storage-service-config.mjs";
const input = {
  root: "/opt/release",
  node: "/opt/node",
  runtime: "/var/lib/runtime",
  logs: "/var/lib/logs",
  envFile: "/etc/private.env",
};
describe("storage maintenance deployment", () => {
  it("uses explicit current paths and weekly rotation with bounded retention", () => {
    const config = storageServiceConfig(input);
    expect(config.logrotate).toContain("weekly");
    expect(config.logrotate).toContain("maxage 7");
    expect(config.logrotate).toContain("maxsize 2M");
    for (const command of ["maintenance", "backup"]) {
      expect(config.service(command)).toContain(
        "DOTENV_CONFIG_PATH=/etc/private.env",
      );
      expect(config.service(command)).toContain(
        "--runtime /var/lib/runtime --logs /var/lib/logs",
      );
    }
    expect(() => config.service("delete")).toThrow(
      "STORAGE_INSTALL_COMMAND_INVALID",
    );
  });
  it.each(["relative", "/space here", "/percent%h", "/line\nbreak"])(
    "rejects unsafe systemd path %s",
    (value) => {
      expect(() => storageServiceConfig({ ...input, envFile: value })).toThrow(
        "STORAGE_INSTALL_PATH_INVALID",
      );
    },
  );
});
