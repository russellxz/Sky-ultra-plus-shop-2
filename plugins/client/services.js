"use strict";
const express=require("express");
const billing=require("../../core/billing");
const config={key:"client_services",name:"Mis servicios",icon:"ri-stack-line",route:"/services",area:"client",category:"Cuenta",order:20};
function h(ctx,v){return ctx.layout.escapeHtml(v||"")}
function reg(ctx){return require("../../core/pluginLoader").registry(ctx.db)}
function fmtDate(ts){if(!ts)return"—";try{const d=new Date(ts);return d.toLocaleDateString("es",{day:"numeric",month:"numeric",year:"numeric"})+", "+d.toLocaleTimeString("es",{hour:"numeric",minute:"2-digit",hour12:true});}catch{return"—"}}
function statusInfo(s){
  const map={active:["ok","Activo","ri-checkbox-circle-fill"],pending:["pending","Pendiente","ri-time-fill"],canceled:["err","Cancelado","ri-close-circle-fill"],suspended:["err","Suspendido","ri-error-warning-fill"]};
  return map[s]||["muted",s,"ri-information-fill"];
}
function cycleLabel(p){
  if(!p)return"";
  if(p.billing_type==='one_time')return'Pago único';
  if(Number(p.cycle_minutes)>0)return`Cada ${p.cycle_minutes} min`;
  if(Number(p.cycle_days)===7)return'Semanal';
  if(Number(p.cycle_days)===15)return'Cada 15 días';
  return'Mensual';
}

function router(ctx){
  const r=express.Router();

  r.post("/:id/cancel",(req,res)=>{
    billing.cancelService(ctx.db,req.params.id,req.session.user.id);
    res.redirect("/services?canceled=1");
  });

  r.get("/",(req,res)=>{
    const list=ctx.db.sqlite.prepare(`SELECT s.*, p.name, p.description, p.image_path, p.billing_type, p.cycle_days, p.cycle_minutes, p.currency p_currency, p.price p_price, i.number invoice_number, i.total invoice_total, i.currency invoice_currency
      FROM services s
      JOIN products p ON p.id=s.product_id
      LEFT JOIN invoices i ON i.id=s.invoice_id
      WHERE s.user_id=? ORDER BY s.id DESC`).all(req.session.user.id);

    const cards=list.map(s=>{
      const st=statusInfo(s.status);
      const allocation=s.status==='active'?ctx.db.sqlite.prepare("SELECT delivered_content FROM delivery_allocations WHERE invoice_id=? AND user_id=? LIMIT 1").get(s.invoice_id,req.session.user.id):null;
      const thumb=s.image_path?`<img src="${h(ctx,s.image_path)}" alt="">`:`<div class="svc-thumb-fallback"><i class="ri-archive-2-line"></i></div>`;
      const renewal=s.next_invoice_at?`<span class="svc-renew"><i class="ri-refresh-line"></i> Próx. renovación: ${fmtDate(s.next_invoice_at)}</span>`:'';
      let hiddenMsg='';
      if(!allocation){
        if(s.status==='suspended')hiddenMsg='<div class="svc-canceled-note"><i class="ri-eye-off-line"></i> Servicio suspendido. La información privada está oculta.</div>';
        else if(s.status==='canceled')hiddenMsg='<div class="svc-canceled-note"><i class="ri-eye-off-line"></i> Servicio cancelado. La información privada está oculta.</div>';
        else if(s.status!=='active')hiddenMsg='<div class="svc-canceled-note"><i class="ri-eye-off-line"></i> Información no disponible en este estado.</div>';
      }
      const info=allocation?`<div class="svc-info"><div class="svc-info-head"><i class="ri-key-2-line"></i> Información del producto</div><textarea readonly>${h(ctx,allocation.delivered_content)}</textarea></div>`:hiddenMsg;

      return `<article class="svc-card${(s.status==='canceled'||s.status==='suspended')?' is-canceled':''}">
        <header class="svc-card-head">
          <span class="svc-id">Servicio #${s.id}</span>
          <span class="svc-status ${st[0]}"><i class="${st[2]}"></i> ${h(ctx,st[1])}</span>
        </header>
        <div class="svc-thumb">${thumb}</div>
        <div class="svc-body">
          <h3 class="display-title svc-name">${h(ctx,s.name)}</h3>
          <p class="svc-desc">${h(ctx,s.description||'')}</p>
          <div class="svc-pills">
            <span class="svc-pill"><i class="ri-time-line"></i> ${cycleLabel(s)}</span>
            ${s.invoice_total?`<span class="svc-pill price">${h(ctx,s.invoice_currency||s.p_currency)} ${billing.money(s.invoice_total)}</span>`:''}
          </div>
          ${info}
          <div class="svc-meta">
            <span><i class="ri-file-list-3-line"></i> Factura: <b>${h(ctx,s.invoice_number||'—')}</b></span>
            ${renewal}
          </div>
          <div class="svc-actions">
            ${s.invoice_id?`<a class="svc-btn ghost" href="/invoices/${s.invoice_id}"><i class="ri-file-list-3-line"></i> Ver factura</a>`:''}
            ${s.status==='active'?`<form method="POST" action="/services/${s.id}/cancel" onsubmit="return confirm('¿Seguro que quieres cancelar este servicio? La información privada quedará oculta.')" style="margin:0"><button class="svc-btn danger"><i class="ri-close-circle-line"></i> Cancelar servicio</button></form>`:''}
          </div>
        </div>
      </article>`;
    }).join("");

    const empty=`<div class="inv-empty"><i class="ri-stack-line"></i><b>Sin servicios</b><span>Aún no tienes servicios. Cuando compres un producto se activarán aquí.</span></div>`;
    const msg=req.query.bought?'<div class="notice success">Compra completada. Tu servicio ya está activo.</div>':req.query.canceled?'<div class="notice success">Servicio cancelado.</div>':'';

    res.renderPage({title:"Mis servicios",area:"client",registry:reg(ctx),content:`
      <link rel="stylesheet" href="/public/css/client-billing.css?v=1">
      <div class="svc-page">
        <header class="inv-page-head">
          <h1 class="display-title">Mis servicios</h1>
          <p>Los servicios renovables se conservan como historial, pero no muestran tu información privada.</p>
        </header>
        ${msg}
        <div class="svc-grid">${cards||empty}</div>
      </div>`});
  });

  return r;
}
module.exports={config,router};
