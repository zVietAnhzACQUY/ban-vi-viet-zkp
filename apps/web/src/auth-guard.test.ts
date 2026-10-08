import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("admin routes gate session/role before mounting Admin and use generic 404",()=>{
 const source=readFileSync(new URL("./App.tsx",import.meta.url),"utf8");
 for(const path of ["/admin","/quan-tri"]){const route=source.split("\n").find(line=>line.includes(`path="${path}"`))!;assert(route);assert.match(route,/!sessionReady/);assert.match(route,/!user\?<Navigate/);assert.match(route,/user.role==="ADMIN"\?<Admin/);assert.match(route,/:<NotFound/);}
 assert.equal(source.includes("Trang này chưa có"),false);
 const portal=readFileSync(new URL("../../issuer-portal/src/App.tsx",import.meta.url),"utf8");
 assert.match(portal,/loadedContext!==context/);assert.match(portal,/\/issuer\/auth\/login/);assert.match(portal,/\/issuer\/auth\/me/);assert.match(portal,/\/issuer\/auth\/logout/);
});
