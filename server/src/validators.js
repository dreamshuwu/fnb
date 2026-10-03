import { z } from 'zod';

export const loginSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  password: z.string().min(1),
});

export const categorySchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

// 基底（第一步点的东西）
export const baseSchema = z.object({
  categoryId: z.string().optional(),
  name: z.string().min(1),
  basePrice: z.number().min(0).optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

// 修饰/后缀（O/KOS/C/P/K/SP/SUSU/Tarik/DANGGUT…）
export const modifierSchema = z.object({
  code: z.string().min(1),
  label: z.string().optional(),
  defaultDelta: z.number().default(0),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

// 基底↔修饰 关联（手工勾，可逐基底覆盖差价）
export const baseModifierSchema = z.object({
  baseId: z.string().min(1),
  modifierId: z.string().min(1),
  delta: z.number().nullable().optional(),
});

// 成品变体（手工逐条录入的核心表）
export const variantSchema = z.object({
  baseId: z.string().min(1),
  categoryId: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  modifierIds: z.array(z.string()).optional(),
  price: z.number().min(0),
  cost: z.number().min(0).optional(),
  stockQty: z.number().default(0),
  stockThreshold: z.number().default(0),
  barcode: z.string().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const tableSchema = z.object({
  number: z.string().min(1),
  zone: z.string().optional(),
  seats: z.number().optional(),
  status: z.enum(['free', 'occupied', 'needs_clean']).optional(),
});

export const orderItemSchema = z.object({
  variantId: z.string().optional(),
  itemId: z.string().optional(), // 兼容别名
  code: z.string().optional(),
  name: z.string(),
  unitPrice: z.number(),
  cost: z.number().optional(),
  qty: z.number().min(1),
  note: z.string().optional(),
});

export const createOrderSchema = z.object({
  type: z.enum(['dine_in', 'takeaway']),
  tableId: z.string().optional(),
  customerName: z.string().optional(),
  phone: z.string().optional(),
  discount: z.number().min(0).optional(),
  discountType: z.string().optional(),
  hold: z.boolean().optional(),
  holdLabel: z.string().optional(),
  memberId: z.string().optional(),
  salesPersonId: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
});

export const checkoutSchema = z.object({
  // 注意：voucher / rebate 故意不放进 method 枚举 —— 抵扣必须走下面的
  // vouchers[] / rebateAmount，服务端才会真正扣减礼券余额和会员返利余额，
  // 否则客户端可以伪造一笔"礼券付款"而不核销任何券。
  payments: z.array(z.object({ method: z.enum(['cash', 'card', 'tab', 'cheque', 'credit']), amount: z.number().min(0) })).min(1),
  tip: z.number().optional(),
  vouchers: z.array(z.object({ code: z.string().min(1), amount: z.number().min(0) })).optional(),
  rebateAmount: z.number().min(0).optional(),
});

export const voidSchema = z.object({ reason: z.string().min(1) });

export const inventoryItemSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  unit: z.string().optional(),
  quantity: z.number().optional(),
  threshold: z.number().optional(),
  costPrice: z.number().optional().nullable(),
  avgCost: z.number().optional(),
  lastCost: z.number().optional(),
  location: z.string().optional().nullable(),
  supplierId: z.union([z.string(), z.number()]).optional().nullable(),
  note: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// 库存变动类型:盘点用 count(绝对值),其余按增量;opening 用于期初建账
export const STOCK_MOVE_TYPES = [
  'opening', 'restock', 'purchase_receipt', 'receipt_void',
  'adjustment', 'adjust', 'count', 'wastage', 'return',
  'transfer_in', 'transfer_out', 'sale', 'credit_note', 'refund',
];
export const adjustSchema = z.object({
  itemId: z.union([z.string(), z.number()]).optional(),
  delta: z.number(),
  type: z.enum(STOCK_MOVE_TYPES).default('adjustment'),
  unitCost: z.number().optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
  refNo: z.string().optional(),
  location: z.string().optional(),
});
// 批量盘点/调整:一次提交多行,全部校验通过才落库
export const stockMoveLineSchema = z.object({
  itemId: z.union([z.string(), z.number()]),
  delta: z.number().optional(),
  qty: z.number().optional(),
  unitCost: z.number().optional(),
  note: z.string().optional(),
});
export const stockAdjustBatchSchema = z.object({
  type: z.enum(STOCK_MOVE_TYPES).default('adjustment'),
  reason: z.string().optional(),
  location: z.string().optional(),
  lines: z.array(stockMoveLineSchema).min(1),
});

export const supplierSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  taxNo: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  creditTermsDays: z.number().int().min(0).optional(),
  note: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const purchaseLineSchema = z.object({
  itemId: z.union([z.string(), z.number()]),
  qty: z.number().positive(),
  unitCost: z.number().min(0).default(0),
  taxRate: z.number().min(0).optional(),
  note: z.string().optional().nullable(),
});
export const purchaseOrderSchema = z.object({
  supplierId: z.union([z.string(), z.number()]).optional().nullable(),
  expectedDate: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  taxRate: z.number().min(0).optional(),
  lines: z.array(purchaseLineSchema).min(1),
});

export const goodsReceiptSchema = z.object({
  note: z.string().optional().nullable(),
  // 不传 lines = 按 PO 未收数量全额收货
  lines: z.array(z.object({
    poLineId: z.union([z.string(), z.number()]).optional(),
    itemId: z.union([z.string(), z.number()]).optional(),
    qty: z.number().positive(),
    unitCost: z.number().min(0).optional(),
    note: z.string().optional().nullable(),
  })).optional(),
});

export const stockTransferSchema = z.object({
  fromLocation: z.string().min(1),
  toLocation: z.string().min(1),
  note: z.string().optional().nullable(),
  lines: z.array(z.object({
    itemId: z.union([z.string(), z.number()]),
    qty: z.number().positive(),
    note: z.string().optional().nullable(),
  })).min(1),
});
