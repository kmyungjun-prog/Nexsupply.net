# NexSupply — Cursor 마스터 개발 프롬프트

## 🎯 골
사진 한 장 업로드 → AI가 제품 분석 → 1688 공장 후보 자동 검색 → 비교 리포트 생성
**Upload → Gemini Vision → 1688 소싱 → Report 까지 E2E 완성**

---

## 📁 프로젝트 구조 (모노레포)
```
backend/           ← Fastify + Prisma + PostgreSQL (Cloud Run)
apps/web/          ← Next.js 14 App Router (Vercel)
```
- **배포**: Cloud Run `https://nexsupply-backend-866423095824.us-east1.run.app`
- **프론트**: Vercel `https://nexsupply-net.vercel.app`
- **프록시**: `apps/web/app/api/proxy/[...path]/route.ts` → 백엔드로 포워딩

---

## 🔧 TASK 1: Gemini Vision 제품 분석 (backend)

### 현재 상태
`backend/src/modules/projects/service.ts` → `completePhotoUpload()` 가 **하드코딩된 더미 데이터**를 저장하고 있음:
```ts
const resolvedViewJsonb = {
  product_category: "General merchandise",
  estimated_margin: { min: 12, max: 18, unit: "percent" },
  _source: "photo_upload",
};
```

### 해야 할 것
GCS에 업로드된 사진을 **Gemini Vision API로 분석**해서 실제 제품 정보를 추출해야 함.

#### 1-A. `backend/src/modules/pipeline/geminiVision.ts` 새로 생성
```ts
// Gemini API (REST, API Key 방식 - GEMINI_API_KEY 환경변수 사용)
// Vertex AI가 아닌 generativelanguage.googleapis.com 엔드포인트 사용
// (Cloud Run에 GEMINI_API_KEY 이미 설정됨)

export async function analyzeProductPhoto(gcsPath: string, bucketName: string): Promise<ProductAnalysis> {
  // 1. GCS signed URL로 이미지 다운로드 (또는 base64 변환)
  // 2. Gemini 1.5 Flash multimodal API 호출
  //    POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}
  // 3. 시스템 프롬프트:
  //    "You are a product sourcing expert. Analyze this product photo and return JSON:
  //     { product_name, product_name_zh (Chinese), category, material, estimated_specs,
  //       search_keywords_1688 (3-5 keywords for 1688.com search, in Chinese) }"
  // 4. 결과 파싱 후 반환
}

export type ProductAnalysis = {
  product_name: string;
  product_name_zh: string;        // 중국어 제품명 (1688 검색용)
  category: string;
  material?: string;
  estimated_specs?: string;
  search_keywords_1688: string[];  // 1688 검색 키워드 (중국어)
};
```

**핵심 포인트:**
- `@google-cloud/storage`로 GCS에서 이미지 바이트 읽기 (이미 storage.ts에 Storage 클라이언트 있음)
- Gemini REST API는 `inlineData` (base64) 로 이미지 전송
- 반드시 JSON 응답 강제 (`response_mime_type: "application/json"`)

#### 1-B. `completePhotoUpload()` 수정 (service.ts)
```ts
export async function completePhotoUpload(...) {
  // ... 기존 evidenceFile 생성 코드 유지 ...
  
  // ★ 여기서 Gemini Vision 호출
  const analysis = await analyzeProductPhoto(body.gcs_path, process.env.GCS_BUCKET_NAME!);
  
  const resolvedViewJsonb = {
    product_name: analysis.product_name,
    product_name_zh: analysis.product_name_zh,
    category: analysis.category,
    material: analysis.material,
    estimated_specs: analysis.estimated_specs,
    search_keywords_1688: analysis.search_keywords_1688,
    _source: "gemini_vision",
    _analyzed_at: new Date().toISOString(),
  };
  
  await db.project.update({
    where: { id: projectId },
    data: { resolvedViewJsonb, resolvedViewUpdatedAt: new Date() },
  });
  
  return { project_id: projectId, analysis };
}
```

---

## 🔧 TASK 2: 1688 API 실제 연동 (backend)

### 현재 상태
`backend/src/modules/pipeline/blueprint/rapidapi1688.ts` → `fetchFactoryCandidates()` 가 **Stub 데이터**를 반환하고 있음.

### 해야 할 것
RAPIDAPI_KEY와 RAPIDAPI_HOST가 Cloud Run에 설정되어 있음. 실제 1688 API를 호출해야 함.

#### 2-A. `fetchFactoryCandidates()` 수정
```ts
export async function fetchFactoryCandidates(productNameOrCategory: string): Promise<FactoryCandidate[]> {
  const key = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST;
  if (!key || !host) {
    // fallback stub (개발용)
    return getStubCandidates(productNameOrCategory);
  }

  // 검색어: 중국어 키워드 우선, 없으면 영어
  const query = productNameOrCategory.trim();
  if (!query) return getStubCandidates("");

  // RapidAPI 1688 호출 (호스트에 따라 엔드포인트 다를 수 있음 - 확인 필요)
  // 일반적인 패턴: GET /search?keyword={query}&page=1&sort=default
  const url = `https://${host}/search?keyword=${encodeURIComponent(query)}&page=1`;
  
  try {
    const res = await fetch(url, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host },
    });
    if (!res.ok) throw new Error(`1688 API: ${res.status}`);
    const data = await res.json();
    // API 응답 구조에 맞게 파싱 (data.result, data.items 등)
    const items = data.result?.result ?? data.items ?? data.data ?? [];
    return items.slice(0, 5).map((item: any) => ({
      factory_name: item.companyName ?? item.shopName ?? item.sellerName ?? "Unknown",
      platform: "1688",
      source_url: item.detailUrl ?? item.offerUrl ?? `https://detail.1688.com/offer/${item.offerId}.html`,
      price_range: {
        min: parseFloat(item.priceRange?.[0] ?? item.price ?? 0),
        max: parseFloat(item.priceRange?.[1] ?? item.price ?? 0),
        currency: "CNY",
      },
      moq: item.quantityBegin ?? item.moq ?? "Unknown",
      location: item.province ?? item.city ?? item.location ?? "China",
    }));
  } catch (err) {
    // API 실패 시 stub fallback (서비스 중단 방지)
    return getStubCandidates(productNameOrCategory);
  }
}
```

#### 2-B. Gemini 분석 결과 → 1688 검색 연결
`getProductOrCategoryFromProject()` 수정:
```ts
export async function getProductOrCategoryFromProject(projectId: string): Promise<string> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { resolvedViewJsonb: true },
  });
  const view = project?.resolvedViewJsonb as any;
  if (!view) return "";
  
  // 우선순위: 중국어 키워드 > 중국어 제품명 > 영어 제품명
  if (view.search_keywords_1688?.length > 0) {
    return view.search_keywords_1688[0]; // 첫 번째 키워드로 검색
  }
  if (view.product_name_zh) return view.product_name_zh;
  if (view.product_name) return view.product_name;
  return view.category ?? "";
}
```

---

## 🔧 TASK 3: 파이프라인 자동 트리거 (backend)

### 현재 상태
Blueprint 파이프라인은 `BLUEPRINT_RUNNING && isPaidBlueprint` 상태일 때만 실행됨 (유료 기능).
하지만 **무료 미리보기** (사진 → 분석 → 공장 후보 3개) 를 먼저 보여줘야 사용자가 결제함.

### 해야 할 것
`completePhotoUpload()` 끝에 **무료 미니 파이프라인** 자동 실행:

```ts
// service.ts completePhotoUpload() 마지막에 추가
// 무료 미니 파이프라인: 1688 검색만 실행 (OCR, AI Compare는 유료)
try {
  const searchQuery = analysis.search_keywords_1688?.[0] ?? analysis.product_name_zh ?? analysis.product_name;
  const candidates = await fetchFactoryCandidates(searchQuery);
  
  if (candidates.length > 0) {
    const versionId = randomUUID();
    await db.project.update({
      where: { id: projectId },
      data: { activeVersionId: versionId },
    });
    await createFactoryCandidateClaims(projectId, versionId, `auto:${projectId}`, candidates, `photo-complete:${projectId}`);
    
    // resolvedViewJsonb에 후보 추가
    const updatedView = {
      ...resolvedViewJsonb,
      factory_candidates: candidates.slice(0, 3).map(c => ({
        name: c.factory_name,
        location: c.location,
        moq: c.moq,
        price_range: c.price_range,
        url: c.source_url,
      })),
    };
    await db.project.update({
      where: { id: projectId },
      data: { resolvedViewJsonb: updatedView as any, resolvedViewUpdatedAt: new Date() },
    });
  }
} catch (err) {
  // 파이프라인 실패해도 프로젝트 생성은 성공으로 처리
  console.error("Mini pipeline failed:", err);
}
```

---

## 🔧 TASK 4: Report 페이지 업그레이드 (frontend)

### 현재 상태
`apps/web/app/report/[projectId]/page.tsx` → product_category와 estimated_margin만 표시.

### 해야 할 것
Gemini 분석 결과 + 공장 후보를 보기 좋게 표시:

```tsx
// ProjectReport 타입 확장
type ProjectReport = {
  id: string;
  status: string;
  ownerUserId: string;
  resolvedViewJsonb: {
    product_name?: string;
    product_name_zh?: string;
    category?: string;
    material?: string;
    search_keywords_1688?: string[];
    factory_candidates?: Array<{
      name: string;
      location: string;
      moq?: string;
      price_range?: { min?: number; max?: number; currency?: string };
      url: string;
    }>;
    _source?: string;
    _analyzed_at?: string;
  } | null;
  resolvedViewUpdatedAt: string | null;
  createdAt: string;
};
```

**UI 구조:**
1. **제품 분석 결과** 카드
   - 제품명 (영어/중국어)
   - 카테고리, 소재
   - AI 분석 시간
2. **공장 후보** 카드 (최대 3개 무료)
   - 공장명, 위치, MOQ, 가격 범위
   - 1688 링크 (새 탭)
3. **업그레이드 CTA**
   - "3개 더 많은 공장 후보 + AI 비교 분석 받기 → Blueprint ($49)"
   - `/blueprint-request/${projectId}` 링크

**디자인:**
- 현재 순수 HTML이므로, 인라인 스타일로 깔끔하게
- 카드 레이아웃 (border, border-radius, padding, box-shadow)
- 모바일 대응 (max-width, flex-wrap)

---

## 🔧 TASK 5: Cloud Run 인증 수정 (backend)

### 현재 상태
`backend/src/libs/auth.ts` → `admin.credential.applicationDefault()` 사용.
Cloud Run에 `FIREBASE_SERVICE_ACCOUNT_KEY` 환경변수가 **아직 없음**.

### 해야 할 것
Cloud Run에서 Firebase Admin 초기화가 ADC(Application Default Credentials)로 되긴 하지만,
Firebase Auth 토큰 검증이 실패할 수 있음. 확인 후 필요 시:

```ts
function initFirebaseAdminOnce() {
  if (admin.apps.length > 0) return;
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountJson) {
    const sa = JSON.parse(serviceAccountJson);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else {
    // Cloud Run ADC fallback
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT,
      credential: admin.credential.applicationDefault(),
    });
  }
}
```

---

## 🔧 TASK 6: 에러 핸들링 & UX 개선 (frontend)

### upload/page.tsx
- 업로드 진행률 표시 (Preparing → Uploading → Analyzing → Done)
- 분석 실패 시 재시도 버튼
- 파일 드래그&드롭 지원

### report/page.tsx  
- 로딩 스켈레톤
- 분석 중일 때 폴링 (5초마다 refresh)
- "Analyzing..." 상태에서 스피너

---

## ⚡ 실행 순서 (우선순위)

1. **TASK 1** (Gemini Vision) — 핵심. 이게 없으면 전체 플로우가 더미.
2. **TASK 3** (파이프라인 트리거) — 1688 검색 자동 실행.
3. **TASK 4** (Report UI) — 결과를 보여줘야 가치가 있음.
4. **TASK 5** (Firebase 인증) — 실서버에서 동작하려면 필요.
5. **TASK 2** (1688 실제 연동) — API 키 확인 후 stub → 실제 전환.
6. **TASK 6** (UX 개선) — 나중에 해도 됨.

---

## 🌐 환경변수 (참고)

### Cloud Run (현재 설정됨)
- DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
- GEMINI_API_KEY, GCS_BUCKET_NAME
- RAPIDAPI_KEY, RAPIDAPI_HOST, RESEND_API_KEY

### Cloud Run (추가 필요)
- FIREBASE_SERVICE_ACCOUNT_KEY (JSON 문자열)

### Vercel (현재 설정됨)
- 위 전부 + NEXT_PUBLIC_API_URL + NEXT_PUBLIC_FIREBASE_* + FIREBASE_SERVICE_ACCOUNT_KEY

---

## 🚫 하지 마세요
- Prisma schema 수정하지 말 것 (마이그레이션 필요 — 별도로 진행)
- `sourcing_claims` 테이블에 UPDATE/DELETE 하지 말 것 (append-only 불변)
- 새 npm 패키지 추가 최소화 (Cloud Run 빌드 시간 증가)
- `apps/web/app/api/proxy/` 프록시 로직 건드리지 말 것

---

## 💡 참고: 기존 Gemini 연동 코드
Vertex AI 방식이 `backend/src/modules/pipeline/aiExplain/vertexGemini.ts`에 있음.
하지만 **TASK 1은 API Key 방식** (generativelanguage.googleapis.com)을 사용해야 함.
이유: Vertex AI는 GCP IAM 인증이 필요하고, API Key 방식이 더 간단함.
GEMINI_API_KEY가 이미 환경변수로 있으니 그걸 쓸 것.
