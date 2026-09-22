# BigData Help

한국폴리텍대학 서울강서캠퍼스 빅데이터소프트웨어공학과 학생용 요청·문의 Help Desk입니다. 학생은 요청을 등록하고 학번/PIN으로 처리 상태와 관리자 답변을 확인하거나 잘못 등록한 요청을 삭제할 수 있습니다. 관리자는 전체 티켓의 상태와 답변을 관리합니다.

- 서비스 URL: <https://help.k-bigdata.kr/>
- 프론트엔드: GitHub Pages, HTML/CSS/Vanilla JavaScript
- 백엔드: Google Apps Script Web App
- 저장소: Google Sheets
- 알림: 매일 오전 8시대 HTML 요약 메일

## 프로젝트 구조

```text
/
├── index.html              # 공개 현황과 최근 요청
├── request.html            # 학생 요청 등록
├── my.html                 # 학생 본인 요청 조회/삭제
├── admin.html              # 관리자 상태/답변 관리
├── css/style.css
├── js/
│   ├── config.js           # 프론트 API 주소와 선택 항목
│   ├── api.js
│   ├── index.js
│   ├── request.js
│   ├── my.js
│   └── admin.js
├── apps-script/
│   ├── Code.gs             # API, Sheets, 메일, Trigger 전체 코드
│   └── README.md           # Apps Script 상세 설치 안내
├── CNAME
└── .nojekyll
```

모든 정적 파일 경로는 상대 경로이므로 GitHub 기본 도메인과 커스텀 도메인에서 모두 동작합니다.

## 주요 기능

- 공개 홈: 개인정보 없이 상태별 건수와 최근 요청 10건 표시
- 요청 등록: 유형/장소/제목/내용/이름/학번/PIN 검증, 중복 클릭 방지
- 내 요청: 학번과 4자리 PIN이 모두 일치하는 활성 요청을 최신순 표시
- 학생 삭제: 행을 지우지 않고 `is_deleted=TRUE`, `deleted_at` 기록
- 관리자: 접근 키 확인 후 전체 요청, 상태 필터, 삭제 요청 포함 보기, 상태/답변 수정
- 메일: 삭제되지 않은 `RECEIVED` 요청 중 `email_sent_at`이 비어 있는 요청만 오래된 순으로 한 통에 요약
- 메일 성공 후에만 대상 티켓을 `CHECKING`으로 변경하고 `updated_at`, `email_sent_at` 기록
- PIN: 평문이 아니라 SHA-256 해시 문자열로 저장되며 공개/관리자 API, 메일, 로그에 포함하지 않음
- 오류 화면: API 미설정 및 네트워크 오류 시 안내 표시

## Google Sheets 만들기

1. 운영에 사용할 Google 계정에서 새 Google 스프레드시트를 만듭니다.
2. 주소의 `/d/`와 `/edit` 사이 문자열을 `SPREADSHEET_ID`로 사용합니다.
3. Apps Script 코드를 설정한 후 `initializeSheet()`를 최초 1회 실행합니다. `requests` 시트와 헤더가 자동 생성됩니다.

필요한 컬럼 순서는 다음과 같습니다. 직접 만들 경우 철자와 순서를 정확히 유지해야 합니다.

```text
request_id, created_at, student_id, student_name, pin, category, location,
title, content, status, admin_reply, updated_at, is_deleted, deleted_at,
email_sent_at
```

`request_id`는 서울 시간 날짜를 기준으로 `REQ-YYYYMMDD-0001` 형식으로 생성됩니다. 동시에 등록되어도 Script Lock으로 번호 충돌을 막습니다.

## Apps Script 설정과 배포

상세 절차는 [apps-script/README.md](apps-script/README.md)를 따릅니다. 필수 설정 위치는 [apps-script/Code.gs](apps-script/Code.gs) 맨 위 `CONFIG`입니다.

```javascript
const CONFIG = Object.freeze({
  SPREADSHEET_ID: "1B7iS7AQqKORuNivoala5xcFyPEKlZ9bJKMwuJJkd-Kw",
  SHEET_NAME: "requests",
  ADMIN_EMAIL: "hglee67@kopo.ac.kr", // 관리자 메일은 이 한 곳만 변경
  ADMIN_ACCESS_KEY: "CHANGE_TO_A_LONG_RANDOM_KEY",
  TIMEZONE: "Asia/Seoul",
  SERVICE_NAME: "BigData Help",
  SERVICE_URL: "https://help.k-bigdata.kr/"
});
```

`ADMIN_ACCESS_KEY`에는 사전에 공유하지 않은 긴 무작위 문자열을 넣습니다. 관리자 페이지는 이 값을 브라우저 `sessionStorage`에만 보관합니다. 이 키는 최소한의 접근 제한이며 완전한 계정 인증을 대신하지 않습니다. 더 강한 보안이 필요하면 향후 Google Workspace 로그인/허용 계정 검증을 추가해야 합니다.

Web App 배포는 다음 값을 사용합니다.

- 실행 사용자: 나
- 액세스 권한: 모든 사용자(학생이 로그인 없이 등록해야 하는 경우)
- 코드를 고친 뒤: `배포 관리`에서 반드시 새 버전으로 업데이트

배포된 `/exec` URL을 [js/config.js](js/config.js)의 한 곳에 입력합니다.

```javascript
API_URL: "https://script.google.com/macros/s/배포_ID/exec"
```

## API action

| action | 방식 | 설명 | 개인정보 |
|---|---|---|---|
| `list` | GET | 공개 상태 건수와 최근 요청 | 이름/학번/PIN 제외 |
| `create` | POST | 새 요청 생성 (`RECEIVED`) | PIN 해시 저장 |
| `myRequests` | POST | 학번+PIN 본인 요청 조회 | 일치 티켓만 반환 |
| `delete` | POST | 학번+PIN+요청번호로 Soft Delete | 행 유지 |
| `adminList` | GET | 관리자 전체 요청 | 관리자 키 필요, PIN 제외 |
| `update` | POST | 상태와 관리자 답변 수정 | 관리자 키 필요 |

프론트엔드는 CORS 사전 요청 문제를 줄이기 위해 POST를 `application/x-www-form-urlencoded`로 전송합니다. Apps Script는 JSON POST도 처리할 수 있습니다.

## 오전 8시 자동메일

Apps Script 프로젝트 설정의 시간대를 `Asia/Seoul`로 지정하고 `createDailyTrigger()`를 최초 1회 실행합니다. 함수가 기존 `sendDailyRequestSummary` 트리거를 확인하므로 동일 트리거를 중복 생성하지 않습니다. Apps Script 시간 기반 Trigger 특성상 정확히 08:00:00이 아니라 오전 8시대에 실행됩니다.

처리 순서:

1. `requests` 시트를 읽습니다.
2. `status=RECEIVED`, `is_deleted!=TRUE`, `email_sent_at` 공백인 티켓만 선택합니다.
3. 0건이면 메일을 발송하지 않고 종료합니다.
4. 오래된 요청부터 HTML 카드 한 통으로 묶어 `ADMIN_EMAIL`에 보냅니다.
5. 메일 전송 함수가 성공한 후에만 대상 상태를 `CHECKING`으로 변경합니다.
6. 같은 시각으로 `updated_at`, `email_sent_at`을 기록합니다.

메일 발송이 예외로 실패하면 상태와 `email_sent_at`을 변경하지 않습니다. 오류는 Apps Script의 **실행** 로그에서 확인할 수 있습니다. `email_sent_at`이 이미 있는 비정상 `RECEIVED` 행도 다시 보내지 않아 중복 메일을 방지합니다.

## 자동메일 테스트

- `previewDailyRequestSummary()`: 현재 대상의 HTML을 실행 로그와 반환값으로 확인하며 상태를 바꾸거나 메일을 보내지 않습니다.
- `testDailyRequestSummary()`: 실제 관리자 메일로 발송합니다. 성공하면 실제 운영과 동일하게 대상이 `CHECKING`으로 바뀝니다.
- `sendDailyRequestSummary()`: Trigger가 호출하는 본 함수이며 수동 실행도 가능합니다. 동작은 테스트 함수와 같습니다.

테스트 전에 삭제되지 않은 `RECEIVED` 샘플 티켓을 한 건 이상 등록하세요. 신규 대상이 0건이면 의도대로 아무 메일도 발송하지 않습니다.

## GitHub Pages와 도메인

1. GitHub 저장소 **Settings → Pages**로 이동합니다.
2. **Build and deployment**를 `Deploy from a branch`로 선택합니다.
3. Branch를 `main`, 폴더를 `/(root)`로 선택하고 저장합니다.
4. Custom domain이 자동 인식되지 않으면 `help.k-bigdata.kr`을 입력하고 저장합니다.
5. DNS의 `help.k-bigdata.kr → Hyeopgeon-Lee.github.io` CNAME이 전파된 뒤 **Enforce HTTPS**를 켭니다.

저장소 루트 `CNAME`에도 `help.k-bigdata.kr`이 들어 있습니다. DNS는 이미 설정되었더라도 GitHub Pages의 커스텀 도메인/HTTPS 상태는 별도로 확인해야 합니다.

## 상태 규칙

| 내부 값 | 화면 | 의미 |
|---|---|---|
| `RECEIVED` | 접수 | 신규 등록, 다음 요약 메일 대상 |
| `CHECKING` | 확인중 | 요약 메일 발송 성공 또는 관리자가 변경 |
| `PROCESSING` | 처리중 | 처리 진행 중 |
| `COMPLETED` | 완료 | 처리 완료 |

## 운영 및 보안 참고

- 공개 API에는 학생 이름, 학번, PIN을 반환하지 않습니다.
- 관리자 API에도 PIN 해시는 반환하지 않으며 이메일에도 PIN을 넣지 않습니다.
- 4자리 PIN은 편의를 위한 조회 수단이며 강한 본인 인증이 아닙니다. 민감한 개인정보나 비밀번호를 상세 내용에 작성하지 않도록 안내하세요.
- Apps Script Web App은 학생 접근을 위해 공개되므로 관리자 접근 키를 길고 무작위로 설정하고 주기적으로 교체하세요.
- 실제 학생 개인정보를 README, 커밋, 이슈에 넣지 마세요.

## 향후 확장 후보

- Google Workspace 계정 기반 관리자 인증과 권한 검사
- 관리자 변경 이력/Audit Log
- 접근 키 Script Properties 이전 및 교체 UI
- 요청 유형/장소를 별도 설정 시트에서 관리
- 데이터 보존 기간 및 개인정보 파기 정책

1차 버전 범위에서는 사진/파일 첨부, 회원가입, 소셜 로그인, 문자/Push, 댓글/채팅, 담당자 배정, PWA를 구현하지 않습니다.
