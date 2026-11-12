# 기존 OpenKnowledge에서 identity16 버전으로 이전하기

이 가이드는 **Inkeep의 `@inkeep/open-knowledge`**를 사용하던 사람을 위한 것입니다.
`openknowledge-sh/openknowledge`는 이름이 비슷한 별도 프로젝트이며 이 가이드의 대상이 아닙니다.

현재 제공하는 fork 설치 채널은 **macOS Apple Silicon의 웹 GUI + CLI**입니다.
Electron `.app`, Intel Mac, Windows, Linux 설치와 자동 업데이트는 아직 제공하지 않습니다.
문서는 기존 폴더에서 계속 사용하고, 사용자 설정 위치도 기존 `~/.ok`를 유지합니다.
서비스와 설치본의 식별자는 `com.identity16.openknowledge`입니다.

## 1. 설치 전 확인

편집 중인 문서를 저장하고 기존 앱의 동기화가 끝났는지 확인합니다.
여러 프로젝트 서버를 사용 중이면 `ok ps`로 확인합니다. 자동 설치가 교체하는 서버는
지정한 프로젝트 하나이며, 다른 서버나 별도로 설치한 Electron 앱은 종료하지 않습니다.

필요한 도구는 Node.js 24 이상, npm, git입니다. 설치본은 GitHub에서, 런타임 의존성은
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

## 2. fork 설치

```sh
git clone https://github.com/identity16/open-knowledge.git
cd open-knowledge
node scripts/identity16/install-service.mjs '/문서/프로젝트의/절대경로'
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

## 3. 이전 결과 확인

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

## 4. 업데이트

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

## 5. 직전 fork 버전으로 되돌리기

fork 업데이트를 한 번 이상 적용한 경우에 사용할 수 있습니다.
최초 이전 직후에는 아래의 원본 복구 절차를 사용합니다.

```sh
node "$HOME/.local/share/com.identity16.openknowledge/channel.mjs" rollback
launchctl kickstart -k "gui/$(id -u)/com.identity16.openknowledge"
```

rollback한 버전은 고정되어 서비스 재시작 시 최신 버전으로 다시 올라가지 않습니다.
고정을 해제하고 최신 Release를 적용할 때 `openknowledge-update`를 실행합니다.
버전 rollback은 설정·문서·내부 데이터까지 과거로 되돌리지는 않습니다.

## 6. 원본 Inkeep 버전으로 복구하기

```sh
node scripts/identity16/restore-original.mjs
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

소스 변경을 내 레포에 push한 뒤 GitHub Actions의 **identity16 Web Release**를 수동
실행하고 `0.76.0-identity16.2`처럼 새로운 fork 버전을 지정합니다.
또는 `identity16-v0.76.0-identity16.2` 형식의 태그를 push합니다.
두 경우 모두 빌드가 끝나야 정식 Release와 설치 파일이 공개됩니다.

이 workflow는 macOS arm64 빌드와 checksum, CLI 패키지를 내 GitHub Release에 올리며
Inkeep의 npm namespace에는 publish하지 않습니다. 일반 사용자 설치에는 GitHub 인증이
필요하지 않습니다. 포크 소스를 수정해 배포할 때 GPL-3.0-or-later 의무와 제3자 고지를
유지해야 합니다. Apache-2.0 프로젝트인 `openknowledge-sh/openknowledge`의 조건과
혼동하지 마세요.
