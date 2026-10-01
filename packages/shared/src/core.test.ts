import { describe, expect, it } from "vitest";
import { isAdmin, parseAdminList, signInitData, validateInitData, assertContactBelongsToUser, normalizePhone } from "./auth";
import { decryptString, encryptString, loadEncryptionKey } from "./crypto";
import { adEligible, clickDedupeKey, impressionDedupeKey, selectAd, type AdCandidate } from "./ads";
import { containsBetting, moderationDecision } from "./policy";
import { applyBoost, predictionWindowOpen, settleBallPick, settleMatchPick, settleOverPick } from "./predictions";
import { decideFulfilment, drawPrize, pickWeighted } from "./rewards";
import { amountAllowed, parseBalance, parseBuy, parseCatalogue, parseStatus, type GiftCatalogueItem } from "./giftport";
import { advanceMatch, buildDemoUniverse, projectMatch } from "./cricket";
import { celebrations, cheerAllowed, fanLoudness, nextDailyStreak, rankFor, scoreGuessPoints, shiftIstDay, triviaFor } from "./engage";
import { assertAvatar, castLook, teamMood } from "./avatar";
import { containsProfanity, maskProfanity } from "./profanity";
import { winProbability } from "./winprob";

const TOKEN = "123456:TEST_TOKEN";

describe("initData", () => {
  const user = { id: 8992664481, first_name: "Fantzo", username: "fantzoSportsUpdates", language_code: "en" };

  function signed(extra: Record<string, string> = {}, authDate = 1_700_000_000) {
    return signInitData(TOKEN, {
      auth_date: String(authDate),
      query_id: "AAEtest",
      user: JSON.stringify(user),
      ...extra,
    });
  }

  it("accepts a valid HMAC and reads the user", () => {
    const initData = signed();
    const result = validateInitData(initData, TOKEN, 1_700_000_000 * 1000, 3600);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(8992664481);
      expect(result.user.username).toBe("fantzoSportsUpdates");
    }
  });

  it("rejects a tampered payload and a stale auth_date", () => {
    const initData = signed();
    const tampered = initData.replace("Fantzo", "Nope");
    expect(validateInitData(tampered, TOKEN, 1_700_000_000 * 1000).ok).toBe(false);
    const stale = validateInitData(signed({}, 1_600_000_000), TOKEN, 1_700_000_000 * 1000, 3600);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBe("stale");
  });

  it("requires the contact to belong to the same telegram user", () => {
    expect(() => assertContactBelongsToUser(5, 5)).not.toThrow();
    expect(() => assertContactBelongsToUser(4, 5)).toThrow(/CONTACT_MISMATCH/);
    expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
  });

  it("matches admin ids and usernames from env", () => {
    const list = parseAdminList("8992664481, @fantzoSportsUpdates");
    expect(isAdmin(list, "8992664481", null)).toBe(true);
    expect(isAdmin(list, "1", "FantzoSportsUpdates")).toBe(true);
    expect(isAdmin(list, "2", "someone")).toBe(false);
  });
});

describe("predictions", () => {
  it("settles the next ball from the delivery, not from the client", () => {
    expect(settleBallPick("6", { runs: 6, batRuns: 6, extra: 0, wicket: false })).toMatchObject({ correct: true, points: 25, actual: "6" });
    expect(settleBallPick("4", { runs: 6, batRuns: 6, extra: 0, wicket: false })).toMatchObject({ correct: true, points: 6, actual: "6" });
    expect(settleBallPick("dot", { runs: 1, batRuns: 1, extra: 0, wicket: false }).points).toBe(0);
    expect(settleBallPick("wicket", { runs: 0, batRuns: 0, extra: 0, wicket: true }).correct).toBe(true);
    expect(settleOverPick("12", 12)).toMatchObject({ points: 20 });
    expect(settleOverPick("11", 12)).toMatchObject({ points: 8 });
    expect(settleOverPick("4", 12).correct).toBe(false);
    expect(settleMatchPick("a", "a").points).toBe(50);
    expect(predictionWindowOpen(1_000, 2_000, 800)).toBe(true);
    expect(predictionWindowOpen(1_500, 2_000, 800)).toBe(false);
    expect(applyBoost(10, 1)).toEqual({ points: 20, boostsLeft: 0 });
  });
});

describe("ads", () => {
  const base: AdCandidate = {
    id: "c1",
    slot: "home_native",
    weight: 1,
    active: true,
    campaignStatus: "active",
    startAt: null,
    endAt: null,
    matchKeys: [],
    seriesKeys: [],
    teamKeys: [],
    languages: [],
    frequencyCap: 2,
    seen: 0,
    headline: "Harbour Audio",
    body: "Match nights",
  };

  it("serves an eligible creative and dedupes impressions", () => {
    expect(selectAd([base], { now: 10, slot: "home_native" }, 0.1)?.id).toBe("c1");
    expect(adEligible({ ...base, seen: 2 }, { now: 10, slot: "home_native" })).toBe(false);
    expect(adEligible({ ...base, campaignStatus: "paused" }, { now: 10, slot: "home_native" })).toBe(false);
    expect(adEligible({ ...base, matchKeys: ["m1"] }, { now: 10, slot: "home_native", matchKey: "m2" })).toBe(false);
    const now = 3_600_000 * 5 + 10;
    expect(impressionDedupeKey("u", "c1", now)).toBe(impressionDedupeKey("u", "c1", now + 1000));
    expect(impressionDedupeKey("u", "c1", now)).not.toBe(impressionDedupeKey("u", "c1", now + 3_600_000));
    expect(clickDedupeKey("u", "c1", now)).toBe(clickDedupeKey("u", "c1", now + 1000));
  });
});

describe("rewards and giftport", () => {
  it("draws only in-stock prizes and blocks a buy until failure is confirmed", () => {
    const prizes = [
      { id: "a", kind: "points", weight: 0, active: true, points: 5, awarded: 0, label: "no" },
      { id: "b", kind: "voucher", weight: 5, active: true, points: 0, amountInr: 500, inventory: 1, awarded: 1, label: "gone" },
      { id: "c", kind: "points", weight: 5, active: true, points: 10, awarded: 0, label: "yes" },
    ];
    expect(drawPrize(prizes, 0.2, 1000)?.id).toBe("c");
    expect(pickWeighted([{ id: "x", weight: 1 }, { id: "y", weight: 100 }], 0.99).id).toBe("y");
    expect(decideFulfilment({ status: "ready", failureConfirmed: false, amountInr: 100, balance: 50 })).toBe("block_balance");
    expect(decideFulfilment({ status: "ready", failureConfirmed: false, amountInr: 100, balance: 500 })).toBe("buy");
    expect(decideFulfilment({ status: "uncertain", failureConfirmed: false, amountInr: 100, balance: 500 })).toBe("reconcile");
    expect(decideFulfilment({ status: "failed", failureConfirmed: false, amountInr: 100, balance: 500 })).toBe("reconcile");
    expect(decideFulfilment({ status: "failed", failureConfirmed: true, amountInr: 100, balance: 500 })).toBe("retry_new_order");
    expect(decideFulfilment({ status: "success", failureConfirmed: false, amountInr: 100, balance: 0 })).toBe("done");
  });

  it("parses the GiftPort samples", () => {
    const catalogue = parseCatalogue({
      status: "success",
      count: 1,
      catalogue: [{
        operator_code: "AMZN",
        brand_name: "Amazon Pay Gift Card",
        brand_image: "https://giftport.in/uploads/brands/amzn.png",
        denominations: "100,500,1000",
        variable: "Yes",
      }],
    });
    expect(catalogue[0].operatorCode).toBe("AMZN");
    expect(catalogue[0].denominations).toEqual([100, 500, 1000]);
    expect(amountAllowed(catalogue[0], 250)).toBe(true);
    const fixed: GiftCatalogueItem = { ...catalogue[0], variable: false };
    expect(amountAllowed(fixed, 250)).toBe(false);
    expect(parseBalance({ status: "success", balance: 9892.2, currency: "INR", message: "Balance fetched successfully" })).toMatchObject({
      ok: true,
      balance: 9892.2,
      currency: "INR",
    });
    expect(parseBuy({
      status: "success",
      order_id: "ORD_123456",
      transaction_id: "998877",
      redeem_code: "ABCD-1234-EFGH-5678",
      card_no: "1234",
      message: "Transaction Successfully Accepted",
    })).toMatchObject({ ok: true, redeemCode: "ABCD-1234-EFGH-5678" });
    expect(parseBuy({ status: "failure", message: "Insufficient Balance. Required: ₹500.00" }).ok).toBe(false);
    expect(parseStatus({
      status: "success",
      order_id: "ORD_123456",
      transaction_id: "998877",
      amount: 500,
      redeem_code: "ABCD-1234-EFGH-5678",
      card_no: "1234",
      mobile: "9876543210",
      email: "john@email.com",
      created_at: "2026-02-03 14:30:00",
    })).toMatchObject({ ok: true, found: true, amount: 500, email: "john@email.com" });
  });
});

describe("engagement", () => {
  it("ranks xp and protects a streak with one freeze", () => {
    expect(rankFor(0).name).toBe("Gully Player");
    expect(rankFor(80).name).toBe("Club Star");
    expect(rankFor(1200).name).toBe("Legend");
    expect(celebrations("SIX", ["fifty:m:p"])).toEqual(["SIX", "FIFTY"]);
    expect(celebrations(undefined, ["result:m:a"])).toEqual(["WIN"]);
    const today = "2026-10-01";
    const kept = nextDailyStreak({
      lastDay: shiftIstDay(shiftIstDay(today, -1), -1),
      today,
      yesterday: shiftIstDay(today, -1),
      streak: 4,
      freeze: 1,
    });
    expect(kept.usedFreeze).toBe(true);
    expect(kept.streak).toBe(5);
    expect(kept.freeze).toBe(0);
    const reset = nextDailyStreak({ lastDay: "2026-09-20", today, yesterday: shiftIstDay(today, -1), streak: 4, freeze: 1 });
    expect(reset.streak).toBe(1);
    expect(cheerAllowed(1000, 1500, 1)).toBe(false);
    expect(cheerAllowed(1000, 2000, 8)).toBe(false);
    expect(cheerAllowed(1000, 2000, 2)).toBe(true);
    expect(scoreGuessPoints(80, 80)).toBe(25);
    expect(scoreGuessPoints(84, 80)).toBe(15);
    expect(fanLoudness(2, 5)).toBe(11);
    expect(triviaFor("demo").options).toHaveLength(4);
    expect(triviaFor("demo").answer).toBeGreaterThanOrEqual(0);
    expect(assertAvatar({ face: "lion", jersey: "lime", cap: "cap", frame: "lime", role: "bat", number: 7 }, 10, [])).toBe("LOCKED");
    expect(assertAvatar({ face: "cool", jersey: "lime", cap: "cap", frame: "lime", role: "bowl", number: 18 }, 0, [])).toBeNull();
    const look = castLook("ind_bumrah", "bowl", "#ff7a18", 8);
    expect(look.icon).toBe("🎯");
    expect(look.number).toBe(9);
    expect(look.face).toMatch(/\p{Emoji}/u);
    expect(teamMood(70, ["1", "6", "4"]).emoji).toBe("🔥");
    expect(teamMood(20, ["W"]).emoji).toBe("😬");
  });
});

describe("cricket model", () => {
  it("keeps the live demo consistent and moves the score", () => {
    const [live] = buildDemoUniverse(1_700_000_000_000);
    expect(live.status).toBe("live");
    expect(live.demo).toBe(true);
    const chase = live.innings[1];
    expect(chase.runs).toBe(chase.balls.reduce((sum, ball) => sum + ball.runs, 0));
    const before = chase.runs;
    const stepped = advanceMatch(live, () => 0.5, 1_700_000_000_000);
    expect(stepped.ball).toBeTruthy();
    const view = projectMatch(stepped.match, true, 1_700_000_000_000);
    expect(view.live?.runs).toBeGreaterThanOrEqual(before);
    expect(view.live?.win.a).toBeGreaterThan(0);
    expect(view.predictionOpen?.ball).toBe(true);
    const paused = { ...live, breakUntil: 1_700_000_000_000 + 5000, breakKind: "timeout" as const };
    expect(advanceMatch(paused, () => 0.5, 1_700_000_000_000).ball).toBeUndefined();
  });

  it("does not look like a betting price", () => {
    const win = winProbability({
      batting: "b",
      innings: 2,
      runs: 140,
      wickets: 3,
      legalBalls: 96,
      maxOvers: 20,
      target: 180,
      format: "T20",
    });
    expect(win.a + win.b + win.tie).toBeGreaterThan(99);
    expect(containsBetting("what is the required rate")).toBe(false);
    expect(moderationDecision("give me the session odds")).toBe("betting");
    expect(containsProfanity("what a chutiya shot")).toBe(true);
    expect(maskProfanity("what a chutiya shot")).not.toContain("chutiya");
  });
});

describe("redeem codes", () => {
  it("round-trips ciphertext", () => {
    const key = loadEncryptionKey("liveline-pro-local-dev-key-32b!!");
    const enc = encryptString("ABCD-1234", key);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain("ABCD");
    expect(decryptString(enc, key)).toBe("ABCD-1234");
  });
});
