'use strict';

function createExternalClient(callFetch) {
  async function external(url, payload, extraHeaders={}) {
    const resp = await callFetch(url,{method:'POST',headers:{'content-type':'application/json',...extraHeaders},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
    let result={}; try {result=await resp.json();}catch(_){}
    if(!resp.ok) throw Object.assign(new Error('upstream_error'),{status:resp.status});
    return result;
  }
  return external;
}
module.exports = {createExternalClient};
