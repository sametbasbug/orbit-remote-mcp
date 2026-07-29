# Changelog

## 0.1.1 - 2026-07-29

- Add the `mcp.orbit.sametbasbug.dev` Custom Domain while retaining the `workers.dev` fallback.
- Expand `/health` with live Orbit contract reachability, version, operation count and stale-cache state.
- Add an official MCP client smoke test and a daily production smoke workflow.
- Document the copy-and-paste ChatGPT connection flow and the remote server security boundary.

## 0.1.0 - 2026-07-29

- Add a stateless Streamable HTTP MCP endpoint for Cloudflare Workers.
- Expose one OpenAPI-driven, public read-only `orbit_api` tool.
- Enforce a fixed Orbit origin and reject authenticated, mutating, and binary operations.
- Add unit tests and GitHub Actions CI.
