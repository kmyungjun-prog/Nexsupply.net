# 푸시 전 3분 체크 (Backend TSC 수정)

## 1. 시크릿 체크 결과

**저장소 루트(C:\Users\kmyun)에서 `git grep` 실행 결과:**
- `BEGIN PRIVATE KEY` — **없음**
- `xoxb-` — **없음**
- `AIza` — **없음** (tracked 파일 기준; node_modules는 미포함)
- `postgresql://` — **없음**

→ **tracked 파일에 시크릿 노출 없음.** (키 폐기했어도 히스토리에 남아 있으면 문제되므로, 푸시 전에 `git log -p` 등으로 한 번 더 확인 권장.)

---

## 2. 변경 범위 (수정한 4가지만)

| # | 수정 내용 | 파일 |
|---|-----------|------|
| 1 | pipeline db import 경로 수정 | `backend/src/modules/pipeline/automationEligibility/index.ts`, `executionAction/index.ts`, `executionAction/prepare.ts`, `executionPlan/index.ts`, `executionResult/index.ts`, `executionResult/record.ts` |
| 2 | claims appendClaim에서 resolvedView 스코프/반환 | `backend/src/modules/claims/service.ts` |
| 3 | evaluate.ts Prisma JSON not-null 필터 | `backend/src/modules/pipeline/automationEligibility/evaluate.ts` |
| 4 | record.ts find 콜백 파라미터 타입 | `backend/src/modules/pipeline/executionResult/record.ts` |

**참고:** 현재 이 PC에서 `git status` 기준으로 **저장소 루트는 `C:\Users\kmyun`** 이고, **`Desktop\Nexsupply.net` 전체가 untracked** 입니다.  
→ 백엔드 수정을 커밋하려면 **먼저 이 폴더를 추가**해야 합니다.  
→ 또는 **실제로 푸시하는 클론이 `Nexsupply.net` 을 루트로 둔 별도 repo** 라면, 그 쪽에서 아래 “루트 = Nexsupply.net” 명령을 사용하면 됩니다.

---

## 3. 최종 로컬 검증

```bash
cd backend
npx tsc --noEmit   # 0 errors
npm run build      # 성공
```

**실행 결과:** 둘 다 성공 (이미 확인함).  
`npm test` 스크립트는 backend/package.json 에 없음.

---

## 4. 커밋 순서 및 명령 (추천)

### 경우 A: 저장소 루트 = `Nexsupply.net` (backend, apps 여기 있음)

```bash
cd /path/to/Nexsupply.net
git checkout -b fix/backend-tsc-clean

git status
git diff

git add backend/src/modules/pipeline/automationEligibility/index.ts backend/src/modules/pipeline/executionAction/index.ts backend/src/modules/pipeline/executionAction/prepare.ts backend/src/modules/pipeline/executionPlan/index.ts backend/src/modules/pipeline/executionResult/index.ts backend/src/modules/pipeline/executionResult/record.ts
git commit -m "fix(backend): correct pipeline db import paths for tsc"

git add backend/src/modules/claims/service.ts
git commit -m "fix(backend): resolve resolvedView scope in claims appendClaim"

git add backend/src/modules/pipeline/automationEligibility/evaluate.ts
git commit -m "fix(backend): use Prisma.DbNull for JSON not-null filter in evaluate"

git add backend/src/modules/pipeline/executionResult/record.ts
git commit -m "fix(backend): add explicit type for record.ts find callback parameter"

git push -u origin fix/backend-tsc-clean
```

### 경우 B: 저장소 루트 = `C:\Users\kmyun` (지금 이 PC 기준)

먼저 Nexsupply.net 을 추적하게 만든 뒤, **같은 4개 커밋**을 경로만 맞춰서:

```bash
cd C:\Users\kmyun
git checkout -b fix/backend-tsc-clean
git add Desktop/Nexsupply.net/backend/
git status   # .env, .env.* 등은 backend/.gitignore 로 제외되는지 확인

# 1번 커밋: pipeline db 경로만
git add Desktop/Nexsupply.net/backend/src/modules/pipeline/automationEligibility/index.ts Desktop/Nexsupply.net/backend/src/modules/pipeline/executionAction/index.ts Desktop/Nexsupply.net/backend/src/modules/pipeline/executionAction/prepare.ts Desktop/Nexsupply.net/backend/src/modules/pipeline/executionPlan/index.ts Desktop/Nexsupply.net/backend/src/modules/pipeline/executionResult/index.ts Desktop/Nexsupply.net/backend/src/modules/pipeline/executionResult/record.ts
git commit -m "fix(backend): correct pipeline db import paths for tsc"

# 2번
git add Desktop/Nexsupply.net/backend/src/modules/claims/service.ts
git commit -m "fix(backend): resolve resolvedView scope in claims appendClaim"

# 3번
git add Desktop/Nexsupply.net/backend/src/modules/pipeline/automationEligibility/evaluate.ts
git commit -m "fix(backend): use Prisma.DbNull for JSON not-null filter in evaluate"

# 4번
git add Desktop/Nexsupply.net/backend/src/modules/pipeline/executionResult/record.ts
git commit -m "fix(backend): add explicit type for record.ts find callback parameter"

git push -u origin fix/backend-tsc-clean
```

(처음에 `git add Desktop/Nexsupply.net/backend/` 로 한 번에 넣으면 위 4개가 한 커밋에 들어가므로, **4개로 나누려면** 첫 add 를 1번에서 쓴 6개 파일만 추가하고 커밋한 뒤, 2·3·4번처럼 나머지 파일만 add/commit 하면 됩니다.)

---

## 5. PR 올릴 때 넣을 한 줄

- No API changes  
- No schema changes  
- Runtime behavior unchanged  
- Backend tsc and build now pass  

---

## 6. 보안 한 번 더

푸시 전에:

```bash
git grep -n "BEGIN PRIVATE KEY"
git grep -n "xoxb-"
git grep -n "AIza"
git grep -n "postgresql://"
```

**하나라도 나오면** 푸시 멈추고, 해당 내용 제거 후 커밋 다시 정리할 것.
