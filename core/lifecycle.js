"use strict";

const PRESETS = {
  off:    null,
  "1m":   1 * 60 * 1000,
  "3m":   3 * 60 * 1000,
  "5m":   5 * 60 * 1000,
  "7m":   7 * 60 * 1000,
  "10m": 10 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h":   60 * 60 * 1000,
  "1d":   24 * 60 * 60 * 1000,
  "3d":  3 * 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "15d":15 * 24 * 60 * 60 * 1000,
  "30d":30 * 24 * 60 * 60 * 1000,
};

function ms(preset) {
  const k = String(preset || "off");
  return PRESETS[k] ?? null;
}

function presetLabel(preset) {
  const map = {
    off: "Deshabilitado",
    "1m": "1 minuto (test)",
    "3m": "3 minutos (test)",
    "5m": "5 minutos (test)",
    "7m": "7 minutos (test)",
    "10m": "10 minutos (test)",
    "30m": "30 minutos (test)",
    "1h": "1 hora",
    "1d": "1 día",
    "3d": "3 días",
    "7d": "1 semana (7 días)",
    "15d": "15 días",
    "30d": "30 días",
  };
  return map[preset] || preset;
}

function deleteInvoiceArtifacts(db, invoiceId) {
  db.sqlite.prepare(`DELETE FROM invoice_items WHERE invoice_id=?`).run(invoiceId);
  db.sqlite.prepare(`DELETE FROM payments WHERE invoice_id=?`).run(invoiceId);
  db.sqlite.prepare(`DELETE FROM delivery_allocations WHERE invoice_id=?`).run(invoiceId);
  db.sqlite.prepare(`DELETE FROM invoices WHERE id=?`).run(invoiceId);
}

function runLifecycle(db) {
  if (db.getSetting("lifecycle_enabled", "0") !== "1") return { skipped: true };

  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const pendingMs = ms(db.getSetting("lifecycle_pending_to_suspend", "off"));
  const suspendMs = ms(db.getSetting("lifecycle_suspend_to_cancel", "off"));
  const cancelMs  = ms(db.getSetting("lifecycle_cancel_to_delete", "off"));

  let suspended = 0, canceled = 0, deleted = 0;

  /* ===== 1) PENDING → SUSPENDED ===== */
  if (pendingMs != null) {
    const cutoff = new Date(now - pendingMs).toISOString();
    const pendings = db.sqlite.prepare(`
      SELECT id, number FROM invoices
      WHERE status='pending' AND created_at <= ?
    `).all(cutoff);
    for (const inv of pendings) {
      db.sqlite.prepare(`
        UPDATE invoices SET status='suspended', suspended_at=? WHERE id=?
      `).run(nowISO, inv.id);
      db.sqlite.prepare(`
        UPDATE services SET status='suspended', suspended_at=?
        WHERE invoice_id=? AND status NOT IN ('canceled','suspended')
      `).run(nowISO, inv.id);
      suspended++;
      console.log(`[lifecycle] invoice ${inv.number || inv.id} -> suspended`);
    }
    const overdueSvcs = db.sqlite.prepare(`
      SELECT s.id FROM services s
      JOIN invoices i ON i.id=s.invoice_id
      WHERE s.status='active' AND i.status='pending' AND i.created_at <= ?
    `).all(cutoff);
    for (const s of overdueSvcs) {
      db.sqlite.prepare(`UPDATE services SET status='suspended', suspended_at=? WHERE id=?`).run(nowISO, s.id);
      suspended++;
    }
  }

  /* ===== 2) SUSPENDED → CANCELED ===== */
  if (suspendMs != null) {
    const cutoff = new Date(now - suspendMs).toISOString();
    const invs = db.sqlite.prepare(`
      SELECT id, number FROM invoices
      WHERE status='suspended' AND COALESCE(suspended_at, created_at) <= ?
    `).all(cutoff);
    for (const inv of invs) {
      db.sqlite.prepare(`
        UPDATE invoices SET status='canceled', canceled_at=? WHERE id=?
      `).run(nowISO, inv.id);
      db.sqlite.prepare(`
        UPDATE services SET status='canceled', canceled_at=?
        WHERE invoice_id=? AND status != 'canceled'
      `).run(nowISO, inv.id);
      canceled++;
      console.log(`[lifecycle] invoice ${inv.number || inv.id} -> canceled`);
    }
    const svcs = db.sqlite.prepare(`
      SELECT id FROM services
      WHERE status='suspended' AND COALESCE(suspended_at, created_at) <= ?
    `).all(cutoff);
    for (const s of svcs) {
      db.sqlite.prepare(`UPDATE services SET status='canceled', canceled_at=? WHERE id=?`).run(nowISO, s.id);
      canceled++;
    }
  }

  /* ===== 3) CANCELED → DELETED (service + all its invoices) ===== */
  if (cancelMs != null) {
    const cutoff = new Date(now - cancelMs).toISOString();
    const svcs = db.sqlite.prepare(`
      SELECT id, user_id, product_id FROM services
      WHERE status='canceled' AND COALESCE(canceled_at, created_at) <= ?
    `).all(cutoff);
    for (const s of svcs) {
      const invs = db.sqlite.prepare(`
        SELECT DISTINCT i.id FROM invoices i
        LEFT JOIN invoice_items it ON it.invoice_id=i.id AND it.item_type='product' AND it.reference_id=?
        WHERE i.user_id=? AND (it.id IS NOT NULL OR i.id IN (SELECT invoice_id FROM services WHERE id=?))
      `).all(s.product_id, s.user_id, s.id);
      const tx = db.sqlite.transaction(() => {
        for (const inv of invs) deleteInvoiceArtifacts(db, inv.id);
        db.sqlite.prepare(`DELETE FROM services WHERE id=?`).run(s.id);
      });
      try {
        tx();
        deleted++;
        console.log(`[lifecycle] service #${s.id} deleted (with ${invs.length} invoices)`);
      } catch (e) {
        console.error(`[lifecycle] delete service #${s.id} failed:`, e.message);
      }
    }
    const oldInvs = db.sqlite.prepare(`
      SELECT i.id FROM invoices i
      LEFT JOIN services s ON s.invoice_id=i.id
      WHERE i.status='canceled' AND COALESCE(i.canceled_at, i.created_at) <= ? AND s.id IS NULL
    `).all(cutoff);
    for (const inv of oldInvs) {
      try {
        const tx = db.sqlite.transaction(() => deleteInvoiceArtifacts(db, inv.id));
        tx();
        deleted++;
        console.log(`[lifecycle] invoice #${inv.id} deleted`);
      } catch (e) {
        console.error(`[lifecycle] delete invoice #${inv.id} failed:`, e.message);
      }
    }
  }

  return { skipped: false, suspended, canceled, deleted };
}

module.exports = { runLifecycle, PRESETS, ms, presetLabel };
