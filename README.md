# pnu-epic-poc

부산대 약학대학원 연구실 웹사이트 제작을 위한 기술 검증(POC) 저장소. 본 제작과 별도이며, 검증이 끝나면 버릴 수 있는 코드로 취급한다.

검증 항목과 진행 상황은 [POC계획.md](../POC계획.md) 참고.

## 스택

- [Astro](https://astro.build) — 정적 사이트 생성, Content Collections
- GitHub Pages — 배포 대상 (`.github/workflows/deploy.yml`)
- Decap CMS — 콘텐츠 관리 (연동 예정)
- GSAP — 스크롤 애니메이션 (연동 예정)

## 로컬 개발

```sh
npm install
npm run dev
```

## 빌드

```sh
npm run build
```
