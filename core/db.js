"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, "shop.sqlite"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const SUPPORTED_CURRENCIES = ["USD", "MXN"];
function now() { return new Date().toISOString(); }
function normalizeCurrency(currency) { const c = String(currency || "USD").toUpperCase().trim(); return SUPPORTED_CURRENCIES.includes(c) ? c : "USD"; }
function normalizeRole(role) { return String(role || "user").toLowerCase() === "admin" ? "admin" : "user"; }
function clean(v = "") { return String(v || "").trim(); }
function columnExists(table, column) { return sqlite.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column); }
function addColumnIfMissing(table, column, sql) { if (!columnExists(table, column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`); }

sqlite.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', email_verified INTEGER NOT NULL DEFAULT 1, phone TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plugin_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, area TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'ri-folder-line', order_index INTEGER NOT NULL DEFAULT 100);
CREATE TABLE IF NOT EXISTS plugins (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, route TEXT NOT NULL, area TEXT NOT NULL, category_id INTEGER, permission TEXT NOT NULL DEFAULT 'user', enabled INTEGER NOT NULL DEFAULT 1, show_in_menu INTEGER NOT NULL DEFAULT 1, order_index INTEGER NOT NULL DEFAULT 100, core INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS product_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'ri-price-tag-3-line', image_path TEXT DEFAULT '', order_index INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', billing_type TEXT NOT NULL DEFAULT 'one_time', cycle_days INTEGER NOT NULL DEFAULT 30, cycle_minutes INTEGER NOT NULL DEFAULT 0, delivery_mode TEXT NOT NULL DEFAULT 'sequential', fixed_delivery TEXT NOT NULL DEFAULT '', image_path TEXT DEFAULT '', stock_limit INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', order_index INTEGER NOT NULL DEFAULT 100, delivered_to_user_id INTEGER, delivered_invoice_id INTEGER, delivered_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, invoice_id INTEGER, status TEXT NOT NULL DEFAULT 'active', next_invoice_at TEXT, canceled_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', balance REAL NOT NULL DEFAULT 0, UNIQUE(user_id, currency));
CREATE TABLE IF NOT EXISTS wallet_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount REAL NOT NULL, balance_before REAL NOT NULL, balance_after REAL NOT NULL, type TEXT NOT NULL, invoice_id INTEGER, admin_id INTEGER, note TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'product', status TEXT NOT NULL DEFAULT 'pending', subtotal REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', due_at TEXT, paid_at TEXT, pdf_path TEXT DEFAULT '', metadata_json TEXT DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, item_type TEXT NOT NULL, reference_id INTEGER, name TEXT NOT NULL, description TEXT DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, user_id INTEGER NOT NULL, provider TEXT NOT NULL, provider_ref TEXT DEFAULT '', amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'pending', raw_json TEXT DEFAULT '{}', created_at TEXT NOT NULL, confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS delivery_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, invoice_id INTEGER NOT NULL, inventory_item_id INTEGER, delivered_content TEXT NOT NULL, delivered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, recipient_email TEXT NOT NULL, recipient_name TEXT DEFAULT '', subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent', error_msg TEXT DEFAULT '', sent_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS email_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, code TEXT NOT NULL, type TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
`);

addColumnIfMissing("users", "first_name", "TEXT DEFAULT ''");
addColumnIfMissing("users", "last_name", "TEXT DEFAULT ''");
addColumnIfMissing("users", "phone", "TEXT DEFAULT ''");
addColumnIfMissing("users", "whatsapp_country", "TEXT DEFAULT '+1'");
addColumnIfMissing("users", "whatsapp_number", "TEXT DEFAULT ''");
addColumnIfMissing("users", "email_verified", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("product_categories", "image_path", "TEXT DEFAULT ''");
addColumnIfMissing("product_categories", "active", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("products", "currency", "TEXT NOT NULL DEFAULT 'USD'");
addColumnIfMissing("products", "cycle_minutes", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("products", "image_path", "TEXT DEFAULT ''");
addColumnIfMissing("products", "stock_limit", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("invoices", "currency", "TEXT NOT NULL DEFAULT 'USD'");
addColumnIfMissing("invoices", "payment_method", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("invoices", "suspended_at", "TEXT");
addColumnIfMissing("invoices", "canceled_at", "TEXT");
addColumnIfMissing("services", "suspended_at", "TEXT");
addColumnIfMissing("payments", "currency", "TEXT NOT NULL DEFAULT 'USD'");
addColumnIfMissing("products", "accept_credit", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("products", "accept_paypal", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("products", "accept_stripe", "INTEGER NOT NULL DEFAULT 1");

function setSetting(key, value) { sqlite.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value ?? "")); }
function getSetting(key, fallback = "") { const row = sqlite.prepare("SELECT value FROM settings WHERE key=?").get(key); return row ? row.value : fallback; }
function ensureSetting(key, value) { if (!sqlite.prepare("SELECT key FROM settings WHERE key=?").get(key)) setSetting(key, value); }
function getUserById(id) { return sqlite.prepare("SELECT * FROM users WHERE id=?").get(id); }
function getUserByEmail(email) { return sqlite.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").toLowerCase().trim()); }
function buildUsername(firstName, lastName, fallbackEmail = "") { const full = `${clean(firstName)} ${clean(lastName)}`.trim(); return full || String(fallbackEmail || "user").split("@")[0] || "user"; }
function buildPhone(country, number) { const cc = clean(country) || "+1"; const num = clean(number); return num ? `${cc} ${num}` : ""; }
function createUser({ first_name, last_name, username, email, password, phone = "", whatsapp_country = "+1", whatsapp_number = "", role = "user", emailVerified = 1 }) {
  const cleanEmail = clean(email).toLowerCase(); const cleanPassword = String(password || ""); const first = clean(first_name || username || ""); const last = clean(last_name || ""); const finalUsername = buildUsername(first, last, cleanEmail); const waCountry = clean(whatsapp_country) || "+1"; const waNumber = clean(whatsapp_number || phone || ""); const finalPhone = buildPhone(waCountry, waNumber) || clean(phone || "");
  if (!first || !cleanEmail || cleanPassword.length < 6) return { ok: false, error: "Nombre, correo y contraseña mínimo 6 caracteres son obligatorios." };
  if (getUserByEmail(cleanEmail)) return { ok: false, error: "Ese correo ya existe." };
  const info = sqlite.prepare("INSERT INTO users (username,first_name,last_name,email,password_hash,role,email_verified,phone,whatsapp_country,whatsapp_number,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(finalUsername, first, last, cleanEmail, bcrypt.hashSync(cleanPassword, 10), normalizeRole(role), emailVerified ? 1 : 0, finalPhone, waCountry, waNumber, now());
  return { ok: true, user: getUserById(info.lastInsertRowid) };
}
function updateUser(userId, data) {
  const user = getUserById(userId); if (!user) return { ok: false, error: "Usuario no encontrado." }; const email = clean(data.email).toLowerCase(); const dup = getUserByEmail(email); if (dup && Number(dup.id) !== Number(userId)) return { ok: false, error: "Ese correo ya existe en otra cuenta." };
  const first = clean(data.first_name); const last = clean(data.last_name); const waCountry = clean(data.whatsapp_country) || "+1"; const waNumber = clean(data.whatsapp_number); const phone = buildPhone(waCountry, waNumber); const username = buildUsername(first, last, email); const roleOut = setUserRole(userId, data.role); if (!roleOut.ok) return roleOut;
  sqlite.prepare("UPDATE users SET username=?, first_name=?, last_name=?, email=?, phone=?, whatsapp_country=?, whatsapp_number=?, email_verified=? WHERE id=?").run(username, first, last, email, phone, waCountry, waNumber, data.email_verified ? 1 : 0, userId);
  if (String(data.password || "").length >= 6) sqlite.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(data.password), 10), userId);
  return { ok: true, user: getUserById(userId) };
}
function setUserRole(userId, role) { const nextRole = normalizeRole(role); const user = getUserById(userId); if (!user) return { ok: false, error: "Usuario no encontrado." }; const admins = sqlite.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c; if (user.role === "admin" && nextRole !== "admin" && admins <= 1) return { ok: false, error: "No puedes quitar el último admin." }; sqlite.prepare("UPDATE users SET role=? WHERE id=?").run(nextRole, userId); return { ok: true }; }
function deleteUser(userId, currentAdminId) { const user = getUserById(userId); if (!user) return { ok: false, error: "Usuario no encontrado." }; if (Number(userId) === Number(currentAdminId)) return { ok: false, error: "No puedes borrar tu propia cuenta desde aquí." }; const admins = sqlite.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c; if (user.role === "admin" && admins <= 1) return { ok: false, error: "No puedes borrar el último admin." }; sqlite.prepare("DELETE FROM users WHERE id=?").run(userId); return { ok: true }; }
function ensureAdmin() { if (!getUserByEmail("ventasweb@gmail.com")) createUser({ first_name: "sky507", last_name: "", email: "ventasweb@gmail.com", password: "123456", role: "admin", emailVerified: 1 }); }
function ensureCategory(area, name, icon, orderIndex) { const row = sqlite.prepare("SELECT id FROM plugin_categories WHERE area=? AND name=?").get(area, name); if (row) return row.id; return sqlite.prepare("INSERT INTO plugin_categories (area,name,icon,order_index) VALUES (?,?,?,?)").run(area, name, icon, orderIndex).lastInsertRowid; }
function getWallet(userId, currency = "USD") { const c = normalizeCurrency(currency); let w = sqlite.prepare("SELECT * FROM wallets WHERE user_id=? AND currency=?").get(userId, c); if (!w) { sqlite.prepare("INSERT INTO wallets (user_id,currency,balance) VALUES (?,?,0)").run(userId, c); w = sqlite.prepare("SELECT * FROM wallets WHERE user_id=? AND currency=?").get(userId, c); } return w; }
function adjustWallet({ userId, currency = "USD", amount = 0, type = "admin_adjustment", adminId = null, note = "", invoiceId = null }) { const c = normalizeCurrency(currency); const value = Number(amount || 0); if (!Number.isFinite(value) || value === 0) return { ok: false, error: "Monto inválido." }; const w = getWallet(userId, c); const before = Number(w.balance || 0); const after = before + value; sqlite.prepare("UPDATE wallets SET balance=? WHERE id=?").run(after, w.id); sqlite.prepare("INSERT INTO wallet_transactions (wallet_id,user_id,amount,balance_before,balance_after,type,invoice_id,admin_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(w.id, userId, value, before, after, type, invoiceId, adminId, note, now()); return { ok: true, before, after, wallet: getWallet(userId, c) }; }
function setWalletBalance({ userId, currency = "USD", balance = 0, adminId = null, note = "" }) { const c = normalizeCurrency(currency); const target = Number(balance || 0); if (!Number.isFinite(target) || target < 0) return { ok: false, error: "Balance inválido." }; const w = getWallet(userId, c); const before = Number(w.balance || 0); const diff = target - before; sqlite.prepare("UPDATE wallets SET balance=? WHERE id=?").run(target, w.id); sqlite.prepare("INSERT INTO wallet_transactions (wallet_id,user_id,amount,balance_before,balance_after,type,admin_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(w.id, userId, diff, before, target, "admin_set_balance", adminId, note, now()); return { ok: true, before, after: target, wallet: getWallet(userId, c) }; }
function createEmailToken(userId, type) {
  const token = crypto.randomBytes(32).toString("hex");
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
  sqlite.prepare("DELETE FROM email_tokens WHERE user_id=? AND type=?").run(userId, type);
  sqlite.prepare("INSERT INTO email_tokens (user_id,token,code,type,expires_at,used,created_at) VALUES (?,?,?,?,?,0,?)").run(userId, token, code, type, expires, now());
  return { token, code };
}
function verifyEmailToken(lookup, type) {
  const s = String(lookup || "");
  let t = sqlite.prepare("SELECT * FROM email_tokens WHERE token=? AND type=? AND used=0").get(s, type);
  if (!t) t = sqlite.prepare("SELECT * FROM email_tokens WHERE code=? AND type=? AND used=0").get(s, type);
  if (!t || new Date(t.expires_at) < new Date()) return null;
  return t;
}
function useEmailToken(id) { sqlite.prepare("UPDATE email_tokens SET used=1 WHERE id=?").run(id); }
function resetPassword(userId, password) {
  if (!password || String(password).length < 6) return { ok: false, error: "La contraseña debe tener mínimo 6 caracteres." };
  sqlite.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(String(password), 10), userId);
  return { ok: true };
}
function seed() { ensureAdmin();
  ensureSetting("paypal_api_enabled", "0");
  ensureSetting("paypal_api_mode", "sandbox");
  ensureSetting("paypal_api_client_id", "");
  ensureSetting("paypal_api_secret", "");
  ensureSetting("paypal_ipn_enabled", "0");
  ensureSetting("paypal_ipn_email", "");
  ensureSetting("stripe_enabled", "0");
  ensureSetting("stripe_pk", "");
  ensureSetting("stripe_sk", "");
  ensureSetting("stripe_webhook_secret", "");
  ensureSetting("lifecycle_enabled", "0");
  ensureSetting("lifecycle_pending_to_suspend", "off");
  ensureSetting("lifecycle_suspend_to_cancel", "off");
  ensureSetting("lifecycle_cancel_to_delete", "off");
  ensureSetting("site_name", "SKY ULTRA PLUS shop"); ensureSetting("site_logo", ""); ensureSetting("require_email_verification", "0"); ensureSetting("smtp_host", ""); ensureSetting("smtp_port", "587"); ensureSetting("smtp_security", "STARTTLS"); ensureSetting("smtp_user", ""); ensureSetting("smtp_pass", ""); ensureSetting("smtp_from_name", ""); ensureSetting("smtp_from_email", ""); ensureSetting("site_url", ""); ensureSetting("mail_header_color_from", "#4c1d95"); ensureSetting("mail_header_color_to", "#7c3aed"); ensureSetting("theme_dark_bg", "#050508"); ensureSetting("theme_dark_card", "#101426"); ensureSetting("theme_dark_text", "#e9f2ff"); ensureSetting("theme_dark_accent", "#8b2cff"); ensureSetting("theme_light_bg", "#f4f7fb"); ensureSetting("theme_light_card", "#ffffff"); ensureSetting("theme_light_text", "#102033"); ensureSetting("theme_light_accent", "#2563eb"); ensureCategory("client", "Inicio", "ri-dashboard-line", 10); ensureCategory("client", "Tienda", "ri-store-2-line", 20); ensureCategory("client", "Cuenta", "ri-user-settings-line", 30); ensureCategory("client", "Facturación", "ri-bill-line", 40); ensureCategory("admin", "Resumen", "ri-dashboard-2-line", 10); ensureCategory("admin", "Tienda", "ri-shopping-bag-3-line", 20); ensureCategory("admin", "Usuarios", "ri-group-line", 30); ensureCategory("admin", "Facturación", "ri-file-list-3-line", 40); ensureCategory("admin", "Sistema", "ri-settings-4-line", 50); ensureSetting("support_email", ""); ensureSetting("support_whatsapp_country", "+1"); ensureSetting("support_whatsapp_number", ""); ensureSetting("support_whatsapp_group", ""); ensureSetting("promo_slides", JSON.stringify([{"text":"¡Bienvenido a nuestra tienda!","subtitle":"Explora nuestros productos y servicios digitales","colorFrom":"#4c1d95","colorTo":"#7c3aed","image":""},{"text":"Pagos 100% seguros","subtitle":"Múltiples métodos de pago rápidos y confiables","colorFrom":"#1e3a5f","colorTo":"#2563eb","image":""},{"text":"Entrega inmediata","subtitle":"Recibe tus productos digitales al instante","colorFrom":"#1a3a2a","colorTo":"#059669","image":""},{"text":"Soporte disponible","subtitle":"Estamos aquí para ayudarte en lo que necesites","colorFrom":"#3d1f1f","colorTo":"#dc2626","image":""},{"text":"Precios imbatibles","subtitle":"La mejor relación calidad-precio del mercado","colorFrom":"#1f2d3d","colorTo":"#0ea5e9","image":""},{"text":"Catálogo completo","subtitle":"Encuentra exactamente lo que estás buscando","colorFrom":"#3d2a00","colorTo":"#f59e0b","image":""},{"text":"Comunidad activa","subtitle":"Únete a miles de clientes satisfechos","colorFrom":"#2d1f3d","colorTo":"#a855f7","image":""}])); }
seed();

module.exports = { sqlite, now, getSetting, setSetting, getUserById, getUserByEmail, getWallet, adjustWallet, setWalletBalance, ensureCategory, createUser, updateUser, deleteUser, setUserRole, normalizeCurrency, normalizeRole, SUPPORTED_CURRENCIES, createEmailToken, verifyEmailToken, useEmailToken, resetPassword };
