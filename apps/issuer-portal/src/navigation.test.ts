import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {configuredWebsiteOrigin,customerReturn,allowedCustomerReturn} from "./navigation";
const origin="http://127.0.0.1:5173",id="11111111-1111-4111-8111-111111111111";
test("production requires exact configured Website origin",()=>{
 assert.throws(()=>configuredWebsiteOrigin(undefined,true),/WEBSITE_ORIGIN/);
 assert.equal(configuredWebsiteOrigin(undefined,false),origin);
 for(const input of ["*","https://*.example.com","https://user:password@example.com","https://example.com/path","https://example.com?returnUrl=evil","javascript:alert(1)"])
  assert.throws(()=>configuredWebsiteOrigin(input,true));
 assert.equal(configuredWebsiteOrigin("https://shop.example.com/",true),"https://shop.example.com");
});
test("AGE, receive and LOT use fixed contextual destinations",()=>{
 assert.deepEqual(customerReturn(origin,"AGE",id),{label:"Quay lại theo dõi yêu cầu",url:origin+"/account/age-verification/"+id});
 assert.deepEqual(customerReturn(origin,"RECEIVE"),{label:"Quay lại tài khoản",url:origin+"/tai-khoan"});
 assert.deepEqual(customerReturn(origin,"LOT"),{label:"Quay lại quản lý lô hàng",url:origin+"/quan-tri?tab=lots"});
 assert.throws(()=>customerReturn(origin,"AGE","//evil.invalid"));
});
test("external or unexpected returnUrl is not allowlisted",()=>{
 const expected=customerReturn(origin,"AGE",id).url;
 assert.equal(allowedCustomerReturn(expected,origin,"AGE",id),expected);
 for(const candidate of ["https://evil.invalid","//evil.invalid",origin+"/admin",expected+"?returnUrl=https://evil.invalid",origin+".evil.invalid/account",undefined])
  assert.equal(allowedCustomerReturn(candidate,origin,"AGE",id),null);
});
test("operator login, home, denied and review have no commerce links",()=>{
 const app=readFileSync(new URL("./App.tsx",import.meta.url),"utf8");
 for(const [start,end] of [["function Denied(","function Login("],["function Login(","function Home("],["function Home(","function LegacyRedirect("],["function Operator(","function Logout("]]){
  const part=app.slice(app.indexOf(start),app.indexOf(end));assert(part.length>0);assert.equal(part.includes("websiteOrigin"),false);assert.equal(part.includes("Bản Vị Việt"),false);assert.equal(part.includes('href="http'),false);
 }
 assert.equal(app.includes("Quay lại Bản Vị Việt"),false);
 assert.match(app,/customerReturn\(websiteOrigin\(\), "RECEIVE"\)/);
 const evidence=readFileSync(new URL("./evidence.tsx",import.meta.url),"utf8");assert.match(evidence,/customerReturn\(websiteOrigin\(\),"AGE",id\)/);assert.match(evidence,/\{back.label\}/);
 assert.match(app,/navigate\("\/login", \{ replace: true \}\)/);
 assert.equal(app.includes('get("returnUrl")'),false);
 const web=readFileSync(new URL("../../web/src/App.tsx",import.meta.url),"utf8");assert.match(web.replace(/\s+/g,""),/get\("tab"\)==="lots"\?"lots":"products"/);
});
