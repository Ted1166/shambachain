import axios from "axios";
import { StkPushRequest, StkPushResponse, PendingStkPush } from "./mpesa.types";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
dotenv.config();

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY    ?? "";
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET ?? "";
const SHORTCODE       = process.env.MPESA_SHORTCODE        ?? "";
const PASSKEY         = process.env.MPESA_PASSKEY          ?? "";
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL     ?? "";
const BASE_URL        = "https://sandbox.safaricom.co.ke";

export const pendingStkPushes = new Map<string, PendingStkPush>();


async function getAccessToken(): Promise<string> {
  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const res = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  return res.data.access_token as string;
}


export async function initiateStkPush(req: StkPushRequest): Promise<StkPushResponse> {
  const token = await getAccessToken();

  const timestamp = getTimestamp();
  const password  = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString("base64");

  const payload = {
    BusinessShortCode: SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   "CustomerPayBillOnline",
    Amount:            req.amount,
    PartyA:            req.phoneNumber,
    PartyB:            SHORTCODE,
    PhoneNumber:       req.phoneNumber,
    CallBackURL:       CALLBACK_URL,
    AccountReference:  req.accountRef,
    TransactionDesc:   req.description,
  };

  const res = await axios.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = res.data as StkPushResponse;

  if (data.ResponseCode !== "0") {
    throw new Error(`STK Push failed: ${data.ResponseDescription}`);
  }

  pendingStkPushes.set(data.CheckoutRequestID, {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    phoneNumber:       req.phoneNumber,
    amount:            req.amount,
    accountRef:        req.accountRef,
    initiatedAt:       new Date(),
    status:            "pending",
  });

  logger.info(`STK Push initiated`, {
    checkoutRequestId: data.CheckoutRequestID,
    phone:             req.phoneNumber,
    amount:            req.amount,
    warehouse:         req.accountRef,
  });

  return data;
}


function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}