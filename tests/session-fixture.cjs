'use strict';
// Adapts pre-personal-account behavioural tests to a real session. The product
// never enables the legacy key as an API credential.
const actual=global.fetch,cache=new Map();
const legacy=new Set(['test-admin-token-long-enough-123456','test-admin-token-with-more-than-24-chars','admin-token-123456789012345678']);
const credentials={login:'fixture-manager',name:'Тестовый управляющий',password:'Fixture-password-123456'};
async function session(root,setupToken){
  const key=root+'|'+setupToken;if(cache.has(key))return cache.get(key);
  const work=(async()=>{const req=async(url,data)=>actual(root+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    let r=await req('/api/auth/bootstrap',{...credentials,setupToken});if(!r.ok){r=await req('/api/auth/login',{login:credentials.login,password:credentials.password});}const result=await r.json();if(!r.ok||!result.token)throw Error('fixture auth failed');return result.token;
  })();cache.set(key,work);try{return await work;}catch(e){cache.delete(key);throw e;}
}
global.fetch=async function(url,options){const headers=options?.headers||{},original=headers.Authorization||headers.authorization;
  if(typeof original==='string'&&original.startsWith('Bearer ')&&legacy.has(original.slice(7))){const parsed=new URL(String(url)),token=await session(parsed.origin,original.slice(7));return actual(url,{...options,headers:{...headers,Authorization:'Bearer '+token}});}
  return actual(url,options);
};
module.exports={session,credentials};
