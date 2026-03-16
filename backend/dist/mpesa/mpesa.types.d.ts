export interface StkPushRequest {
    phoneNumber: string;
    amount: number;
    accountRef: string;
    description: string;
}
export interface StkPushResponse {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
}
export interface StkCallbackMetadataItem {
    Name: string;
    Value?: string | number;
}
export interface StkCallbackBody {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResultCode: number;
    ResultDesc: string;
    CallbackMetadata?: {
        Item: StkCallbackMetadataItem[];
    };
}
export interface StkCallback {
    Body: {
        stkCallback: StkCallbackBody;
    };
}
export interface MpesaPaymentConfirmed {
    merchantRequestId: string;
    checkoutRequestId: string;
    mpesaReceiptNumber: string;
    amount: number;
    phoneNumber: string;
    transactionDate: string;
}
export interface PendingStkPush {
    checkoutRequestId: string;
    merchantRequestId: string;
    phoneNumber: string;
    amount: number;
    accountRef: string;
    initiatedAt: Date;
    status: "pending" | "confirmed" | "failed";
}
//# sourceMappingURL=mpesa.types.d.ts.map