import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import bcrypt from 'bcryptjs'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const projectRoot = resolve(import.meta.dirname, '..')
const localEnvironment = resolve(projectRoot, '.env.local')
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment)

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL para conectar el servidor con Neon.')
}
if (process.env.VITE_DATABASE_URL) {
  throw new Error('No uses VITE_DATABASE_URL: expondria la credencial de Neon en el navegador.')
}

const connectionString = (() => {
  const connection = new URL(process.env.DATABASE_URL)
  if (connection.searchParams.get('sslmode') === 'require') connection.searchParams.set('sslmode', 'verify-full')
  return connection.toString()
})()

const pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE) || 10 })
const app = express()
const port = Number(process.env.PORT) || 5173
const sessionHours = Math.max(1, Number(process.env.SESSION_HOURS) || 12)
const sessionCookie = 'mf_session'

const permissionIds = [
  'dashboard', 'pos', 'inventory', 'receipts', 'dispatches', 'customers', 'suppliers', 'reports', 'settings',
  'editInventory', 'deleteHeldSales', 'exportReports', 'manageUsers',
]
const rolePermissions = {
  admin: permissionIds,
  seller: ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'exportReports'],
  warehouse: ['dashboard', 'inventory', 'receipts', 'dispatches', 'suppliers', 'editInventory'],
}
const roleLabels = { admin: 'Administrador', seller: 'Vendedor', warehouse: 'Bodeguero' }
const labelRoles = { Administrador: 'admin', Vendedor: 'seller', Bodeguero: 'warehouse' }
const stateKeys = new Set([
  'settings', 'customers', 'suppliers', 'heldSales', 'quotes', 'readNotifications',
])

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '10mb' }))

const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
const normalizeUsername = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')
const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const operationError = (message, status = 400) => Object.assign(new Error(message), { status })
const asNumber = (value) => Number(value || 0)
const validIdempotencyKey = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 160

const passwordError = (password) => {
  if (String(password || '').length < 8) return 'La contrasena debe tener al menos 8 caracteres'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return 'Incluye una mayuscula, una minuscula y un numero'
  return ''
}

const cookies = (request) => Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => {
  const separator = part.indexOf('=')
  if (separator < 0) return ['', '']
  return [decodeURIComponent(part.slice(0, separator).trim()), decodeURIComponent(part.slice(separator + 1).trim())]
}).filter(([key]) => key))

const setSessionCookie = (response, token) => {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'
  response.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`)
}

const clearSessionCookie = (response) => {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true'
  response.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`)
}

const withTransaction = async (work) => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

const validPermissions = (permissions, role) => {
  if (!Array.isArray(permissions)) return [...rolePermissions[role]]
  return [...new Set(permissions.filter((permission) => permissionIds.includes(permission)))]
}

const userDto = (row) => ({
  id: row.id,
  username: row.username,
  name: row.full_name,
  email: row.email || '',
  role: roleLabels[row.role] || 'Vendedor',
  active: row.user_active && row.member_active,
  permissions: row.permissions || rolePermissions[row.role] || [],
  hasPassword: row.password_algorithm === 'bcrypt',
  mustChangePassword: Boolean(row.must_change_password),
  lastLoginAt: row.last_login_at,
})

const listUsers = async (database, organizationId) => {
  const result = await database.query(`
    select app_user.id, app_user.username, app_user.email, app_user.full_name,
      app_user.password_algorithm, app_user.must_change_password, app_user.last_login_at,
      app_user.active as user_active, member.active as member_active, member.role, member.permissions
    from public.organization_members member
    join public.app_users app_user on app_user.id = member.user_id
    where member.organization_id = $1
    order by app_user.full_name, app_user.username
  `, [organizationId])
  return result.rows.map(userDto)
}

const productDto = (row) => ({
  id: row.id,
  sku: row.sku,
  barcode: row.barcode || '',
  name: row.name,
  category: row.category || 'Sin categoría',
  brand: row.brand || '',
  unit: row.unit,
  cost: asNumber(row.cost_amount),
  price: asNumber(row.sale_price),
  minStock: asNumber(row.minimum_stock),
  active: row.active,
  onHand: asNumber(row.on_hand),
  reserved: asNumber(row.reserved),
  stock: asNumber(row.available),
  location: row.location || '',
  tone: 'teal',
})

const listProducts = async (database, organizationId, branchId) => {
  const result = await database.query(`
    select product.id, product.sku, product.barcode, product.name, category.name as category,
      product.brand, product.unit, product.cost_amount, product.sale_price, product.minimum_stock,
      product.active, coalesce(inventory.on_hand, 0) as on_hand,
      coalesce(inventory.reserved, 0) as reserved, coalesce(inventory.available, 0) as available,
      inventory.location
    from public.products product
    left join public.product_categories category
      on category.organization_id = product.organization_id and category.id = product.category_id
    left join public.branch_inventory inventory
      on inventory.organization_id = product.organization_id
      and inventory.branch_id = $2 and inventory.product_id = product.id
    where product.organization_id = $1
    order by product.active desc, product.name, product.sku
  `, [organizationId, branchId])
  return result.rows.map(productDto)
}

const listSales = async (database, organizationId, branchId, limit = 500) => {
  const result = await database.query(`
    select sale.id as db_id, sale.folio, sale.customer_name_snapshot, sale.sold_at,
      to_char(sale.sold_at at time zone 'America/Santiago', 'YYYY-MM-DD') as sale_date,
      to_char(sale.sold_at at time zone 'America/Santiago', 'HH24:MI') as sale_time,
      sale.total_amount, sale.status, app_user.full_name as seller,
      coalesce(items.quantity, 0) as item_count,
      coalesce(payment.method, 'No informado') as payment_method,
      cash_register.name as register_name
    from public.sales sale
    left join public.app_users app_user on app_user.id = sale.created_by
    left join public.cash_registers cash_register on cash_register.id = sale.cash_register_id
    left join lateral (
      select sum(quantity) as quantity from public.sale_items where sale_id = sale.id
    ) items on true
    left join lateral (
      select method from public.sale_payments
      where sale_id = sale.id and status = 'completed'
      order by paid_at limit 1
    ) payment on true
    where sale.organization_id = $1 and sale.branch_id = $2
    order by sale.sold_at desc
    limit $3
  `, [organizationId, branchId, limit])
  return result.rows.map((row) => ({
    id: `V-${row.folio}`,
    dbId: row.db_id,
    folio: String(row.folio).padStart(8, '0'),
    createdAt: row.sold_at,
    date: row.sale_date,
    time: row.sale_time,
    customer: row.customer_name_snapshot,
    seller: row.seller || 'Usuario eliminado',
    items: asNumber(row.item_count),
    payment: row.payment_method,
    register: row.register_name || 'Caja',
    total: asNumber(row.total_amount),
    status: row.status === 'completed' ? 'Completada' : row.status,
  }))
}

const listReceipts = async (database, organizationId, branchId, limit = 500) => {
  const result = await database.query(`
    select receipt.id as db_id, receipt.folio, receipt.created_at, receipt.supplier_name_snapshot,
      receipt.supplier_document, receipt.total_amount, receipt.status,
      app_user.full_name as responsible, coalesce(items.quantity, 0) as units
    from public.inventory_receipts receipt
    left join public.app_users app_user on app_user.id = receipt.created_by
    left join lateral (
      select sum(quantity) as quantity from public.inventory_receipt_items where receipt_id = receipt.id
    ) items on true
    where receipt.organization_id = $1 and receipt.branch_id = $2
    order by receipt.created_at desc
    limit $3
  `, [organizationId, branchId, limit])
  return result.rows.map((row) => ({
    id: `ING-${String(row.folio).padStart(3, '0')}`,
    dbId: row.db_id,
    date: new Date(row.created_at).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }),
    supplier: row.supplier_name_snapshot || 'Sin proveedor',
    document: row.supplier_document || 'Sin documento',
    responsible: row.responsible || 'Usuario eliminado',
    units: asNumber(row.units),
    total: asNumber(row.total_amount),
    status: row.status === 'received' ? 'Recibido' : row.status,
  }))
}

const dispatchStatusLabels = { preparing: 'Preparando', dispatched: 'Despachado', delivered: 'Entregado', voided: 'Anulado' }
const listDispatches = async (database, organizationId, branchId, limit = 500) => {
  const result = await database.query(`
    select dispatch.id as db_id, dispatch.folio, dispatch.created_at, dispatch.customer_name_snapshot,
      dispatch.contact_name, dispatch.contact_phone, dispatch.delivery_address,
      dispatch.order_reference, dispatch.status, app_user.full_name as responsible,
      coalesce(items.quantity, 0) as units
    from public.dispatches dispatch
    left join public.app_users app_user on app_user.id = dispatch.created_by
    left join lateral (
      select sum(quantity) as quantity from public.dispatch_items where dispatch_id = dispatch.id
    ) items on true
    where dispatch.organization_id = $1 and dispatch.branch_id = $2
    order by dispatch.created_at desc
    limit $3
  `, [organizationId, branchId, limit])
  return result.rows.map((row) => ({
    id: `DES-${String(row.folio).padStart(3, '0')}`,
    dbId: row.db_id,
    date: new Date(row.created_at).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }),
    customer: row.customer_name_snapshot,
    contact: [row.contact_name, row.contact_phone].filter(Boolean).join(' · '),
    address: row.delivery_address,
    order: row.order_reference || '',
    units: asNumber(row.units),
    status: dispatchStatusLabels[row.status] || row.status,
    responsible: row.responsible || 'Usuario eliminado',
  }))
}

const listCashRegisters = async (database, organizationId, branchId) => {
  const result = await database.query(`
    select cash_register.id, cash_register.code, cash_register.name, cash_register.active,
      cash_session.id as session_id, cash_session.opened_at
    from public.cash_registers cash_register
    left join public.cash_sessions cash_session
      on cash_session.cash_register_id = cash_register.id and cash_session.status = 'open'
    where cash_register.organization_id = $1 and cash_register.branch_id = $2
    order by cash_register.active desc, cash_register.created_at
  `, [organizationId, branchId])
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active,
    sessionId: row.session_id,
    openedAt: row.opened_at,
  }))
}

const operationalPayload = async (database, session) => {
  const [products, sales, receipts, dispatches, cashRegisters] = await Promise.all([
    listProducts(database, session.organization_id, session.branch_id),
    listSales(database, session.organization_id, session.branch_id),
    listReceipts(database, session.organization_id, session.branch_id),
    listDispatches(database, session.organization_id, session.branch_id),
    listCashRegisters(database, session.organization_id, session.branch_id),
  ])
  return { products, sales, receipts, dispatches, cashRegisters }
}

const loadSaleReceipt = async (database, saleId) => {
  const [header, lines] = await Promise.all([
    database.query(`
      select sale.id, sale.folio, sale.sold_at, sale.customer_name_snapshot,
        sale.net_amount, sale.tax_amount, sale.total_amount,
        app_user.full_name as cashier, cash_register.name as register_name,
        payment.method as payment_method
      from public.sales sale
      left join public.app_users app_user on app_user.id = sale.created_by
      left join public.cash_registers cash_register on cash_register.id = sale.cash_register_id
      left join lateral (
        select method from public.sale_payments where sale_id = sale.id and status = 'completed' order by paid_at limit 1
      ) payment on true
      where sale.id = $1
    `, [saleId]),
    database.query(`
      select item.product_id as id, item.sku_snapshot as sku, item.name_snapshot as name,
        item.unit_price as price, item.quantity as qty
      from public.sale_items item where item.sale_id = $1 order by item.line_number
    `, [saleId]),
  ])
  const row = header.rows[0]
  if (!row) return null
  return {
    id: `V-${row.folio}`,
    dbId: row.id,
    folio: String(row.folio).padStart(8, '0'),
    createdAt: row.sold_at,
    date: new Date(row.sold_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }),
    time: new Date(row.sold_at).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }),
    customer: row.customer_name_snapshot,
    cashier: row.cashier || 'Usuario eliminado',
    seller: row.cashier || 'Usuario eliminado',
    register: row.register_name || 'Caja',
    payment: row.payment_method || 'No informado',
    net: asNumber(row.net_amount),
    tax: asNumber(row.tax_amount),
    total: asNumber(row.total_amount),
    items: lines.rows.reduce((total, item) => total + asNumber(item.qty), 0),
    status: 'Completada',
    lines: lines.rows.map((item) => ({ ...item, price: asNumber(item.price), qty: asNumber(item.qty) })),
  }
}

const createSession = async (database, response, userId, organizationId, request) => {
  const previousToken = cookies(request)[sessionCookie]
  if (previousToken) {
    await database.query('update public.user_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [hashToken(previousToken)])
  }
  const token = randomBytes(32).toString('base64url')
  await database.query(`
    insert into public.user_sessions (user_id, organization_id, token_hash, ip_address, user_agent, expires_at)
    values ($1, $2, $3, nullif($4, '')::inet, $5, now() + ($6 * interval '1 hour'))
  `, [userId, organizationId, hashToken(token), request.ip || '', request.get('user-agent') || '', sessionHours])
  setSessionCookie(response, token)
}

const loadSession = async (request) => {
  const token = cookies(request)[sessionCookie]
  if (!token) return null
  const result = await pool.query(`
    select session.id as session_id, session.user_id, session.organization_id, app_user.id,
      app_user.username, app_user.email, app_user.full_name, app_user.password_algorithm,
      app_user.must_change_password, app_user.last_login_at, app_user.active as user_active,
      member.active as member_active, member.role, member.permissions,
      organization.name as organization_name,
      branch.id as branch_id, branch.name as branch_name
    from public.user_sessions session
    join public.app_users app_user on app_user.id = session.user_id
    join public.organization_members member
      on member.user_id = session.user_id and member.organization_id = session.organization_id
    join public.organizations organization on organization.id = session.organization_id and organization.active
    left join lateral (
      select id, name from public.branches
      where organization_id = session.organization_id and active
      order by created_at limit 1
    ) branch on true
    where session.token_hash = $1
      and session.revoked_at is null
      and session.expires_at > now()
      and app_user.active and member.active
  `, [hashToken(token)])
  if (!result.rowCount) return null
  await pool.query('update public.user_sessions set last_seen_at = now() where id = $1', [result.rows[0].session_id])
  return result.rows[0]
}

const requireSession = ({ allowPasswordChange = false } = {}) => asyncRoute(async (request, response, next) => {
  const session = await loadSession(request)
  if (!session) {
    clearSessionCookie(response)
    return response.status(401).json({ error: 'Tu sesion vencio. Ingresa nuevamente.' })
  }
  if (session.must_change_password && !allowPasswordChange) {
    return response.status(428).json({ error: 'Debes cambiar tu contrasena antes de continuar.' })
  }
  request.auth = session
  next()
})

const requireUserAdmin = (request, response, next) => {
  const permissions = request.auth.permissions || rolePermissions[request.auth.role] || []
  if (request.auth.role !== 'admin' || !permissions.includes('manageUsers')) {
    return response.status(403).json({ error: 'No tienes permisos para administrar usuarios.' })
  }
  next()
}

const requirePermission = (permission) => (request, response, next) => {
  const permissions = request.auth.permissions || rolePermissions[request.auth.role] || []
  if (!permissions.includes(permission)) return response.status(403).json({ error: 'No tienes permisos para realizar esta operación.' })
  next()
}

const sanitizeState = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => stateKeys.has(key)))
}

const appPayload = async (database, session) => {
  const [stateResult, users, operations] = await Promise.all([
    database.query('select state, version from public.erp_state_snapshots where organization_id = $1', [session.organization_id]),
    listUsers(database, session.organization_id),
    operationalPayload(database, session),
  ])
  return {
    user: userDto(session),
    users,
    state: { ...(stateResult.rows[0]?.state || {}), products: operations.products, sales: operations.sales, receipts: operations.receipts, dispatches: operations.dispatches },
    cashRegisters: operations.cashRegisters,
    version: Number(stateResult.rows[0]?.version || 0),
    organization: { id: session.organization_id, name: session.organization_name },
    branch: { id: session.branch_id, name: session.branch_name || 'Casa Matriz' },
  }
}

const loginAttempts = new Map()
const loginAllowed = (request, username) => {
  const key = `${request.ip}:${normalizeUsername(username)}`
  const now = Date.now()
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000)
  if (attempts.length >= 8) return false
  attempts.push(now)
  loginAttempts.set(key, attempts)
  return true
}
const clearLoginAttempts = (request, username) => loginAttempts.delete(`${request.ip}:${normalizeUsername(username)}`)

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const normalizeOperationLines = (lines, { withCost = false } = {}) => {
  if (!Array.isArray(lines) || !lines.length) throw operationError('Debes agregar al menos un producto.')
  const grouped = new Map()
  for (const item of lines) {
    const productId = String(item.productId || '')
    const quantity = Number(item.quantity)
    const unitCost = withCost ? Number(item.unitCost) : null
    if (!uuidPattern.test(productId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) {
      throw operationError('La lista de productos contiene datos inválidos.')
    }
    if (withCost && (!Number.isSafeInteger(unitCost) || unitCost < 0)) throw operationError('El costo unitario no es válido.')
    const current = grouped.get(productId) || { productId, quantity: 0, totalCost: 0, unitCost: 0 }
    current.quantity += quantity
    if (withCost) {
      current.totalCost += Math.round(quantity * unitCost)
      current.unitCost = unitCost
    }
    grouped.set(productId, current)
  }
  return [...grouped.values()].sort((left, right) => left.productId.localeCompare(right.productId))
}

const ensureCategory = async (database, organizationId, categoryName) => {
  const name = String(categoryName || 'Sin categoría').trim()
  if (name.length < 2) throw operationError('La categoría debe tener al menos 2 caracteres.')
  await database.query(`
    insert into public.product_categories (organization_id, name)
    values ($1, $2)
    on conflict do nothing
  `, [organizationId, name])
  const result = await database.query(`
    select id from public.product_categories
    where organization_id = $1 and lower(name) = lower($2)
  `, [organizationId, name])
  return result.rows[0].id
}

const saveProductRecord = async (database, auth, input = {}, { matchSku = false } = {}) => {
  const sku = String(input.sku || '').trim().toUpperCase()
  const name = String(input.name || '').trim()
  const unit = String(input.unit || 'un').trim()
  const cost = Number(input.cost)
  const price = Number(input.price)
  const minimumStock = Number(input.minStock)
  const desiredStock = Number(input.stock)
  const expectedOnHand = input.expectedOnHand ?? input.onHand
  if (sku.length < 2 || name.length < 2 || !unit) throw operationError('Completa SKU, nombre y unidad del producto.')
  if (![cost, price, minimumStock, desiredStock].every((value) => Number.isFinite(value) && value >= 0)) throw operationError('Costo, precio y existencias deben ser números positivos.')
  if (![cost, price].every(Number.isSafeInteger)) throw operationError('Costo y precio deben ingresarse en pesos enteros.')
  const categoryId = await ensureCategory(database, auth.organization_id, input.category)
  let productId = uuidPattern.test(String(input.id || '')) ? String(input.id) : null
  if (productId) {
    const owned = await database.query('select id from public.products where id = $1 and organization_id = $2', [productId, auth.organization_id])
    if (!owned.rowCount) productId = null
  }
  if (!productId && matchSku) {
    const existing = await database.query('select id from public.products where organization_id = $1 and lower(sku) = lower($2)', [auth.organization_id, sku])
    productId = existing.rows[0]?.id || null
  }
  if (productId) {
    await database.query(`
      update public.products
      set category_id = $3, sku = $4, barcode = nullif(trim($5), ''), name = $6,
        brand = nullif(trim($7), ''), unit = $8, cost_amount = $9, sale_price = $10,
        minimum_stock = $11, active = $12, updated_by = $13
      where organization_id = $1 and id = $2
    `, [auth.organization_id, productId, categoryId, sku, String(input.barcode || ''), name, String(input.brand || ''), unit, cost, price, minimumStock, input.active !== false, auth.user_id])
  } else {
    const created = await database.query(`
      insert into public.products (
        organization_id, category_id, sku, barcode, name, brand, unit,
        cost_amount, sale_price, minimum_stock, active, created_by, updated_by
      ) values ($1, $2, $3, nullif(trim($4), ''), $5, nullif(trim($6), ''), $7, $8, $9, $10, $11, $12, $12)
      returning id
    `, [auth.organization_id, categoryId, sku, String(input.barcode || ''), name, String(input.brand || ''), unit, cost, price, minimumStock, input.active !== false, auth.user_id])
    productId = created.rows[0].id
  }
  await database.query(`
    insert into public.branch_inventory (organization_id, branch_id, product_id, on_hand, reserved, location, updated_by)
    values ($1, $2, $3, 0, 0, nullif(trim($4), ''), $5)
    on conflict (branch_id, product_id) do nothing
  `, [auth.organization_id, auth.branch_id, productId, String(input.location || ''), auth.user_id])
  const inventory = await database.query(`
    select on_hand, reserved from public.branch_inventory
    where branch_id = $1 and product_id = $2
    for update
  `, [auth.branch_id, productId])
  const currentStock = asNumber(inventory.rows[0].on_hand)
  const reserved = asNumber(inventory.rows[0].reserved)
  if (productId && expectedOnHand !== undefined && Number(expectedOnHand) !== currentStock) {
    throw operationError('El stock cambió mientras editabas el producto. Recarga e intenta nuevamente.', 409)
  }
  if (desiredStock < reserved) throw operationError(`No puedes dejar el stock bajo las ${reserved} unidades reservadas.`)
  const difference = desiredStock - currentStock
  const updated = await database.query(`
    update public.branch_inventory
    set on_hand = $3, location = nullif(trim($4), ''), updated_by = $5
    where branch_id = $1 and product_id = $2
    returning on_hand, reserved
  `, [auth.branch_id, productId, desiredStock, String(input.location || ''), auth.user_id])
  if (difference !== 0) {
    await database.query(`
      insert into public.stock_movements (
        organization_id, branch_id, product_id, movement_type, quantity_delta,
        on_hand_after, reserved_after, reason, created_by
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [auth.organization_id, auth.branch_id, productId, currentStock === 0 && difference > 0 ? 'opening' : difference > 0 ? 'adjustment_in' : 'adjustment_out', difference, updated.rows[0].on_hand, updated.rows[0].reserved, productId === input.id ? 'Edición de producto' : 'Carga o creación de producto', auth.user_id])
  }
  return productId
}

const completeSaleTransaction = async (auth, body = {}) => {
  const idempotencyKey = String(body.idempotencyKey || '')
  if (!validIdempotencyKey(idempotencyKey)) throw operationError('La operación de venta no tiene una clave válida.')
  if (!uuidPattern.test(String(body.cashRegisterId || ''))) throw operationError('Selecciona una caja válida.')
  const lines = normalizeOperationLines(body.lines)
  const paymentMethod = String(body.paymentMethod || '').trim()
  if (paymentMethod.length < 2 || paymentMethod.length > 50) throw operationError('Selecciona un medio de pago válido.')
  const saleId = await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`sale:${auth.organization_id}:${idempotencyKey}`])
    const previous = await client.query('select id from public.sales where organization_id = $1 and idempotency_key = $2', [auth.organization_id, idempotencyKey])
    if (previous.rowCount) return previous.rows[0].id
    const register = await client.query(`
      select id from public.cash_registers
      where id = $1 and organization_id = $2 and branch_id = $3 and active
    `, [body.cashRegisterId, auth.organization_id, auth.branch_id])
    if (!register.rowCount) throw operationError('La caja seleccionada no está disponible.')
    const cashSession = await client.query(`
      select id from public.cash_sessions
      where cash_register_id = $1 and status = 'open'
      order by opened_at desc limit 1
    `, [body.cashRegisterId])
    const lockedLines = []
    for (const line of lines) {
      const locked = await client.query(`
        select product.id, product.sku, product.name, product.unit, product.sale_price, product.tax_rate,
          inventory.on_hand, inventory.reserved, inventory.available
        from public.products product
        join public.branch_inventory inventory
          on inventory.organization_id = product.organization_id
          and inventory.branch_id = $2 and inventory.product_id = product.id
        where product.organization_id = $1 and product.id = $3 and product.active
        for update of inventory
      `, [auth.organization_id, auth.branch_id, line.productId])
      if (!locked.rowCount) throw operationError('Uno de los productos ya no está disponible.')
      if (asNumber(locked.rows[0].available) < line.quantity) throw operationError(`Stock insuficiente para ${locked.rows[0].name}. Disponible: ${locked.rows[0].available}.`, 409)
      const row = locked.rows[0]
      const lineTotal = Math.round(asNumber(row.sale_price) * line.quantity)
      const lineNet = Math.round(lineTotal / (1 + asNumber(row.tax_rate) / 100))
      lockedLines.push({ ...line, ...row, lineTotal, lineNet })
    }
    const total = lockedLines.reduce((sum, line) => sum + line.lineTotal, 0)
    if (total <= 0) throw operationError('El total de la venta debe ser mayor que cero.')
    const net = lockedLines.reduce((sum, line) => sum + line.lineNet, 0)
    const tax = total - net
    const folio = await client.query("select public.next_document_folio($1, $2, 'sale') as folio", [auth.organization_id, auth.branch_id])
    const inserted = await client.query(`
      insert into public.sales (
        organization_id, branch_id, cash_register_id, cash_session_id, folio,
        customer_name_snapshot, status, net_amount, tax_amount, total_amount,
        created_by, idempotency_key
      ) values ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $11)
      returning id
    `, [auth.organization_id, auth.branch_id, body.cashRegisterId, cashSession.rows[0]?.id || null, folio.rows[0].folio, String(body.customerName || 'Público general').trim() || 'Público general', net, tax, total, auth.user_id, idempotencyKey])
    const createdSaleId = inserted.rows[0].id
    for (const [index, line] of lockedLines.entries()) {
      await client.query(`
        insert into public.sale_items (
          organization_id, sale_id, line_number, product_id, sku_snapshot,
          name_snapshot, unit_snapshot, quantity, unit_price, tax_rate, line_total
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [auth.organization_id, createdSaleId, index + 1, line.productId, line.sku, line.name, line.unit, line.quantity, line.sale_price, line.tax_rate, line.lineTotal])
      const inventory = await client.query(`
        update public.branch_inventory
        set on_hand = on_hand - $3, updated_by = $4
        where branch_id = $1 and product_id = $2
        returning on_hand, reserved
      `, [auth.branch_id, line.productId, line.quantity, auth.user_id])
      await client.query(`
        insert into public.stock_movements (
          organization_id, branch_id, product_id, movement_type, quantity_delta,
          on_hand_after, reserved_after, source_type, source_id, reason, created_by
        ) values ($1, $2, $3, 'sale', $4, $5, $6, 'sale', $7, 'Venta completada', $8)
      `, [auth.organization_id, auth.branch_id, line.productId, -line.quantity, inventory.rows[0].on_hand, inventory.rows[0].reserved, createdSaleId, auth.user_id])
    }
    await client.query(`
      insert into public.sale_payments (
        organization_id, sale_id, cash_session_id, method, amount, created_by
      ) values ($1, $2, $3, $4, $5, $6)
    `, [auth.organization_id, createdSaleId, cashSession.rows[0]?.id || null, paymentMethod, total, auth.user_id])
    if (cashSession.rowCount && paymentMethod.toLocaleLowerCase('es-CL') === 'efectivo') {
      await client.query(`
        insert into public.cash_movements (
          organization_id, cash_session_id, movement_type, amount, reason,
          reference_type, reference_id, created_by
        ) values ($1, $2, 'income', $3, 'Venta en efectivo', 'sale', $4, $5)
      `, [auth.organization_id, cashSession.rows[0].id, total, createdSaleId, auth.user_id])
    }
    await client.query(`
      insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, new_data)
      values ($1, $2, 'complete', 'sale', $3, $4::jsonb)
    `, [auth.organization_id, auth.user_id, createdSaleId, JSON.stringify({ total, registerId: body.cashRegisterId, idempotencyKey })])
    return createdSaleId
  })
  return {
    receipt: await loadSaleReceipt(pool, saleId),
    products: await listProducts(pool, auth.organization_id, auth.branch_id),
    sales: await listSales(pool, auth.organization_id, auth.branch_id),
  }
}

const receiveInventoryTransaction = async (auth, body = {}) => {
  const idempotencyKey = String(body.idempotencyKey || '')
  if (!validIdempotencyKey(idempotencyKey)) throw operationError('El ingreso no tiene una clave válida.')
  const lines = normalizeOperationLines(body.lines, { withCost: true })
  const receiptId = await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`receipt:${auth.organization_id}:${idempotencyKey}`])
    const previous = await client.query('select id from public.inventory_receipts where organization_id = $1 and idempotency_key = $2', [auth.organization_id, idempotencyKey])
    if (previous.rowCount) return previous.rows[0].id
    const folio = await client.query("select public.next_document_folio($1, $2, 'receipt') as folio", [auth.organization_id, auth.branch_id])
    const total = lines.reduce((sum, line) => sum + line.totalCost, 0)
    const inserted = await client.query(`
      insert into public.inventory_receipts (
        organization_id, branch_id, folio, supplier_name_snapshot, supplier_document,
        status, total_amount, received_at, created_by, idempotency_key
      ) values ($1, $2, $3, $4, nullif(trim($5), ''), 'received', $6, now(), $7, $8)
      returning id
    `, [auth.organization_id, auth.branch_id, folio.rows[0].folio, String(body.supplierName || 'Sin proveedor').trim(), String(body.document || ''), total, auth.user_id, idempotencyKey])
    const createdReceiptId = inserted.rows[0].id
    for (const [index, line] of lines.entries()) {
      const product = await client.query(`
        select id, name from public.products
        where organization_id = $1 and id = $2 and active
        for update
      `, [auth.organization_id, line.productId])
      if (!product.rowCount) throw operationError('Uno de los productos del ingreso ya no está disponible.')
      await client.query(`
        insert into public.branch_inventory (organization_id, branch_id, product_id, on_hand, reserved, updated_by)
        values ($1, $2, $3, 0, 0, $4)
        on conflict (branch_id, product_id) do nothing
      `, [auth.organization_id, auth.branch_id, line.productId, auth.user_id])
      await client.query('select 1 from public.branch_inventory where branch_id = $1 and product_id = $2 for update', [auth.branch_id, line.productId])
      const unitCost = Math.round(line.totalCost / line.quantity)
      await client.query(`
        insert into public.inventory_receipt_items (
          organization_id, receipt_id, line_number, product_id, quantity, unit_cost, line_total
        ) values ($1, $2, $3, $4, $5, $6, $7)
      `, [auth.organization_id, createdReceiptId, index + 1, line.productId, line.quantity, unitCost, line.totalCost])
      await client.query('update public.products set cost_amount = $3, updated_by = $4 where organization_id = $1 and id = $2', [auth.organization_id, line.productId, unitCost, auth.user_id])
      const inventory = await client.query(`
        update public.branch_inventory
        set on_hand = on_hand + $3, updated_by = $4
        where branch_id = $1 and product_id = $2
        returning on_hand, reserved
      `, [auth.branch_id, line.productId, line.quantity, auth.user_id])
      await client.query(`
        insert into public.stock_movements (
          organization_id, branch_id, product_id, movement_type, quantity_delta,
          on_hand_after, reserved_after, source_type, source_id, reason, created_by
        ) values ($1, $2, $3, 'purchase', $4, $5, $6, 'receipt', $7, 'Ingreso de mercadería', $8)
      `, [auth.organization_id, auth.branch_id, line.productId, line.quantity, inventory.rows[0].on_hand, inventory.rows[0].reserved, createdReceiptId, auth.user_id])
    }
    return createdReceiptId
  })
  return {
    receiptId,
    products: await listProducts(pool, auth.organization_id, auth.branch_id),
    receipts: await listReceipts(pool, auth.organization_id, auth.branch_id),
  }
}

const createDispatchTransaction = async (auth, body = {}) => {
  const idempotencyKey = String(body.idempotencyKey || '')
  if (!validIdempotencyKey(idempotencyKey)) throw operationError('El despacho no tiene una clave válida.')
  const lines = normalizeOperationLines(body.lines)
  const customerName = String(body.customerName || '').trim()
  const deliveryAddress = String(body.address || '').trim()
  if (customerName.length < 2) throw operationError('Ingresa el nombre del cliente del despacho.')
  if (deliveryAddress.length < 5) throw operationError('Ingresa una dirección de entrega válida.')
  const dispatchId = await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`dispatch:${auth.organization_id}:${idempotencyKey}`])
    const previous = await client.query('select id from public.dispatches where organization_id = $1 and idempotency_key = $2', [auth.organization_id, idempotencyKey])
    if (previous.rowCount) return previous.rows[0].id
    const lockedLines = []
    for (const line of lines) {
      const locked = await client.query(`
        select product.id, product.sku, product.name, inventory.available
        from public.products product
        join public.branch_inventory inventory on inventory.product_id = product.id and inventory.branch_id = $2
        where product.organization_id = $1 and product.id = $3 and product.active
        for update of inventory
      `, [auth.organization_id, auth.branch_id, line.productId])
      if (!locked.rowCount) throw operationError('Uno de los productos del despacho ya no está disponible.')
      if (asNumber(locked.rows[0].available) < line.quantity) throw operationError(`Stock insuficiente para ${locked.rows[0].name}. Disponible: ${locked.rows[0].available}.`, 409)
      lockedLines.push({ ...line, ...locked.rows[0] })
    }
    const folio = await client.query("select public.next_document_folio($1, $2, 'dispatch') as folio", [auth.organization_id, auth.branch_id])
    const inserted = await client.query(`
      insert into public.dispatches (
        organization_id, branch_id, folio, customer_name_snapshot, contact_name,
        delivery_address, order_reference, status, created_by, idempotency_key
      ) values ($1, $2, $3, $4, nullif(trim($5), ''), $6, nullif(trim($7), ''), 'preparing', $8, $9)
      returning id
    `, [auth.organization_id, auth.branch_id, folio.rows[0].folio, customerName, String(body.contact || ''), deliveryAddress, String(body.orderReference || ''), auth.user_id, idempotencyKey])
    const createdDispatchId = inserted.rows[0].id
    for (const [index, line] of lockedLines.entries()) {
      await client.query(`
        insert into public.dispatch_items (
          organization_id, dispatch_id, line_number, product_id, sku_snapshot, name_snapshot, quantity
        ) values ($1, $2, $3, $4, $5, $6, $7)
      `, [auth.organization_id, createdDispatchId, index + 1, line.productId, line.sku, line.name, line.quantity])
      const inventory = await client.query(`
        update public.branch_inventory
        set reserved = reserved + $3, updated_by = $4
        where branch_id = $1 and product_id = $2
        returning on_hand, reserved
      `, [auth.branch_id, line.productId, line.quantity, auth.user_id])
      await client.query(`
        insert into public.stock_movements (
          organization_id, branch_id, product_id, movement_type, reserved_delta,
          on_hand_after, reserved_after, source_type, source_id, reason, created_by
        ) values ($1, $2, $3, 'reservation', $4, $5, $6, 'dispatch', $7, 'Reserva para despacho', $8)
      `, [auth.organization_id, auth.branch_id, line.productId, line.quantity, inventory.rows[0].on_hand, inventory.rows[0].reserved, createdDispatchId, auth.user_id])
    }
    return createdDispatchId
  })
  return {
    dispatchId,
    products: await listProducts(pool, auth.organization_id, auth.branch_id),
    dispatches: await listDispatches(pool, auth.organization_id, auth.branch_id),
  }
}

const advanceDispatchTransaction = async (auth, dispatchId, expectedStatus) => {
  if (!uuidPattern.test(dispatchId)) throw operationError('Despacho inválido.')
  const expectedStatusMap = { Preparando: 'preparing', Despachado: 'dispatched' }
  const expectedDatabaseStatus = expectedStatusMap[expectedStatus]
  if (!expectedDatabaseStatus) throw operationError('El estado esperado del despacho no es válido.')
  await withTransaction(async (client) => {
    const current = await client.query(`
      select id, status from public.dispatches
      where id = $1 and organization_id = $2 and branch_id = $3
      for update
    `, [dispatchId, auth.organization_id, auth.branch_id])
    if (!current.rowCount) throw operationError('El despacho no existe.', 404)
    if (current.rows[0].status !== expectedDatabaseStatus) return
    if (current.rows[0].status === 'preparing') {
      const items = await client.query('select product_id, quantity from public.dispatch_items where dispatch_id = $1 order by product_id', [dispatchId])
      for (const item of items.rows) {
        await client.query('select 1 from public.branch_inventory where branch_id = $1 and product_id = $2 for update', [auth.branch_id, item.product_id])
        const inventory = await client.query(`
          update public.branch_inventory
          set on_hand = on_hand - $3, reserved = reserved - $3, updated_by = $4
          where branch_id = $1 and product_id = $2 and reserved >= $3
          returning on_hand, reserved
        `, [auth.branch_id, item.product_id, item.quantity, auth.user_id])
        if (!inventory.rowCount) throw operationError('La reserva del despacho ya no es válida.', 409)
        await client.query(`
          insert into public.stock_movements (
            organization_id, branch_id, product_id, movement_type, quantity_delta, reserved_delta,
            on_hand_after, reserved_after, source_type, source_id, reason, created_by
          ) values ($1, $2, $3, 'dispatch', $4, $4, $5, $6, 'dispatch', $7, 'Salida por despacho', $8)
        `, [auth.organization_id, auth.branch_id, item.product_id, -asNumber(item.quantity), inventory.rows[0].on_hand, inventory.rows[0].reserved, dispatchId, auth.user_id])
      }
      await client.query("update public.dispatches set status = 'dispatched', dispatched_at = now() where id = $1", [dispatchId])
    } else if (current.rows[0].status === 'dispatched') {
      await client.query("update public.dispatches set status = 'delivered', delivered_at = now() where id = $1", [dispatchId])
    }
  })
  return {
    products: await listProducts(pool, auth.organization_id, auth.branch_id),
    dispatches: await listDispatches(pool, auth.organization_id, auth.branch_id),
  }
}

app.get('/api/health', asyncRoute(async (_request, response) => {
  await pool.query('select 1')
  response.json({ ok: true, database: 'connected' })
}))

app.get('/api/auth/status', asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    select organization.name as business_name, branch.name as branch_name
    from public.organizations organization
    left join lateral (
      select name from public.branches where organization_id = organization.id and active order by created_at limit 1
    ) branch on true
    where organization.active
      and exists (select 1 from public.organization_members member where member.organization_id = organization.id and member.active)
    order by organization.created_at
    limit 1
  `)
  response.json({
    setupRequired: !result.rowCount,
    businessName: result.rows[0]?.business_name || 'Ferretería Los Nogales',
    branchName: result.rows[0]?.branch_name || 'Casa Matriz',
  })
}))

app.post('/api/auth/setup', asyncRoute(async (request, response) => {
  const username = normalizeUsername(request.body.username)
  const password = String(request.body.password || '')
  const validationError = passwordError(password)
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return response.status(400).json({ error: 'El usuario debe tener entre 3 y 30 caracteres validos.' })
  if (validationError) return response.status(400).json({ error: validationError })

  const payload = await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('erp-initial-setup'))")
    const initialized = await client.query('select 1 from public.organization_members where active limit 1')
    if (initialized.rowCount) {
      const conflict = new Error('El acceso inicial ya fue configurado.')
      conflict.status = 409
      throw conflict
    }
    const passwordHash = await bcrypt.hash(password, 12)
    const userResult = await client.query(`
      insert into public.app_users (username, email, full_name, password_hash, password_changed_at)
      values ($1, nullif($2, ''), $3, $4, now())
      returning id
    `, [username, normalizeEmail(request.body.email), String(request.body.name || 'Administrador').trim(), passwordHash])
    const bootstrap = await client.query('select * from public.bootstrap_business($1, $2, $3, $4)', [
      userResult.rows[0].id,
      String(request.body.businessName || 'Ferretería Los Nogales').trim(),
      String(request.body.branchName || 'Casa Matriz').trim(),
      null,
    ])
    const organizationId = bootstrap.rows[0].organization_id
    await client.query('update public.organization_members set permissions = $3 where organization_id = $1 and user_id = $2', [organizationId, userResult.rows[0].id, permissionIds])
    await client.query(`
      insert into public.erp_state_snapshots (organization_id, state, updated_by)
      values ($1, $2::jsonb, $3)
    `, [organizationId, JSON.stringify(sanitizeState(request.body.initialState)), userResult.rows[0].id])
    await client.query('update public.app_users set last_login_at = now() where id = $1', [userResult.rows[0].id])
    await createSession(client, response, userResult.rows[0].id, organizationId, request)
    const session = await loadSessionFromClient(client, userResult.rows[0].id, organizationId)
    return appPayload(client, session)
  })
  response.status(201).json(await payload)
}))

async function loadSessionFromClient(database, userId, organizationId) {
  const result = await database.query(`
    select app_user.id as user_id, app_user.id, app_user.username, app_user.email, app_user.full_name,
      app_user.password_algorithm, app_user.must_change_password, app_user.last_login_at,
      app_user.active as user_active, member.active as member_active, member.role, member.permissions,
      organization.id as organization_id, organization.name as organization_name,
      branch.id as branch_id, branch.name as branch_name
    from public.app_users app_user
    join public.organization_members member on member.user_id = app_user.id and member.organization_id = $2
    join public.organizations organization on organization.id = member.organization_id
    left join lateral (
      select id, name from public.branches where organization_id = organization.id and active order by created_at limit 1
    ) branch on true
    where app_user.id = $1
  `, [userId, organizationId])
  return result.rows[0]
}

app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const login = String(request.body.username || '').trim()
  if (!loginAllowed(request, login)) return response.status(429).json({ error: 'Demasiados intentos. Espera unos minutos antes de continuar.' })
  const result = await pool.query(`
    select app_user.id, app_user.username, app_user.email, app_user.full_name, app_user.password_hash,
      app_user.password_algorithm, app_user.must_change_password, app_user.last_login_at,
      app_user.active as user_active, member.active as member_active, member.role, member.permissions,
      organization.id as organization_id, organization.name as organization_name,
      branch.id as branch_id, branch.name as branch_name
    from public.app_users app_user
    join public.organization_members member on member.user_id = app_user.id and member.active
    join public.organizations organization on organization.id = member.organization_id and organization.active
    left join lateral (
      select id, name from public.branches where organization_id = organization.id and active order by created_at limit 1
    ) branch on true
    where app_user.active and (lower(app_user.username) = lower($1) or lower(app_user.email) = lower($1))
    order by member.created_at
    limit 1
  `, [login])
  const user = result.rows[0]
  if (!user || user.password_algorithm !== 'bcrypt' || !await bcrypt.compare(String(request.body.password || ''), user.password_hash)) {
    return response.status(401).json({ error: 'Usuario o contrasena incorrectos.' })
  }
  clearLoginAttempts(request, login)
  await withTransaction(async (client) => {
    await client.query('update public.app_users set last_login_at = now() where id = $1', [user.id])
    await createSession(client, response, user.id, user.organization_id, request)
  })
  if (user.must_change_password) {
    return response.json({ requiresPasswordChange: true, userId: user.id, name: user.full_name })
  }
  const session = await loadSessionFromClient(pool, user.id, user.organization_id)
  response.json(await appPayload(pool, session))
}))

app.post('/api/auth/change-password', requireSession({ allowPasswordChange: true }), asyncRoute(async (request, response) => {
  const password = String(request.body.password || '')
  const validationError = passwordError(password)
  if (validationError) return response.status(400).json({ error: validationError })
  const passwordHash = await bcrypt.hash(password, 12)
  await pool.query(`
    update public.app_users
    set password_hash = $2, password_algorithm = 'bcrypt', must_change_password = false, password_changed_at = now()
    where id = $1
  `, [request.auth.user_id, passwordHash])
  const session = await loadSessionFromClient(pool, request.auth.user_id, request.auth.organization_id)
  response.json(await appPayload(pool, session))
}))

app.post('/api/auth/logout', requireSession({ allowPasswordChange: true }), asyncRoute(async (request, response) => {
  await pool.query('update public.user_sessions set revoked_at = now() where id = $1', [request.auth.session_id])
  clearSessionCookie(response)
  response.status(204).end()
}))

app.get('/api/state', requireSession(), asyncRoute(async (request, response) => {
  response.json(await appPayload(pool, request.auth))
}))

app.get('/api/operations', requireSession(), asyncRoute(async (request, response) => {
  response.json(await operationalPayload(pool, request.auth))
}))

app.patch('/api/state', requireSession(), asyncRoute(async (request, response) => {
  const changes = sanitizeState(request.body.changes)
  if (!Object.keys(changes).length) return response.json({ ok: true })
  const result = await withTransaction(async (client) => {
    const stateResult = await client.query(`
      insert into public.erp_state_snapshots (organization_id, state, updated_by)
      values ($1, $2::jsonb, $3)
      on conflict (organization_id) do update
      set state = public.erp_state_snapshots.state || excluded.state,
          version = public.erp_state_snapshots.version + 1,
          updated_by = excluded.updated_by
      returning version, updated_at
    `, [request.auth.organization_id, JSON.stringify(changes), request.auth.user_id])
    if (changes.settings) {
      await client.query(`
        insert into public.organization_settings (organization_id, settings, updated_by)
        values ($1, $2::jsonb, $3)
        on conflict (organization_id) do update
        set settings = excluded.settings, updated_by = excluded.updated_by
      `, [request.auth.organization_id, JSON.stringify(changes.settings), request.auth.user_id])
      const business = changes.settings.business || {}
      await client.query(`
        update public.organizations
        set name = coalesce(nullif(trim($2), ''), name),
            legal_name = coalesce(nullif(trim($3), ''), legal_name),
            rut = nullif(trim($4), ''), email = nullif(trim($5), ''),
            phone = nullif(trim($6), ''), address = nullif(trim($7), '')
        where id = $1
      `, [request.auth.organization_id, business.name, business.legalName, business.rut, business.email, business.phone, business.address])
      await client.query(`
        update public.branches
        set name = coalesce(nullif(trim($3), ''), name),
            address = nullif(trim($4), ''), phone = nullif(trim($5), '')
        where organization_id = $1 and id = $2
      `, [request.auth.organization_id, request.auth.branch_id, business.branch, business.address, business.phone])
    }
    return stateResult.rows[0]
  })
  response.json({ ok: true, version: Number(result.version), updatedAt: result.updated_at })
}))

app.post('/api/products', requireSession(), requirePermission('editInventory'), asyncRoute(async (request, response) => {
  await withTransaction((client) => saveProductRecord(client, request.auth, request.body))
  response.status(201).json({ products: await listProducts(pool, request.auth.organization_id, request.auth.branch_id) })
}))

app.patch('/api/products/:id', requireSession(), requirePermission('editInventory'), asyncRoute(async (request, response) => {
  if (!uuidPattern.test(request.params.id)) throw operationError('Producto inválido.')
  await withTransaction(async (client) => {
    const existing = await client.query('select 1 from public.products where id = $1 and organization_id = $2', [request.params.id, request.auth.organization_id])
    if (!existing.rowCount) throw operationError('El producto no existe.', 404)
    await saveProductRecord(client, request.auth, { ...request.body, id: request.params.id })
  })
  response.json({ products: await listProducts(pool, request.auth.organization_id, request.auth.branch_id) })
}))

app.post('/api/products/import', requireSession(), requirePermission('editInventory'), asyncRoute(async (request, response) => {
  const products = Array.isArray(request.body?.products) ? request.body.products : []
  if (!products.length) throw operationError('No hay productos para importar.')
  if (products.length > 5000) throw operationError('La carga admite hasta 5.000 productos por vez.')
  await withTransaction(async (client) => {
    for (const product of products) await saveProductRecord(client, request.auth, product, { matchSku: true })
  })
  response.json({ products: await listProducts(pool, request.auth.organization_id, request.auth.branch_id) })
}))

app.post('/api/sales', requireSession(), requirePermission('pos'), asyncRoute(async (request, response) => {
  response.status(201).json(await completeSaleTransaction(request.auth, request.body))
}))

app.post('/api/receipts', requireSession(), requirePermission('receipts'), asyncRoute(async (request, response) => {
  response.status(201).json(await receiveInventoryTransaction(request.auth, request.body))
}))

app.post('/api/dispatches', requireSession(), requirePermission('dispatches'), asyncRoute(async (request, response) => {
  response.status(201).json(await createDispatchTransaction(request.auth, request.body))
}))

app.patch('/api/dispatches/:id/advance', requireSession(), requirePermission('dispatches'), asyncRoute(async (request, response) => {
  response.json(await advanceDispatchTransaction(request.auth, request.params.id, request.body?.expectedStatus))
}))

app.post('/api/cash-registers', requireSession(), requireUserAdmin, asyncRoute(async (request, response) => {
  const name = String(request.body?.name || '').trim()
  const requestedCode = String(request.body?.code || '').trim().toUpperCase()
  if (name.length < 2) throw operationError('El nombre de la caja debe tener al menos 2 caracteres.')
  if (requestedCode && !/^[A-Z0-9_-]{2,20}$/.test(requestedCode)) throw operationError('El código de caja contiene caracteres inválidos.')
  await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`cash-register:${request.auth.branch_id}`])
    const count = await client.query('select count(*)::int as total from public.cash_registers where branch_id = $1', [request.auth.branch_id])
    const code = requestedCode || `CAJA-${String(count.rows[0].total + 1).padStart(2, '0')}`
    await client.query(`
      insert into public.cash_registers (organization_id, branch_id, code, name)
      values ($1, $2, $3, $4)
    `, [request.auth.organization_id, request.auth.branch_id, code, name])
  })
  response.status(201).json({ cashRegisters: await listCashRegisters(pool, request.auth.organization_id, request.auth.branch_id) })
}))

app.post('/api/users', requireSession(), requireUserAdmin, asyncRoute(async (request, response) => {
  const username = normalizeUsername(request.body.username)
  const email = normalizeEmail(request.body.email)
  const name = String(request.body.name || '').trim()
  const role = labelRoles[request.body.role]
  const password = String(request.body.password || '')
  const validationError = passwordError(password)
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return response.status(400).json({ error: 'Nombre de usuario invalido.' })
  if (!name || !email || !role) return response.status(400).json({ error: 'Completa nombre, correo y rol.' })
  if (validationError) return response.status(400).json({ error: validationError })
  const permissions = validPermissions(request.body.permissions, role)
  const passwordHash = await bcrypt.hash(password, 12)
  await withTransaction(async (client) => {
    const created = await client.query(`
      insert into public.app_users (username, email, full_name, password_hash, must_change_password)
      values ($1, $2, $3, $4, true)
      returning id
    `, [username, email, name, passwordHash])
    await client.query(`
      insert into public.organization_members (organization_id, user_id, role, active, permissions)
      values ($1, $2, $3, $4, $5)
    `, [request.auth.organization_id, created.rows[0].id, role, request.body.active !== false, permissions])
    await client.query(`
      insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, new_data)
      values ($1, $2, 'create', 'user', $3, $4::jsonb)
    `, [request.auth.organization_id, request.auth.user_id, created.rows[0].id, JSON.stringify({ username, email, name, role })])
  })
  response.status(201).json({ users: await listUsers(pool, request.auth.organization_id) })
}))

app.patch('/api/users/:id', requireSession(), requireUserAdmin, asyncRoute(async (request, response) => {
  const userId = request.params.id
  const username = normalizeUsername(request.body.username)
  const email = normalizeEmail(request.body.email)
  const name = String(request.body.name || '').trim()
  const role = labelRoles[request.body.role]
  const permissions = validPermissions(request.body.permissions, role)
  const isSelf = userId === request.auth.user_id
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || !name || !email || !role) return response.status(400).json({ error: 'Datos de usuario invalidos.' })
  if (isSelf && (request.body.active === false || role !== 'admin' || !permissions.includes('settings') || !permissions.includes('manageUsers'))) {
    return response.status(400).json({ error: 'Tu usuario debe conservar el acceso de administrador.' })
  }
  const password = String(request.body.password || '')
  const validationError = password ? passwordError(password) : ''
  if (validationError) return response.status(400).json({ error: validationError })
  await withTransaction(async (client) => {
    const passwordHash = password ? await bcrypt.hash(password, 12) : null
    const updated = await client.query(`
      update public.app_users
      set username = $2, email = $3, full_name = $4, active = $5,
          password_hash = coalesce($6, password_hash),
          must_change_password = case when $6::text is not null then $7 else must_change_password end,
          password_changed_at = case when $6::text is not null then now() else password_changed_at end
      where id = $1
      returning id
    `, [userId, username, email, name, request.body.active !== false, passwordHash, password ? !isSelf : false])
    if (!updated.rowCount) {
      const missing = new Error('El usuario no existe.')
      missing.status = 404
      throw missing
    }
    await client.query(`
      update public.organization_members
      set role = $3, active = $4, permissions = $5
      where organization_id = $1 and user_id = $2
    `, [request.auth.organization_id, userId, role, request.body.active !== false, permissions])
    if (password || request.body.active === false) {
      await client.query(`
        update public.user_sessions
        set revoked_at = now()
        where user_id = $1 and revoked_at is null and id <> $2
      `, [userId, request.auth.session_id])
    }
    await client.query(`
      insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, new_data)
      values ($1, $2, 'update', 'user', $3, $4::jsonb)
    `, [request.auth.organization_id, request.auth.user_id, userId, JSON.stringify({ username, email, name, role, active: request.body.active !== false })])
  })
  response.json({ users: await listUsers(pool, request.auth.organization_id) })
}))

app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint inexistente.' }))

if (process.env.NODE_ENV === 'production') {
  const distribution = resolve(projectRoot, 'dist')
  app.use(express.static(distribution, { index: false }))
  app.use((_request, response) => response.sendFile(resolve(distribution, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

app.use((error, _request, response, _next) => {
  const duplicate = error.code === '23505'
  const message = duplicate
    ? 'Ya existe un registro con esos datos.'
    : error.status && error.message
      ? error.message
      : 'No fue posible completar la operacion en el servidor.'
  if (!error.status && !duplicate) console.error(error)
  response.status(error.status || (duplicate ? 409 : 500)).json({ error: message })
})

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)
if (isMainModule) {
  const server = app.listen(port, () => console.log(`ERP disponible en http://localhost:${port}`))
  const shutdown = async () => {
    server.close()
    await pool.end().catch(() => {})
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

export {
  app,
  advanceDispatchTransaction,
  completeSaleTransaction,
  createDispatchTransaction,
  listCashRegisters,
  listDispatches,
  listProducts,
  listReceipts,
  listSales,
  operationalPayload,
  pool,
  receiveInventoryTransaction,
  saveProductRecord,
}
