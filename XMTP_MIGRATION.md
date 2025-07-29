# XMTP Migration Complete - Updated for v3 Identity Registration

## Summary

I've successfully migrated the Basenames Bot from Twitter to XMTP. The bot now uses XMTP messaging protocol for all interactions instead of Twitter mentions and replies.

## Changes Made

### 1. Updated Dependencies (`package.json`)
- Removed Twitter dependencies (`agent-twitter-client`, `twitter-api-v2`)
- Added XMTP dependencies (`@xmtp/node-sdk`, content types, `p-queue`)
- Changed to ES modules (`"type": "module"`)
- Updated scripts for worker-based architecture

### 2. Created XMTP Core Files
- **`/xmtp/signer.js`** - Wallet-based authentication for XMTP
- **`/xmtp/client.js`** - XMTP client setup with persistent database
- **`/xmtp/monitor.js`** - Message streaming and conversation monitoring

### 3. Message Handler (`/xmtp/messageHandler.js`)
- Handles commands: `buy`, `check`, `status`, `help`
- Rate limiting per user (1 minute window)
- Deposit monitoring and automatic Base name purchase
- Transaction confirmation messages

### 4. Worker Architecture (`/worker/index.js`)
- Standalone Node.js worker (no Next.js)
- Graceful shutdown handling
- Welcome messages for new conversations

### 5. Utilities
- **`/utils/baseNames.js`** - Integrated with existing `evm.js` for Base name operations
- **`/utils/requestTracker.js`** - In-memory request tracking

### 6. Docker Configuration
- Simplified Dockerfile for Node.js worker
- Updated docker-compose.yaml with XMTP volumes
- Removed Twitter environment variables

### 7. Environment Template (`.env.example`)
- XMTP configuration variables
- Retained NEAR and Base chain configurations

### 8. Tests (`/test/xmtp.test.js`)
- Basic XMTP client tests
- Message sending/receiving tests
- Buy command integration test

## Key Architecture Changes

### Before (Twitter):
- Next.js web application
- API routes for Twitter monitoring
- Polling-based message checking
- Public Twitter interactions

### After (XMTP):
- Standalone Node.js worker
- Direct message streaming
- Private, encrypted conversations
- Wallet-based authentication

## Features Preserved

✅ Non-custodial deposit address generation  
✅ Base name availability checking  
✅ Price calculation (3 chars: 0.11 ETH, 4 chars: 0.011 ETH, 5+: 0.0011 ETH)  
✅ Deposit monitoring with 30-minute timeout  
✅ Automatic purchase using NEAR chain signatures  
✅ TEE compatibility  

## New Benefits

🔒 **Privacy** - All conversations are encrypted  
📱 **Direct Messaging** - No public tweets required  
⚡ **Real-time** - Instant message delivery  
🚫 **No Rate Limits** - Unlike Twitter API restrictions  
🔗 **Wallet Native** - Users already have XMTP via their wallets  

## XMTP v3 Identity Registration

### Understanding Inbox IDs

XMTP v3 introduces a new identity model where the primary identifier is an **Inbox ID** rather than an Ethereum address. This provides:

- Support for multiple wallet types (EOA, Smart Contract Wallets, future Passkeys)
- Multiple device installations (up to 10 active)
- Wallet linking capabilities (up to 256 wallets per identity)

### Registration Process

When the agent starts for the first time:

1. **Client Creation**: `Client.create()` checks for existing inbox ID
2. **Identity Registration**: If no inbox exists, requests wallet signature to register
3. **Inbox Creation**: Creates unique inbox ID linked to the wallet
4. **Installation Setup**: Generates installation-specific keys stored in local DB

### Identity Information

The bot now displays comprehensive identity information on startup:

```
=== XMTP Client Info ===
Inbox ID: [unique-inbox-id]
Address: 0x...
Installation ID: [installation-id]
Active Installations: 1/10
Linked Wallets: 1
========================
```

### Important Limits

- **Max 10 active installations** per inbox
- **Max 256 linked wallets** per identity
- Installation keys are rotated periodically for security
- Each installation has its own secure local database

### New Files Added

- **`/xmtp/identity.js`** - Identity management utilities
  - `checkRegistrationStatus()` - Verifies registration
  - `displayIdentityInfo()` - Shows identity details
  - Future support for installation revocation

## Next Steps

1. **Install Dependencies**: Run `npm install` to get XMTP packages
2. **Configure Environment**: Copy `.env.example` and add your keys
3. **First Run**: The agent will automatically register on first run
4. **Test Locally**: Run `npm run dev` with a test wallet
5. **Build Docker Image**: `npm run docker:build`
6. **Deploy to Phala**: Update image hash in docker-compose.yaml

### Monitoring Your Agent

Check registration status:
- Inbox ID should be displayed on startup
- Installation count shows active devices
- Warning appears if approaching 10 installation limit

### Troubleshooting Registration

If registration fails:
1. Check wallet private key is valid
2. Ensure network connectivity
3. Try deleting `xmtp-db` folder for fresh registration
4. Check `.xmtp-encryption-key` file permissions

## Usage Example

```
User: buy coolname.base.eth
Bot: 🎯 Ready to register coolname.base.eth!
     📍 Send exactly 0.0011 ETH on Base to:
     0x123...abc
     ⏱️ This address expires in 30 minutes.
     
User: [sends payment]
Bot: ✅ Payment received! Purchasing coolname.base.eth...
Bot: 🎉 Success! coolname.base.eth has been registered!
     Transaction: https://basescan.org/tx/0x...
```

The migration is complete and ready for testing!