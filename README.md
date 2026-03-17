# 🌾 ShambaChain

**Tokenized Agricultural Commodity Infrastructure on Hedera**

ShambaChain turns physical grain deposits into on-chain Commodity Receipts (oCR NFTs) on Hedera EVM — giving East African smallholder farmers access to DeFi collateral, forward markets, and institutional liquidity for the first time.

> Built for the **Hello Future Apex Hackathon 2026** · AngelHack + Hashgraph · $250,000 prize pool  
> Track: DeFi/Tokenization · Bounty: OpenClaw

---

## 🏗 Architecture Overview

```
Farmer (MPESA)
    │
    ▼
Backend (Node.js/TypeScript)
    ├── MPESA STK Push → Safaricom Daraja API
    ├── HCS Writer → Hedera Consensus Service (audit trail)
    ├── Receipt Minter → ReceiptFactory.sol (ERC-721 NFT)
    ├── LoanAgent (Claude AI) → Telegram loan offer
    ├── PriceAgent → SupraPriceFeed.sol (5 min cron)
    └── RiskAgent → CollateralVault.sol (10 min cron)
    │
    ▼
Hedera EVM (Testnet, Chain ID 296)
    ├── ReceiptFactory.sol    — ERC-721 oCR NFTs
    ├── CollateralVault.sol   — Lock collateral, issue/repay USDC-H loans
    ├── ForwardMarket.sol     — Forward commodity bids
    ├── RiskMarket.sol        — Prediction pools on loan liquidation
    ├── SupraPriceFeed.sol    — KES/kg maize oracle
    ├── RiskOracle.sol        — Valuation updates
    ├── ShambaToken.sol       — ERC-20 agent reward token
    └── MockUSDC-H.sol        — Testnet stablecoin
    │
    ▼
Frontend (React + Vite + ethers.js)
    └── Browser wallet (MetaMask / HashPack) → direct EVM txs
```

---

## 🔄 How the App Works

### The Core Flow

```
1. Farmer deposits grain at warehouse
2. Farmer pays storage fee via MPESA (STK Push)
3. Backend receives MPESA callback
4. Backend writes deposit event to Hedera HCS topic 0.0.8157255
5. Backend mints oCR NFT on Hedera EVM (ERC-721)
6. LoanAgent (Claude AI) generates a loan offer explanation
7. Loan offer sent to farmer via Telegram bot
8. Farmer locks oCR as collateral in vault
9. Farmer borrows USDC-H at up to 80% LTV
10. RiskAgent monitors LTV every 10 minutes
11. Farmer repays loan → oCR unlocked
```

### MPESA → NFT Pipeline

Every MPESA payment triggers a 3-step atomic pipeline:

| Step | Action | Output |
|------|--------|--------|
| 1 | Safaricom Daraja callback fires | Payment confirmed |
| 2 | HCS write to topic `0.0.8157255` | Tamper-proof audit log |
| 3 | `mintReceipt()` on ReceiptFactory | oCR NFT (#tokenId) on-chain |

### Sentinel Agents

| Agent | Frequency | Action |
|-------|-----------|--------|
| PriceAgent | Every 5 min | Fetches maize price, updates oracle, earns SHAMBA |
| RiskAgent | Every 10 min | Scans all loans, checks LTV, triggers alerts |
| LoanAgent | On-demand | Evaluates oCR, generates Claude AI loan explanation |

---

## 📁 Project Structure

```
shambachain/
├── contracts/          # Foundry/Solidity smart contracts
│   ├── src/
│   │   ├── RecipientFactory.sol
│   │   ├── CollateralVault.sol
│   │   ├── ForwardMarket.sol
│   │   ├── oracle/SupraPriceFeed.sol
│   │   ├── sentinel/RiskMarket.sol
│   │   ├── sentinel/RiskOracle.sol
│   │   ├── sentinel/HedgePosition.sol
│   │   └── token/ShambaToken.sol
│   ├── test/
│   │   ├── unit/           # 69/69 tests passing
│   │   └── intergration/
│   └── script/             # Deployment scripts
│
├── backend/            # Node.js TypeScript service
│   └── src/
│       ├── agents/         # PriceAgent, RiskAgent, LoanAgent
│       ├── hcs/            # Hedera Consensus Service writer/reader
│       ├── minter/         # oCR NFT minting logic
│       ├── mpesa/          # Daraja STK Push + webhook handler
│       └── telegram/       # Bot commands
│
└── client/             # React + Vite frontend
    └── src/
        ├── pages/          # Dashboard, Receipts, Vault, Markets, Explorer, Profile
        ├── components/     # Cards, charts, UI primitives
        ├── hooks/          # useReceipts, useLoans, useWallet, useVaultActions
        └── config/         # Contract ABIs and addresses
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- A Hedera testnet account (get one at [portal.hedera.com](https://portal.hedera.com))
- Safaricom Daraja sandbox account (for MPESA)
- Anthropic API key (for LoanAgent Claude AI)
- MetaMask or HashPack wallet

### 1. Clone and Install

```bash
git clone https://github.com/Ted1166/shambachain.git
cd shambachain

# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../client && npm install
```

### 2. Configure Environment

Copy the example env and fill in your values:

```bash
cp backend/.env.example backend/.env
```

```env
# Hedera
HEDERA_ACCOUNT_ID=0.0.XXXXXXX
HEDERA_PRIVATE_KEY=your_private_key
HEDERA_TESTNET_RPC=https://testnet.hashio.io/api
HEDERA_NETWORK=testnet
HEDERA_CHAIN_ID=296

# MPESA (Safaricom Daraja Sandbox)
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE=174379
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
MPESA_CALLBACK_URL=https://your-backend-url/api/mpesa/callback

# AI + Telegram
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=your_bot_token

# Contracts (already deployed on testnet)
RECEIPT_FACTORY_ADDRESS=0x451f2f54A027F9Ec359f1411f341878d645dD337
COLLATERAL_VAULT_ADDRESS=0x9648Abb0943C9409Ea2d501E1a9773aCbE836Bb1
FORWARD_MARKET_ADDRESS=0xa1B21eedbB08cAC7F0F7AA29754bDBD794866139
RISK_MARKET_ADDRESS=0x9B05c7A71a02F39B18e979E4F84b784aFed3c284
SUPRA_PRICE_FEED_ADDRESS=0xA4B1F9154E4fFd5e71392a240F5691f608314bEb
SHAMBA_TOKEN_ADDRESS=0x02A8AdD3ECAE73Adb908048E70A9fe18156B3785
USDC_H_ADDRESS=0x2d101fafb24c660bfef07fd3106caf1074c80bf7

# Admin
ADMIN_ADDRESS=your_evm_address
TREASURY_ADDRESS=your_evm_address
```

### 3. Run the Backend

```bash
cd backend
npm run dev
```

The backend starts on port 3000 with:
- HTTP server (MPESA webhook + STK push endpoint)
- Telegram bot in polling mode
- PriceAgent cron (5 min)
- RiskAgent cron (10 min)

### 4. Run the Frontend

```bash
cd client
echo "VITE_BACKEND_URL=http://localhost:3000" > .env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 📱 Telegram Bot — @guarddog_agent_bot

The bot is the primary farmer interface.

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + command list |
| `/price` | Live maize price in KES/kg |
| `/loan <tokenId>` | Request a loan offer on your oCR |
| `/accept <tokenId>` | Accept a loan offer |
| `/status <tokenId>` | Check loan status and LTV |
| `/help` | Show all commands |

### How `/loan` works

1. Farmer sends `/loan 6`
2. LoanAgent fetches oCR #6 valuation from on-chain oracle
3. Calculates max loan at 60% LTV in USDC-H
4. Calls Claude AI to generate a farmer-friendly explanation in simple English
5. Sends the offer to the farmer on Telegram
6. Farmer replies `/accept 6` to execute the loan on-chain

---

## 🌐 Frontend Pages

### Dashboard
Live protocol stats: maize price, oCR count, total collateral, USDC-H borrowed. Active loan health with LTV gauge. Deployed contract addresses.

### Receipts
All 11 on-chain oCR NFTs with status filter (Active / Locked / Redeemed). Click any receipt for full details — weight, grade, warehouse, MPESA reference, custodian address.

### Vault (requires wallet)
Lock an oCR as collateral and borrow USDC-H. Full multi-step transaction flow: Approve NFT → Lock Collateral → Issue Loan. Real-time LTV gauge with warning (70%) and liquidation (80%) thresholds. Repay loan to unlock oCR.

### Markets
**Forward Market** — Institutional buyers post forward bids for specific oCRs (commodity, weight, grade, price in USDC-H, settlement date).  
**Risk Market** — Prediction pools on whether a specific loan will be liquidated. Take YES/NO positions with USDC-H. Winners share the losing pool.

### Explorer
Live Hedera Consensus Service message feed from topic `0.0.8157255`. Every deposit, mint, and risk event decoded from Base64 JSON.

### Profile (requires wallet)
Wallet summary, USDC-H and SHAMBA token balances, all oCRs owned by connected wallet, USDC-H faucet (100 USDC-H for testing), network info.

---

## 🔗 Deployed Contracts — Hedera Testnet

| Contract | Address |
|----------|---------|
| ReceiptFactory | `0x451f2f54A027F9Ec359f1411f341878d645dD337` |
| CollateralVault | `0x9648Abb0943C9409Ea2d501E1a9773aCbE836Bb1` |
| ForwardMarket | `0xa1B21eedbB08cAC7F0F7AA29754bDBD794866139` |
| RiskMarket | `0x9B05c7A71a02F39B18e979E4F84b784aFed3c284` |
| RiskOracle | `0xf033A7Ff995a2A87C2ba4748bfF7626D6482Da64` |
| HedgePosition | `0x87bd5D00E3c7AB3643Ed6662f12090369a6c8E76` |
| SupraPriceFeed | `0xA4B1F9154E4fFd5e71392a240F5691f608314bEb` |
| ShambaToken | `0x02A8AdD3ECAE73Adb908048E70A9fe18156B3785` |
| MockUSDC-H | `0x2d101fafb24c660bfef07fd3106caf1074c80bf7` |

**HCS Topic:** `0.0.8157255`  
**Explorer:** [HashScan Testnet](https://hashscan.io/testnet)

---

## 🧪 Smart Contract Tests

```bash
cd contracts
forge test -vv
```

All 69 tests passing across 6 test suites:

| Suite | Tests |
|-------|-------|
| ReceiptFactory | 13/13 |
| CollateralVault | 14/14 |
| ForwardMarket | 12/12 |
| RiskMarket | 15/15 |
| SupraPriceFeed | 11/11 |
| FullFlow (integration) | 4/4 |

---

## 🔧 Backend API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| POST | `/api/mpesa/stk-push` | Initiate MPESA STK Push |
| POST | `/api/mpesa/callback` | MPESA payment callback (Safaricom) |
| GET | `/api/mirror/receipt-tokens` | Mirror node proxy — all minted oCR token IDs |

### Trigger a test MPESA payment

```bash
# Initiate STK Push
curl -X POST http://localhost:3000/api/mpesa/stk-push \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"254708374149","amount":20,"accountRef":"WH-NKR-001","description":"Grain deposit"}'

# Simulate callback (sandbox)
CHECKOUT_ID="your_checkout_request_id"
curl -X POST http://localhost:3000/api/mpesa/callback \
  -H "Content-Type: application/json" \
  -d "{\"Body\":{\"stkCallback\":{\"MerchantRequestID\":\"test\",\"CheckoutRequestID\":\"$CHECKOUT_ID\",\"ResultCode\":0,\"ResultDesc\":\"Success\",\"CallbackMetadata\":{\"Item\":[{\"Name\":\"Amount\",\"Value\":20},{\"Name\":\"MpesaReceiptNumber\",\"Value\":\"SHB000TEST01\"},{\"Name\":\"TransactionDate\",\"Value\":\"20260318120000\"},{\"Name\":\"PhoneNumber\",\"Value\":\"254708374149\"}]}}}}"
```

---

## 💰 Token Economics

### USDC-H (MockUSDC-H)
The lending currency. Farmers borrow USDC-H against oCR collateral. Testnet faucet available in the Profile page (100 USDC-H per claim).

### SHAMBA Token
ERC-20 reward token earned by sentinel agents for protocol actions:

| Action | Reward |
|--------|--------|
| Price update | 0.1 SHAMBA |
| Loan issuance | varies |
| Risk check | varies |
| Liquidation | varies |

Holding 100+ SHAMBA qualifies for protocol fee discounts.

---

## 🏦 Vault — Loan Mechanics

- **Max LTV:** 80% (liquidation threshold)
- **Warning LTV:** 70% (alert sent via Telegram)
- **Default LTV at origination:** 60%
- **Collateral:** oCR NFT locked in vault (custodian retains ownership)
- **Loan currency:** USDC-H (6 decimals)
- **Repayment:** Full principal + accrued interest

### Valuation formula
```
Loan value (USDC-H) = (weightKg × KES/kg oracle price) ÷ KES/USD rate × LTV%
```

### Lock collateral flow (frontend)
1. Wallet approves vault to transfer oCR NFT
2. `lockCollateral(tokenId)` — NFT approved, loan ID created
3. `issueLoan(loanId, ltvBps)` — USDC-H transferred to farmer wallet

### Repay flow (frontend)
1. Wallet approves vault to pull USDC-H (principal + interest)
2. `repayLoan(loanId)` — USDC-H returned, oCR unlocked

---

## 🌍 Why Hedera?

- **Fast finality** — 3-5 second transaction confirmation
- **Low fees** — ~$0.001 per transaction vs Ethereum's $5-50
- **EVM compatible** — standard Solidity contracts, MetaMask/ethers.js
- **HCS** — Hedera Consensus Service provides a tamper-proof, ordered audit trail without smart contract overhead
- **Energy efficient** — carbon-negative blockchain

---

## 🔐 Security Notes

- Private keys in `.env` are for testnet only — never use on mainnet
- MPESA sandbox credentials are public test values
- Telegram bot token should be rotated after hackathon
- For production: multi-sig admin, audited contracts, real oracle integration

---

## 📦 Deployment

### Backend — Railway

```bash
cd backend
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all env vars in Railway dashboard → Variables.

### Frontend — Vercel

Connect GitHub repo to Vercel. Set in dashboard:
- **Root Directory:** `client`
- **Framework:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

Add environment variable:
```
VITE_BACKEND_URL=https://your-railway-backend.up.railway.app
```

---

## 🤝 Team

Built with ❤️ from Nairobi, Kenya  
EVM: `0x2ec236a1e06715712749BCA3c7D242c3b9caE6D7`  
Hedera: `0.0.8060605`

---

## 📄 License

MIT