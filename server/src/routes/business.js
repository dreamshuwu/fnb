import { Router } from 'express';
import { query, getRow, insert, stringifyJSON, parseJSON } from '../db.js';
import { authenticate, tenant, requirePermission } from '../middleware/auth.js';
import { REPORT_CATALOG, REPORT_CATEGORIES, reportColumns } from '../reportCatalog.js';
import { runReport, reportTitle, makeFilter } from '../reportEngine.js';
import { buildCsv, buildXlsx, buildPrintHtml } from '../exporters.js';

const router = Router();
router.use(authenticate);
const dt = (v) => v == null ? null : (v instanceof Date ? v.toISOString() : String(v));
const member = (r) => ({ _id: r.id, id: r.id, memberNo: r.member_no, name: r.name, phone: r.phone, creditBalance: Number(r.credit_balance || 0), points: Number(r.points || 0), rebateBalance: Number(r.rebate_balance || 0), status: r.status, createdAt: dt(r.created_at) });
const voucher = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id, voucherNo: r.voucher_no, code: r.code,
  faceValue: Number(r.face_value || 0), balance: Number(r.balance || 0),
  usedAmount: round2(Number(r.face_value || 0) - Number(r.balance || 0)), status: r.status,
  issuedToMemberId: r.issued_to_member_id == null ? null : String(r.issued_to_member_id),
  issuedToName: r.issued_to_name || null, issuedToPhone: r.issued_to_phone || null,
  soldAmount: Number(r.sold_amount || 0), note: r.note || null,
  issuedAt: dt(r.issued_at), expiresAt: dt(r.expires_at),
  voidedAt: dt(r.voided_at), voidReason: r.void_reason || null,
  createdBy: r.created_by == null ? null : String(r.created_by), createdByName: r.created_by_name || null,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
const voucherTxn = (r) => ({
  _id: r.id, id: r.id, voucherId: String(r.voucher_id), voucherNo: r.voucher_no, code: r.code,
  type: r.type, amount: Number(r.amount || 0), balanceAfter: Number(r.balance_after || 0),
  orderId: r.order_id == null ? null : String(r.order_id), orderNo: r.order_no || null,
  memberId: r.member_id == null ? null : String(r.member_id), reason: r.reason || null,
  createdBy: r.created_by == null ? null : String(r.created_by), createdByName: r.created_by_name || null,
  createdAt: dt(r.created_at),
});
const rebate = (r) => ({
  _id: r.id, id: r.id, memberId: String(r.member_id), memberNo: r.member_no || null, memberName: r.member_name || null,
  type: r.type, amount: Number(r.amount || 0), balanceAfter: Number(r.balance_after || 0),
  orderId: r.order_id == null ? null : String(r.order_id), orderNo: r.order_no || null,
  orderTotal: Number(r.order_total || 0), percent: Number(r.percent || 0),
  reason: r.reason || null, expiresAt: dt(r.expires_at),
  createdBy: r.created_by == null ? null : String(r.created_by), createdByName: r.created_by_name || null,
  createdAt: dt(r.created_at),
});
// 过期自动降级（惰性判断，与 devMode 行为一致）
const voucherStatus = (r) => {
  if (r.status === 'void' || r.status === 'used') return r.status;
  if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return 'expired';
  return r.status === 'active' ? 'active' : r.status;
};
const movement = (r) => ({ _id: r.id, id: r.id, type: r.type, voucherNo: r.voucher_no, payTo: r.pay_to, amount: Number(r.amount || 0), reason: r.reason, method: r.method, createdBy: r.created_by, createdAt: dt(r.created_at) });
const attendance = (r) => ({ _id: r.id, id: r.id, userId: r.user_id, userName: r.user_name, action: r.action, code: r.code, note: r.note || '', time: dt(r.event_time) });
const shift = (r) => ({ _id: r.id, id: r.id, cashierId: r.cashier_id, openAmount: Number(r.open_amount || 0), expectedAmount: Number(r.expected_amount || 0), closeAmount: Number(r.close_amount || 0), difference: Number(r.difference_amount || 0), status: r.status, openedAt: dt(r.created_at), closedAt: dt(r.updated_at) });
const supplier = (r) => ({ _id: r.id, id: r.id, code: r.code, name: r.name, phone: r.phone, contact: r.contact, status: r.status, createdAt: dt(r.created_at) });

router.get('/members', async (req, res) => { const { orgId, storeId } = tenant(req); res.json((await query('SELECT * FROM members WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId])).map(member)); });
router.post('/members', requirePermission('member.create'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO members (org_id,store_id,member_no,name,phone,credit_balance,points) VALUES (?,?,?,?,?,?,?)', [orgId, storeId, b.memberNo || `M${Date.now()}`, b.name || '', b.phone || '', Number(b.creditBalance || 0), Number(b.points || 0)]); res.status(201).json(member(await getRow('SELECT * FROM members WHERE id=?', [id]))); });
router.put('/members/:id', requirePermission('member.create'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; await query('UPDATE members SET member_no=COALESCE(?,member_no),name=COALESCE(?,name),phone=COALESCE(?,phone),status=COALESCE(?,status) WHERE id=? AND org_id=? AND store_id=?', [b.memberNo, b.name, b.phone, b.status, req.params.id, orgId, storeId]); res.json(member(await getRow('SELECT * FROM members WHERE id=?', [req.params.id]))); });
router.post('/members/:id/top-up', requirePermission('member.topup'), async (req, res) => { const { orgId, storeId } = tenant(req); const amount = Number(req.body.amount || 0); const m = await getRow('SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!m || amount <= 0) return res.status(400).json({ error: 'invalid member or amount' }); await query('UPDATE members SET credit_balance=credit_balance+? WHERE id=?', [amount, m.id]); const id = await insert('INSERT INTO member_topups (org_id,store_id,member_id,receipt_no,amount,created_by) VALUES (?,?,?,?,?,?)', [orgId, storeId, m.id, `TU${Date.now()}`, amount, req.user.id]); res.json({ member: member(await getRow('SELECT * FROM members WHERE id=?', [m.id])), topup: await getRow('SELECT * FROM member_topups WHERE id=?', [id]) }); });
router.post('/members/:id/points', requirePermission('member.points'), async (req, res) => { const { orgId, storeId } = tenant(req); const delta = Number(req.body.delta || 0); await query('UPDATE members SET points=GREATEST(0,points+?) WHERE id=? AND org_id=? AND store_id=?', [delta, req.params.id, orgId, storeId]); await insert('INSERT INTO points_ledger (org_id,store_id,member_id,delta,reason,created_by) VALUES (?,?,?,?,?,?)', [orgId, storeId, req.params.id, delta, req.body.reason || 'manual', req.user.id]); res.json(member(await getRow('SELECT * FROM members WHERE id=?', [req.params.id]))); });
router.post('/members/:id/knock-off', requirePermission('payment.settle'), async (req, res) => { const { orgId, storeId } = tenant(req); const amount = Number(req.body.amount || 0); const m = await getRow('SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!m || amount <= 0 || amount > Number(m.credit_balance)) return res.status(400).json({ error: 'invalid amount' }); await query('UPDATE members SET credit_balance=credit_balance-? WHERE id=?', [amount, m.id]); res.json({ member: member(await getRow('SELECT * FROM members WHERE id=?', [m.id])), knockedOff: amount, receiptNo: `RV${Date.now()}` }); });

// ================= 礼券 Gift Voucher =================
// 注意：字面量路由必须排在 /:id 之前
router.get('/vouchers', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const rows = await query('SELECT * FROM vouchers WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId]);
  // 用数据库行的 expires_at 计算生效状态，覆盖 mapper 里的原始 status
  let list = rows.map((r) => ({ ...voucher(r), status: voucherStatus(r) }));
  if (req.query.status && req.query.status !== 'all') list = list.filter((v) => v.status === req.query.status);
  if (req.query.memberId) list = list.filter((v) => String(v.issuedToMemberId) === String(req.query.memberId));
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) list = list.filter((v) => [v.code, v.voucherNo, v.issuedToName, v.issuedToPhone].some((f) => String(f || '').toLowerCase().includes(q)));
  res.json(list);
});
router.get('/vouchers/summary', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const rows = await query('SELECT * FROM vouchers WHERE org_id=? AND store_id=?', [orgId, storeId]);
  let outstanding = 0, faceIssued = 0, redeemed = 0;
  const byStatus = {};
  for (const r of rows) {
    const st = voucherStatus(r);
    byStatus[st] = (byStatus[st] || 0) + 1;
    faceIssued += Number(r.face_value || 0);
    redeemed += Number(r.face_value || 0) - Number(r.balance || 0);
    if (st === 'active') outstanding += Number(r.balance || 0);
  }
  res.json({ count: rows.length, outstandingBalance: round2(outstanding), faceIssued: round2(faceIssued), redeemedTotal: round2(redeemed), byStatus });
});
router.get('/vouchers/lookup', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const code = String(req.query.code || '').trim();
  const r = await getRow('SELECT * FROM vouchers WHERE org_id=? AND store_id=? AND UPPER(code)=UPPER(?)', [orgId, storeId, code]);
  if (!r) return res.status(404).json({ error: 'voucher not found' });
  const st = voucherStatus(r);
  const amount = Number(req.query.amount || 0);
  const txns = await query('SELECT * FROM voucher_txns WHERE voucher_id=? ORDER BY id DESC LIMIT 5', [r.id]);
  res.json({
    voucher: { ...voucher(r), status: st }, status: st,
    redeemable: st === 'active' && Number(r.balance) > 0,
    maxRedeemable: st === 'active' ? round2(r.balance) : 0,
    suggestedAmount: amount > 0 ? Math.min(round2(amount), round2(r.balance)) : round2(r.balance),
    recentTxns: txns.map(voucherTxn).reverse(),
  });
});
router.get('/vouchers/:id', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const r = await getRow('SELECT * FROM vouchers WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!r) return res.status(404).json({ error: 'not found' });
  const txns = await query('SELECT * FROM voucher_txns WHERE voucher_id=? ORDER BY id', [r.id]);
  res.json({ ...voucher(r), status: voucherStatus(r), txns: txns.map(voucherTxn) });
});
router.get('/vouchers/:id/txns', async (req, res) => {
  const rows = await query('SELECT * FROM voucher_txns WHERE voucher_id=? ORDER BY id', [req.params.id]);
  res.json(rows.map(voucherTxn));
});
router.post('/vouchers', requirePermission('member.voucher_issue'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const b = req.body || {};
  const face = round2(b.faceValue);
  if (!(face > 0)) return res.status(400).json({ error: 'faceValue must be positive' });
  let code = String(b.code || '').trim();
  if (!code) {
    const s = await loadSettings(orgId, storeId);
    const prefix = s.voucherPrefix || 'GV';
    const maxRow = await getRow("SELECT MAX(CAST(SUBSTRING_INDEX(code,'-',-1) AS UNSIGNED)) AS mx FROM vouchers WHERE org_id=? AND store_id=?", [orgId, storeId]);
    code = `${prefix}-${Math.max(1000, Number(maxRow?.mx || 0)) + 1}`;
  }
  const dupe = await getRow('SELECT id FROM vouchers WHERE org_id=? AND store_id=? AND UPPER(code)=UPPER(?)', [orgId, storeId, code]);
  if (dupe) return res.status(409).json({ error: 'voucher code already exists' });
  const seq = (await getRow('SELECT COUNT(*) AS n FROM vouchers WHERE org_id=? AND store_id=?', [orgId, storeId]))?.n || 0;
  const voucherNo = b.voucherNo || `${(await loadSettings(orgId, storeId)).voucherPrefix || 'GV'}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(Number(seq) + 1).padStart(3, '0')}`;
  const id = await insert(
    'INSERT INTO vouchers (org_id,store_id,voucher_no,code,face_value,balance,status,issued_to_member_id,issued_to_name,issued_to_phone,sold_amount,note,expires_at,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, voucherNo, code, face, b.balance !== undefined ? round2(b.balance) : face, 'active',
     b.issuedToMemberId || null, b.issuedToName || null, b.issuedToPhone || null,
     b.soldAmount !== undefined ? round2(b.soldAmount) : face, b.note || null, b.expiresAt || null,
     req.user.id, req.user.name || null]
  );
  const row = await getRow('SELECT * FROM vouchers WHERE id=?', [id]);
  await insert(
    'INSERT INTO voucher_txns (org_id,store_id,voucher_id,voucher_no,code,type,amount,balance_after,member_id,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, id, voucherNo, code, 'issue', face, Number(row.balance), b.issuedToMemberId || null, b.note || 'voucher issued', req.user.id, req.user.name || null]
  );
  res.status(201).json(voucher(row));
});
router.post('/vouchers/:id/redeem', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const r = await getRow('SELECT * FROM vouchers WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!r) return res.status(404).json({ error: 'not found' });
  const st = voucherStatus(r);
  if (st === 'void') return res.status(400).json({ error: 'voucher is void' });
  if (st === 'expired') return res.status(400).json({ error: 'voucher expired' });
  const amt = round2(req.body.amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'amount must be positive' });
  if (amt > Number(r.balance) + 0.001) return res.status(400).json({ error: `amount exceeds balance ${round2(r.balance)}` });
  const newBalance = round2(Number(r.balance) - amt);
  const newStatus = newBalance <= 0 ? 'used' : r.status;
  await query('UPDATE vouchers SET balance=?, status=?, updated_at=NOW() WHERE id=?', [newBalance, newStatus, r.id]);
  const txnId = await insert(
    'INSERT INTO voucher_txns (org_id,store_id,voucher_id,voucher_no,code,type,amount,balance_after,order_id,order_no,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, r.id, r.voucher_no, r.code, 'redeem', amt, newBalance, req.body.orderId || null, req.body.orderNo || null, req.body.reason || 'redeemed at cashier', req.user.id, req.user.name || null]
  );
  res.json({ voucher: voucher(await getRow('SELECT * FROM vouchers WHERE id=?', [r.id])), txn: voucherTxn(await getRow('SELECT * FROM voucher_txns WHERE id=?', [txnId])) });
});
router.post('/vouchers/:id/void', requirePermission('member.voucher_void'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const r = await getRow('SELECT * FROM vouchers WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (r.status === 'void') return res.status(400).json({ error: 'already void' });
  const had = Number(r.balance || 0);
  const reason = req.body.reason || 'voided by staff';
  await query("UPDATE vouchers SET status='void', balance=0, voided_at=NOW(), void_reason=?, updated_at=NOW() WHERE id=?", [reason, r.id]);
  await insert(
    'INSERT INTO voucher_txns (org_id,store_id,voucher_id,voucher_no,code,type,amount,balance_after,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, r.id, r.voucher_no, r.code, 'void', had, 0, reason, req.user.id, req.user.name || null]
  );
  res.json(voucher(await getRow('SELECT * FROM vouchers WHERE id=?', [r.id])));
});

// ================= 返利 Rebate =================
router.get('/rebates', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const params = [orgId, storeId];
  let sql = 'SELECT * FROM rebates WHERE org_id=? AND store_id=?';
  if (req.query.memberId) { sql += ' AND member_id=?'; params.push(req.query.memberId); }
  if (req.query.type) { sql += ' AND type=?'; params.push(req.query.type); }
  sql += ' ORDER BY id DESC LIMIT 500';
  res.json((await query(sql, params)).map(rebate));
});
router.get('/rebates/summary', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const rows = await query('SELECT * FROM rebates WHERE org_id=? AND store_id=?', [orgId, storeId]);
  const earned = rows.filter((r) => r.type === 'earn').reduce((s, r) => s + Number(r.amount || 0), 0);
  const redeemed = rows.filter((r) => r.type === 'redeem').reduce((s, r) => s + Number(r.amount || 0), 0);
  const bal = await getRow('SELECT COALESCE(SUM(rebate_balance),0) AS total, SUM(CASE WHEN rebate_balance>0 THEN 1 ELSE 0 END) AS n FROM members WHERE org_id=? AND store_id=?', [orgId, storeId]);
  res.json({ earnedTotal: round2(earned), redeemedTotal: round2(redeemed), outstandingBalance: round2(bal?.total || 0), entries: rows.length, membersWithRebate: Number(bal?.n || 0) });
});
router.post('/rebates', requirePermission('member.rebate'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const b = req.body || {};
  const m = await getRow('SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?', [b.memberId, orgId, storeId]);
  if (!m) return res.status(404).json({ error: 'member not found' });
  const amt = round2(b.amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'amount must be positive' });
  const type = b.type === 'redeem' ? 'redeem' : 'earn';
  if (type === 'redeem' && amt > Number(m.rebate_balance || 0) + 0.001) return res.status(400).json({ error: 'insufficient rebate balance' });
  const delta = type === 'redeem' ? -amt : amt;
  await query('UPDATE members SET rebate_balance=GREATEST(0, rebate_balance+?) WHERE id=?', [delta, m.id]);
  const after = Number((await getRow('SELECT rebate_balance FROM members WHERE id=?', [m.id])).rebate_balance);
  const id = await insert(
    'INSERT INTO rebates (org_id,store_id,member_id,member_no,member_name,type,amount,balance_after,reason,expires_at,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, m.id, m.member_no, m.name, type, amt, after, b.reason || 'manual adjustment', b.expiresAt || null, req.user.id, req.user.name || null]
  );
  res.status(201).json({ member: member(await getRow('SELECT * FROM members WHERE id=?', [m.id])), entry: rebate(await getRow('SELECT * FROM rebates WHERE id=?', [id])) });
});
router.post('/members/:id/rebate', requirePermission('member.rebate'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const m = await getRow('SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!m) return res.status(404).json({ error: 'member not found' });
  const amt = round2(req.body.amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'amount must be positive' });
  const type = req.body.type === 'redeem' ? 'redeem' : 'earn';
  if (type === 'redeem' && amt > Number(m.rebate_balance || 0) + 0.001) return res.status(400).json({ error: 'insufficient rebate balance' });
  const delta = type === 'redeem' ? -amt : amt;
  await query('UPDATE members SET rebate_balance=GREATEST(0, rebate_balance+?) WHERE id=?', [delta, m.id]);
  const after = Number((await getRow('SELECT rebate_balance FROM members WHERE id=?', [m.id])).rebate_balance);
  const id = await insert(
    'INSERT INTO rebates (org_id,store_id,member_id,member_no,member_name,type,amount,balance_after,order_id,order_no,reason,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, m.id, m.member_no, m.name, type, amt, after, req.body.orderId || null, req.body.orderNo || null,
     req.body.reason || (type === 'earn' ? 'manual rebate' : 'rebate redeemed'), req.user.id, req.user.name || null]
  );
  res.json({ member: member(await getRow('SELECT * FROM members WHERE id=?', [m.id])), entry: rebate(await getRow('SELECT * FROM rebates WHERE id=?', [id])) });
});
router.get('/members/:id/rebate-ledger', async (req, res) => {
  const rows = await query('SELECT * FROM rebates WHERE member_id=? ORDER BY id DESC LIMIT 200', [req.params.id]);
  res.json(rows.map(rebate));
});

router.get('/finance/movements', async (req, res) => { const { orgId, storeId } = tenant(req); res.json((await query('SELECT * FROM cash_movements WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId])).map(movement)); });
router.post('/finance/movements', requirePermission('payment.cash_move'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO cash_movements (org_id,store_id,type,voucher_no,pay_to,amount,reason,method,created_by) VALUES (?,?,?,?,?,?,?,?,?)', [orgId, storeId, b.type || 'cash_in', b.voucherNo || `V${Date.now()}`, b.payTo || '', Number(b.amount || 0), b.reason || '', b.method || 'cash', req.user.id]); res.status(201).json(movement(await getRow('SELECT * FROM cash_movements WHERE id=?', [id]))); });
// ---- 门店设置读取 ----
async function loadSettings(orgId, storeId) {
  const rows = await query('SELECT setting_key,setting_value FROM app_settings WHERE org_id=? AND store_id=?', [orgId, storeId]);
  const s = {};
  for (const r of rows) { try { s[r.setting_key] = JSON.parse(r.setting_value); } catch { s[r.setting_key] = r.setting_value; } }
  return s;
}
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const toCreditNote = (r) => ({
  _id: r.id, id: r.id, creditNo: r.credit_no, customerName: r.customer_name, orderNo: r.order_no,
  date: dt(r.created_at), reason: r.reason, includeGst: !!r.include_gst, gst: !!r.include_gst,
  items: parseJSON(r.items), subtotal: Number(r.subtotal || 0), gstAmount: Number(r.gst_amount || 0),
  total: Number(r.total || 0), taxRate: Number(r.tax_rate || 0), status: r.status, restock: !!r.restock,
  postedAt: dt(r.posted_at), createdAt: dt(r.created_at),
});

// ---- Credit Note（含行项目 / GST / 过账回库） ----
router.get('/finance/credit-notes', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  res.json((await query('SELECT * FROM credit_notes WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId])).map(toCreditNote));
});
router.get('/finance/credit-notes/:id', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const r = await getRow('SELECT * FROM credit_notes WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(toCreditNote(r));
});
router.post('/finance/credit-notes', requirePermission('payment.credit_note'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const b = req.body || {};
  const s = await loadSettings(orgId, storeId);
  const rate = Number(s.taxRate || 0) / 100;
  const lines = (b.items || []).map((i) => {
    const qty = Number(i.qty || 0);
    const retail = Number(i.retail ?? i.unitPrice ?? 0);
    return { code: i.code || '', barcode: i.barcode || '', description: i.description || i.name || '', location: i.location || '', qty, uom: i.uom || 'pcs', retail, cost: Number(i.cost || 0), subtotal: round2(qty * retail) };
  });
  const subtotal = round2(lines.reduce((x, l) => x + l.subtotal, 0));
  const includeGst = !!b.includeGst;
  const gstAmount = includeGst ? (s.taxInclusive ? round2(subtotal - subtotal / (1 + rate)) : round2(subtotal * rate)) : 0;
  const total = includeGst && !s.taxInclusive ? round2(subtotal + gstAmount) : subtotal;
  const id = await insert(
    'INSERT INTO credit_notes (org_id,store_id,credit_no,customer_name,order_no,reason,gst,include_gst,items,subtotal,gst_amount,total,tax_rate,restock,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [orgId, storeId, b.creditNo || `CN${Date.now()}`, b.customerName || '', b.orderNo || '', b.reason || '', includeGst ? 1 : 0, includeGst ? 1 : 0, stringifyJSON(lines), subtotal, gstAmount, total, Number(s.taxRate || 0), b.restock === false ? 0 : 1, req.user.id]
  );
  res.status(201).json(toCreditNote(await getRow('SELECT * FROM credit_notes WHERE id=?', [id])));
});
router.post('/finance/credit-notes/:id/post', requirePermission('payment.credit_note'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const r = await getRow('SELECT * FROM credit_notes WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (r.status !== 'open') return res.status(400).json({ error: 'already posted' });
  if (r.restock) {
    for (const l of parseJSON(r.items)) {
      await query('UPDATE menu_variants SET stock_qty=stock_qty+? WHERE org_id=? AND store_id=? AND (code=? OR (barcode IS NOT NULL AND barcode=?))', [Number(l.qty || 0), orgId, storeId, l.code || '', l.barcode || '']);
    }
  }
  await query('UPDATE credit_notes SET status="posted",posted_at=NOW() WHERE id=?', [r.id]);
  res.json(toCreditNote(await getRow('SELECT * FROM credit_notes WHERE id=?', [r.id])));
});
router.delete('/finance/credit-notes/:id', requirePermission('payment.credit_note'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const r = await getRow('SELECT * FROM credit_notes WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  if (r && r.status === 'posted') return res.status(400).json({ error: 'posted note cannot be deleted' });
  await query('DELETE FROM credit_notes WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]);
  res.json({ ok: true });
});

// ---- 日结 Day End ----
async function dayEndSummary(orgId, storeId, dateStr) {
  const s = await loadSettings(orgId, storeId);
  const day = dateStr || new Date().toISOString().slice(0, 10);
  const paid = await query('SELECT subtotal,discount,service_charge,tax,total FROM orders WHERE org_id=? AND store_id=? AND status IN ("paid","refunded") AND DATE(created_at)=?', [orgId, storeId, day]);
  const voids = await query('SELECT total FROM orders WHERE org_id=? AND store_id=? AND status="void" AND DATE(created_at)=?', [orgId, storeId, day]);
  const byMethodRows = await query('SELECT p.method,SUM(p.amount) AS amount FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.org_id=? AND p.store_id=? AND DATE(o.created_at)=? GROUP BY p.method', [orgId, storeId, day]);
  const byMethod = {}; for (const r of byMethodRows) byMethod[r.method] = round2(r.amount);
  const movRows = await query('SELECT type,SUM(amount) AS amount FROM cash_movements WHERE org_id=? AND store_id=? AND DATE(created_at)=? GROUP BY type', [orgId, storeId, day]);
  const mov = {}; for (const r of movRows) mov[r.type] = round2(r.amount);
  const shiftRow = await getRow('SELECT COALESCE(SUM(open_amount),0) AS opening FROM shifts WHERE org_id=? AND store_id=? AND DATE(created_at)=?', [orgId, storeId, day]);
  const refundRow = await getRow('SELECT COALESCE(SUM(amount),0) AS refunded FROM refunds WHERE org_id=? AND store_id=? AND DATE(created_at)=?', [orgId, storeId, day]);
  const unsettleRow = await getRow('SELECT COALESCE(SUM(amount),0) AS unsettled FROM unsettles WHERE org_id=? AND store_id=? AND DATE(created_at)=?', [orgId, storeId, day]);
  const cnRow = await getRow('SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS amount FROM credit_notes WHERE org_id=? AND store_id=? AND DATE(created_at)=?', [orgId, storeId, day]);
  const closed = await getRow('SELECT id FROM day_ends WHERE org_id=? AND store_id=? AND end_date=?', [orgId, storeId, day]);
  const sum = (f) => round2(paid.reduce((x, o) => x + Number(o[f] || 0), 0));
  const opening = round2(shiftRow?.opening);
  const salesCash = byMethod.cash || 0;
  const tax = sum('tax');
  const net = sum('total');
  const refunded = round2(refundRow?.refunded);
  const rate = Number(s.taxRate || 0);
  const refundTax = rate ? round2(refunded * (rate / (100 + rate))) : 0;
  return {
    date: day, status: closed ? 'closed' : 'open',
    sales: { orders: paid.length, gross: sum('subtotal'), discount: sum('discount'), serviceCharge: sum('service_charge'), tax, net, refunded, unsettled: round2(unsettleRow?.unsettled), voids: voids.length, voidAmount: round2(voids.reduce((x, o) => x + Number(o.total || 0), 0)) },
    byMethod,
    cash: { opening, cashIn: mov.cash_in || 0, withdraw: mov.withdraw || 0, payout: mov.payout || 0, received: mov.received || 0, salesCash, expected: round2(opening + (mov.cash_in || 0) + salesCash + (mov.received || 0) - (mov.withdraw || 0) - (mov.payout || 0)), counted: null, difference: null },
    gst: { taxRate: rate, taxInclusive: !!s.taxInclusive, taxableSales: net, outputTax: tax, refundTax, netTax: round2(tax - refundTax) },
    creditNotes: { count: Number(cnRow?.c || 0), amount: round2(cnRow?.amount) },
    closedAt: null, closedBy: null, note: '',
  };
}
router.get('/reports/day-end', requirePermission('report.view'), async (req, res) => { const { orgId, storeId } = tenant(req); res.json(await dayEndSummary(orgId, storeId, req.query.date)); });
router.get('/reports/day-end/history', requirePermission('report.view'), async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT id,end_date,snapshot,counted_cash,expected_cash,difference,note,created_at FROM day_ends WHERE org_id=? AND store_id=? ORDER BY end_date DESC', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, date: dt(r.end_date), snapshot: parseJSON(r.snapshot), countedCash: Number(r.counted_cash || 0), expectedCash: Number(r.expected_cash || 0), difference: Number(r.difference || 0), note: r.note, closedAt: dt(r.created_at) }))); });
router.get('/reports/day-end/:id', requirePermission('report.view'), async (req, res) => { const { orgId, storeId } = tenant(req); const r = await getRow('SELECT * FROM day_ends WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!r) return res.status(404).json({ error: 'not found' }); res.json({ _id: r.id, id: r.id, date: dt(r.end_date), snapshot: parseJSON(r.snapshot), countedCash: Number(r.counted_cash || 0), expectedCash: Number(r.expected_cash || 0), difference: Number(r.difference || 0), note: r.note, closedAt: dt(r.created_at) }); });
router.post('/reports/day-end/close', requirePermission('day_end'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const date = req.body?.date || new Date().toISOString().slice(0, 10);
  const existing = await getRow('SELECT id FROM day_ends WHERE org_id=? AND store_id=? AND end_date=?', [orgId, storeId, date]);
  if (existing) return res.status(400).json({ error: 'day already closed' });
  const summary = await dayEndSummary(orgId, storeId, date);
  const counted = round2(req.body?.countedCash || 0);
  summary.cash.counted = counted;
  summary.cash.difference = round2(counted - summary.cash.expected);
  summary.status = 'closed'; summary.closedAt = new Date().toISOString(); summary.closedBy = req.user.name;
  summary.note = req.body?.note || '';
  const id = await insert('INSERT INTO day_ends (org_id,store_id,end_date,snapshot,counted_cash,expected_cash,difference,note,closed_by) VALUES (?,?,?,?,?,?,?,?,?)', [orgId, storeId, date, stringifyJSON(summary), counted, summary.cash.expected, summary.cash.difference, summary.note, req.user.id]);
  res.status(201).json({ id, ...summary });
});

router.get('/attendance', async (req, res) => { const { orgId, storeId } = tenant(req); res.json((await query('SELECT * FROM attendance_records WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId])).map(attendance)); });
router.post('/attendance', requirePermission('shift.manage'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO attendance_records (org_id,store_id,user_id,user_name,action,code,note) VALUES (?,?,?,?,?,?,?)', [orgId, storeId, req.user.id, req.user.name, b.action || 'sign_in', b.code || '', b.note || '']); res.status(201).json(attendance(await getRow('SELECT * FROM attendance_records WHERE id=?', [id]))); });

router.get('/shifts/current', async (req, res) => { const { orgId, storeId } = tenant(req); let s = await getRow('SELECT * FROM shifts WHERE org_id=? AND store_id=? AND status="open" ORDER BY id DESC LIMIT 1', [orgId, storeId]); if (!s) { const id = await insert('INSERT INTO shifts (org_id,store_id,cashier_id,open_amount,status) VALUES (?,?,?,?,?)', [orgId, storeId, req.user.id, 0, 'open']); s = await getRow('SELECT * FROM shifts WHERE id=?', [id]); } const paid = await query('SELECT * FROM orders WHERE org_id=? AND store_id=? AND status="paid" AND shift_id=?', [orgId, storeId, s.id]); const expected = Number(s.open_amount || 0) + paid.reduce((a, o) => a + Number(o.total || 0), 0); await query('UPDATE shifts SET expected_amount=? WHERE id=?', [expected, s.id]); s.expected_amount = expected; res.json({ shift: shift(s), paidOrders: paid, byMethod: {} }); });
router.post('/shifts/open', requirePermission('shift.manage'), async (req, res) => { const { orgId, storeId } = tenant(req); const id = await insert('INSERT INTO shifts (org_id,store_id,cashier_id,open_amount,status) VALUES (?,?,?,?,?)', [orgId, storeId, req.user.id, Number(req.body.openAmount || 0), 'open']); res.status(201).json(shift(await getRow('SELECT * FROM shifts WHERE id=?', [id]))); });
router.post('/shifts/:id/close', requirePermission('shift.manage'), async (req, res) => { const { orgId, storeId } = tenant(req); const s = await getRow('SELECT * FROM shifts WHERE id=? AND org_id=? AND store_id=? AND status="open"', [req.params.id, orgId, storeId]); if (!s) return res.status(404).json({ error: 'open shift not found' }); const paid = await query('SELECT total FROM orders WHERE shift_id=? AND status="paid"', [s.id]); const expected = Number(s.open_amount || 0) + paid.reduce((a, o) => a + Number(o.total || 0), 0); const counted = Number(req.body.closeAmount || 0); await query('UPDATE shifts SET expected_amount=?,close_amount=?,difference_amount=?,status="closed" WHERE id=?', [expected, counted, counted - expected, s.id]); res.json(shift(await getRow('SELECT * FROM shifts WHERE id=?', [s.id]))); });

router.get('/suppliers', async (req, res) => { const { orgId, storeId } = tenant(req); res.json((await query('SELECT * FROM suppliers WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId])).map(supplier)); });
router.post('/suppliers', requirePermission('stock.purchase'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO suppliers (org_id,store_id,code,name,phone,contact) VALUES (?,?,?,?,?,?)', [orgId, storeId, b.code || `SUP-${Date.now()}`, b.name || '', b.phone || '', b.contact || '']); res.status(201).json(supplier(await getRow('SELECT * FROM suppliers WHERE id=?', [id]))); });
router.get('/purchases', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM purchase_orders WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, poNo: r.po_no, supplierId: r.supplier_id, items: parseJSON(r.items), total: Number(r.total || 0), status: r.status, createdAt: dt(r.created_at) }))); });
router.post('/purchases', requirePermission('stock.purchase'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO purchase_orders (org_id,store_id,po_no,supplier_id,items,total) VALUES (?,?,?,?,?,?)', [orgId, storeId, b.poNo || `PO${Date.now()}`, b.supplierId || null, stringifyJSON(b.items || []), Number(b.total || 0)]); res.status(201).json(await getRow('SELECT * FROM purchase_orders WHERE id=?', [id])); });
router.post('/purchases/:id/receive', requirePermission('stock.purchase'), async (req, res) => { const { orgId, storeId } = tenant(req); const p = await getRow('SELECT * FROM purchase_orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!p) return res.status(404).json({ error: 'not found' }); const items = parseJSON(p.items); for (const item of items) await query('UPDATE inventory_items SET quantity=quantity+? WHERE id=? AND org_id=? AND store_id=?', [Number(item.qty || 0), Number(item.itemId), orgId, storeId]); await query('UPDATE purchase_orders SET status="received",received_at=NOW() WHERE id=?', [p.id]); res.json(await getRow('SELECT * FROM purchase_orders WHERE id=?', [p.id])); });

// ===========================================================================
// 报表中心:目录 / 查询 / 导出
// 与 devMode 共用 reportEngine + reportCatalog,保证两种后端报表口径完全一致。
// ===========================================================================

/** 把 MySQL 数据整理成 reportEngine 的统一 dataset。 */
async function buildReportDataset(orgId, storeId) {
  const safe = async (sql, params) => { try { return await query(sql, params); } catch { return []; } };
  const [orders, payments, refunds, unsettles, cashMovements, shifts, members, memberTopups, pointsLedger,
    invoices, creditNotes, variants, categories, customerStock, stockTakes, suppliers, purchaseOrders,
    attendanceRows, reprintLogs, dayEnds, orderTransfers, vouchers, voucherTxns, rebates, settings] = await Promise.all([
    query('SELECT o.*, t.number AS table_no, u.name AS cashier_name, sp.name AS sales_person_name, m.member_no, m.name AS member_name FROM orders o LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.created_by LEFT JOIN users sp ON sp.id=o.sales_person_id LEFT JOIN members m ON m.id=o.member_id WHERE o.org_id=? AND o.store_id=?', [orgId, storeId]),
    query('SELECT * FROM payments WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM refunds WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM unsettles WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM cash_movements WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM shifts WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM members WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM member_topups WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM points_ledger WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM invoices WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM credit_notes WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT v.*, c.name AS category_name, c.station AS station FROM menu_variants v LEFT JOIN menu_bases b ON b.id=v.base_id LEFT JOIN menu_categories c ON c.id=b.category_id WHERE v.org_id=? AND v.store_id=?', [orgId, storeId]),
    query('SELECT * FROM menu_categories WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM customer_stock WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM stock_takes WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM suppliers WHERE org_id=? AND store_id=?', [orgId, storeId]),
    query('SELECT * FROM purchase_orders WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM attendance WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM reprint_logs WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM day_ends WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM order_transfers WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM vouchers WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM voucher_txns WHERE org_id=? AND store_id=?', [orgId, storeId]),
    safe('SELECT * FROM rebates WHERE org_id=? AND store_id=?', [orgId, storeId]),
    loadSettings(orgId, storeId),
  ]);

  const variantById = new Map(variants.map((v) => [String(v.id), v]));
  const decorate = (it) => {
    const v = variantById.get(String(it.variantId || it.itemId));
    const qty = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    return {
      ...it, qty, unitPrice,
      code: it.code || (v ? v.code : ''),
      name: it.name || (v ? v.name : ''),
      amount: qty * unitPrice,
      category: (v && v.category_name) || 'Uncategorised',
      station: (v && v.station) || 'Kitchen',
    };
  };

  return {
    orders: orders.map((o) => ({
      id: o.id, orderNo: o.order_no, createdAt: dt(o.created_at), status: o.status, type: o.type,
      tableNo: o.table_no, cashierName: o.cashier_name || 'Unknown', salesPersonName: o.sales_person_name || o.cashier_name || 'Unknown',
      memberNo: o.member_no || null, memberName: o.member_name || null,
      discountType: o.discount_type || null, voidReason: o.void_reason || null,
      items: parseJSON(o.items).map(decorate),
      subtotal: Number(o.subtotal || 0), discount: Number(o.discount || 0),
      serviceCharge: Number(o.service_charge || 0), tax: Number(o.tax || 0), total: Number(o.total || 0),
    })),
    payments: payments.map((p) => ({ ...p, orderId: p.order_id, createdAt: dt(p.created_at), amount: Number(p.amount || 0) })),
    refunds: refunds.map((r) => ({ ...r, refundNo: r.refund_no, orderNo: r.order_no, createdAt: dt(r.created_at), amount: Number(r.amount || 0), reason: r.reason || '' })),
    unsettles: unsettles.map((u) => ({ ...u, orderNo: u.order_no, createdAt: dt(u.created_at), amount: Number(u.amount || 0) })),
    cashMovements: cashMovements.map((m) => ({ ...m, voucherNo: m.voucher_no, payTo: m.pay_to, createdAt: dt(m.created_at), amount: Number(m.amount || 0) })),
    shifts: shifts.map((s) => ({ id: s.id, openedAt: dt(s.created_at), closedAt: s.status === 'closed' ? dt(s.updated_at) : null, openAmount: Number(s.open_amount || 0), expectedAmount: Number(s.expected_amount || 0), closeAmount: Number(s.close_amount || 0), difference: Number(s.difference_amount || 0), status: s.status })),
    members: members.map((m) => ({ ...m, memberNo: m.member_no, points: Number(m.points || 0), creditBalance: Number(m.credit_balance || 0), rebateBalance: Number(m.rebate_balance || 0) })),
    memberTopups: memberTopups.map((t) => ({ ...t, memberId: t.member_id, receiptNo: t.receipt_no, createdAt: dt(t.created_at), amount: Number(t.amount || 0) })),
    pointsLedger: pointsLedger.map((p) => ({ ...p, memberId: p.member_id, createdAt: dt(p.created_at) })),
    invoices: invoices.map((v) => ({ ...v, orderId: v.order_id, invoiceNo: v.invoice_no, createdAt: dt(v.created_at), amount: Number(v.amount || 0), tax: Number(v.tax || 0) })),
    creditNotes: creditNotes.map((c) => ({ ...c, creditNo: c.credit_no, customerName: c.customer_name, orderNo: c.order_no, status: c.status, createdAt: dt(c.created_at), total: Number(c.total || 0), items: parseJSON(c.items) })),
    variants: variants.map((v) => ({ ...v, stockQty: Number(v.stock_qty || 0), stockThreshold: Number(v.stock_threshold || 0), cost: Number(v.cost || 0), price: Number(v.price || 0) })),
    customerStock: customerStock.map((c) => ({ ...c, memberNo: c.member_no, itemName: c.item_name, qty: Number(c.qty || 0) })),
    stockTakes: stockTakes.map((s) => ({ ...s, takeNo: s.take_no, createdAt: dt(s.created_at), lines: parseJSON(s.lines) })),
    suppliers: suppliers.map((s) => ({ ...s, id: s.id })),
    purchaseOrders: purchaseOrders.map((p) => ({ ...p, poNo: p.po_no, supplierId: p.supplier_id, createdAt: dt(p.created_at), total: Number(p.total || 0) })),
    attendance: attendanceRows.map((a) => ({ ...a, userName: a.user_name, time: dt(a.event_time || a.created_at) })),
    reprintLogs: reprintLogs.map((l) => ({ ...l, orderNo: l.order_no, kind: l.kind, createdAt: dt(l.created_at) })),
    dayEnds: dayEnds.map((d) => ({ date: d.end_date instanceof Date ? d.end_date.toISOString().slice(0, 10) : String(d.end_date).slice(0, 10), expectedCash: Number(d.expected_cash || 0), countedCash: Number(d.counted_cash || 0), difference: Number(d.difference || 0), closedAt: dt(d.created_at) })),
    orderTransfers: orderTransfers.map((t) => ({ ...t, orderNo: t.order_no, fromTableNo: t.from_table_no, toTableNo: t.to_table_no, mergedOrderNos: parseJSON(t.merged_order_nos) || [], amount: Number(t.amount || 0), createdByName: t.created_by_name, createdAt: dt(t.created_at) })),
    vouchers: vouchers.map((v) => ({ ...v, voucherNo: v.voucher_no, faceValue: Number(v.face_value || 0), balance: Number(v.balance || 0), usedAmount: round2(Number(v.face_value || 0) - Number(v.balance || 0)), issuedToName: v.issued_to_name, issuedToPhone: v.issued_to_phone, soldAmount: Number(v.sold_amount || 0), issuedAt: dt(v.issued_at), expiresAt: v.expires_at ? dt(v.expires_at) : null, createdByName: v.created_by_name })),
    voucherTxns: voucherTxns.map((t) => ({ ...t, voucherId: t.voucher_id, voucherNo: t.voucher_no, memberId: t.member_id, orderNo: t.order_no, amount: Number(t.amount || 0), balanceAfter: Number(t.balance_after || 0), createdByName: t.created_by_name, createdAt: dt(t.created_at) })),
    rebates: rebates.map((r) => ({ ...r, memberId: r.member_id, memberNo: r.member_no, memberName: r.member_name, orderNo: r.order_no, amount: Number(r.amount || 0), balanceAfter: Number(r.balance_after || 0), orderTotal: Number(r.order_total || 0), percent: Number(r.percent || 0), createdByName: r.created_by_name, createdAt: dt(r.created_at) })),
    settings,
  };
}

router.get('/reports/catalog', requirePermission('report.view'), (req, res) => res.json({ categories: REPORT_CATEGORIES, reports: REPORT_CATALOG }));

router.get('/reports/query', requirePermission('report.view'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const ds = await buildReportDataset(orgId, storeId);
  res.json(runReport(req.query.type || 'sales_by_date', ds, { from: req.query.from, to: req.query.to }));
});

router.get('/reports/export', requirePermission('report.export'), async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const type = req.query.type || 'sales_by_date';
  const format = String(req.query.format || 'csv').toLowerCase();
  const from = req.query.from || null;
  const to = req.query.to || null;
  const ds = await buildReportDataset(orgId, storeId);
  const result = runReport(type, ds, { from, to });
  const columns = reportColumns(type, result.rows);
  const title = reportTitle(type);
  const rangeLabel = from || to ? `${from || '...'} → ${to || '...'}` : 'All dates';
  const meta = [['Report', title], ['Period', rangeLabel], ['Store', ds.settings.companyName || '-'], ['Rows', result.rows.length]];
  const fileBase = `${type}_${new Date().toISOString().slice(0, 10)}`;

  if (format === 'xlsx' || format === 'excel') {
    const buf = buildXlsx(title, columns, result.rows, { title, subtitle: rangeLabel });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.end(buf);
  }
  if (format === 'html' || format === 'pdf') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(buildPrintHtml({ title, subtitle: `${rangeLabel} · ${ds.settings.companyName || ''}`, columns, rows: result.rows, meta }));
  }
  const csv = buildCsv(columns, result.rows, { Report: title, Period: rangeLabel, Store: ds.settings.companyName || '' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
  res.end(csv);
});


// ---- 门店设置 / GST ----
router.get('/settings', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT setting_key,setting_value FROM app_settings WHERE org_id=? AND store_id=?', [orgId, storeId]); const o = {}; for (const r of rows) { try { o[r.setting_key] = JSON.parse(r.setting_value); } catch { o[r.setting_key] = r.setting_value; } } res.json(o); });
router.put('/settings', requirePermission('settings.edit'), async (req, res) => { const { orgId, storeId } = tenant(req); for (const [k, v] of Object.entries(req.body || {})) { await query('INSERT INTO app_settings (org_id,store_id,setting_key,setting_value) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [orgId, storeId, k, JSON.stringify(v)]); } const rows = await query('SELECT setting_key,setting_value FROM app_settings WHERE org_id=? AND store_id=?', [orgId, storeId]); const o = {}; for (const r of rows) { try { o[r.setting_key] = JSON.parse(r.setting_value); } catch { o[r.setting_key] = r.setting_value; } } res.json(o); });

// ---- 发票 / Tax Invoice ----
router.get('/orders/:id/invoice', async (req, res) => { const { orgId, storeId } = tenant(req); const o = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!o) return res.status(404).json({ error: 'not found' }); const setRows = await query('SELECT setting_key,setting_value FROM app_settings WHERE org_id=? AND store_id=?', [orgId, storeId]); const s = {}; for (const r of setRows) { try { s[r.setting_key] = JSON.parse(r.setting_value); } catch { s[r.setting_key] = r.setting_value; } } const payments = await query('SELECT method,amount FROM payments WHERE order_id=?', [o.id]); res.json({ invoiceNo: o.invoice_no || `DRAFT-${o.order_no}`, orderNo: o.order_no, date: dt(o.created_at), status: o.status, seller: { name: s.companyName, address: s.address, phone: s.phone, gstNo: s.gstNo }, customer: { name: o.customer_name || 'Walk-in Customer', phone: o.phone || '' }, items: parseJSON(o.items), subtotal: Number(o.subtotal || 0), discount: Number(o.discount || 0), serviceCharge: Number(o.service_charge || 0), tax: Number(o.tax || 0), taxRate: s.taxRate, taxInclusive: s.taxInclusive, total: Number(o.total || 0), payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) })), refundedAmount: Number(o.refunded_amount || 0) }); });

// ---- Split Bill ----
router.get('/orders/:id/splits', async (req, res) => { const { orgId, storeId } = tenant(req); res.json(await query('SELECT * FROM orders WHERE org_id=? AND store_id=? AND split_from_order_id=?', [orgId, storeId, req.params.id])); });
router.post('/orders/:id/split', requirePermission('order.split'), async (req, res) => { const { orgId, storeId } = tenant(req); const parent = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!parent) return res.status(404).json({ error: 'not found' }); if (!['open', 'kitchen', 'ready', 'served'].includes(parent.status)) return res.status(400).json({ error: 'cannot split this order' }); const b = req.body || {}; const items = parseJSON(parent.items); const groups = []; if (b.mode === 'item') { for (const idxs of b.groups || []) { const g = idxs.map((i) => items[i]).filter(Boolean).map((i) => ({ ...i, status: 'pending' })); if (g.length) groups.push(g); } } else if (b.mode === 'pax') { const pax = Math.max(2, Number(b.pax || 2)); const buckets = Array.from({ length: pax }, () => []); items.forEach((it, i) => buckets[i % pax].push({ ...it, status: 'pending' })); groups.push(...buckets.filter((g) => g.length)); } else { const parts = Math.max(2, Number(b.parts || 2)); const per = Math.round((Number(parent.total) / parts) * 100) / 100; for (let i = 0; i < parts; i++) { const amt = i === parts - 1 ? Math.round((Number(parent.total) - per * (parts - 1)) * 100) / 100 : per; groups.push([{ code: `SPLIT-${i + 1}`, name: `Split share ${i + 1}`, unitPrice: amt, qty: 1, status: 'pending' }]); } } if (!groups.length) return res.status(400).json({ error: 'nothing to split' }); const created = []; for (let gi = 0; gi < groups.length; gi++) { const g = groups[gi]; const sub = g.reduce((x, i) => x + Number(i.unitPrice) * Number(i.qty), 0); const id = await insert('INSERT INTO orders (org_id,store_id,order_no,type,table_id,customer_name,phone,items,subtotal,total,status,created_by,shift_id,split_from_order_id,split_group_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [orgId, storeId, `${parent.order_no}-S${gi + 1}`, parent.type, parent.table_id, parent.customer_name, parent.phone, stringifyJSON(g), sub, sub, 'open', req.user.id, parent.shift_id, parent.id, gi + 1]); created.push(id); } await query('UPDATE orders SET status="split" WHERE id=?', [parent.id]); await insert('INSERT INTO order_splits (org_id,store_id,parent_order_id,mode,split_count,created_by) VALUES (?,?,?,?,?,?)', [orgId, storeId, parent.id, b.mode || 'equal', created.length, req.user.id]); res.status(201).json({ parentId: parent.id, children: created }); });

// ---- Refund ----
router.get('/refunds', async (req, res) => { const { orgId, storeId } = tenant(req); res.json((await query('SELECT * FROM refunds WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId])).map((r) => ({ _id: r.id, id: r.id, refundNo: r.refund_no, orderId: r.order_id, orderNo: r.order_no, amount: Number(r.amount || 0), method: r.method, reason: r.reason, items: parseJSON(r.items), restock: !!r.restock, createdAt: dt(r.created_at) }))); });
router.post('/orders/:id/refund', requirePermission('payment.refund'), async (req, res) => { const { orgId, storeId } = tenant(req); const o = await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!o) return res.status(404).json({ error: 'not found' }); if (!['paid', 'served'].includes(o.status)) return res.status(400).json({ error: 'only paid orders can be refunded' }); const b = req.body || {}; const restock = b.restock !== false; const items = parseJSON(o.items); let amount = Number(b.amount || 0); const refundItems = []; if (Array.isArray(b.items) && b.items.length) { for (const rl of b.items) { const src = items[rl.index] || items.find((i) => i.code === rl.code); if (!src) continue; const qty = Math.min(Number(rl.qty || src.qty), src.qty); amount += Math.round(qty * Number(src.unitPrice) * 100) / 100; refundItems.push({ code: src.code, name: src.name, qty, unitPrice: src.unitPrice }); if (restock) await query('UPDATE menu_variants SET stock_qty=stock_qty+? WHERE id=?', [qty, Number(src.variantId || src.itemId)]); } } else { amount = amount || Math.round((Number(o.total) - Number(o.refunded_amount || 0)) * 100) / 100; if (restock) for (const it of items) await query('UPDATE menu_variants SET stock_qty=stock_qty+? WHERE id=?', [Number(it.qty), Number(it.variantId || it.itemId)]); } if (amount <= 0) return res.status(400).json({ error: 'refund amount must be positive' }); const newRefunded = Math.round((Number(o.refunded_amount || 0) + amount) * 100) / 100; const newStatus = newRefunded >= Number(o.total) - 0.001 ? 'refunded' : o.status; await query('UPDATE orders SET refunded_amount=?,status=? WHERE id=?', [newRefunded, newStatus, o.id]); const id = await insert('INSERT INTO refunds (org_id,store_id,refund_no,order_id,order_no,amount,method,reason,items,restock,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [orgId, storeId, `RF${Date.now()}`, o.id, o.order_no, amount, b.method || 'cash', b.reason || 'customer refund', stringifyJSON(refundItems), restock ? 1 : 0, req.user.id]); res.status(201).json({ orderId: o.id, refundedAmount: newRefunded, status: newStatus, refundId: id }); });

// ---- 促销 ----
router.get('/promotions', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM promotions WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, code: r.code, name: r.name, type: r.type, value: Number(r.value || 0), minSpend: Number(r.min_spend || 0), validFrom: dt(r.valid_from), validUntil: dt(r.valid_until), isActive: !!r.is_active }))); });
router.post('/promotions', requirePermission('order.discount'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO promotions (org_id,store_id,code,name,type,value,min_spend,valid_from,valid_until,is_active) VALUES (?,?,?,?,?,?,?,?,?,?)', [orgId, storeId, b.code || `PROMO${Date.now()}`, b.name || '', b.type || 'percent', Number(b.value || 0), Number(b.minSpend || 0), b.validFrom || null, b.validUntil || null, b.isActive === false ? 0 : 1]); res.status(201).json(await getRow('SELECT * FROM promotions WHERE id=?', [id])); });
router.put('/promotions/:id', requirePermission('order.discount'), async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; await query('UPDATE promotions SET code=COALESCE(?,code),name=COALESCE(?,name),type=COALESCE(?,type),value=COALESCE(?,value),min_spend=COALESCE(?,min_spend),is_active=COALESCE(?,is_active) WHERE id=? AND org_id=? AND store_id=?', [b.code, b.name, b.type, b.value, b.minSpend, b.isActive == null ? null : (b.isActive ? 1 : 0), req.params.id, orgId, storeId]); res.json(await getRow('SELECT * FROM promotions WHERE id=?', [req.params.id])); });
router.delete('/promotions/:id', requirePermission('order.discount'), async (req, res) => { const { orgId, storeId } = tenant(req); await query('DELETE FROM promotions WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); res.json({ ok: true }); });
router.get('/promotions/apply', async (req, res) => { const { orgId, storeId } = tenant(req); const code = String(req.query.code || '').toUpperCase(); const amount = Number(req.query.amount || 0); const p = await getRow('SELECT * FROM promotions WHERE org_id=? AND store_id=? AND UPPER(code)=? AND is_active=1', [orgId, storeId, code]); if (!p) return res.status(404).json({ error: 'promotion not found' }); if (amount < Number(p.min_spend || 0)) return res.status(400).json({ error: `min spend ${p.min_spend}` }); const discount = p.type === 'percent' ? Math.round(amount * Number(p.value)) / 100 : Math.min(Number(p.value), amount); res.json({ promotionId: p.id, code: p.code, discount: Math.round(discount * 100) / 100 }); });

// ---- 客户库存 ----
router.get('/customer-stock', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM customer_stock WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, memberId: r.member_id, memberNo: r.member_no, itemName: r.item_name, qty: Number(r.qty || 0), unit: r.unit, note: r.note }))); });
router.post('/customer-stock', async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO customer_stock (org_id,store_id,member_id,member_no,item_name,qty,unit,note) VALUES (?,?,?,?,?,?,?,?)', [orgId, storeId, b.memberId || null, b.memberNo || '', b.itemName || '', Number(b.qty || 0), b.unit || 'pcs', b.note || '']); res.status(201).json(await getRow('SELECT * FROM customer_stock WHERE id=?', [id])); });
router.post('/customer-stock/:id/adjust', async (req, res) => { const { orgId, storeId } = tenant(req); await query('UPDATE customer_stock SET qty=GREATEST(0,qty+?) WHERE id=? AND org_id=? AND store_id=?', [Number(req.body.delta || 0), req.params.id, orgId, storeId]); res.json(await getRow('SELECT * FROM customer_stock WHERE id=?', [req.params.id])); });

// ---- 定期盘点 ----
router.get('/stock-takes', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM stock_takes WHERE org_id=? AND store_id=? ORDER BY id DESC', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, takeNo: r.take_no, status: r.status, lines: parseJSON(r.lines), createdAt: dt(r.created_at), postedAt: dt(r.posted_at) }))); });
router.post('/stock-takes', requirePermission('stock.take'), async (req, res) => { const { orgId, storeId } = tenant(req); const variants = await query('SELECT id,code,name,stock_qty FROM menu_variants WHERE org_id=? AND store_id=?', [orgId, storeId]); const lines = variants.map((v) => ({ itemId: v.id, code: v.code, name: v.name, systemQty: Number(v.stock_qty || 0), countedQty: null, variance: 0 })); const id = await insert('INSERT INTO stock_takes (org_id,store_id,take_no,status,lines,created_by) VALUES (?,?,?,?,?,?)', [orgId, storeId, `ST${Date.now()}`, 'draft', stringifyJSON(lines), req.user.id]); res.status(201).json(await getRow('SELECT * FROM stock_takes WHERE id=?', [id])); });
router.put('/stock-takes/:id', async (req, res) => { const { orgId, storeId } = tenant(req); const st = await getRow('SELECT * FROM stock_takes WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!st) return res.status(404).json({ error: 'not found' }); const lines = parseJSON(st.lines); for (const upd of req.body?.lines || []) { const line = lines.find((l) => String(l.itemId) === String(upd.itemId)); if (line) { line.countedQty = Number(upd.countedQty || 0); line.variance = line.countedQty - line.systemQty; } } await query('UPDATE stock_takes SET lines=? WHERE id=?', [stringifyJSON(lines), st.id]); res.json({ ...st, lines }); });
router.post('/stock-takes/:id/post', async (req, res) => { const { orgId, storeId } = tenant(req); const st = await getRow('SELECT * FROM stock_takes WHERE id=? AND org_id=? AND store_id=?', [req.params.id, orgId, storeId]); if (!st) return res.status(404).json({ error: 'not found' }); if (st.status !== 'draft') return res.status(400).json({ error: 'already posted' }); for (const line of parseJSON(st.lines)) { if (line.countedQty == null) continue; await query('UPDATE menu_variants SET stock_qty=? WHERE id=? AND org_id=? AND store_id=?', [line.countedQty, line.itemId, orgId, storeId]); } await query('UPDATE stock_takes SET status="posted",posted_at=NOW() WHERE id=?', [st.id]); res.json({ ok: true }); });

// ---- 报表设计器 ----
const reportTemplate = (r) => ({
  _id: r.id, id: r.id, type: r.type, name: r.name,
  columns: parseJSON(r.columns), filters: parseJSON(r.filters) || {},
  sort: parseJSON(r.sort) || null, format: r.format || 'csv',
  isSystem: !!r.is_system, createdAt: dt(r.created_at),
});
router.get('/report-templates', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM report_templates WHERE org_id=? AND store_id=? ORDER BY id ASC', [orgId, storeId]); res.json(rows.map(reportTemplate)); });
router.post('/report-templates', async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO report_templates (org_id,store_id,type,name,columns,filters,sort,format,is_system) VALUES (?,?,?,?,?,?,?,?,0)', [orgId, storeId, b.type || 'sales_by_date', b.name || 'Custom Report', stringifyJSON(b.columns || []), stringifyJSON(b.filters || {}), b.sort ? stringifyJSON(b.sort) : null, b.format || 'csv']); res.status(201).json(reportTemplate(await getRow('SELECT * FROM report_templates WHERE id=?', [id]))); });
router.put('/report-templates/:id', async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; await query('UPDATE report_templates SET type=COALESCE(?,type),name=COALESCE(?,name),columns=COALESCE(?,columns),filters=COALESCE(?,filters),sort=COALESCE(?,sort),format=COALESCE(?,format) WHERE id=? AND org_id=? AND store_id=? AND is_system=0', [b.type ?? null, b.name ?? null, b.columns ? stringifyJSON(b.columns) : null, b.filters ? stringifyJSON(b.filters) : null, b.sort ? stringifyJSON(b.sort) : null, b.format ?? null, req.params.id, orgId, storeId]); res.json(reportTemplate(await getRow('SELECT * FROM report_templates WHERE id=?', [req.params.id]))); });
router.delete('/report-templates/:id', async (req, res) => { const { orgId, storeId } = tenant(req); await query('DELETE FROM report_templates WHERE id=? AND org_id=? AND store_id=? AND is_system=0', [req.params.id, orgId, storeId]); res.json({ ok: true }); });

// ---- 硬件 ----
router.get('/hardware/printers', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM printers WHERE org_id=? AND store_id=? ORDER BY id ASC', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, name: r.name, target: r.target, connection: r.connection, width: Number(r.width || 80), isDefault: !!r.is_default, isActive: !!r.is_active }))); });
router.post('/hardware/printers', async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const id = await insert('INSERT INTO printers (org_id,store_id,name,target,connection,width,is_default,is_active) VALUES (?,?,?,?,?,?,?,?)', [orgId, storeId, b.name || 'Printer', b.target || 'receipt', b.connection || 'usb', Number(b.width || 80), b.isDefault ? 1 : 0, b.isActive === false ? 0 : 1]); res.status(201).json(await getRow('SELECT * FROM printers WHERE id=?', [id])); });
router.put('/hardware/printers/:id', async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; await query('UPDATE printers SET name=COALESCE(?,name),target=COALESCE(?,target),connection=COALESCE(?,connection),width=COALESCE(?,width),is_default=COALESCE(?,is_default),is_active=COALESCE(?,is_active) WHERE id=? AND org_id=? AND store_id=?', [b.name, b.target, b.connection, b.width, b.isDefault == null ? null : (b.isDefault ? 1 : 0), b.isActive == null ? null : (b.isActive ? 1 : 0), req.params.id, orgId, storeId]); res.json(await getRow('SELECT * FROM printers WHERE id=?', [req.params.id])); });
router.post('/hardware/print', async (req, res) => { const { orgId, storeId } = tenant(req); const b = req.body || {}; const target = b.target || 'receipt'; const printer = await getRow('SELECT * FROM printers WHERE org_id=? AND store_id=? AND target=? AND is_active=1 LIMIT 1', [orgId, storeId, target]); const o = b.orderId ? await getRow('SELECT * FROM orders WHERE id=? AND org_id=? AND store_id=?', [b.orderId, orgId, storeId]) : null; const lines = []; if (target === 'kitchen' || target === 'bar') { lines.push(`== ${target.toUpperCase()} COPY ==`); if (o) { lines.push(o.order_no); for (const it of parseJSON(o.items)) lines.push(`${it.qty} x ${it.code} ${it.name}`); } } else if (o) { lines.push(o.order_no); for (const it of parseJSON(o.items)) lines.push(`${it.qty} x ${it.name}  ${(Number(it.unitPrice) * Number(it.qty)).toFixed(2)}`); lines.push(`TOTAL ${Number(o.total).toFixed(2)}`); } const payload = lines.join('\n'); const id = await insert('INSERT INTO print_jobs (org_id,store_id,target,printer_id,order_id,payload,created_by) VALUES (?,?,?,?,?,?,?)', [orgId, storeId, target, printer ? printer.id : null, o ? o.id : null, payload, req.user.id]); res.status(201).json({ jobId: id, printerId: printer ? printer.id : null, escpos: payload }); });
router.post('/hardware/drawer', async (req, res) => { const { orgId, storeId } = tenant(req); const id = await insert('INSERT INTO print_jobs (org_id,store_id,target,payload,status,created_by) VALUES (?,?,?,?,?,?)', [orgId, storeId, 'drawer', 'ESC/POS: 1B 70 00 19 FA', 'sent', req.user.id]); res.json({ ok: true, jobId: id }); });

// ---- GST 汇总(走统一报表引擎,支持日期区间) ----
router.get('/reports/gst', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const ds = await buildReportDataset(orgId, storeId);
  const from = req.query.from || null;
  const to = req.query.to || null;
  const inRange = makeFilter(from, to);
  const rate = Number(ds.settings.taxRate || 0);
  const paid = ds.orders.filter((o) => (o.status === 'paid' || o.status === 'refunded') && inRange(o.createdAt));
  const refunded = ds.refunds.filter((r) => inRange(r.createdAt)).reduce((x, r) => x + Number(r.amount || 0), 0);
  const grossTax = round2(paid.reduce((x, o) => x + Number(o.tax || 0), 0));
  const refundTax = rate ? round2(refunded * (rate / (100 + rate))) : 0;
  res.json({
    from, to,
    taxRate: ds.settings.taxRate, taxInclusive: ds.settings.taxInclusive,
    taxableSales: round2(paid.reduce((x, o) => x + Number(o.total || 0), 0)),
    outputTax: grossTax, refundTax, netTax: round2(grossTax - refundTax),
    invoiceCount: ds.invoices.filter((v) => inRange(v.createdAt)).length,
  });
});

// ---- 重打中心 ----
router.get('/reports/reprint', async (req, res) => {
  const { orgId, storeId } = tenant(req);
  const type = req.query.type || 'bill';
  const from = req.query.from ? `${req.query.from} 00:00:00` : null;
  const to = req.query.to ? `${req.query.to} 23:59:59` : null;
  let rows = [];
  if (type === 'payout') {
    rows = await query('SELECT id,voucher_no AS voucherNo,created_at AS date,pay_to AS payTo,amount,reason,method FROM cash_movements WHERE org_id=? AND store_id=? AND type IN ("payout","withdraw") AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) ORDER BY id DESC', [orgId, storeId, from, from, to, to]);
  } else if (type === 'closeshift') {
    rows = await query('SELECT s.id,s.created_at AS date,u.name AS cashier,s.open_amount AS openAmount,s.expected_amount AS expectedAmount,s.close_amount AS closeAmount,s.difference_amount AS difference,s.status FROM shifts s LEFT JOIN users u ON u.id=s.cashier_id WHERE s.org_id=? AND s.store_id=? AND (? IS NULL OR s.created_at>=?) AND (? IS NULL OR s.created_at<=?) ORDER BY s.id DESC', [orgId, storeId, from, from, to, to]);
  } else if (type === 'dayend') {
    rows = await query('SELECT DATE(o.created_at) AS date, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o WHERE o.org_id=? AND o.store_id=? AND o.status IN ("paid","refunded") AND (? IS NULL OR o.created_at>=?) AND (? IS NULL OR o.created_at<=?) GROUP BY DATE(o.created_at) ORDER BY date DESC', [orgId, storeId, from, from, to, to]);
  } else {
    const params = [orgId, storeId];
    let sql = 'SELECT o.id,o.order_no AS orderNo,o.invoice_no AS invoiceNo,o.created_at AS date,o.status,t.number AS tableNo,u.name AS cashier,o.total,o.reprint_count AS reprintCount,o.items FROM orders o LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.created_by WHERE o.org_id=? AND o.store_id=?';
    if (type === 'bill' || type === 'receipt') sql += ' AND o.status IN ("paid","refunded")';
    else if (type === 'order') sql += ' AND o.status NOT IN ("void","hold")';
    if (from) { sql += ' AND o.created_at>=?'; params.push(from); }
    if (to) { sql += ' AND o.created_at<=?'; params.push(to); }
    if (req.query.table) { sql += ' AND o.table_id=?'; params.push(Number(req.query.table)); }
    if (req.query.cashier) { sql += ' AND o.created_by=?'; params.push(Number(req.query.cashier)); }
    if (req.query.orderNo) { sql += ' AND o.order_no LIKE ?'; params.push(`%${req.query.orderNo}%`); }
    sql += ' ORDER BY o.created_at DESC LIMIT 300';
    const list = await query(sql, params);
    rows = list.map((r) => ({ id: r.id, orderNo: r.orderNo, invoiceNo: r.invoiceNo, date: r.date instanceof Date ? r.date.toISOString() : r.date, status: r.status, table: r.tableNo, cashier: r.cashier, itemCount: parseJSON(r.items).length, total: Number(r.total || 0), reprintCount: Number(r.reprintCount || 0), kind: type }));
  }
  res.json({ type, from: req.query.from || null, to: req.query.to || null, rows, count: rows.length });
});

router.get('/reprints', async (req, res) => { const { orgId, storeId } = tenant(req); const rows = await query('SELECT * FROM reprint_logs WHERE org_id=? AND store_id=? ORDER BY id DESC LIMIT 200', [orgId, storeId]); res.json(rows.map((r) => ({ _id: r.id, id: r.id, orderId: r.order_id, orderNo: r.order_no, kind: r.kind, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at }))); });

export default router;
