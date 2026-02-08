# ========== 빌드 스테이지 ==========
FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 설치
COPY package.json package-lock.json ./
RUN npm ci

# Prisma 스키마 및 클라이언트 생성
COPY prisma ./prisma/
RUN npx prisma generate

# 소스 및 TypeScript 빌드
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ========== 프로덕션 스테이지 ==========
FROM node:20-slim AS production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 빌드 결과물만 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 8080

# Cloud Run은 PORT 환경변수로 포트 지정 (기본 8080)
CMD ["node", "dist/server.js"]
