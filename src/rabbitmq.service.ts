import amqp from 'amqplib/callback_api';
import {v4 as uuidv4} from 'uuid';
import Logger from '@jgretz/igor-log';
import {
  RabbitMessage,
  RabbitMessageHandler,
  RabbitResponseOptions,
  RabbitResultType,
} from './Types';
import decode from './decode';
import encode from './encode';

// module types
type SubscriptionQueueMap = {[key: string]: SubscriptionQueue<unknown>};

interface SubscriptionQueue<T> {
  queue: string;
  subscribed: boolean;
  handlers: Array<Subscription<T>>;
}

interface Subscription<T> {
  key: string;
  handler: RabbitMessageHandler<T>;
}
interface Message<T> {
  queue: string;
  key: string;
  payload: any;
  response: RabbitResponseOptions<T>;
}

// private methods
const pushSubscription = (
  map: SubscriptionQueueMap,
  queue: string,
  key: string,
  handler: RabbitMessageHandler<unknown>,
): SubscriptionQueue<unknown> => {
  let subscriptionQueue = map[queue];
  if (!subscriptionQueue) {
    subscriptionQueue = map[queue] = {
      queue,
      subscribed: false,
      handlers: [],
    };
  }

  subscriptionQueue.handlers.push({key, handler});

  return subscriptionQueue;
};

const prepareForReply = <T>(
  service: RabbitMqService,
  queue: string,
  rootKey: string,
  response: RabbitResponseOptions<T>,
): string => {
  let handled = false;
  const key = `${rootKey}_${uuidv4()}`;

  const handler = (message: RabbitMessage): T => {
    handled = true;

    response.handler({
      type: message.payload instanceof Error ? RabbitResultType.Error : RabbitResultType.Success,
      result: message.payload,
    });
    removeReplySubscription(service.subscriptionQueues, queue, key);

    // we dont need this but typescript does
    return null;
  };

  // subscribe
  service.subscribe(queue, key, handler);

  // handle timeout
  if (response.timeout) {
    setTimeout(() => {
      if (handled) {
        return;
      }

      response.handler({type: RabbitResultType.Timeout});
      removeReplySubscription(service.subscriptionQueues, queue, key);
    }, response.timeout);
  }

  return key;
};

const removeReplySubscription = (map: SubscriptionQueueMap, queue: string, key: string) => {
  const subscriptionQueue = map[queue];
  if (!subscriptionQueue) {
    return;
  }

  // remove single instance
  subscriptionQueue.handlers = subscriptionQueue.handlers.filter((x) => x.key !== key);
};

// public interface
export class RabbitMqService {
  channel: amqp.Channel;
  subscriptionQueues: SubscriptionQueueMap;
  messageQueue: Array<Message<unknown>>;

  constructor() {
    this.subscriptionQueues = {};
    this.messageQueue = [];

    amqp.connect(process.env.RABBIT_URL, (error, connection) => {
      if (error) {
        Logger.error(`${process.env.RABBIT_URL}: AMQP Connect Error`, error);
        return;
      }

      connection.createChannel((err, channel) => {
        if (err) {
          Logger.error(`${process.env.RABBIT_URL}: AMQP Channel Error`, err);
          return;
        }

        this.channel = channel;

        // clear queues
        Object.keys(this.subscriptionQueues).forEach((queue) => {
          this.subscriptionQueues[queue].handlers.forEach(({key, handler}) => {
            this.subscribe(queue, key, handler);
          });
        });

        this.messageQueue.forEach(({queue, key, payload, response}) => {
          this.send(queue, key, payload, response);
        });
      });
    });
  }

  subscribe<T>(queue: string, key: string, handler: RabbitMessageHandler<T>) {
    const subscriptionQueue = pushSubscription(this.subscriptionQueues, queue, key, handler);
    if (!this.channel || subscriptionQueue.subscribed) {
      return;
    }

    this.channel.assertQueue(queue, {
      durable: true,
    });

    this.channel.consume(queue, async (msg) => {
      const message = decode(msg.content);
      const handlers = this.subscriptionQueues[queue].handlers
        .filter(({key}) => message.key === key)
        .map(({handler}) => handler);

      if (handlers.length === 0) {
        return;
      }

      this.channel.ack(msg);

      handlers.forEach(async (handler) => {
        const response = await handler(message);
        if (message.replyKey) {
          this.send<T>(queue, message.replyKey, response);
        }
      });
    });

    subscriptionQueue.subscribed = true;
  }

  send<T>(queue: string, key: string, payload: any, response?: RabbitResponseOptions<T>) {
    if (!this.channel) {
      this.messageQueue.push({queue, key, payload, response});
      return;
    }

    this.channel.assertQueue(queue, {
      durable: true,
    });

    let replyKey = undefined;
    if (response) {
      replyKey = prepareForReply(this, queue, key, response);
    }

    const sendMsg = encode(queue, key, payload, replyKey);

    this.channel.sendToQueue(queue, sendMsg);
  }
}
