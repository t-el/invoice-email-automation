/** Tiny structured logger: JSON lines in production, readable lines for demos. */
type Level = "debug" | "info" | "warn" | "error";
let format: "json" | "pretty" = (process.env.LOG_FORMAT as "json" | "pretty") ?? "json";
let silent = false;

export function configureLogger(opts: { format?: "json" | "pretty"; silent?: boolean }) {
  if (opts.format) format = opts.format;
  if (opts.silent !== undefined) silent = opts.silent;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (silent) return;
  const line =
    format === "json"
      ? JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
      : `${level.toUpperCase().padEnd(5)} ${msg} ${Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`.trimEnd();
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => write("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => write("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => write("error", m, f),
};
