# NexSupply 중간 보고 (2026-02-08)

SOW v1.2/v1.3 기준으로 **지금까지 구현된 것**과 **앞으로 할 일**을 정리한 문서입니다.

---

## 1. 구현 완료 범위

### 1.1 백엔드 (Phase-A, Phase-B, Phase-C Lite + E/F/G/H)

| 구분 | 내용 |
|------|------|
| **Phase-A** | Claim append-only, audit trail, 상태 머신(`transitionProject`), Resolved View / Verified Snapshot, idempotency |
| **Phase-B** | Slack Events/Interactions, 결제 요청 알림, Confirm Payment / Reject / Need more docs 버튼, 서명 검증 |
| **Phase-C Lite** | Blueprint 파이프라인(Confirm Payment 후), RapidAPI 1688 공장 후보 → HYPOTHESIS, OCR(문서 추출) → HYPOTHESIS, in-process job queue |
| **Phase-D+** | AI 비교 레이어 (factory_candidate + factory_rule_flags → 설명용 비교) |
| **Phase-E** | 실행 계획(execution_plan, execution_cost_preview) 생성, VERIFIED 프로젝트만 대상 |
| **Phase-F** | 실행 승인(audit) 후 step별 execution_action(prepared) claim 생성 |
| **Phase-G** | Mark as Sent → execution_action_result (VERIFIED) 기록, evidence_ids 필수, 비가역 |
| **Phase-H** | Automation eligibility 평가 (최소 1건 Phase-G 완료 후), append-only claim |

**데이터/인프라**

- Prisma 스키마: `projects`, `sourcing_claims`, `evidence_files`, `claim_evidence_links`, `audit_actions`, `project_status_events`, `credits_ledger`
- Firebase Auth ID 토큰 검증, 역할: `user | auditor | admin | system`
- Cloud SQL 연동: `DATABASE_URL` empty host 자동 치환(`@/` → `@localhost/`)
- GCS: evidence 업로드용 signed URL (initiate → PUT → complete), 다운로드용 signed URL (10–15분)

**API 요약**

- 프로젝트: `POST /projects`, `GET /projects`, `POST /projects/initiate-photo`, `POST /projects/:id/photo/complete`, `GET/POST /projects/:id/evidence`, `POST /projects/:id/evidence/initiate`, `POST /projects/:id/evidence/complete`, `POST /projects/:id/transition`
- Claim: `POST /claims` (append-only)
- Audit: `GET /projects/:id/audit-log`
- Slack: `POST /slack/events`, `POST /slack/interactions`
- Internal(admin/system): `GET /internal/projects/:id/blueprint-review`, `POST /internal/.../approve-execution`, `POST /internal/.../mark-sent`, `GET/POST /internal/.../evidence`, `POST /internal/.../run-phase-h`

---

### 1.2 웹 앱 (apps/web)

| 페이지/기능 | 구현 내용 |
|-------------|-----------|
| **로그인** | Firebase Auth (Google), AuthProvider, role 기반 접근 |
| **업로드 (/upload)** | 사진 드래그/선택 → Analyze → initiate-photo → GCS PUT → photo/complete → `/report/[projectId]` 이동 |
| **리포트 (/report/[projectId])** | 프로젝트 ID/상태, 제품 카테고리/마진(실데이터 또는 "Still analyzing"), Evidence 문서 목록 + **사용자 evidence 업로드**(initiate → PUT → complete), Refresh |
| **Blueprint 요청 (/blueprint-request/[projectId])** | 수량/타겟가/리드타임/특이사항 입력 → Start Blueprint Analysis → WAITING_PAYMENT 전이, USER_PROVIDED claims 저장 |
| **관리자 (/admin)** | 프로젝트 목록 → 프로젝트 상세 |
| **관리자 프로젝트 상세** | 프로젝트 헤더, 공장 후보, Phase-E 실행 계획, Phase-F 승인, Evidence 목록/업로드/Open(signed-url), Phase-G Mark as Sent(step별 evidence 선택), Phase-H Automation eligibility 표시 및 Run Phase-H |

**공통**

- Next.js API proxy (`/api/proxy/...` → `NEXT_PUBLIC_API_URL`), CORS 회피
- AppShell, 레이아웃, not-found, 디자인/카피 일관성

---

### 1.3 Internal UI (apps/internal-ui)

- Blueprint 검토용 페이지: `BlueprintReviewPage` (Phase-E/F/G 연동용 내부 UI)

---

## 2. 이제 해야 할 것 (우선순위·범위 기준)

### 2.1 운영/보안·안정성

| 항목 | 설명 |
|------|------|
| **Secret Manager / Workload Identity** | 운영 환경 DB/API 키 등 자격 증명 주입 (현재는 env 변수) |
| **DB 불변성 강화** | `sourcing_claims`에 대한 UPDATE/DELETE를 DB 트리거/권한으로 차단 (현재는 Prisma Proxy만) |
| **GCS 업로드 정책 완결** | sha256 검증, 바이러스 스캔 상태 업데이트(SOW: virus_scan_status) |
| **비동기 큐** | Cloud Tasks 또는 Pub/Sub + DLQ 도입 (현재 in-process job queue) |

### 2.2 기능·파이프라인

| 항목 | 설명 |
|------|------|
| **Stripe/결제** | 결제 확인 플로우를 Stripe webhook으로 확장 (Slack은 운영 알림/수동 승인 유지) |
| **OCR 연동** | Google Vision 등 실제 OCR 연동 (현재 스텁/구조만 있음) |
| **랭킹/스코어링** | 1688 공장 후보 랭킹·자동 선택 없음 → auditor 승인 전제; 필요 시 스코어링 로직 추가 |
| **Claim 해석 규칙** | 우선순위/스키마/단위/통화 표준화, evidence 기반 가중치 (resolved view 고도화) |
| **Phase-I** | Phase-H eligibility 이후 실제 자동화 실행 (현재 Phase-H는 가드레일/평가만) |

### 2.3 UI/UX·문서

| 항목 | 설명 |
|------|------|
| **Phase-F/G UI 연동** | 승인된 step → 확인/전송 버튼, artifact → 사용자 전송/확인 플로우 (TODO 주석 다수) |
| **Phase-H 결과 표시** | eligibility 결과를 관리자/사용자 화면에 안정적으로 노출 |
| **로컬라이제이션** | 템플릿, 질문 목록, step 설명 등 (TODO) |
| **PDF 생성** | SOW M3~M6 범위, 현재 Non-goal로 TODO만 존재 |

---

## 3. 참고 문서

- **백엔드 범위/API**: `backend/README.md`
- **Evidence 엔드포인트/정책**: `apps/web/EVIDENCE_ENDPOINTS.md`
- **런치 체크리스트**: `apps/web/LAUNCH_CHECKLIST.md`
- **SOW**: `Nex Supply Sow V1.txt`, `NexSupply_SOW_v1.3_Final.pdf`

---

*이 문서는 코드베이스와 README/TODO 기준으로 작성되었으며, SOW 최종본과 차이가 있으면 SOW를 우선합니다.*
