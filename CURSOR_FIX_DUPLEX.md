# 🔧 Fix: "duplex option is required when sending a body" 에러

## 문제
Upload 페이지에서 사진 업로드 시 에러 발생:
`RequestInit: duplex option is required when sending a body.`

## 원인
Next.js App Router의 fetch()로 백엔드에 body를 보낼 때 `duplex: "half"` 옵션이 필요함.
Node.js 18+ 의 undici fetch 구현에서 스트리밍 body 전송 시 필수.

## 수정 방법
`apps/web` 폴더에서 백엔드 API로 fetch 호출하는 모든 곳을 찾아서,
POST/PUT/PATCH 요청에 body가 있는 경우 `duplex: "half"` 추가.

### 패턴:
```typescript
// BEFORE (에러 발생)
const res = await fetch(url, {
  method: "POST",
  body: formData,  // 또는 JSON.stringify(...)
  headers: { ... },
});

// AFTER (수정)
const res = await fetch(url, {
  method: "POST",
  body: formData,
  headers: { ... },
  duplex: "half",  // ← 이 줄 추가
} as RequestInit);
```

### 검색 키워드
apps/web 폴더 전체에서 이 패턴을 찾아 수정:
- `fetch(` + `body:` 조합이 있는 모든 곳
- 특히 `/upload` 페이지 관련 컴포넌트
- API route handlers (app/api/ 폴더)

### TypeScript 타입 에러 방지
`duplex`는 표준 RequestInit 타입에 없으므로 `as RequestInit` 또는 `as any` 캐스팅 필요:
```typescript
const res = await fetch(url, {
  method: "POST",
  body: formData,
  duplex: "half",
} as RequestInit & { duplex: string });
```

## 확인
수정 후 로컬에서 `npm run dev` → 사진 업로드 테스트 → 에러 없이 백엔드 응답 확인.
