'use strict';

function createExternalClient(callFetch) {
  async function external(url, payload, extraHeaders={}, timeoutMs=20000) {
    const resp = await callFetch(url,{method:'POST',headers:{'content-type':'application/json',...extraHeaders},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    if(!resp.ok) throw Object.assign(new Error('upstream_error'),{status:resp.status});
    try { return await resp.json(); } catch(error) {
      if(error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
      throw new Error('invalid_response');
    }
  }
  return external;
}
module.exports = {createExternalClient};
