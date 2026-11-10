## Lineup — Monetization

⚽ **Options, trade-offs, and a suggested path.**

---

## 📌 Governing Rule

**Sell depth and convenience in solo. Never sell advantage in duels.**

Test every idea against one question: _would a free player feel cheated if a paying opponent beat them?_ If yes, it doesn't ship. In a 1v1 game that perception spreads faster than the revenue does.

---

## 💰 Revenue

### Pro subscription — the only earner

See the Free vs Pro table in `project-overview.md` for the exact split.

The anchor feature is **exact match selection**: browse the archive, pick the precise fixture, play it now. It targets the strongest pull the product has — _"I want to play Istanbul 2005 right now"_ — and it's invisible to opponents.

|           |                                                                                        |
| --------- | -------------------------------------------------------------------------------------- |
| **Shape** | Monthly + annual (~40% off annual, pulls cash forward and cuts churn)                  |
| **Trial** | 7 days, or 3 free exact-match picks — let people feel the anchor feature before paying |
| **Risk**  | Low. Nothing gated is competitive                                                      |

**No ads** (user, 2026-11-10). The app ships without them, and nothing ad-related is built. They may be reconsidered after launch if the app grows.

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

**Platform take:** Apple and Google take 15–30% (15% under Apple's Small Business Program and Google's equivalent at indie revenue levels). Stripe takes ~3%.

**Steer subscriptions to the web where rules permit** — roughly a 5x margin difference. App Store policy on external purchase links has been in flux; verify current rules before building a link-out, and don't risk the listing over it. Unified entitlements are what make web-first billing viable at all.

---

## 📅 Sequencing

Do not launch monetized.

1. **Ship free and instrument.** You can't price what you can't measure — get real session length, D1/D7 retention, solo-vs-duel split first.
2. **Add Pro.** It validates whether archive access is actually the hook.

---

## 📊 Metrics

- Free → Pro conversion rate
- ARPDAU
- Trial → paid conversion, and annual vs monthly mix
- **Duel volume before and after every monetization change** — if duels drop, roll back regardless of what revenue did. The multiplayer pool is the product.

---

## ⚖️ Compliance

- **Minors.** Football trivia will attract under-13 users. Decide early whether accounts and purchases are age-gated. COPPA and the Play Families policy are expensive to retrofit.
- **Store requirements.** Visible subscription terms, working "restore purchases", accurate privacy labels. These are rejection-tier, not polish.

---

⚽ **Lineup — Know the XI. Beat the Clock.**
