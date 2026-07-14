# DC 2100 Story Bible V1

```
canon_version: 1.0.0
document_status: DRAFT_AWAITING_APPROVAL
document_role: STORY_BIBLE
governs: world, factions, technology, resources, themes, tone, immutable/dynamic canon, IP safety
related_documents:
  - CANON.md (existing world canon — this document expands it, does not replace it)
  - P0_RULES.md (existing production rules for the Global Qualifiers content event)
  - STATUS_FLOW.md (existing content-pipeline status machine — separate layer, see CANON_STATE_MODEL.md)
  - docs/canon/APEX_RULES_V1.md
  - docs/canon/SEASON_1_GLOBAL_QUALIFIERS.md
  - docs/canon/CANON_STATE_MODEL.md
required_human_gate: Gate 7 — Canon State Commit (see CANON_STATE_MODEL.md)
```

## 0. 文件定位

本文件是 DC 2100 宇宙的正式 Story Bible。它是既有 `CANON.md` 的延伸與具體化，
不是替代品。凡是 `CANON.md` 已經鎖定的規則（Dome / Wasteland 二元世界、內燃機文化、
EV 定位、APEX 分層、Resource Conflict 系統、政治諷刺邊界、國家表現規則、車輛規則、
車手規則、Canon 變更規則），本文件必須維持一致，只做細節擴充。

任何未來的 Story Direction、Outline 或 Script Pipeline，在生成內容前都必須讀取本文件。
本文件的權威順序低於 `CANON.md` — Canon Priority 章節——若兩者出現字面衝突，
以 `CANON.md` 為準，並應立即提交 Michael 審查以修正本文件。

---

## 1. One-Sentence Premise

在西元 2100 年，倖存的人類文明分裂為由 AI 與安全制度治理的 Dome，
與依賴內燃機、雙手與風險換取自由的 Wasteland，而一場名為 APEX 的地下賽車復興運動，
重新點燃了「人是否還有權利親手駕駛自己的命運」這個被文明遺忘的問題。

---

## 2. Core Dramatic Question

DC 2100 所有故事層（Season、Beat、Short、Script）最終都必須服務同一個核心問題：

> 人類是否仍有權利親自控制機器、承擔風險並選擇自由，
> 還是應將一切交給 AI、安全制度與能源秩序？

規則：

- 每一個 Season 的核心衝突，必須可以被回答問題的「哪一方，在哪個代價下」的形式重述。
- 任何 Faction、Driver 或 Vehicle 的故事功能，最終都必須能指出它在這個問題光譜上的位置。
- 這個問題永遠不能被徹底解決。APEX 世界不允許「AI 系統徹底獲勝」或「人類意志徹底獲勝」
  的最終結局，因為問題本身必須保持開放，供後續 Season 持續辯證。
- 允許暫時性的、局部的答案（例如某個 Region 選擇了 Dome 秩序，某個角色選擇了自由的代價），
  但不允許全宇宙性的、一次性的終局判決。

---

## 3. Timeline

以下時間線為**虛構的未來歷史**（fictional future history）。所有年代、事件與後果
均為 DC 2100 宇宙內部的虛構設定，不代表對真實世界未來的預測或事實陳述。
Transformer 與任何 Script Pipeline 在引用真實新聞時，只能將真實事件作為「Evidence Anchor」
（見第 12 節 IP Safety），不得將本時間線的虛構事件當作真實歷史陳述。

### Era I — The Combustion Peak（虛構近未來，宇宙紀年前）

21 世紀初期到中期，全球汽車工業以內燃機為核心逐步過渡到電動化與自動駕駛。
這段時期是宇宙背景的「已知起點」，只作為文化記憶素材使用，不展開為具體政治事件。

### Era II — The Transition Wars（虛構）

全球能源、晶片、稀土、電池原料與航運路線的競爭加劇，形成資源集團化。
國家與企業聯盟為了關鍵資源（鋰、鎳、鈷、銅、半導體、稀土、航運節點）
爆發一系列局部衝突與貿易封鎖。此階段建立了 DC 2100「資源即權力」的核心世界觀基礎。

### Era III — The Collapse（虛構）

資源衝突最終升級為有限核衝突與大規模基礎設施崩潰。
全球通訊網路、電網與工業供應鏈嚴重斷裂。文明沒有滅亡，但舊秩序無法恢復。

### Era IV — Dome Genesis（虛構）

倖存的技術與治理精英以「安全優先」為名，建立了封閉、自動化、AI 管理的保護區——The Dome。
Dome 的建立同時是救援行動，也是權力重組行動。

### Era V — Wasteland Formation（虛構）

未被 Dome 納入或主動拒絕被納入的區域，在資源匱乏與基礎設施缺失中，
發展出獨立的機械文化、黑市網路與地方自治社群，形成 The Wasteland。

### Era VI — The Combustion Ban（虛構）

Dome 治理體系以能源效率、污染控制與安全風險為由，
在其管轄範圍內全面管制並最終禁止內燃機車輛的日常使用。
這個決定是後續一切「人類控制 vs 機器優化」衝突的制度起點。

### Era VII — The Underground Convoy Era（虛構）

被管制的內燃機文化沒有消失，而是轉入地下：維修知識、零件走私、
非法賽道與地下車隊網路開始在 Wasteland 與 Dome 邊界地帶蔓延。

### Era VIII — APEX First Era（虛構）

地下車隊網路自發演化出第一代 APEX——一個橫跨地下賽道的非正式競技系統，
最初只是為了驗證誰的技術與車輛最強。APEX 迅速成為跨地區身份認同與抵抗象徵。

### Era IX — The Silence（虛構）

APEX 第一代因不明原因消失——官方說法是「資源濫用導致的鎮壓」，
地下傳說則認為是 Dome 主動撲滅了一個失控的抵抗符號。
真相在故事中永久保持模糊，作為第 11 節 Dynamic Canon 的一部分，
可被後續 Season 的調查逐步揭露，但不得被單一 Short 一次性定案。

### Era X — 2100: APEX Reactivation（故事現在時）

西元 2100 年，APEX 在官方默許與地下勢力的共同運作下重新啟動，
以「Global Qualifiers」為名對外招募——這正是 Season 1 的起點
（見 `SEASON_1_GLOBAL_QUALIFIERS.md`）。

---

## 4. World Structure

以下每一區域必須說明：誰控制、使用什麼科技、有什麼資源、居民如何生活、
如何看待 APEX、視覺風格、故事用途。

### 4.1 The Dome

- **控制者**：Dome Authority（中央 AI 治理委員會與其執行機構）。
- **科技**：全自動 EV 與磁浮交通、AI 駕駛、神經介面輔助、全域監控網路。
- **資源**：電力充足、晶片與資料資源集中、乾淨水源穩定。
- **居民生活**：高度秩序化、行程與交通由 AI 排程、個人風險被系統性降低。
- **對 APEX 的態度**：官方立場是「危險的懷舊娛樂」，但暗中利用 APEX
  作為篩選人才、測試新科技與釋放地下壓力的工具。
- **視覺風格**：潔淨的幾何建築、柔和人工照明、無縫的自動化介面、色調偏冷。
- **故事用途**：作為安全與控制的具象化，提供「用自由換安全」的制度性反方角色。

### 4.2 The Wasteland

- **控制者**：無單一控制者；由地方軍閥、機械社群與家族性維修網路分區自治。
- **科技**：改裝內燃機、回收零件拼裝車輛、非官方合成燃料提煉。
- **資源**：資源普遍匱乏，燃料與零件是硬通貨。
- **居民生活**：依賴技術與人際信任維生，風險是日常的一部分。
- **對 APEX 的態度**：視 APEX 為證明自我價值與地方尊嚴的核心舞台。
- **視覺風格**：鏽蝕金屬、風沙侵蝕的公路、手工改裝痕跡，色調偏暖、偏乾。
- **故事用途**：作為自由與代價的具象化，提供人類技藝與風險承擔的正方角色。

### 4.3 Border / Transit Zones

- **控制者**：Dome Authority 與地方勢力共同監管的緩衝帶，執法強度時常模糊。
- **科技**：檢查哨科技、身份驗證系統、有限的合法內燃機通行許可。
- **資源**：合法貿易與走私貿易並存，資源流動量大但風險高。
- **居民生活**：以中介、翻譯、掮客、貿易商為主要生計。
- **對 APEX 的態度**：矛盾——既依賴 APEX 帶來的貿易機會，又擔心引來 Dome 稽查。
- **視覺風格**：檢查哨燈光、臨時搭建的市集、雙重身份的建築語彙。
- **故事用途**：提供劇情所需的灰色地帶，供間諜、走私、身份揭露類衝突發生。

### 4.4 Underground Networks

- **控制者**：分散式的地下車隊聯盟與訊息掮客，無中心指揮。
- **科技**：加密通訊、非官方維修知識庫、手動改裝與逆向工程。
- **資源**：以互助與信任經濟運作，資源共享但也容易被背叛。
- **居民生活**：流動性高，身份時常隱匿或多重。
- **對 APEX 的態度**：視 APEX 為自己文化的延伸與驗證場。
- **視覺風格**：地下停車場、廢棄地鐵、臨時燈光陣列。
- **故事用途**：Comeback Arc、Reserve 候選人與地方恩怨的主要發生地。

### 4.5 Abandoned Legendary Circuits

- **控制者**：無正式控制者；由地方傳說與非正式管理人維護。
- **科技**：舊時代賽道基礎設施殘骸，部分計時與安全系統仍可運作。
- **資源**：歷史紀錄與傳說本身即是稀缺資源（誰能證明自己配得上這條賽道）。
- **居民生活**：多為朝聖式的短期聚集，而非長期定居。
- **對 APEX 的態度**：視為精神聖地，帶有儀式性。
- **視覺風格**：褪色的賽道塗裝、鏽蝕看台、殘留的舊時代廣告牌。
- **故事用途**：World Tour 高潮賽事與致敬歷史類 Beat 的首選場景。

### 4.6 Resource Corridors

- **控制者**：由 Resource Cartels 與 Dome 授權運輸公司分段控制。
- **科技**：自動化運輸車隊、監控無人機、資源追蹤系統。
- **資源**：燃料、電池原料、晶片、稀土等關鍵資源的實體運輸路線。
- **居民生活**：以護送、劫掠、稅收與談判為生計核心。
- **對 APEX 的態度**：視 APEX 賽事為掩護資源交易或製造衝突的機會。
- **視覺風格**：長途公路、護送車隊、邊界檢查燈光。
- **故事用途**：Resource Conflict 類 Beat 與 Faction 之間的直接衝突場景。

### 4.7 Black Markets

- **控制者**：無單一控制者；由多個互相競爭的交易網路構成。
- **科技**：偽造身份系統、走私改裝技術、非法資料交易。
- **資源**：稀缺零件、違禁科技、偽造證件、情報。
- **居民生活**：以交易與資訊為生,身份與信譽是最重要的貨幣。
- **對 APEX 的態度**：視 APEX 候選人與車隊為高價值客戶與情報來源。
- **視覺風格**：擁擠的臨時攤位、混合多國語言標示、非正式燈光。
- **故事用途**：Vehicle Rules 違規、Penalties 相關情節與角色背景故事的來源。

### 4.8 Broadcast Networks

- **控制者**：由官方授權媒體與地下獨立廣播者共同構成的鬆散生態。
- **科技**：全球串流基礎設施、地下加密頻道、觀眾即時反饋系統。
- **資源**：關注度、話語權與敘事詮釋權本身即是資源。
- **居民生活**：主播、剪輯者、地下記者以內容與詮釋為生。
- **對 APEX 的態度**：既是 APEX 的放大器，也是操縱輿論與 Traffic 的戰場。
- **視覺風格**：多層疊加的螢幕介面、直播疊字、地下頻道的手作美學。
- **故事用途**：Traffic 與 Human Gate 之間張力的具象化場景（見 `CANON_STATE_MODEL.md` 第 6 節）。

---

## 5. Major Factions

### 5.1 Dome Authority

- **Goal**：維持秩序、資源效率與可預測的社會穩定。
- **Ideology**：安全與效率高於個人自由；風險是需要被系統性消除的變數。
- **Resources**：電力、AI 運算資源、監控網路、合法制度暴力。
- **Methods**：法規、監控、資格審查、選擇性鎮壓、有限度的懷柔招安。
- **Internal Contradiction**：口號是保護所有人類，實際運作卻持續剝奪個體風險與選擇權。
- **Relationship with APEX**：官方否認支持，實際上利用 APEX 篩選人才與釋放地下壓力。
- **Potential Season Conflict**：Dome 對 APEX 的介入程度加深，迫使玩家陣營選邊。

### 5.2 Wasteland Combustion Communities

- **Goal**：保存機械技藝、維持地方自治與生存尊嚴。
- **Ideology**：親手承擔風險才是真正的自由；依賴機器等於交出自我。
- **Resources**：維修技藝、家族知識、拼裝車輛、地方忠誠。
- **Methods**：互助網路、地下賽事、抵制與規避 Dome 監管。
- **Internal Contradiction**：崇尚自由卻也高度依賴部落式忠誠與內部階級。
- **Relationship with APEX**：視 APEX 為證明自身價值的正當舞台，同時警惕被 Dome 收編。
- **Potential Season Conflict**：社群內部對「是否參加官方 APEX」產生路線分裂。

### 5.3 Hybrid / Independent Engineers

- **Goal**：追求技術本身的可能性，不效忠任何單一陣營。
- **Ideology**：機器是工具而非信仰對象；純內燃或純電動都是教條。
- **Resources**：跨陣營的技術知識、混合動力原型車、中立聲譽。
- **Methods**：技術交換、跨陣營合作、拒絕政治表態。
- **Internal Contradiction**：標榜中立，卻不可避免被雙方陣營要求選邊。
- **Relationship with APEX**：視 APEX 為驗證技術理念的實驗場，而非意識形態戰場。
- **Potential Season Conflict**：某項突破性技術被迫選擇歸屬,引爆雙方陣營爭奪。

### 5.4 Resource Cartels

- **Goal**：壟斷關鍵資源流動並從中持續獲利。
- **Ideology**：資源是唯一真實的權力語言,意識形態可交易。
- **Resources**：燃料、電池原料、晶片、運輸路線、私人武力。
- **Methods**：價格操縱、封鎖、選擇性供應、資助特定車隊。
- **Internal Contradiction**：需要 APEX 帶來的市場熱度,卻也懼怕 APEX 培養出獨立於自己的英雄。
- **Relationship with APEX**：以贊助與資源供應形式滲透賽事,操縱車隊選擇。
- **Potential Season Conflict**：Cartel 之間為爭奪某支潛力車隊的資源供應權爆發代理人衝突。

### 5.5 Underground Broadcasters

- **Goal**：掌握敘事詮釋權,讓地下的聲音被世界看見。
- **Ideology**：真相與關注度同等重要;沉默等於消失。
- **Resources**：加密頻道、觀眾信任、剪輯與敘事能力。
- **Methods**：直播、爆料、剪輯敘事、與官方媒體的資訊戰。
- **Internal Contradiction**：追求真相的同時,也依賴流量生存,容易被 Traffic 誘導扭曲敘事。
- **Relationship with APEX**：是 APEX 故事對外傳播的主要通道,也是 Traffic Boundary
  規則（見 `APEX_RULES_V1.md` 第 12 節）最直接的測試場。
- **Potential Season Conflict**：某位 Broadcaster 的敘事操縱行為威脅到比賽公正性。

### 5.6 APEX Organizers

- **Goal**：維持 APEX 系統本身的存續、公平性與神秘感。
- **Ideology**：APEX 高於任何單一陣營;規則的存在本身就是價值。
- **Resources**：賽事基礎設施、資格審查權、Evidence 驗證體系、歷史紀錄。
- **Methods**：規則制定、資格審核、Wild Card 與 Comeback 的裁決（見 `APEX_RULES_V1.md`）。
- **Internal Contradiction**：宣稱中立,實際上內部存在不明的權力結構與 Era VIII/IX 的歷史包袱。
- **Relationship with APEX**：即 APEX 系統的實際運營者,是規則的守護者也是潛在的操縱者。
- **Potential Season Conflict**：Organizers 內部關於是否讓 Dome 深度介入 APEX 產生分裂。

---

## 6. Technology Rules

每項科技必須同時定義：能做什麼、不能做什麼、成本是什麼、為什麼不能無限使用。
禁止出現可以隨時解決所有問題的萬能科技。

### 6.1 AI Driving

- 能做：在已知路況下提供接近最優的行駛路徑與反應速度。
- 不能：在 Wasteland 未知或人為破壞的路況下保持同等可靠度;無法複製人類臨場的直覺判斷。
- 成本：需要穩定電力與運算資源;在資源匱乏區域幾乎無法維持。
- 限制原因：APEX 的戲劇張力建立在「人類判斷仍然重要」之上,AI Driving 若無限可靠,
  故事的核心問題（第 2 節）將失去意義。

### 6.2 EV / Battery Systems

- 能做：提供穩定、安靜、低維護的動力輸出,在 Dome 基礎設施下表現優異。
- 不能：在缺乏充電基礎設施的 Wasteland 長期可靠運作;電池老化後效能顯著下降。
- 成本：電池原料（鋰、鎳、鈷）稀缺且被 Resource Cartels 部分壟斷。
- 限制原因：確保 EV 陣營的優勢是「有條件的優勢」,而非絕對優勢,維持與內燃機陣營的戲劇平衡。

### 6.3 Combustion Engines

- 能做：在缺乏基礎設施的環境中提供獨立於電網的機動力,可就地維修。
- 不能：無限取得合成燃料;長期使用造成明顯的機件耗損與污染。
- 成本：燃料稀缺、零件依賴回收與黑市、維修需要專門技藝。
- 限制原因：內燃機文化的價值在於「技藝與風險」,若燃料與零件無限供應,
  第 5.2 節社群的核心矛盾將消失。

### 6.4 Synthetic Fuel

- 能做：在特定條件下替代天然燃料,支撐地下內燃機文化存續。
- 不能：大規模量產;生產過程需要不穩定且受管制的原料與設備。
- 成本：生產設備稀有、技術知識掌握在少數工程師手中。
- 限制原因：作為 Resource Conflict 的核心變數之一,合成燃料必須維持稀缺性
  才能持續驅動故事衝突（見第 7 節）。

### 6.5 Nuclear / Grid Energy

- 能做：支撐 Dome 內部大規模自動化與監控系統的長期穩定運作。
- 不能：安全地延伸至 Wasteland 的分散式聚落;需要龐大且集中的基礎設施。
- 成本：建設與維護成本極高,是 Dome Authority 權力集中的物質基礎。
- 限制原因：能源集中即權力集中,這是 Dome 治理正當性與壓迫性並存的根源。

### 6.6 Neural Interfaces

- 能做：讓駕駛以近乎直覺的速度與車輛系統溝通,縮短反應時間。
- 不能：完全取代身體技藝與風險判斷;長期使用有神經疲勞與依賴風險。
- 成本：需要 Dome 級醫療與技術支援,普通 Wasteland 居民難以負擔或維護。
- 限制原因：避免神經介面成為單方面的絕對優勢,同時保留「人類技藝」作為故事價值。

### 6.7 Surveillance

- 能做：讓 Dome Authority 追蹤車輛、身份與資源流動。
- 不能：完整覆蓋 Wasteland 與 Black Market 的所有活動;存在監控死角與可規避的路徑。
- 成本：需要持續的運算與人力資源投入;監控範圍與治理正當性成反比。
- 限制原因：監控死角是地下敘事與 Underground Broadcasters 得以存在的物質基礎。

### 6.8 Communications

- 能做：支撐官方廣播網路與地下加密頻道並存的資訊生態。
- 不能：保證訊息絕對真實或即時;地下頻道時常延遲或遭截斷。
- 成本：加密與反監控技術需要持續更新,資訊本身即是稀缺資源。
- 限制原因：資訊落差是製造懸念、誤解與 Wild Card 揭露類劇情的關鍵機制。

### 6.9 Vehicle Repair

- 能做：讓損壞車輛恢復競爭力,是 Wasteland 技藝文化的核心展示場。
- 不能：即時完成;需要時間、零件與專業技藝,無法透過科技瞬間跳過。
- 成本：零件稀缺、維修時間本身是 Resource System 中的關鍵稀缺資源之一。
- 限制原因：維修時間的稀缺性是製造賽事戰略深度與角色犧牲的核心機制。

### 6.10 Autonomous Weapons

- 能做：在極端情境下提供防禦性反制能力。
- 不能：在 APEX 賽事中合法使用（見 `APEX_RULES_V1.md` 第 4 節禁用系統）。
- 成本：擁有與使用皆有高度政治與法律風險,一旦曝光將引發 Dome 直接介入。
- 限制原因：APEX 必須維持「競技」而非「戰爭」的敘事定位,自動化武器必須保持稀有且高代價。

### 6.11 Medical Technology

- 能做：在 Dome 內提供高水準的創傷處理與復健。
- 不能：在 Wasteland 普遍取得;地下醫療資源有限且品質不穩定。
- 成本：先進醫療技術集中於 Dome,取得管道涉及政治與經濟代價。
- 限制原因：醫療資源落差強化了「安全 vs 自由」的階級張力,並為角色犧牲提供真實代價。

---

## 7. Resource System

以下資源共同構成 DC 2100 的稀缺經濟,直接影響比賽、車隊、國家/地區、故事衝突與晉級機會。

| 資源 | 對比賽的影響 | 對車隊的影響 | 對國家/地區的影響 | 對故事衝突的影響 | 對晉級機會的影響 |
|---|---|---|---|---|---|
| Fuel | 決定賽段可用車輛類型 | 決定車隊能否完成賽程 | 決定地區內燃機文化存續 | Resource Cartel 封鎖劇情核心 | 燃料短缺可導致 WITHDRAWN |
| Battery Cells | 決定 EV 陣營持續作戰力 | 決定電動車隊維護成本 | 決定地區電動化程度 | 電池原料壟斷引發衝突 | 電池取得失敗可導致淘汰 |
| Chips | 決定 AI 輔助系統可用性 | 決定車隊科技上限 | 決定地區科技依賴程度 | 晶片禁運類 Beat 的核心資源 | 晶片短缺限制 Wild Card 資格 |
| Tires | 決定賽道表現穩定性 | 決定車隊補給策略 | 決定地區工業供應能力 | 補給線爭奪的具體標的 | 輪胎耗盡可導致 Survival Stage 失敗 |
| Mechanical Parts | 決定車輛可修復程度 | 決定車隊技師團隊價值 | 決定地區維修產業規模 | 零件走私網路的核心敘事素材 | 零件不足可導致 Comeback 失敗 |
| Clean Water | 決定車隊人員續航能力 | 決定車隊駐紮成本 | 決定地區居住可行性 | 水源爭奪類 Resource Conflict | 極端情境下影響車手健康狀態 |
| Electricity | 決定基礎設施可用性 | 決定車隊科技維護能力 | 決定地區自動化程度 | 電網爭奪的具體標的 | 電力不足可限制 Comeback 資格 |
| Safe Passage | 決定移動路線可行性 | 決定車隊能否準時抵達賽事 | 決定地區與外界連結程度 | Convoy/Escort 賽制的核心變數 | 無法安全通行可導致 WITHDRAWN |
| Satellite Access | 決定即時數據與導航精度 | 決定車隊戰術資訊優勢 | 決定地區與全球網路的連結 | 資訊戰與 Broadcast 衝突的素材 | 衛星存取權可影響 Wild Card 評估的 Evidence |
| Data | 決定賽事分析與策略深度 | 決定車隊情報優勢 | 決定地區資料主權爭議 | 資料竊取類 Penalty 的核心資源 | 資料造假可導致 DISQUALIFIED |
| Repair Time | 決定車輛能否準時復出 | 決定車隊賽程安排彈性 | 決定地區維修產業效率 | 時間壓力下的犧牲抉擇 | 修復時間不足可導致 ELIMINATED |

規則：任何 Beat 或 Short 若涉及資源衝突,必須明確指出上述表格中至少一項資源,
不得使用未定義的抽象「資源短缺」概念。

---

## 8. Themes

- **Freedom vs Control**：個人風險選擇權與系統性安全保障之間的根本張力。
- **Human Skill vs Automation**：親手掌握的技藝是否仍有價值,或終將被自動化取代。
- **Memory vs Progress**：保存歷史技藝與知識,與追求效率至上的進步主義之間的拉扯。
- **Survival vs Dignity**：單純活下去,與活得有尊嚴、有選擇之間的取捨。
- **Machine as Tool vs Machine as Identity**：車輛究竟是工具,還是角色身份與價值觀的延伸。
- **National Culture vs Global System**：地方汽車文化與全球資源/科技秩序之間的角力。
- **Traffic Popularity vs Earned Victory**：觀眾關注度與比賽中真正贏得的勝利之間的落差
  （對應 `APEX_RULES_V1.md` 第 12 節 Traffic Boundary）。

每個 Season Beat（見 `SEASON_1_GLOBAL_QUALIFIERS.md`）都應至少對應一項主題,
且不得所有 Beat 都對應同一項主題。

---

## 9. Tone

- **Serious Core**：核心衝突必須被認真對待,角色的抉擇必須有真實代價。
- **Political Satire Boundaries**：遵循 `CANON.md` 第 8 節;諷刺對象是制度、誘因與意識形態,
  不是族群或個人。
- **Dark Humor**：允許,但必須服務角色或情境,不能取代真實的戲劇張力。
- **Automotive Passion**：車輛與駕駛技藝必須被以真實的熱情與細節呈現,不能淪為背景道具。
- **Emotional Realism**：角色反應必須符合其處境的合理情感邏輯,不得為了衝擊效果而失真。
- **Action Intensity**：動作場面應緊湊且有明確的風險與後果,不得為了炫技而失去故事功能。
- **Forbidden Tonal Failures**：DC 2100 明確禁止整個系列退化成:
  - 無限升級爽文
  - 無代價超能力
  - 每集相同逆襲模板
  - 只有參數、沒有角色
  - 只有政治梗、沒有故事
  - 最高流量角色永遠獲勝

任何 Story Direction 提案若符合上述任一「Forbidden Tonal Failure」,
必須在 Gate 2（Story Direction Selection,見 `CANON_STATE_MODEL.md` 第 5 節）被拒絕。

---

## 10. Immutable Canon

以下規則永遠不能被流量、AI 或單支 Short 改寫,只能透過完整的世界觀重製流程變更
（目前版本沒有這種流程,代表以下規則在 V1 生命週期內視為固定）:

1. 核心戲劇問題（第 2 節）永遠不能被單一 Short 一次性解決。
2. Dome 與 Wasteland 的二元世界結構必須存在,且雙方都不能被寫成單純的善或惡。
3. 內燃機文化不能被寫成單純優於或劣於電動科技。
4. APEX 的比賽結果不能由流量、人氣或訂閱數直接決定（見 `APEX_RULES_V1.md` 第 12 節）。
5. Canon 狀態的正式生效必須經過 Michael 的 Human Gate（見 `CANON_STATE_MODEL.md` 第 5 節）。
6. 不得將真實尚未發生或未證實的事件寫成本宇宙的既定事實。
7. 不得使用受著作權保護的既有影視、動漫或遊戲角色作為正式 Canon 角色。
8. 不得將真實品牌或真實人物寫成 DC 2100 的官方合作方。
9. Era IX「The Silence」的真相必須保持模糊,不得被單一內容一次性定案。
10. 六大 Faction（第 5 節）的核心 goal 與 internal contradiction 不得被單一 Short 逆轉。
11. APEX main competition hierarchy（Global Qualifiers → Regional Qualifiers →
    APEX World Tour → Final Championship）與 Underground Circuits 作為其
    parallel pathway 的定位（見 `APEX_RULES_V1.md` 第 2 節）必須維持存在，
    不得改回線性的多層晉級架構。
12. Resource System（第 7 節）列出的稀缺資源類別不得被單一科技突破全面解決。
13. 第 13 節 Locked Decisions 列出的四項 Michael 決策，在其各自的適用範圍內
    具有最高優先權，任何其他章節若與之衝突，以第 13 節為準。

---

## 11. Dynamic Canon

以下內容可以被故事發展、Michael 的決策與觀眾反應改變,前提是所有變更都必須
通過 `CANON_STATE_MODEL.md` 定義的 Human Gate 與 Canon State 生命週期:

1. 各 Faction 之間的即時聯盟與敵對關係(RIVALRY_CREATED / ALLIANCE_CREATED / ALLIANCE_BROKEN)。
2. 個別 Driver、Team、Vehicle 的晉級狀態(QUALIFIED / ELIMINATED / RESERVE 等)。
3. 個別 Region 的解鎖狀態與故事優先順序(REGION_UNLOCKED)。
4. Era IX「The Silence」真相的逐步揭露程度(揭露速度與角度可調整,結論保持開放)。
5. 個別資源(第 7 節)在特定 Region 或 Season 的稀缺程度數值。
6. Dome Authority 對 APEX 的介入深度(可隨 Season 演進而加深或收斂)。
7. 個別角色的次要人格特徵與人際關係(核心 goal 與 ideology 不可變,細節可演化)。
8. 特定 Underground Circuit 或 Legendary Circuit 的開放與關閉狀態。

---

## 12. IP Safety

1. **真實車輛可以作為 Evidence Anchor**：真實世界車輛的公開新聞、賽事表現或文化熱度,
   可作為 Fusion Candidate 的證據來源與靈感輸入,但不得直接以官方名稱與外觀重製為 Canon 車輛。
2. **不暗示品牌官方合作**：任何內容不得以文字、視覺或敘事方式暗示與真實車廠、贊助商
   或平台存在官方合作、授權或背書關係。
3. **真實人物 Evidence 不等於直接複製真人角色**：真實公眾人物的新聞熱度可作為
   Person Radar 與 Historical Resonance 的證據輸入,但輸出的 DC 2100 角色必須是原創身份、
   原創姓名、原創背景,不得直接以真人姓名、肖像或可辨識特徵呈現。
4. **DC 2100 Driver、Team、Faction、Dialogue 必須原創**：所有正式 Canon 角色與其台詞
   必須是為 DC 2100 世界觀原創撰寫,不得逐字或近乎逐字取自其他作品或真人言論。
5. **不直接複製既有影視角色、服裝、交通工具和標誌性外觀**：不得使用其他電影、動漫、
   遊戲中具辨識度的角色設計、服裝設計、載具設計或標誌性視覺符號。
6. **免責聲明不能取代原創化**：在內容中加註「純屬虛構」或類似免責聲明,
   不能作為使用真實品牌、真人肖像或受著作權保護角色設計的替代方案;
   原創化本身是強制要求,免責聲明只是附加的透明度措施。

---

## 13. Locked Decisions

本節記錄 Michael 對四項核心設計問題的正式決策（approved_by: michael，
approved_at: 2026-07-14）。這些決策具有最高優先權：本文件、`APEX_RULES_V1.md`、
`SEASON_1_GLOBAL_QUALIFIERS.md`、`CANON_STATE_MODEL.md` 四份文件中任何與本節
衝突的敘述，一律以本節為準，並視為需要修正的文件錯誤。

### 13.1 LOCKED_DECISION_ERA_IX — Era IX「The Silence」揭露邊界

- Season 1 只能揭露 fragmentary（殘缺、不完整）的證據。
- 不得將 Dome Authority 正式認定為 Era IX 事件的唯一責任方；證據可以指向
  Dome 的嫌疑，但不得升級為定案的事實陳述。
- 真相可以跨越多個 Season 逐步揭露，揭露的速度與角度屬於 Dynamic Canon
  （見第 11 節）。
- 任何單一 Short、Outline 或 Script 都不得對 Era IX 真相做出最終定案。

### 13.2 LOCKED_DECISION_DOME_EUROPE_ONLY — Dome Authority 在 Season 1 的介入範圍

- Season 1 內，Dome Authority 只取得 `REGION_EUROPE` 的 infrastructure safety
  review authority（基礎設施安全審查權）。
- 明確排除：
  - no scoring authority（對 `APEX_RULES_V1.md` 第 6 節 Scoring 無任何權限）
  - no race-result authority（對比賽結果無任何權限）
  - no authority over other regions（對其餘七個 Region Slot 沒有權限）
- 任何擴大介入範圍的提案，必須先成立新的 `PROPOSED_STATE_CHANGE`，
  並經 Gate 7 — Canon State Commit 核准後才能生效（見 `CANON_STATE_MODEL.md` 第 5 節）。

### 13.3 LOCKED_DECISION_DISQUALIFIED_LIFECYCLE — DISQUALIFIED 實體的長期規則

同一 Season 內：

- no Reserve
- no Wild Card
- no Comeback
- no re-entry（不得以任何形式重新進入本 Season 賽事）

跨 Season：

- 該實體可在完成處分、申訴或重新資格條件後，以全新的 `DISCOVERED` Candidate
  身分重新申請進入未來 Season。
- 重新申請必須依序經過 Gate 1（Candidate Selection）與 Gate 7
  （Canon State Commit），不得跳過任一 Gate。
- 原本的 `DISQUALIFIED` 歷史紀錄永久保留，不因重新申請而被刪除、修改或掩蓋
  （呼應 `CANON_STATE_MODEL.md` 第 4 節「只增不改」原則）。

### 13.4 LOCKED_DECISION_UNDERGROUND_PARALLEL — Underground Circuits 定位

Underground Circuits 採用 **Side Competition Network（平行路徑）** 定位，
與 APEX main competition hierarchy（Global Qualifiers → Regional Qualifiers →
APEX World Tour → Final Championship）並行運作，不是主線必經的線性晉級層級。
Underground Circuits 的結果只能產生 Evidence、Wild Card 提案、Comeback 代價
完成證明或重新報名/晉級提案，不得自動授予資格或讓參賽者跳過 Human Gate。
完整規則見 `APEX_RULES_V1.md` 第 2 節。
