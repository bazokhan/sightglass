# Sightglass

**Application observability for developers who do not want an observability stack.**

Sightglass records only explicitly observed Node.js operations, with bounded business context, events, steps, database work, outbound dependencies, errors, distributed correlation, runtime health, and durable exact usage meters.

- Documentation and quickstart: [Sightglass documentation](https://sightglass-docs.trugraph.io)
- Public documentation source: [bazokhan/sightglass-docs](https://github.com/bazokhan/sightglass-docs)
- Docker image: [`bazokhan/sightglass`](https://hub.docker.com/r/bazokhan/sightglass)
- SDKs: [`@bazokhan/sightglass-core`](https://www.npmjs.com/package/@bazokhan/sightglass-core), [`@bazokhan/sightglass-express`](https://www.npmjs.com/package/@bazokhan/sightglass-express), [`@bazokhan/sightglass-fastify`](https://www.npmjs.com/package/@bazokhan/sightglass-fastify), [`@bazokhan/sightglass-nest`](https://www.npmjs.com/package/@bazokhan/sightglass-nest), [`@bazokhan/sightglass-next`](https://www.npmjs.com/package/@bazokhan/sightglass-next), and [`@bazokhan/sightglass-prisma`](https://www.npmjs.com/package/@bazokhan/sightglass-prisma)

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

On first start, open the container logs and follow the one-time administrator setup link. The link expires after 24 hours; regenerate it with:

```bash
docker compose run --rm sightglass node apps/server/dist/cli.js setup-link
```

## Coolify

Create a **Docker Compose Empty** service, paste [`coolify-compose.yml`](./coolify-compose.yml), and click Deploy. Coolify supplies the public HTTPS URL, installation secret, health check, and persistent data volume.

After the first deployment:

1. Open the deployment logs and follow the one-time administrator setup link.
2. Create an ingestion key under **Settings → Keys** and copy it immediately; only its hash is retained.
3. Configure the SDK with the Coolify service URL and that ingestion key.
4. Configure SMTP if you want invitations, password resets, and alert email.

Keep the `/data` volume when redeploying or changing image versions. Sightglass is a single-instance SQLite service, so leave the replica count at one.

## Operations

The administration screen manages users, SMTP, fixed email alerts, ingestion keys, automatic SQLite snapshots, optional S3-compatible backup upload, and update checks. Sightglass remains a single-container SQLite service and must not run multiple replicas against the same volume.

The first account is always an administrator. Administrators can invite users by email or create an account with a temporary password. Dashboard and export endpoints require a signed-in session; ingestion uses separately revocable bearer keys. `SIGHTGLASS_API_KEY` remains available only as a migration-compatible static ingestion key.

Offline backup verification and restore are available through the image:

```bash
docker compose run --rm sightglass node apps/server/dist/cli.js backup /data/backups/manual.sqlite
docker compose run --rm sightglass node apps/server/dist/cli.js verify-backup /data/backups/manual.sqlite
docker compose stop sightglass
docker compose run --rm sightglass node apps/server/dist/cli.js restore /data/backups/manual.sqlite
docker compose start sightglass
```

For non-local deployments, terminate HTTPS at a trusted reverse proxy, set `SIGHTGLASS_PUBLIC_URL` to the public origin, set `SIGHTGLASS_TRUST_PROXY=true`, and provide a stable `SIGHTGLASS_SECRET`. If no secret is provided, one is generated under `/data/.secret`.

The stable secret protects stored SMTP and object-storage credentials. Back up `/data/.secret` with the database if you do not supply `SIGHTGLASS_SECRET` explicitly.

The image-only production template is [`compose.production.yml`](./compose.production.yml); the default [`docker-compose.yml`](./docker-compose.yml) remains convenient for building the checked-out source locally.

## Releases

Consumer documentation is maintained only in the documentation repository. SDK versions are synchronized with Changesets, trusted npm publishing runs through GitHub Actions, and Docker images publish for `linux/amd64` and `linux/arm64`.

Node.js 22.13 or newer is required. Sightglass is MIT licensed.
