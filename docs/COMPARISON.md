# Focused product comparison

Checked 12 September 2026 against official public pricing, deployment, and licensing material. `✓` means native, `◐` means partial or configurable, and `×` means absent or not a core product capability.

| Product | Deployment | Public starting price | OSS | Opt-in | Events | Exact ledger | Traces | DB/deps | Health | 1 container | No daemon |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Sightglass** | Self-host, one container | Free; infrastructure only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Datadog APM | SaaS + host agent | From $31/host/mo annual | × | × | ✓ | × | ✓ | ✓ | ✓ | × | × |
| New Relic | SaaS + app/host agents | Free tier; $0.40/GB + access | × | × | ✓ | × | ✓ | ✓ | ✓ | × | ◐ |
| Honeycomb | SaaS, SDK/OTel | Free; Pro from $150/mo | × | ◐ | ✓ | × | ✓ | ◐ | ◐ | × | ✓ |
| Grafana | Cloud or self-host stack | OSS free; Cloud $19 + usage | ✓ | × | ◐ | × | ✓ | ◐ | ✓ | × | × |
| Sentry | SaaS or self-host stack | Free; Team $26/mo | × | ◐ | ◐ | × | ✓ | ✓ | ◐ | × | ✓ |
| Dynatrace | SaaS or Managed + OneAgent | $58/8-GiB host/mo | × | × | ✓ | × | ✓ | ✓ | ✓ | × | × |
| SigNoz | Cloud or self-host stack | Community free; Cloud $49/mo | ✓ | × | ◐ | × | ✓ | ✓ | ✓ | × | × |
| Better Stack | SaaS + optional collector | Free; bundles from $25/mo annual | × | × | ◐ | × | ✓ | ✓ | ✓ | × | ◐ |
| Elastic Observability | Cloud or self-host stack | Self-host free; Cloud usage-priced | ✓ | × | ✓ | × | ✓ | ✓ | ✓ | × | × |
| Uptrace | Cloud or self-host stack | Community free; 50 GB Cloud free | ✓ | ◐ | ◐ | × | ✓ | ✓ | ✓ | × | ✓ |

Definitions are intentionally narrow:

- **Opt-in:** unselected application routes remain silent by product doctrine.
- **Events:** semantic application events, directly or through the platform's general event/log model.
- **Exact ledger:** an idempotent, exportable business-usage ledger, not ordinary custom metrics.
- **DB/deps:** application database and outbound dependency timing.
- **Health:** application/runtime or host health within the product.
- **1 container:** server, storage, API, and UI deploy together in one container.
- **No daemon:** application telemetry can reach the product without a required host-level daemon or collector. An in-process SDK does not count as a daemon.
- **OSS:** the usable product core is available under an open-source license. Sentry is marked `×` because its official self-hosting documentation describes the source as available under a non-OSI-approved license.

This comparison is about Sightglass's deliberately narrow application-observability job. Larger platforms add capabilities Sightglass does not claim: logs, RUM, synthetics, alerting, security, AI, incident management, and enterprise access controls.

## Official sources

- [Datadog APM pricing](https://www.datadoghq.com/pricing/?product=apm)
- [New Relic pricing](https://newrelic.com/pricing) and [APM agent installation](https://docs.newrelic.com/docs/new-relic-solutions/get-started/manual-installation/)
- [Honeycomb pricing](https://www.honeycomb.io/pricing)
- [Grafana pricing](https://grafana.com/pricing/) and [deployment options](https://grafana.com/grafana/deployment-options/)
- [Sentry pricing](https://sentry.io/pricing/) and [self-hosting/license note](https://github.com/getsentry/develop/blob/master/src/docs/self-hosted/index.mdx)
- [Dynatrace pricing](https://www.dynatrace.com/pricing/) and [Managed deployment](https://docs.dynatrace.com/managed)
- [SigNoz pricing and editions](https://signoz.io/pricing/)
- [Better Stack pricing](https://betterstack.com/pricing) and [collector model](https://betterstack.com/docs/logs/collector/)
- [Elastic pricing and deployments](https://www.elastic.co/pricing/) and [self-managed editions](https://www.elastic.co/pricing/self-managed)
- [Uptrace pricing](https://uptrace.dev/pricing) and [AGPL project](https://github.com/uptrace/uptrace)

Prices are USD list prices where available, exclude infrastructure and negotiated discounts, and can change. The linked vendor pages are authoritative; update this comparison when those pages change.
