## NexSupply Backend (Phase-A + Phase-B + Phase-C Lite)

이 폴더는 SOW v1.2(2026-02-02) 기준 **Phase-A(M1+M2 core)** + **Phase-B(Slack 운영 트리거)** + **Phase-C Lite(Blueprint 파이프라인)** 를 구현합니다.

### 범위(엄격)

- **Phase-A**: Claim 기반 불변 데이터, audit trail, 프로젝트 상태 머신/전이 이벤트, Resolved View/Verified Snapshot
- **Phase-B**: Slack 이벤트 수신, 인터랙티브 버튼(Confirm Payment / Reject / Need more docs), 결제 요청 알림, idempotency 강제
- **Phase-C Lite**: Blueprint 파이프라인(결제 확인 후), RapidAPI 1688 공장 후보 → HYPOTHESIS claims, OCR(문서 추출) → HYPOTHESIS claims, 감사 로그, idempotency. **자동 VERIFIED 없음**, 검증은 사람만.
- **제외(Non-goal)**: Stripe, LLM 추론/랭킹/자동 선택, PDF 생성, UI
  - 해당 위치는 **TODO 주석**으로만 남겨둡니다.

---

## 아키텍처 요약

### 핵심 불변 조건(Invariants)

- **Claim 불변성(append-only)**:
  - `sourcing_claims`는 **절대 업데이트/삭제하지 않는다**.
  - Verified 이후 수정이 필요하면 **새 Claim + 새 versionId**로만 변경한다.
- **Auditability**:
  - Claim append, 상태 전이는 항상 `audit_actions`에 기록된다.
  - 모든 상태 전이는 `project_status_events`로 재현 가능하다.
- **상태 전이 단일화 + idempotency**:
  - 상태 전이는 오직 `src/modules/stateMachine/service.ts`의 `transitionProject()`만을 통해서 발생한다.
  - 전이는 반드시 idempotency key를 요구하며, DB Unique 제약으로 중복 처리를 방지한다.
- **Resolved View / Verified Snapshot**:
  - Claim append 시 현재 `activeVersionId` 기준으로 `projects.resolved_view_jsonb`를 재계산한다.
  - `VERIFIED` 전환 시 `verified_snapshot_jsonb`, `verified_at`, `verified_version_id`를 고정 저장한다.
  - **VERIFIED 프로젝트에는 claim append를 금지**(재검증 필요 시 admin/system이 재오픈 후 새 버전 claim append).

### 왜 Fastify인가?

`src/app.ts` 주석 참고. Fastify의 훅/스키마 검증 구조가 “전이 단일 함수 + idempotency 강제” 같은 규칙을 적용하기 용이합니다.

---

## 데이터 모델 (Prisma)

스키마는 `prisma/schema.prisma`.

- `projects`
- `sourcing_claims` (append-only)
- `evidence_files` (metadata only)
- `claim_evidence_links`
- `audit_actions`
- `project_status_events`
- `credits_ledger` (schema only, no logic)

---

## API (minimal but real)

- `POST /projects` (인증 필요)
- `GET /projects` (인증 필요; user는 본인, auditor/admin/system은 전체)
- `POST /claims` (append-only; 인증 필요)
- `POST /projects/:id/transition` (인증 필요 + **Idempotency key 필수**)
- `GET /projects/:id/audit-log` (인증 필요)
- **Phase-B Slack**
  - `POST /slack/events` — Events API (url_verification 등); 서명 검증 필수
  - `POST /slack/interactions` — 인터랙티브 버튼(Confirm Payment / Reject / Need more docs); 서명 검증 + idempotency
- **Internal Review (Phase-E/F/G)** — admin/system만
  - `GET /internal/projects/:id/blueprint-review` — Blueprint 검토용 프로젝트·클레임 조회 (읽기 전용)
  - `POST /internal/projects/:id/approve-execution` — 실행 승인 audit 기록 (Idempotency-Key 필수, 상태 변경 없음)
  - `POST /internal/projects/:id/mark-sent` — Phase-G 실행 기록 (step, evidence_ids)

### 인증(Auth)

- Firebase Auth ID token 검증(`Authorization: Bearer <token>`)
- 역할(role): `user | auditor | admin | system`
  - 토큰 커스텀 클레임 `role`을 사용(없으면 `user`)

---

## 로컬 실행(개발)

### 1) 환경 변수

- `DATABASE_URL` (PostgreSQL). **Cloud SQL Unix 소켓** 사용 시: `postgresql://USER:PASSWORD@localhost/DATABASE?host=/cloudsql/PROJECT:REGION:INSTANCE` 형식 권장. `@/`(빈 호스트)는 Prisma가 허용하지 않아, 서버에서 자동으로 `@localhost/`로 치환함.
- `FIREBASE_PROJECT_ID` (Firebase 프로젝트 ID)
- **Phase-B**: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_PAYMENT_CHANNEL_ID` (Slack 미설정 시 결제 알림/버튼 비활성)
- **Phase-C Lite**: `RAPIDAPI_KEY`, `RAPIDAPI_HOST` (1688 데이터; 미설정 시 스텁 후보 3건 반환)

로컬에서는 `.env.local`에 환경 변수를 두고 실행합니다. (`backend/src/server.ts`가 `.env.local`을 탐색/로드). 비밀값은 코드에 하드코딩하지 않고 `process.env`만 사용합니다.

> 주의: `.env.local`은 절대 커밋하지 마세요. (비밀값/시크릿 포함 가능)

> TODO(M1): 운영에서는 Secret Manager/Workload Identity로 자격 증명 주입

### 2) 설치/생성

```bash
cd backend
npm install
npx prisma generate
```

### 3) 마이그레이션(선택)

```bash
npx prisma migrate dev
```

### 4) 실행

```bash
npm run dev
```

---

## Phase-B Slack 동작 요약

- **서명 검증**: `SLACK_SIGNING_SECRET`으로 `X-Slack-Signature` / `X-Slack-Request-Timestamp` 검증; 재전송(replay) 방지(타임스탬프 5분 초과 시 거부).
- **결제 요청 알림**: 프로젝트가 `WAITING_PAYMENT`로 전이될 때 `SLACK_PAYMENT_CHANNEL_ID`로 메시지 전송(Confirm Payment / Reject / Need more docs 버튼 포함).
- **Confirm Payment**: idempotency key 필수; `transitionProject(WAITING_PAYMENT → BLUEPRINT_RUNNING)`, `is_paid_blueprint = true`, `audit_actions` + `project_status_events` 기록, blueprint pipeline job enqueue(stub). Slack 액션은 actor = admin/system으로 매핑.
- **Reject / Need more docs**: `audit_actions`만 기록, 상태 변경 없음; 동일 interaction idempotency로 중복 클릭 무시.
- **VERIFIED 프로젝트**: Slack 버튼으로 상태/감사 변경 불가(안전 규칙).

> TODO: Stripe 도입 시 결제 확인 플로우를 Stripe webhook으로 대체할 수 있음; Slack은 운영 알림/수동 승인용으로 유지.

---

## Phase-C Lite (Blueprint 파이프라인)

- **트리거**: `project.status === BLUEPRINT_RUNNING` && `isPaidBlueprint === true` (Slack Confirm Payment 후).
- **Job payload**: `projectId`, `versionId`, `idempotencyKey` (워커 중복 실행 방지).
- **RapidAPI 1688**: 기존 H claims / resolved view에서 product name 또는 category 사용 → 후보 공장 목록(최소 3건) → `sourcing_claim` `field_key: factory_candidate`, `claim_type: HYPOTHESIS`, `source_type: api`, `source_ref: rapidapi:1688`.
- **OCR**: 프로젝트의 `evidence_files` 대상으로 문서 추출(business_name, registration_number, address, export_license) → `field_key: document_extracted`, `claim_type: HYPOTHESIS`, `source_type: document`. TODO: Google Vision 연동.
- **안전**: 기존 claim 덮어쓰기 없음(append-only), 상태 자동 전이 없음, VERIFIED claim 생성 없음. 실패 시 audit 기록, 프로젝트는 BLUEPRINT_RUNNING 유지, Slack 알림은 stub.
- **모듈**: `src/modules/pipeline/blueprint/` (job.ts, rapidapi1688.ts, ocr.ts, safeguards.ts). TODO: 랭킹/스코어링, AI 보강, 실행 파이프라인.

---

## Phase-E / Phase-F / Phase-G (실행 계획 → 기록)

**E / F / G 전체 구조 (보존)**

| Phase | 역할 |
|-------|------|
| **Phase-E** | System proposes next actions |
| **Phase-F** | Human approves → System prepares |
| **Phase-G** | Human executes → System records facts |

- **Phase-E** (execution plan): VERIFIED 프로젝트에 대해 실행 계획(assumptions, steps, risks) 및 비용 프리뷰 claim 추가. 상태 변경 없음, 읽기 전용.
- **Phase-F** (execution action): Human이 `execution_approved` audit 후, 승인된 step별로 `execution_action`(prepared) claim 생성. 이메일/메시지 초안·템플릿만 준비, **전송/결제/주문 없음**.
- **Phase-G** (execution result): Human이 evidence 업로드 후 "Mark as Sent"로 확인 시, `execution_action_result` **VERIFIED** claim 추가. **비가역 기록**.

> **Phase-G**: Phase-G records irreversible execution facts. Once recorded, results cannot be edited or reverted. (팀원 실수 방지를 위해 이 규칙을 유지하세요.)

---

## Frontend / UX 가이드 (Phase-E/F/G)

백엔드는 idempotency로 중복 생성만 막습니다. UI는 아래 규칙으로 맞추면 됩니다.

1. **Mark as Sent 버튼**
   - 해당 step에 대해 `execution_action_result`(VERIFIED) claim이 이미 있으면 **버튼 비활성화**.
   - 이미 Sent 상태면 "Sent" 등으로 표시하고, Mark as Sent는 노출하지 않거나 disabled.

2. **VERIFIED 결과 카드 (execution_action_result)**
   - `"Attached evidence (N files)"` 형태로만 노출 (N = `value_json.evidence_ids.length`).
   - 증거 내용은 **열람만** 허용, **수정/삭제 불가**.

---

## TODO (Phase-A/Phase-B/Phase-C 이후)

- DB 레벨 UPDATE/DELETE 차단 트리거/권한(immutable claims)
- GCS Signed URL 실제 구현 + 업로드 정책/sha256/바이러스 스캔 상태 업데이트
- 비동기 큐(Cloud Tasks/PubSub + DLQ)
- Claim 해석 규칙(우선순위/스키마/단위/통화 표준화)
- Stripe/결제, AI/OCR/크롤링/PDF (SOW M3~M6)

