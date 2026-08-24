# Security

## Secret handling

Credentials enter through root-owned systemd environment files or an approved secret manager, never source control. Services must not dump environment/configuration at startup. Tokens are renewable, retained only as long as required, and redacted before errors, logs, traces, database payloads, or alerts.

Recursive redaction is based on normalized keys (`authorization`, `api_key`, `access_token`, `refresh_token`, `client_secret`, `password`, `cookie`, `database_url`, etc.) and credential-pattern detection. URLs are sanitized for userinfo and sensitive query parameters. Account IDs are replaced with keyed/persistent pseudonyms when correlation is necessary.

## Network and access

Internal APIs and Streamlit bind to loopback. Remote dashboard access requires an authenticated TLS reverse proxy with CSRF/session protections. Mutating control endpoints require a separate constant-time-checked control credential and audit actor/reason. Better Stack and AI connections require TLS; database connections require verified TLS.

## Live enablement separation

Environment configuration, exact acknowledgement, manual sentinel, startup safety result, database/dashboard acknowledgement, and per-order checks are independent. No API can create the filesystem sentinel or modify the process environment. No migration seeds a live acknowledgement. Expiration/config hashes prevent stale authorization reuse.

## Data protection

Raw AI payloads may expose trading strategy/account context; store only what operations/audit require, with redaction and retention limits. Never store authorization headers. Encrypt backups and restrict database roles. Dashboard queries use a read-oriented role; migrations and runtime use separate least-privilege roles where practical.

Better Stack receives bounded audit summaries only. The exporter applies the
same recursive redaction as structured logs and omits raw account/broker IDs,
full candle arrays, and full model request/response payloads. Stable UUID event
and analysis/request/group correlation remains visible. Treat Better Stack
access and retention as sensitive operational metadata even though credentials
are excluded.

The Streamlit decision inspector displays the complete parsed model object only
after defensive size, shape, depth, and sensitive-key checks. It never renders
raw provider text or the full persisted model request. Model-input and analytics
candle/return/pivot arrays are reduced to bounded counts and boundary samples;
the exact redacted request remains identifiable by its SHA-256 hash. Audit
details are independently bounded and recursively redacted. Any malformed,
oversized, or sensitive parsed model document is rejected from display rather
than partially trusted.

## Supply chain

Pin direct/transitive dependencies in lockfiles, use deterministic installs, run
npm/pip audits and secret scans, review lifecycle scripts, and update
deliberately. The Python lock is resolved for Python 3.13 and must be regenerated
for another interpreter baseline. Build artifacts are produced by an
unprivileged user. Private certificates and token exports are ignored and
prohibited.

Git remotes must use credential-free SSH/HTTPS addresses. PATs belong only in a
protected credential store or ignored mode-`0600` environment file and must
never appear in remote URLs or command arguments. Any credential pasted into a
conversation, terminal output, log, commit, issue, or pull request is treated as
compromised and must be revoked before further use.

## Threats and mitigations

| Threat                 | Primary mitigations                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------ |
| prompt/model injection | model has no tools/authority; strict schema/codes; local semantic/risk checks        |
| credential leakage     | protected environment, recursive redaction, no config dumps, secret scans            |
| duplicate orders       | transaction intent, unique idempotency keys, broker labels, reconcile before retry   |
| stale/poisoned data    | timestamps, skew/freshness/completeness checks, reconnect flags, fail closed         |
| dashboard abuse        | loopback/auth proxy, control token, database audit, independent live gates           |
| dependency compromise  | lockfiles, audits, minimal dependencies, least privilege                             |
| log/database outage    | new live commands blocked when critical audit fails; reconciliation continues        |
| operator mode error    | explicit mode/account/endpoint matching, banners, default emergency stop/live denial |

## Reporting an exposure

Activate emergency stop, remove live enablement, revoke/rotate affected credentials, preserve redacted evidence, reconcile broker state from a trusted channel, assess database/log access, and document containment/recovery. Any value printed or committed is considered compromised.
