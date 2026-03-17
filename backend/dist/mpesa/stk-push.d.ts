import { StkPushRequest, StkPushResponse, PendingStkPush } from "./mpesa.types";
export declare const pendingStkPushes: Map<string, PendingStkPush>;
export declare function initiateStkPush(req: StkPushRequest): Promise<StkPushResponse>;
//# sourceMappingURL=stk-push.d.ts.map