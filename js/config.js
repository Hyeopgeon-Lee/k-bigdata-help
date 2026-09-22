window.APP_CONFIG = Object.freeze({
  API_URL: "YOUR_GOOGLE_APPS_SCRIPT_URL",
  SERVICE_NAME: "BigData Help",
  REQUEST_CATEGORIES: [
    "PC·실습실 장애",
    "소프트웨어 설치·오류",
    "네트워크·인터넷",
    "시설·비품",
    "수업 관련",
    "프로젝트 지원",
    "취업·진로 문의",
    "학과 운영 건의",
    "기타"
  ],
  LOCATIONS: ["8311호", "8318호", "8319호", "기타"],
  LIMITS: Object.freeze({ title: 80, content: 2000 })
});
