import {RabbitMessage} from './Types';

export default (content: Buffer): RabbitMessage => {
  return JSON.parse(content.toString()) as RabbitMessage;
};
