export enum RabbitResultType {
  Success,
  Error,
  Timeout,
}
export interface RabbitResponse<T> {
  type: RabbitResultType;
  result?: T;
}

export interface RabbitResponseOptions<T> {
  timeout?: number;
  handler: (response: RabbitResponse<T>) => void;
}

export type RabbitMessage = {
  queue: string;
  key: string;
  payload: any;

  replyKey?: string;
};

export type RabbitMessageHandler<T> = (messsage: RabbitMessage) => T | Promise<T>;
