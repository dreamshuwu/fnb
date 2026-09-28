import { z } from 'zod';

export const loginSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  password: z.string().min(1),
});

export const categorySchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const itemSchema = z.object({
  categoryId: z.string().optional(),
  name: z.string().min(1),
  price: z.number().min(0),
  imageUrl: z.string().optional(),
  modifierGroups: z.array(z.any()).optional(),
  trackInventory: z.boolean().optional(),
  inventoryItemId: z.string().optional(),
  isSoldOut: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const tableSchema = z.object({
  number: z.string().min(1),
  zone: z.string().optional(),
  seats: z.number().optional(),
  status: z.enum(['free', 'occupied', 'needs_clean']).optional(),
});

export const orderItemSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  unitPrice: z.number(),
  qty: z.number().min(1),
  modifiers: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export const createOrderSchema = z.object({
  type: z.enum(['dine_in', 'takeaway']),
  tableId: z.string().optional(),
  customerName: z.string().optional(),
  phone: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
});

export const checkoutSchema = z.object({
  payments: z.array(z.object({ method: z.enum(['cash', 'tab']), amount: z.number() })).min(1),
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
