# Basednames Bot - Developer Onboarding Guide

Welcome to the Basednames Bot project! This guide will help you understand, set up, and deploy this Shade Agent that helps users purchase Base Names through Twitter.

## Table of Contents
1. [Project Overview](#project-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Local Development](#local-development)
5. [Testing](#testing)
6. [Deployment to Phala Cloud](#deployment-to-phala-cloud)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)

## Project Overview

The Basednames Bot is a non-custodial worker agent that:
- Monitors Twitter for users wanting to buy .base.eth names
- Generates unique deposit addresses using NEAR Chain Signatures
- Registers Base Names on behalf of users
- Refunds any excess ETH automatically

### Architecture
```
Twitter → Bot (TEE) → NEAR Contract → Chain Signatures → Base Chain
```

## Prerequisites

### Required Accounts
1. **Twitter Developer Account** (Paid plan required)
   - Create at [developer.twitter.com](https://developer.twitter.com)
   - Subscribe to Basic plan ($100/month) or higher
   
2. **NEAR Account** (for contract deployment)
   - Create at [wallet.near.org](https://wallet.near.org)
   - Fund with ~10 NEAR for contract deployment

3. **Docker Hub Account**
   - Create at [hub.docker.com](https://hub.docker.com)
   - Needed to push your Docker images

4. **Phala Cloud Account**
   - Create at [phala.network](https://phala.network)
   - For TEE deployment

5. **Base API Key**
   - Get from [basescan.org](https://basescan.org)

### Development Tools
```bash
# Install Node.js (v18+ recommended)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Yarn
npm install -g yarn

# Install Rust (for contract development)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install cargo-near
cargo install cargo-near

# Install Docker
# Follow instructions at https://docs.docker.com/get-docker/
```

## Environment Setup

### 1. Clone and Install Dependencies
```bash
git clone <repository-url>
cd basenames
yarn install
```

### 2. Create Environment Files

Create `.env.development.local` for local development:
```bash
# Base Chain Configuration
BASE_API_KEY=your_basescan_api_key

# Twitter API (Paid Account)
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_CLIENT_KEY=your_client_id
TWITTER_CLIENT_SECRET=your_client_secret
TWITTER_ACCESS_TOKEN=will_be_generated
TWITTER_REFRESH_TOKEN=will_be_generated
TWITTER_LAST_TIMESTAMP=0

# NEAR Configuration
NEXT_PUBLIC_contractId=your_contract.testnet
NEXT_PUBLIC_accountId=your_account.testnet
NEXT_PUBLIC_secretKey=your_account_secret_key

# Chain Signatures MPC Keys
MPC_PUBLIC_KEY_TESTNET=secp256k1:54hU5wcCmVUPFWLDALXMh1fFToZsVXrx9BbTbHzSfQq1Kd1rJKjk3KGauYgNMsugQFdTCGvPGTEFCCgkHxvfJUSJ
MPC_PUBLIC_KEY_MAINNET=secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFAN5G87P1gQBsEJAXRy1CST9qsjhBLsrGc4

# Security
RESTART_PASS=your_secure_password
```

### 3. Set Up Twitter Authentication

The bot requires OAuth2 tokens. Use the provided auth utility:

```bash
# 1. Set up ngrok for HTTPS callback
ngrok http 3000

# 2. Add the HTTPS URL to your Twitter app's callback URLs
# Example: https://abc123.ngrok.io/callback

# 3. Update auth.js with your callback URL
# Edit /utils/auth.js line with your ngrok URL

# 4. Run the auth server
node utils/auth.js

# 5. Visit http://localhost:3000 and authorize
# 6. Copy the tokens from console to your .env file
```

## Local Development

### 1. Start Development Server
```bash
yarn dev
```
Visit http://localhost:3000 to see the UI.

### 2. Understanding the Code Structure

**Core Files:**
- `/pages/api/search.js`: Main bot logic
  - Searches Twitter for mentions
  - Manages reply, deposit, and refund queues
  - Rate limit handling
  
- `/utils/evm.ts`: Base chain integration
  - Checks basename availability
  - Registers names using Chain Signatures
  - Handles refunds

- `/utils/twitter-client.js`: Twitter helpers
  - Gets conversation context
  - Finds latest tweets in threads

### 3. Testing Locally

For local testing, the search endpoint has flags:
```javascript
// In /pages/api/search.js
const FAKE_REPLY = false;  // Set to true to skip actual Twitter replies
const SEARCH_ONLY = true;  // Set to true to only search, not process
```

Test the search endpoint:
```bash
curl http://localhost:3000/api/search
```

### 4. Contract Development

The NEAR contract verifies the TEE environment:

```bash
# Build contract
cd contract
cargo near build non-reproducible-wasm

# Deploy (from root directory)
cd ..
yarn deploy:contract

# Test contract
yarn test:contract
```

## Testing

### Manual Testing Checklist
- [ ] Twitter search finds test tweets
- [ ] Deposit address generation works
- [ ] Mock basename registration succeeds
- [ ] Refund logic triggers correctly
- [ ] Rate limit handling works

### Running Tests
```bash
# Add "type": "module" to package.json first
yarn test:contract
# Remove "type": "module" after testing
```

## Deployment to Phala Cloud

### 1. Build Docker Image
```bash
# Update package.json with your Docker Hub username
yarn docker:build
yarn docker:push
```

### 2. Update docker-compose.yaml
```yaml
version: '3'
services:
  basednames:
    image: yourusername/shade-agent-basenames:latest@sha256:YOUR_HASH
    # ... rest of config
```

### 3. Deploy to Phala
1. Go to [Phala Console](https://console.phala.network)
2. Click "Deploy" → "From Docker Compose"
3. Select "Advanced" tab
4. Paste your docker-compose.yaml
5. Configure:
   - Instance name: basednames-bot
   - Cluster: prod5
   - Stack: dstack-dev-0.3.5
   - Size: tdx.small
6. Deploy!

### 4. Verify Deployment
1. Click on your instance name
2. Check "Network" tab for URL
3. Check "Containers" tab for logs
4. Visit `https://your-instance.phala.app/api/derive` to verify

### 5. Register Worker with NEAR Contract
```bash
# Visit your deployed instance
https://your-instance.phala.app

# Click "Register Worker" button
# Fund the generated NEAR account
# Complete registration
```

## Monitoring & Maintenance

### Monitoring Bot Activity
```bash
# Check pending tweets
curl https://your-instance.phala.app/api/search

# Force process queues (with password)
curl "https://your-instance.phala.app/api/search?restart=replies&pass=YOUR_PASS"
curl "https://your-instance.phala.app/api/search?restart=deposits&pass=YOUR_PASS"
curl "https://your-instance.phala.app/api/search?restart=refunds&pass=YOUR_PASS"

# Check refund status
curl https://your-instance.phala.app/api/refund
```

### Rate Limit Management
The bot tracks Twitter API rate limits:
- Search: 180 requests per 15 minutes
- Tweets: 300 per 3 hours
- Automatically pauses when limits are reached

### Common Maintenance Tasks
1. **Refresh Twitter Tokens**: Tokens auto-refresh, but check logs for failures
2. **Monitor Deposit Queue**: Ensure deposits are processing within 60 minutes
3. **Check Refunds**: Review refunded array for any manual interventions needed
4. **Update Base Prices**: Modify price logic in search.js if Base Name prices change

## Troubleshooting

### Common Issues

**1. Twitter Authentication Fails**
- Ensure you're using a paid Twitter API account
- Check if tokens need manual refresh
- Verify callback URL matches your app settings

**2. Deposits Not Processing**
- Check Base chain RPC connectivity
- Verify MPC public keys are correct
- Check deposit address balance on Basescan

**3. Registration Fails**
- Ensure basename is valid (3+ characters, alphanumeric)
- Check if name is actually available
- Verify gas prices aren't too high

**4. TEE Verification Fails**
- Ensure Docker image hash matches deployment
- Check Phala cluster is running latest dstack
- Verify NEAR contract is deployed correctly

### Debug Commands
```bash
# Check Twitter client initialization
curl http://localhost:3000/api/search

# Test deposit address generation
curl http://localhost:3000/api/derive

# Check worker registration status
curl http://localhost:3000/api/isVerified
```

### Getting Help
- Shade Agents Dev Group: https://t.me/shadeagents
- Phala Discord: https://discord.gg/phala
- Create issues: https://github.com/your-repo/issues

## Next Steps

1. **Customize Bot Behavior**: Modify search.js to change pricing, timing, or responses
2. **Add Features**: Implement bulk purchases, reservation system, or custom resolver data
3. **Scale Up**: Deploy multiple instances for redundancy
4. **Monitor Analytics**: Add logging service to track success rates

Remember: This bot handles real money. Always test thoroughly before going live!