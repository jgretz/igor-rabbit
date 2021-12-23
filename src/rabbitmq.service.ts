import amqp from 'amqplib/callback_api';
import {v4 as uuidv4} from 'uuid';
import Logger from '@jgretz/igor-log';
import {RabbitMessageHandler} from './Types';
import decode from './decode';
import encode from './encode';

export class RabbitMqService {
  channel: amqp.Channel;

  constructor() {
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

        channel.assertQueue(process.env.RABBIT_QUEUE, {
          durable: true,
        });

        this.channel = channel;
      });
    });
  }

  subscribe<T>(queue: string, key: string, handler: RabbitMessageHandler<T>) {
    this.channel.consume(queue, async (msg) => {
      const message = decode(msg.content);
      if (message.key !== key) {
        return;
      }

      this.channel.ack(msg);

      const response = await handler(message);
      if (message.replyKey) {
        this.send<T>(queue, message.replyKey, response);
      }
    });
  }

  send<T>(queue: string, key: string, payload: any, responseHandler?: RabbitMessageHandler<T>) {
    const replyKey = responseHandler ? `${key}_${uuidv4()}` : undefined;
    const sendMsg = encode(queue, key, payload, replyKey);

    if (responseHandler) {
      this.subscribe<T>(queue, replyKey, responseHandler);
    }

    this.channel.sendToQueue(queue, sendMsg);
  }
}
