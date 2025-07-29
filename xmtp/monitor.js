import PQueue from 'p-queue';

export async function monitorConversations(client, handler) {
  // Create a queue to process messages sequentially
  const queue = new PQueue({ concurrency: 1 });
  
  // Sync all conversations first
  console.log('Syncing conversations...');
  await client.conversations.syncAll();
  
  // Get existing conversations
  const conversations = await client.conversations.list();
  console.log(`Found ${conversations.length} existing conversations`);
  
  // Stream all messages
  const stream = await client.conversations.streamAllMessages();
  
  console.log('Monitoring XMTP messages...');
  
  try {
    for await (const message of stream) {
      // Skip messages from self
      if (message.senderInboxId === client.inboxId) continue;
      
      // Add to processing queue
      queue.add(async () => {
        try {
          await handler(message);
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });
    }
  } catch (error) {
    console.error('Stream error:', error);
    // Attempt to reconnect after error
    setTimeout(() => monitorConversations(client, handler), 5000);
  }
}

// Stream new conversations
export async function streamNewConversations(client, handler) {
  const stream = await client.conversations.stream();
  
  console.log('Listening for new conversations...');
  
  try {
    for await (const conversation of stream) {
      console.log('New conversation started:', conversation.id);
      await handler(conversation);
    }
  } catch (error) {
    console.error('Conversation stream error:', error);
  }
}