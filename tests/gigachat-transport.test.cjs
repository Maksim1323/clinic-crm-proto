'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {X509Certificate} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {createGigachatFetch} = require('../src/integrations/gigachat-transport');

test('Публичный корневой сертификат Госуслуг: отпечаток и срок',()=>{
  const certificate = new X509Certificate(fs.readFileSync(path.join(__dirname,'../certs/russian-trusted-root-ca.pem')));
  assert.equal(certificate.fingerprint256,'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31');
  assert.equal(certificate.ca,true);assert.ok(Date.parse(certificate.validTo)>Date.now());
});

test('Специальный TLS-диспетчер применяется только к двум GigaChat URL, без редиректов',async()=>{
  const calls=[];const fake=async(url,opts)=>{calls.push({url,opts});return {ok:true,status:200};};
  const send=createGigachatFetch(fake);
  await send('https://ngw.devices.sberbank.ru:9443/api/v2/oauth',{method:'POST',headers:{Authorization:'Basic fake'}});
  await send('https://api.giga.chat/v1/chat/completions',{method:'POST'});
  assert.equal(calls.length,2);assert.ok(calls[0].opts.dispatcher);assert.equal(calls[0].opts.dispatcher,calls[1].opts.dispatcher);
  assert.equal(calls[0].opts.redirect,'error');assert.equal(calls[0].opts.method,'POST');
  for(const url of ['https://api.giga.chat.evil.example/v1/chat/completions','http://api.giga.chat/v1/chat/completions','https://api.giga.chat/v1/models','https://api.telegram.org/test']) assert.throws(()=>send(url,{}),/unsupported_gigachat_endpoint/);
  assert.equal(calls.length,2);
});
