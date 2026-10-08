# BigData Help Apps Script 자동배포

`help.k-bigdata.kr`의 Apps Script 백엔드는 GitHub 저장소의 `apps-script/`를 원본으로 관리합니다.

```text
GitHub main
  -> security regression tests
  -> appsscript.json 검증
  -> clasp push
  -> 기존 Web App deployment 재배포
```

## 필요한 GitHub Repository Secrets

저장소의 `Settings -> Secrets and variables -> Actions -> Repository secrets`에 다음 3개를 등록합니다.

| Secret | 값 |
|---|---|
| `GAS_SCRIPT_ID` | BigData Help Apps Script 프로젝트의 Script ID |
| `GAS_DEPLOYMENT_ID` | 현재 운영 Web App Deployment ID |
| `CLASP_CREDENTIALS_JSON` | `clasp login`으로 생성된 `.clasprc.json` 전체 JSON |

### GAS_DEPLOYMENT_ID

현재 `js/config.js`가 사용하는 운영 Web App URL의 Deployment ID:

```text
AKfycbwCWe_BgUrbewpKymmYfXiBDj0edWWk1WyBURkGyT5LlziFliy5jOzB3pJc-cCJm4jS
```

기존 Deployment ID를 갱신하므로 `help.k-bigdata.kr`이 사용하는 기존 `/exec` URL은 유지됩니다.

### GAS_SCRIPT_ID

운영 데이터 스프레드시트는 Google Drive의 `BigData Help 데이터`입니다. 스프레드시트에서 `확장 프로그램 -> Apps Script -> 프로젝트 설정`으로 들어가 Script ID를 확인합니다.

### CLASP_CREDENTIALS_JSON

READY, Job Apply, Room에서 사용한 동일 Google 계정이면 같은 clasp 인증 JSON을 재사용할 수 있습니다. Secret은 저장소별로 별도 등록합니다.

Windows 11 PowerShell:

```powershell
Get-Content -Raw "$HOME\.clasprc.json" | Set-Clipboard
```

인증 JSON은 채팅이나 저장소 파일에 올리지 않고 GitHub Secret에만 저장합니다.

## 자동배포 동작

`apps-script/**`, `tests/**`, workflow가 main에서 변경되면 자동 실행됩니다.

1. `node --test tests/security.test.mjs`
2. `appsscript.json` 검증
3. Secret 설정 확인
4. clasp 인증 확인
5. `Code.gs`와 `appsscript.json` push
6. 기존 Deployment ID로 Web App 새 버전 배포

`apps-script/README.md`는 문서 파일이므로 CI 작업공간에서만 제거하고 Apps Script에는 push하지 않습니다. 저장소 원본 문서는 그대로 유지됩니다.

Secret이 없으면 테스트까지만 수행하고 실제 GAS 배포는 안전하게 건너뜁니다. 자동배포 실패 시 마지막 성공 Web App 버전은 그대로 유지됩니다.
