const requests = new Map();

export async function trackRequest(data) {
  const key = `${data.inboxId}-${data.baseName}`;
  requests.set(key, { ...requests.get(key), ...data });
}

export async function getRequestsByInboxId(inboxId) {
  const userRequests = [];
  for (const [key, value] of requests) {
    if (key.startsWith(inboxId)) {
      userRequests.push(value);
    }
  }
  return userRequests.sort((a, b) => b.createdAt - a.createdAt);
}