import {IgorResult} from '@jgretz/igor-shared';

export interface RabbitResponseOptions<T> {
  timeout?: number;
  handler: (response: IgorResult<T>) => void;
}

export type RabbitMessage = {
  queue: string;
  key: string;
  payload: any;

  replyKey?: string;
};

export type RabbitMessageHandler<T> = (messsage: RabbitMessage) => T | Promise<T>;
