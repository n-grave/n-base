This guide explains how to modify the Twitter-based Shade Agent template to work with XMTP (Extensible Message Transport Protocol) instead.

## Overview

Instead of monitoring Twitter mentions and replying via tweets, this XMTP agent will:

- Monitor XMTP conversations for messages
- Process requests to purchase Base names
- Respond via XMTP messages
- Use the same TEE (Trusted Execution Environment) infrastructure

## Key Changes from Twitter to XMTP

### 1. Authentication & Client Setup

**Twitter Version:**

- Uses Twitter API keys or cookie authentication
- Monitors mentions via Twitter API

**XMTP Version:**

- Uses wallet-based authentication (EOA or Smart Contract Wallet)
- Creates XMTP client with wallet signer
- Monitors conversations via XMTP network

### 2. Message Flow

**Twitter:**

```
User tweets: "@basednames buy myname.base.eth"
Bot replies: "Send ETH to [address]..."
Bot monitors deposits and purchases name
Bot tweets: "Done! tx: [link]"
```

**XMTP:**

```
User sends DM: "buy myname.base.eth"
Bot replies: "Send ETH to [address]..."
Bot monitors deposits and purchases name
Bot sends DM: "Done! tx: [link]"
```

## Implementation Steps

### Step 1: Install XMTP Dependencies

```bash
npm install @xmtp/node-sdk @xmtp/content-type-text
```

### Step 2: Create XMTP Signer

Create `xmtp/signer.js`:

```javascript
import { Wallet } from 'ethers';

export function createSigner(privateKey) {
  const wallet = new Wallet(privateKey);
  
  return {
    type: "EOA",
    getIdentity: () => ({
      identifier: wallet.address,
      identifierKind: "Ethereum"
    }),
    signMessage: async (message) => {
      const signature = await wallet.signMessage(message);
      return Buffer.from(signature.slice(2), 'hex');
    }
  };
}
```

### Step 3: XMTP Client Setup

Create `xmtp/client.js`:

```javascript
import { Client } from '@xmtp/node-sdk';
import { createSigner } from './signer.js';
import { getRandomValues } from 'node:crypto';

export async function setupXMTPClient(privateKey) {
  const signer = createSigner(privateKey);
  
  // Database encryption key - store this securely!
  const dbEncryptionKey = getRandomValues(new Uint8Array(32));
  
  const client = await Client.create(signer, {
    env: process.env.XMTP_ENV || 'production',
    dbEncryptionKey,
    dbPath: './xmtp-db'
  });
  
  return client;
}
```

### Step 4: Message Monitoring

Create `xmtp/monitor.js`:

```javascript
export async function monitorConversations(client, handler) {
  // Sync existing conversations
  await client.conversations.syncAll();
  
  // Stream all messages
  const stream = await client.conversations.streamAllMessages();
  
  console.log('Monitoring XMTP messages...');
  
  try {
    for await (const message of stream) {
      // Skip messages from self
      if (message.senderInboxId === client.inboxId) continue;
      
      await handler(message);
    }
  } catch (error) {
    console.error('Stream error:', error);
  }
}
```

### Step 5: Message Handler

Create `xmtp/messageHandler.js`:

```javascript
import { parseBaseName, generateDepositAddress, purchaseName } from '../utils/baseNames.js';

export async function handleMessage(client, message) {
  const content = message.content;
  const conversation = await client.conversations.findConversationById(
    message.conversationId
  );
  
  // Parse command
  if (content.toLowerCase().startsWith('buy ')) {
    const baseName = parseBaseName(content);
    
    if (!baseName) {
      await conversation.send('Invalid format. Use: buy yourname.base.eth');
      return;
    }
    
    // Generate deposit address
    const { address, price } = await generateDepositAddress(baseName);
    
    // Send instructions
    await conversation.send(
      `On it! Send ${price} ETH on Base to ${address}\n` +
      `I'll purchase ${baseName} once payment is confirmed.`
    );
    
    // Monitor deposits (simplified)
    const txHash = await monitorAndPurchase(address, baseName, message.senderInboxId);
    
    // Send confirmation
    await conversation.send(
      `Done! ${baseName} has been registered.\n` +
      `Transaction: https://basescan.org/tx/${txHash}`
    );
  } else if (content.toLowerCase() === 'help') {
    await conversation.send(
      'I can help you register Base names!\n' +
      'Commands:\n' +
      '• buy yourname.base.eth - Register a Base name\n' +
      '• help - Show this message'
    );
  }
}
```

### Step 6: Main Application

Update `worker/index.js`:

```javascript
import { setupXMTPClient } from './xmtp/client.js';
import { monitorConversations } from './xmtp/monitor.js';
import { handleMessage } from './xmtp/messageHandler.js';

async function main() {
  // Setup XMTP client
  const client = await setupXMTPClient(process.env.AGENT_PRIVATE_KEY);
  
  console.log('XMTP Agent started');
  console.log('Inbox ID:', client.inboxId);
  console.log('Address:', client.accountAddress);
  
  // Monitor conversations
  await monitorConversations(client, async (message) => {
    try {
      await handleMessage(client, message);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
}

main().catch(console.error);
```

### Step 7: Environment Variables

Update `.env`:

```bash
# XMTP Configuration
AGENT_PRIVATE_KEY=your_agent_wallet_private_key
XMTP_ENV=production  # or 'dev' for testing
DB_ENCRYPTION_KEY=your_32_byte_hex_key

# Base Configuration (same as before)
BASE_API_KEY=your_basescan_api_key
MPC_PUBLIC_KEY_MAINNET=...
NEXT_PUBLIC_contractId=your_shade_agent_contract_id
```

### Step 8: Docker Configuration

Update `docker-compose.yaml`:

```yaml
version: '3.8'

services:
  xmtp-agent:
    image: your-dockerhub/xmtp-base-agent:latest
    environment:
      - NODE_ENV=production
      - AGENT_PRIVATE_KEY=${AGENT_PRIVATE_KEY}
      - XMTP_ENV=${XMTP_ENV}
      - DB_ENCRYPTION_KEY=${DB_ENCRYPTION_KEY}
      - BASE_API_KEY=${BASE_API_KEY}
    volumes:
      - ./xmtp-db:/app/xmtp-db
    restart: unless-stopped
```

## Advanced Features

### 1. Group Chat Support

```javascript
// Join group chats when invited
const groupStream = await client.conversations.streamGroups();

for await (const group of groupStream) {
  console.log('Joined group:', group.name);
  // Handle group messages
}
```

### 2. Consent Management

```javascript
// Auto-accept conversations from verified addresses
await client.setConsentStates([{
  entityId: inboxId,
  entityType: ConsentEntityType.InboxId,
  state: ConsentState.Allowed
}]);
```

### 3. Attachment Support

```javascript
import { AttachmentCodec } from '@xmtp/content-type-attachment';

// Register codec
client.registerCodec(new AttachmentCodec());

// Send transaction receipts as attachments
await conversation.send({
  filename: 'receipt.json',
  mimeType: 'application/json',
  data: Buffer.from(JSON.stringify(receipt))
}, { contentType: ContentTypeAttachment });
```

### 4. Read Receipts

```javascript
import { ReadReceiptCodec } from '@xmtp/content-type-read-receipt';

client.registerCodec(new ReadReceiptCodec());

// Send read receipt
await conversation.send({}, { contentType: ContentTypeReadReceipt });
```

## Testing

### Local Testing

1. Create test wallets:

```javascript
const testWallet1 = Wallet.createRandom();
const testWallet2 = Wallet.createRandom();
```

2. Run XMTP in development:

```javascript
const client = await Client.create(signer, {
  env: 'dev',
  // ... other options
});
```

3. Test conversation:

```javascript
// From another client
const dm = await client2.conversations.newDm(agentInboxId);
await dm.send('buy test.base.eth');
```

### Integration Testing

Create `test/xmtp.test.js`:

```javascript
import { setupXMTPClient } from '../xmtp/client.js';
import { Wallet } from 'ethers';

describe('XMTP Agent', () => {
  let agentClient, userClient;
  
  beforeAll(async () => {
    // Setup test clients
    const agentWallet = new Wallet(process.env.TEST_AGENT_KEY);
    const userWallet = new Wallet(process.env.TEST_USER_KEY);
    
    agentClient = await setupXMTPClient(agentWallet.privateKey);
    userClient = await setupXMTPClient(userWallet.privateKey);
  });
  
  test('should respond to buy command', async () => {
    const dm = await userClient.conversations.newDm(agentClient.inboxId);
    await dm.send('buy test.base.eth');
    
    // Wait for response
    const messages = await dm.messages();
    expect(messages.some(m => m.content.includes('Send'))).toBe(true);
  });
});
```

## Deployment Considerations

### 1. Database Persistence

XMTP uses a local SQLite database. Ensure it's persisted:

```yaml
volumes:
  - xmtp-data:/app/xmtp-db
```

### 2. Key Management

Store encryption keys securely:

- Use environment variables
- Consider using a key management service
- Never commit keys to version control

### 3. Rate Limiting

Implement rate limiting to prevent abuse:

```javascript
const rateLimiter = new Map();

function checkRateLimit(inboxId) {
  const lastMessage = rateLimiter.get(inboxId);
  const now = Date.now();
  
  if (lastMessage && now - lastMessage < 60000) { // 1 minute
    return false;
  }
  
  rateLimiter.set(inboxId, now);
  return true;
}
```

### 4. Error Handling

Implement robust error handling:

```javascript
client.on('error', (error) => {
  console.error('XMTP client error:', error);
  // Implement recovery strategy
});
```

## Migration from Twitter

### Data Migration

If migrating existing users:

1. Map Twitter handles to wallet addresses
2. Send onboarding messages via XMTP
3. Maintain both systems during transition

### User Communication

```javascript
// Notify users about XMTP migration
async function notifyMigration(twitterHandle, walletAddress) {
  const client = await setupXMTPClient(process.env.AGENT_PRIVATE_KEY);
  const dm = await client.conversations.newDm(walletAddress);
  
  await dm.send(
    `Hey @${twitterHandle}! 🎉\n\n` +
    `We've migrated to XMTP for better privacy and security.\n` +
    `You can now message me directly here for Base name purchases.\n\n` +
    `Type 'help' to get started!`
  );
}
```

## Advantages of XMTP

1. **Privacy**: End-to-end encrypted messages
2. **No API limits**: Unlike Twitter's rate limits
3. **Wallet-native**: Direct integration with crypto operations
4. **Permissionless**: No risk of account suspension
5. **Interoperable**: Works across all XMTP apps

## Resources

- [XMTP Documentation](https://docs.xmtp.org/)
- [XMTP Node SDK](https://github.com/xmtp/xmtp-js/tree/main/sdks/node-sdk)
- [Example Agents](https://github.com/ephemeraHQ/xmtp-agent-examples)
- [Shade Agent Template](https://github.com/NearDeFi/shade-agent-template)