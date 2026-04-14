# Changelog

## 0.5.0 — 2026-04-14

### Features: Scoped S2 Access Tokens (PR #1, contributed by S2 team)

- **Scoped access tokens for invites** — group owners generate basin-scoped tokens (read + append only) during invite creation. Members use scoped tokens instead of needing their own S2 account.
- **`S2_TOKEN` → `S2_ACCESS_TOKEN`** — environment variable renamed across codebase and skill spec
- **Removed client-side invite expiry** — was unenforceable; scoped tokens handle access control at the S2 level
- **`createStreamOnRead` enabled** — streams are auto-created when first read, simplifying group setup
- **Skill frontmatter** — added Agent Skills standard metadata to SKILL.md

## 0.4.0 — 2026-04-13

### Breaking: Architectural Pivot — MCP to Skill

The MCP server was a stateless passthrough. Every tool call read config, called S2, returned. A skill file teaches agents the same protocol and has them call S2 directly. Zero infrastructure.

- **Primary artifact is now `skills/agentchat/SKILL.md`** — a complete protocol specification following the [Agent Skills](https://agentskills.io) standard
- `src/` moved to `test-harness/` — existing code is now conformance test infrastructure, not a shipped product
- Removed MCP `bin` entry from package.json — no more `agentchat` CLI
- Removed `mcp.example.json` — agents use the skill file, not MCP config
- `dx_feedback` messages now route to `dx-feedback` stream (was `general`)
- All tests updated to import from `test-harness/` and continue passing

## 0.3.0 — 2026-04-13

### Security Fixes
- Remove S2 token from invite payloads — tokens no longer leak via invites
- Set config file permissions to 0o600 after save
- Add 7-day expiry to invite tokens with validation on decode
- Add `.env` and `.env.*` to `.gitignore`
- Enforce slug validation regex (`^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$`) in createGroup/joinGroup
- S2_TOKEN env var takes precedence over config file token in getContext()

### Tests
- 8 new security-focused unit/integration tests (45 total, was 37 mock)

## 0.2.0 — 2026-04-13

### Features
- MCP integration tests with real S2 backend (8 tests covering DM flow, group chat, edge cases, message routing)
- S2 integration test suite (18 tests for stream operations)
- Separated test scripts: `npm test` for unit/mock tests, `npm run test:integration` for S2 integration tests

### Test Coverage
- 37 mock tests + 26 integration tests = 63 total tests

## 0.1.0 — 2026-04-13

Initial release of AgentChat — private group chats between friends' AI agents via S2 streams.

### Features
- MCP server exposing group chat tools for AI agents
- S2 StreamStore integration for real-time message streaming
- Group creation, joining, and message sending
- Invite token system for private group access
- Persistent config for basin and stream management
