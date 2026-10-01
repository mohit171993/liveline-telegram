/**
 * GiftPort gift card API.
 * Docs (captured from the provider console): base https://giftport.in/api/giftcard
 * Every call sends clientId + secretId. POST JSON is preferred; GET query also works.
 * There is no separate auth endpoint — credentials travel with each request.
 */

export interface GiftCatalogueItem {
  operatorCode: string;
  brandName: string;
  brandImage: string;
  denominations: number[];
  variable: boolean;
}

export interface GiftBalance {
  ok: boolean;
  balance: number;
  currency: string;
  message: string;
}

export interface GiftBuyRequest {
  orderId: string;
  operatorCode: string;
  amount: number;
  mobile: string;
  recipientName: string;
  recipientEmail: string;
}

export interface GiftBuyResult {
  ok: boolean;
  orderId: string;
  transactionId?: string;
  redeemCode?: string;
  cardNo?: string;
  message: string;
  /** True when the HTTP call itself failed and the provider may have accepted it. */
  uncertain?: boolean;
}

export interface GiftStatusResult {
  ok: boolean;
  found: boolean;
  orderId: string;
  transactionId?: string;
  amount?: number;
  redeemCode?: string;
  cardNo?: string;
  mobile?: string;
  email?: string;
  createdAt?: string;
  message: string;
}

export interface RewardsProvider {
  /** Validate credentials. GiftPort does this implicitly; we probe /balance. */
  auth(): Promise<{ ok: boolean; message: string }>;
  listCatalogue(): Promise<GiftCatalogueItem[]>;
  getBalance(): Promise<GiftBalance>;
  issueVoucher(input: GiftBuyRequest): Promise<GiftBuyResult>;
  checkOrderStatus(orderId: string): Promise<GiftStatusResult>;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function parseCatalogue(body: unknown): GiftCatalogueItem[] {
  const data = asRecord(body);
  const rows = Array.isArray(data.catalogue) ? data.catalogue : [];
  return rows.map((row) => {
    const item = asRecord(row);
    const denominations = String(item.denominations || "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      operatorCode: String(item.operator_code || ""),
      brandName: String(item.brand_name || ""),
      brandImage: String(item.brand_image || ""),
      denominations,
      variable: String(item.variable || "").toLowerCase() === "yes",
    };
  }).filter((item) => item.operatorCode && item.brandName);
}

export function parseBalance(body: unknown): GiftBalance {
  const data = asRecord(body);
  const status = String(data.status || "").toLowerCase();
  return {
    ok: status === "success",
    balance: asNumber(data.balance),
    currency: String(data.currency || "INR"),
    message: String(data.message || ""),
  };
}

export function parseBuy(body: unknown): GiftBuyResult {
  const data = asRecord(body);
  const status = String(data.status || "").toLowerCase();
  const ok = status === "success";
  return {
    ok,
    orderId: String(data.order_id || ""),
    transactionId: data.transaction_id ? String(data.transaction_id) : undefined,
    redeemCode: data.redeem_code ? String(data.redeem_code) : undefined,
    cardNo: data.card_no ? String(data.card_no) : undefined,
    message: String(data.message || (ok ? "Transaction Successfully Accepted" : "failure")),
  };
}

export function parseStatus(body: unknown): GiftStatusResult {
  const data = asRecord(body);
  const status = String(data.status || "").toLowerCase();
  if (!status || status === "not_found" || status === "not found") {
    return { ok: false, found: false, orderId: String(data.order_id || ""), message: String(data.message || "not found") };
  }
  const ok = status === "success";
  return {
    ok,
    found: true,
    orderId: String(data.order_id || ""),
    transactionId: data.transaction_id ? String(data.transaction_id) : undefined,
    amount: data.amount != null ? asNumber(data.amount) : undefined,
    redeemCode: data.redeem_code ? String(data.redeem_code) : undefined,
    cardNo: data.card_no ? String(data.card_no) : undefined,
    mobile: data.mobile ? String(data.mobile) : undefined,
    email: data.email ? String(data.email) : undefined,
    createdAt: data.created_at ? String(data.created_at) : undefined,
    message: String(data.message || status),
  };
}

export function amountAllowed(item: GiftCatalogueItem, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (item.denominations.includes(amount)) return true;
  return item.variable;
}
