import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { buildApp } from "./app.js";

// 환경 변수는 .env.local에서 주입된다는 전제(SOW 운영 원칙: 환경 분리 dev/stage/prod).
// - 비밀값/시크릿은 코드에 하드코딩하지 않고 오직 process.env로만 읽는다.
// - 로컬 개발 편의를 위해 .env.local을 로드하지만, 로드된 값 역시 최종적으로 process.env를 통해 접근한다.
// - DOTENV_CONFIG_PATH로 경로를 오버라이드 가능.
const dotenvCandidates = [
  process.env.DOTENV_CONFIG_PATH,
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env.local"),
  path.resolve(process.cwd(), "..", ".env"),
].filter(Boolean) as string[];

const dotenvPath = dotenvCandidates.find((p) => fs.existsSync(p));
dotenv.config(dotenvPath ? { path: dotenvPath } : undefined);

// Prisma는 "empty host"를 허용하지 않음. Cloud SQL 소켓 형식(postgresql://...@/db?host=/cloudsql/...)
// 은 호스트를 비워두는데, Prisma 호환을 위해 @/ 를 @localhost/ 로 치환한다.
if (process.env.DATABASE_URL?.includes("@/")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@/", "@localhost/");
}

const port = Number(process.env.PORT ?? 8080);

async function main() {
  const app = await buildApp();
  // Cloud Run 등 컨테이너 환경에서는 반드시 0.0.0.0으로 리스닝해야 외부 접속 가능
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

