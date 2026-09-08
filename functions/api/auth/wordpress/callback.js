import { handle } from './connection.js';
export const onRequest = context => handle(context, 'callback');
