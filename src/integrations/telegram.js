'use strict';

function createTelegram(external, token) {
  function send(chatId, text) {
    return external(`https://api.telegram.org/bot${token}/sendMessage`, {chat_id:chatId, text});
  }
  function setWebhook(url, secret) {
    return external(`https://api.telegram.org/bot${token}/setWebhook`, {url, secret_token:secret, allowed_updates:['message'], drop_pending_updates:false});
  }
  return {send, setWebhook};
}
module.exports = {createTelegram};
