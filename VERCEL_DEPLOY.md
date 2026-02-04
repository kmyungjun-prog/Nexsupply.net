# Vercel 배포 설정

## 문제

Vercel이 모노레포 루트(`Nexsupply.net`)에서 빌드하려고 해서 `apps/web`의 Next.js 앱을 찾지 못해 404가 발생했습니다.

## 해결

루트에 `vercel.json`을 추가하여 `rootDirectory`를 `apps/web`로 설정했습니다.

```json
{
  "rootDirectory": "apps/web",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

**참고:** `rootDirectory`를 설정하면 Vercel이 해당 디렉터리로 이동한 뒤 명령을 실행하므로, `buildCommand`와 `installCommand`는 `apps/web` 기준으로 작성합니다.

## Vercel 대시보드 설정 (대안)

`vercel.json` 없이 Vercel 프로젝트 설정에서 직접 지정할 수도 있습니다:

1. Vercel 프로젝트 → Settings → General
2. **Root Directory** → `apps/web` 선택
3. **Build Command** → `npm run build` (또는 비워두면 자동 감지)
4. **Output Directory** → `.next` (또는 비워두면 자동 감지)

## 환경 변수

Vercel 대시보드에서 다음 환경 변수를 설정하세요:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_API_URL` (프로덕션 백엔드 URL)

## 재배포

`vercel.json` 커밋 후 푸시하면 자동 재배포됩니다. 또는 Vercel 대시보드에서 "Redeploy"를 클릭하세요.
