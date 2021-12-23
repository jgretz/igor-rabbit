export type RabbitMessage = {
  queue: string;
  key: string;
  payload: any;

  replyKey?: string;
};

export type RabbitMessageHandler<T> = (messsage: RabbitMessage) => T | Promise<T>;
