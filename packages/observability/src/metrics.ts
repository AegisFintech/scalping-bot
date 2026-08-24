import { randomUUID } from "node:crypto";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

import type pg from "pg";
import { collectDefaultMetrics, Gauge, Registry } from "prom-client";

export interface MetricsCollectorOptions {
  readonly pool: pg.Pool;
  readonly instanceId: string;
  readonly service: string;
  readonly intervalSeconds?: number;
  readonly networkInterface?: string;
  readonly filesystemPath?: string;
  readonly cpuAlertPercent?: number;
  readonly memoryAlertPercent?: number;
  readonly diskFreeAlertPercent?: number;
}

interface CpuSample {
  readonly idle: number;
  readonly total: number;
}

function cpuSample(): CpuSample {
  return os.cpus().reduce(
    (aggregate, cpu) => {
      const total = Object.values(cpu.times).reduce(
        (sum, value) => sum + value,
        0,
      );
      return {
        idle: aggregate.idle + cpu.times.idle,
        total: aggregate.total + total,
      };
    },
    { idle: 0, total: 0 },
  );
}

async function network(
  interfaceName?: string,
): Promise<{ ingress: number; egress: number }> {
  const contents = await readFile("/proc/net/dev", "utf8");
  const rows = contents
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected =
    interfaceName === undefined || interfaceName === ""
      ? rows.filter((line) => !line.startsWith("lo:"))
      : rows.filter((line) => line.startsWith(`${interfaceName}:`));
  if (selected.length === 0) throw new Error("NETWORK_INTERFACE_NOT_FOUND");
  return selected.reduce(
    (total, line) => {
      const [, values] = line.split(":");
      const fields = values?.trim().split(/\s+/) ?? [];
      return {
        ingress: total.ingress + Number(fields[0] ?? 0),
        egress: total.egress + Number(fields[8] ?? 0),
      };
    },
    { ingress: 0, egress: 0 },
  );
}

async function swapUsed(): Promise<number> {
  const contents = await readFile("/proc/meminfo", "utf8");
  const values = new Map(
    contents.split("\n").map((line) => {
      const [key, value] = line.split(":");
      return [key, Number(value?.trim().split(/\s+/)[0] ?? 0) * 1024] as const;
    }),
  );
  return Math.max(
    0,
    (values.get("SwapTotal") ?? 0) - (values.get("SwapFree") ?? 0),
  );
}

export class MetricsCollector {
  readonly #options: MetricsCollectorOptions;
  readonly #registry = new Registry();
  readonly #cpu = new Gauge({
    name: "scalper_host_cpu_percent",
    help: "Host CPU percent",
    registers: [this.#registry],
  });
  readonly #memory = new Gauge({
    name: "scalper_host_memory_used_bytes",
    help: "Host memory used",
    registers: [this.#registry],
  });
  readonly #diskFree = new Gauge({
    name: "scalper_disk_available_bytes",
    help: "Disk bytes available",
    registers: [this.#registry],
  });
  readonly #networkIn = new Gauge({
    name: "scalper_network_ingress_bytes_total",
    help: "Network bytes received",
    registers: [this.#registry],
  });
  readonly #networkOut = new Gauge({
    name: "scalper_network_egress_bytes_total",
    help: "Network bytes sent",
    registers: [this.#registry],
  });
  #previousCpu = cpuSample();
  #previousProcessCpu = process.cpuUsage();
  #previousProcessTime = process.hrtime.bigint();
  #timer: NodeJS.Timeout | null = null;

  constructor(options: MetricsCollectorOptions) {
    this.#options = options;
    collectDefaultMetrics({
      register: this.#registry,
      prefix: "scalper_process_",
    });
  }

  start(): void {
    if (this.#timer !== null) return;
    const interval = Math.max(1, this.#options.intervalSeconds ?? 10) * 1_000;
    this.#timer = setInterval(
      () => void this.sample().catch(() => undefined),
      interval,
    );
    this.#timer.unref();
    void this.sample().catch(() => undefined);
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  metrics(): Promise<string> {
    return this.#registry.metrics();
  }

  async sample(): Promise<void> {
    const currentCpu = cpuSample();
    const totalDelta = currentCpu.total - this.#previousCpu.total;
    const idleDelta = currentCpu.idle - this.#previousCpu.idle;
    const cpuPercent =
      totalDelta <= 0 ? 0 : ((totalDelta - idleDelta) / totalDelta) * 100;
    this.#previousCpu = currentCpu;
    const memoryTotal = os.totalmem();
    const memoryAvailable = os.freemem();
    const memoryUsed = memoryTotal - memoryAvailable;
    const filesystem = await statfs(
      this.#options.filesystemPath ?? process.cwd(),
    );
    const diskAvailable = filesystem.bavail * filesystem.bsize;
    const diskTotal = filesystem.blocks * filesystem.bsize;
    const diskUsed = diskTotal - filesystem.bfree * filesystem.bsize;
    const networkTotals = await network(this.#options.networkInterface);
    const processNow = process.cpuUsage();
    const timeNow = process.hrtime.bigint();
    const processMicros =
      processNow.user -
      this.#previousProcessCpu.user +
      processNow.system -
      this.#previousProcessCpu.system;
    const elapsedMicros = Number(timeNow - this.#previousProcessTime) / 1_000;
    const processCpu =
      elapsedMicros <= 0 ? 0 : (processMicros / elapsedMicros) * 100;
    this.#previousProcessCpu = processNow;
    this.#previousProcessTime = timeNow;
    const processMemory = process.memoryUsage().rss;
    const load = os.loadavg();
    this.#cpu.set(cpuPercent);
    this.#memory.set(memoryUsed);
    this.#diskFree.set(diskAvailable);
    this.#networkIn.set(networkTotals.ingress);
    this.#networkOut.set(networkTotals.egress);
    await this.#options.pool.query(
      `INSERT INTO server_metrics
        (instance_id, captured_at, cpu_percent, load_1, load_5, load_15,
         memory_used_bytes, memory_available_bytes, swap_used_bytes,
         disk_used_bytes, disk_available_bytes, network_in_bytes, network_out_bytes,
         process_cpu_percent, process_memory_bytes)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        this.#options.instanceId,
        cpuPercent,
        load[0] ?? 0,
        load[1] ?? 0,
        load[2] ?? 0,
        memoryUsed,
        memoryAvailable,
        await swapUsed(),
        diskUsed,
        diskAvailable,
        networkTotals.ingress,
        networkTotals.egress,
        processCpu,
        processMemory,
      ],
    );
    await this.#heartbeat();
    const memoryPercent =
      memoryTotal === 0 ? 100 : (memoryUsed / memoryTotal) * 100;
    const diskFreePercent =
      diskTotal === 0 ? 0 : (diskAvailable / diskTotal) * 100;
    if (cpuPercent >= (this.#options.cpuAlertPercent ?? 90))
      await this.#alert("HIGH_CPU", cpuPercent);
    if (memoryPercent >= (this.#options.memoryAlertPercent ?? 90))
      await this.#alert("HIGH_MEMORY", memoryPercent);
    if (diskFreePercent <= (this.#options.diskFreeAlertPercent ?? 10))
      await this.#alert("LOW_DISK", diskFreePercent);
  }

  async #heartbeat(): Promise<void> {
    await this.#options.pool.query(
      `INSERT INTO service_health
        (id, service, instance_id, state, heartbeat_at, started_at)
       VALUES ($1, $2, $3, 'READY', now(), now())
       ON CONFLICT (service, instance_id)
       DO UPDATE SET state = 'READY', heartbeat_at = now()`,
      [randomUUID(), this.#options.service, this.#options.instanceId],
    );
  }

  async #alert(reason: string, value: number): Promise<void> {
    await this.#options.pool.query(
      `INSERT INTO audit_events
        (id, occurred_at, severity, service, instance_id, environment, trading_mode,
         event_name, outcome, reason_code, details)
       VALUES ($1, now(), 'warn', $2, $3, 'runtime', 'unknown',
               'server_threshold_alert', 'alert', $4, $5::jsonb)`,
      [
        randomUUID(),
        this.#options.service,
        this.#options.instanceId,
        reason,
        JSON.stringify({ value }),
      ],
    );
  }
}
