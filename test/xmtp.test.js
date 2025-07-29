import { setupXMTPClient } from '../xmtp/client.js';
import { Wallet } from 'ethers';

describe('XMTP Shade Agent', () => {
  let agentClient, userClient;
  let agentWallet, userWallet;
  
  beforeAll(async () => {
    // Create test wallets
    agentWallet = Wallet.createRandom();
    userWallet = Wallet.createRandom();
    
    // Setup clients
    agentClient = await setupXMTPClient(agentWallet.privateKey, {
      env: 'dev',
      dbPath: './test-db-agent'
    });
    
    userClient = await setupXMTPClient(userWallet.privateKey, {
      env: 'dev',
      dbPath: './test-db-user'
    });
  });
  
  afterAll(async () => {
    // Cleanup
    await agentClient.close();
    await userClient.close();
  });
  
  test('should create XMTP clients', () => {
    expect(agentClient.inboxId).toBeDefined();
    expect(userClient.inboxId).toBeDefined();
  });
  
  test('should send and receive messages', async () => {
    // Create DM conversation
    const dm = await userClient.conversations.newDm(agentClient.inboxId);
    
    // Send message
    await dm.send('Hello agent!');
    
    // Agent should receive it
    await agentClient.conversations.syncAll();
    const agentConvos = await agentClient.conversations.list();
    expect(agentConvos.length).toBe(1);
    
    const messages = await agentConvos[0].messages();
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Hello agent!');
  });
  
  test('should handle buy command', async () => {
    const dm = await userClient.conversations.newDm(agentClient.inboxId);
    await dm.send('buy test.base.eth');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    await dm.sync();
    
    const messages = await dm.messages();
    const response = messages.find(m => m.senderInboxId === agentClient.inboxId);
    
    expect(response).toBeDefined();
    expect(response.content).toContain('Send');
    expect(response.content).toContain('ETH');
  });
});