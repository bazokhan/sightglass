# @bazokhan/sightglass-prisma

Capture Prisma model/action timing inside active Sightglass occurrences.

```ts
import { withSightglass } from "@bazokhan/sightglass-prisma";

const observedPrisma = withSightglass(prisma);
```

See the [Prisma guide](https://sightglass-docs.trugraph.io/docs/frameworks#prisma).
