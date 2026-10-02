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
  payments: z.array(z.object({ method: z.enum(['cash', 'card', 'tab', 'cheque', 'credit']), amount: z.number().min(0) })).min(1),
  tip: z.number().optional(),
});

export const voidSchema = z.object({ reason: z.string().min(1) });

export const inventoryItemSchema = z.object({
  name: z.string().min(1),
  unit: z.string().optional(),
  quantity: z.number().optional(),
  threshold: z.number().optional(),
  costPrice: z.number().optional(),
});

export const adjustSchema = z.object({
  delta: z.number(),
  type: z.enum(['restock', 'adjust', 'count']).default('adjust'),
});
