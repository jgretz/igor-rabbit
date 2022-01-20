import amqp from 'amqplib/callback_api';
import {v4 as uuidv4} from 'uuid';
import Logger from '@jgretz/igor-log';
import {RabbitMessage, RabbitMessageHandler} from './Types';
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
  responseHandler?: RabbitMessageHandler<T>;
}

// private methods
const recordSubscription = (
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

const removeSubscription = (
  map: SubscriptionQueueMap,
  queue: string,
  key: string,
  handler: RabbitMessageHandler<unknown>,
) => {
  const subscriptionQueue = map[queue];
  if (!subscriptionQueue) {
    return;
  }

  // remove single instance
  subscriptionQueue.handlers = subscriptionQueue.handlers.filter(
    (x) => x.key === key && x.handler !== handler,
  );
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
        this.messageQueue.forEach(({queue, key, payload, responseHandler}) => {
          this.send(queue, key, payload, responseHandler);
        });

        Object.keys(this.subscriptionQueues).forEach((queue) => {
          this.subscriptionQueues[queue].handlers.forEach(({key, handler}) => {
            this.subscribe(queue, key, handler);
          });
        });
      });
    });
  }

  subscribe<T>(queue: string, key: string, handler: RabbitMessageHandler<T>) {
    const subscriptionQueue = recordSubscription(this.subscriptionQueues, queue, key, handler);
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

  send<T>(queue: string, key: string, payload: any, responseHandler?: RabbitMessageHandler<T>) {
    if (!this.channel) {
      this.messageQueue.push({queue, key, payload, responseHandler});
      return;
    }

    this.channel.assertQueue(queue, {
      durable: true,
    });

    const replyKey = responseHandler ? `${key}_${uuidv4()}` : undefined;
    const replyHandler = responseHandler
      ? async (message: RabbitMessage) => {
          const response = await responseHandler(message);

          removeSubscription(this.subscriptionQueues, queue, replyKey, replyHandler);

          return response;
        }
      : null;
    const sendMsg = encode(queue, key, payload, replyKey);

    if (responseHandler) {
      this.subscribe<T>(queue, replyKey, replyHandler);
    }

    this.channel.sendToQueue(queue, sendMsg);
  }
}
