// ---------------------------------------------------------------------------
// 会员引擎的生产(MySQL)侧适配器。
// 把 memberEngine 需要的动作落到真实表上:
//   getMember / saveMember / appendPoints / appendCredit / listTiers
// 会员充值、赊账核销、积分调整、结账累积与抵扣全部复用同一个实例,保证口径一致。
// ---------------------------------------------------------------------------
import { query, getRow, insert, toMember, toMemberTier, toPointsLedger, toMemberTopup } from './db.js';

const num = (v) => Number(v || 0);

export const memberAdapter = {
  async getMember(orgId, storeId, id) {
    if (id == null || id === '') return null;
    const r = await getRow(
      'SELECT * FROM members WHERE id=? AND org_id=? AND store_id=?',
      [Number(id), orgId, storeId],
    );
    return r ? toMember(r) : null;
  },

  async saveMember(member, patch) {
    const sets = [];
    const params = [];
    const put = (col, v) => { sets.push(`${col}=?`); params.push(v); };
    if (patch.points != null) put('points', Math.max(0, Math.trunc(num(patch.points))));
    if (patch.pointsEarnedTotal != null) put('points_earned_total', Math.max(0, Math.trunc(num(patch.pointsEarnedTotal))));
    if (patch.pointsRedeemedTotal != null) put('points_redeemed_total', Math.max(0, Math.trunc(num(patch.pointsRedeemedTotal))));
    if (patch.totalSpend != null) put('total_spend', num(patch.totalSpend));
    if (patch.creditBalance != null) put('credit_balance', num(patch.creditBalance));
    if (patch.tierId !== undefined) put('tier_id', patch.tierId == null || patch.tierId === '' ? null : Number(patch.tierId));
    if (!sets.length) return;
    params.push(Number(member.id));
    await query(`UPDATE members SET ${sets.join(', ')} WHERE id=?`, params);
  },

  async appendPoints(row) {
    const id = await insert(
      `INSERT INTO points_ledger
         (org_id, store_id, member_id, delta, type, reason, ref_type, ref_id, ref_no,
          balance_after, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.orgId, row.storeId, Number(row.memberId), Math.trunc(num(row.delta)),
        row.type || 'adjust', row.reason ?? null, row.refType ?? null,
        row.refId == null || row.refId === '' ? null : Number(row.refId),
        row.refNo ?? null, Math.trunc(num(row.balanceAfter)),
        row.createdBy == null ? null : Number(row.createdBy), row.createdByName ?? null],
    );
    return id;
  },

  async appendCredit(row) {
    const id = await insert(
      `INSERT INTO member_topups
         (org_id, store_id, member_id, receipt_no, type, amount, method, balance_after,
          note, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [row.orgId, row.storeId, Number(row.memberId), row.receiptNo ?? null,
        row.type || 'topup', num(row.amount), row.method || 'cash', num(row.balanceAfter),
        row.note ?? null,
        row.createdBy == null ? null : Number(row.createdBy), row.createdByName ?? null],
    );
    return id;
  },

  async listTiers(orgId, storeId) {
    const rows = await query(
      'SELECT * FROM member_tiers WHERE org_id=? AND store_id=? ORDER BY sort_order ASC, id ASC',
      [orgId, storeId],
    );
    return rows.map(toMemberTier);
  },

  /** 对账单/流水读取：直接返回归一化行，路由不必再碰原始列名。 */
  async listCredit(orgId, storeId, memberId) {
    const rows = await query(
      'SELECT * FROM member_topups WHERE org_id=? AND store_id=? AND member_id=? ORDER BY created_at ASC, id ASC',
      [orgId, storeId, Number(memberId)],
    );
    return rows.map(toMemberTopup);
  },

  async listPoints(orgId, storeId, memberId) {
    const rows = await query(
      'SELECT * FROM points_ledger WHERE org_id=? AND store_id=? AND member_id=? ORDER BY created_at ASC, id ASC',
      [orgId, storeId, Number(memberId)],
    );
    return rows.map(toPointsLedger);
  },
};

export default memberAdapter;
