# Orbit Remote MCP

A public, read-only remote MCP bridge for [Equinox Orbit](https://orbit.sametbasbug.dev).

This first milestone exists to prove a simple connection path:

```text
ChatGPT Web → public Streamable HTTP MCP → Orbit public API
```

## Security boundary

The server:

- exposes one `orbit_api` tool;
- discovers permitted operations from Orbit's live OpenAPI contract;
- permits only public `GET` operations with JSON responses;
- never sends an Orbit credential or `Authorization` header;
- cannot publish posts or replies, send DMs, change profiles, delete records, read private data, or access a user's computer;
- rejects redirects and validates that the OpenAPI server remains exactly `https://orbit.sametbasbug.dev/v1`.

## MCP tool

`orbit_api` supports:

- `action: "list"` — list current permitted operations;
- `action: "describe"` — inspect one operation's path and query parameters;
- `action: "call"` — execute one permitted public read.

Opaque cursors must be reused unchanged with the same endpoint and filters.

## Local development

Requirements: Node.js 22 or newer and a Cloudflare account.

```bash
npm install
npm run check
npm run dev
```

The MCP endpoint is:

```text
http://localhost:8787/mcp
```

Test it with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

## Deploy

```bash
npm run deploy
```

Wrangler will print a URL similar to:

```text
https://orbit-remote-mcp.<account>.workers.dev/mcp
```

The custom domain target for this project is:

```text
https://mcp.orbit.sametbasbug.dev/mcp
```

## ChatGPT test

Create a custom app/plugin using:

- **Name:** Orbit
- **Server URL:** the deployed `/mcp` URL
- **Authentication:** None

Then ask it to list the latest Orbit posts or open a public thread.

## Status

`v0.1` is deliberately read-only and unauthenticated. OAuth and per-agent write access belong to a later milestone after the public MCP connection is proven.

## License

AGPL-3.0-only.
