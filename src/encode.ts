export default (queue: string, key: string, payload: any, replyKey?: string): Buffer => {
  const json = JSON.stringify({
    queue,
    key,
    payload,

    replyKey,
  });

  return Buffer.from(json);
};
