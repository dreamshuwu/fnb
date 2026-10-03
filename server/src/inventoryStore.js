// ---------------------------------------------------------------------------
// 库存引擎的生产(MySQL)侧适配器。
// 把 inventoryEngine 需要的三个动作落到真实表上:
//   getItem / saveItem / appendMovement
// 采购收货、库位调拨、盘点调整都复用同一个实例,保证口径一致。
// ---------------------------------------------------------------------------
import { query, getRow, insert, toInventoryItem, toStockMovement } from './db.js';

const num = (v) => Number(v || 0);

export const inventoryAdapter = {
  async getItem(orgId, storeId, itemId) {
    if (itemId == null || itemId === '') return null;
    const r = await getRow(
      'SELECT * FROM inventory_items WHERE id=? AND org_id=? AND store_id=?',
      [Number(itemId), orgId, storeId],
    );
    return r ? toInventoryItem(r) : null;
  },

  async saveItem(item, patch) {
    await query(
      'UPDATE inventory_items SET quantity=?, avg_cost=?, last_cost=? WHERE id=?',
      [num(patch.quantity), num(patch.avgCost), num(patch.lastCost), Number(item.id)],
    );
  },

  async appendMovement(mv) {
    const id = await insert(
      `INSERT INTO stock_movements
         (org_id, store_id, item_id, item_code, item_name, type, delta, before, after,
          unit_cost, amount, avg_cost_after, ref_type, ref_id, ref_no, location, note,
          created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mv.orgId, mv.storeId, Number(mv.itemId), mv.itemCode, mv.itemName, mv.type,
        num(mv.delta), num(mv.before), num(mv.after), num(mv.unitCost), num(mv.amount),
        num(mv.avgCostAfter), mv.refType ?? null,
        mv.refId == null || mv.refId === '' ? null : Number(mv.refId),
        mv.refNo ?? null, mv.location ?? null, mv.note ?? null,
        mv.createdBy == null ? null : Number(mv.createdBy), mv.createdByName ?? null],
    );
    return toStockMovement(await getRow('SELECT * FROM stock_movements WHERE id=?', [id]));
  },
};

export default inventoryAdapter;
