import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const migrationPath = resolve(import.meta.dirname, '..', 'neon', 'migrations', '202609220001_initial_erp.sql')
const migration = await readFile(migrationPath, 'utf8')
const database = await PGlite.create()

try {
  await database.exec(migration)

  const tables = await database.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `)
  const functions = await database.query(`
    select distinct routine_name
    from information_schema.routines
    where routine_schema = 'public'
  `)
  const views = await database.query(`
    select table_name
    from information_schema.views
    where table_schema = 'public'
  `)

  assert.equal(tables.rows.length, 33, 'La migración debe crear 33 tablas ERP')
  assert.equal(functions.rows.length, 6, 'La migración debe crear 6 funciones')
  assert.equal(views.rows.length, 2, 'La migración debe crear 2 vistas')

  const user = await database.query(`
    insert into public.app_users (username, full_name, password_hash)
    values ('admin-prueba', 'Administrador de prueba', '$2b$12$hash.solo.para.validar.esquema')
    returning id
  `)
  const userId = user.rows[0].id

  const bootstrap = await database.query(
    'select * from public.bootstrap_business($1, $2, $3, $4)',
    [userId, 'Empresa de prueba', 'Casa Matriz', null],
  )
  const { organization_id: organizationId, branch_id: branchId } = bootstrap.rows[0]

  const emptyBusinessData = await database.query(`
    select
      (select count(*)::int from public.products) as products,
      (select count(*)::int from public.customers) as customers,
      (select count(*)::int from public.suppliers) as suppliers,
      (select count(*)::int from public.branch_inventory) as inventory
  `)
  assert.deepEqual(emptyBusinessData.rows[0], {
    products: 0,
    customers: 0,
    suppliers: 0,
    inventory: 0,
  })

  const category = await database.query(`
    insert into public.product_categories (organization_id, name)
    values ($1, 'Validación')
    returning id
  `, [organizationId])
  const product = await database.query(`
    insert into public.products (
      organization_id, category_id, sku, name, cost_amount, sale_price, created_by
    )
    values ($1, $2, 'TEST-001', 'Producto de prueba', 1000, 1490, $3)
    returning id
  `, [organizationId, category.rows[0].id, userId])

  const stock = await database.query(
    'select * from public.adjust_inventory($1, $2, $3, $4, $5)',
    [userId, branchId, product.rows[0].id, 25, 'Stock de validación'],
  )
  assert.equal(Number(stock.rows[0].on_hand), 25)
  assert.equal(Number(stock.rows[0].available), 25)

  await assert.rejects(
    database.query(`
      update public.organization_members
      set role = 'seller'
      where organization_id = $1 and user_id = $2
    `, [organizationId, userId]),
    /administrador activo/,
  )

  await database.query('delete from public.organizations where id = $1', [organizationId])
  const remainingOrganizations = await database.query('select count(*)::int as count from public.organizations')
  assert.equal(remainingOrganizations.rows[0].count, 0)

  console.log('OK sintaxis PostgreSQL y relaciones')
  console.log('OK 33 tablas, 6 funciones y 2 vistas')
  console.log('OK bootstrap vacío, control de roles y ajuste de inventario')
} finally {
  await database.close()
}
