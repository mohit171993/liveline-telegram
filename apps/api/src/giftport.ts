import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  parseBalance,
  parseBuy,
  parseCatalogue,
  parseStatus,
  type GiftBalance,
  type GiftBuyRequest,
  type GiftBuyResult,
  type GiftCatalogueItem,
  type GiftStatusResult,
  type RewardsProvider,
} from "@liveline/shared";
import { env } from "./env";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real GiftPort provider.
 * POST https://giftport.in/api/giftcard/{catalogue|balance|buy|status}
 * clientId and secretId go in the JSON body of every call.
 * /buy is never retried: a timeout is an uncertain order and must be reconciled via /status.
 */
export class GiftPortProvider implements RewardsProvider {
  private dispatcher?: ProxyAgent;

  constructor(
    private readonly opts = {
      clientId: env.giftClientId,
      secretId: env.giftSecretId,
      baseUrl: env.giftApiUrl,
      proxyUrl: env.giftProxy,
    },
  ) {
    if (opts.proxyUrl) this.dispatcher = new ProxyAgent(opts.proxyUrl);
  }

  async auth(): Promise<{ ok: boolean; message: string }> {
    const balance = await this.getBalance();
    return { ok: balance.ok, message: balance.message || (balance.ok ? "ok" : "auth failed") };
  }

  async listCatalogue(): Promise<GiftCatalogueItem[]> {
    return parseCatalogue(await this.post("/catalogue", {}, true));
  }

  async getBalance(): Promise<GiftBalance> {
    return parseBalance(await this.post("/balance", {}, true));
  }

  async issueVoucher(input: GiftBuyRequest): Promise<GiftBuyResult> {
    try {
      const body = await this.post(
        "/buy",
        {
          order_id: input.orderId,
          operator_code: input.operatorCode,
          amount: input.amount,
          mobile: input.mobile,
          recipient_name: input.recipientName,
          recipient_email: input.recipientEmail,
        },
        false,
      );
      const parsed = parseBuy(body);
      if (!parsed.orderId) parsed.orderId = input.orderId;
      return parsed;
    } catch (err) {
      return {
        ok: false,
        uncertain: true,
        orderId: input.orderId,
        message: err instanceof Error ? err.message : "GiftPort buy timed out",
      };
    }
  }

  async checkOrderStatus(orderId: string): Promise<GiftStatusResult> {
    try {
      return parseStatus(await this.post("/status", { order_id: orderId }, true));
    } catch (err) {
      return {
        ok: false,
        found: true,
        orderId,
        message: err instanceof Error ? err.message : "status failed",
      };
    }
  }

  private async post(path: string, extra: Record<string, unknown>, retry: boolean): Promise<unknown> {
    const attempts = retry ? 3 : 1;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await undiciFetch(`${this.opts.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            clientId: this.opts.clientId,
            secretId: this.opts.secretId,
            ...extra,
          }),
          dispatcher: this.dispatcher,
          signal: AbortSignal.timeout(12_000),
        });
        const text = await res.text();
        let json: unknown = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(`GiftPort ${path} returned non-JSON (${res.status})`);
        }
        if (res.status >= 500) throw new Error(`GiftPort ${path} HTTP ${res.status}`);
        return json;
      } catch (err) {
        last = err;
        if (i < attempts - 1) await sleep(250 * (i + 1));
      }
    }
    throw last instanceof Error ? last : new Error("GiftPort request failed");
  }
}

/** In-memory GiftPort used when USE_MOCK_GIFTPORT=true or credentials are empty. */
export class MockGiftPortProvider implements RewardsProvider {
  balance = 25000;
  private orders = new Map<string, GiftBuyResult & { amount: number; mobile: string; email: string }>();

  async auth() {
    return { ok: true, message: "mock" };
  }

  async listCatalogue(): Promise<GiftCatalogueItem[]> {
    return [
      {
        operatorCode: "AMZN",
        brandName: "Amazon Pay Gift Card",
        brandImage: "",
        denominations: [100, 250, 500, 1000],
        variable: true,
      },
      {
        operatorCode: "FKRT",
        brandName: "Flipkart Gift Card",
        brandImage: "",
        denominations: [100, 500, 1000],
        variable: false,
      },
      {
        operatorCode: "MYNTRA",
        brandName: "Myntra Gift Card",
        brandImage: "",
        denominations: [250, 500],
        variable: false,
      },
    ];
  }

  async getBalance(): Promise<GiftBalance> {
    return { ok: true, balance: this.balance, currency: "INR", message: "Balance fetched successfully" };
  }

  async issueVoucher(input: GiftBuyRequest): Promise<GiftBuyResult> {
    if (this.orders.has(input.orderId)) {
      const prev = this.orders.get(input.orderId)!;
      return prev;
    }
    if (input.amount > this.balance) {
      return { ok: false, orderId: input.orderId, message: `Insufficient Balance. Required: ₹${input.amount}.00` };
    }
    this.balance -= input.amount;
    const result = {
      ok: true,
      orderId: input.orderId,
      transactionId: `mock_${input.orderId.slice(-6)}`,
      redeemCode: `LL-${input.orderId.slice(-4).toUpperCase()}-${input.amount}`,
      cardNo: "4499001122",
      message: "Transaction Successfully Accepted",
      amount: input.amount,
      mobile: input.mobile,
      email: input.recipientEmail,
    };
    this.orders.set(input.orderId, result);
    return result;
  }

  async checkOrderStatus(orderId: string): Promise<GiftStatusResult> {
    const row = this.orders.get(orderId);
    if (!row) return { ok: false, found: false, orderId, message: "not found" };
    return {
      ok: !!row.ok,
      found: true,
      orderId,
      transactionId: row.transactionId,
      amount: row.amount,
      redeemCode: row.redeemCode,
      cardNo: row.cardNo,
      mobile: row.mobile,
      email: row.email,
      createdAt: new Date().toISOString(),
      message: row.message,
    };
  }
}

let singleton: RewardsProvider | null = null;

export function rewardsProvider(): RewardsProvider {
  if (!singleton) {
    singleton = useMock() ? new MockGiftPortProvider() : new GiftPortProvider();
  }
  return singleton;
}

function useMock(): boolean {
  const flag = (process.env.USE_MOCK_GIFTPORT || "true").toLowerCase();
  if (!env.giftClientId || !env.giftSecretId) return true;
  return flag === "1" || flag === "true" || flag === "yes";
}

export function providerName(): string {
  return useMock() ? "mock" : "giftport";
}
