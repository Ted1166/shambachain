export interface DepositEventPayload {
  mpesaRef:    string;
  phoneNumber: string;
  amount:      number;
  warehouseId: string;
  timestamp:   string;
}

export interface HcsWriteResult {
  topicId:        string;
  sequenceNumber: number;
  transactionId:  string;
  consensusTimestamp: string;
}

export interface HcsMessage {
  sequenceNumber:     number;
  consensusTimestamp: string;
  contents:           string;
  runningHash:        string;
}

export interface ShambaHcsEvent {
  type:        "DEPOSIT" | "VALUATION_UPDATE" | "LOAN_ISSUED" | "LIQUIDATION";
  version:     "1.0";
  mpesaRef?:   string;
  tokenId?:    string;
  warehouseId?: string;
  phoneNumber?: string;
  amount?:     number;
  timestamp:   string;
  network:     "testnet" | "mainnet";
}