import { useEffect, useState } from "react";
import { issuerPortalOrigin } from "./api";
type Request={id:string;lotId:string;status:string;createdAt:string};
const origin=()=> (import.meta.env.VITE_ISSUER_DELIVERY_ORIGIN||"http://127.0.0.1:3002").replace(/\/$/,"");
export async function lotRequestApi<T>(body?:{lotId:string}):Promise<T>{
  let token="";if(body){const csrf=await fetch(origin()+"/issuer/csrf",{credentials:"include"});if(!csrf.ok)throw new Error("Không thể mở phiên Issuer.");token=(await csrf.json()).token;}
  const response=await fetch(origin()+"/issuer/lot/requests",{credentials:"include",method:body?"POST":"GET",headers:body?{"Content-Type":"application/json","x-csrf-token":token}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw new Error(data.message||"Không thể tiếp tục yêu cầu.");return data;
}
export function LotRequestAction({lotId}:{lotId:string}){
  const [r,setR]=useState<Request|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[ready,setReady]=useState(false);
  useEffect(()=>{let active=true;lotRequestApi<Request[]>().then(rows=>{if(active){setR(rows.find(r=>r.lotId===lotId)||null);setReady(true);}}).catch(()=>{if(active)setError("Không thể tải yêu cầu Issuer; vui lòng tải lại.");});return()=>{active=false;};},[lotId]);
  async function create(){if(busy||!ready)return;setBusy(true);setError("");try{const request=await lotRequestApi<Request>({lotId});window.location.assign(issuerPortalOrigin()+"/submit-lot/"+encodeURIComponent(request.id));}catch(e){setError((e as Error).message);setBusy(false);}}
  const open=r&&["PENDING_EVIDENCE","PENDING_REVIEW","APPROVED","ISSUING"].includes(r.status);
  return <div>{r&&<><small>Yêu cầu {r.id.slice(0,8).toUpperCase()} · {r.status} · {new Date(r.createdAt).toLocaleString("vi-VN")}</small><a className="text-button" href={issuerPortalOrigin()+"/submit-lot/"+encodeURIComponent(r.id)}>Theo dõi hồ sơ tại Issuer</a></>}{!open&&<button className="text-button" disabled={busy||!ready} onClick={()=>void create()}>{busy?"Đang gửi…":"Yêu cầu xác minh lô"}</button>}{error&&<small role="alert">{error}</small>}</div>;
}
