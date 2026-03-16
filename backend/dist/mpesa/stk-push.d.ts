import { StkPushRequest, StkPushResponse, PendingStkPush } from "./mpesa.types";
export declare const pendingStkPushes: Map<string, PendingStkPush>;
/**
 * Initiate an MPESA STK Push to collect the farmer's warehouse deposit fee.
 * Returns the CheckoutRequestID to track the transaction.
 *
 * Flow:
 *   1. Farmer approaches warehouse → operator enters phone + kg + commodity
 *   2. This function is called → farmer receives a prompt on their phone
 *   3. Farmer enters PIN → MPESA fires callback to /api/mpesa/callback
 *   4. webhook.ts parses callback → triggers HCS write + NFT mint
 */
export declare function initiateStkPush(req: StkPushRequest): Promise<StkPushResponse>;
//# sourceMappingURL=stk-push.d.ts.map