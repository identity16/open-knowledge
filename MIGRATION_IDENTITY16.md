# 기존 OpenKnowledge에서 OpenKnowledge16으로 이전하기

이 가이드는 **Inkeep의 `@inkeep/open-knowledge`**를 사용하던 사람을 위한 것입니다.
`openknowledge-sh/openknowledge`는 이름이 비슷한 별도 프로젝트이며 이 가이드의 대상이 아닙니다.

이 fork는 **macOS 13 이상, Apple Silicon의 OpenKnowledge16 데스크톱 앱**과 기존 **웹 GUI + CLI**를 제공합니다.
Intel Mac, Windows, Linux 데스크톱 설치본은 제공하지 않습니다. 문서는 기존 폴더에서 그대로 엽니다.

데스크톱 앱의 이름은 `OpenKnowledge16`, bundle ID는 `com.identity16.openknowledge`입니다.
전역 설정은 `~/.ok16`, 앱 상태는 `~/Library/Application Support/OpenKnowledge16`,
키체인 서비스와 MCP 항목은 `open-knowledge-16`으로 원본과 분리합니다.
기존 전역 설정·로그인은 자동 이전하지 않습니다. 프로젝트 안의 `.ok`와 문서 파일은 그대로 사용합니다.
기존 웹 GUI + CLI 서비스는 `~/.ok`와 `com.identity16.openknowledge` LaunchAgent를 계속 사용합니다.

## 1. 설치 전 확인

편집 중인 문서를 저장하고 기존 앱의 동기화가 끝났는지 확인합니다.
여러 프로젝트 서버를 사용 중이면 `ok ps`로 확인합니다. 자동 설치가 교체하는 서버는
지정한 프로젝트 하나이며, 다른 서버나 별도로 설치한 Electron 앱은 종료하지 않습니다.
원본을 별도 LaunchAgent나 다른 프로세스 관리자로 자동 실행 중이라면 그 자동 실행을
먼저 꺼야 합니다. 자동으로 전환하는 기존 LaunchAgent 이름은 `com.joon.openknowledge`뿐입니다.

다음 도구 확인은 웹 GUI + CLI 설치용입니다. 데스크톱 앱만 설치한다면 2절로 넘어갑니다.
웹 설치에 필요한 도구는 Node.js 24 이상, npm, git입니다. 설치본은 GitHub에서, 런타임 의존성은
npm에서 받습니다. Node.js와 npm 경로는 서비스 설정에 기록되므로 나중에 Node.js를
다른 위치로 옮기면 설치 명령을 다시 실행합니다.

```sh
node --version
npm --version
git --version
ok --version
ok ps
```

이 fork의 최초 배포는 upstream `main`에서 빌드합니다. 기존 0.76.0 패키지와 동일한
소스라는 의미는 아닙니다. Release의 태그와 연결된 commit이 실제 소스 기준입니다.
백업을 건너뛰지 마세요. 새 버전이 설정이나 내부 데이터를 변경할 수 있습니다.

## 2. OpenKnowledge16 데스크톱 설치

[최신 fork Release](https://github.com/identity16/open-knowledge/releases/latest)에서
`OpenKnowledge16-arm64.dmg`를 받아 앱을 **Applications**로 옮깁니다.
Apple Developer ID로 서명하고 공증한 앱이며, Node.js나 Rust를 따로 설치할 필요가 없습니다.
원본 `OpenKnowledge.app`을 덮어쓰지 않습니다. 원본 앱의 자동 업데이트로 이 fork로 전환하지도 않습니다.

앱을 열고 기존 문서 폴더를 선택합니다. 필요한 계정은 새로 로그인하고, 온보딩에서 선택하면
`ok16`·`openknowledge16` 명령과 fork용 MCP 항목을 설치합니다.
CLI shim은 `~/.ok16/bin`에 생성되며 원본 `ok`·`open-knowledge`와 구분됩니다.
앱 전용 URL scheme은 `openknowledge16://`입니다. 원본 도메인의 Universal Links는 등록하지 않습니다.

## 3. 웹 GUI + CLI 설치

```sh
git clone https://github.com/identity16/open-knowledge.git
cd open-knowledge
node scripts/fork/install-service.mjs '/문서/프로젝트의/절대경로'
```

빌드 도구나 Rust는 일반 사용자 설치에 필요하지 않습니다. 설치 스크립트는 다음을 수행합니다.

1. 문서 프로젝트 전체, `~/.ok`, 기존 대상 서비스 설정과 사용자 명령을 백업합니다.
2. `identity16/open-knowledge`의 최신 정식 GitHub Release를 내려받아 SHA-256을 확인합니다.
3. 별도 디렉터리에 설치하고 CLI 실행과 GUI 파일 존재를 확인합니다.
   구버전 프로젝트에 `.ok/config.yml`이 없으면 MCP·전역 skills를 변경하지 않고
   `init --no-mcp --no-skills`로 초기화합니다. Git 저장소가 없으면 함께 생성됩니다.
4. 기존 `com.joon.openknowledge` 서비스가 있으면 비활성화하고 지정 프로젝트 서버를 중지합니다.
5. `com.identity16.openknowledge` 서비스를 등록해 로그인 시 웹 GUI 서버를 시작합니다.

다운로드나 설치 검증이 실패하면 기존 서비스 중지 단계에 도달하지 않습니다.
기존 npm 전역 패키지는 삭제하지 않아 복구할 수 있습니다.
백업에는 문서와 개인 설정이 포함됩니다. 공유하거나 저장소에 커밋하지 마세요.
프로젝트가 크면 전체 백업에 그만큼의 디스크 공간이 필요합니다.

설치 경로는 `~/.local/share/com.identity16.openknowledge/`이고,
백업 경로는 설치 출력과 그 아래 `migration.json`에 기록됩니다.
이 경로와 `~/.ok`는 서로 다른 역할이므로 어느 쪽도 삭제하지 마세요.

`~/.local/bin`이 PATH에서 기존 npm 명령보다 앞에 와야 합니다.
우선 현재 셸에서 아래를 실행하고, 필요하면 같은 export를 셸 설정에 추가합니다.

```sh
export PATH="$HOME/.local/bin:$PATH"
command -v ok
ok --version
```

기존 MCP 설정이 `ok` 또는 `open-knowledge`를 실행한다면 새 PATH를 쓰는 에디터를
다시 시작합니다. `/opt/homebrew/bin/ok` 같은 절대 경로나
`npx @inkeep/open-knowledge@latest`가 저장돼 있다면 그 항목을
`/Users/사용자명/.local/bin/ok mcp`에 해당하는 실행 경로·인자로 바꾸세요.
설치 스크립트는 모든 에디터 설정을 일괄 수정하지 않습니다.

## 4. 웹 GUI + CLI 이전 결과 확인

```sh
node "$HOME/.local/share/com.identity16.openknowledge/channel.mjs" status
launchctl print "gui/$(id -u)/com.identity16.openknowledge"
ok ps
```

`status`의 repository는 `identity16/open-knowledge`여야 합니다.
이 서비스의 웹 주소는 `http://localhost:8080`입니다. 8080을 다른 앱이 쓰고 있다면
설치 전에 정리해야 합니다. 자동 서비스의 idle shutdown은 꺼져 있습니다.

웹 GUI에서 기존 문서·이미지·링크가 보이는지 확인한 다음, 임시 문서 하나를 만들어
저장하고 새로고침 후에도 내용이 남는지 확인합니다. Git 연동과 agent 연결도 사용하던
프로젝트에서 각각 확인하세요. 로컬 인증 정보가 남아 있어도 서비스별로 재로그인이
필요할 수 있습니다.

로그는 다음 파일에 기록됩니다.

```sh
tail -n 80 "$HOME/.local/share/com.identity16.openknowledge/service.log"
```

## 5. 업데이트

### OpenKnowledge16 데스크톱

앱의 업데이트 확인 메뉴에서 새 버전을 확인합니다. 업데이트는 이 fork의 정식 GitHub Release에서만
받으며 Inkeep의 업데이트 서버나 npm 배포를 사용하지 않습니다.
업데이트용 ZIP과 `latest-mac.yml`은 DMG·웹 설치 파일과 같은 Release에 게시됩니다.
manifest는 버전별 고정 다운로드 주소와 checksum을 담아 배포 중 파일이 섞이지 않게 합니다.
수동 설치도 같은 Release의 DMG를 사용합니다.

### 웹 GUI + CLI

서비스가 시작될 때 내 레포의 최신 **정식 GitHub Release**를 확인합니다.
`main`의 새 commit, upstream npm의 `latest`, prerelease는 자동 설치하지 않습니다.
실행 중인 서비스를 주기적으로 재시작하는 cron도 없습니다.
업데이트를 바로 적용하려면 다음 명령을 실행합니다.

```sh
openknowledge-update
```

다운로드·checksum·CLI 검증이 실패하면 설치된 버전을 유지합니다.
처음 설치하거나 새 버전의 런타임 의존성을 설치할 때는 npm 접근도 필요합니다.
checksum은 파일 손상을 검사하며 독립적인 서명 검증을 대신하지 않습니다.

## 6. 직전 fork 버전으로 되돌리기

데스크톱은 설치본이 있는 이전 Release의 DMG로 교체합니다. 앱·문서·설정을 먼저 백업하세요.
버전 교체는 설정·문서를 과거 상태로 되돌리지 않습니다. 아래 명령은 웹 GUI + CLI용입니다.

fork 업데이트를 한 번 이상 적용한 경우에 사용할 수 있습니다.
최초 이전 직후에는 아래의 원본 복구 절차를 사용합니다.

```sh
node "$HOME/.local/share/com.identity16.openknowledge/channel.mjs" rollback
launchctl kickstart -k "gui/$(id -u)/com.identity16.openknowledge"
```

rollback한 버전은 고정되어 서비스 재시작 시 최신 버전으로 다시 올라가지 않습니다.
고정을 해제하고 최신 Release를 적용할 때 `openknowledge-update`를 실행합니다.
버전 rollback은 설정·문서·내부 데이터까지 과거로 되돌리지는 않습니다.

## 7. 원본 Inkeep 버전으로 복구하기

데스크톱은 OpenKnowledge16을 종료하고 원본 OpenKnowledge 앱을 다시 실행합니다.
OpenKnowledge16의 별도 설정은 보존됩니다. 아래 명령은 기존 웹 GUI + CLI 서비스 복구용입니다.

```sh
node scripts/fork/restore-original.mjs
```

이 명령은 fork 서버를 중지하고 `~/.local/bin`의 fork 명령을 복구 또는 제거합니다.
기존 `com.joon.openknowledge` 서비스 설정이 있으면 다시 활성화합니다.
기존 서비스가 없으면 원래 설치했던 npm 패키지의 `ok start`로 서버를 실행합니다.

문서와 `~/.ok`는 자동으로 과거 상태로 덮어쓰지 않습니다. 먼저 원본 버전에서 문서가
정상적으로 열리는지 확인하세요. 설정·내부 데이터의 하위 호환성 문제라면 양쪽 서버를
중지한 상태에서 현재 `~/.ok`와 프로젝트 `.ok`를 별도 보관하고 `migration.json`이
가리키는 백업의 `user-ok`와 `project/.ok`를 각각 복구합니다. 백업 이후 생긴 문서나
메타데이터를 잃지 않도록 프로젝트 전체를 무조건 덮어쓰지는 마세요.

## 유지관리자: 다음 Release 만들기

소스 변경을 fork의 `main`에 반영한 뒤 GitHub Actions의 **OpenKnowledge16 Release**를 수동 실행합니다.
브랜치는 `main`, 버전은 `0.76.0-identity16.4`처럼 기존 Release보다 큰 새 버전을 지정합니다.
태그 push로 서명 작업을 시작하지 않습니다. 서명 자격증명은 `main`에서만 사용할 수 있습니다.

workflow는 빌드·공증·패키징·공개를 별도 job으로 실행합니다. 웹 GUI + CLI의 renderer를
데스크톱에서도 사용하며 중복 빌드하지 않습니다. 서명된 macOS arm64 앱을 저장한 뒤 공증을 제출하고,
공증 submission ID도 대기 전에 저장합니다.
앱 식별자·아키텍처·서명·공증 ticket·Gatekeeper·번들 CLI 버전을 검증하고,
DMG·업데이트 ZIP·manifest·웹 설치 파일·checksum을 같은 draft Release에 올립니다.
GitHub에 올라간 파일의 크기와 SHA-256이 로컬 산출물과 모두 같아야 정식 Release로 공개합니다.
태그는 `identity16-v<버전>`이며 실제 앱을 빌드한 원본 source commit을 가리킵니다.
이 workflow는 Inkeep의 npm namespace에 publish하지 않습니다.

GitHub environment `release-signing`을 `main` 전용으로 설정하고 다음 secrets를 등록합니다.

- `CSC_LINK`: Developer ID Application 인증서와 개인키를 담은 `.p12`의 base64 값
- `CSC_KEY_PASSWORD`: `.p12` 암호
- `APPLE_API_KEY`: 전용 App Store Connect Team API key의 PEM 내용
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`: 해당 키의 식별자

공증 키에는 Developer 역할이 필요합니다. 키가 별도여도 Apple Team API key의 권한은 특정 앱 하나로
제한되지 않습니다. Developer Program 멤버십·약관 동의·인증서 유효 상태를 유지해야 합니다.
서명 키는 임시 키체인에 넣고 빌드 종료 시 정리합니다. 비밀값은 저장소에 커밋하지 않습니다.

실패한 draft는 최신 정식 Release를 바꾸지 않습니다. 실패한 실행에서 **Re-run failed jobs**를 누르면
저장된 서명 앱과 공증 ID를 재사용합니다. Apple 대기 시간이 초과되어도 같은 앱을 다시 제출하지 않습니다.
공증 제출 직후 metadata 저장이 실패했으면 동일한 앱의 checksum이 포함된 제출 이름으로 Apple 기록을 복구합니다.

workflow 코드를 고친 뒤 새 실행으로 이어가려면 같은 `version`과 **원본 빌드 실행의 `resume_run_id`**를
입력합니다. 중간 재개 실행의 ID 대신 최초 서명 앱을 저장한 실행 ID를 사용하세요. 원본 실행이 이 저장소의
main 수동 release workflow인지 확인하고, 원본 source가 현재 main의 ancestor인지 검증합니다.
버전·원본 source SHA·파일 크기·SHA-256이 일치해야 재사용하며, 원본 빌드의 아이콘·패키징 리소스도 유지합니다.
새 workflow commit으로 재개해도 태그는 원본 빌드 source를 가리킵니다.

서명 앱·공증 ID·검증 완료 metadata는 Actions artifact에 **3일간** 보관합니다. 서명 인증서와 개인키는
artifact에 포함하지 않습니다. 최종 설치 파일은 draft Release에 보관하고 공개 job에서 크기·checksum을
다시 검증합니다. 공개 job만 실패했다면 재빌드·재공증 없이 공개를 재시도합니다.
artifact가 만료되거나 손상되면 재개는 중단되며, 새 빌드에는 새 버전을 사용하세요.
이미 공개된 파일은 수정하지 않습니다. 공개 직후 확인 단계만 실패한 재시도는 일치하는 기존 Release를 확인하고
성공 처리하며, 더 최신 Release가 있더라도 latest를 과거 버전으로 바꾸지 않습니다.

일반 사용자 설치에는 GitHub 인증이 필요하지 않습니다. 포크를 수정해 배포할 때
GPL-3.0-or-later 의무와 제3자 고지를 유지해야 합니다.

## 유지관리자: upstream 동기화 PR

**identity16 Upstream Sync** workflow가 매주 월요일 오전 9시(KST, UTC 월요일 00:00)에
`inkeep/open-knowledge/main`을 확인합니다. GitHub의 예약 실행은 부하에 따라 지연될 수
있으며, Actions 화면에서 수동 실행할 수도 있습니다.

원본에 새 commit이 있으면 **원본 `inkeep:main` → fork `main`** PR을 열고, 이미 열린
PR이 있으면 그 PR의 설명을 갱신합니다. PR의 head가 원본 main이므로 열린 동안에는
upstream의 새 commit이 PR에 바로 반영됩니다. 변경이 없으면 PR을 만들지 않습니다.
같은 upstream commit의 PR을 닫아 거절했다면 원본이 움직일 때까지 다시 열지 않습니다.

자동화는 원본이나 fork의 브랜치를 수정하지 않으며, 충돌 해결·자동 머지·Release 배포도
수행하지 않습니다. 필요한 GitHub 권한은 저장소 읽기와 PR 쓰기이며, 별도 PAT나
장기 유효 토큰은 사용하지 않습니다. 저장소의 Actions PR 생성 설정은 활성화합니다.

PR은 검증 결과를 보증하지 않습니다. 변경을 검토하고 빌드·타입체크·테스트를 확인한 뒤
**Create a merge commit**으로 머지하세요. Squash/rebase merge를 사용하면 upstream
commit의 ancestry가 사라져 다음 동기화에서 같은 변경이 다시 제안될 수 있습니다.
충돌이 있으면 fork의 새 브랜치에서 upstream을 merge해 해결하고 대체 PR을 여세요.
새 Release는 앞 절차에 따라 별도로 배포하며, PR 생성이나 머지만으로 로컬 앱이
업데이트되지는 않습니다.
