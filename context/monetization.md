## Lineup — Monetization

⚽ **Options, trade-offs, and a suggested path.**

---

## 📌 Governing Rule

**Sell depth and convenience in solo. Never sell advantage in duels.**

Test every idea against one question: _would a free player feel cheated if a paying opponent beat them?_ If yes, it doesn't ship. In a 1v1 game that perception spreads faster than the revenue does.

---

## 💰 Revenue Options

### 1. Pro subscription — primary

The main earner. See the Free vs Pro table in `project-overview.md` for the exact split.

The anchor feature is **exact match selection**: browse the archive, pick the precise fixture, play it now. It targets the strongest pull the product has — _"I want to play Istanbul 2005 right now"_ — and it's invisible to opponents.

|           |                                                                                        |
| --------- | -------------------------------------------------------------------------------------- |
| **Shape** | Monthly + annual (~40% off annual, pulls cash forward and cuts churn)                  |
| **Trial** | 7 days, or 3 free exact-match picks — let people feel the anchor feature before paying |
| **Risk**  | Low. Nothing gated is competitive                                                      |

### 2. One-time "Remove Ads" — secondary

A cheap, permanent purchase separate from Pro.

Converts the large group who will never subscribe but will pay once to stop being interrupted. Also a proven upgrade path into Pro later. Low effort, meaningful revenue.

### 3. Rewarded video — primary ad revenue

**"Watch an ad for +1 life to continue this run."** Solo only, opt-in.

Appears at the moment of maximum motivation, which is why rewarded video consistently outperforms banners. Also usable for: one extra solo run past the daily cap, or a one-off exact-match unlock.

### 4. Interstitial ads

Between solo runs, after the summary screen. Frequency-capped, never back-to-back, **never mid-round and never in a duel**.

### 5. Banner ads — lowest priority

Static surfaces only: home, profile, archive. Earns little and costs a lot in feel. Consider skipping entirely.

### 6. Cosmetics — one-time IAP

Club flair, badges, avatar frames, duel-result card themes. Sold individually to free users, bundled into Pro. Small revenue, zero fairness risk, and cosmetics tied to club identity fit this audience unusually well.

### 7. Season / league packs

New leagues (Eredivisie, Brasileirão) or eras as one-time purchases, free for Pro. Only worth building once the ingestion pipeline is cheap to extend.

### 8. Club or brand partnerships — speculative

Sponsored match packs, branded cosmetics. Real potential given the club list, but not a launch-phase strategy. Revisit at scale.

---

## 🚫 Rejected

| Idea                                          | Why not                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Paid lives, hints or time extensions in duels | Pay-to-win. Breaks the governing rule                                                                          |
| Pro-only matches in the duel pool             | Fragments matchmaking and creates the exact resentment we're avoiding                                          |
| Loot boxes / gacha / randomized paid rewards  | Regulatory exposure in several EU markets, tonally wrong for a recall game                                     |
| Capping free duels                            | Free users **are** the matchmaking pool. Throttling them starves paying players of opponents. Cap solo instead |

---

## 🧱 Implementation

| Concern      | Approach                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments     | **Stripe** (web) + native IAP (App Store / Play Billing), unified by **RevenueCat** — one entitlement API across all three platforms                                                                |
| Entitlements | Resolved in the **NestJS backend**, platform-agnostic. Bought on any platform, live on all of them. Never trust the client's claimed tier. Store webhooks land on the backend, never on the web app |
| Ads          | **AdMob** on mobile (`react-native-google-mobile-ads`); separate provider on web. Ad SDKs are natively split — not shared code                                                                      |

**Platform take:** Apple and Google take 15–30% (15% under Apple's Small Business Program and Google's equivalent at indie revenue levels). Stripe takes ~3%.

**Steer subscriptions to the web where rules permit** — roughly a 5x margin difference. App Store policy on external purchase links has been in flux; verify current rules before building a link-out, and don't risk the listing over it. Unified entitlements are what make web-first billing viable at all.

---

## 📅 Sequencing

Do not launch monetized.

1. **Ship free and instrument.** You can't price what you can't measure — get real session length, D1/D7 retention, solo-vs-duel split first.
2. **Add Pro.** Less retention-damaging than ads, and it validates whether archive access is actually the hook.
3. **Add ads last**, once you know what a session is worth and where the natural breaks are.

---

## 📊 Metrics

- Free → Pro conversion rate
- ARPDAU
- Rewarded-ad opt-in rate
- Trial → paid conversion, and annual vs monthly mix
- **Duel volume before and after every monetization change** — if duels drop, roll back regardless of what revenue did. The multiplayer pool is the product.

---

## ⚖️ Compliance

- **Consent platform** (Google UMP or similar) mandatory for ads under GDPR; **App Tracking Transparency** required on iOS.
- **Minors.** Football trivia will attract under-13 users. Decide early: age-gate, or serve non-personalized ads to everyone. COPPA and the Play Families policy are expensive to retrofit.
- **Store requirements.** Visible subscription terms, working "restore purchases", accurate privacy labels. These are rejection-tier, not polish.

---

⚽ **Lineup — Know the XI. Beat the Clock.**
