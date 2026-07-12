"use strict";

const express = require("express");
const lifecycle = require("../../core/lifecycle");

const config = {
  key: "admin_lifecycle",
  name: "Ciclo de vida",
  icon: "ri-time-line",
  route: "/admin/lifecycle",
  area: "admin",
  category: "Sistema",
  permission: "admin",
  order: 35,
};

const OPTIONS = [
  ["off",  "Deshabilitado"],
  ["1m",   "1 minuto (test)"],
  ["3m",   "3 minutos (test)"],
  ["5m",   "5 minutos (test)"],
  ["7m",   "7 minutos (test)"],
  ["10m",  "10 minutos (test)"],
  ["30m",  "30 minutos (test)"],
  ["1h",   "1 hora"],
  ["1d",   "1 día"],
  ["3d",   "3 días"],
  ["7d",   "1 semana (7 días)"],
  ["15d",  "15 días"],
  ["30d",  "30 días"],
];

function h(ctx, v) { return ctx.layout.escapeHtml(v || ""); }
function reg(ctx) { return require("../../core/pluginLoader").registry(ctx.db); }
function opts(sel) {
  return OPTIONS.map(([v,l]) => `<option value="${v}" ${sel===v?"selected":""}>${l}</option>`).join("");
}

function page(ctx, req, res) {
  const g = (k, d="") => ctx.db.getSetting(k, d);
  const enabled = g("lifecycle_enabled","0") === "1";
  const p2s = g("lifecycle_pending_to_suspend","off");
  const s2c = g("lifecycle_suspend_to_cancel","off");
  const c2d = g("lifecycle_cancel_to_delete","off");

  const ok  = req.query.saved ? `<div class="notice success" style="margin:0 0 14px"><i class="ri-check-line"></i> Configuración guardada.</div>` : "";
  const ran = req.query.ran ? `<div class="notice success" style="margin:0 0 14px"><i class="ri-flashlight-line"></i> Ciclo ejecutado: ${h(ctx, req.query.ran)}</div>` : "";

  res.renderPage({
    title: "Ciclo de vida",
    area: "admin",
    registry: reg(ctx),
    content: `
<style>
  .lc-wrap{display:grid;grid-template-columns:1fr;gap:18px;max-width:980px}
  .lc-card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.18)}
  .lc-head{display:flex;align-items:center;gap:14px;margin-bottom:6px}
  .lc-head-icon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-size:24px}
  .lc-head h2{margin:0;font-size:20px}
  .lc-head p{margin:2px 0 0;color:var(--muted);font-size:13px}
  .lc-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid var(--border);border-radius:14px;margin-top:10px;background:rgba(255,255,255,.02)}
  .lc-toggle .t-text b{display:block;font-size:14px;margin-bottom:2px}
  .lc-toggle .t-text small{color:var(--muted);font-size:12px}
  .lc-switch{position:relative;display:inline-block;width:46px;height:26px}
  .lc-switch input{display:none}
  .lc-switch em{position:absolute;inset:0;background:rgba(255,255,255,.16);border-radius:999px;transition:.2s}
  .lc-switch em:before{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s}
  .lc-switch input:checked+em{background:#22c55e}
  .lc-switch input:checked+em:before{transform:translateX(20px)}
  .lc-stage{display:grid;grid-template-columns:56px 1fr 220px;gap:14px;align-items:center;padding:14px;border:1px solid var(--border);border-radius:14px;margin-top:10px;background:rgba(255,255,255,.02)}
  .lc-stage-icon{width:56px;height:56px;border-radius:14px;display:grid;place-items:center;font-size:24px;color:#fff}
  .lc-stage-icon.s1{background:linear-gradient(135deg,#f59e0b,#fb923c)}
  .lc-stage-icon.s2{background:linear-gradient(135deg,#ef4444,#dc2626)}
  .lc-stage-icon.s3{background:linear-gradient(135deg,#7f1d1d,#1f2937)}
  .lc-stage-text b{display:block;font-size:14px;margin-bottom:3px}
  .lc-stage-text small{color:var(--muted);font-size:12.5px;line-height:1.4;display:block}
  .lc-stage select{width:100%;padding:11px 13px;border-radius:11px;border:1px solid var(--border);background:rgba(0,0,0,.18);color:var(--text);font-size:14px;font-family:inherit}
  .lc-actions{display:flex;justify-content:space-between;gap:10px;margin-top:18px;align-items:center;flex-wrap:wrap}
  .lc-btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;border:0;padding:11px 18px;border-radius:11px;font-weight:700;cursor:pointer;font-size:14px;text-decoration:none}
  .lc-btn.ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
  .lc-help{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.35);border-radius:14px;padding:16px 18px;font-size:13.5px;line-height:1.55}
  .lc-help h3{margin:0 0 8px;font-size:15px;color:#fbbf24;display:flex;align-items:center;gap:8px}
  .lc-help ul{padding-left:20px;margin:6px 0}
  .lc-help code{background:rgba(0,0,0,.35);padding:2px 7px;border-radius:6px;font-size:12.5px;color:#fcd34d}
  @media (max-width:720px){.lc-stage{grid-template-columns:1fr;text-align:center}.lc-stage-icon{margin:0 auto}}
</style>
<div class="page-head"><h1><i class="ri-time-line"></i> Ciclo de vida automático</h1><p>Configura cuánto tiempo debe pasar para que el sistema suspenda, cancele o elimine facturas y servicios.</p></div>
${ok}${ran}

<div class="lc-wrap">

  <section class="lc-card">
    <div class="lc-help">
      <h3><i class="ri-information-line"></i> ¿Cómo funciona?</h3>
      <p>Un proceso se ejecuta cada 30 segundos en segundo plano y aplica estas transiciones automáticamente:</p>
      <ul>
        <li><b>Pendiente → Suspendido</b>: facturas pendientes que llevan más tiempo del configurado.</li>
        <li><b>Suspendido → Cancelado</b>: facturas/servicios suspendidos que llevan más tiempo del configurado.</li>
        <li><b>Cancelado → Eliminado</b>: servicios cancelados (con todas sus facturas) que llevan más tiempo del configurado.</li>
      </ul>
      <p>Cuando un servicio pasa a <b>suspendido</b> o <b>cancelado</b>, la información de entrega queda oculta para el cliente.</p>
      <p><b>Tip:</b> para probar rápido usa los presets cortos (<code>3 minutos</code>, <code>5 minutos</code>, etc.). En producción usa días.</p>
    </div>
  </section>

  <form class="lc-card" method="POST" action="/admin/lifecycle/save">
    <div class="lc-head">
      <div class="lc-head-icon"><i class="ri-settings-3-line"></i></div>
      <div><h2>Configuración</h2><p>Activa el sistema y define los tiempos de cada transición.</p></div>
    </div>

    <label class="lc-toggle">
      <div class="t-text"><b>Habilitar ciclo de vida automático</b><small>Si está apagado, no se aplica ninguna transición automática (las acciones manuales del admin siguen funcionando).</small></div>
      <label class="lc-switch"><input type="checkbox" name="lifecycle_enabled" value="1" ${enabled?"checked":""}><em></em></label>
    </label>

    <div class="lc-stage">
      <div class="lc-stage-icon s1"><i class="ri-pause-circle-line"></i></div>
      <div class="lc-stage-text">
        <b>1) Pendiente → Suspendido</b>
        <small>Si una factura sigue <b>pendiente</b> durante este tiempo desde su creación, se marca como <b>suspendida</b>. El servicio asociado también se suspende y la información se oculta al cliente.</small>
      </div>
      <select name="lifecycle_pending_to_suspend">${opts(p2s)}</select>
    </div>

    <div class="lc-stage">
      <div class="lc-stage-icon s2"><i class="ri-close-circle-line"></i></div>
      <div class="lc-stage-text">
        <b>2) Suspendido → Cancelado</b>
        <small>Si una factura/servicio sigue <b>suspendido</b> durante este tiempo, se marca como <b>cancelado</b>.</small>
      </div>
      <select name="lifecycle_suspend_to_cancel">${opts(s2c)}</select>
    </div>

    <div class="lc-stage">
      <div class="lc-stage-icon s3"><i class="ri-delete-bin-line"></i></div>
      <div class="lc-stage-text">
        <b>3) Cancelado → Eliminado</b>
        <small>Si un servicio sigue <b>cancelado</b> durante este tiempo, el servicio y <b>todas</b> sus facturas se eliminan permanentemente.</small>
      </div>
      <select name="lifecycle_cancel_to_delete">${opts(c2d)}</select>
    </div>

    <div class="lc-actions">
      <button class="lc-btn" type="submit"><i class="ri-save-3-line"></i> Guardar configuración</button>
    </div>
  </form>

  <form class="lc-card" method="POST" action="/admin/lifecycle/run-now" onsubmit="return confirm('¿Ejecutar el ciclo ahora con la configuración guardada?')">
    <div class="lc-head">
      <div class="lc-head-icon" style="background:linear-gradient(135deg,#7c3aed,#a855f7)"><i class="ri-flashlight-line"></i></div>
      <div><h2>Ejecutar ahora</h2><p>Corre el proceso manualmente sin esperar los 30 segundos del intervalo automático.</p></div>
    </div>
    <div class="lc-actions" style="justify-content:flex-end">
      <button class="lc-btn ghost" type="submit"><i class="ri-flashlight-line"></i> Ejecutar ciclo</button>
    </div>
  </form>

</div>`
  });
}

function router(ctx) {
  const r = express.Router();
  r.use(ctx.auth.requireAdmin);

  r.post("/save", (req, res) => {
    const allowed = OPTIONS.map(o => o[0]);
    const valid = (v) => allowed.includes(String(v)) ? String(v) : "off";
    ctx.db.setSetting("lifecycle_enabled", req.body.lifecycle_enabled ? "1" : "0");
    ctx.db.setSetting("lifecycle_pending_to_suspend", valid(req.body.lifecycle_pending_to_suspend));
    ctx.db.setSetting("lifecycle_suspend_to_cancel", valid(req.body.lifecycle_suspend_to_cancel));
    ctx.db.setSetting("lifecycle_cancel_to_delete", valid(req.body.lifecycle_cancel_to_delete));
    res.redirect("/admin/lifecycle?saved=1");
  });

  r.post("/run-now", (req, res) => {
    try {
      const out = lifecycle.runLifecycle(ctx.db);
      const txt = out.skipped
        ? "deshabilitado (no se ejecutó nada)"
        : `suspendidos ${out.suspended}, cancelados ${out.canceled}, eliminados ${out.deleted}`;
      res.redirect("/admin/lifecycle?ran=" + encodeURIComponent(txt));
    } catch (e) {
      res.redirect("/admin/lifecycle?ran=" + encodeURIComponent("ERROR: " + e.message));
    }
  });

  r.get("/", (req, res) => page(ctx, req, res));
  return r;
}

module.exports = { config, router };
