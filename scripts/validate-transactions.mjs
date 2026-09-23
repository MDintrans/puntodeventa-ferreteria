import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import process from 'node:process'

process.env.NODE_ENV = 'production'

const {
  advanceDispatchTransaction,
  completeSaleTransaction,
  createDispatchTransaction,
  pool,
  receiveInventoryTransaction,
} = await import('../server/index.mjs')

const suffix = randomBytes(6).toString('hex')
let organizationId
let userId

try {
  const user = await pool.query(`
    insert into public.app_users (username, email, full_name, password_hash)
    values ($1, $2, 'Validador transaccional', '$2b$12$hash.solo.para.validar.transacciones')
    returning id
  `, [`tx-${suffix}`, `tx-${suffix}@example.invalid`])
  userId = user.rows[0].id

  const bootstrap = await pool.query(
    'select * from public.bootstrap_business($1, $2, $3, $4)',
    [userId, `Validación transaccional ${suffix}`, 'Casa Matriz', null],
  )
  organizationId = bootstrap.rows[0].organization_id
  const branchId = bootstrap.rows[0].branch_id
  const auth = { organization_id: organizationId, branch_id: branchId, user_id: userId }

  const firstRegister = await pool.query('select id from public.cash_registers where branch_id = $1 order by created_at limit 1', [branchId])
  const secondRegister = await pool.query(`
    insert into public.cash_registers (organization_id, branch_id, code, name)
    values ($1, $2, 'CAJA-02', 'Caja 02')
    returning id
  `, [organizationId, branchId])

  const category = await pool.query(`
    insert into public.product_categories (organization_id, name)
    values ($1, 'Validación') returning id
  `, [organizationId])
  const product = await pool.query(`
    insert into public.products (
      organization_id, category_id, sku, name, unit, cost_amount, sale_price, created_by, updated_by
    ) values ($1, $2, 'TX-001', 'Producto transaccional', 'un', 700, 1190, $3, $3)
    returning id
  `, [organizationId, category.rows[0].id, userId])
  const productId = product.rows[0].id
  await pool.query(`
    insert into public.branch_inventory (organization_id, branch_id, product_id, on_hand, updated_by)
    values ($1, $2, $3, 1, $4)
  `, [organizationId, branchId, productId, userId])

  const saleKeyOne = `sale-${suffix}-one`
  const saleKeyTwo = `sale-${suffix}-two`
  const competingSales = await Promise.allSettled([
    completeSaleTransaction(auth, {
      idempotencyKey: saleKeyOne,
      cashRegisterId: firstRegister.rows[0].id,
      customerName: 'Cliente caja uno',
      paymentMethod: 'Efectivo',
      lines: [{ productId, quantity: 1 }],
    }),
    completeSaleTransaction(auth, {
      idempotencyKey: saleKeyTwo,
      cashRegisterId: secondRegister.rows[0].id,
      customerName: 'Cliente caja dos',
      paymentMethod: 'Débito',
      lines: [{ productId, quantity: 1 }],
    }),
  ])
  const completedSales = competingSales.filter((result) => result.status === 'fulfilled')
  const rejectedSales = competingSales.filter((result) => result.status === 'rejected')
  assert.equal(completedSales.length, 1, 'Solo una caja debe vender la última unidad')
  assert.equal(rejectedSales.length, 1, 'La segunda caja debe recibir conflicto de stock')
  assert.equal(rejectedSales[0].reason.status, 409)

  const winningSaleKey = competingSales[0].status === 'fulfilled' ? saleKeyOne : saleKeyTwo
  const winningRegisterId = competingSales[0].status === 'fulfilled' ? firstRegister.rows[0].id : secondRegister.rows[0].id
  const retry = await completeSaleTransaction(auth, {
    idempotencyKey: winningSaleKey,
    cashRegisterId: winningRegisterId,
    customerName: 'Reintento seguro',
    paymentMethod: 'Efectivo',
    lines: [{ productId, quantity: 1 }],
  })
  assert.ok(retry.receipt?.dbId)

  const saleState = await pool.query(`
    select
      (select count(*)::int from public.sales where organization_id = $1) as sales,
      (select on_hand from public.branch_inventory where branch_id = $2 and product_id = $3) as on_hand
  `, [organizationId, branchId, productId])
  assert.equal(saleState.rows[0].sales, 1, 'El reintento no debe duplicar la venta')
  assert.equal(Number(saleState.rows[0].on_hand), 0, 'La unidad se descuenta una sola vez')

  const receiptKey = `receipt-${suffix}`
  const receiptInput = {
    idempotencyKey: receiptKey,
    supplierName: 'Proveedor de validación',
    document: 'FAC-TX-1',
    lines: [{ productId, quantity: 5, unitCost: 800 }],
  }
  await receiveInventoryTransaction(auth, receiptInput)
  await receiveInventoryTransaction(auth, receiptInput)
  const receiptState = await pool.query(`
    select
      (select count(*)::int from public.inventory_receipts where organization_id = $1) as receipts,
      (select on_hand from public.branch_inventory where branch_id = $2 and product_id = $3) as on_hand
  `, [organizationId, branchId, productId])
  assert.equal(receiptState.rows[0].receipts, 1, 'El reintento no debe duplicar el ingreso')
  assert.equal(Number(receiptState.rows[0].on_hand), 5, 'El ingreso se suma una sola vez')

  const dispatchInput = {
    idempotencyKey: `dispatch-${suffix}`,
    customerName: 'Cliente despacho',
    contact: 'Contacto prueba',
    address: 'Dirección de validación 123',
    orderReference: 'OC-TX-1',
    lines: [{ productId, quantity: 3 }],
  }
  const dispatch = await createDispatchTransaction(auth, dispatchInput)
  await createDispatchTransaction(auth, dispatchInput)
  let inventory = await pool.query('select on_hand, reserved, available from public.branch_inventory where branch_id = $1 and product_id = $2', [branchId, productId])
  assert.deepEqual(inventory.rows[0], { on_hand: '5.000', reserved: '3.000', available: '2.000' })

  await Promise.all([
    advanceDispatchTransaction(auth, dispatch.dispatchId, 'Preparando'),
    advanceDispatchTransaction(auth, dispatch.dispatchId, 'Preparando'),
  ])
  const dispatched = await pool.query('select status from public.dispatches where id = $1', [dispatch.dispatchId])
  assert.equal(dispatched.rows[0].status, 'dispatched', 'Dos clics simultáneos solo deben avanzar una etapa')
  inventory = await pool.query('select on_hand, reserved, available from public.branch_inventory where branch_id = $1 and product_id = $2', [branchId, productId])
  assert.deepEqual(inventory.rows[0], { on_hand: '2.000', reserved: '0.000', available: '2.000' })

  await advanceDispatchTransaction(auth, dispatch.dispatchId, 'Despachado')
  const delivered = await pool.query('select status from public.dispatches where id = $1', [dispatch.dispatchId])
  assert.equal(delivered.rows[0].status, 'delivered')

  console.log('OK dos cajas compiten por stock sin sobreventa')
  console.log('OK ventas, ingresos y despachos son idempotentes')
  console.log('OK reservas y cambios de estado conservan el inventario')
} finally {
  if (organizationId) await pool.query('delete from public.organizations where id = $1', [organizationId]).catch(() => {})
  if (userId) await pool.query('delete from public.app_users where id = $1', [userId]).catch(() => {})
  await pool.end()
}
