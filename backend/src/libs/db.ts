import { PrismaClient } from "@prisma/client";
import { AppError } from "./errors.js";

/**
 * Prisma Client를 그대로 노출하면 누군가 실수로 `sourcingClaim.update/delete`를 호출할 수 있다.
 * SOW 핵심 불변성(Claim append-only)을 "코드 레벨"에서도 강제하기 위해 Prisma Delegate를 Proxy로 감싼다.
 *
 * NOTE: 운영 환경에서는 DB 레벨에서도 UPDATE/DELETE 차단(권한/트리거)을 추가하는 것을 강력 권장. (TODO)
 */
function wrapImmutableDelegate<T extends Record<string, any>>(delegate: T, modelName: string): T {
  const forbidden = new Set(["update", "updateMany", "upsert", "delete", "deleteMany"]);
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && forbidden.has(prop)) {
        return () => {
          throw new AppError({
            statusCode: 400,
            code: "IMMUTABLE_CLAIM",
            message: `${modelName} is append-only; ${prop} is forbidden`,
          });
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return Reflect.get(target, prop, receiver);
    },
  });
}

function createClient() {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy(prisma as any, {
    get(target, prop, receiver) {
      if (prop === "sourcingClaim") {
        return wrapImmutableDelegate(target.sourcingClaim, "sourcing_claims");
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

export const db = createClient();

