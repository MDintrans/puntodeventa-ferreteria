import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import bcrypt from 'bcryptjs'
import { chromium } from 'playwright-core'

process.env.NODE_ENV = 'production'

const { app, pool } = await import('../server/index.mjs')
const suffix = randomBytes(6).toString('hex')
const username = `ui-${suffix}`
const password = 'Validacion123'
let organizationId
let userId
let browser
let server

const closeServer = () => new Promise((resolve) => server?.close(resolve) || resolve())
const inspectViewport = async (page, name) => {
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  assert.ok(layout.documentWidth <= layout.viewport && layout.bodyWidth <= layout.viewport, `${name} tiene desborde horizontal`)
}

const login = async (page, baseUrl) => {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByLabel('Usuario').fill(username)
  await page.locator('.login-password input').fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: 'Punto de venta', exact: true }).waitFor()
}

try {
  const passwordHash = await bcrypt.hash(password, 4)
  const user = await pool.query(`
    insert into public.app_users (username, email, full_name, password_hash, password_changed_at)
    values ($1, $2, 'Administrador UI', $3, now()) returning id
  `, [username, `${username}@example.invalid`, passwordHash])
  userId = user.rows[0].id

  const bootstrap = await pool.query(
    'select * from public.bootstrap_business($1, $2, $3, $4)',
    [userId, `Validación UI ${suffix}`, 'Casa Matriz', null],
  )
  organizationId = bootstrap.rows[0].organization_id
  const branchId = bootstrap.rows[0].branch_id
  await pool.query(`
    update public.organization_members
    set permissions = array[
      'dashboard', 'pos', 'inventory', 'receipts', 'dispatches', 'customers',
      'suppliers', 'reports', 'settings', 'editInventory', 'deleteHeldSales',
      'exportReports', 'manageUsers'
    ]
    where organization_id = $1 and user_id = $2
  `, [organizationId, userId])
  await pool.query(`
    insert into public.erp_state_snapshots (organization_id, state, updated_by)
    values ($1, '{}'::jsonb, $2)
  `, [organizationId, userId])

  const category = await pool.query(`
    insert into public.product_categories (organization_id, name)
    values ($1, 'Validación') returning id
  `, [organizationId])
  const product = await pool.query(`
    insert into public.products (
      organization_id, category_id, sku, name, brand, unit,
      cost_amount, sale_price, minimum_stock, created_by, updated_by
    ) values ($1, $2, 'UI-001', 'Producto prueba dos cajas', 'Codex', 'un', 500, 1190, 1, $3, $3)
    returning id
  `, [organizationId, category.rows[0].id, userId])
  await pool.query(`
    insert into public.branch_inventory (organization_id, branch_id, product_id, on_hand, location, updated_by)
    values ($1, $2, $3, 2, 'TEST-01', $4)
  `, [organizationId, branchId, product.rows[0].id, userId])

  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  await mkdir('artifacts', { recursive: true })

  const firstTerminal = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await login(firstTerminal, baseUrl)
  await inspectViewport(firstTerminal, 'login y dashboard de escritorio')

  await firstTerminal.locator('.sidebar').getByRole('button', { name: 'Configuración', exact: true }).click()
  await firstTerminal.getByRole('button', { name: /Ventas y caja/ }).click()
  await firstTerminal.getByPlaceholder('Ej. Caja 02').fill('Caja 02')
  await firstTerminal.getByPlaceholder('Código opcional').fill('CAJA-02')
  await firstTerminal.getByRole('button', { name: 'Agregar caja', exact: true }).click()
  await firstTerminal.getByText('Caja agregada y disponible para esta sucursal', { exact: true }).waitFor()
  await firstTerminal.getByText('CAJA-02', { exact: false }).waitFor()

  await firstTerminal.locator('.sidebar').getByRole('button', { name: 'Punto de venta', exact: true }).click()
  const firstRegisterSelect = firstTerminal.locator('.register-field select')
  assert.equal(await firstRegisterSelect.locator('option').count(), 3, 'El POS debe mostrar dos cajas y la opción vacía')
  await firstRegisterSelect.selectOption({ label: 'Caja 02 (CAJA-02)' })
  await firstTerminal.getByRole('button', { name: /Producto prueba dos cajas/ }).click()
  await firstTerminal.locator('.checkout-button').click()
  const firstReceipt = firstTerminal.getByRole('dialog')
  await firstReceipt.getByRole('heading', { name: 'Venta completada' }).waitFor()
  await firstReceipt.getByText(/Caja 02 · Administrador UI/).waitFor()
  await firstTerminal.screenshot({ path: 'artifacts/transaccion-dos-cajas.png', fullPage: true })
  await firstReceipt.getByRole('button', { name: 'Finalizar', exact: true }).click()

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const secondTerminal = await secondContext.newPage()
  await login(secondTerminal, baseUrl)
  await secondTerminal.locator('.mobile-nav').getByRole('button', { name: 'Venta', exact: true }).click()
  const secondRegisterSelect = secondTerminal.locator('.register-field select')
  await secondRegisterSelect.selectOption({ label: 'Caja principal (CAJA-01)' })
  await secondTerminal.getByRole('button', { name: /Producto prueba dos cajas/ }).click()
  await secondTerminal.locator('.checkout-button').scrollIntoViewIfNeeded()
  await secondTerminal.locator('.checkout-button').click()
  await secondTerminal.getByRole('dialog').getByRole('heading', { name: 'Venta completada' }).waitFor()
  await inspectViewport(secondTerminal, 'boleta móvil')

  const databaseState = await pool.query(`
    select
      (select count(*)::int from public.sales where organization_id = $1) as sales,
      (select count(distinct cash_register_id)::int from public.sales where organization_id = $1) as registers,
      (select on_hand from public.branch_inventory where branch_id = $2 and product_id = $3) as on_hand
  `, [organizationId, branchId, product.rows[0].id])
  assert.deepEqual(databaseState.rows[0], { sales: 2, registers: 2, on_hand: '0.000' })

  await firstTerminal.evaluate(() => window.dispatchEvent(new Event('focus')))
  await firstTerminal.waitForFunction(() => {
    const productCard = [...document.querySelectorAll('.product-card')].find((card) => card.textContent.includes('Producto prueba dos cajas'))
    return productCard?.disabled && productCard.textContent.includes('0 un')
  })

  console.log('OK login y operación visual en escritorio y móvil')
  console.log('OK creación y selección independiente de dos cajas')
  console.log('OK actualización de stock entre terminales desde Neon')
} finally {
  if (browser) await browser.close().catch(() => {})
  await closeServer()
  if (organizationId) await pool.query('delete from public.organizations where id = $1', [organizationId]).catch(() => {})
  if (userId) await pool.query('delete from public.app_users where id = $1', [userId]).catch(() => {})
  await pool.end()
}
