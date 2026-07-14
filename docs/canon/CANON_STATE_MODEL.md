# Canon State Model V1

```
canon_version: 1.0.0
document_status: APPROVED_V1
approved_by: michael
approval_effective_on_merge: true
document_role: CANON_STATE_MODEL
governs: state layers, state vocabulary, transition rules, human gates, versioning
related_documents:
  - docs/canon/DC2100_STORY_BIBLE_V1.md (Immutable Canon / Dynamic Canon source)
  - docs/canon/APEX_RULES_V1.md (Advancement vocabulary this model formalizes)
  - docs/canon/SEASON_1_GLOBAL_QUALIFIERS.md (Beats that emit these state events)
  - STATUS_FLOW.md (existing, separate content-pipeline status machine)
  - CANON.md (existing world canon and PROPOSED → REVIEWED → CEO_APPROVED → CANON lifecycle)
required_human_gate: all — this document defines the gates themselves
```

## 0. 與既有 STATUS_FLOW.md 的關係

`STATUS_FLOW.md` 定義的是 **Content 記錄**（Signal、Video、Post）的生產流程狀態機
（DISCOVERED → ANALYZED → ... → PUBLISHED → ANALYZING → WINNER/RESERVE_SIGNAL/ARCHIVED）。
本文件定義的是完全不同的一層：**Story / Canon 實體**（Driver、Team、Vehicle、Faction、
Region、Resource、Relationship、Competition）的狀態機。

兩者是獨立的狀態機，不共用同一個 enum，也不互相覆蓋：

- 一支 Short 的 Content 記錄可以是 `PUBLISHED`，而它所描述的 Driver 實體
  同時是 `QUALIFIED`——這是兩個不同層的兩個不同狀態。
- 兩層之間只透過 **Evidence 引用**連結：一個 Canon State 的 transition
  可以引用某個已 `PUBLISHED` 的 Content 記錄作為 `source_content_id`（見第 7 節）。
- `DISCOVERED` 這個詞在兩份文件中都出現，這是刻意的命名重用，代表相同的概念
  （「被系統首次發現，尚未經人工確認」），但作用在不同的實體類型上，
  不代表兩個狀態機共享同一個狀態機定義。

`CANON.md` 既有的 `PROPOSED → REVIEWED → CEO_APPROVED → CANON` 生命週期，
是本文件 `PROPOSED_STATE_CHANGE → CANON_STATE_COMMITTED` 機制（見第 5 節）
的既有雛形；本文件將其正式擴展為可追蹤、可版本化的完整狀態模型。

### Authority Rule

- `CANON_STATE_MODEL.md` governs states, transitions and human gates.
- `DC2100_STORY_BIBLE_V1.md` governs world, tone, factions, technology,
  resources and IP boundaries.
- `APEX_RULES_V1.md` governs competition hierarchy and race rules.
- `SEASON_1_GLOBAL_QUALIFIERS.md` governs Season 1 structure and beats.
- Within these governed scopes, the four approved V1 documents supersede
  conflicting legacy details in `CANON.md`.
- `CANON.md` remains the baseline only for areas not replaced or expanded by
  these V1 documents.
- Any unresolved cross-document conflict must fail closed with
  `CANON_CONFLICT` and require Michael review.

---

## 1. State Layers

| Layer | 說明 |
|---|---|
| GLOBAL | 跨 Season 恆定的世界規則層,對應 Story Bible 的 Immutable Canon。 |
| SEASON | 單一 Season 的起始/結束狀態與整體進程,對應 `SEASON_1_GLOBAL_QUALIFIERS.md`。 |
| REGION | 八個 Region Slot 各自的解鎖與代表名單狀態。 |
| FACTION | 六大 Faction 各自的立場、資源與對外關係狀態。 |
| DRIVER | 個別車手的晉級、資格與生涯狀態。 |
| TEAM | 車隊層級的資格、成員組成與資源狀態。 |
| VEHICLE | 個別車輛的技術狀態與損傷/維修紀錄。 |
| RESOURCE | 第 7 類稀缺資源（Story Bible 第 7 節）的取得與消耗紀錄。 |
| RELATIONSHIP | Driver / Team / Faction 之間的敵對、結盟與破裂關係。 |
| COMPETITION | 賽事層級本身的資格審核、晉級、淘汰事件流。 |

每一個 State（第 2 節）都明確歸屬於一個或多個 Layer，作為其 `valid entity type`。

---

## 2. State Vocabulary

以下每個 State 皆定義：meaning、valid entity type、valid previous states、
allowed next states、required evidence、required human gate、reversible or irreversible、
effect on future scripts。

Gate 名稱對照第 5 節。

**統一 Gate 規則**：`DISCOVERED` 可由系統自動建立，屬於 pre-canon discovery
record，不需要任何 Gate 即可存在，也不會、也不需要成為 `CANON_STATE_COMMITTED`。
除 `DISCOVERED` 外，其餘 21 個 State 一律遵循同一模板，個別條目的
`required human gate` 不得與本模板矛盾：

> Gate X creates or locks the `PROPOSED_STATE_CHANGE`; Gate 7 is required for
> `CANON_STATE_COMMITTED`.

其中 Gate X 依 State 性質而定：候選/資格類 State 使用 Gate 1，敘事類
（Relationship / Resource / Vehicle）State 使用 Gate 3，直接由 Scoring 或
Penalty 產生的競賽結果類 State 直接以 Gate 7 形成並核准提案（無需額外的
Gate 1/3 前置步驟）。Gate 7 一律可對同一 Beat 或同一 Content 內的多筆 State
進行 batch commit。

### DISCOVERED

- **meaning**：一個潛在的 Story 實體（通常來自 Fusion Candidate）首次被系統識別，
  尚未經任何人工確認。
- **valid entity type**：COMPETITION（Candidate 層級，尚非正式 DRIVER/TEAM/VEHICLE 實體）。
- **valid previous states**：無（初始狀態）。
- **allowed next states**：`CANDIDATE_APPROVED`。
- **required evidence**：Fusion Candidate 的 `fusion_evidence` 快照或等效的
  Scanner / Country News / Person Radar 來源訊號。
- **required human gate**：無 Gate 需求 —— `DISCOVERED` 是 pre-canon discovery
  record，由系統自動建立，不會、也不需要成為 `CANON_STATE_COMMITTED`。
- **reversible or irreversible**：Reversible（可被忽略、封存，不產生任何後續 Canon 效果）。
- **effect on future scripts**：不得作為 Script 的正式角色或事件依據，僅供 Gate 1 審核參考。

### CANDIDATE_APPROVED

- **meaning**：Michael 已確認某個 DISCOVERED 候選人/載具/事件足以填入
  `SEASON_1_GLOBAL_QUALIFIERS.md` 定義的 Candidate Slot。
- **valid entity type**：COMPETITION。
- **valid previous states**：`DISCOVERED`。
- **allowed next states**：`QUALIFIER_ENTERED`。
- **required evidence**：Michael 的明確核准紀錄（approved_by、approved_at，見第 7 節）。
- **required human gate**：Gate 1（Candidate Selection）creates/locks the
  `PROPOSED_STATE_CHANGE`；Gate 7（Canon State Commit）is required for
  `CANON_STATE_COMMITTED`，可與同一 Beat 內其他候選核准一併 batch commit。
- **reversible or irreversible**：Reversible（核准後若尚未進入 QUALIFIER_ENTERED，
  可被撤回並退回 DISCOVERED）。
- **effect on future scripts**：Script Pipeline 可開始為此實體撰寫 Driver Introduction
  類內容，但不得賦予其晉級結果。

### QUALIFIER_ENTERED

- **meaning**：實體正式進入某一層級（Global / Regional / World Tour 等）的比賽流程。
- **valid entity type**：DRIVER、TEAM（COMPETITION layer）。
- **valid previous states**：`CANDIDATE_APPROVED`、`RESERVE`（遞補）、
  `WILD_CARD_GRANTED`、`COMEBACK_GRANTED`。
- **allowed next states**：`QUALIFIER_PASSED`、`QUALIFIER_FAILED`、`DISQUALIFIED`、`WITHDRAWN`。
- **required evidence**：`APEX_RULES_V1.md` 第 3 節 Entry Rules 的合規紀錄。
- **required human gate**：Gate 1（Candidate Selection，確認 Entry Rules 合規）
  creates/locks the `PROPOSED_STATE_CHANGE`；Gate 7（Canon State Commit）is
  required for `CANON_STATE_COMMITTED`，可對同一 Beat 內多筆報名一併
  batch commit。不論前置狀態為 `CANDIDATE_APPROVED`、`RESERVE` 遞補、
  `WILD_CARD_GRANTED` 或 `COMEBACK_GRANTED`，每一次進入 `QUALIFIER_ENTERED`
  都須各自完成本次 Gate 7 才能生效。
- **reversible or irreversible**：Reversible（賽事尚未產生結果前）。
- **effect on future scripts**：可撰寫報名、資格審核類 Short（例如 BEAT-01、BEAT-04）。

### QUALIFIER_PASSED

- **meaning**：實體在該層級賽事中依 Scoring 規則達成晉級門檻。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`QUALIFIER_ENTERED`。
- **allowed next states**：下一層級的 `QUALIFIER_ENTERED`，或（若為最終層級）
  `REGION_UNLOCKED` 相關的 Season 收尾事件。
- **required evidence**：`APEX_RULES_V1.md` 第 6 節 Scoring 計算紀錄。
- **required human gate**：Gate 7 — Canon State Commit。
- **reversible or irreversible**：Irreversible（該次晉級是歷史事實，不因後續淘汰而被抹除）。
- **effect on future scripts**：對應 `APEX_RULES_V1.md` 第 7 節的 `QUALIFIED` 顯示狀態；
  Script 可據此撰寫晉級慶祝或壓力類內容。

### QUALIFIER_FAILED

- **meaning**：實體在該層級賽事中未達成晉級門檻。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`QUALIFIER_ENTERED`。
- **allowed next states**：`RESERVE`、`WILD_CARD_ELIGIBLE`、`COMEBACK_PENDING`，
  或無後續狀態（終局淘汰）。
- **required evidence**：`APEX_RULES_V1.md` 第 6 節 Scoring 計算紀錄。
- **required human gate**：Gate 7 — Canon State Commit。
- **reversible or irreversible**：Irreversible（該次淘汰是歷史事實）。
- **effect on future scripts**：對應 `APEX_RULES_V1.md` 第 7 節的 `ELIMINATED` 顯示狀態；
  Script 可據此撰寫淘汰、心理低谷或 Comeback 動機類內容。

### RESERVE

- **meaning**：未直接晉級，但保留有條件的復活可能性。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`QUALIFIER_FAILED`。
- **allowed next states**：`QUALIFIER_ENTERED`（遞補，見 `APEX_RULES_V1.md` 第 8 節）。
- **required evidence**：Scoring 顯示接近晉級門檻，或 Organizers 的故事價值標記。
- **required human gate**：Gate 1（Candidate Selection，核准某 Candidate 值得成為
  Reserve 候選，形成 `PROPOSED_STATE_CHANGE`）→ Gate 7（Canon State Commit，
  正式寫入 `RESERVE` 狀態）。遞補至 `QUALIFIER_ENTERED` 時必須再次通過 Gate 7。
- **reversible or irreversible**：Reversible（可長期停留在此狀態，等待名額空缺）。
- **effect on future scripts**：可撰寫 Underground Circuit 磨練類內容，
  不得撰寫其已晉級的結果。

### WILD_CARD_ELIGIBLE

- **meaning**：符合 Wild Card 提名條件，等待審核。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`QUALIFIER_FAILED`、`RESERVE`。
- **allowed next states**：`WILD_CARD_GRANTED`，或維持原狀（未獲授予）。
- **required evidence**：`APEX_RULES_V1.md` 第 9 節列出的 Evidence 類型
  （Underground Circuit 表現、技術突破、故事必要性）。
- **required human gate**：Gate 1（Candidate Selection）creates/locks the
  `PROPOSED_STATE_CHANGE`；Gate 7（Canon State Commit）is required for
  `CANON_STATE_COMMITTED`。
- **reversible or irreversible**：Reversible。
- **effect on future scripts**：可撰寫「等待審核」的懸念類內容,不得預先撰寫授予結果。

### WILD_CARD_GRANTED

- **meaning**：Wild Card 審核通過，取得晉級資格。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`WILD_CARD_ELIGIBLE`。
- **allowed next states**：`QUALIFIER_ENTERED`（下一層級）。
- **required evidence**：Gate 1 與 Gate 7 雙重核准紀錄。
- **required human gate**：Gate 1 — Candidate Selection，並經 Gate 7 — Canon State Commit 確認。
- **reversible or irreversible**：Irreversible（授予後即為歷史事實）。
- **effect on future scripts**：Script 必須明確說明其 Evidence 基礎，
  不得暗示此授予僅因人氣（見 `APEX_RULES_V1.md` 第 12 節 Traffic Boundary）。

### COMEBACK_PENDING

- **meaning**：已提出 Comeback 申請,代價尚未完成。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`WITHDRAWN`、`QUALIFIER_FAILED`。
- **allowed next states**：`COMEBACK_GRANTED`，或維持原狀（代價未完成）。
- **required evidence**：`APEX_RULES_V1.md` 第 10 節指定的具體代價條款
  （新資格賽 / 資源損失 / 車輛降級 / 勢力交換 / 關係破裂 / 公開挑戰）。
- **required human gate**：Gate 1（Candidate Selection）creates/locks the
  `PROPOSED_STATE_CHANGE`；Gate 7（Canon State Commit）is required for
  `CANON_STATE_COMMITTED`。
- **reversible or irreversible**：Reversible（代價可長期未完成而不影響其他狀態）。
- **effect on future scripts**：Script 必須呈現代價本身的執行過程,不得跳過代價直接寫成功。
- **restriction**：`DISQUALIFIED` 實體在同一 Season 內不得進入本狀態（與 Wild Card
  相同限制，見 `APEX_RULES_V1.md` 第 7 節與 `DC2100_STORY_BIBLE_V1.md` 第 13.3 節
  Locked Decision）。跨 Season 重新申請後的全新 `DISCOVERED` 候選不受此限制，
  但仍需依序通過 Gate 1 與 Gate 7 的完整審核流程。

### COMEBACK_GRANTED

- **meaning**：Comeback 代價已完成並經審核通過,重新取得參賽資格。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`COMEBACK_PENDING`。
- **allowed next states**：`QUALIFIER_ENTERED`。
- **required evidence**：代價完成的具體 Evidence（例如公開挑戰勝利紀錄）。
- **required human gate**：Gate 7 — Canon State Commit。
- **reversible or irreversible**：Irreversible。
- **effect on future scripts**：可撰寫復出後的首場賽事內容。

### RIVALRY_CREATED

- **meaning**：兩個 DRIVER / TEAM / FACTION 實體之間建立正式的敵對關係。
- **valid entity type**：RELATIONSHIP（連結 DRIVER、TEAM 或 FACTION 任意組合）。
- **valid previous states**：無（初始關係狀態）。
- **allowed next states**：維持原狀，或透過新的 Beat 演化（不透過本狀態機直接轉為 Alliance）。
- **required evidence**：Outline 或 Script 中明確描寫的衝突事件記錄。
- **required human gate**：Gate 3（Outline Lock，鎖定 Outline 並形成
  `PROPOSED_STATE_CHANGE`）→ Gate 7（Canon State Commit，可與同一 Beat 內
  其他敘事性 State 一併 batch commit）。
- **reversible or irreversible**：Reversible（關係性質可在後續 Season 被重新詮釋，
  但本次事件的歷史紀錄不可抹除）。
- **effect on future scripts**：後續 Script 涉及此二實體互動時，必須尊重此敵對關係
  作為既定背景，不得無故忽略。

### ALLIANCE_CREATED

- **meaning**：兩個或多個實體之間建立正式的合作關係。
- **valid entity type**：RELATIONSHIP。
- **valid previous states**：無，或 `RIVALRY_CREATED`（敵轉友需經 Gate 3 明確敘事支持）。
- **allowed next states**：`ALLIANCE_BROKEN`。
- **required evidence**：Outline 或 Script 中明確描寫的合作建立事件記錄。
- **required human gate**：Gate 3（Outline Lock，形成 `PROPOSED_STATE_CHANGE`）
  → Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Reversible（可被 ALLIANCE_BROKEN 終止）。
- **effect on future scripts**：後續 Script 必須將此合作關係視為既定背景。

### ALLIANCE_BROKEN

- **meaning**：既有的合作關係正式終止。
- **valid entity type**：RELATIONSHIP。
- **valid previous states**：`ALLIANCE_CREATED`。
- **allowed next states**：無（此關係實例終結；若雙方後續再次合作，
  須建立新的 `ALLIANCE_CREATED` 實例）。
- **required evidence**：Outline 或 Script 中明確描寫的破裂事件記錄。
- **required human gate**：Gate 3（Outline Lock，形成 `PROPOSED_STATE_CHANGE`）
  → Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Irreversible（此次破裂為歷史事實）。
- **effect on future scripts**：後續 Script 若描寫雙方重新合作，必須明確處理為
  新的關係弧線，不得假裝破裂未曾發生。

### RESOURCE_ACQUIRED

- **meaning**：一個 TEAM / FACTION / REGION 取得特定稀缺資源
  （Story Bible 第 7 節列出的類別之一）。
- **valid entity type**：RESOURCE（歸屬 TEAM、FACTION 或 REGION）。
- **valid previous states**：無，或 `RESOURCE_LOST`（重新取得）。
- **allowed next states**：`RESOURCE_LOST`。
- **required evidence**：Beat 中明確指定的資源取得事件與資源類別。
- **required human gate**：Gate 3（Outline Lock，形成 `PROPOSED_STATE_CHANGE`）
  → Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Reversible。
- **effect on future scripts**：後續 Script 中該實體的資源餘量必須反映此次取得。

### RESOURCE_LOST

- **meaning**：一個 TEAM / FACTION / REGION 失去特定稀缺資源。
- **valid entity type**：RESOURCE。
- **valid previous states**：`RESOURCE_ACQUIRED`，或無（初始匱乏狀態）。
- **allowed next states**：`RESOURCE_ACQUIRED`。
- **required evidence**：Beat 中明確指定的資源損失事件與資源類別。
- **required human gate**：Gate 3（Outline Lock，形成 `PROPOSED_STATE_CHANGE`）
  → Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Reversible。
- **effect on future scripts**：後續 Script 必須反映該實體因資源匱乏產生的
  實際限制（例如無法完成特定 Race Format）。

### VEHICLE_DAMAGED

- **meaning**：特定 VEHICLE 實體因賽事或事件受損。
- **valid entity type**：VEHICLE。
- **valid previous states**：無，或 `VEHICLE_REPAIRED`。
- **allowed next states**：`VEHICLE_REPAIRED`。
- **required evidence**：Race Format 結果紀錄或 Beat 事件描述。
- **required human gate**：Gate 3（Outline Lock，形成 `PROPOSED_STATE_CHANGE`）
  → Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Reversible。
- **effect on future scripts**：後續 Script 必須反映該車輛的實際受損狀態，
  直到 `VEHICLE_REPAIRED` 發生前不得描寫其恢復滿血表現。

### VEHICLE_REPAIRED

- **meaning**：受損車輛完成修復，恢復可競爭狀態。
- **valid entity type**：VEHICLE。
- **valid previous states**：`VEHICLE_DAMAGED`。
- **allowed next states**：`VEHICLE_DAMAGED`。
- **required evidence**：修復事件紀錄，須消耗對應的 Repair Time 與 Mechanical Parts 資源
  （見 Story Bible 第 7 節）。
- **required human gate**：Gate 3（Outline Lock，形成 `PROPOSED_STATE_CHANGE`）
  → Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Reversible。
- **effect on future scripts**：修復必須呈現時間與資源代價，不得描寫為瞬間完成。

### TEAM_CHANGED

- **meaning**：一名 DRIVER 更換所屬 TEAM。
- **valid entity type**：DRIVER（連動 TEAM）。
- **valid previous states**：無（每次更換皆為獨立事件）。
- **allowed next states**：`TEAM_CHANGED`（可再次發生，各自為獨立歷史事件）。
- **required evidence**：`APEX_RULES_V1.md` 第 3 節 Team Eligibility 的重新提交紀錄。
- **required human gate**：Gate 1（Candidate Selection，核准資格重新提交，形成
  `PROPOSED_STATE_CHANGE`）→ Gate 7（Canon State Commit，可 batch commit）。
- **reversible or irreversible**：Irreversible（每次變更本身是歷史事實，
  但實體可再次變更產生新的事件）。
- **effect on future scripts**：後續 Script 必須反映該 Driver 目前的實際所屬 Team，
  不得沿用舊有 Team 關係。

### REGION_LOCKED

- **meaning**：一個 Region Slot 的初始狀態，代表該 Region 尚未產出任何正式賽事結果，
  對 World Tour 尚未開放。
- **valid entity type**：REGION。
- **valid previous states**：無（Season 初始化時的預設狀態）。
- **allowed next states**：`REGION_UNLOCKED`。
- **required evidence**：Season initialization record（Season 大綱正式生效的紀錄，
  見 `SEASON_1_GLOBAL_QUALIFIERS.md` 第 2 節 Beginning State）。
- **required human gate**：initial Season approval（Season 大綱本身的 Gate 7 — Canon
  State Commit，於 Season 開始時一次性套用至全部 Region Slot）。
- **reversible or irreversible**：Irreversible within the same Season（同一 Season
  內，一旦轉為 `REGION_UNLOCKED` 後不得回復為 `REGION_LOCKED`）。
- **effect on future scripts**：`REGION_LOCKED` 狀態下，該 Region 的賽事結果
  不得被 Script 當作最終結果處理，僅能撰寫尚在進行中的賽事過程。

### REGION_UNLOCKED

- **meaning**：一個 Region Slot 的賽事結果正式產出，該 Region 對 World Tour 開放。
- **valid entity type**：REGION。
- **valid previous states**：`REGION_LOCKED`。
- **allowed next states**：無（Season 內為終局狀態）。
- **required evidence**：該 Region 全部 Final Circuit 賽事的 Scoring 結果彙總。
- **required human gate**：Gate 7 — Canon State Commit。
- **reversible or irreversible**：Irreversible。
- **effect on future scripts**：解鎖後,該 Region 的代表名單成為固定 Canon，
  後續 Script 不得重新指派其 QUALIFIED 名單。

### DISQUALIFIED

- **meaning**：因違規被取消資格。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`QUALIFIER_ENTERED`、`QUALIFIER_PASSED`、`RESERVE`、
  `WILD_CARD_ELIGIBLE`、`COMEBACK_PENDING`。
- **allowed next states**：本 Season 內無（終局狀態；不得恢復為 `RESERVE`、
  `WILD_CARD_ELIGIBLE` 或 `COMEBACK_PENDING`，見 `APEX_RULES_V1.md` 第 7 節）。
  跨 Season 時，同一車手/車隊可以全新的 `DISCOVERED` Candidate 身分重新申請，
  依序通過 Gate 1 與 Gate 7；原 `DISQUALIFIED` 歷史紀錄永久保留，不因重新申請
  而被刪除或掩蓋（見 `DC2100_STORY_BIBLE_V1.md` 第 13.3 節 Locked Decision）。
- **required evidence**：`APEX_RULES_V1.md` 第 11 節 Penalties 的違規判定紀錄。
- **required human gate**：Gate 7 — Canon State Commit。
- **reversible or irreversible**：Irreversible。
- **effect on future scripts**：Script 可撰寫該實體的後果與其他角色的反應，
  但不得撰寫其重返本 Season 賽事；跨 Season 重新申請的新候選須被當作全新實體處理。

### WITHDRAWN

- **meaning**：主動退出賽事，非因淘汰或違規。
- **valid entity type**：DRIVER、TEAM。
- **valid previous states**：`QUALIFIER_ENTERED`、`QUALIFIER_PASSED`、`RESERVE`、
  `WILD_CARD_ELIGIBLE`。
- **allowed next states**：`COMEBACK_PENDING`（本 Season 內），或於未來 Season
  重新以 `DISCOVERED` 狀態進入新的候選流程。
- **required evidence**：Team 或 Driver 的主動退出聲明，須記錄於 Beat 或 Outline 中。
- **required human gate**：Gate 3（Outline Lock，鎖定退出聲明並形成
  `PROPOSED_STATE_CHANGE`）→ Gate 7（Canon State Commit，正式生效）。
- **reversible or irreversible**：Reversible（保留未來重新報名的可能性）。
- **effect on future scripts**：Script 應保留該實體的尊嚴敘事，不得將主動退出
  等同於淘汰的負面敘事處理。

---

## 3. Immutable vs Mutable State

- **Immutable（不隨 State Transition 改變）**：`DC2100_STORY_BIBLE_V1.md` 第 10 節
  Immutable Canon 與 `APEX_RULES_V1.md` 定義的競賽架構本身（第 2 節 Competition Hierarchy、
  第 6 節 Scoring 面向、第 7 節 Advancement 列舉值）。這些屬於 GLOBAL Layer，
  不透過本文件第 2 節的 State Vocabulary 變更，只能透過新版本文件
  （例如 `canon_version` 升級）修訂。
- **Mutable（透過 State Transition 改變）**：SEASON、REGION、FACTION、DRIVER、TEAM、
  VEHICLE、RESOURCE、RELATIONSHIP、COMPETITION 九個 Layer 的實例資料，
  皆透過第 2 節定義的 State 事件隨故事發展而變化，對應
  `DC2100_STORY_BIBLE_V1.md` 第 11 節 Dynamic Canon。

---

## 4. State Transition Rules

1. 每一個 State 事件都是**只增不改**（append-only）的歷史紀錄；已提交的事件
   不得被刪除或竄改，只能透過新的 State 事件疊加變化（例如 `VEHICLE_DAMAGED`
   之後只能疊加 `VEHICLE_REPAIRED`，不能回頭修改 `VEHICLE_DAMAGED` 本身）。
2. 每個實體在同一個 State Group（見下）內，同一時間只能有一個「當前有效」的狀態；
   不同 Group 之間互不排斥，可同時並存：
   - **Group A — Competition Advancement**（DRIVER/TEAM 的晉級鏈）：
     `DISCOVERED → CANDIDATE_APPROVED → QUALIFIER_ENTERED → {QUALIFIER_PASSED |
     QUALIFIER_FAILED} → {RESERVE | WILD_CARD_ELIGIBLE | COMEBACK_PENDING |
     DISQUALIFIED | WITHDRAWN} → ...`
   - **Group B — Relationship**（RELATIONSHIP 實體）：
     `{RIVALRY_CREATED | ALLIANCE_CREATED} → ALLIANCE_BROKEN`
   - **Group C — Resource Ledger**（RESOURCE 實體）：
     `RESOURCE_ACQUIRED ⇄ RESOURCE_LOST`
   - **Group D — Vehicle Condition**（VEHICLE 實體）：
     `VEHICLE_DAMAGED ⇄ VEHICLE_REPAIRED`
   - **Group E — Team Membership**（DRIVER 實體的 Team 歸屬）：
     `TEAM_CHANGED`（可重複發生的獨立事件）
   - **Group F — Region Lock**（REGION 實體）：
     `REGION_LOCKED → REGION_UNLOCKED`
3. 一個實體可以同時擁有一個 Group A 狀態、多個 Group B 關係、一組 Group C 資源餘量，
   以及一個 Group D 車輛狀態——這些互不衝突，因為它們描述的是同一實體的不同面向。
4. 任何違反第 2 節列出之 `valid previous states` 的轉移請求，Pipeline 必須拒絕，
   並回報 `INVALID_TRANSITION` 錯誤，不得靜默修正或猜測意圖。
5. 涉及 Season 收尾（`REGION_UNLOCKED`）的轉移，必須確認該 Region 內所有
   相關 DRIVER/TEAM 的 Group A 狀態皆已到達終局（`QUALIFIER_PASSED`、
   `QUALIFIER_FAILED` 且無待決的 `RESERVE`/`WILD_CARD_ELIGIBLE`/`COMEBACK_PENDING`
   審核），才可觸發。

---

## 5. Human Gates

| Gate | 名稱 | 作用 |
|---|---|---|
| Gate 1 | Candidate Selection | 確認 Fusion Candidate 或既有 Reserve/Wild Card/Comeback 候選人是否可填入 Slot 或改變資格狀態，形成對應的 `PROPOSED_STATE_CHANGE`。 |
| Gate 2 | Story Direction Selection | 確認 Season 或 Beat 群組的敘事方向（例如 Act 的 escalating conflict 走向）符合 Story Bible 的 Tone 與 Immutable Canon。 |
| Gate 3 | Outline Lock | 鎖定 Beat 層級的 setup / conflict / decision / consequence，以及其中 proposed 的 Relationship / Resource / Vehicle / Team 類 State 變更，形成對應的 `PROPOSED_STATE_CHANGE`。**Gate 3 本身不得直接產生 `CANON_STATE_COMMITTED`**，只鎖定 Outline 與提案內容。 |
| Gate 4 | Script Lock | 鎖定實際 Script 文字內容，確認與已 Lock 的 Outline 一致，不得修改 Outline 已鎖定的結果。 |
| Gate 5 | Visual Lock | 鎖定視覺呈現方向（車輛外觀、場景、角色造型），確認符合 IP Safety（Story Bible 第 12 節）。 |
| Gate 6 | Publish Approval | 核准 Short 或長片 Episode 正式發布。核准發布**仍不等於 Canon Commit**。 |
| Gate 7 | Canon State Commit | 正式核准**所有**第 2 節定義的 Canon State（不分 Group），將 `PROPOSED_STATE_CHANGE` 轉為 `CANON_STATE_COMMITTED`。可以對單一 Beat 或單一 Content 內的多筆敘事性 State 進行 batch commit。每筆記錄必須包含 `approved_by`、`approved_at`、`evidence_refs`（見第 7 節）。 |

**核心規則**：Canon State **不能**在 AI 生成 Outline 或 Script 時直接正式寫入。

AI Pipeline（Story Direction、Outline、Script Generator）只能提出：

```
PROPOSED_STATE_CHANGE
```

Michael 核准後，才能成為：

```
CANON_STATE_COMMITTED
```

適用範圍說明：

- **所有** Group（A 至 F）的 State 變更，一律要求完整的
  `PROPOSED_STATE_CHANGE → Gate 7 → CANON_STATE_COMMITTED` 流程，沒有例外。
  不存在「經 Gate 3 即自動視為 Canon Commit」的情況。
- Group A（Competition Advancement）與 Group F（Region Lock）涉及正式比賽結果
  與資格，每筆 Transition 通常需要 Gate 7 逐筆審核。
- Group B、C、D、E（Relationship、Resource、Vehicle、Team Membership）屬於
  故事細節層級的狀態，Gate 7 審核時**允許以 Beat 或 Content 為單位進行
  batch commit**（一次核准同一 Beat 內的多筆敘事性 State 事件），但仍必須
  每筆記錄 `approved_by` / `approved_at` / `evidence_refs`。
- 未通過 Gate 7 的任何 State（不論來自哪個 Group），即使其對應內容已完成
  Script Lock（Gate 4）、Visual Lock（Gate 5）甚至已完成 Publish Approval
  （Gate 6）發布，也只能視為 proposed / non-canon presentation，不構成正式
  Canon 事實。

---

## 6. Traffic Effects

流量（Broadcast Traffic、觀眾反應、訂閱與觀看數據）只能對 Canon State 的
決策流程產生以下效果：

- **recommendation**：作為 Gate 1 審核時的參考訊號之一。
- **priority change**：影響哪個 Candidate Slot 或 Beat 優先製作。
- **spotlight increase**：影響哪位角色獲得更多敘事篇幅。
- **comeback consideration**：作為觸發 Gate 1 複審 `COMEBACK_PENDING` 候選人的訊號
  （見 `APEX_RULES_V1.md` 第 9、10 節）。
- **additional episode proposal**：作為建議是否增加某條故事線集數的輸入。

流量**不能**直接寫入以下任何 Canon 結果：

- 任何第 2 節定義的 State 的最終判定值。
- `QUALIFIER_PASSED` / `QUALIFIER_FAILED` / `DISQUALIFIED` 等比賽結果。
- `WILD_CARD_GRANTED` 或 `COMEBACK_GRANTED` 的授予判定。
- 任何 Immutable Canon（第 3 節）內容。

任何試圖將流量數值直接映射為 State 判定值的 Pipeline 邏輯，
均違反本文件與 `APEX_RULES_V1.md` 第 12 節 Traffic Boundary，必須被拒絕。

---

## 7. Versioning

每一筆 State Transition 記錄與每一份 Canon 文件皆須追蹤以下欄位：

- `canon_version`：本組 Canon 文件（Story Bible / APEX Rules / Season Outline /
  State Model）的整體版本號，四份文件共用同一個版本號以保證彼此一致
  （目前為 `1.0.0`）。
- `season_version`：特定 Season 大綱的版本號（目前 `SEASON_1_GLOBAL_QUALIFIERS`
  為 `1.0.0`）。
- `rules_version`：`APEX_RULES_V1.md` 的版本號（目前 `1.0.0`）。
- `transition_id`：每一筆 State Transition 的唯一識別碼。
- `approved_by`：核准該 Transition 的人員（目前生態系中僅 Michael 具備此權限）。
- `approved_at`：核准時間戳。
- `source_content_id`：若該 Transition 的 Evidence 來自既有 Content 記錄
  （見 `STATUS_FLOW.md`），記錄對應的 Content ID。
- `evidence_refs`：指向 Fusion Candidate、Beat、Scoring 紀錄或其他 Evidence 來源的
  識別碼陣列。
- `rollback_reference`：若某次 `CANON_STATE_COMMITTED` 事後被證實有誤，
  記錄用於撤銷影響的補償性 Transition（例如以新的 `RESOURCE_ACQUIRED` 事件
  補償錯誤的 `RESOURCE_LOST` 記錄），而不是刪除原始事件
  （呼應第 4 節「只增不改」原則）。

---

## 8. Machine-Readable Appendix

以下為未來可轉換為正式 JSON Schema 的範例物件。本次任務**不建立**正式程式 Schema，
以下內容僅供 Script Pipeline 開發時參考資料結構。

### 8.1 範例：AI 提出的狀態變更提案

```json
{
  "transition_id": "TRANSITION-2100-000142",
  "canon_version": "1.0.0",
  "season_version": "1.0.0",
  "rules_version": "1.0.0",
  "state": "PROPOSED_STATE_CHANGE",
  "target_state": "QUALIFIER_PASSED",
  "entity_type": "DRIVER",
  "entity_slot": "CANDIDATE_SLOT_02",
  "layer": "COMPETITION",
  "beat_id": "BEAT-04",
  "evidence_refs": [
    "fusion_candidate:8841",
    "scoring_record:GQ-EASTASIA-TT-001"
  ],
  "source_content_id": null,
  "proposed_by": "SCRIPT_PIPELINE_AI",
  "proposed_at": "2100-01-14T06:00:00Z",
  "required_human_gate": "GATE_7_CANON_STATE_COMMIT",
  "approved_by": null,
  "approved_at": null,
  "rollback_reference": null
}
```

### 8.2 範例：Michael 核准後的正式 Canon 狀態

```json
{
  "transition_id": "TRANSITION-2100-000142",
  "canon_version": "1.0.0",
  "season_version": "1.0.0",
  "rules_version": "1.0.0",
  "state": "CANON_STATE_COMMITTED",
  "target_state": "QUALIFIER_PASSED",
  "entity_type": "DRIVER",
  "entity_slot": "CANDIDATE_SLOT_02",
  "layer": "COMPETITION",
  "beat_id": "BEAT-04",
  "evidence_refs": [
    "fusion_candidate:8841",
    "scoring_record:GQ-EASTASIA-TT-001"
  ],
  "source_content_id": "P0-JP-RX7-014",
  "proposed_by": "SCRIPT_PIPELINE_AI",
  "proposed_at": "2100-01-14T06:00:00Z",
  "required_human_gate": "GATE_7_CANON_STATE_COMMIT",
  "approved_by": "michael",
  "approved_at": "2100-01-14T09:30:00Z",
  "rollback_reference": null
}
```

### 8.3 範例：Relationship 類事件在 Gate 3 形成提案（尚非 Canon）

```json
{
  "transition_id": "TRANSITION-2100-000158",
  "canon_version": "1.0.0",
  "season_version": "1.0.0",
  "rules_version": "1.0.0",
  "state": "PROPOSED_STATE_CHANGE",
  "target_state": "RIVALRY_CREATED",
  "entity_type": "RELATIONSHIP",
  "entity_slot": "CANDIDATE_SLOT_11:FACTION_ROLE_RESOURCE_CARTEL",
  "layer": "RELATIONSHIP",
  "beat_id": "BEAT-06",
  "evidence_refs": ["outline:SEASON_1:BEAT-06"],
  "source_content_id": null,
  "proposed_by": "SCRIPT_PIPELINE_AI",
  "proposed_at": "2100-01-20T06:00:00Z",
  "required_human_gate": "GATE_7_CANON_STATE_COMMIT",
  "approved_by": null,
  "approved_at": null,
  "rollback_reference": null
}
```

Gate 3（Outline Lock）核准此 Beat 的 Outline 後，此提案隨附於 Outline 一併鎖定，
但仍維持 `PROPOSED_STATE_CHANGE`，尚不構成 Canon。

### 8.4 範例：同一事件經 Gate 7 batch commit 後正式生效

```json
{
  "transition_id": "TRANSITION-2100-000158",
  "canon_version": "1.0.0",
  "season_version": "1.0.0",
  "rules_version": "1.0.0",
  "state": "CANON_STATE_COMMITTED",
  "target_state": "RIVALRY_CREATED",
  "entity_type": "RELATIONSHIP",
  "entity_slot": "CANDIDATE_SLOT_11:FACTION_ROLE_RESOURCE_CARTEL",
  "layer": "RELATIONSHIP",
  "beat_id": "BEAT-06",
  "evidence_refs": ["outline:SEASON_1:BEAT-06"],
  "source_content_id": null,
  "proposed_by": "SCRIPT_PIPELINE_AI",
  "proposed_at": "2100-01-20T06:00:00Z",
  "required_human_gate": "GATE_7_CANON_STATE_COMMIT",
  "approved_by": "michael",
  "approved_at": "2100-01-20T09:00:00Z",
  "rollback_reference": null,
  "batch_commit_id": "GATE7-BATCH-SEASON1-BEAT06"
}
```

`batch_commit_id` 說明此筆與同一 Beat 內其他敘事性 State 事件（例如同一 Beat 的
`RESOURCE_ACQUIRED` / `RESOURCE_LOST`）在同一次 Gate 7 審核中一併核准，
但每筆事件仍各自保留獨立的 `transition_id` 與 `evidence_refs`。
