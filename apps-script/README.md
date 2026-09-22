# Google Apps Script 설치 안내

이 폴더의 `Code.gs`는 BigData Help의 Web API, Google Sheets 저장, 일일 요약 메일, 시간 기반 Trigger를 모두 포함합니다.

## 1. Spreadsheet 준비

1. Google Drive에서 새 Google Sheets 파일을 만듭니다.
2. URL `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`에서 `{SPREADSHEET_ID}`를 복사합니다.
3. Apps Script가 실행되는 Google 계정에 이 파일의 편집 권한이 있어야 합니다.

## 2. Apps Script 프로젝트 만들기

1. <https://script.google.com/>에서 **새 프로젝트**를 만듭니다.
2. 프로젝트 이름을 `BigData Help`로 지정합니다.
3. 기본 `Code.gs` 내용을 모두 지우고 저장소의 `apps-script/Code.gs` 전체를 붙여넣습니다.
4. **프로젝트 설정 → 시간대**를 `(GMT+09:00) 서울`로 선택합니다.

## 3. 필수 CONFIG 입력

`Code.gs` 맨 위에서 다음 세 값을 반드시 바꿉니다.

```javascript
SPREADSHEET_ID: "복사한_스프레드시트_ID",
ADMIN_EMAIL: "요약_메일을_받을_관리자_주소",
ADMIN_ACCESS_KEY: "길고_추측하기_어려운_무작위_문자열",
```

- 관리자 이메일은 `ADMIN_EMAIL` 한 곳만 수정하면 됩니다. 코드의 다른 위치에는 하드코딩하지 않습니다.
- `ADMIN_ACCESS_KEY`는 관리자 화면과 API를 보호하는 공유 키입니다. 저장소에 실제 값을 커밋하지 마세요.
- `SHEET_NAME`, `TIMEZONE`, `SERVICE_NAME`, `SERVICE_URL`은 기본값을 유지해도 됩니다.

## 4. 시트 초기화

1. 상단 함수 선택 메뉴에서 `initializeSheet`를 선택합니다.
2. **실행**을 누릅니다.
3. 첫 실행 권한 요청을 승인합니다.
4. 스프레드시트에 `requests` 시트와 15개 컬럼이 생성됐는지 확인합니다.

헤더를 직접 정렬하거나 이름을 바꾸면 API가 `INVALID_SHEET_HEADERS`로 중단됩니다.

## 5. Web App 배포

1. 우측 상단 **배포 → 새 배포**를 선택합니다.
2. 유형에서 **웹 앱**을 선택합니다.
3. 설명에 버전을 기록합니다(예: `BigData Help v1`).
4. **다음 사용자로 실행**: `나`.
5. **액세스 권한**: 학생이 Google 로그인 없이 사용해야 하면 `모든 사용자`.
6. 배포 후 권한을 승인하고 `/exec`로 끝나는 Web App URL을 복사합니다.
7. 저장소 `js/config.js`의 `API_URL`에 URL을 입력하고 GitHub에 반영합니다.

Apps Script 코드를 수정할 때는 저장만으로 기존 배포에 반영되지 않을 수 있습니다. **배포 → 배포 관리 → 수정 → 새 버전 → 배포** 순서로 갱신하세요.

## 6. API 동작 확인

배포 URL 뒤에 `?action=list`를 붙여 브라우저에서 엽니다.

```text
https://script.google.com/macros/s/배포_ID/exec?action=list
```

정상이면 `{"success":true,...}` JSON이 표시됩니다. 이후 GitHub Pages에서 요청 1건을 등록하고 시트에 `RECEIVED` 행이 생기는지, PIN 컬럼이 64자리 해시인지 확인합니다.

## 7. 매일 오전 8시대 Trigger 만들기

1. 함수 선택에서 `createDailyTrigger`를 선택해 최초 1회 실행합니다.
2. Gmail/외부 서비스 및 Trigger 권한을 승인합니다.
3. 왼쪽 **트리거** 메뉴에서 `sendDailyRequestSummary`가 일 단위, 오전 8시~9시로 표시되는지 확인합니다.

코드는 `inTimezone("Asia/Seoul").atHour(8).everyDays(1)`로 생성합니다. Apps Script 특성상 정확히 08:00:00이 아닌 오전 8시대 임의 시각에 실행됩니다. `createDailyTrigger()`는 동일 함수의 기존 트리거가 있으면 추가 생성하지 않습니다.

## 8. 메일 미리보기와 실제 테스트

### 발송 없는 미리보기

1. 삭제되지 않은 `RECEIVED` 요청을 등록합니다.
2. `previewDailyRequestSummary()`를 실행합니다.
3. 하단 실행 로그 또는 반환값에서 HTML을 확인합니다.
4. 이 함수는 메일을 보내지 않고 상태도 변경하지 않습니다.

### 실제 발송 테스트

1. `ADMIN_EMAIL`이 실제 수신 주소인지 확인합니다.
2. `testDailyRequestSummary()`를 실행합니다.
3. 메일함에서 `[BigData Help] 신규 학과 요청 N건이 접수되었습니다`를 확인합니다.
4. 시트에서 해당 행의 상태가 `CHECKING`, `email_sent_at`과 `updated_at`이 발송 시각으로 기록됐는지 확인합니다.

`testDailyRequestSummary()`는 운영 함수 자체를 호출하므로 실제 상태가 변경됩니다. 대상이 0건이면 정상적으로 메일을 보내지 않습니다.

## 9. 실패 처리 확인

메일 발송 호출이 실패하면 뒤의 상태 변경 코드가 실행되지 않습니다. Apps Script 왼쪽 **실행** 메뉴에서 실패 로그를 확인하세요. 재시도 전 다음을 확인합니다.

- `ADMIN_EMAIL` 오타
- 메일 일일 할당량
- Apps Script 권한 승인
- Spreadsheet 접근 권한
- CONFIG의 ID와 시트 헤더

메일 전송 성공 후 `email_sent_at`이 기록되므로 같은 요청은 다음 실행에서 제외됩니다. `email_sent_at`이 있는 행을 수동으로 `RECEIVED`로 되돌려도 중복 발송하지 않습니다.

## 10. 운영 전 점검

- 공개 홈에 이름/학번/PIN이 보이지 않는지
- 잘못된 학번/PIN으로 내 요청이 조회되지 않는지
- 삭제 티켓이 홈/내 요청/메일 대상에서 제외되는지
- 관리자 접근 키 없이는 관리자 API가 거부되는지
- 관리자 목록/메일 어디에도 PIN 또는 PIN 해시가 노출되지 않는지
- 모바일 브라우저에서 등록, 조회, 삭제, 관리자 저장이 동작하는지
