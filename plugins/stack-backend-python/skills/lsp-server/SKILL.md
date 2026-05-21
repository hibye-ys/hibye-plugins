---
name: lsp-server
description: "REQUIRED for backend/lsp/ — without this skill you WILL miss the 4-class architecture (LSPManager, LSPRegistry, LSPInstance, LSPBridge), invalidate_entity_cache() on document change, cleanup_stale_instances() with 5-minute threshold, asyncio.wait_for(timeout=10) for agent call safety, and @ as completion trigger character. Load BEFORE adding any LSP feature."
allowed-tools: Read, Write, Edit, Grep, Glob
---

## Core Rules (non-negotiable — baseline misses ALL of these)
1. MUST implement 4-class architecture: `LSPManager`, `LSPRegistry`, `LSPInstance`, `LSPBridge`
2. MUST implement `invalidate_entity_cache()` on document change
3. MUST implement `cleanup_stale_instances()` with 5-minute threshold
4. MUST use `asyncio.wait_for(timeout=10)` for agent call safety
5. MUST register `@` as completion trigger character

# lsp-server — LSP 서버 구조 청사진

## 이 skill은 언제 로드되는가

- `backend/lsp/server.py`, `completions.py`, `diagnostics.py`, `hover.py`,
  `semantic_tokens.py` 최초 작성 또는 수정
- LSP-Agent bridge 코드 작성 (`backend/lsp/bridge.py`)
- "completion이 안 뜬다", "diagnostic이 stale 텍스트에 걸려있다",
  "IDE 클라이언트가 30초 후 disconnect" 같은 디버깅

## LSP server의 정체성

프론트엔드 prose 에디터(Monaco / CodeMirror)에 **서사 텍스트 편집 지능**을 제공한다.
코드 편집기의 LSP와 같은 프로토콜이지만 대상이 **세계관 서사 텍스트**이다.

4 core capabilities:

1. **Entity Completion** — `@` 입력 시 엔티티 이름 자동완성 (aliases 포함)
2. **Diagnostics** — 실시간 일관성 경고. Hard Rule(결정론적) + World Rule(결정론적) +
   Soft Rule(LLM 기반, debounced)
3. **Hover Info** — 엔티티명 호버 시 요약 카드 (마크다운)
4. **Go to Definition** — 엔티티 클릭 → canonical URI 위치로 이동

## pygls scaffolding

pygls로 LSP 서버 구성. FastAPI와 **같은 프로세스**, 별도 asyncio task, WebSocket 통신.

```python
# backend/lsp/server.py
"""App LSP server — pygls-based prose editor language intelligence."""
from __future__ import annotations
import logging
from lsprotocol import types as lsp
from pygls.server import LanguageServer
from backend.lsp.bridge import LSPBridge
from backend.lsp.manager import LSPManager

logger = logging.getLogger(__name__)

def create_lsp_server(data_reader, bridge: LSPBridge) -> LanguageServer:
    server = LanguageServer("app-lsp", "0.1.0")
    manager = LSPManager.get_instance(data_reader=data_reader, bridge=bridge)

    @server.feature(lsp.INITIALIZE)
    def on_initialize(params: lsp.InitializeParams) -> lsp.InitializeResult:
        return lsp.InitializeResult(capabilities=lsp.ServerCapabilities(
            text_document_sync=lsp.TextDocumentSyncOptions(
                open_close=True, change=lsp.TextDocumentSyncKind.Full,
            ),
            completion_provider=lsp.CompletionOptions(
                trigger_characters=["@"], resolve_provider=False,
            ),
            hover_provider=True,
            diagnostic_provider=lsp.DiagnosticOptions(
                identifier="app", inter_file_dependencies=False,
                workspace_diagnostics=False,
            ),
            definition_provider=True,
        ))

    @server.feature(lsp.TEXT_DOCUMENT_DID_OPEN)
    async def on_did_open(params: lsp.DidOpenTextDocumentParams) -> None:
        uri, text = params.text_document.uri, params.text_document.text
        manager.register_document(uri, text)
        server.publish_diagnostics(uri, await manager.compute_diagnostics(uri))

    @server.feature(lsp.TEXT_DOCUMENT_DID_CHANGE)
    async def on_did_change(params: lsp.DidChangeTextDocumentParams) -> None:
        uri = params.text_document.uri
        manager.update_document(uri, params.content_changes[0].text)
        server.publish_diagnostics(uri, await manager.compute_diagnostics(uri))

    @server.feature(lsp.TEXT_DOCUMENT_COMPLETION)
    async def on_completion(params: lsp.CompletionParams) -> lsp.CompletionList | None:
        items = await manager.compute_completions(
            params.text_document.uri, params.position)
        return lsp.CompletionList(is_incomplete=False, items=items) if items else None

    @server.feature(lsp.TEXT_DOCUMENT_HOVER)
    async def on_hover(params: lsp.HoverParams) -> lsp.Hover | None:
        return await manager.compute_hover(
            params.text_document.uri, params.position)

    @server.feature(lsp.TEXT_DOCUMENT_DEFINITION)
    async def on_definition(params: lsp.DefinitionParams) -> lsp.Location | None:
        return await manager.compute_definition(
            params.text_document.uri, params.position)

    return server
```

> `TextDocumentSyncKind.Full` — 변경 시 전체 텍스트 수신. Incremental diff 는
> prose 에디터에서 이득이 거의 없고 복잡도만 올린다.

## 3-tier 구조

```
┌───────────────────────────────────────────────┐
│  LSPManager (singleton)                        │
│  ├─ LSPBridge (agent 호출 gateway)              │
│  ├─ DataReader (엔티티 데이터 접근)               │
│  └─ registries: dict[str, LSPRegistry]         │
│      ├─ LSPRegistry (per workspace)            │
│      │   ├─ entity_cache: dict[str, dict]      │
│      │   └─ instances: dict[str, LSPInstance]   │
│      │       ├─ LSPInstance (per document)      │
│      │       │   uri / text / version /         │
│      │       │   last_diagnostics               │
│      │       └─ ...                            │
│      └─ LSPRegistry (per workspace) ...        │
└───────────────────────────────────────────────┘
```

### LSPManager (singleton)

```python
# backend/lsp/manager.py
class LSPManager:
    _instance: LSPManager | None = None

    def __init__(self, data_reader, bridge: LSPBridge) -> None:
        self._data_reader = data_reader
        self._bridge = bridge
        self._registries: dict[str, LSPRegistry] = {}

    @classmethod
    def get_instance(cls, data_reader=None, bridge=None) -> LSPManager:
        if cls._instance is None:
            if data_reader is None or bridge is None:
                raise RuntimeError("LSPManager not initialized")
            cls._instance = cls(data_reader=data_reader, bridge=bridge)
        return cls._instance

    def register_document(self, uri: str, text: str) -> None:
        self._get_or_create_registry(uri).register_instance(uri, text)

    def update_document(self, uri: str, text: str) -> None:
        registry = self._get_or_create_registry(uri)
        inst = registry.get_instance(uri)
        if inst is None:
            registry.register_instance(uri, text)
        else:
            inst.text, inst.version = text, inst.version + 1

    def unregister_document(self, uri: str) -> None:
        registry = self._get_or_create_registry(uri)
        registry.remove_instance(uri)
        if registry.is_empty():
            del self._registries[self._extract_workspace(uri)]

    async def compute_diagnostics(self, uri): ...   # delegates to registry
    async def compute_completions(self, uri, pos): ...
    async def compute_hover(self, uri, pos): ...
    async def compute_definition(self, uri, pos): ...

    @staticmethod
    def _extract_workspace(uri: str) -> str:
        return uri.rsplit("/", 1)[0] if "/" in uri else uri

    @classmethod
    def reset(cls) -> None:  # test-only
        cls._instance = None
```

### LSPRegistry (per workspace)

```python
# backend/lsp/registry.py
class LSPRegistry:
    def __init__(self, workspace_uri: str, data_reader, bridge) -> None:
        self.workspace_uri = workspace_uri
        self._data_reader = data_reader
        self._bridge = bridge
        self._instances: dict[str, LSPInstance] = {}
        self._entity_cache: dict[str, dict] = {}
        self._entity_cache_valid = False

    def register_instance(self, uri: str, text: str) -> None: ...
    def get_instance(self, uri: str) -> LSPInstance | None: ...
    def remove_instance(self, uri: str) -> None: ...
    def is_empty(self) -> bool: ...

    async def _ensure_entity_cache(self) -> dict[str, dict]:
        """Lazy-load entities + aliases from data layer."""
        if not self._entity_cache_valid:
            entities = await self._data_reader.list_entities()
            self._entity_cache = {e["name"]: e for e in entities}
            for e in entities:
                for alias in e.get("aliases", []):
                    self._entity_cache[alias] = e
            self._entity_cache_valid = True
        return self._entity_cache

    def invalidate_entity_cache(self) -> None:
        self._entity_cache_valid = False

    async def compute_completions(self, uri, position) -> list[lsp.CompletionItem]:
        instance = self.get_instance(uri)
        if not instance: return []
        cache = await self._ensure_entity_cache()
        prefix = instance.get_word_at(position)
        return [lsp.CompletionItem(
            label=name, kind=lsp.CompletionItemKind.Reference,
            detail=ent.get("type", "entity"), documentation=ent.get("summary", ""),
        ) for name, ent in cache.items()
            if not prefix or name.lower().startswith(prefix.lower())]

    async def compute_hover(self, uri, position) -> lsp.Hover | None:
        instance = self.get_instance(uri)
        if not instance: return None
        word = instance.get_word_at(position)
        entity = (await self._ensure_entity_cache()).get(word) if word else None
        if not entity: return None
        md = f"### {entity['name']}\n**Type**: {entity.get('type','unknown')}\n\n"
        md += entity.get("summary", "No summary available.")
        return lsp.Hover(contents=lsp.MarkupContent(
            kind=lsp.MarkupKind.Markdown, value=md))
```

### LSPInstance (per document)

```python
# backend/lsp/instance.py
from dataclasses import dataclass, field
from lsprotocol import types as lsp

@dataclass
class LSPInstance:
    uri: str
    text: str
    version: int = 0
    last_diagnostics: list[lsp.Diagnostic] = field(default_factory=list)

    def get_word_at(self, position: lsp.Position) -> str:
        lines = self.text.splitlines()
        if position.line >= len(lines): return ""
        line = lines[position.line]
        if position.character > len(line): return ""
        start = position.character
        while start > 0 and not line[start-1].isspace() and line[start-1] != "@":
            start -= 1
        end = position.character
        while end < len(line) and not line[end].isspace():
            end += 1
        return line[start:end]
```

## Bridge: LSP <-> Agent

```python
# backend/lsp/bridge.py
"""Translates LSP requests into agent / data layer calls."""
import asyncio, logging
from lsprotocol import types as lsp

logger = logging.getLogger(__name__)
_SOFT_DIAG_DEBOUNCE_SEC = 2.0
_AGENT_TIMEOUT_SEC = 10.0

class LSPBridge:
    def __init__(self, data_reader, agent_runner=None) -> None:
        self._data_reader = data_reader
        self._agent_runner = agent_runner
        self._soft_diag_task: asyncio.Task | None = None

    async def run_diagnostics(self, text: str, uri: str) -> list[lsp.Diagnostic]:
        diags = await self._check_hard_rules(text, uri)
        diags += await self._check_world_rules(text, uri)
        self._schedule_soft_diagnostics(text, uri)  # debounced, fire-and-forget
        return diags

    async def _check_hard_rules(self, text, uri) -> list[lsp.Diagnostic]:
        """Find @mentions that don't match any known entity."""
        entities = await self._data_reader.list_entities()
        names = {e["name"].lower() for e in entities}
        for e in entities:
            names.update(a.lower() for a in e.get("aliases", []))
        diags = []
        for line_idx, line in enumerate(text.splitlines()):
            col = 0
            while col < len(line):
                if line[col] == "@":
                    start, end = col + 1, col + 1
                    while end < len(line) and not line[end].isspace(): end += 1
                    mention = line[start:end]
                    if mention and mention.lower() not in names:
                        diags.append(lsp.Diagnostic(
                            range=lsp.Range(
                                start=lsp.Position(line=line_idx, character=col),
                                end=lsp.Position(line=line_idx, character=end)),
                            severity=lsp.DiagnosticSeverity.Warning,
                            source="app-hard",
                            message=f"Unknown entity: @{mention}"))
                    col = end
                else: col += 1
        return diags

    async def _check_world_rules(self, text, uri) -> list[lsp.Diagnostic]:
        return []  # TODO(): world-state consistency checks

    def _schedule_soft_diagnostics(self, text: str, uri: str) -> None:
        if self._soft_diag_task and not self._soft_diag_task.done():
            self._soft_diag_task.cancel()
        self._soft_diag_task = asyncio.create_task(
            self._run_soft_debounced(text, uri))

    async def _run_soft_debounced(self, text: str, uri: str) -> None:
        await asyncio.sleep(_SOFT_DIAG_DEBOUNCE_SEC)
        try:
            result = await asyncio.wait_for(
                self._collect_agent_result(
                    self._build_diagnostic_prompt(text)),
                timeout=_AGENT_TIMEOUT_SEC)
            # Parse result into diagnostics (see _build_diagnostic_prompt format)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass
        except Exception as e:
            logger.warning("soft_diagnostics_failed", extra={"uri": uri, "error": str(e)})

    async def _collect_agent_result(self, prompt: str) -> str:
        """Non-streaming agent call — see 'App agent 호출 패턴' below."""
        return ""  # : wire to haiku-class agent, max_turns=1

    @staticmethod
    def _build_diagnostic_prompt(text: str) -> str:
        return (
            "Analyze the following narrative for inconsistencies. "
            "Report: LINE:<n> SEVERITY:<warning|error> MESSAGE:<desc>\n\n"
            f"---\n{text}\n---")
```

## Feature 우선순위 + 구현 순서

| 순서 | Feature | 모듈 | 의존 |  |
|------|---------|------|------|----------|
| 1 | **Completion** | `completions.py` | DataReader | Yes |
| 2 | **Diagnostics** | `diagnostics.py` | DataReader + Bridge | Yes |
| 3 | **Hover** | `hover.py` | DataReader | Yes |
| 4 | **Definition** | registry inline | DataReader (canonical_uri) | Yes |
| 5 | **Semantic Tokens** | `semantic_tokens.py` | DataReader + NER + legend | 2d 후기/2e |

근거: Completion 이 가장 단순하고 유저 가치가 크다. Diagnostics 에서 Bridge agent
호출 경로를 처음 검증. Hover 는 entity cache 재사용. Definition 은 가장 얇다.

## App agent 호출 패턴

LSP 는 SSE 와 다르다 — 결과 완전 수집 후에야 CompletionItem/Diagnostic 구성 가능.
**non-streaming collect 패턴**:

```
LSP request → LSPManager → entity cache 필터 (빠름, agent 불필요)
                         → [soft diagnostics만] agent loop 호출
                              → run_agent_loop(max_turns=1)
                              → text event buffer 수집
                              → 파싱 → Diagnostic[] 반환
```

```python
async def _collect_agent_result(self, prompt: str) -> str:
    from backend.engine.loop import run_agent_loop
    buffer: list[str] = []
    async for event in run_agent_loop(
        agent_spec=_LSP_DIAGNOSTIC_AGENT,  # haiku-class, no tools
        user_input=prompt, history=[], max_turns=1,
    ):
        if hasattr(event, "text"):
            buffer.append(event.text)
    return "".join(buffer)
```

> `max_turns=1` 이 핵심. tool_use 루프에 진입하면 IDE 타임아웃을 초과한다.

## 동시성 함정 — 이 서브시스템 고유

1. **stale instance text**
   `didChange` 처리 중 `compute_diagnostics`가 이전 버전 text를 읽는다.
   해결: `update_document` → `compute_diagnostics` 를 같은 await chain 에서
   sequential 호출. 별도 task 분리하면 race condition 발생.

2. **registry memory leak**
   `didOpen` 으로 생성된 LSPInstance 가 `didClose` 누락 시 영원히 남는다(IDE
   비정상 종료). 해결: LSPManager 에 `cleanup_stale_instances(max_age_sec=300)`
   주기적 정리. instance 에 `last_accessed: float` 추가, 5분 이상 미접근 시 제거.

3. **agent loop이 LSP 타임아웃보다 느림**
   IDE 클라이언트는 5-10초 내 응답 기대. agent loop 이 tool_use 에 빠지면 수십 초.
   해결: (a) `max_turns=1` — tool loop 진입 금지 (b) `asyncio.wait_for(timeout=10)`
   hard timeout (c) timeout 시 빈 결과 반환 (fail-open). agent 가 느리다고 IDE 가
   멈추면 안 된다.

## 검증 체크리스트

- [ ] `create_lsp_server` 가 pygls `LanguageServer` 인스턴스 반환
- [ ] 6개 핸들러: INITIALIZE, DID_OPEN, DID_CHANGE, COMPLETION, HOVER, DEFINITION
- [ ] LSPManager singleton — `get_instance()` + `reset()` 패턴
- [ ] LSPRegistry per-workspace — entity cache lazy-load + `invalidate_entity_cache()`
- [ ] LSPInstance dataclass — `uri`/`text`/`version`/`last_diagnostics` + `get_word_at()`
- [ ] LSPBridge.run_diagnostics 가 hard rule(즉시) + soft rule(debounced) 분리
- [ ] agent 호출 시 `max_turns=1` + `asyncio.wait_for(timeout=10)` hard timeout
- [ ] pytest 스켈레톤 1개 이상 (mock DataReader → completion item shape 검증)

## 구현 중 막히면

- **"completion이 안 뜬다"** → `capabilities.completion_provider.trigger_characters`
  에 `@` 포함 확인. 없으면 클라이언트가 요청을 안 보낸다. return 타입이
  `CompletionList | None` 인지 확인 — None 은 미지원, 빈 리스트는 후보 없음.

- **"diagnostic이 stale 텍스트에 걸려있다"** → `on_did_change` 에서
  `update_document` 후 `compute_diagnostics` 를 같은 await chain 에서 호출하는지
  확인. 별도 `create_task` 시 이전 text 로 계산됨. 동시성 함정 #1.

- **"IDE 클라이언트가 30초 후 disconnect"** → WebSocket keepalive ping 누락
  확인. agent 타임아웃 미설정 시 단일 요청 30초 블로킹. 동시성 함정 #3.

- **"entity cache가 갱신되지 않는다"** → `data/writer.py` 엔티티 변경 후
  `LSPRegistry.invalidate_entity_cache()` 호출 확인.
