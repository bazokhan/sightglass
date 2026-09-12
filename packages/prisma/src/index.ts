import { isObserving, recordDatabase } from "@bazokhan/sightglass-core";

type PrismaLike = { $extends(extension: object): unknown };

export function withSightglass<T extends PrismaLike>(client: T): ReturnType<T["$extends"]> {
  return client.$extends({
    name: "sightglass",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) {
          if (!isObserving()) return query(args);
          const started = process.hrtime.bigint();
          try {
            const result = await query(args);
            recordDatabase(model, operation, started, "success");
            return result;
          } catch (error) {
            recordDatabase(model, operation, started, "error");
            throw error;
          }
        },
      },
    },
  }) as ReturnType<T["$extends"]>;
}
