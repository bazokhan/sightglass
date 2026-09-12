# Sightglass

**Application observability for developers who do not want an observability stack.**

Sightglass records only explicitly observed Node.js operations, with bounded business context, events, steps, database work, outbound dependencies, errors, distributed correlation, runtime health, and durable exact usage meters.

- Documentation and quickstart: [Sightglass documentation](https://sightglass-docs.vercel.app)
- Public documentation source: [bazokhan/sightglass-docs](https://github.com/bazokhan/sightglass-docs)
- Docker image: [`bazokhan/sightglass`](https://hub.docker.com/r/bazokhan/sightglass)
- SDKs: `@bazokhan/sightglass-core`, `@bazokhan/sightglass-express`, `@bazokhan/sightglass-fastify`, `@bazokhan/sightglass-nest`, `@bazokhan/sightglass-next`, and `@bazokhan/sightglass-prisma`

## Development

```bash
npm ci
npm run verify
```

Run the local server and dashboard:

```bash
docker compose up --build
```

Open `http://localhost:7777`. SQLite data is persisted in the `sightglass-data` volume.

## Releases

Consumer documentation is maintained only in the documentation repository. SDK versions are synchronized with Changesets, trusted npm publishing runs through GitHub Actions, and Docker images publish for `linux/amd64` and `linux/arm64`.

Node.js 22.13 or newer is required. Sightglass is MIT licensed.
