# APEX Rules V1

```
canon_version: 1.0.0
document_status: APPROVED_V1
approved_by: michael
approval_effective_on_merge: true
document_role: APEX_COMPETITION_RULES
governs: competition hierarchy, entry, vehicles, race formats, scoring, advancement, penalties, traffic boundary
related_documents:
  - docs/canon/DC2100_STORY_BIBLE_V1.md (world, factions, technology and resource context)
  - docs/canon/SEASON_1_GLOBAL_QUALIFIERS.md (Season 1 application of these rules)
  - docs/canon/CANON_STATE_MODEL.md (state vocabulary and human gates that enforce these rules)
  - CANON.md (existing world canon; see Authority Rule in §0 for scope)
  - P0_RULES.md (existing production rules for the Global Qualifiers content event)
required_human_gate: Gate 7 — Canon State Commit (see CANON_STATE_MODEL.md)
```

## 0. 與既有文件的關係

`CANON.md` — APEX Competition System 已經定義了 APEX 的既有層級概念
（P0 Global Qualifier、Underground Circuit、Regional Qualifier、World Tour）。
本文件是這些概念的正式競賽規則展開，
並補上 Final Championship 作為主線最終層級。本文件將 APEX 的整體架構正式鎖定為
**APEX main competition hierarchy**（Global Qualifiers → Regional Qualifiers →
APEX World Tour → Final Championship 四層線性主線）**加上** **Underground parallel
pathway**（Underground Circuits 作為全季平行運行的 Side Competition Network，
不是主線必經層級）。`P0_RULES.md` 定義的是 Global Qualifiers
**內容製作與發布層**的操作規則（發布量、每日組合、內容分類）；本文件定義的是
Global Qualifiers 及其後續層級的**故事內比賽規則**（資格、積分、晉級）。
兩者是同一個 in-universe 事件的兩個視角，不互相矛盾：`P0_RULES.md` 回答「我們如何
製作與發布關於 Global Qualifiers 的內容」，本文件回答「Global Qualifiers 裡面的
比賽如何運作、誰晉級、誰淘汰」。

### Authority Rule

- `APEX_RULES_V1.md` governs competition hierarchy and race rules.
- `DC2100_STORY_BIBLE_V1.md` governs world, tone, factions, technology,
  resources and IP boundaries.
- `SEASON_1_GLOBAL_QUALIFIERS.md` governs Season 1 structure and beats.
- `CANON_STATE_MODEL.md` governs states, transitions and human gates.
- Within these governed scopes, the four approved V1 documents supersede
  conflicting legacy details in `CANON.md`.
- `CANON.md` remains the baseline only for areas not replaced or expanded by
  these V1 documents.
- Any unresolved cross-document conflict must fail closed with
  `CANON_CONFLICT` and require Michael review.

---

## 1. Purpose of APEX

### 表面目的

APEX 對外宣稱是一項全球性的競速競技系統，目的是重新發掘人類駕駛技藝、
復興內燃機與地下車隊文化，並提供一個公平的舞台讓任何背景的車手證明自己。

### 真實目的

APEX 實際上同時服務多重、彼此競爭的隱藏功能：

- 對 **Dome Authority**：是篩選具威脅性或具價值人才的觀察窗口，也是釋放地下不滿情緒的安全閥。
- 對 **APEX Organizers**：是延續 Era VIII「APEX First Era」未竟之業與自身權力結構的手段。
- 對 **Resource Cartels**：是包裝資源交易與影響力擴張的合法舞台。
- 對 **Wasteland Combustion Communities**：是證明機械技藝與尊嚴仍有價值的真實舞台。

APEX 的戲劇張力正來自「表面目的」與「真實目的」之間的落差，任何 Story Direction
都可以揭露這個落差，但不得讓其中一種真實目的被證明為「唯一真相」
（見 `DC2100_STORY_BIBLE_V1.md` 第 11 節，Era IX 真相須保持模糊）。

---

## 2. Competition Hierarchy

APEX 的整體架構由兩個部分組成：**APEX main competition hierarchy**（唯一的線性主線）
與 **Underground parallel pathway**（全季平行運行的側線網路）。兩者不是同一條線上的
先後關係——Underground Circuits 不是主線必經層級，任何 Driver/Team 都可以完全不經過
Underground Circuits 就走完整條主線。

### 2.0 APEX main competition hierarchy

固定流程：

```
Global Qualifiers
  → Regional Qualifiers
    → APEX World Tour
      → Final Championship
```

### 2.1 Global Qualifiers

- **功能**：面向全球公開招募，初步篩選具備基本資格的 Driver 與 Team。
- **參加條件**：完成第 3 節 Entry Rules 的基本資格認證即可報名。
- **結果**：產出 QUALIFIED 名單進入 Regional Qualifiers；未通過者進入 ELIMINATED
  或 RESERVE（見第 7、8 節）。

### 2.2 Regional Qualifiers

- **功能**：依地區篩選代表隊伍，強化地方汽車文化與地緣政治張力。
- **參加條件**：僅限 Global Qualifiers 中 QUALIFIED 或獲得 WILD_CARD_GRANTED 的 Driver/Team。
- **結果**：產出各地區代表名單，決定誰有資格直接晉級 APEX World Tour。
  未在此直接晉級的 Driver/Team，可自由選擇是否透過 2.5 節 Underground Circuits
  累積 Evidence，以爭取 Wild Card 或 Comeback 機會——但 Underground Circuits
  本身不構成晉級 World Tour 的另一條路徑。

### 2.3 APEX World Tour

- **功能**：國際錦標賽層，連結地緣政治、資源競爭與國家聲望
  （見 `CANON.md` — APEX Competition System）。
- **參加條件**：僅限 Regional Qualifiers 中取得 `QUALIFIED` 資格的 Driver/Team，
  或經 Gate 1 與 Gate 7 正式核准 `WILD_CARD_GRANTED` 的 Driver/Team。
  Wild Card 的 Evidence 可能源自 Underground Circuits 表現，但 World Tour 資格
  本身一律由官方 Human Gate 授予，Underground Circuits 不能直接授予 World Tour 資格。
- **結果**：產出 World Tour 積分排名，決定誰有資格進入 Final Championship。

### 2.4 Final Championship

- **功能**：單一賽季的最終定案賽事，決定該 Season 的 APEX 冠軍與勢力格局變化。
- **參加條件**：World Tour 積分排名前段的 Driver/Team，以及該 Season 內罕見授予的
  Comeback 或 Wild Card 資格保有者。
- **結果**：冠軍產出、Season 的 Canon State 產生重大變化（見 `CANON_STATE_MODEL.md`），
  並直接影響下一 Season 的 Beginning State。

### 2.5 Underground Circuits — Side Competition Network

- **定位**：Underground Circuits 是全季平行運行的 Side Competition Network，
  不是 APEX main competition hierarchy 的必經層級，任何時間點都可以參與或不參與，
  詳見 `DC2100_STORY_BIBLE_V1.md` 第 13.4 節 Locked Decision。
- **功能**：作為技術磨練場、Evidence 累積管道、Reserve 候選人的實力驗證場，
  以及 Comeback 代價的其中一種完成方式。
- **參加條件**：任何未被 `DISQUALIFIED` 的 Driver/Team，包括 `RESERVE`、
  `COMEBACK_PENDING` 名單，以及主動選擇以地下路線證明自己的參賽者。
- **允許的輸出（Underground Circuit 的結果只能產生以下提案，不得產生其他效果）**：
  - new evidence（新的 Evidence，供 Gate 1 審核參考）
  - `WILD_CARD_ELIGIBLE` proposal（成為 Wild Card 候選提案，非直接授予）
  - `COMEBACK` requirement completion（作為 Comeback 代價完成的證明之一，
    非直接授予 `COMEBACK_GRANTED`）
  - Regional Qualifier re-entry proposal（重新進入 Regional Qualifiers 的提案）
  - World Tour entry proposal where rules explicitly allow it（僅在本文件
    明確允許之處，作為 World Tour 資格提案的輸入之一）
- **強制限制**：Underground Circuits 的任何結果都**不得**自動授予 `QUALIFIED`、
  `WILD_CARD_GRANTED` 或 `COMEBACK_GRANTED` 等正式資格，也**不得**讓參賽者
  跳過 `CANON_STATE_MODEL.md` 定義的任何 Human Gate。所有正式資格變更一律
  遵循該文件第 5 節的 `PROPOSED_STATE_CHANGE → Gate 7 → CANON_STATE_COMMITTED` 流程。

---

## 3. Entry Rules

### Driver Eligibility

- 必須通過基本身份驗證（Evidence / identity verification，見下）。
- 必須完成至少一次公開可驗證的駕駛紀錄（正式比賽、地下比賽或可信的第三方見證）。
- 不得同時代表兩個互相競爭的 Team 報名同一層級賽事。

### Team Eligibility

- 必須指定至少一名 Driver 與一台通過 Vehicle Eligibility 的車輛。
- 必須揭露其主要資源贊助來源（即使贊助來自 Resource Cartel 或 Broadcaster）。
- 不得由已被 DISQUALIFIED 的 Team 以更名方式重新報名同一 Season。

### Vehicle Eligibility

- 必須符合第 4 節 Vehicle Rules 所有項目。
- 必須提供可驗證的技術規格記錄（動力形式、重量、修復歷史）。

### Evidence / Identity Verification

- 每一位 Driver 與每一台 Vehicle 必須附有 Evidence（賽事紀錄、影像、第三方見證、
  Broadcast 報導或官方檢驗紀錄之一）。
- Evidence 缺失的申請不得進入 `QUALIFIER_ENTERED`。
- 該 Candidate 維持 `DISCOVERED`。
- 加入 `NEEDS_MORE_EVIDENCE` review flag：這是審核旗標，不是正式 Canon State，
  不出現在 `CANON_STATE_MODEL.md` 第 2 節 State Vocabulary 中。
- Evidence 補齊後才能進入 Gate 1（Candidate Selection）。
- `RESERVE` 只能在正式 `QUALIFIER_FAILED` 後，經 Gate 1 proposal 與 Gate 7 commit
  產生，不得作為 Evidence 不足時的替代路徑。

### Entry Cost

- 每一層級都要求繳交對應的資源成本（燃料配額、維修時間預留、資料存取費用等，
  依第 7 節 Resource System 的資源類別計算），資源類別參見 `DC2100_STORY_BIBLE_V1.md` 第 7 節。
- 無力負擔 Entry Cost 的 Driver/Team 可透過 Faction 贊助或 Wild Card 提名進場。

### Sponsor / Faction Support

- 任一 Faction 可贊助 Driver/Team，但贊助關係必須被揭露為 Evidence 的一部分。
- 贊助不构成資格保證；未通過賽事表現的受贊助者仍會被 ELIMINATED。

### Illegal or Disputed Entries

- 使用偽造 Evidence、隱匿贊助關係或違反第 11 節 Penalties 的報名，
  將被標記為 Disputed Entry，暫緩至人工審核（Human Gate）完成後才能進入 QUALIFIER_ENTERED。

---

## 4. Vehicle Rules

APEX 允許多元動力形式與科技輔助，但規則必須產生公平且可理解的戲劇，
不能只寫「沒有規則」。

- **Combustion**：允許，須通過排放與結構安全基礎檢驗；不限制引擎年代或來源。
- **Electric**：允許，須通過電池安全與斷電保護基礎檢驗。
- **Hybrid**：允許，動力配置須完整揭露供計分系統辨識主要動力來源。
- **AI Assistance**：允許有限度使用（導航建議、基礎防滑輔助），
  禁止全自主駕駛替代人類操作（對應 `DC2100_STORY_BIBLE_V1.md` 第 6.1 節）。
- **Neural Assistance**：允許，但須向 Organizers 申報使用等級；未申報使用視為違規。
- **Vehicle Weight / Power-to-Weight**：每個 Race Format（見第 5 節）公告該賽事的
  class 或 power-to-weight 門檻，而非單一重量上限：
  - 低於門檻重量或動力超出門檻比例的車輛（underweight or overpowered），
    可被要求加裝 ballast（配重）、接受動力輸出上限限制，或接受起跑順位懲罰。
  - 超出門檻重量的車輛（overweight），可被移至另一個 class 分級參賽，
    或依其重量接受對應的路線與煞車距離分級要求（route / braking-distance
    classification requirements）。
  - 重量本身不構成違規；**單純的高重量不得被描述為需要額外配重**——
    配重只適用於 underweight or overpowered 的車輛，用來抵銷其相對優勢，
    而非用來懲罰重量本身。
- **Armor**：允許防護性裝甲，禁止以裝甲名義加裝任何具攻擊性的結構。
- **Repair**：允許賽事間與賽段間維修，維修時間計入 Repair Time 資源（見 Story Bible 第 7 節）。
- **Replacement Parts**：允許使用非原廠零件，但須可追溯來源，禁止使用來源不明的黑市零件
  用於安全關鍵系統（煞車、轉向、防滾架）。
- **Vehicle Swapping**：同一 Driver 在同一 Season 內更換主力車輛須重新提交 Vehicle Eligibility 審核；
  賽事進行中（Race Format 開始後）禁止更換車輛。
- **Safety Systems**：防滾架、滅火系統、緊急斷電裝置為強制配備，缺失者不得起跑。
- **Prohibited Systems**：全自主駕駛系統、第 6.10 節定義的 Autonomous Weapons、
  任何形式的對手車輛遠端干擾裝置。

---

## 5. Race Formats

| Format | Objective | Scoring | Failure Condition | Story Purpose |
|---|---|---|---|---|
| Time Trial | 在規定時間內完成單圈或指定路段最快時間 | 依完成時間換算積分，最快者積分最高 | 未完賽或超過關門時間 | 建立個人技藝與車輛極限的基準敘事 |
| Survival Stage | 在惡劣路況下完成長距離賽段並保持車輛可運作 | 依完賽名次與車輛保存狀態綜合計分 | 車輛喪失可運作能力或退出賽段 | 展現資源管理與人車耐力的戲劇張力 |
| Duel | 一對一直接對抗，先達成指定條件者勝 | 勝者取得全額積分，敗者取得參與積分 | 未能在規定圈數/時間內取得優勢 | 建立個人恩怨與正面衝突的戲劇高潮 |
| Resource Run | 在限定資源配額下完成賽段，資源管理即比賽一部分 | 依完賽表現扣除資源超支懲罰後計分 | 資源耗盡且無法完成賽段 | 直接呈現 Resource System 的故事化 |
| Mixed Surface | 在內燃機與電動車皆有優劣的混合地形完賽 | 依完賽名次與地形適應表現計分 | 未完賽或嚴重偏離賽道 | 呈現不同動力形式的技術對比 |
| Convoy / Escort | 護送指定車輛或貨物安全抵達終點 | 依護送對象完整抵達狀態與時間計分 | 護送對象受損或未抵達 | 呈現 Safe Passage 資源與團隊合作的戲劇 |
| Elimination Race | 多車同場競速，週期性淘汰末位 | 依存活輪次與最終名次計分 | 被淘汰輪次判定出局 | 建立緊張的層層淘汰敘事節奏 |
| Final Circuit | Season 最終定案賽事，綜合考驗全部技術與資源管理 | 依完賽名次、資源效率、人類操作比例綜合計分 | 未完賽或被判定 DISQUALIFIED | 收束 Season 核心衝突並產生 Canon State 重大變化 |

---

## 6. Scoring

積分系統必須可追蹤、可稽核，且不允許人氣直接轉換為比賽積分。

積分計算至少考慮以下面向（各面向權重由 Organizers 依 Race Format 公告，公告本身即 Canon）：

- **Finish Result**：完賽名次的基礎積分。
- **Stage Completion**：多賽段賽事中，每個賽段的完成度。
- **Vehicle Preservation**：賽事結束時車輛的可運作狀態，鼓勵資源管理而非蠻幹。
- **Resource Efficiency**：完賽所消耗的資源相對於配額的效率。
- **Human Control**：人類主動操作比例（對比 AI/Neural 輔助比例），呼應核心戲劇問題。
- **Penalty**：依第 11 節 Penalties 扣除相應積分。
- **Technical Violation**：依 Vehicle Rules 違規情節扣除積分或取消單賽段成績。
- **Team Conduct**：Team 整體行為紀錄（是否曾涉入 Faction Interference 等）。

**強制規則**：Broadcast Traffic、觀眾投票、社群熱度、訂閱數或任何形式的人氣指標，
**不得**作為以上任何積分面向的輸入。人氣的合法作用範圍見第 12 節 Traffic Boundary。

---

## 7. Advancement

Driver、Team 或 Vehicle 在任一賽事層級的狀態必須是以下九種之一：

- `QUALIFIED` — 已達成該層級晉級門檻，可進入下一層級。
- `ELIMINATED` — 未達成晉級門檻，且未取得 Reserve 或 Wild Card 資格。
- `RESERVE` — 未直接晉級，但保留有條件的復活可能性（見第 8 節）。
- `WILD_CARD_ELIGIBLE` — 符合 Wild Card 提名條件，等待審核（見第 9 節）。
- `WILD_CARD_GRANTED` — Wild Card 審核通過，取得晉級資格。
- `COMEBACK_PENDING` — 已提出 Comeback 申請，代價尚未完成（見第 10 節）。
- `COMEBACK_GRANTED` — Comeback 代價已完成並經審核通過，重新取得參賽資格。
- `DISQUALIFIED` — 因違規被取消資格（見第 11 節）。同一 Season 內不得以 Reserve、
  Wild Card、Comeback 或任何形式恢復或重新報名。未來 Season 可在完成處分、申訴或
  重新資格條件後，以全新的 `DISCOVERED` Candidate 身分重新申請，並依序經過
  Gate 1 與 Gate 7；原 `DISQUALIFIED` 歷史紀錄永久保留（見
  `DC2100_STORY_BIBLE_V1.md` 第 13.3 節 Locked Decision）。
- `WITHDRAWN` — 主動退出，不視為淘汰，未來 Season 可重新報名。

以上狀態與 `CANON_STATE_MODEL.md` 第 2 節 State Vocabulary 的對應關係：
`QUALIFIER_PASSED` 事件的結果即為 `QUALIFIED` 狀態；`QUALIFIER_FAILED` 事件的結果
即為 `ELIMINATED` 狀態（除非同時觸發 RESERVE 或 WILD_CARD_ELIGIBLE）。

---

## 8. Reserve

Reserve 的核准分成兩個明確分開的 Gate，不得合併或省略：

- **Gate 1（候選確認）**：在 QUALIFIER_FAILED 判定後，若 Evidence 顯示表現接近
  晉級門檻，或具備高度故事潛力（依 Fusion Candidate 或 Story Direction 提案），
  Gate 1 只核准「某 Candidate 值得成為 Reserve 候選」，此時該 Candidate 產生的是
  `PROPOSED_STATE_CHANGE`，尚非正式 `RESERVE` 狀態。
- **Gate 7（正式寫入）**：只有經 Gate 7 — Canon State Commit 核准後，
  才正式寫入 `RESERVE` 狀態，成為 `CANON_STATE_COMMITTED`。
- **Reserve 有什麼權利**：可參加 Underground Circuits（見第 2.5 節），
  累積新的 Evidence；可被列入下一次名額釋出時的優先候補名單。
- **何時可以替補**：僅當已 QUALIFIED 名單中出現 WITHDRAWN 或 DISQUALIFIED 時，
  依 Reserve 名單順位遞補；不得無故插隊。
- **是否保留積分**：Reserve 狀態不保留原賽事積分，遞補後以新賽事積分重新計算，
  但保留原賽事的 Evidence 記錄供故事延續使用。
- **如何避免 Reserve 變成任意復活**：Reserve 遞補至 `QUALIFIER_ENTERED` 必須
  再次通過 Gate 7 核准，滿足「名額真實空缺」與「Evidence 支持」兩個條件，
  不存在自動遞補機制。與 `CANON_STATE_MODEL.md` 第 2 節 `RESERVE` 狀態定義完全一致。

---

## 9. Wild Card

- **觸發條件**：Driver/Team 未能透過標準晉級路徑取得資格，但滿足下列至少一項：
  顯著的 Underground Circuit 表現、顯著的技術突破、顯著的故事必要性（例如揭露
  某 Faction 陰謀所需）。
- **Evidence**：必須附有具體、可稽核的表現或事件紀錄，不得僅憑主觀評價授予。
- **故事條件**：必須能說明此次授予如何服務第 2 節「核心戲劇問題」或至少一個
  Faction 的 potential season conflict，不得是純粹的獎勵性授予。
- **人類審核**：Wild Card 的授予必須經過 Gate 1（Candidate Selection）與
  Gate 7（Canon State Commit）雙重人工審核，AI 只能提出 `PROPOSED_STATE_CHANGE`。
- **強制排除**：**不能只因流量高而取得**。Broadcast 熱度、觀眾請願或社群聲量
  可作為「值得審核」的訊號來源，但本身不構成 Evidence 或審核通過的理由。

---

## 10. Comeback

Comeback 必須付出代價，代價至少包含下列其中一項，且須在提案中明確指定：

- **新資格賽**：必須通過一場額外指定的 Underground Circuit 或 Regional Qualifier。
- **資源損失**：主動放棄一項第 7 節 Resource System 資源的既有配額或存量。
- **車輛降級**：主力車輛須降級至較低規格分類參賽，直到重新證明實力。
- **勢力交換**：必須轉換或放棄現有 Faction 支持關係。
- **關係破裂**：必須承受與既有盟友或贊助者關係破裂的敘事後果。
- **公開挑戰**：必須公開挑戰一名現任 `QUALIFIED` 資格保有者並取勝。公開挑戰
  （public challenge）本身不是第 5 節任何一種 Race Format 的正式資格判定，
  只是完成 Comeback 代價的 Evidence 產生機制：
  - 挑戰勝利的紀錄可以完成 Comeback 代價，使挑戰者的 `COMEBACK_PENDING`
    經 Gate 7 核准後轉為 `COMEBACK_GRANTED`。
  - 挑戰勝利**不會自動取消**被挑戰者的既有資格；被挑戰者的 `QUALIFIER_PASSED`
    歷史與目前 `QUALIFIED` 資格維持不變，不因此產生 `QUALIFIER_FAILED`。
  - 除非該場賽事被另外正式定義為第 5 節的 Elimination Race（獨立的正式
    Elimination Stage），並依該賽事自身的 Scoring 規則產生判定，否則公開挑戰
    不得對被挑戰者產生任何資格喪失效果。

Comeback 流程：`COMEBACK_PENDING`（代價已提出，尚未完成，挑戰期間挑戰者維持
`COMEBACK_PENDING`，不轉換為 `QUALIFIER_ENTERED` 或 `QUALIFIER_PASSED`）→
代價完成的 Evidence 經 Gate 7 審核 → `COMEBACK_GRANTED`。代價未完成前，
Driver/Team 不得參加更高層級賽事；取得 `COMEBACK_GRANTED` 後，才可以在下一場
正式賽事中提出 `QUALIFIER_ENTERED`。

---

## 11. Penalties

以下行為構成違規，依情節輕重可扣除積分、取消單賽段成績，或直接導致 `DISQUALIFIED`：

- **Sabotage**：蓄意破壞對手車輛、設施或 Evidence 記錄。
- **Illegal AI**：使用超出申報等級的 AI Assistance，或使用第 4 節列為禁止的全自主駕駛系統。
- **Data Theft**：竊取對手的 Evidence、技術資料或戰術資訊。
- **Unauthorized Repair**：在賽事規則禁止的時間或地點進行車輛維修。
- **Civilian Harm**：賽事行為導致非參賽人員傷害。
- **Faction Interference**：Faction 以資源或武力方式非法干預賽事結果。
- **Race Manipulation**：與其他 Driver/Team 共謀操縱名次或積分。

`Civilian Harm` 與蓄意的 `Race Manipulation` 一經 Evidence 確認即直接 `DISQUALIFIED`，
不適用扣分緩衝。其餘項目依情節輕重先扣分，累積達 Organizers 公告門檻後升級為 `DISQUALIFIED`。

---

## 12. Traffic Boundary

Broadcast 熱度與觀眾反應（Traffic）是 DC 2100 內容生態的真實組成部分，但其作用範圍必須被嚴格限制。

Traffic 可以影響：

- Spotlight（哪位 Driver/Team 獲得更多敘事焦點）
- Episode Count（某條故事線獲得多少集數資源）
- Side Story（衍生的支線故事是否被製作）
- Production Budget（製作資源的分配優先順序）
- Comeback Consideration（作為「值得審核」的訊號，觸發人工複審，見第 9、10 節）
- Long-form Promotion（哪些內容被收錄進長片組裝，見 `SEASON_1_GLOBAL_QUALIFIERS.md` 第 8 節）

Traffic **不能**影響：

- 直接勝負（比賽名次與結果只能由第 6 節 Scoring 決定）
- 任意積分（Traffic 不是任何積分面向的輸入）
- Canon 規則（本文件與 Story Bible 定義的規則不因流量調整）
- 無條件 Wild Card（見第 9 節，Traffic 只能觸發審核，不能替代 Evidence）
- 無條件復活（見第 8、10 節，Reserve 與 Comeback 都需要滿足明確條件）
- 不合理人格改變（角色核心 goal 與 ideology 不因流量而反轉，見 Story Bible 第 10 節）

---

## 13. Human Authority

最終 Canon 與比賽結果由 Michael 核准。

AI Pipeline（Story Direction、Outline、Script Generator）可以提出比賽結果、
晉級名單或 Canon 影響的**建議**（`PROPOSED_STATE_CHANGE`，見 `CANON_STATE_MODEL.md` 第 5 節），
但任何建議在 Michael 核准並完成 `CANON_STATE_COMMITTED` 之前，
不構成正式的 APEX 比賽結果或 Canon 事實。
